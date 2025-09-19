"""
WebSocket Connection Manager Lambda
Handles WebSocket connections and disconnections for the chat system
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

# DynamoDB tables
chat_connections_table = dynamodb.Table(os.environ['CHAT_CONNECTIONS_TABLE_NAME'])
chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])

def lambda_handler(event, context):
    """
    Main Lambda handler for WebSocket connection management
    
    Args:
        event: WebSocket event from API Gateway
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract route key and connection ID
        route_key = event.get('requestContext', {}).get('routeKey')
        connection_id = event.get('requestContext', {}).get('connectionId')
        
        logger.info(f"Route key: {route_key}, Connection ID: {connection_id}")
        
        if route_key == '$connect':
            return handle_connect(event, connection_id)
        elif route_key == '$disconnect':
            return handle_disconnect(event, connection_id)
        else:
            logger.warning(f"Unknown route key: {route_key}")
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Unknown route key'})
            }
            
    except Exception as e:
        logger.error(f"Error in connection manager: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }

def handle_connect(event, connection_id):
    """
    Handle WebSocket connection
    
    Args:
        event: WebSocket connect event
        connection_id: WebSocket connection ID
        
    Returns:
        API Gateway response
    """
    try:
        # Extract user information from query parameters or headers
        query_params = event.get('queryStringParameters', {}) or {}
        user_id = query_params.get('userId')
        
        if not user_id:
            logger.warning("No user ID provided in connection request")
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'User ID required'})
            }
        
        # Store connection in DynamoDB without session ID
        # Session ID will be determined by the messages sent through this connection
        connection_item = {
            'connection_id': connection_id,
            'user_id': user_id,
            'connected_at': int(datetime.now().timestamp()),
            'expires_at': int((datetime.now() + timedelta(hours=24)).timestamp())
        }
        
        chat_connections_table.put_item(Item=connection_item)
        
        logger.info(f"User {user_id} connected with connection ID {connection_id}")
        
        # Don't send immediate welcome message - let the client establish the connection first
        # The client should send a message to trigger the welcome response
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Connected successfully'
            })
        }
        
    except Exception as e:
        logger.error(f"Error handling connect: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Failed to establish connection'})
        }

def handle_disconnect(event, connection_id):
    """
    Handle WebSocket disconnection
    
    Args:
        event: WebSocket disconnect event
        connection_id: WebSocket connection ID
        
    Returns:
        API Gateway response
    """
    try:
        # Remove connection from DynamoDB
        response = chat_connections_table.delete_item(
            Key={'connection_id': connection_id},
            ReturnValues='ALL_OLD'
        )
        
        deleted_item = response.get('Attributes')
        if deleted_item:
            user_id = deleted_item.get('user_id')
            session_id = deleted_item.get('session_id', 'unknown')
            logger.info(f"User {user_id} disconnected from session {session_id}")
        else:
            logger.warning(f"Connection {connection_id} not found in database")
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Disconnected successfully'})
        }
        
    except Exception as e:
        logger.error(f"Error handling disconnect: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Failed to handle disconnection'})
        }

def send_message_to_connection(connection_id, message_data):
    """
    Send a message to a WebSocket connection with error handling
    
    Args:
        connection_id: WebSocket connection ID
        message_data: Message data to send
        
    Returns:
        bool: True if message sent successfully, False otherwise
    """
    try:
        api_gateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message_data)
        )
        logger.info(f"Message sent successfully to connection {connection_id}")
        return True
    except Exception as e:
        if 'GoneException' in str(e) or 'gone' in str(e).lower():
            logger.warning(f"Connection {connection_id} was closed - cannot send message")
        else:
            logger.error(f"Error sending message to connection {connection_id}: {str(e)}")
        return False
