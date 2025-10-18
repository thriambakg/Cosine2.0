"""
Session Database Access tool for the chat agent to retrieve session files and context from DynamoDB
"""

import json
import os
import boto3
import logging
from typing import Dict, Any, List, Optional
from botocore.exceptions import ClientError
from decimal import Decimal

# Configure logging
logger = logging.getLogger()

def convert_decimals_to_json(obj):
    """
    Convert Decimal objects to JSON-serializable types
    """
    if isinstance(obj, Decimal):
        # Convert Decimal to int if it's a whole number, otherwise to float
        if obj % 1 == 0:
            return int(obj)
        else:
            return float(obj)
    elif isinstance(obj, list):
        return [convert_decimals_to_json(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: convert_decimals_to_json(value) for key, value in obj.items()}
    else:
        return obj

class DecimalEncoder(json.JSONEncoder):
    """
    Custom JSON encoder to handle Decimal objects
    """
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            else:
                return float(obj)
        return super(DecimalEncoder, self).default(obj)

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    logger.info("Successfully imported Strands types from layer")
except ImportError as e:
    logger.error(f"Failed to import Strands types: {e}")
    raise

# Tool specification following Strands pattern
TOOL_SPEC = {
    "name": "get_session_files",
    "description": "Retrieve uploaded files and context items for a specific session from the database. Use this tool when users ask about files they've uploaded or when you need to access session context.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session ID to retrieve files for"
                },
                "user_id": {
                    "type": "string", 
                    "description": "The user ID who owns the session"
                },
                "file_type": {
                    "type": "string",
                    "description": "Filter files by type (e.g., 'json', 'csv', 'pdf') or 'all' for all files",
                    "default": "all"
                }
            },
            "required": ["session_id", "user_id"]
        }
    }
}

class SessionDatabaseAccess:
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.sessions_table = None
        
    def get_sessions_table(self):
        """Get the chat sessions table name from environment variables"""
        if self.sessions_table is None:
            self.sessions_table = self.dynamodb.Table(os.environ.get('CHAT_SESSIONS_TABLE_NAME'))
            if not self.sessions_table:
                raise ValueError("CHAT_SESSIONS_TABLE_NAME environment variable not set")
        return self.sessions_table
    
    def get_session_files(self, session_id: str, user_id: str, file_type: str = "all") -> Dict[str, Any]:
        """
        Retrieve uploaded files and context items for a session
        
        Args:
            session_id: The session ID
            user_id: The user ID
            file_type: Filter by file type or 'all' for all files
            
        Returns:
            Dictionary with session files and context
        """
        try:
            table = self.get_sessions_table()
            logger.info(f"Retrieving session files for session {session_id}, user {user_id}")
            
            # Get the session from DynamoDB
            response = table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' not in response:
                return {
                    'error': f'Session {session_id} not found for user {user_id}',
                    'files': [],
                    'context_items': []
                }
            
            session_item = response['Item']
            session_variables = session_item.get('session_variables', {})
            
            # Get uploaded files
            uploaded_files = session_variables.get('uploaded_files', [])
            if file_type != "all":
                # Filter files by type
                uploaded_files = [
                    file for file in uploaded_files 
                    if file.get('content_type', '').startswith(file_type) or 
                       file.get('filename', '').endswith(f'.{file_type}')
                ]
            
            # Get context items
            context_items = session_variables.get('context_items', [])
            
            # Format the response
            result = {
                'session_id': session_id,
                'user_id': user_id,
                'files': uploaded_files,
                'context_items': context_items,
                'total_files': len(uploaded_files),
                'total_context_items': len(context_items),
                'session_metadata': {
                    'created_at': session_item.get('created_at'),
                    'last_updated': session_item.get('last_updated'),
                    'message_count': session_item.get('message_count', 0)
                }
            }
            
            # Convert Decimal objects to JSON-serializable types
            result = convert_decimals_to_json(result)
            
            # Add file summaries for easy reference
            if uploaded_files:
                file_summaries = []
                for file in uploaded_files:
                    file_summaries.append({
                        'filename': file.get('filename', 'Unknown'),
                        's3_key': file.get('s3_key', ''),
                        's3_url': file.get('s3_url', ''),
                        'content_type': file.get('content_type', 'unknown'),
                        'file_size': file.get('file_size', 0),
                        'upload_timestamp': file.get('upload_timestamp', 0)
                    })
                result['file_summaries'] = file_summaries
            
            return result
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            return {
                'error': f'DynamoDB error ({error_code}): {str(e)}',
                'files': [],
                'context_items': []
            }
        except Exception as e:
            logger.error(f"Error retrieving session files: {str(e)}")
            return {
                'error': f'Error retrieving session files: {str(e)}',
                'files': [],
                'context_items': []
            }
    
    def get_session_context(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Get full session context including files, context items, and metadata
        
        Args:
            session_id: The session ID
            user_id: The user ID
            
        Returns:
            Dictionary with complete session context
        """
        try:
            table = self.get_sessions_table()
            logger.info(f"Retrieving session context for session {session_id}, user {user_id}")
            
            # Get the session from DynamoDB
            response = table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' not in response:
                return {
                    'error': f'Session {session_id} not found for user {user_id}',
                    'exists': False
                }
            
            session_item = response['Item']
            session_variables = session_item.get('session_variables', {})
            
            result = {
                'session_id': session_id,
                'user_id': user_id,
                'exists': True,
                'session_variables': session_variables,
                'uploaded_files': session_variables.get('uploaded_files', []),
                'context_items': session_variables.get('context_items', []),
                'context_summary': session_variables.get('context_summary', {}),
                'session_metadata': {
                    'created_at': session_item.get('created_at'),
                    'last_updated': session_item.get('last_updated'),
                    'message_count': session_item.get('message_count', 0),
                    'title': session_item.get('title', 'Untitled'),
                    'model': session_item.get('model', 'claude-3-sonnet')
                }
            }
            
            # Convert Decimal objects to JSON-serializable types
            result = convert_decimals_to_json(result)
            return result
            
        except Exception as e:
            logger.error(f"Error retrieving session context: {str(e)}")
            return {
                'error': f'Error retrieving session context: {str(e)}',
                'exists': False
            }

@tool
def get_session_files_tool(session_id: str, user_id: str, file_type: str = "all") -> str:
    """
    Tool function to retrieve session files from the database
    
    Args:
        session_id: The session ID to retrieve files for
        user_id: The user ID who owns the session
        file_type: Filter files by type or 'all' for all files
        
    Returns:
        String with session files information or error message
    """
    try:
        if not session_id or not user_id:
            return "Error: session_id and user_id parameters are required"
        
        # Create database access instance
        db_access = SessionDatabaseAccess()
        
        # Get session files
        result = db_access.get_session_files(session_id, user_id, file_type)
        
        if 'error' in result:
            return f"Error retrieving session files: {result['error']}"
        
        # Format the response for the AI
        response_parts = [
            f"Session Files for {session_id}:",
            f"- Total Files: {result['total_files']}",
            f"- Total Context Items: {result['total_context_items']}",
            f"- Session Created: {result['session_metadata'].get('created_at', 'Unknown')}",
            f"- Last Updated: {result['session_metadata'].get('last_updated', 'Unknown')}",
            f"- Message Count: {result['session_metadata'].get('message_count', 0)}"
        ]
        
        if result['files']:
            response_parts.append("\nUploaded Files:")
            for i, file in enumerate(result['files'], 1):
                response_parts.append(f"{i}. {file.get('filename', 'Unknown')} ({file.get('content_type', 'unknown')})")
                response_parts.append(f"   S3 Key: {file.get('s3_key', 'N/A')}")
                response_parts.append(f"   Size: {file.get('file_size', 0)} bytes")
                response_parts.append(f"   Uploaded: {file.get('upload_timestamp', 'Unknown')}")
        
        if result['context_items']:
            response_parts.append("\nContext Items:")
            for i, item in enumerate(result['context_items'], 1):
                response_parts.append(f"{i}. {item.get('title', 'Unknown')} ({item.get('type', 'unknown')})")
                if item.get('data'):
                    response_parts.append(f"   Data: {json.dumps(item['data'], indent=2, cls=DecimalEncoder)[:200]}...")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in get_session_files_tool: {str(e)}")
        return f"Error retrieving session files: {str(e)}"

@tool  
def get_session_context_tool(session_id: str, user_id: str) -> str:
    """
    Tool function to retrieve complete session context from the database
    
    Args:
        session_id: The session ID to retrieve context for
        user_id: The user ID who owns the session
        
    Returns:
        String with complete session context or error message
    """
    try:
        if not session_id or not user_id:
            return "Error: session_id and user_id parameters are required"
        
        # Create database access instance
        db_access = SessionDatabaseAccess()
        
        # Get session context
        result = db_access.get_session_context(session_id, user_id)
        
        if 'error' in result:
            return f"Error retrieving session context: {result['error']}"
        
        if not result.get('exists', False):
            return f"Session {session_id} not found for user {user_id}"
        
        # Format the response for the AI
        response_parts = [
            f"Complete Session Context for {session_id}:",
            f"- User: {result['user_id']}",
            f"- Title: {result['session_metadata'].get('title', 'Untitled')}",
            f"- Model: {result['session_metadata'].get('model', 'claude-3-sonnet')}",
            f"- Created: {result['session_metadata'].get('created_at', 'Unknown')}",
            f"- Last Updated: {result['session_metadata'].get('last_updated', 'Unknown')}",
            f"- Message Count: {result['session_metadata'].get('message_count', 0)}"
        ]
        
        if result['uploaded_files']:
            response_parts.append(f"\nUploaded Files ({len(result['uploaded_files'])}):")
            for i, file in enumerate(result['uploaded_files'], 1):
                response_parts.append(f"{i}. {file.get('filename', 'Unknown')} ({file.get('content_type', 'unknown')})")
                response_parts.append(f"   S3 Key: {file.get('s3_key', 'N/A')}")
                response_parts.append(f"   Size: {file.get('file_size', 0)} bytes")
        
        if result['context_items']:
            response_parts.append(f"\nContext Items ({len(result['context_items'])}):")
            for i, item in enumerate(result['context_items'], 1):
                response_parts.append(f"{i}. {item.get('title', 'Unknown')} ({item.get('type', 'unknown')})")
                if item.get('data'):
                    response_parts.append(f"   Data: {json.dumps(item['data'], indent=2, cls=DecimalEncoder)[:200]}...")
        
        if result.get('context_summary'):
            response_parts.append(f"\nContext Summary:")
            response_parts.append(json.dumps(result['context_summary'], indent=2, cls=DecimalEncoder))
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in get_session_context_tool: {str(e)}")
        return f"Error retrieving session context: {str(e)}"
