"""
SEC Search WebSocket Connection Manager Lambda
Handles WebSocket connections and disconnections for SEC search
"""

import json
import os
import logging
import boto3
from datetime import datetime, timedelta

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Get the WebSocket API Gateway endpoint from environment variable
websocket_endpoint = os.environ.get('WEBSOCKET_ENDPOINT')
if not websocket_endpoint:
    # Fallback: construct from API Gateway ID
    api_gateway_id = os.environ.get('WEBSOCKET_API_ID')
    if api_gateway_id:
        websocket_endpoint = f"https://{api_gateway_id}.execute-api.us-east-1.amazonaws.com/production"
    else:
        logger.error("WEBSOCKET_ENDPOINT and WEBSOCKET_API_ID not set")

# Convert wss:// to https:// for the API Gateway Management API
if websocket_endpoint and websocket_endpoint.startswith('wss://'):
    websocket_endpoint = websocket_endpoint.replace('wss://', 'https://')

api_gateway = None
if websocket_endpoint:
    api_gateway = boto3.client(
        'apigatewaymanagementapi',
        endpoint_url=websocket_endpoint
    )

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
        
        logger.info(f"User {user_id} connected with connection ID {connection_id} for SEC search")
        
        # Send welcome message
        if api_gateway:
            try:
                api_gateway.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps({
                        'type': 'connected',
                        'message': 'Connected to SEC search WebSocket'
                    })
                )
            except Exception as e:
                logger.warning(f"Could not send welcome message: {str(e)}")
        
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
        logger.info(f"Connection {connection_id} disconnected from SEC search WebSocket")
        
        # Note: We don't cancel the search job here - it continues in the background
        # The connection is just closed, but the Lambda will still complete the search
        
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

