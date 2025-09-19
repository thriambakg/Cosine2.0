"""
WebSocket Message Processor Lambda
Handles chat messages and integrates with the existing chat agent
"""

import json
import os
import logging
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
        session_id = connection_info['session_id']
        
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
        message_id = f"msg_{int(datetime.now().timestamp() * 1000)}"
        
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
        ai_response = call_chat_agent(user_id, message_text, model, files)
        
        # Add AI response to session
        ai_message_id = f"msg_{int(datetime.now().timestamp() * 1000)}"
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

def call_chat_agent(user_id, message_text, model, files):
    """
    Call the existing chat agent Lambda function
    
    Args:
        user_id: User ID
        message_text: User's message
        model: Selected AI model
        files: Uploaded files
        
    Returns:
        AI response text
    """
    try:
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
