"""
SEC Search WebSocket Message Handler Lambda
Handles WebSocket messages for SEC search, streams progress, and sends results
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional

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

# Lambda client for invoking SEC search function
lambda_client = boto3.client('lambda')
SEC_SEARCH_FUNCTION_NAME = os.environ.get('SEC_SEARCH_FUNCTION_NAME')

# Store active connections and their search jobs
# In production, use DynamoDB or ElastiCache for this
active_connections = {}  # connection_id -> {'job_id': str, 'cancelled': bool}

def lambda_handler(event, context):
    """
    Main Lambda handler for WebSocket messages
    
    Args:
        event: WebSocket event from API Gateway
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    try:
        logger.info(f"Received WebSocket event: {json.dumps(event)}")
        
        # Extract route key and connection ID
        route_key = event.get('requestContext', {}).get('routeKey')
        connection_id = event.get('requestContext', {}).get('connectionId')
        
        if route_key == '$default' or route_key == 'message':
            # Handle message
            body = event.get('body', '{}')
            if isinstance(body, str):
                try:
                    message = json.loads(body)
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON in message body: {body}")
                    send_error(connection_id, "Invalid JSON in message")
                    return {'statusCode': 400}
            else:
                message = body
            
            return handle_message(connection_id, message)
        else:
            logger.warning(f"Unknown route key: {route_key}")
            return {'statusCode': 400}
            
    except Exception as e:
        logger.error(f"Error in message handler: {str(e)}", exc_info=True)
        return {'statusCode': 500}

def handle_message(connection_id: str, message: Dict[str, Any]):
    """
    Handle incoming WebSocket message
    
    Args:
        connection_id: WebSocket connection ID
        message: Parsed message from client
    """
    try:
        action = message.get('action')
        
        if action == 'search':
            return handle_search_request(connection_id, message)
        elif action == 'cancel':
            return handle_cancel_request(connection_id, message)
        else:
            send_error(connection_id, f"Unknown action: {action}")
            return {'statusCode': 400}
            
    except Exception as e:
        logger.error(f"Error handling message: {str(e)}", exc_info=True)
        send_error(connection_id, f"Error processing message: {str(e)}")
        return {'statusCode': 500}

def handle_search_request(connection_id: str, message: Dict[str, Any]):
    """
    Handle search request - invoke SEC search Lambda and stream progress
    
    Args:
        connection_id: WebSocket connection ID
        message: Search request message with search parameters
    """
    try:
        # Extract search parameters
        search_params = message.get('params', {})
        
        logger.info(f"Search request from connection {connection_id}: {search_params}")
        
        # Invoke SEC search Lambda asynchronously with WebSocket connection context
        # The Lambda will stream progress updates back through this connection
        invoke_payload = {
            'websocket_connection_id': connection_id,
            'websocket_endpoint': websocket_endpoint,
            'websocket_api_id': os.environ.get('WEBSOCKET_API_ID'),
            'search_params': search_params,
            'action': 'search'
        }
        
        # Invoke Lambda asynchronously
        response = lambda_client.invoke(
            FunctionName=SEC_SEARCH_FUNCTION_NAME,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(invoke_payload)
        )
        
        logger.info(f"Invoked SEC search Lambda: {response.get('StatusCode')}")
        
        # Send acknowledgment
        send_message(connection_id, {
            'type': 'search_started',
            'message': 'Search started, progress will be streamed'
        })
        
        return {'statusCode': 200}
        
    except Exception as e:
        logger.error(f"Error handling search request: {str(e)}", exc_info=True)
        send_error(connection_id, f"Failed to start search: {str(e)}")
        return {'statusCode': 500}

def handle_cancel_request(connection_id: str, message: Dict[str, Any]):
    """
    Handle cancel request - close WebSocket connection but continue search job
    
    Args:
        connection_id: WebSocket connection ID
        message: Cancel request message
    """
    try:
        logger.info(f"Cancel request from connection {connection_id}")
        
        # Mark connection as cancelled (search will continue but won't send updates)
        if connection_id in active_connections:
            active_connections[connection_id]['cancelled'] = True
        
        # Send acknowledgment before closing
        send_message(connection_id, {
            'type': 'cancelled',
            'message': 'Search cancelled - connection will close, but search will complete in background'
        })
        
        # Close the WebSocket connection
        try:
            api_gateway.delete_connection(ConnectionId=connection_id)
        except Exception as e:
            logger.warning(f"Could not close connection {connection_id}: {str(e)}")
        
        return {'statusCode': 200}
        
    except Exception as e:
        logger.error(f"Error handling cancel request: {str(e)}", exc_info=True)
        return {'statusCode': 500}

def send_message(connection_id: str, data: Dict[str, Any]):
    """
    Send message to WebSocket connection
    
    Args:
        connection_id: WebSocket connection ID
        data: Message data to send
    """
    try:
        if not api_gateway:
            logger.error("API Gateway client not initialized")
            return False
        
        api_gateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data)
        )
        logger.debug(f"Sent message to connection {connection_id}: {data.get('type', 'unknown')}")
        return True
    except Exception as e:
        error_str = str(e)
        if 'GoneException' in error_str or 'gone' in error_str.lower():
            logger.warning(f"Connection {connection_id} is gone")
            # Clean up connection
            if connection_id in active_connections:
                del active_connections[connection_id]
        else:
            logger.error(f"Error sending message to connection {connection_id}: {error_str}")
        return False

def send_error(connection_id: str, error_message: str):
    """Send error message to connection"""
    send_message(connection_id, {
        'type': 'error',
        'error': error_message
    })

def send_progress(connection_id: str, current_page: int, total_pages: Optional[int], results_count: int, total_found: int):
    """Send progress update to connection"""
    send_message(connection_id, {
        'type': 'progress',
        'current_page': current_page,
        'total_pages': total_pages,
        'results_count': results_count,
        'total_found': total_found
    })

def send_results(connection_id: str, results: Dict[str, Any]):
    """Send final search results to connection"""
    send_message(connection_id, {
        'type': 'results',
        **results
    })

def is_connection_cancelled(connection_id: str) -> bool:
    """Check if connection was cancelled"""
    return active_connections.get(connection_id, {}).get('cancelled', False)

