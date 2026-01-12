"""
WebSocket Handler for Chat Agent
Handles WebSocket message processing, connection management, and direct message delivery
Consolidated from websocket/message_processor for improved performance
"""

import json
import os
import logging
import uuid
import boto3
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Dict, Any, Optional
from boto3.dynamodb.conditions import Key, Attr

# Configure logging
logger = logging.getLogger(__name__)

# Import context builder for enriching messages with context
try:
    from context_builder import build_context_prompt, extract_context_summary
    logger.info("✅ Successfully imported context_builder")
    CONTEXT_BUILDER_AVAILABLE = True
except ImportError as e:
    logger.warning(f"⚠️ Could not import context_builder: {e}")
    CONTEXT_BUILDER_AVAILABLE = False
    # Fallback functions if import fails
    def build_context_prompt(user_message, context_items):
        return user_message
    def extract_context_summary(context_items):
        return {'total_items': len(context_items) if context_items else 0}

# Import kill signal registry for handling kill signals
try:
    from kill_signal_registry import set_kill_flag
    logger.info("✅ Successfully imported kill_signal_registry")
    KILL_SIGNAL_REGISTRY_AVAILABLE = True
except ImportError as e:
    logger.warning(f"⚠️ Could not import kill_signal_registry: {e}")
    KILL_SIGNAL_REGISTRY_AVAILABLE = False
    # Fallback function if import fails
    def set_kill_flag(session_id: str, reason: str = 'user_cancellation'):
        logger.warning(f"Kill signal registry not available, cannot set kill flag for session {session_id}")

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

def json_dumps_safe(obj):
    """JSON dumps with Decimal support for DynamoDB"""
    def decimal_default(obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
    
    return json.dumps(obj, default=decimal_default)

def convert_floats_to_decimal(obj):
    """
    Recursively convert all float values to Decimal for DynamoDB compatibility
    """
    if isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimal(value) for key, value in obj.items()}
    elif isinstance(obj, float):
        # Handle special float values (inf, nan)
        if obj != obj:  # NaN check
            return None
        elif obj == float('inf'):
            return Decimal('999999999')
        elif obj == float('-inf'):
            return Decimal('-999999999')
        else:
            return Decimal(str(obj))
    elif isinstance(obj, int):
        return obj
    else:
        return obj


class WebSocketHandler:
    """
    Handles WebSocket message processing and direct message delivery
    """
    
    def __init__(self):
        # Get WebSocket API Gateway endpoint from environment
        websocket_endpoint = os.environ.get('WEBSOCKET_ENDPOINT')
        if not websocket_endpoint:
            # Fallback: construct from API Gateway ID
            api_gateway_id = os.environ.get('WEBSOCKET_API_ID')
            if api_gateway_id:
                # Get stage name from environment or use default
                stage_name = os.environ.get('WEBSOCKET_STAGE_NAME', 'production')
                region = os.environ.get('AWS_REGION', 'us-east-1')
                websocket_endpoint = f"https://{api_gateway_id}.execute-api.{region}.amazonaws.com/{stage_name}"
            else:
                # Try to discover API ID from API Gateway (for cases where env vars aren't set due to circular dependency)
                try:
                    apigw_client = boto3.client('apigatewayv2')
                    # List WebSocket APIs and find the one for this environment
                    environment = os.environ.get('ENVIRONMENT', 'production')
                    project_name = 'cosine'  # Default, can be overridden
                    api_name = f"{project_name}-websocket-api-{environment}"
                    
                    apis = apigw_client.get_apis()
                    for api in apis.get('Items', []):
                        if api.get('Name') == api_name and api.get('ProtocolType') == 'WEBSOCKET':
                            api_gateway_id = api['ApiId']
                            stage_name = os.environ.get('WEBSOCKET_STAGE_NAME', environment)
                            region = os.environ.get('AWS_REGION', 'us-east-1')
                            websocket_endpoint = f"https://{api_gateway_id}.execute-api.{region}.amazonaws.com/{stage_name}"
                            logger.info(f"Discovered WebSocket API endpoint: {websocket_endpoint}")
                            break
                except Exception as e:
                    logger.warning(f"Failed to discover WebSocket API: {e}")
                    # Try to get from environment variable as last resort
                    websocket_endpoint = os.environ.get('WEBSOCKET_ENDPOINT')
                    if not websocket_endpoint:
                        raise ValueError("WebSocket endpoint could not be discovered and WEBSOCKET_ENDPOINT environment variable is not set")
        
        # Convert wss:// to https:// for the API Gateway Management API
        if websocket_endpoint.startswith('wss://'):
            websocket_endpoint = websocket_endpoint.replace('wss://', 'https://')
        
        self.api_gateway = boto3.client(
            'apigatewaymanagementapi',
            endpoint_url=websocket_endpoint
        )
        
        # DynamoDB tables
        self.chat_connections_table = dynamodb.Table(os.environ['CHAT_CONNECTIONS_TABLE_NAME'])
        self.chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])
    
    def get_connection_info(self, connection_id: str) -> Optional[Dict[str, Any]]:
        """Get connection information from DynamoDB"""
        try:
            response = self.chat_connections_table.get_item(
                Key={'connection_id': connection_id}
            )
            return response.get('Item')
        except Exception as e:
            logger.error(f"Error getting connection info: {str(e)}")
            return None
    
    def update_connection_session(self, connection_id: str, session_id: str):
        """Update connection record with session ID"""
        try:
            self.chat_connections_table.update_item(
                Key={'connection_id': connection_id},
                UpdateExpression='SET session_id = :session_id',
                ExpressionAttributeValues={':session_id': session_id}
            )
            logger.info(f"Updated connection {connection_id} with session_id {session_id}")
        except Exception as e:
            logger.error(f"Error updating connection session: {str(e)}")
    
    def get_active_connections_for_user_session(self, user_id: str, session_id: str) -> List[str]:
        """Get active WebSocket connections for a specific user and session"""
        try:
            current_time = int(datetime.now().timestamp())
            
            # Query connections for this user and session
            response = self.chat_connections_table.query(
                IndexName='UserConnectionsIndex',
                KeyConditionExpression=Key('user_id').eq(user_id),
                FilterExpression=Attr('session_id').eq(session_id) & Attr('expires_at').gt(current_time)
            )
            
            connection_ids = [item['connection_id'] for item in response['Items']]
            
            return connection_ids
        except Exception as e:
            logger.error(f"Failed to get active connections: {str(e)}")
            return []
    
    def send_to_client(self, connection_id: str, message: Dict[str, Any]) -> bool:
        """Send message to WebSocket client"""
        try:
            self.api_gateway.post_to_connection(
                ConnectionId=connection_id,
                Data=json_dumps_safe(message)
            )
            return True
        except Exception as e:
            if 'GoneException' in str(e) or 'gone' in str(e).lower():
                logger.warning(f"Connection {connection_id} was closed")
            else:
                logger.error(f"Error sending to connection {connection_id}: {str(e)}")
            return False
    
    def send_agent_log(self, user_id: str, session_id: str, log_message: Dict[str, Any]):
        """
        Send agent log directly to WebSocket connections.
        Called directly from agent_logger (no SQS queue needed!)
        """
        try:
            # Get active connections for this user/session
            connection_ids = self.get_active_connections_for_user_session(user_id, session_id)
            
            if not connection_ids:
                # No active connections - log silently (not an error)
                return
            
            # Send to all active connections
            for connection_id in connection_ids:
                try:
                    self.send_to_client(connection_id, log_message)
                except Exception as e:
                    logger.warning(f"Failed to send agent log to connection {connection_id}: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Error sending agent log: {str(e)}")
    
    def send_chat_response(self, user_id: str, session_id: str, response_content: str, message_id: Optional[str] = None, is_streaming: bool = False, is_complete: bool = True):
        """
        Send chat response directly to WebSocket connections.
        Supports both streaming chunks and complete responses.
        Called directly from chat agent (no SQS queue needed!)
        
        Args:
            user_id: User ID
            session_id: Session ID
            response_content: Response content (full response or chunk)
            message_id: Message ID (generated if not provided)
            is_streaming: If True, sends as streaming chunk; if False, sends as complete response
            is_complete: If True, marks this as the final chunk (only used when is_streaming=True)
        """
        try:
            # CRITICAL: Check kill flag before sending any chunks or response
            # This prevents sending chunks after kill signal has been detected
            try:
                from kill_signal_registry import is_killed
                if is_killed(session_id, user_id):
                    logger.warning(f"🔴 KILL SIGNAL: Kill flag detected in send_chat_response, aborting send for session {session_id}")
                    # Don't send anything if kill flag is set
                    return
            except Exception as kill_check_error:
                logger.error(f"Error checking kill flag before sending response: {str(kill_check_error)}")
                # Continue with send if we can't check (better to send than to lose response)
            
            # Get active connections
            connection_ids = self.get_active_connections_for_user_session(user_id, session_id)
            
            if not connection_ids:
                logger.info(f"No active connections for user {user_id}, session {session_id}")
                return
            
            # Generate message ID if not provided
            if not message_id:
                message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
            
            # Use milliseconds timestamp (number) instead of ISO string for frontend compatibility
            timestamp_ms = int(datetime.now().timestamp() * 1000)
            
            if is_streaming:
                # Send streaming chunk
                ai_response_chunk = {
                    'type': 'ai_response_chunk',
                    'message_id': message_id,
                    'content': response_content,  # This is just the chunk, not the full response
                    'session_id': session_id,
                    'timestamp': timestamp_ms,
                    'is_complete': is_complete
                }
                
                # Send to all active connections
                for connection_id in connection_ids:
                    try:
                        self.send_to_client(connection_id, ai_response_chunk)
                    except Exception as e:
                        logger.warning(f"Failed to send streaming chunk to connection {connection_id}: {str(e)}")
            else:
                # Send complete response (backward compatibility)
                ai_response_message = {
                    'type': 'ai_response',
                    'message_id': message_id,
                    'content': response_content,
                    'session_id': session_id,
                    'timestamp': timestamp_ms
                }
                
                # Send to all active connections
                for connection_id in connection_ids:
                    try:
                        self.send_to_client(connection_id, ai_response_message)
                        logger.info(f"✅ Sent chat response to connection {connection_id}")
                    except Exception as e:
                        logger.warning(f"Failed to send response to connection {connection_id}: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Error sending chat response: {str(e)}")
    
    def process_websocket_message(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process WebSocket message from API Gateway
        
        Args:
            event: WebSocket API Gateway event
            
        Returns:
            API Gateway response
        """
        try:
            # Extract connection ID from request context
            connection_id = event.get('requestContext', {}).get('connectionId')
            if not connection_id:
                logger.error("No connection ID found in request context")
                return {
                    'statusCode': 400,
                    'body': json_dumps_safe({'error': 'No connection ID'})
                }
            
            # Get user ID from connection info
            connection_info = self.get_connection_info(connection_id)
            if not connection_info:
                logger.error(f"Connection {connection_id} not found")
                return {
                    'statusCode': 400,
                    'body': json_dumps_safe({'error': 'Connection not found'})
                }
            
            user_id = connection_info['user_id']
            
            # Extract message body and parse it
            body = event.get('body', '{}')
            if isinstance(body, str):
                message_data = json.loads(body)
            else:
                message_data = body
            
            # Get session_id and message type from message data
            session_id = message_data.get('sessionId')
            message_type = message_data.get('type', 'chat')
            logger.info(f"Processing WebSocket message: type={message_type}, sessionId={session_id}")

            # Handle kill signal - set kill flag in registry and terminate Lambda invocation
            if message_type == 'kill_signal':
                reason = message_data.get('reason', 'user_cancellation')
                logger.warning(f"🔴 KILL SIGNAL: Received kill signal for session {session_id}, reason: {reason}")
                
                # CRITICAL: Set kill flag in shared registry so ongoing agent processing can detect it
                # Use DynamoDB with composite key (user_id, session_id) and dedicated 'kill' column
                if session_id and user_id and KILL_SIGNAL_REGISTRY_AVAILABLE:
                    try:
                        from kill_signal_registry import set_kill_flag
                        set_kill_flag(session_id, user_id, reason)
                        logger.info(f"✅ KILL SIGNAL: Set kill flag in DynamoDB for session {session_id} (user: {user_id})")
                    except Exception as e:
                        logger.error(f"❌ Failed to set kill flag in DynamoDB: {str(e)}")
                elif session_id:
                    logger.warning(f"⚠️ KILL SIGNAL: Missing session_id or user_id, or kill signal registry not available. Session: {session_id}, User: {user_id}")
                
                return {
                    'statusCode': 200,
                    'body': json_dumps_safe({'message': 'Kill signal received, terminating'})
                }
            
            # Session ID is required for all message types except connection_establish
            if not session_id and message_type != 'connection_establish':
                logger.error(f"No sessionId provided in message data")
                return {
                    'statusCode': 400,
                    'body': json_dumps_safe({'error': 'Session ID required'})
                }
            
            # Update connection record with session_id
            if session_id and ('session_id' not in connection_info or not connection_info.get('session_id')):
                self.update_connection_session(connection_id, session_id)
            
            # Process the WebSocket message
            return self._process_message(connection_id, user_id, session_id, message_data)
            
        except Exception as e:
            logger.error(f"Error in process_websocket_message: {str(e)}")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': 'Internal server error'})
            }
    
    def _process_message(self, connection_id: str, user_id: str, session_id: str, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process incoming chat message
        
        Args:
            connection_id: WebSocket connection ID
            user_id: User ID
            session_id: Session ID
            message_data: Message data from client
            
        Returns:
            API Gateway response
        """
        try:
            message_type = message_data.get('type', 'chat')
            message_text = message_data.get('message', '')
            model = message_data.get('model', 'claude-sonnet-4')
            files = message_data.get('files', [])
            
            # Use message ID from frontend if provided, otherwise generate one
            frontend_message_id = message_data.get('messageId')
            message_id = frontend_message_id or f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
            
            logger.info(f"Processing message type: {message_type} for connection {connection_id}")
            logger.info(f"Using message_id: {message_id}")
            
            # Handle connection establishment message
            if message_type == 'connection_establish':
                connection_message = {
                    'type': 'connection_established',
                    'session_id': session_id,
                    'message': 'Connected to Cosine AI Chat',
                    'timestamp': datetime.now().isoformat()
                }
                self.send_to_client(connection_id, connection_message)
                return {
                    'statusCode': 200,
                    'body': json_dumps_safe({'message': 'Connection established'})
                }
            
            # Handle message editing
            if message_type == 'edit_message':
                return self._handle_edit_message(connection_id, user_id, session_id, message_data)
            
            # Check if this is the first message (welcome message)
            is_first_message = message_data.get('is_first_message', False)
            if is_first_message:
                welcome_message = {
                    'type': 'connection_established',
                    'session_id': session_id,
                    'message': 'Connected to Cosine AI Chat',
                    'timestamp': datetime.now().isoformat()
                }
                self.send_to_client(connection_id, welcome_message)
            
            # Check if session exists, create if needed
            if not self._check_session_exists(user_id, session_id):
                logger.info(f"Session {session_id} doesn't exist, creating it")
                self._create_session_for_first_message(user_id, session_id, model)
            
            # Extract context items and check for file attachment flag
            context_items = message_data.get('contextItems', [])
            
            # Log context items to verify data field is present
            if context_items:
                logger.info(f"📥 Received {len(context_items)} context items from WebSocket message")
                for i, item in enumerate(context_items):
                    logger.info(f"  Context item {i+1}: id={item.get('id')}, type={item.get('type')}, title={item.get('title')}")
                    if 'data' in item and item.get('data'):
                        logger.info(f"    ✅ data field present: {json.dumps(item.get('data'), default=str)}")
                    else:
                        logger.warning(f"    ⚠️ data field missing or empty in context item {i+1}")
            
            session_variables_updated = message_data.get('session_variables_updated', False)
            
            # Check if message has files attached (files were uploaded via REST API)
            has_files_flag = message_data.get('hasFiles', False)
            uploaded_files_metadata = message_data.get('uploadedFiles', [])  # File metadata from frontend for display
            
            # If hasFiles flag is set, get files from session_variables (uploaded via REST API)
            uploaded_files = []
            if has_files_flag:
                logger.info(f"Message has files attached (uploaded via REST API), retrieving from session_variables")
                try:
                    session_response = self.chat_sessions_table.get_item(
                        Key={'user_id': user_id, 'session_id': session_id}
                    )
                    if 'Item' in session_response:
                        session_vars = session_response['Item'].get('session_variables', {})
                        uploaded_files_from_session = session_vars.get('uploaded_files', [])
                        if uploaded_files_from_session:
                            # Use files from session_variables (already uploaded to S3)
                            uploaded_files = uploaded_files_from_session
                            logger.info(f"Retrieved {len(uploaded_files)} files from session_variables")
                        else:
                            logger.warning(f"hasFiles flag set but no files found in session_variables")
                except Exception as e:
                    logger.error(f"Error retrieving files from session_variables: {str(e)}")
            
            # Save user message to database with file metadata for display
            # Use uploadedFiles metadata from WebSocket message (has display info like name, size, type)
            files_for_display = uploaded_files_metadata if has_files_flag else files
            self._save_user_message(user_id, session_id, message_id, message_text, files_for_display)
            
            # Send acknowledgment
            ack_message = {
                'type': 'message_received',
                'message_id': message_id,
                'session_id': session_id,  # Include session_id for proper routing
                'timestamp': datetime.now().isoformat()
            }
            self.send_to_client(connection_id, ack_message)
            
            # Handle session variables update notification
            if session_variables_updated:
                self._send_session_update(user_id, session_id)
            
            # Process context and files
            has_context = len(context_items) > 0
            has_files = len(uploaded_files) > 0
            original_user_message = message_text
            
            if has_context or has_files:
                logger.info(f"Context-aware message: {len(context_items)} context items, {len(uploaded_files)} uploaded files")
                
                # Store context items in session_variables
                if has_context and CONTEXT_BUILDER_AVAILABLE:
                    self._store_context_items(user_id, session_id, context_items)
                
                # Use clean message for AI (let tools handle file access)
                message_text = original_user_message
            
            # Determine if new context items were added
            has_new_context_items = has_context and CONTEXT_BUILDER_AVAILABLE and len(context_items) > 0
            
            # Process with chat agent directly (in same container, no Lambda invoke!)
            # Import here to avoid circular dependencies
            from lambda_handler import handle_chat_message
            
            # Prepare event body for chat handler
            # If hasFiles flag is set, use files from session_variables (already uploaded)
            # Otherwise use files from WebSocket message (legacy support)
            files_for_handler = uploaded_files if has_files_flag and uploaded_files else files
            
            event_body = {
                'action': 'chat',
                'message': message_text,
                'userId': user_id,
                'sessionId': session_id,
                'model': model,
                'files': files_for_handler,
                'contextItems': context_items if has_context else None,
                'originalMessage': original_user_message if (has_context or has_files) else None,
                'uploadedFiles': uploaded_files if has_files else None,
                'hasNewContextItems': has_new_context_items,
                'messageId': message_id
            }
            
            # Call chat handler directly (no Lambda invocation!)
            # Note: handle_chat_message will send the response directly via WebSocket
            # so we don't need to send it again here
            try:
                result = handle_chat_message(event_body, None)
                
                # Log the result for debugging
                if result is None:
                    logger.warning(f"Chat handler returned None - this should not happen")
                    # Send error message if handler failed
                    error_timestamp_ms = int(datetime.now().timestamp() * 1000)
                    error_message = {
                        'type': 'ai_response',
                        'message_id': f"msg_{error_timestamp_ms}_{uuid.uuid4().hex[:8]}",
                        'content': "I apologize, but I encountered an error processing your request. Please try again.",
                        'session_id': session_id,
                        'timestamp': error_timestamp_ms
                    }
                    self.send_to_client(connection_id, error_message)
                elif result.get('statusCode') != 200:
                    logger.warning(f"Chat handler returned non-200 status: {result.get('statusCode')}")
                    # Send error message if handler failed
                    error_timestamp_ms = int(datetime.now().timestamp() * 1000)
                    error_message = {
                        'type': 'ai_response',
                        'message_id': f"msg_{error_timestamp_ms}_{uuid.uuid4().hex[:8]}",
                        'content': "I apologize, but I encountered an error processing your request. Please try again.",
                        'session_id': session_id,
                        'timestamp': error_timestamp_ms
                    }
                    self.send_to_client(connection_id, error_message)
                else:
                    logger.info(f"✅ Chat handler processed message successfully, response sent via WebSocket")
                
            except Exception as e:
                logger.error(f"Error processing with chat agent: {str(e)}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
                # Send error message to client
                error_timestamp_ms = int(datetime.now().timestamp() * 1000)
                error_message = {
                    'type': 'ai_response',
                    'message_id': f"msg_{error_timestamp_ms}_{uuid.uuid4().hex[:8]}",
                    'content': "I apologize, but I encountered an error processing your request. Please try again.",
                    'session_id': session_id,
                    'timestamp': error_timestamp_ms
                }
                self.send_to_client(connection_id, error_message)
            
            return {
                'statusCode': 200,
                'body': json_dumps_safe({'message': 'Message processed successfully'})
            }
            
        except Exception as e:
            logger.error(f"Error processing message: {str(e)}")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': 'Failed to process message'})
            }
    
    def process_file_upload_message(self, user_id: str, session_id: str, message: Dict[str, Any], 
                                   uploaded_files: List[Dict[str, Any]], context_items: List[Dict[str, Any]], 
                                   model: str) -> Dict[str, Any]:
        """
        Process message with uploaded files - called directly from file upload handler
        No Lambda invocation needed!
        """
        try:
            # Get active connections
            connection_ids = self.get_active_connections_for_user_session(user_id, session_id)
            
            # Update connections with session_id if needed
            if connection_ids:
                for conn_id in connection_ids:
                    self.update_connection_session(conn_id, session_id)
            
            # Save user message
            message_id = message.get('id') or f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
            self._save_user_message(user_id, session_id, message_id, message.get('text', ''), [])
            
            # Process with chat agent directly
            from lambda_handler import handle_chat_message
            
            event_body = {
                'action': 'chat',
                'message': message.get('text', ''),
                'userId': user_id,
                'sessionId': session_id,
                'model': model,
                'files': [],
                'contextItems': context_items,
                'uploadedFiles': uploaded_files,
                'messageId': message_id
            }
            
            # Call chat handler directly
            # Note: handle_chat_message will send the response directly via WebSocket
            # so we don't need to send it again here
            result = handle_chat_message(event_body, None)
            
            if result.get('statusCode') != 200:
                logger.warning(f"Chat handler returned non-200 status: {result.get('statusCode')}")
            
            return {'statusCode': 200, 'body': 'Message processed'}
            
        except Exception as e:
            logger.error(f"Error processing file upload message: {str(e)}")
            raise
    
    def _save_user_message(self, user_id: str, session_id: str, message_id: str, message_text: str, files: List[Dict]):
        """Save user message to DynamoDB"""
        try:
            session_response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id},
                ConsistentRead=True
            )
            
            if 'Item' in session_response:
                messages = session_response['Item'].get('messages', [])
                
                user_message = {
                    'id': message_id,
                    'text': message_text,
                    'sender': 'user',
                    'timestamp': int(datetime.now().timestamp()),
                    'message_type': 'text'
                }
                
                if files:
                    file_metadata = []
                    for file_info in files:
                        file_metadata.append({
                            'name': file_info.get('name', 'Unknown'),
                            'size': file_info.get('size', 0),
                            'type': file_info.get('type', 'application/octet-stream')
                        })
                    user_message['files'] = file_metadata
                
                messages.append(user_message)
                
                self.chat_sessions_table.update_item(
                    Key={'user_id': user_id, 'session_id': session_id},
                    UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :timestamp',
                    ExpressionAttributeValues={
                        ':messages': messages,
                        ':count': len(messages),
                        ':timestamp': int(datetime.now().timestamp())
                    }
                )
                logger.info(f"✅ Saved user message: {message_id}")
        except Exception as e:
            logger.error(f"❌ Failed to save user message: {e}")
    
    def _check_session_exists(self, user_id: str, session_id: str) -> bool:
        """Check if a session exists in DynamoDB"""
        try:
            response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            return 'Item' in response
        except Exception as e:
            logger.error(f"Error checking session existence: {str(e)}")
            return False
    
    def _create_session_for_first_message(self, user_id: str, session_id: str, model: str):
        """Create a session for the first message"""
        try:
            current_time = int(datetime.now().timestamp())
            session_item = {
                'user_id': user_id,
                'session_id': session_id,
                'created_at': current_time,
                'last_updated': current_time,
                'title': 'New Chat',
                'model': model,
                'message_count': 0,
                'messages': [],
                'metadata': {
                    'created_via': 'websocket_first_message',
                    'model': model
                }
            }
            self.chat_sessions_table.put_item(Item=session_item)
            logger.info(f"✅ Created session {session_id}")
        except Exception as e:
            logger.error(f"Error creating session: {str(e)}")
    


    def _handle_edit_message(self, connection_id: str, user_id: str, session_id: str, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle message editing"""
        try:
            message_id = message_data.get('messageId')
            new_text = message_data.get('newText')
            model = message_data.get('model', 'claude-sonnet-4')
            
            if not all([message_id, new_text]):
                return {
                    'statusCode': 400,
                    'body': json_dumps_safe({'error': 'Missing required fields for edit message'})
                }
            
            logger.info(f"🔍 EDIT: Starting edit process for message {message_id}")
            
            # Get current session
            response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            if 'Item' not in response:
                return {
                    'statusCode': 404,
                    'body': json_dumps_safe({'error': 'Session not found'})
                }
            
            messages = response['Item'].get('messages', [])
            
            # Find message to edit
            message_to_edit_index = None
            for i, msg in enumerate(messages):
                if msg.get('id') == message_id:
                    message_to_edit_index = i
                    break
            
            if message_to_edit_index is None:
                return {
                    'statusCode': 404,
                    'body': json_dumps_safe({'error': 'Message not found'})
                }
            
            message_to_edit = messages[message_to_edit_index]
            if message_to_edit['sender'] != 'user':
                return {
                    'statusCode': 400,
                    'body': json_dumps_safe({'error': 'Can only edit user messages'})
                }
            
            # Check if text changed
            if message_to_edit.get('text', '').strip() == new_text.strip():
                ack_message = {
                    'type': 'edit_acknowledged',
                    'message_id': message_id,
                    'message_index': message_to_edit_index,
                    'unchanged': True,
                    'session_id': session_id,  # Include session_id for proper routing
                    'timestamp': datetime.now().isoformat()
                }
                self.send_to_client(connection_id, ack_message)
                return {
                    'statusCode': 200,
                    'body': json_dumps_safe({'message': 'Message unchanged', 'unchanged': True})
                }
            
            # Truncate messages after edited message
            truncated_messages = messages[:message_to_edit_index + 1]
            truncated_messages[-1]['text'] = new_text
            
            # Update session
            timestamp = int(datetime.now().timestamp())
            self.chat_sessions_table.update_item(
                Key={'user_id': user_id, 'session_id': session_id},
                UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :updated, last_edit_at = :edit_at, last_edited_message_id = :edited_id',
                ExpressionAttributeValues={
                    ':messages': truncated_messages,
                    ':count': len(truncated_messages),
                    ':updated': timestamp,
                    ':edit_at': timestamp,
                    ':edited_id': message_id
                }
            )
            
            # Send acknowledgment
            ack_message = {
                'type': 'edit_acknowledged',
                'message_id': message_id,
                'message_index': message_to_edit_index,
                'session_id': session_id,  # Include session_id for proper routing
                'timestamp': datetime.now().isoformat()
            }
            self.send_to_client(connection_id, ack_message)
            
            # Process with chat agent directly (no Lambda invoke!)
            from lambda_handler import handle_chat_message
            
            event_body = {
                'action': 'chat',
                'message': new_text,
                'userId': user_id,
                'sessionId': session_id,
                'model': model,
                'files': [],
                'is_edit': True,
                'edited_message_id': message_id,
                'messageId': message_id
            }
            
            # Call chat handler directly
            result = handle_chat_message(event_body, None)
            
            # Extract and send response
            if result.get('statusCode') == 200:
                response_body = result.get('body', {})
                if isinstance(response_body, str):
                    response_body = json.loads(response_body)
                
                response_content = response_body.get('response')
                if response_content:
                    self.send_chat_response(user_id, session_id, response_content)
            
            return {
                'statusCode': 200,
                'body': json_dumps_safe({'message': 'Message edit processed successfully'})
            }
            
        except Exception as e:
            logger.error(f"Error handling edit message: {str(e)}")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': 'Failed to process edit message'})
            }

    def _store_context_items(self, user_id: str, session_id: str, context_items: List[Dict[str, Any]]):
        """Store context items in session_variables"""
        try:
            # Log incoming context items to verify data field is present
            logger.info(f"📥 Received {len(context_items)} context items to store")
            for i, item in enumerate(context_items):
                logger.info(f"  Item {i+1}: id={item.get('id')}, type={item.get('type')}, title={item.get('title')}")
                if 'data' in item:
                    logger.info(f"    data field present: {json.dumps(item.get('data'), default=str)}")
                else:
                    logger.warning(f"    ⚠️ data field MISSING in item {i+1}")
            
            context_items_decimal = convert_floats_to_decimal(context_items)
            
            # Verify data field is preserved after conversion
            for i, item in enumerate(context_items_decimal):
                if 'data' not in item:
                    logger.error(f"❌ CRITICAL: data field lost after convert_floats_to_decimal for item {i+1}: {item.get('id')}")
                else:
                    logger.info(f"  ✅ Item {i+1} data field preserved: {json.dumps(item.get('data'), default=str)}")
            
            context_summary = extract_context_summary(context_items)
            context_summary_decimal = convert_floats_to_decimal(context_summary)
            
            response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            existing_session_vars = response.get('Item', {}).get('session_variables', {})
            
            session_vars = {
                **existing_session_vars,
                'context_items': context_items_decimal,
                'context_added_at': int(datetime.now().timestamp()),
                'context_summary': context_summary_decimal,
                'last_updated': int(datetime.now().timestamp())
            }
            
            # Log what we're about to store
            logger.info(f"📤 Storing context items to DynamoDB:")
            for i, item in enumerate(session_vars.get('context_items', [])):
                logger.info(f"  Item {i+1} to store: id={item.get('id')}, type={item.get('type')}")
                if 'data' in item:
                    logger.info(f"    data field: {json.dumps(item.get('data'), default=str)}")
                else:
                    logger.error(f"    ❌ data field MISSING in item {i+1} before storing!")
            
            self.chat_sessions_table.update_item(
                Key={'user_id': user_id, 'session_id': session_id},
                UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                ExpressionAttributeValues={
                    ':vars': session_vars,
                    ':updated': int(datetime.now().timestamp())
                }
            )
            logger.info(f"📌 Stored context items in session_variables")
            
            # Verify what was actually stored by reading it back
            verify_response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            if 'Item' in verify_response:
                stored_items = verify_response['Item'].get('session_variables', {}).get('context_items', [])
                logger.info(f"🔍 Verification: Read back {len(stored_items)} context items from DynamoDB")
                for i, item in enumerate(stored_items):
                    if 'data' in item:
                        logger.info(f"  ✅ Item {i+1} data field present in stored item: {json.dumps(item.get('data'), default=str)}")
                    else:
                        logger.error(f"  ❌ Item {i+1} data field MISSING in stored item!")
        except Exception as e:
            logger.error(f"❌ Failed to store context items: {e}", exc_info=True)
    
    def _send_session_update(self, user_id: str, session_id: str):
        """Send session update message to frontend (fetches session_variables from DynamoDB)"""
        try:
            session_response = self.chat_sessions_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            if 'Item' in session_response:
                session_variables = session_response['Item'].get('session_variables', {})
                self._send_session_update_with_variables(user_id, session_id, session_variables)
        except Exception as e:
            logger.error(f"❌ Failed to send session update: {str(e)}")
    
    def _send_session_update_with_variables(self, user_id: str, session_id: str, session_variables: Dict[str, Any]):
        """Send session update message to frontend with provided session_variables"""
        try:
            session_update_message = {
                'type': 'session_updated',
                'session_id': session_id,
                'session_variables': session_variables,
                'timestamp': datetime.now().isoformat()
            }
            
            connection_ids = self.get_active_connections_for_user_session(user_id, session_id)
            logger.info(f"📤 Sending session_update to {len(connection_ids)} connection(s) for session {session_id}")
            for conn_id in connection_ids:
                self.send_to_client(conn_id, session_update_message)
                logger.info(f"✅ Sent session_update to connection {conn_id}")
        except Exception as e:
            logger.error(f"❌ Failed to send session update: {str(e)}")

