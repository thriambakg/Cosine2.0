"""
WebSocket Message Processor Lambda
Handles chat messages and integrates with the existing chat agent
"""

import json
import os
import logging
import uuid
import boto3
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Dict, Any
from boto3.dynamodb.conditions import Key, Attr

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

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

# Note: File uploads are now handled via REST endpoint, not WebSocket

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
    
    Args:
        obj: Object to convert (dict, list, or primitive)
        
    Returns:
        Converted object with Decimals instead of floats
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
            return Decimal('999999999')  # Large number
        elif obj == float('-inf'):
            return Decimal('-999999999')  # Large negative number
        else:
            return Decimal(str(obj))
    elif isinstance(obj, int):
        return obj  # Keep integers as-is
    else:
        return obj

# Get the WebSocket API Gateway endpoint from environment variable
websocket_endpoint = os.environ.get('WEBSOCKET_ENDPOINT')
if not websocket_endpoint:
    # Fallback: construct from API Gateway ID
    api_gateway_id = os.environ.get('WEBSOCKET_API_ID')
    if api_gateway_id:
        websocket_endpoint = f"https://{api_gateway_id}.execute-api.us-east-1.amazonaws.com/production"
    else:
        # Default fallback
        websocket_endpoint = "https://xem3y35uzd.execute-api.us-east-1.amazonaws.com/production"

# Convert wss:// to https:// for the API Gateway Management API
if websocket_endpoint.startswith('wss://'):
    websocket_endpoint = websocket_endpoint.replace('wss://', 'https://')

api_gateway = boto3.client(
    'apigatewaymanagementapi',
    endpoint_url=websocket_endpoint
)
lambda_client = boto3.client('lambda')

# DynamoDB tables
chat_connections_table = dynamodb.Table(os.environ['CHAT_CONNECTIONS_TABLE_NAME'])
chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])


def get_connection_info(connection_id):
    """
    Get connection information from DynamoDB
    
    Args:
        connection_id: WebSocket connection ID
        
    Returns:
        Connection information or None if not found
    """
    try:
        response = chat_connections_table.get_item(
            Key={'connection_id': connection_id}
        )
        return response.get('Item')
    except Exception as e:
        logger.error(f"Error getting connection info: {str(e)}")
        return None

def update_connection_session(connection_id, session_id):
    """
    Update connection record with session ID
    
    Args:
        connection_id: WebSocket connection ID
        session_id: Session ID to store
    """
    try:
        chat_connections_table.update_item(
            Key={'connection_id': connection_id},
            UpdateExpression='SET session_id = :session_id',
            ExpressionAttributeValues={':session_id': session_id}
        )
        logger.info(f"Updated connection {connection_id} with session_id {session_id}")
    except Exception as e:
        logger.error(f"Error updating connection session: {str(e)}")

def process_message(connection_id, user_id, session_id, message_data):
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
        logger.info(f"Frontend messageId: {frontend_message_id}")
        logger.info(f"Using message_id: {message_id}")
        logger.info(f"Full message data: {message_data}")
        
        # Handle connection establishment message
        if message_type == 'connection_establish':
            logger.info(f"Processing connection establishment message for connection {connection_id}")
            # Send connection established message
            connection_message = {
                'type': 'connection_established',
                'session_id': session_id,  # May be None for connection_establish
                'message': 'Connected to Cosine AI Chat',
                'timestamp': datetime.now().isoformat()
            }
            
            if not send_message_to_client(connection_id, connection_message):
                logger.warning(f"Failed to send connection message to connection {connection_id}")
            
            logger.info(f"Connection establishment completed for connection {connection_id} - RETURNING EARLY")
            return {
                'statusCode': 200,
                'body': json_dumps_safe({'message': 'Connection established'})
            }
        
        # Handle kill signal message
        if message_type == 'kill_signal':
            logger.info(f"Processing kill signal message for connection {connection_id}")
            return handle_kill_signal(connection_id, user_id, session_id, message_data)
        
        # Note: File uploads are now handled via REST endpoint, not WebSocket
        
        # Handle agent file returns
        if message_type == 'agent_file_return':
            logger.info(f"Processing agent file return for connection {connection_id}")
            return handle_agent_file_return(connection_id, user_id, session_id, message_data)
        
        # Handle message editing
        if message_type == 'edit_message':
            logger.info(f"Processing edit message for connection {connection_id}")
            return handle_edit_message(connection_id, user_id, session_id, message_data)
        
        # Check if this is the first message (welcome message)
        is_first_message = message_data.get('is_first_message', False)
        
        if is_first_message:
            # Send welcome message first
            welcome_message = {
                'type': 'connection_established',
                'session_id': session_id,
                'message': 'Connected to Cosine AI Chat',
                'timestamp': datetime.now().isoformat()
            }
            
            if not send_message_to_client(connection_id, welcome_message):
                logger.warning(f"Failed to send welcome message to connection {connection_id}")
        
        # Note: User message will be added by the chat agent Lambda
        # No need to add it here to avoid duplicates
        logger.info(f"User message will be processed by chat agent: {message_id}")
        
        # Send acknowledgment to user
        ack_message = {
            'type': 'message_received',
            'message_id': message_id,
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, ack_message)
        
        # Check if session exists, create if needed (for first message)
        session_exists = check_session_exists(user_id, session_id)
        if not session_exists:
            logger.info(f"🔍 Session {session_id} doesn't exist, creating it for first message")
            create_session_for_first_message(user_id, session_id, model)
        
        # Extract context items and uploaded files from message data (if present)
        context_items = message_data.get('contextItems', [])
        uploaded_files = message_data.get('uploadedFiles', [])
        session_variables_updated = message_data.get('session_variables_updated', False)
        
        # Note: Files can be handled via REST endpoint (uploadedFiles) or through WebSocket (context_items)
        # The WebSocket processor handles both context items (tiles, stocks, etc.) and uploaded files
        
        # If session variables were updated by file upload lambda, send session_updated message to frontend
        if session_variables_updated:
            logger.info(f"📌 Session variables were updated by file upload lambda, sending session_updated message")
            try:
                # Get updated session variables from database
                session_response = chat_sessions_table.get_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    }
                )
                
                if 'Item' in session_response:
                    session_item = session_response['Item']
                    session_variables = session_item.get('session_variables', {})
                    
                    # Send session update message to frontend
                    session_update_message = {
                        'type': 'session_updated',
                        'session_id': session_id,
                        'session_variables': session_variables,
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    # Send to all active connections for this user and session
                    connections = get_active_connections_for_user_session(user_id, session_id)
                    for connection_id in connections:
                        try:
                            send_message_to_client(connection_id, session_update_message)
                            logger.info(f"📁 Sent session variables update to connection {connection_id}")
                        except Exception as e:
                            logger.error(f"❌ Failed to send session variables update to connection {connection_id}: {str(e)}")
                            
            except Exception as e:
                logger.error(f"❌ Failed to send session variables update: {str(e)}")
        
        has_context = len(context_items) > 0
        has_files = len(uploaded_files) > 0
        
        # Store the original user message (without context prompt) for frontend display
        original_user_message = message_text
        
        # Store context items in session_variables for persistence (uploaded files handled by file upload lambda)
        # But we still need to process uploaded files for AI prompt building
        if has_context or has_files:
            logger.info(f"📌 Context-aware message detected with {len(context_items)} context items and {len(uploaded_files)} uploaded files")
            if context_items:
                logger.info(f"📌 Context items preview: {json_dumps_safe(context_items[:1])}")  # Log first item
            if uploaded_files:
                logger.info(f"📌 Uploaded files preview: {json_dumps_safe(uploaded_files[:1])}")  # Log first file
            
            # Store context items in session_variables for persistence (uploaded files already handled by file upload lambda)
            if has_context and CONTEXT_BUILDER_AVAILABLE:
                context_summary = extract_context_summary(context_items)
                logger.info(f"📌 Context summary: {context_summary}")
                
                # Update session variables in DynamoDB
                try:
                    # Convert all floats to Decimal for DynamoDB compatibility
                    context_items_decimal = convert_floats_to_decimal(context_items)
                    context_summary_decimal = convert_floats_to_decimal(context_summary)
                    
                    # Get existing session_variables to merge with new data
                    response = chat_sessions_table.get_item(
                        Key={
                            'user_id': user_id,
                            'session_id': session_id
                        }
                    )
                    
                    # Get existing session_variables or create empty dict
                    existing_session_vars = response.get('Item', {}).get('session_variables', {})
                    
                    # Prepare session variables with separate fields
                    session_vars = {
                        **existing_session_vars,  # Preserve existing data
                        'context_items': context_items_decimal,
                        'context_added_at': int(datetime.now().timestamp()),
                        'context_summary': context_summary_decimal,
                        'last_updated': int(datetime.now().timestamp())
                    }
                    
                    chat_sessions_table.update_item(
                        Key={
                            'user_id': user_id,
                            'session_id': session_id
                        },
                        UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                        ExpressionAttributeValues={
                            ':vars': session_vars,
                            ':updated': int(datetime.now().timestamp())
                        }
                    )
                    logger.info(f"📌 Stored context items in session_variables")
                except Exception as e:
                    logger.error(f"❌ Failed to store context items in session_variables: {e}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                
            # Build clean message for AI (no system prompt, let agent tools handle file access)
            try:
                # Send only the original user message - let agent tools discover and access files
                clean_message = original_user_message if original_user_message else message_text
                logger.info(f"📌 Sending clean message to AI: '{clean_message}'")
                logger.info(f"📌 Files available via tools: {len(uploaded_files)} uploaded files")
                
                # Use clean message for AI processing
                message_text = clean_message
            except Exception as e:
                logger.error(f"❌ Failed to prepare clean message: {e}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
        else:
            logger.info(f"📌 No context or files, sending original message: '{message_text}'")
        
        # Call the existing chat agent Lambda (with enriched message if context present)
        # Pass original_user_message so the chat agent can store it for display
        ai_response = call_chat_agent(
            user_id, 
            message_text,  # Enriched message for AI
            model, 
            files, 
            session_id, 
            context_items if has_context else None,
            original_user_message if (has_context or has_files) else None,  # Original message for frontend display
            uploaded_files if has_files else None  # Uploaded files for AI processing
        )
        
        # Note: AI response is already added by the chat agent Lambda
        # No need to add it here to avoid duplicates
        ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
        logger.info(f"AI response already processed by chat agent: {ai_message_id}")
        
        # Send AI response to client (only if connection is still associated with this session)
        connection_info = get_connection_info(connection_id)
        current_session_id = connection_info.get('session_id') if connection_info else None
        
        if current_session_id == session_id:
            # Check if this is a file return response
            if isinstance(ai_response, dict) and ai_response.get('type') == 'file_return':
                ai_response_message = {
                    'type': 'ai_response',
                    'message_id': ai_message_id,
                    'content': ai_response.get('message', ''),
                    'file_data': ai_response.get('file_data', []),
                    'session_id': session_id,
                    'timestamp': datetime.now().isoformat()
                }
            else:
                ai_response_message = {
                    'type': 'ai_response',
                    'message_id': ai_message_id,
                    'content': ai_response,
                    'session_id': session_id,  # Include session_id for proper routing
                    'timestamp': datetime.now().isoformat()
                }
            
            send_message_to_client(connection_id, ai_response_message)
            logger.info(f"✅ Sent AI response to session {session_id}")
        else:
            logger.warning(f"⚠️ Skipping AI response - connection {connection_id} is now associated with session {current_session_id}, but response is for session {session_id}")
            # Store the response in the correct session for later retrieval
            # The user can refresh or reload the session to see the response
        
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

def check_session_exists(user_id, session_id):
    """
    Check if a session exists in DynamoDB
    
    Args:
        user_id: User ID
        session_id: Session ID
        
    Returns:
        bool: True if session exists, False otherwise
    """
    try:
        response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        return 'Item' in response
    except Exception as e:
        logger.error(f"Error checking session existence: {str(e)}")
        return False

def create_session_for_first_message(user_id, session_id, model):
    """
    Create a session for the first message
    
    Args:
        user_id: User ID
        session_id: Session ID (already generated by frontend)
        model: AI model to use
    """
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
        
        chat_sessions_table.put_item(Item=session_item)
        logger.info(f"✅ Created session {session_id} for first message")
        
    except Exception as e:
        logger.error(f"Error creating session for first message: {str(e)}")

def handle_kill_signal(connection_id, user_id, session_id, message_data):
    """
    Handle kill signal message from frontend to stop agent processing
    
    Args:
        connection_id: WebSocket connection ID
        user_id: User ID
        session_id: Session ID
        message_data: Message data containing kill signal info
        
    Returns:
        API Gateway response
    """
    try:
        reason = message_data.get('reason', 'user_cancellation')
        logger.info(f"🔴 KILL SIGNAL: Processing kill signal for session {session_id}, reason: {reason}")
        
        if not session_id:
            logger.warning("🔴 KILL SIGNAL: No session_id provided, cannot set kill flag")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No session_id provided'})
            }
        
        # Set kill flag in DynamoDB to stop any active processing
        try:
            timestamp_ms = int(datetime.now().timestamp() * 1000)
            chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET killed_at = :killed_at, kill_reason = :kill_reason',
                ExpressionAttributeValues={
                    ':killed_at': timestamp_ms,
                    ':kill_reason': reason
                },
                ConditionExpression='attribute_exists(user_id) AND attribute_exists(session_id)'
            )
            logger.info(f"🔴 KILL SIGNAL: Successfully set kill flag for session {session_id}")
        except Exception as kill_error:
            logger.error(f"❌ KILL SIGNAL: Failed to set kill flag for session {session_id}: {str(kill_error)}")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': 'Failed to set kill flag'})
            }
        
        # Send acknowledgment to frontend
        ack_message = {
            'type': 'kill_signal_acknowledged',
            'session_id': session_id,
            'reason': reason,
            'timestamp': datetime.now().isoformat(),
            'message': 'Processing cancelled successfully'
        }
        
        if not send_message_to_client(connection_id, ack_message):
            logger.warning(f"Failed to send kill signal acknowledgment to connection {connection_id}")
        
        logger.info(f"✅ KILL SIGNAL: Successfully processed kill signal for session {session_id}")
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({'message': 'Kill signal processed successfully'})
        }
        
    except Exception as e:
        logger.error(f"❌ KILL SIGNAL: Error processing kill signal: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': f'Failed to process kill signal: {str(e)}'})
        }

def call_chat_agent(user_id, message_text, model, files, session_id, context_items=None, original_user_message=None, uploaded_files=None):
    """
    Call the existing chat agent Lambda function with kill signal checking
    
    Args:
        user_id: User ID
        message_text: User's message (already enriched with context if present)
        model: Selected AI model
        files: Uploaded files
        session_id: Session ID
        context_items: Optional context items (only passed if context builder not available)
        original_user_message: Original user message (before context enrichment) for frontend display
        uploaded_files: Optional uploaded files for AI processing
        
    Returns:
        AI response text
    """
    try:
        # Check for kill signal before calling chat agent
        logger.info(f"🔍 KILL CHECK: Checking for kill signal on session {session_id}")
        
        # Get session to check for kill signal
        session_response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' in session_response:
            session_item = session_response['Item']
            if session_item.get('killed_at'):
                logger.warning(f"🔴 KILL: Session {session_id} has been killed, aborting chat agent call")
                return "Session has been terminated. Please start a new conversation."
        
        logger.info(f"✅ KILL CHECK: Session {session_id} is active, proceeding with chat agent call")
        
        # Prepare payload for chat agent
        payload = {
            'action': 'chat',
            'message': message_text,
            'userId': user_id,
            'model': model,
            'files': files,
            'sessionId': session_id,  # Use the session_id from the function parameter
            'context': {
                'currentPage': 'chat',
                'sessionId': session_id  # Use the session_id from the function parameter
            }
        }
        
        # Include original message for frontend display if provided
        if original_user_message:
            payload['originalMessage'] = original_user_message
            logger.info(f"📌 Including original user message for frontend display")
        
        # Only include contextItems if context builder is not available (fallback)
        if context_items and not CONTEXT_BUILDER_AVAILABLE:
            payload['contextItems'] = context_items
            logger.info(f"📌 Including context items in payload as fallback (builder not available)")
        
        # Include uploaded files if provided
        if uploaded_files:
            payload['uploadedFiles'] = uploaded_files
            logger.info(f"📌 Including uploaded files in payload: {len(uploaded_files)} files")
        
        logger.info(f"Calling chat agent with payload: {json_dumps_safe(payload)}")
        
        # Call the chat agent Lambda function
        # Note: You'll need to update this to the actual chat agent Lambda function name
        chat_agent_function_name = os.environ.get('CHAT_AGENT_FUNCTION_NAME', 'cosine-chat-agent-production')
        
        response = lambda_client.invoke(
            FunctionName=chat_agent_function_name,
            InvocationType='RequestResponse',
            Payload=json_dumps_safe(payload)
        )
        
        # Parse the response
        response_payload = json.loads(response['Payload'].read().decode('utf-8'))
        logger.info(f"Chat agent response: {json_dumps_safe(response_payload)}")
        
        if response_payload.get('statusCode') == 200:
            response_body = json.loads(response_payload.get('body', '{}'))
            
            # Check if this is a file return response with structured data
            if 'file_data' in response_body:
                logger.info(f"📁 FILE RETURN: Detected file return response with {len(response_body.get('file_data', []))} files")
                # Return the structured response for direct frontend processing
                return {
                    'type': 'file_return',
                    'message': response_body.get('response', 'Files returned successfully'),
                    'file_data': response_body.get('file_data', [])
                }
            
            
            # Regular text response
            return response_body.get('response', 'I apologize, but I encountered an error processing your request.')
        elif response_payload.get('statusCode') == 404:
            # Session not found (404) - this should not happen after our session creation check
            logger.error(f"❌ Session not found: {response_payload}")
            return 'Session not found. Please refresh the page and try again.'
        elif response_payload.get('statusCode') == 410:
            # Session terminated (410 Gone)
            logger.warning(f"🔴 KILL: Chat agent returned 410 - session terminated")
            return "Session has been terminated. Please start a new conversation."
        else:
            logger.error(f"Chat agent returned error: {response_payload}")
            return 'I apologize, but I encountered an error processing your request. Please try again.'
            
    except Exception as e:
        logger.error(f"Error calling chat agent: {str(e)}")
        return 'I apologize, but I encountered an error processing your request. Please try again.'

def send_message_to_client(connection_id, message):
    """
    Send message to WebSocket client
    
    Args:
        connection_id: WebSocket connection ID
        message: Message to send
        
    Returns:
        Success status
    """
    try:
        api_gateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json_dumps_safe(message)
        )
        return True
    except Exception as e:
        logger.error(f"Error sending message to client: {str(e)}")
        return False

def handle_edit_message(connection_id, user_id, session_id, message_data):
    """
    Handle message editing - truncate messages after edited message and regenerate response
    
    Args:
        connection_id: WebSocket connection ID
        user_id: User ID
        session_id: Session ID
        message_data: Edit message data containing messageId, newText (messageIndex is optional)
        
    Returns:
        API Gateway response
    """
    try:
        message_id = message_data.get('messageId')
        new_text = message_data.get('newText')
        model = message_data.get('model', 'claude-sonnet-4')
        
        if not all([message_id, new_text]):
            logger.error(f"Missing required fields for edit message: messageId={message_id}, newText={new_text}")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Missing required fields for edit message'})
            }
        
        logger.info(f"🔍 EDIT: Starting edit process for message {message_id} in session {session_id}")
        logger.info(f"🔍 EDIT: Looking for message {message_id} in session {session_id} for user {user_id}")
        
        # Step 1: Set kill signal to stop any ongoing AI processing for this session
        logger.info(f"🛑 EDIT: Setting kill signal for session {session_id} to cancel ongoing AI processing")
        timestamp_ms = int(datetime.now().timestamp() * 1000)
        try:
            chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET killed_at = :killed_at',
                ExpressionAttributeValues={
                    ':killed_at': timestamp_ms
                }
            )
            logger.info(f"✅ EDIT: Kill signal set for session {session_id} at {timestamp_ms}")
        except Exception as kill_error:
            logger.error(f"⚠️ EDIT: Failed to set kill signal: {kill_error}")
            # Continue with edit even if kill signal fails
        
        # Get current session
        response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' not in response:
            logger.error(f"❌ EDIT: Session {session_id} not found for user {user_id}")
            return {
                'statusCode': 404,
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        session_item = response['Item']
        messages = session_item.get('messages', [])
        
        logger.info(f"🔍 EDIT: Found session with {len(messages)} messages")
        
        # Validate that we have messages
        if not messages:
            logger.error(f"❌ EDIT: No messages found in session {session_id}")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No messages in session'})
            }
        
        # Find the message to edit by ID (with flexible matching for different ID formats)
        logger.info(f"🔍 EDIT: Searching for message ID {message_id} in {len(messages)} messages...")
        message_to_edit_index = None
        
        # Extract timestamp from the message_id (e.g., "msg_1758247366374_j7xptuhfj" -> "1758247366374")
        search_timestamp = None
        if message_id.startswith('msg_'):
            # Try to extract timestamp from different formats
            parts = message_id.split('_')
            if len(parts) >= 2:
                try:
                    search_timestamp = parts[1]  # Get the timestamp part
                    logger.info(f"🔍 EDIT: Extracted timestamp for search: {search_timestamp}")
                except:
                    pass
        
        for i, msg in enumerate(messages):
            msg_id = msg.get('id', 'NO_ID')
            logger.info(f"🔍 EDIT: Checking message {i}: ID={msg_id}, sender={msg.get('sender', 'NO_SENDER')}")
            
            # Try exact match first
            if msg_id == message_id:
                message_to_edit_index = i
                logger.info(f"✅ EDIT: Found exact match for message {message_id} at index {i}")
                break
            
            # Try timestamp-based match if exact match fails
            if search_timestamp and msg_id.startswith('msg_'):
                msg_parts = msg_id.split('_')
                if len(msg_parts) >= 2 and msg_parts[1] == search_timestamp:
                    message_to_edit_index = i
                    logger.info(f"✅ EDIT: Found timestamp match for message {message_id} (matched {msg_id}) at index {i}")
                    break
        
        if message_to_edit_index is None:
            logger.error(f"❌ EDIT: Message {message_id} not found in session {session_id}")
            logger.error(f"❌ EDIT: Search timestamp: {search_timestamp}")
            logger.error(f"❌ EDIT: Available message IDs: {[msg.get('id', 'NO_ID') for msg in messages]}")
            return {
                'statusCode': 404,
                'body': json_dumps_safe({'error': 'Message not found'})
            }
        
        message_to_edit = messages[message_to_edit_index]
        logger.info(f"🔍 EDIT: Found message to edit: sender={message_to_edit.get('sender')}, text_length={len(message_to_edit.get('text', ''))}")
        
        if message_to_edit['sender'] != 'user':
            logger.error(f"❌ EDIT: Message {message_id} is not a user message (sender: {message_to_edit.get('sender')})")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Can only edit user messages'})
            }
        
        # Check if the message text actually changed
        original_text = message_to_edit.get('text', '').strip()
        new_text_stripped = new_text.strip()
        
        if original_text == new_text_stripped:
            logger.info(f"⚠️ EDIT: Message text unchanged - skipping duplicate processing")
            logger.info(f"⚠️ EDIT: Original: '{original_text[:100]}...'")
            logger.info(f"⚠️ EDIT: New: '{new_text_stripped[:100]}...'")
            
            # Send acknowledgment but don't process
            ack_message = {
                'type': 'edit_acknowledged',
                'message_id': message_id,
                'message_index': message_to_edit_index,
                'unchanged': True,
                'timestamp': datetime.now().isoformat()
            }
            
            send_message_to_client(connection_id, ack_message)
            logger.info(f"✅ EDIT: Sent edit_acknowledged (unchanged) to frontend for message {message_id}")
            
            return {
                'statusCode': 200,
                'body': json_dumps_safe({
                    'message': 'Message unchanged, no processing needed',
                    'message_id': message_id,
                    'unchanged': True
                })
            }
        
        logger.info(f"✅ EDIT: Message text changed, proceeding with edit")
        logger.info(f"✅ EDIT: Original: '{original_text[:50]}...'")
        logger.info(f"✅ EDIT: New: '{new_text_stripped[:50]}...'")
        
        # Truncate messages after the edited message
        original_message_count = len(messages)
        truncated_messages = messages[:message_to_edit_index + 1]  # Keep messages up to and including the edited one
        truncated_messages[-1]['text'] = new_text  # Update the edited message text
        
        logger.info(f"✅ EDIT: Successfully truncated {original_message_count} messages to {len(truncated_messages)} messages")
        logger.info(f"✅ EDIT: Updated message text from '{message_to_edit.get('text', '')[:50]}...' to '{new_text[:50]}...'")
        
        # Update the session with truncated messages and clear kill signal
        timestamp = int(datetime.now().timestamp())
        chat_sessions_table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET messages = :messages, message_count = :message_count, last_updated = :last_updated REMOVE killed_at',
            ExpressionAttributeValues={
                ':messages': truncated_messages,
                ':message_count': len(truncated_messages),
                ':last_updated': timestamp
            }
        )
        
        logger.info(f"✅ EDIT: Updated session {session_id} in DynamoDB with {len(truncated_messages)} truncated messages")
        logger.info(f"✅ EDIT: Cleared kill signal for session {session_id} - ready for new AI response")
        
        # Send acknowledgment to frontend
        ack_message = {
            'type': 'edit_acknowledged',
            'message_id': message_id,
            'message_index': message_to_edit_index,
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, ack_message)
        logger.info(f"✅ EDIT: Sent edit_acknowledged to frontend for message {message_id}")
        
        # Call chat agent to generate new response with updated context
        logger.info(f"🔍 EDIT: Calling chat agent with new context (session will automatically get truncated messages)")
        ai_response = call_chat_agent(user_id, new_text, model, [], session_id)
        
        if ai_response:
            logger.info(f"✅ EDIT: Chat agent generated response, length: {len(ai_response)}")
            
            # Add AI response to session
            ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
            ai_timestamp = int(datetime.now().timestamp())
            ai_message = {
                'id': ai_message_id,
                'text': ai_response,  # ai_response is already a string
                'sender': 'bot',
                'timestamp': ai_timestamp,
                'message_type': 'text'
            }
            
            # Add AI response to truncated messages
            updated_messages = truncated_messages + [ai_message]
            
            logger.info(f"✅ EDIT: Adding AI response to session, total messages now: {len(updated_messages)}")
            
            # Update session with new AI response
            chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET messages = :messages, message_count = :message_count, last_updated = :last_updated',
                ExpressionAttributeValues={
                    ':messages': updated_messages,
                    ':message_count': len(updated_messages),
                    ':last_updated': ai_timestamp
                }
            )
            
            logger.info(f"✅ EDIT: Updated session {session_id} with new AI response in DynamoDB")
            
            # Send AI response to client
            ai_response_message = {
                'type': 'ai_response',
                'message_id': ai_message_id,
                'content': ai_response,
                'timestamp': datetime.now().isoformat()
            }
            
            # Only send response if connection is still associated with this session
            connection_info = get_connection_info(connection_id)
            current_session_id = connection_info.get('session_id') if connection_info else None
            
            if current_session_id == session_id:
                send_message_to_client(connection_id, ai_response_message)
                logger.info(f"✅ EDIT: Successfully sent AI response for edited message {message_id}")
            else:
                logger.warning(f"⚠️ EDIT: Skipping AI response - connection {connection_id} is now associated with session {current_session_id}, but response is for session {session_id}")
        else:
            logger.error(f"❌ EDIT: Failed to get AI response for edited message {message_id}")
            error_message = {
                'type': 'error',
                'message': 'Failed to generate response for edited message',
                'timestamp': datetime.now().isoformat()
            }
            # Only send error if connection is still associated with this session
            connection_info = get_connection_info(connection_id)
            current_session_id = connection_info.get('session_id') if connection_info else None
            
            if current_session_id == session_id:
                send_message_to_client(connection_id, error_message)
        
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


# Note: File loading is now handled by passing S3 keys/URLs in context_items

def handle_agent_file_return(connection_id: str, user_id: str, session_id: str, message_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle agent-generated file returns
    
    Args:
        connection_id: WebSocket connection ID
        user_id: User ID
        session_id: Session ID
        message_data: Message data containing file information
        
    Returns:
        API Gateway response
    """
    try:
        # Note: Agent file returns are now handled via REST endpoint
        logger.warning("⚠️ Agent file returns should be handled via REST endpoint")
        return {
            'statusCode': 501,
            'body': json_dumps_safe({'error': 'Agent file returns not implemented via WebSocket'})
        }
        
    except Exception as e:
        logger.error(f"❌ Error handling agent file return: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Failed to process agent file return'})
        }

def handle_s3_event_notification(event):
    """
    Handle S3 event notifications for file upload success
    
    Args:
        event: S3 event notification from SNS
        
    Returns:
        API Gateway response
    """
    try:
        logger.info(f"📦 Processing S3 event notification: {json_dumps_safe(event)}")
        
        for record in event['Records']:
            # Parse S3 event
            s3_event = record.get('s3', {})
            bucket_name = s3_event.get('bucket', {}).get('name')
            s3_key = s3_event.get('object', {}).get('key')
            
            if not s3_key:
                logger.warning("⚠️ No S3 key found in event record")
                continue
            
            logger.info(f"📦 S3 Object Created: {bucket_name}/{s3_key}")
            
            # Skip agent files - they are handled by the agent files processor
            if 'agent-files' in s3_key:
                logger.info(f"📦 Skipping agent file: {s3_key}")
                continue
            
            # Parse S3 key to extract user_id and session_id
            # Expected format: users/{user_id}/sessions/{session_id}/files/{filename}
            path_parts = s3_key.split('/')
            if len(path_parts) >= 4 and path_parts[0] == 'users':
                user_id = path_parts[1]
                session_id = path_parts[3]  # sessions/{session_id}
                
                logger.info(f"📦 File upload for user {user_id}, session {session_id}")
                
                # Get S3 object metadata for additional correlation info
                try:
                    s3_client = boto3.client('s3')
                    response = s3_client.head_object(Bucket=bucket_name, Key=s3_key)
                    metadata = response.get('Metadata', {})
                    
                    original_filename = metadata.get('original_filename', 'Unknown')
                    file_type = metadata.get('file_type', 'unknown')
                    
                    # Only process chat upload files
                    if file_type == 'chat_upload':
                        logger.info(f"📦 Processing chat file upload: {original_filename}")
                        
                        # Find active WebSocket connections for this user/session
                        active_connections = get_active_connections_for_user_session(user_id, session_id)
                        
                        if active_connections:
                            # Send file upload confirmation to all active connections
                            confirmation_message = {
                                'type': 'file_upload_success',
                                's3_key': s3_key,
                                'filename': original_filename,
                                'session_id': session_id,
                                'timestamp': datetime.now().isoformat()
                            }
                            
                            for connection_id in active_connections:
                                send_message_to_client(connection_id, confirmation_message)
                                logger.info(f"📦 Sent file upload confirmation to connection {connection_id}")
                        else:
                            logger.warning(f"⚠️ No active connections found for user {user_id}, session {session_id}")
                    else:
                        logger.info(f"📦 Skipping non-chat file: {file_type}")
                        
                except Exception as e:
                    logger.error(f"❌ Failed to get S3 object metadata: {str(e)}")
                    continue
            else:
                logger.warning(f"⚠️ Unexpected S3 key format: {s3_key}")
                continue
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({'message': 'S3 event processed successfully'})
        }
        
    except Exception as e:
        logger.error(f"❌ Error processing S3 event notification: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Failed to process S3 event'})
        }

def get_active_connections_for_user_session(user_id: str, session_id: str) -> List[str]:
    """
    Get active WebSocket connections for a specific user and session
    
    Args:
        user_id: User ID
        session_id: Session ID
        
    Returns:
        List of active connection IDs
    """
    try:
        # Query the connections table for active connections using the UserConnectionsIndex
        # Filter by session_id and check if connection is still active (not expired)
        current_time = int(datetime.now().timestamp())
        
        logger.info(f"🔍 DEBUG: Looking for connections for user {user_id}, session {session_id}")
        logger.info(f"🔍 DEBUG: Current time: {current_time}")
        
        # First, let's see all connections for this user
        all_connections_response = chat_connections_table.query(
            IndexName='UserConnectionsIndex',
            KeyConditionExpression=Key('user_id').eq(user_id)
        )
        
        logger.info(f"🔍 DEBUG: Found {len(all_connections_response['Items'])} total connections for user {user_id}")
        for conn in all_connections_response['Items']:
            conn_session_id = conn.get('session_id', 'NO_SESSION_ID')
            expires_at = conn.get('expires_at', 0)
            is_expired = expires_at <= current_time
            logger.info(f"🔍 DEBUG: Connection {conn['connection_id']}: session_id={conn_session_id}, expires_at={expires_at}, is_expired={is_expired}")
        
        # Now filter by session_id and expiration
        response = chat_connections_table.query(
            IndexName='UserConnectionsIndex',
            KeyConditionExpression=Key('user_id').eq(user_id),
            FilterExpression=Attr('session_id').eq(session_id) & Attr('expires_at').gt(current_time)
        )
        
        connection_ids = [item['connection_id'] for item in response['Items']]
        logger.info(f"📦 Found {len(connection_ids)} active connections for user {user_id}, session {session_id}")
        
        return connection_ids
        
    except Exception as e:
        logger.error(f"❌ Failed to get active connections: {str(e)}")
        return []

def handle_file_handler_message(event):
    """
    Handle messages sent from File Handler (direct Lambda invocation).
    Use the same flow as regular messages to maintain consistency and real-time responses.
    
    Args:
        event: Event data from File Handler containing message and context
        
    Returns:
        API Gateway response
    """
    try:
        logger.info("Processing message from File Handler")
        
        # Extract message data
        user_id = event.get('userId')
        session_id = event.get('sessionId')
        message_text = event.get('message', '')
        message_id = event.get('messageId')
        context_items = event.get('contextItems', [])
        uploaded_files = event.get('uploadedFiles', [])  # Separate file uploads
        session_variables_updated = event.get('session_variables_updated', False)
        model = event.get('model', 'claude-3-sonnet')
        
        if not user_id or not session_id:
            logger.error("Missing user_id or session_id in File Handler message")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Missing user_id or session_id'})
            }
        
        logger.info(f"Processing File Handler message: user={user_id}, session={session_id}, context_items={len(context_items)}, uploaded_files={len(uploaded_files)}")
        
        # CRITICAL: Update any active connections with the session_id
        # This ensures that get_active_connections_for_user_session can find them
        try:
            # Find all active connections for this user (regardless of session_id)
            current_time = int(datetime.now().timestamp())
            all_connections_response = chat_connections_table.query(
                IndexName='UserConnectionsIndex',
                KeyConditionExpression=Key('user_id').eq(user_id),
                FilterExpression=Attr('expires_at').gt(current_time)
            )
            
            # Update each connection with the session_id
            for conn in all_connections_response['Items']:
                connection_id = conn['connection_id']
                logger.info(f"🔗 Updating connection {connection_id} with session_id {session_id}")
                update_connection_session(connection_id, session_id)
                
        except Exception as e:
            logger.error(f"❌ Failed to update connections with session_id: {str(e)}")
            # Continue processing even if connection update fails
        
        # Convert uploaded files to context items format for consistency
        all_context_items = list(context_items)
        
        # Add uploaded files as context items (same format as regular context)
        for file_info in uploaded_files:
            all_context_items.append({
                'type': 'file',
                'title': f"Uploaded File: {file_info['filename']}",
                'data': {
                    'original_filename': file_info['filename'],
                    's3_key': file_info['s3_key'],
                    's3_url': file_info['s3_url'],
                    'content_type': file_info['content_type'],
                    'file_size': file_info['file_size'],
                    'upload_timestamp': file_info['upload_timestamp']
                }
            })
        
        # Store uploaded files in session_variables for persistence
        # Skip if session_variables were already updated by file upload lambda
        if uploaded_files and not session_variables_updated:
            logger.info(f"📌 Storing uploaded files in session_variables (not updated by file upload lambda)")
            try:
                uploaded_files_decimal = convert_floats_to_decimal(uploaded_files)
                
                # First, get the current session_variables to merge with uploaded files
                response = chat_sessions_table.get_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    }
                )
                
                # Get existing session_variables or create empty dict
                existing_session_vars = response.get('Item', {}).get('session_variables', {})
                
                # Get existing uploaded files or create empty list
                existing_files = existing_session_vars.get('uploaded_files', [])
                
                # Merge new files with existing files
                all_files = existing_files + uploaded_files_decimal
                
                # Merge uploaded files into session_variables
                updated_session_vars = {
                    **existing_session_vars,
                    'uploaded_files': all_files,
                    'files_added_at': int(datetime.now().timestamp())
                }
                
                # Update the session with merged session_variables
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                    ExpressionAttributeValues={
                        ':vars': updated_session_vars,
                        ':updated': int(datetime.now().timestamp())
                    }
                )
                logger.info(f"📌 Stored uploaded files in session_variables")
            except Exception as e:
                logger.error(f"❌ Failed to store uploaded files: {e}")
        elif uploaded_files and session_variables_updated:
            logger.info(f"📌 Skipping uploaded files storage - already handled by file upload lambda")
        
        # Store the original user message in the database first
        try:
            # Prepare file metadata for message display (without actual file data)
            file_metadata = []
            if uploaded_files:
                for file_info in uploaded_files:
                    file_metadata.append({
                        'name': file_info.get('filename', 'Unknown'),
                        'size': file_info.get('file_size', 0),
                        'type': file_info.get('content_type', 'application/octet-stream')
                    })
            
            # Add user message to conversation history
            user_message_data = {
                'id': message_id,
                'role': 'user',
                'content': message_text,  # Store original message text
                'timestamp': int(datetime.now().timestamp() * 1000),
                'model': model,
                'files': file_metadata if file_metadata else None  # Include file metadata for display
            }
            
            # Update conversation history in DynamoDB
            chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET conversation_history = list_append(if_not_exists(conversation_history, :empty_list), :message)',
                ExpressionAttributeValues={
                    ':empty_list': [],
                    ':message': [user_message_data]
                }
            )
            logger.info(f"📌 Stored original user message in conversation history")
            
        except Exception as e:
            logger.error(f"❌ Failed to store user message: {e}")
        
        # Send clean message to AI agent (let tools handle file access)
        clean_message = message_text
        logger.info(f"📌 Sending clean message to AI: '{clean_message}'")
        logger.info(f"📌 Files available via tools: {len(uploaded_files)} uploaded files")
        
        # Invoke chat agent with enriched message
        try:
            chat_agent_function_name = os.environ.get('CHAT_AGENT_FUNCTION_NAME')
            if not chat_agent_function_name:
                logger.error("CHAT_AGENT_FUNCTION_NAME not configured")
                return {
                    'statusCode': 500,
                    'body': json_dumps_safe({'error': 'Chat agent not configured'})
                }
            
            # Prepare payload for chat agent
            agent_payload = {
                'user_id': user_id,
                'session_id': session_id,
                'message': clean_message,  # Use clean message for AI
                'originalMessage': message_text,  # Pass original message for storage (camelCase to match handler)
                'message_id': message_id,
                'model': model,
                'context_items': convert_floats_to_decimal(context_items),
                'uploaded_files': convert_floats_to_decimal(uploaded_files),  # Include uploaded files
                'source': 'file_handler'
            }
            
            # Invoke chat agent synchronously to get response
            lambda_client = boto3.client('lambda')
            response = lambda_client.invoke(
                FunctionName=chat_agent_function_name,
                InvocationType='RequestResponse',  # Synchronous invocation
                Payload=json_dumps_safe(agent_payload)
            )
            
            logger.info(f"✅ Successfully invoked chat agent: {response['StatusCode']}")
            
            # Parse the response
            response_payload = json.loads(response['Payload'].read().decode('utf-8'))
            logger.info(f"📨 Chat agent response: {json_dumps_safe(response_payload)}")
            
            if response_payload.get('statusCode') == 200:
                response_body = json.loads(response_payload.get('body', '{}'))
                ai_response = response_body.get('response', 'I apologize, but I encountered an error processing your request.')
                
                # Send AI response back to frontend via WebSocket
                try:
                    # Find active WebSocket connections for this user/session
                    active_connections = get_active_connections_for_user_session(user_id, session_id)
                    
                    if active_connections:
                        ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
                        
                        for connection_id in active_connections:
                            # Send user message confirmation first
                            user_message_confirmation = {
                                'type': 'message_received',
                                'message_id': message_id,
                                'session_id': session_id,
                                'timestamp': datetime.now().isoformat()
                            }
                            
                            send_message_to_client(connection_id, user_message_confirmation)
                            logger.info(f"📨 Sent user message confirmation to connection {connection_id}")
                            
                            # Send user message with files for display
                            user_message_display = {
                                'type': 'user_message_with_files',
                                'message_id': message_id,
                                'content': message_text,
                                'session_id': session_id,
                                'timestamp': datetime.now().isoformat(),
                                'files': file_metadata if file_metadata else []
                            }
                            
                            send_message_to_client(connection_id, user_message_display)
                            logger.info(f"📨 Sent user message with files to connection {connection_id}")
                            
                            # Send AI response
                            ai_response_message = {
                                'type': 'ai_response',
                                'message_id': ai_message_id,
                                'content': ai_response,
                                'session_id': session_id,
                                'timestamp': datetime.now().isoformat()
                            }
                            
                            send_message_to_client(connection_id, ai_response_message)
                            logger.info(f"📨 Sent AI response to connection {connection_id}")
                            
                            # Send session variables update to frontend
                            try:
                                # Get updated session variables from database
                                session_response = chat_sessions_table.get_item(
                                    Key={
                                        'user_id': user_id,
                                        'session_id': session_id
                                    }
                                )
                                
                                if 'Item' in session_response:
                                    session_item = session_response['Item']
                                    session_variables = session_item.get('session_variables', {})
                                    
                                    # Send session update message
                                    session_update_message = {
                                        'type': 'session_updated',
                                        'session_id': session_id,
                                        'session_variables': session_variables,
                                        'timestamp': datetime.now().isoformat()
                                    }
                                    
                                    send_message_to_client(connection_id, session_update_message)
                                    logger.info(f"📁 Sent session variables update to connection {connection_id}")
                                    
                            except Exception as e:
                                logger.error(f"❌ Failed to send session variables update: {str(e)}")
                                
                    else:
                        logger.warning(f"⚠️ No active connections found for user {user_id}, session {session_id}")
                        
                except Exception as e:
                    logger.error(f"❌ Failed to send AI response via WebSocket: {str(e)}")
            else:
                logger.error(f"❌ Chat agent returned error: {response_payload}")
                ai_response = 'I apologize, but I encountered an error processing your request.'
            
        except Exception as e:
            logger.error(f"❌ Failed to invoke chat agent: {str(e)}")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': f'Failed to invoke chat agent: {str(e)}'})
            }
        
        logger.info(f"✅ File Handler message processed successfully")
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({'message': 'Message processed successfully'})
        }
        
    except Exception as e:
        logger.error(f"Error processing File Handler message: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': f'Failed to process message: {str(e)}'})
        }

def process_message_direct(user_id, session_id, message_text, message_id, context_items, uploaded_files, model):
    """
    Process a message directly without WebSocket connection.
    Used for messages from File Handler.
    
    Args:
        user_id: User ID
        session_id: Session ID
        message_text: Message text
        message_id: Message ID
        context_items: Context items (excluding file references)
        uploaded_files: File uploads (separate from context items)
        model: AI model to use
        
    Returns:
        Processing result
    """
    try:
        logger.info(f"Processing direct message: {message_id}")
        
        # Check if session exists, create if needed
        session_exists = check_session_exists(user_id, session_id)
        if not session_exists:
            logger.info(f"🔍 Session {session_id} doesn't exist, creating it for first message")
            create_session_for_first_message(user_id, session_id, model)
        
        # Convert floats to Decimal for DynamoDB compatibility
        context_items_decimal = convert_floats_to_decimal(context_items)
        uploaded_files_decimal = convert_floats_to_decimal(uploaded_files)
        
        # Store context and uploaded files separately in session_variables for persistence
        if CONTEXT_BUILDER_AVAILABLE:
            context_summary = extract_context_summary(context_items)
            logger.info(f"📌 Context summary: {context_summary}")
            
            # Update session variables in DynamoDB
            try:
                context_summary_decimal = convert_floats_to_decimal(context_summary)
                
                # Prepare session variables with separate fields
                session_vars = {
                    'context_items': context_items_decimal,
                    'context_added_at': int(datetime.now().timestamp()),
                    'context_summary': context_summary_decimal,
                }
                
                # Add uploaded files if any
                if uploaded_files:
                    session_vars['uploaded_files'] = uploaded_files_decimal
                    session_vars['files_added_at'] = int(datetime.now().timestamp())
                
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                    ExpressionAttributeValues={
                        ':vars': session_vars,
                        ':updated': int(datetime.now().timestamp())
                    }
                )
                logger.info(f"📌 Stored context and uploaded files in session_variables")
            except Exception as e:
                logger.error(f"❌ Failed to store context in session_variables: {e}")
        
        # Store the original user message in the database first
        try:
            # Add user message to conversation history
            user_message_data = {
                'id': message_id,
                'role': 'user',
                'content': message_text,  # Store original message text
                'timestamp': int(datetime.now().timestamp() * 1000),
                'model': model
            }
            
            # Update conversation history in DynamoDB
            chat_sessions_table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET conversation_history = list_append(if_not_exists(conversation_history, :empty_list), :message)',
                ExpressionAttributeValues={
                    ':empty_list': [],
                    ':message': [user_message_data]
                }
            )
            logger.info(f"📌 Stored original user message in conversation history")
            
        except Exception as e:
            logger.error(f"❌ Failed to store user message: {e}")
        
        # Build context prompt for AI (but don't store this as the user message)
        if CONTEXT_BUILDER_AVAILABLE and (context_items or uploaded_files):
            # Combine context items and uploaded files for the AI prompt
            all_context_items = list(context_items)
            
            # Add uploaded files as context items for the AI
            for file_info in uploaded_files:
                all_context_items.append({
                    'type': 'file',
                    'title': f"Uploaded File: {file_info['filename']}",
                    'data': {
                        'original_filename': file_info['filename'],
                        's3_key': file_info['s3_key'],
                        's3_url': file_info['s3_url'],
                        'content_type': file_info['content_type'],
                        'file_size': file_info['file_size'],
                        'upload_timestamp': file_info['upload_timestamp']
                    }
                })
            
        # Send clean message to AI agent (let tools handle file access)
        clean_message = message_text
        logger.info(f"📌 Sending clean message to AI: '{clean_message}'")
        logger.info(f"📌 Files available via tools: {len(uploaded_files)} uploaded files")
        
        # Invoke chat agent with enriched message
        try:
            chat_agent_function_name = os.environ.get('CHAT_AGENT_FUNCTION_NAME')
            if not chat_agent_function_name:
                logger.error("CHAT_AGENT_FUNCTION_NAME not configured")
                return
            
            # Prepare payload for chat agent
            agent_payload = {
                'user_id': user_id,
                'session_id': session_id,
                'message': clean_message,  # Use clean message for AI
                'message_id': message_id,
                'model': model,
                'context_items': context_items_decimal,
                'uploaded_files': uploaded_files_decimal,  # Include uploaded files
                'source': 'file_handler'
            }
            
            # Invoke chat agent
            lambda_client = boto3.client('lambda')
            response = lambda_client.invoke(
                FunctionName=chat_agent_function_name,
                InvocationType='Event',  # Async invocation
                Payload=json_dumps_safe(agent_payload)
            )
            
            logger.info(f"✅ Successfully invoked chat agent: {response['StatusCode']}")
            
        except Exception as e:
            logger.error(f"❌ Failed to invoke chat agent: {str(e)}")
            raise
        
        return {'status': 'success'}
        
    except Exception as e:
        logger.error(f"❌ Error in process_message_direct: {str(e)}")
        raise

def handle_session_update(event):
    """
    Handle session update from Agent Files Processor
    
    Args:
        event: Session update event with user_id, session_id, and session_variables
        
    Returns:
        API Gateway response
    """
    try:
        user_id = event.get('user_id')
        session_id = event.get('session_id')
        session_variables = event.get('session_variables')
        
        if not user_id or not session_id or not session_variables:
            logger.error("Missing required fields in session update event")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Missing required fields'})
            }
        
        logger.info(f"📁 Processing session update for user {user_id}, session {session_id}")
        
        # Find active WebSocket connections for this user/session
        active_connections = get_active_connections_for_user_session(user_id, session_id)
        
        if active_connections:
            for connection_id in active_connections:
                try:
                    # Send session update message to client
                    session_update_message = {
                        'type': 'session_updated',
                        'session_id': session_id,
                        'session_variables': session_variables,
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    send_message_to_client(connection_id, session_update_message)
                    logger.info(f"📁 Sent session variables update to connection {connection_id}")
                    
                except Exception as e:
                    logger.error(f"❌ Failed to send session variables update to {connection_id}: {str(e)}")
        else:
            logger.warning(f"⚠️ No active connections found for user {user_id}, session {session_id}")
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({'message': 'Session update processed'})
        }
        
    except Exception as e:
        logger.error(f"❌ Error in handle_session_update: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': str(e)})
        }

def lambda_handler(event, context):
    """
    Lambda handler for WebSocket message processing, S3 event notifications, and File Handler invocations
    """
    try:
        # Log the incoming event for debugging
        logger.info(f"Received event: {json_dumps_safe(event)}")
        
        # Check if this is a direct Lambda invocation from File Handler
        if 'type' in event and event.get('type') == 'chat':
            logger.info("Processing message from File Handler")
            return handle_file_handler_message(event)
        
        # Check if this is a session update from Agent Files Processor
        if 'type' in event and event.get('type') == 'session_update':
            logger.info("Processing session update from Agent Files Processor")
            return handle_session_update(event)
        
        # Check if this is an S3 event notification (SNS)
        if 'Records' in event and event['Records'][0].get('EventSource') == 'aws:s3':
            logger.info("Processing S3 event notification")
            return handle_s3_event_notification(event)
        
        # Extract connection ID from the request context
        connection_id = event.get('requestContext', {}).get('connectionId')
        if not connection_id:
            logger.error("No connection ID found in request context")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No connection ID'})
            }
        
        # For WebSocket messages, get user ID from connection info in DynamoDB
        connection_info = get_connection_info(connection_id)
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
        
        # Get session_id from message data (sent by frontend)
        session_id = message_data.get('sessionId')
        logger.info(f"🔍 DEBUG: Message type: {message_data.get('type', 'chat')}, Extracted sessionId: {session_id}")
        
        # Session ID is required for all message types except connection_establish
        if not session_id and message_data.get('type') != 'connection_establish':
            logger.error(f"❌ No sessionId provided in message data for message type: {message_data.get('type', 'chat')}")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Session ID required'})
            }
        
        # Update connection record with session_id for future reference
        if session_id and ('session_id' not in connection_info or not connection_info.get('session_id')):
            update_connection_session(connection_id, session_id)
        
        # Process the WebSocket message
        logger.info(f"Processing WebSocket message for connection {connection_id}")
        return process_message(connection_id, user_id, session_id, message_data)
            
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Internal server error'})
        }