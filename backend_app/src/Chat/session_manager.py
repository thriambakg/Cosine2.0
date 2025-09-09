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
        self.sessions_table_name = os.environ.get('SESSIONS_TABLE_NAME')
        self.session_context_table_name = os.environ.get('SESSION_CONTEXT_TABLE_NAME')
        self.session_archives_bucket = os.environ.get('SESSION_ARCHIVES_BUCKET')
        
        # Initialize tables
        self.sessions_table = self.dynamodb.Table(self.sessions_table_name) if self.sessions_table_name else None
        self.session_context_table = self.dynamodb.Table(self.session_context_table_name) if self.session_context_table_name else None
        
        # Configuration
        self.session_ttl_days = int(os.environ.get('SESSION_TTL_DAYS', '30'))
        self.context_ttl_days = int(os.environ.get('CONTEXT_TTL_DAYS', '7'))
        self.max_context_size = int(os.environ.get('MAX_CONTEXT_SIZE', '100000'))  # 100KB
        
        logger.info(f"SessionManager initialized with tables: {self.sessions_table_name}, {self.session_context_table_name}")
    
    def create_session(self, user_id: str, page_context: Dict[str, Any]) -> str:
        """
        Create a new chat session with initial context
        
        Args:
            user_id: Unique identifier for the user
            page_context: Context from the current webpage
            
        Returns:
            session_id: Unique identifier for the new session
        """
        try:
            session_id = f"session_{user_id}_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            
            # Extract webpage information
            webpage_info = self._extract_webpage_info(page_context)
            
            # Create session record
            session_data = {
                'PK': f"USER#{user_id}",
                'SK': f"SESSION#{session_id}",
                'GSI1PK': f"USER#{user_id}",
                'GSI1SK': f"ACTIVE#{int(time.time())}",
                'GSI2PK': "ACTIVE_SESSIONS",
                'GSI2SK': f"{user_id}#{int(time.time())}",
                'session_id': session_id,
                'user_id': user_id,
                'created_at': int(time.time()),
                'last_activity': int(time.time()),
                'page_url': webpage_info.get('url', ''),
                'page_title': webpage_info.get('title', ''),
                'user_intent': webpage_info.get('user_intent', 'general'),
                'conversation_count': 0,
                'status': 'active',
                'ttl': int(time.time()) + (self.session_ttl_days * 24 * 60 * 60)
            }
            
            # Store session in DynamoDB
            self.sessions_table.put_item(Item=session_data)
            
            # Create initial context
            initial_context = {
                'session_id': session_id,
                'user_id': user_id,
                'webpage_content': webpage_info.get('content', ''),
                'conversation_history': [],
                'session_variables': {
                    'page_type': webpage_info.get('page_type', 'unknown'),
                    'financial_data': webpage_info.get('financial_data', {}),
                    'user_actions': webpage_info.get('user_actions', []),
                    'relevant_tools': webpage_info.get('relevant_tools', [])
                },
                'agent_memory': '',
                'created_at': int(time.time()),
                'last_updated': int(time.time())
            }
            
            # Store initial context
            self._store_session_context(session_id, initial_context)
            
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
            # Validate session ownership
            if not self._validate_session_access(session_id, user_id):
                logger.warning(f"Invalid session access attempt: {session_id} by {user_id}")
                return None
            
            # Get session metadata
            session_response = self.sessions_table.get_item(
                Key={
                    'PK': f"USER#{user_id}",
                    'SK': f"SESSION#{session_id}"
                }
            )
            
            if 'Item' not in session_response:
                logger.warning(f"Session not found: {session_id}")
                return None
            
            session_metadata = session_response['Item']
            
            # Get session context
            context_response = self.session_context_table.get_item(
                Key={
                    'PK': f"SESSION#{session_id}",
                    'SK': "CURRENT_CONTEXT"
                }
            )
            
            if 'Item' not in context_response:
                logger.warning(f"Context not found for session: {session_id}")
                return None
            
            context_data = context_response['Item']
            
            # Combine metadata and context
            session_context = {
                'session_id': session_id,
                'user_id': user_id,
                'metadata': session_metadata,
                'context': context_data,
                'webpage_content': context_data.get('webpage_content', ''),
                'conversation_history': context_data.get('conversation_history', []),
                'session_variables': context_data.get('session_variables', {}),
                'agent_memory': context_data.get('agent_memory', ''),
                'last_updated': context_data.get('last_updated', 0)
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
                             updated_variables: Optional[Dict[str, Any]] = None) -> bool:
        """
        Update session context with new conversation data
        
        Args:
            session_id: Unique identifier for the session
            user_id: User ID for validation
            new_message: User's new message
            agent_response: Agent's response
            updated_variables: Updated session variables
            
        Returns:
            success: True if update was successful
        """
        try:
            # Validate session access
            if not self._validate_session_access(session_id, user_id):
                return False
            
            # Get current context
            current_context = self.get_session_context(session_id, user_id)
            if not current_context:
                return False
            
            # Update conversation history
            conversation_history = current_context['conversation_history']
            conversation_history.append({
                'timestamp': int(time.time()),
                'user_message': new_message,
                'agent_response': agent_response
            })
            
            # Keep only last 50 messages to manage size
            if len(conversation_history) > 50:
                conversation_history = conversation_history[-50:]
            
            # Update session variables
            session_variables = current_context['session_variables']
            if updated_variables:
                session_variables.update(updated_variables)
            
            # Create updated context
            updated_context = {
                'PK': f"SESSION#{session_id}",
                'SK': "CURRENT_CONTEXT",
                'GSI1PK': f"SESSION#{session_id}",
                'GSI1SK': f"CONTEXT#{int(time.time())}",
                'session_id': session_id,
                'user_id': user_id,
                'webpage_content': current_context['webpage_content'],
                'conversation_history': conversation_history,
                'session_variables': session_variables,
                'agent_memory': current_context['agent_memory'],
                'last_updated': int(time.time()),
                'ttl': int(time.time()) + (self.context_ttl_days * 24 * 60 * 60)
            }
            
            # Store updated context
            self.session_context_table.put_item(Item=updated_context)
            
            # Update session metadata
            self.sessions_table.update_item(
                Key={
                    'PK': f"USER#{user_id}",
                    'SK': f"SESSION#{session_id}"
                },
                UpdateExpression="SET conversation_count = conversation_count + :inc, last_activity = :activity",
                ExpressionAttributeValues={
                    ':inc': 1,
                    ':activity': int(time.time())
                }
            )
            
            logger.info(f"Updated context for session {session_id}")
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
            response = self.sessions_table.query(
                IndexName='UserSessionsIndex',
                KeyConditionExpression='GSI1PK = :user_id',
                ExpressionAttributeValues={
                    ':user_id': f"USER#{user_id}"
                },
                ScanIndexForward=False,  # Most recent first
                Limit=limit
            )
            
            sessions = []
            for item in response.get('Items', []):
                sessions.append({
                    'session_id': item['session_id'],
                    'created_at': item['created_at'],
                    'last_activity': item['last_activity'],
                    'page_url': item.get('page_url', ''),
                    'page_title': item.get('page_title', ''),
                    'user_intent': item.get('user_intent', 'general'),
                    'conversation_count': item.get('conversation_count', 0),
                    'status': item.get('status', 'active')
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
            
            # Create archive data
            archive_data = {
                'session_id': session_id,
                'user_id': user_id,
                'archived_at': int(time.time()),
                'session_metadata': session_context['metadata'],
                'context': session_context['context'],
                'conversation_history': session_context['conversation_history'],
                'session_variables': session_context['session_variables']
            }
            
            # Store in S3
            archive_key = f"archives/{user_id}/{session_id}/session_data.json"
            self.s3_client.put_object(
                Bucket=self.session_archives_bucket,
                Key=archive_key,
                Body=json.dumps(archive_data, indent=2),
                ContentType='application/json'
            )
            
            # Mark session as archived
            self.sessions_table.update_item(
                Key={
                    'PK': f"USER#{user_id}",
                    'SK': f"SESSION#{session_id}"
                },
                UpdateExpression="SET #status = :status, archived_at = :archived_at",
                ExpressionAttributeNames={
                    '#status': 'status'
                },
                ExpressionAttributeValues={
                    ':status': 'archived',
                    ':archived_at': int(time.time())
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
            response = self.sessions_table.get_item(
                Key={
                    'PK': f"USER#{user_id}",
                    'SK': f"SESSION#{session_id}"
                }
            )
            
            return 'Item' in response and response['Item'].get('status') == 'active'
            
        except Exception as e:
            logger.error(f"Error validating session access: {str(e)}")
            return False
    
    def _update_session_activity(self, session_id: str, user_id: str) -> None:
        """Update last activity timestamp for session"""
        try:
            self.sessions_table.update_item(
                Key={
                    'PK': f"USER#{user_id}",
                    'SK': f"SESSION#{session_id}"
                },
                UpdateExpression="SET last_activity = :activity",
                ExpressionAttributeValues={
                    ':activity': int(time.time())
                }
            )
        except Exception as e:
            logger.error(f"Error updating session activity: {str(e)}")
    
    def _store_session_context(self, session_id: str, context: Dict[str, Any]) -> None:
        """Store session context in DynamoDB"""
        try:
            context_item = {
                'PK': f"SESSION#{session_id}",
                'SK': "CURRENT_CONTEXT",
                'GSI1PK': f"SESSION#{session_id}",
                'GSI1SK': f"CONTEXT#{int(time.time())}",
                **context,
                'ttl': int(time.time()) + (self.context_ttl_days * 24 * 60 * 60)
            }
            
            self.session_context_table.put_item(Item=context_item)
            
        except Exception as e:
            logger.error(f"Error storing session context: {str(e)}")
            raise

# Global session manager instance
session_manager = SessionManager()
