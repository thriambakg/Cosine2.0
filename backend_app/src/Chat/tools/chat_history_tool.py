"""
Chat History Tool for on-demand conversation history retrieval
Allows the agent to fetch chat history when needed instead of loading it all upfront
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

class ChatHistoryAccess:
    """
    Provides on-demand access to chat history from DynamoDB
    """
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.chat_sessions_table_name = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
        
        if not self.chat_sessions_table_name:
            raise ValueError("CHAT_SESSIONS_TABLE_NAME environment variable not set")
        
        self.chat_sessions_table = self.dynamodb.Table(self.chat_sessions_table_name)
    
    def _parse_dynamodb_message(self, message_item: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse DynamoDB message format to extract message data
        
        Args:
            message_item: DynamoDB message item with nested M/S/N/L format
            
        Returns:
            Parsed message dictionary
        """
        try:
            # Extract the 'M' (Map) wrapper
            message_map = message_item.get('M', {})
            
            # Parse each field from DynamoDB format
            parsed_message = {}
            
            # Extract text
            if 'text' in message_map:
                parsed_message['text'] = message_map['text'].get('S', '')
            
            # Extract sender
            if 'sender' in message_map:
                parsed_message['sender'] = message_map['sender'].get('S', '')
            
            # Extract timestamp
            if 'timestamp' in message_map:
                timestamp_str = message_map['timestamp'].get('N', '0')
                parsed_message['timestamp'] = int(timestamp_str)
            
            # Extract message ID
            if 'id' in message_map:
                parsed_message['id'] = message_map['id'].get('S', '')
            
            # Extract model (if present)
            if 'model' in message_map:
                parsed_message['model'] = message_map['model'].get('S', '')
            
            # Extract message type (if present)
            if 'message_type' in message_map:
                parsed_message['message_type'] = message_map['message_type'].get('S', 'text')
            
            # Extract files (if present)
            if 'files' in message_map:
                files_list = message_map['files'].get('L', [])
                parsed_files = []
                for file_item in files_list:
                    file_map = file_item.get('M', {})
                    parsed_file = {}
                    if 'name' in file_map:
                        parsed_file['name'] = file_map['name'].get('S', '')
                    if 'size' in file_map:
                        parsed_file['size'] = int(file_map['size'].get('N', '0'))
                    if 'type' in file_map:
                        parsed_file['type'] = file_map['type'].get('S', '')
                    parsed_files.append(parsed_file)
                parsed_message['files'] = parsed_files
            
            return parsed_message
            
        except Exception as e:
            logger.error(f"Error parsing DynamoDB message: {str(e)}")
            return {
                'text': '',
                'sender': 'unknown',
                'timestamp': 0,
                'id': '',
                'message_type': 'text'
            }
    
    def get_chat_history(self, session_id: str, user_id: str, limit: int = 10, include_recent: bool = True) -> Dict[str, Any]:
        """
        Get chat history for a session with smart pagination
        
        Args:
            session_id: Session ID
            user_id: User ID
            limit: Maximum number of conversations to return (default: 10)
            include_recent: If True, returns most recent conversations; if False, returns oldest conversations
            
        Returns:
            Dictionary with chat history and metadata
        """
        try:
            logger.info(f"Getting chat history for session {session_id}, limit: {limit}, recent: {include_recent}")
            logger.info(f"Using table: {self.chat_sessions_table_name}")
            
            # Get session from DynamoDB
            response = self.chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            logger.info(f"DynamoDB response: {response}")
            
            if 'Item' not in response:
                logger.warning(f"Session {session_id} not found in DynamoDB")
                return {
                    "success": False,
                    "error": f"Session {session_id} not found",
                    "conversations": []
                }
            
            session_item = response['Item']
            messages = session_item.get('messages', [])
            logger.info(f"Found {len(messages)} messages in session")
            
            if not messages:
                return {
                    "success": True,
                    "conversations": [],
                    "total_messages": 0,
                    "message": "No messages found in this session"
                }
            
            # Parse DynamoDB messages and build conversation history
            conversation_history = []
            logger.info(f"Processing {len(messages)} messages")
            for i, message_item in enumerate(messages):
                logger.info(f"Processing message {i+1}: {message_item}")
                # Parse DynamoDB message format
                message = self._parse_dynamodb_message(message_item)
                logger.info(f"Parsed message {i+1}: {message}")
                
                if message.get('sender') == 'user':
                    conversation_history.append({
                        'timestamp': message['timestamp'],
                        'user_message': message.get('text', ''),
                        'agent_response': '',
                        'message_id': message.get('id', ''),
                        'files': message.get('files', [])
                    })
                elif message.get('sender') == 'bot':
                    # Add to the last conversation entry or create new one
                    if conversation_history and conversation_history[-1]['agent_response'] == '':
                        conversation_history[-1]['agent_response'] = message.get('text', '')
                        conversation_history[-1]['model'] = message.get('model', '')
                    else:
                        conversation_history.append({
                            'timestamp': message['timestamp'],
                            'user_message': '',
                            'agent_response': message.get('text', ''),
                            'message_id': message.get('id', ''),
                            'model': message.get('model', ''),
                            'files': []
                        })
            
            # Apply pagination and ordering
            total_conversations = len(conversation_history)
            logger.info(f"Built {total_conversations} conversation pairs")
            
            if include_recent:
                # Return most recent conversations
                paginated_conversations = conversation_history[-limit:] if limit < total_conversations else conversation_history
            else:
                # Return oldest conversations
                paginated_conversations = conversation_history[:limit] if limit < total_conversations else conversation_history
            
            logger.info(f"Returning {len(paginated_conversations)} conversations after pagination")
            
            # Format conversations for agent consumption
            formatted_conversations = []
            for i, conv in enumerate(paginated_conversations):
                formatted_conv = {
                    'conversation_number': i + 1,
                    'timestamp': conv['timestamp'],
                    'user_message': conv['user_message'],
                    'agent_response': conv['agent_response'][:500] + "..." if len(conv['agent_response']) > 500 else conv['agent_response'],
                    'message_id': conv.get('message_id', ''),
                    'model': conv.get('model', ''),
                    'files': conv.get('files', [])
                }
                formatted_conversations.append(formatted_conv)
            
            return {
                "success": True,
                "conversations": formatted_conversations,
                "total_conversations": total_conversations,
                "returned_count": len(formatted_conversations),
                "pagination_info": {
                    "limit": limit,
                    "include_recent": include_recent,
                    "has_more": total_conversations > limit
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting chat history: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to get chat history: {str(e)}",
                "conversations": []
            }
    
    def search_chat_history(self, session_id: str, user_id: str, search_term: str, limit: int = 5) -> Dict[str, Any]:
        """
        Search chat history for specific terms or topics
        
        Args:
            session_id: Session ID
            user_id: User ID
            search_term: Term to search for in messages
            limit: Maximum number of matching conversations to return
            
        Returns:
            Dictionary with matching conversations
        """
        try:
            logger.info(f"Searching chat history for '{search_term}' in session {session_id}")
            
            # Get full chat history first
            history_result = self.get_chat_history(session_id, user_id, limit=100, include_recent=True)
            
            if not history_result["success"]:
                return history_result
            
            # Search through conversations
            search_term_lower = search_term.lower()
            matching_conversations = []
            
            for conv in history_result["conversations"]:
                user_msg = conv['user_message'].lower()
                agent_msg = conv['agent_response'].lower()
                
                if search_term_lower in user_msg or search_term_lower in agent_msg:
                    matching_conversations.append(conv)
                    
                    if len(matching_conversations) >= limit:
                        break
            
            return {
                "success": True,
                "search_term": search_term,
                "matching_conversations": matching_conversations,
                "total_matches": len(matching_conversations),
                "total_searched": len(history_result["conversations"])
            }
            
        except Exception as e:
            logger.error(f"Error searching chat history: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to search chat history: {str(e)}",
                "matching_conversations": []
            }

# Global instance
chat_history_access = ChatHistoryAccess()

@tool
def get_chat_history_tool(session_id: str, user_id: str, limit: int = 10, include_recent: bool = True) -> str:
    """
    Get chat history for a session with smart pagination. Use this when you need to reference previous conversations.
    
    Args:
        session_id: Session ID (provided in Session Context)
        user_id: User ID (provided in Session Context)
        limit: Maximum number of conversations to return (default: 10, max: 50)
        include_recent: If True, returns most recent conversations; if False, returns oldest conversations
    
    Returns:
        JSON string with chat history and metadata
    """
    try:
        # Validate inputs
        if not session_id or not user_id:
            return json.dumps({
                "success": False,
                "error": "session_id and user_id are required"
            })
        
        # Limit the maximum to prevent excessive data
        limit = min(limit, 50)
        
        # Get chat history
        result = chat_history_access.get_chat_history(session_id, user_id, limit, include_recent)
        
        return json.dumps(result, default=str)
        
    except Exception as e:
        logger.error(f"Error in get_chat_history_tool: {str(e)}")
        return json.dumps({
            "success": False,
            "error": f"Tool error: {str(e)}"
        })

@tool
def search_chat_history_tool(session_id: str, user_id: str, search_term: str, limit: int = 5) -> str:
    """
    Search chat history for specific terms or topics. Use this when users ask about specific previous conversations.
    
    Args:
        session_id: Session ID (provided in Session Context)
        user_id: User ID (provided in Session Context)
        search_term: Term to search for in messages (e.g., "AAPL", "portfolio", "chart")
        limit: Maximum number of matching conversations to return (default: 5, max: 20)
    
    Returns:
        JSON string with matching conversations
    """
    try:
        # Validate inputs
        if not session_id or not user_id or not search_term:
            return json.dumps({
                "success": False,
                "error": "session_id, user_id, and search_term are required"
            })
        
        # Limit the maximum to prevent excessive data
        limit = min(limit, 20)
        
        # Search chat history
        result = chat_history_access.search_chat_history(session_id, user_id, search_term, limit)
        
        return json.dumps(result, default=str)
        
    except Exception as e:
        logger.error(f"Error in search_chat_history_tool: {str(e)}")
        return json.dumps({
            "success": False,
            "error": f"Tool error: {str(e)}"
        })
