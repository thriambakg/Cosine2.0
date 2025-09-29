"""
Session Management Module for Multi-Session Context Management
Handles session creation, context isolation, and persistent storage
"""

import json
import os
import logging
import uuid
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger(__name__)

class SessionManager:
    """
    Manages multi-session context for chat agents
    Provides session isolation, context persistence, and webpage integration
    """
    
    def __init__(self):
        """Initialize the session manager with AWS resources"""
        self.dynamodb = boto3.resource('dynamodb')
        self.s3_client = boto3.client('s3')
        
        # Get table names from environment variables
        self.chat_sessions_table_name = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
        self.session_archives_bucket = os.environ.get('SESSION_ARCHIVES_BUCKET')
        
        # Initialize tables
        self.chat_sessions_table = self.dynamodb.Table(self.chat_sessions_table_name) if self.chat_sessions_table_name else None
        
        # Configuration
        self.session_ttl_days = int(os.environ.get('SESSION_TTL_DAYS', '30'))
        self.context_ttl_days = int(os.environ.get('CONTEXT_TTL_DAYS', '7'))
        self.max_context_size = int(os.environ.get('MAX_CONTEXT_SIZE', '100000'))  # 100KB
        
        logger.info(f"SessionManager initialized with table: {self.chat_sessions_table_name}")
    
    def create_session(self, user_id: str, page_context: Dict[str, Any], model: str = 'claude-3-sonnet') -> str:
        """
        Create a new chat session with initial context
        
        Args:
            user_id: Unique identifier for the user
            page_context: Context from the current webpage
            model: Initial model for the session
            
        Returns:
            session_id: Unique identifier for the new session
        """
        try:
            session_id = str(uuid.uuid4())
            timestamp = int(time.time())
            
            # Extract webpage information
            webpage_info = self._extract_webpage_info(page_context)
            
            # Create session metadata
            metadata_item = {
                'user_id': user_id,
                'session_id': session_id,
                'timestamp': timestamp,
                'title': f'Chat {datetime.now().strftime("%m/%d %H:%M")}',
                'model': model,
                'created_at': timestamp,
                'last_updated': timestamp,
                'message_count': 0,
                'page_url': webpage_info.get('url', ''),
                'page_title': webpage_info.get('title', ''),
                'user_intent': webpage_info.get('user_intent', 'general'),
                'session_variables': {
                    'page_type': webpage_info.get('page_type', 'unknown'),
                    'financial_data': webpage_info.get('financial_data', {}),
                    'user_actions': webpage_info.get('user_actions', []),
                    'relevant_tools': webpage_info.get('relevant_tools', [])
                },
                'expires_at': int(time.time()) + (self.session_ttl_days * 24 * 60 * 60)
            }
            
            # Store session metadata
            self.chat_sessions_table.put_item(Item=metadata_item)
            
            logger.info(f"Created new session {session_id} for user {user_id}")
            return session_id
            
        except Exception as e:
            logger.error(f"Error creating session: {str(e)}")
            raise
    
    def get_session_context(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve session context with validation
        
        Args:
            session_id: Unique identifier for the session
            user_id: User ID for validation
            
        Returns:
            session_context: Complete session context or None if not found
        """
        try:
            # Get complete session data using new schema
            session_response = self.chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' not in session_response:
                logger.warning(f"Session not found: {session_id}")
                return None
            
            session_item = session_response['Item']
            
            # Validate user ownership (already done by the key structure)
            if session_item.get('user_id') != user_id:
                logger.warning(f"Invalid session access attempt: {session_id} by {user_id}")
                return None
            
            # Build conversation history from messages array
            conversation_history = []
            messages = session_item.get('messages', [])
            
            logger.info(f"🔍 DEBUG: Building conversation history from {len(messages)} messages")
            for i, message in enumerate(messages):
                logger.info(f"🔍 DEBUG: Message {i+1}: sender={message.get('sender')}, text='{message.get('text', '')[:100]}...'")
            
            for message in messages:
                if message.get('sender') == 'user':
                    conversation_history.append({
                        'timestamp': message['timestamp'],
                        'user_message': message.get('text', ''),
                        'agent_response': ''
                    })
                    logger.info(f"🔍 DEBUG: Added user message to conversation history: '{message.get('text', '')[:100]}...'")
                elif message.get('sender') == 'bot':
                    # Add to the last conversation entry or create new one
                    if conversation_history and conversation_history[-1]['agent_response'] == '':
                        conversation_history[-1]['agent_response'] = message.get('text', '')
                        logger.info(f"🔍 DEBUG: Paired bot response with last user message: '{message.get('text', '')[:100]}...'")
                    else:
                        conversation_history.append({
                            'timestamp': message['timestamp'],
                            'user_message': '',
                            'agent_response': message.get('text', '')
                        })
                        logger.info(f"🔍 DEBUG: Added standalone bot response to conversation history: '{message.get('text', '')[:100]}...'")
            
            logger.info(f"🔍 DEBUG: Final conversation history has {len(conversation_history)} entries")
            for i, conv in enumerate(conversation_history):
                logger.info(f"🔍 DEBUG: Conversation {i+1}: user='{conv['user_message'][:50]}...', bot='{conv['agent_response'][:50]}...'")
            
            # Combine metadata and context
            session_context = {
                'session_id': session_id,
                'user_id': user_id,
                'metadata': session_item,
                'webpage_content': session_item.get('page_url', ''),
                'conversation_history': conversation_history,
                'session_variables': session_item.get('session_variables', {}),
                'agent_memory': '',  # Will be populated by agent
                'last_updated': session_item.get('last_updated', 0)
            }
            
            # Update last activity
            self._update_session_activity(session_id, user_id)
            
            logger.info(f"Retrieved context for session {session_id}")
            return session_context
            
        except Exception as e:
            logger.error(f"Error retrieving session context: {str(e)}")
            return None
    
    def update_session_context(self, session_id: str, user_id: str, 
                             new_message: str, agent_response: str,
                             updated_variables: Optional[Dict[str, Any]] = None,
                             model: Optional[str] = None) -> bool:
        """
        Update session context with new conversation data
        
        Args:
            session_id: Unique identifier for the session
            user_id: User ID for validation
            new_message: User's new message
            agent_response: Agent's response
            updated_variables: Updated session variables
            model: Model used to process the message
            
        Returns:
            success: True if update was successful
        """
        try:
            logger.info(f"🔍 DEBUG: update_session_context called for session {session_id}, user {user_id}")
            
            # Validate session access
            if not self._validate_session_access(session_id, user_id):
                logger.error(f"❌ Session validation failed for session {session_id}, user {user_id}")
                return False
            
            logger.info(f"✅ Session validation passed for session {session_id}")
            timestamp = int(time.time())
            
            # Get current session
            response = self.chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            logger.info(f"🔍 DEBUG: Session get_item response: {'Item' in response}")
            if 'Item' not in response:
                logger.error(f"❌ Session {session_id} not found for user {user_id}")
                return False
            
            logger.info(f"✅ Session {session_id} found for user {user_id}")
            
            session_item = response['Item']
            messages = session_item.get('messages', [])
            
            # Add user message
            if new_message:
                user_message = {
                    'id': f'msg_{timestamp}_{uuid.uuid4().hex[:8]}',
                    'text': new_message,
                    'sender': 'user',
                    'timestamp': timestamp,
                    'message_type': 'text'
                }
                messages.append(user_message)
                logger.info(f"✅ Added user message: {user_message['id']}")
            
            # Add agent response
            if agent_response:
                agent_message = {
                    'id': f'msg_{timestamp + 1}_{uuid.uuid4().hex[:8]}',
                    'text': agent_response,
                    'sender': 'bot',
                    'timestamp': timestamp + 1,
                    'message_type': 'text',
                    'model': model or 'claude-3-sonnet'  # Include model information
                }
                messages.append(agent_message)
                logger.info(f"✅ Added agent message: {agent_message['id']} with model: {model}")
            
            logger.info(f"🔍 DEBUG: Total messages after adding: {len(messages)}")
            
            # Update session with new messages
            update_expression_parts = ['SET messages = :messages, message_count = :count, last_updated = :timestamp']
            expression_attribute_values = {
                ':messages': messages,
                ':count': len(messages),
                ':timestamp': timestamp
            }
            
            # Update session variables if provided
            if updated_variables:
                update_expression_parts.append('session_variables = :vars')
                expression_attribute_values[':vars'] = updated_variables
            
            logger.info(f"🔍 DEBUG: Updating DynamoDB with {len(messages)} messages")
            self.chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression=' '.join(update_expression_parts),
                ExpressionAttributeValues=expression_attribute_values
            )
            
            logger.info(f"✅ Successfully updated context for session {session_id} with {len(messages)} messages")
            return True
            
        except Exception as e:
            logger.error(f"Error updating session context: {str(e)}")
            return False
    
    def get_user_sessions(self, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get list of user's active sessions
        
        Args:
            user_id: User identifier
            limit: Maximum number of sessions to return
            
        Returns:
            sessions: List of session metadata
        """
        try:
            response = self.chat_sessions_table.query(
                IndexName='CreatedAtIndex',
                KeyConditionExpression='user_id = :user_id',
                ExpressionAttributeValues={
                    ':user_id': user_id
                },
                ScanIndexForward=False,  # Most recent first
                Limit=limit
            )
            
            sessions = []
            for item in response.get('Items', []):
                sessions.append({
                    'session_id': item['session_id'],
                    'created_at': item['created_at'],
                    'last_updated': item['last_updated'],
                    'title': item.get('title', f'Chat {item["session_id"][:8]}'),
                    'model': item.get('model', 'claude-3-sonnet'),
                    'message_count': item.get('message_count', 0),
                    'page_url': item.get('page_url', ''),
                    'page_title': item.get('page_title', ''),
                    'user_intent': item.get('user_intent', 'general')
                })
            
            return sessions
            
        except Exception as e:
            logger.error(f"Error retrieving user sessions: {str(e)}")
            return []
    
    def archive_session(self, session_id: str, user_id: str) -> bool:
        """
        Archive a session to S3 for long-term storage
        
        Args:
            session_id: Session identifier
            user_id: User identifier
            
        Returns:
            success: True if archiving was successful
        """
        try:
            # Get complete session data
            session_context = self.get_session_context(session_id, user_id)
            if not session_context:
                return False
            
            # Get all messages for the session
            messages_response = self.chat_sessions_table.query(
                KeyConditionExpression='session_id = :session_id',
                ExpressionAttributeValues={':session_id': session_id}
            )
            
            # Create archive data
            archive_data = {
                'session_id': session_id,
                'user_id': user_id,
                'archived_at': int(time.time()),
                'session_metadata': session_context['metadata'],
                'conversation_history': session_context['conversation_history'],
                'session_variables': session_context['session_variables'],
                'all_messages': messages_response.get('Items', [])
            }
            
            # Store in S3 if bucket is configured
            if self.session_archives_bucket:
                archive_key = f"archives/{user_id}/{session_id}/session_data.json"
                self.s3_client.put_object(
                    Bucket=self.session_archives_bucket,
                    Key=archive_key,
                    Body=json.dumps(archive_data, indent=2),
                    ContentType='application/json'
                )
            
            # Delete session from DynamoDB
            with self.chat_sessions_table.batch_writer() as batch:
                for item in messages_response['Items']:
                    batch.delete_item(
                        Key={
                            'session_id': item['session_id'],
                            'message_id': item['message_id']
                        }
                    )
            
            logger.info(f"Archived session {session_id} for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error archiving session: {str(e)}")
            return False
    
    def _extract_webpage_info(self, page_context: Dict[str, Any]) -> Dict[str, Any]:
        """Extract relevant information from webpage context"""
        return {
            'url': page_context.get('url', ''),
            'title': page_context.get('title', ''),
            'content': page_context.get('content', ''),
            'page_type': self._detect_page_type(page_context),
            'user_intent': self._detect_user_intent(page_context),
            'financial_data': self._extract_financial_data(page_context),
            'user_actions': page_context.get('user_actions', []),
            'relevant_tools': self._get_relevant_tools(page_context)
        }
    
    def _detect_page_type(self, page_context: Dict[str, Any]) -> str:
        """Detect the type of page based on content and URL"""
        url = page_context.get('url', '').lower()
        content = page_context.get('content', '').lower()
        
        if 'crypto' in url or 'cryptocurrency' in content:
            return 'crypto'
        elif 'portfolio' in url or 'portfolio' in content:
            return 'portfolio'
        elif 'stocks' in url or 'stock' in content:
            return 'stocks'
        elif 'dashboard' in url or 'dashboard' in content:
            return 'dashboard'
        else:
            return 'general'
    
    def _detect_user_intent(self, page_context: Dict[str, Any]) -> str:
        """Detect user intent based on page context"""
        content = page_context.get('content', '').lower()
        
        if 'analyze' in content or 'analysis' in content:
            return 'analysis'
        elif 'buy' in content or 'sell' in content:
            return 'trading'
        elif 'portfolio' in content:
            return 'portfolio_management'
        elif 'crypto' in content:
            return 'crypto_analysis'
        else:
            return 'general_inquiry'
    
    def _extract_financial_data(self, page_context: Dict[str, Any]) -> Dict[str, Any]:
        """Extract financial data from webpage content"""
        # This would be implemented based on your specific webpage structure
        return page_context.get('financial_data', {})
    
    def _get_relevant_tools(self, page_context: Dict[str, Any]) -> List[str]:
        """Get list of relevant tools based on page context"""
        page_type = self._detect_page_type(page_context)
        
        base_tools = ['get_financial_data', 'search_financial_news']
        
        if page_type == 'crypto':
            base_tools.extend(['get_volatility_surface', 'python_financial_calculator'])
        elif page_type == 'portfolio':
            base_tools.extend(['analyze_portfolio', 'calculate_stock_correlation'])
        elif page_type == 'stocks':
            base_tools.extend(['get_technical_analysis', 'get_financial_data'])
        
        return base_tools
    
    def _validate_session_access(self, session_id: str, user_id: str) -> bool:
        """Validate that user has access to the session"""
        try:
            response = self.chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            return 'Item' in response
            
        except Exception as e:
            logger.error(f"Error validating session access: {str(e)}")
            return False
    
    def _update_session_activity(self, session_id: str, user_id: str) -> None:
        """Update last activity timestamp for session"""
        try:
            self.chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression="SET last_updated = :activity",
                ExpressionAttributeValues={
                    ':activity': int(time.time())
                }
            )
        except Exception as e:
            logger.error(f"Error updating session activity: {str(e)}")
    

# Global session manager instance
session_manager = SessionManager()