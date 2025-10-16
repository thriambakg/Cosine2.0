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

def lambda_handler(event, context):
    """
    Main Lambda handler for WebSocket message processing
    
    Args:
        event: WebSocket message event from API Gateway
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    try:
        logger.info(f"Received event: {json_dumps_safe(event)}")
        
        # Extract connection ID and message body
        connection_id = event.get('requestContext', {}).get('connectionId')
        body = event.get('body', '{}')
        
        if isinstance(body, str):
            message_data = json.loads(body)
        else:
            message_data = body
        
        logger.info(f"Processing message for connection {connection_id}: {message_data}")
        
        # Get connection info from DynamoDB
        connection_info = get_connection_info(connection_id)
        if not connection_info:
            logger.error(f"Connection {connection_id} not found")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Connection not found'})
            }
        
        user_id = connection_info['user_id']
        
        # Get session_id from message data (sent by frontend)
        logger.info(f"🔍 DEBUG: Full message_data received: {json_dumps_safe(message_data)}")
        logger.info(f"🔍 DEBUG: message_data keys: {list(message_data.keys()) if message_data else 'None'}")
        
        message_type = message_data.get('type', 'chat')
        session_id = message_data.get('sessionId')
        logger.info(f"🔍 DEBUG: Message type: {message_type}, Extracted sessionId: {session_id}")
        
        # Session ID is required for all message types except connection_establish
        if not session_id and message_type != 'connection_establish':
            logger.error(f"❌ No sessionId provided in message data for message type: {message_type}")
            logger.error(f"❌ Available keys in message_data: {list(message_data.keys()) if message_data else 'None'}")
            logger.error(f"❌ Full message_data: {json_dumps_safe(message_data)}")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Session ID required'})
            }
        
        # Update connection record with session_id for future reference
        # Only update if session_id field doesn't exist or is None, and we have a session_id
        if session_id and ('session_id' not in connection_info or not connection_info.get('session_id')):
            update_connection_session(connection_id, session_id)
        
        # Process the message
        return process_message(connection_id, user_id, session_id, message_data)
        
    except Exception as e:
        logger.error(f"Error in message processor: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Internal server error'})
        }

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
        model = message_data.get('model', 'claude-3-sonnet')
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
        
        # Extract context items from message data (if present)
        context_items = message_data.get('contextItems', [])
        
        # Note: Files are now handled via REST endpoint, not through WebSocket
        # The WebSocket processor only handles context items (tiles, stocks, etc.)
        
        # Load any existing uploaded files from session for additional context
        uploaded_files = load_uploaded_files_from_session(user_id, session_id)
        if uploaded_files:
            logger.info(f"📁 Found {len(uploaded_files)} existing uploaded files in session")
            # Add existing files to context items
            for file_metadata in uploaded_files:
                context_items.append({
                    'type': 'file',
                    'title': f"Uploaded File: {file_metadata.get('original_filename', 'Unknown')}",
                    'data': file_metadata
                })
        
        has_context = len(context_items) > 0
        
        # Store the original user message (without context prompt) for frontend display
        original_user_message = message_text
        
        if has_context:
            logger.info(f"📌 Context-aware message detected with {len(context_items)} context items")
            logger.info(f"📌 Context items preview: {json_dumps_safe(context_items[:1])}")  # Log first item
            
            # Store context in session_variables for persistence
            if CONTEXT_BUILDER_AVAILABLE:
                context_summary = extract_context_summary(context_items)
                logger.info(f"📌 Context summary: {context_summary}")
                
                # Update session variables in DynamoDB
                try:
                    # Convert all floats to Decimal for DynamoDB compatibility
                    context_items_decimal = convert_floats_to_decimal(context_items)
                    context_summary_decimal = convert_floats_to_decimal(context_summary)
                    
                    chat_sessions_table.update_item(
                        Key={
                            'user_id': user_id,
                            'session_id': session_id
                        },
                        UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                        ExpressionAttributeValues={
                            ':vars': {
                                'context_items': context_items_decimal,
                                'context_added_at': int(datetime.now().timestamp()),
                                'context_summary': context_summary_decimal,
                            },
                            ':updated': int(datetime.now().timestamp())
                        }
                    )
                    logger.info(f"📌 Stored context in session_variables")
                except Exception as e:
                    logger.error(f"❌ Failed to store context in session_variables: {e}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                
                # Build enriched prompt with context (for AI only)
                try:
                    enriched_message = build_context_prompt(message_text, context_items)
                    logger.info(f"📌 Enhanced message with context (length: {len(enriched_message)})")
                    logger.info(f"📌 Enriched message preview (first 500 chars): {enriched_message[:500]}")
                    
                    # Send the enriched message to AI, but keep original for frontend
                    message_text = enriched_message
                except Exception as e:
                    logger.error(f"❌ Failed to build context prompt: {e}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
            else:
                logger.warning(f"⚠️ Context builder not available, passing context items to chat agent for processing")
        
        # Call the existing chat agent Lambda (with enriched message if context present)
        # Pass original_user_message so the chat agent can store it for display
        ai_response = call_chat_agent(
            user_id, 
            message_text,  # Enriched message for AI
            model, 
            files, 
            session_id, 
            context_items if has_context else None,
            original_user_message if has_context else None  # Original message for frontend display
        )
        
        # Note: AI response is already added by the chat agent Lambda
        # No need to add it here to avoid duplicates
        ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
        logger.info(f"AI response already processed by chat agent: {ai_message_id}")
        
        # Send AI response to client (only if connection is still associated with this session)
        connection_info = get_connection_info(connection_id)
        current_session_id = connection_info.get('session_id') if connection_info else None
        
        if current_session_id == session_id:
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

def call_chat_agent(user_id, message_text, model, files, session_id, context_items=None, original_user_message=None):
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
        model = message_data.get('model', 'claude-3-sonnet')
        
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

def handle_file_upload(connection_id, user_id, session_id, message_data):
    """
    Handle file upload processing
    
    Args:
        connection_id: WebSocket connection ID
        user_id: User ID
        session_id: Session ID
        message_data: File upload data
        
    Returns:
        API Gateway response
    """
    try:
        if not FILE_UPLOAD_AVAILABLE:
            logger.error("❌ File upload handler not available")
            return {
                'statusCode': 500,
                'body': json_dumps_safe({'error': 'File upload not available'})
            }
        
        # Extract file data from message
        files = message_data.get('files', [])
        if not files:
            logger.warning("⚠️ No files provided in upload message")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No files provided'})
            }
        
        processed_files = []
        
        for file_data in files:
            try:
                # Validate file upload
                if not validate_file_upload(file_data):
                    logger.warning(f"⚠️ Invalid file upload: {file_data.get('filename', 'unknown')}")
                    continue
                
                # Process file upload (decompress and upload to S3)
                file_metadata = process_file_upload(
                    compressed_file_data=file_data,
                    user_id=user_id,
                    session_id=session_id
                )
                
                processed_files.append(file_metadata)
                logger.info(f"✅ File processed successfully: {file_metadata['original_filename']}")
                
            except Exception as e:
                logger.error(f"❌ Failed to process file {file_data.get('filename', 'unknown')}: {str(e)}")
                continue
        
        if not processed_files:
            logger.error("❌ No files were successfully processed")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No files were successfully processed'})
            }
        
        # Store file metadata in session for chat agent access
        try:
            store_file_metadata_in_session(user_id, session_id, processed_files)
            logger.info(f"✅ Stored {len(processed_files)} files in session {session_id}")
        except Exception as e:
            logger.error(f"❌ Failed to store file metadata in session: {str(e)}")
            # Continue anyway - files are uploaded to S3
        
        # Send success response to client
        success_message = {
            'type': 'file_upload_success',
            'files': processed_files,
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, success_message)
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({'message': 'Files uploaded successfully', 'files': processed_files})
        }
        
    except Exception as e:
        logger.error(f"❌ Error handling file upload: {str(e)}")
        
        # Send error response to client
        error_message = {
            'type': 'file_upload_error',
            'error': 'Failed to process file upload',
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, error_message)
        
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Failed to process file upload'})
        }

def load_uploaded_files_from_session(user_id: str, session_id: str) -> List[Dict[str, Any]]:
    """
    Load uploaded files from session for context
    
    Args:
        user_id: User ID
        session_id: Session ID
        
    Returns:
        List of file metadata with content
    """
    try:
        # Get session from DynamoDB
        response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        session_item = response.get('Item', {})
        uploaded_files = session_item.get('uploaded_files', [])
        
        if not uploaded_files:
            return []
        
        # Load file content from S3 for each file
        files_with_content = []
        for file_metadata in uploaded_files:
            try:
                s3_key = file_metadata.get('s3_key')
                if s3_key:
                    # Note: File content loading is now handled by the REST endpoint
                    # For now, just include the file metadata without content
                    logger.info(f"📁 File metadata available for: {file_metadata.get('original_filename', 'Unknown')}")
                    files_with_content.append(file_metadata)
                else:
                    # Add file without content if S3 key is missing
                    files_with_content.append(file_metadata)
            except Exception as e:
                logger.error(f"❌ Failed to load content for file {file_metadata.get('original_filename', 'Unknown')}: {str(e)}")
                # Add file without content
                files_with_content.append(file_metadata)
        
        logger.info(f"📁 Loaded {len(files_with_content)} files with content for context")
        return files_with_content
        
    except Exception as e:
        logger.error(f"❌ Failed to load uploaded files from session: {str(e)}")
        return []

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
        # Query the connections table for active connections
        response = chat_connections_table.query(
            IndexName='user_id-session_id-index',  # Assuming this GSI exists
            KeyConditionExpression=Key('user_id').eq(user_id) & Key('session_id').eq(session_id),
            FilterExpression=Attr('connection_status').eq('active')
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
    These messages already have files uploaded and enriched with S3 references.
    
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
        model = event.get('model', 'claude-3-sonnet')
        
        if not user_id or not session_id:
            logger.error("Missing user_id or session_id in File Handler message")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Missing user_id or session_id'})
            }
        
        logger.info(f"Processing File Handler message: user={user_id}, session={session_id}, context_items={len(context_items)}")
        
        # Process the message like a regular WebSocket message
        # but without needing a connection ID since it's direct invocation
        result = process_message_direct(user_id, session_id, message_text, message_id, context_items, model)
        
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

def process_message_direct(user_id, session_id, message_text, message_id, context_items, model):
    """
    Process a message directly without WebSocket connection.
    Used for messages from File Handler.
    
    Args:
        user_id: User ID
        session_id: Session ID
        message_text: Message text
        message_id: Message ID
        context_items: Context items (including file references)
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
        
        # Store context in session_variables for persistence
        if CONTEXT_BUILDER_AVAILABLE:
            context_summary = extract_context_summary(context_items)
            logger.info(f"📌 Context summary: {context_summary}")
            
            # Update session variables in DynamoDB
            try:
                context_summary_decimal = convert_floats_to_decimal(context_summary)
                
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                    ExpressionAttributeValues={
                        ':vars': {
                            'context_items': context_items_decimal,
                            'context_added_at': int(datetime.now().timestamp()),
                            'context_summary': context_summary_decimal,
                        },
                        ':updated': int(datetime.now().timestamp())
                    }
                )
                logger.info(f"📌 Stored context in session_variables")
            except Exception as e:
                logger.error(f"❌ Failed to store context in session_variables: {e}")
        
        # Build context prompt for AI
        if CONTEXT_BUILDER_AVAILABLE and context_items:
            enriched_message = build_context_prompt(message_text, context_items)
            logger.info(f"📌 Built enriched message with context")
        else:
            enriched_message = message_text
            logger.info(f"📌 Using original message (no context builder or no context items)")
        
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
                'message': enriched_message,
                'message_id': message_id,
                'model': model,
                'context_items': context_items_decimal,
                'source': 'file_handler'
            }
            
            # Invoke chat agent
            lambda_client = boto3.client('lambda')
            response = lambda_client.invoke(
                FunctionName=chat_agent_function_name,
                InvocationType='Event',  # Async invocation
                Payload=json.dumps(agent_payload)
            )
            
            logger.info(f"✅ Successfully invoked chat agent: {response['StatusCode']}")
            
        except Exception as e:
            logger.error(f"❌ Failed to invoke chat agent: {str(e)}")
            raise
        
        return {'status': 'success'}
        
    except Exception as e:
        logger.error(f"❌ Error in process_message_direct: {str(e)}")
        raise

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
        
        # Extract user ID from query parameters or headers
        user_id = event.get('queryStringParameters', {}).get('userId')
        if not user_id:
            logger.error("No user ID found in query parameters")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'No user ID'})
            }
        
        # Extract session ID from query parameters
        session_id = event.get('queryStringParameters', {}).get('sessionId')
        
        # Handle different event types
        if 'Records' in event:
            # This is an SNS event (S3 notification)
            logger.info(f"Processing SNS event for connection {connection_id}")
            return handle_sns_event(connection_id, user_id, session_id, event)
        else:
            # This is a WebSocket message
            logger.info(f"Processing WebSocket message for connection {connection_id}")
            return handle_websocket_message(connection_id, user_id, session_id, event)
            
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': 'Internal server error'})
        }