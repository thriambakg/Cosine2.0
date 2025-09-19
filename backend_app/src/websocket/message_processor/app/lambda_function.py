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

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

def json_dumps_safe(obj):
    """JSON dumps with Decimal support for DynamoDB"""
    def decimal_default(obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
    
    return json.dumps(obj, default=decimal_default)

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
        session_id = message_data.get('sessionId')
        if not session_id:
            logger.error(f"No sessionId provided in message data")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Session ID required'})
            }
        
        # Update connection record with session_id for future reference
        # Only update if session_id field doesn't exist or is None
        if 'session_id' not in connection_info or not connection_info.get('session_id'):
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
        message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
        
        logger.info(f"Processing message type: {message_type} for connection {connection_id}")
        logger.info(f"Full message data: {message_data}")
        
        # Handle connection establishment message
        if message_type == 'connection_establish':
            logger.info(f"Processing connection establishment message for connection {connection_id}")
            # Send connection established message
            connection_message = {
                'type': 'connection_established',
                'session_id': session_id,
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
        
        # Add user message to session
        timestamp = int(datetime.now().timestamp())
        user_message = {
            'id': message_id,
            'text': message_text,
            'sender': 'user',
            'timestamp': timestamp,
            'message_type': 'text',
            'files': files if files else None
        }
        
        # Get current session and add user message
        try:
            response = chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' in response:
                session_item = response['Item']
                messages = session_item.get('messages', [])
                messages.append(user_message)
                
                # Update session with new message
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :timestamp',
                    ExpressionAttributeValues={
                        ':messages': messages,
                        ':count': len(messages),
                        ':timestamp': timestamp
                    }
                )
        except Exception as e:
            logger.error(f"Error saving user message: {str(e)}")
        
        # Send acknowledgment to user
        ack_message = {
            'type': 'message_received',
            'message_id': message_id,
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, ack_message)
        
        # Call the existing chat agent Lambda
        ai_response = call_chat_agent(user_id, message_text, model, files, session_id)
        
        # Add AI response to session
        ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
        ai_timestamp = int(datetime.now().timestamp())
        ai_message = {
            'id': ai_message_id,
            'text': ai_response,
            'sender': 'bot',
            'timestamp': ai_timestamp,
            'message_type': 'text'
        }
        
        # Get current session and add AI message
        try:
            response = chat_sessions_table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' in response:
                session_item = response['Item']
                messages = session_item.get('messages', [])
                messages.append(ai_message)
                
                # Update session with AI message
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :timestamp',
                    ExpressionAttributeValues={
                        ':messages': messages,
                        ':count': len(messages),
                        ':timestamp': ai_timestamp
                    }
                )
        except Exception as e:
            logger.error(f"Error saving AI message: {str(e)}")
        
        # Send AI response to client
        ai_response_message = {
            'type': 'ai_response',
            'message_id': ai_message_id,
            'content': ai_response,
            'timestamp': datetime.now().isoformat()
        }
        
        send_message_to_client(connection_id, ai_response_message)
        
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

def call_chat_agent(user_id, message_text, model, files, session_id):
    """
    Call the existing chat agent Lambda function with kill signal checking
    
    Args:
        user_id: User ID
        message_text: User's message
        model: Selected AI model
        files: Uploaded files
        session_id: Session ID
        
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
        
        # Truncate messages after the edited message
        original_message_count = len(messages)
        truncated_messages = messages[:message_to_edit_index + 1]  # Keep messages up to and including the edited one
        truncated_messages[-1]['text'] = new_text  # Update the edited message text
        
        logger.info(f"✅ EDIT: Successfully truncated {original_message_count} messages to {len(truncated_messages)} messages")
        logger.info(f"✅ EDIT: Updated message text from '{message_to_edit.get('text', '')[:50]}...' to '{new_text[:50]}...'")
        
        # Update the session with truncated messages
        timestamp = int(datetime.now().timestamp())
        chat_sessions_table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET messages = :messages, message_count = :message_count, last_updated = :last_updated',
            ExpressionAttributeValues={
                ':messages': truncated_messages,
                ':message_count': len(truncated_messages),
                ':last_updated': timestamp
            }
        )
        
        logger.info(f"✅ EDIT: Updated session {session_id} in DynamoDB with {len(truncated_messages)} truncated messages")
        
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
            logger.info(f"✅ EDIT: Chat agent generated response, length: {len(ai_response.get('response', ''))}")
            
            # Add AI response to session
            ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"
            ai_timestamp = int(datetime.now().timestamp())
            ai_message = {
                'id': ai_message_id,
                'text': ai_response,
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
            
            send_message_to_client(connection_id, ai_response_message)
            
            logger.info(f"✅ EDIT: Successfully sent AI response for edited message {message_id}")
        else:
            logger.error(f"❌ EDIT: Failed to get AI response for edited message {message_id}")
            error_message = {
                'type': 'error',
                'message': 'Failed to generate response for edited message',
                'timestamp': datetime.now().isoformat()
            }
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
