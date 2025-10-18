"""
Agent File Return tool for returning files to users in chat
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal

# Custom exception for direct file return
class DirectFileReturn(Exception):
    """Exception that carries file data to bypass agent processing"""
    def __init__(self, message: str, file_data: List[Dict[str, Any]]):
        self.message = message
        self.file_data = file_data
        super().__init__(message)

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    logger.info("Successfully imported Strands types from layer")
except ImportError as e:
    logger.warning(f"Could not import Strands types: {e}")
    # Define fallback types for local development
    class ToolResult:
        def __init__(self, content: str, is_error: bool = False):
            self.content = content
            self.is_error = is_error
    
    class ToolUse:
        def __init__(self, name: str, arguments: Dict[str, Any]):
            self.name = name
            self.arguments = arguments

def convert_decimals(obj):
    """Convert Decimal objects to regular numbers for JSON serialization"""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    else:
        return obj

class AgentFileReturn:
    """
    Handles returning files to users in chat
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-uploads')
    
    def return_session_files(self, session_id: str, user_id: str, file_indices: List[int] = None) -> Dict[str, Any]:
        """
        Return files from session_variables.uploaded_files
        
        Args:
            session_id: Session ID
            user_id: User ID
            file_indices: List of file indices to return (None = all files)
            
        Returns:
            Dictionary with file return information
        """
        try:
            # Get session data from DynamoDB
            import boto3
            dynamodb = boto3.resource('dynamodb')
            table_name = os.environ.get('CHAT_SESSIONS_TABLE_NAME', 'chat-sessions')
            table = dynamodb.Table(table_name)
            
            response = table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' not in response:
                return {
                    "success": False,
                    "error": "Session not found"
                }
            
            session_data = response['Item']
            uploaded_files = session_data.get('session_variables', {}).get('uploaded_files', [])
            
            if not uploaded_files:
                return {
                    "success": False,
                    "error": "No files found in session"
                }
            
            # Filter files by indices if specified
            if file_indices is not None:
                selected_files = [uploaded_files[i] for i in file_indices if i < len(uploaded_files)]
            else:
                selected_files = uploaded_files
            
            # Generate signed URLs for each file
            returned_files = []
            for file_data in selected_files:
                try:
                    # Generate signed URL (valid for 1 hour)
                    signed_url = self.s3_client.generate_presigned_url(
                        'get_object',
                        Params={
                            'Bucket': self.bucket_name,
                            'Key': file_data.get('s3_key', '')
                        },
                        ExpiresIn=3600  # 1 hour
                    )
                    
                    returned_files.append({
                        "filename": file_data.get('filename', 'Unknown'),
                        "file_type": file_data.get('file_type', 'Unknown'),
                        "file_size": file_data.get('file_size', 0),
                        "s3_key": file_data.get('s3_key', ''),
                        "download_url": signed_url,
                        "uploaded_at": file_data.get('uploaded_at', ''),
                        "original_name": file_data.get('original_name', file_data.get('filename', 'Unknown'))
                    })
                    
                except Exception as e:
                    logger.error(f"Error generating signed URL for file {file_data.get('filename', 'Unknown')}: {str(e)}")
                    continue
            
            return {
                "success": True,
                "files": returned_files,
                "total_files": len(returned_files),
                "message": f"Returning {len(returned_files)} file(s) from your session"
            }
            
        except Exception as e:
            logger.error(f"Error returning session files: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to return files: {str(e)}"
            }
    
    def create_agent_file(self, session_id: str, user_id: str, filename: str, content: str, file_type: str = 'text/plain') -> Dict[str, Any]:
        """
        Create a new file and return it to the user
        
        Args:
            session_id: Session ID
            user_id: User ID
            filename: Name of the file to create
            content: File content
            file_type: MIME type of the file
            
        Returns:
            Dictionary with file creation information
        """
        try:
            # Create agent files directory path
            agent_files_path = f"users/{user_id}/sessions/{session_id}/agentfiles/"
            
            # Generate unique filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_filename = filename.replace(' ', '_').replace('/', '_').replace('\\', '_')
            s3_key = f"{agent_files_path}{timestamp}_{safe_filename}"
            
            # Upload file to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=content.encode('utf-8'),
                ContentType=file_type,
                Metadata={
                    'created_by': 'agent',
                    'session_id': session_id,
                    'user_id': user_id,
                    'original_filename': filename
                }
            )
            
            # Generate signed URL
            signed_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=3600  # 1 hour
            )
            
            return {
                "success": True,
                "file": {
                    "filename": filename,
                    "file_type": file_type,
                    "file_size": len(content.encode('utf-8')),
                    "s3_key": s3_key,
                    "download_url": signed_url,
                    "created_at": datetime.now().isoformat(),
                    "created_by": "agent"
                },
                "message": f"Created file '{filename}' for you"
            }
            
        except Exception as e:
            logger.error(f"Error creating agent file: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to create file: {str(e)}"
            }

# Global instance
agent_file_return = AgentFileReturn()

@tool
def return_session_files_tool(session_id: str, user_id: str, file_indices: str = None) -> str:
    """
    Tool function to return files from session to user
    
    Args:
        session_id: Session ID
        user_id: User ID
        file_indices: Comma-separated list of file indices to return (e.g., "0,2,3" or "all" for all files)
        
    Returns:
        String with file return information
    """
    try:
        if not session_id or not user_id:
            return "Error: session_id and user_id parameters are required"
        
        # Parse file indices
        indices = None
        if file_indices and file_indices.lower() != 'all':
            try:
                indices = [int(x.strip()) for x in file_indices.split(',')]
            except ValueError:
                return "Error: file_indices must be comma-separated numbers or 'all'"
        
        # Return files
        result = agent_file_return.return_session_files(session_id, user_id, indices)
        
        if not result["success"]:
            return f"Error returning files: {result['error']}"
        
        # Return formatted text with embedded JSON for frontend parsing
        import json
        # Convert Decimal objects to regular numbers for JSON serialization
        converted_result = convert_decimals(result)
        
        # Raise exception to bypass agent processing entirely
        raise DirectFileReturn(
            message=f"📁 {converted_result['total_files']} file(s) ready for download",
            file_data=converted_result['files']
        )
        
    except Exception as e:
        logger.error(f"Error in return_session_files_tool: {str(e)}")
        return f"Error returning files: {str(e)}"

@tool
def create_agent_file_tool(session_id: str, user_id: str, filename: str, content: str, file_type: str = 'text/plain') -> str:
    """
    Tool function to create a new file and return it to user
    
    Args:
        session_id: Session ID
        user_id: User ID
        filename: Name of the file to create
        content: File content
        file_type: MIME type of the file (default: text/plain)
        
    Returns:
        String with file creation information
    """
    try:
        if not session_id or not user_id or not filename or not content:
            return "Error: session_id, user_id, filename, and content parameters are required"
        
        # Create file
        result = agent_file_return.create_agent_file(session_id, user_id, filename, content, file_type)
        
        if not result["success"]:
            return f"Error creating file: {result['error']}"
        
        # Return formatted text with embedded JSON for frontend parsing
        import json
        # Convert Decimal objects to regular numbers for JSON serialization
        converted_result = convert_decimals(result)
        
        # Raise exception to bypass agent processing entirely
        raise DirectFileReturn(
            message=f"📁 File '{filename}' created and ready for download",
            file_data=[converted_result['file']]
        )
        
    except Exception as e:
        logger.error(f"Error in create_agent_file_tool: {str(e)}")
        return f"Error creating file: {str(e)}"
