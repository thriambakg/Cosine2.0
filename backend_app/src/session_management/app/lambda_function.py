"""
Session Management Lambda Function
Handles CRUD operations for chat sessions
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])

def get_cors_headers() -> Dict[str, str]:
    """Get standard CORS headers"""
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
    
def json_dumps_safe(obj: Any) -> str:
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

def lambda_handler(event, context):
    """
    Lambda handler for session management operations
    
    Expected event structure:
    {
        "httpMethod": "GET|POST|PUT|DELETE",
        "queryStringParameters": {"user_id": "required", "session_id": "required for specific session operations"},
        "body": "JSON string for POST/PUT"
    }
    """
    try:
        # Parse request
        http_method = event.get('httpMethod', 'GET')
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('user_id') if query_params else None
        
        if not user_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'user_id is required'})
            }
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Route to appropriate handler
        session_id = query_params.get('session_id') if query_params else None
        if http_method == 'GET':
            if session_id:
                return get_session(user_id, session_id)
            else:
                return list_sessions(user_id)
        elif http_method == 'POST':
            body = event.get('body', '{}')
            return create_session(user_id, json.loads(body) if body else {})
        elif http_method == 'PUT':
            if not session_id:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({'error': 'session_id is required for PUT'})
                }
            body = event.get('body', '{}')
            return update_session(user_id, session_id, json.loads(body) if body else {})
        elif http_method == 'DELETE':
            if not session_id:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({'error': 'session_id is required for DELETE'})
                }
            return delete_session(user_id, session_id)
        else:
            return {
                'statusCode': 405,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Method not allowed'})
            }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Internal server error'})
        }

def list_sessions(user_id: str) -> Dict[str, Any]:
    """Get list of user's chat sessions"""
    try:
        # Query sessions for user, sorted by creation date descending
        response = table.query(
            IndexName='CreatedAtIndex',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False,  # Most recent first
            Limit=50  # Limit to prevent large responses
        )
        
        # Convert items to session list (each item is a complete session)
        session_list = []
        for item in response.get('Items', []):
            session = {
                'session_id': item['session_id'],
                'user_id': user_id,
                'created_at': item['created_at'],
                'last_updated': item.get('last_updated', item['created_at']),
                'title': item.get('title', f'Chat {item["session_id"][:8]}'),
                'model': item.get('model', 'claude-3-sonnet'),
                'message_count': item.get('message_count', 0),
                'messages': item.get('messages', []),
                'session_variables': item.get('session_variables', {})
            }
            session_list.append(session)
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({
                'sessions': session_list,
                'count': len(session_list)
            })
        }
    
    except Exception as e:
        logger.error(f"Error listing sessions: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to list sessions'})
        }

def get_session(user_id: str, session_id: str) -> Dict[str, Any]:
    """Get full session with all messages"""
    try:
        # Get the specific session using both user_id (PK) and session_id (SK)
        response = table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        session_data = response['Item']
        
        # Ensure messages array exists and is properly formatted
        messages = session_data.get('messages', [])
        if not isinstance(messages, list):
            messages = []
        
        # Format session data
        session_data = {
            'session_id': session_id,
            'user_id': user_id,
            'title': session_data.get('title', f'Chat {session_id[:8]}'),
            'created_at': session_data.get('created_at', int(time.time())),
            'last_updated': session_data.get('last_updated', session_data.get('created_at')),
            'model': session_data.get('model', 'claude-3-sonnet'),
            'message_count': len(messages),
            'messages': messages,
            'session_variables': session_data.get('session_variables', {})
        }
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe(session_data)
        }
    
    except Exception as e:
        logger.error(f"Error getting session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to get session'})
        }

def create_session(user_id: str, session_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new chat session"""
    try:
        session_id = str(uuid.uuid4())
        timestamp = int(time.time())
        title = session_data.get('title', f'New Chat {datetime.now().strftime("%m/%d %H:%M")}')
        model = session_data.get('model', 'claude-3-sonnet')
        
        # Create single session item (no welcome message)
        session_item = {
            'user_id': user_id,
            'session_id': session_id,
            'title': title,
            'model': model,
            'created_at': timestamp,
            'last_updated': timestamp,
            'message_count': 0,
            'messages': [],
            'expires_at': int(time.time()) + (30 * 24 * 60 * 60)  # 30 days TTL
        }
        
        # Store session
        table.put_item(Item=session_item)
        
        return {
            'statusCode': 201,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({
                'session_id': session_id,
                'title': title,
                'model': model,
                'created_at': timestamp,
                'message_count': session_item['message_count']
            })
        }
    
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to create session'})
        }

def update_session(user_id: str, session_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """Update session metadata or add messages"""
    try:
        # Check if session exists and user owns it
        response = table.get_item(
            Key={'user_id': user_id, 'session_id': session_id}
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        if response['Item']['user_id'] != user_id:
            return {
                'statusCode': 403,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Access denied'})
            }
        
        # Handle different update types
        if 'messages' in update_data:
            # Add messages to session
            return add_messages_to_session(user_id, session_id, update_data['messages'])
        else:
            # Update session metadata
            return update_session_metadata(user_id, session_id, update_data)
    
    except Exception as e:
        logger.error(f"Error updating session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to update session'})
        }

def add_messages_to_session(user_id: str, session_id: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Add messages to an existing session"""
    try:
        # Get current session
        response = table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        session_item = response['Item']
        current_messages = session_item.get('messages', [])
        
        # Add new messages
        timestamp = int(time.time())
        for i, message in enumerate(messages):
            new_message = {
                'id': message.get('id', f'msg_{timestamp + i}_{uuid.uuid4().hex[:8]}'),
                'text': message.get('content', message.get('text', '')),
                'sender': message.get('sender', 'user'),
                'timestamp': message.get('timestamp', timestamp + i),
                'message_type': message.get('message_type', 'text')
            }
            current_messages.append(new_message)
        
        # Update session with new messages
        table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :timestamp',
            ExpressionAttributeValues={
                ':messages': current_messages,
                ':count': len(current_messages),
                ':timestamp': timestamp
            }
        )
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({
                'message': f'Added {len(messages)} messages to session',
                'added_count': len(messages)
            })
        }
    
    except Exception as e:
        logger.error(f"Error adding messages: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to add messages'})
        }

def update_session_metadata(user_id: str, session_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Update session metadata (title, model, etc.)"""
    try:
        # Build update expression
        update_expression_parts = []
        expression_attribute_values = {}
        
        if 'title' in metadata:
            update_expression_parts.append('title = :title')
            expression_attribute_values[':title'] = metadata['title']
        
        if 'model' in metadata:
            update_expression_parts.append('model = :model')
            expression_attribute_values[':model'] = metadata['model']
        
        if 'session_variables' in metadata:
            update_expression_parts.append('session_variables = :session_variables')
            # Convert floats to Decimal for DynamoDB compatibility
            expression_attribute_values[':session_variables'] = convert_floats_to_decimal(metadata['session_variables'])
        
        if update_expression_parts:
            update_expression_parts.append('last_updated = :timestamp')
            expression_attribute_values[':timestamp'] = int(time.time())
            
            table.update_item(
                Key={'session_id': session_id, 'message_id': 'SESSION_METADATA'},
                UpdateExpression='SET ' + ', '.join(update_expression_parts),
                ExpressionAttributeValues=expression_attribute_values
            )
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'message': 'Session updated successfully'})
        }
    
    except Exception as e:
        logger.error(f"Error updating metadata: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to update session metadata'})
        }

def delete_session(user_id: str, session_id: str) -> Dict[str, Any]:
    """Delete a chat session and send kill signal to any active processing"""
    try:
        logger.info(f"🔴 KILL: Starting session deletion for session {session_id}")
        
        # First, set a kill flag in the session to stop any active chat agent processing
        try:
            table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET killed_at = :kill_timestamp, kill_reason = :kill_reason',
                ExpressionAttributeValues={
                    ':kill_timestamp': int(datetime.now().timestamp()),
                    ':kill_reason': 'session_deleted'
                },
                ConditionExpression='attribute_exists(user_id) AND attribute_exists(session_id)'
            )
            logger.info(f"🔴 KILL: Set kill flag for session {session_id}")
        except Exception as kill_error:
            logger.warning(f"⚠️ KILL: Could not set kill flag for session {session_id}: {str(kill_error)}")
        
        # Wait a moment for the kill signal to propagate
        time.sleep(0.5)
        
        # Delete the session item using both user_id (PK) and session_id (SK)
        table.delete_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        logger.info(f"✅ KILL: Successfully deleted session {session_id}")
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'message': 'Session deleted successfully'})
        }
    
    except Exception as e:
        logger.error(f"❌ KILL: Error deleting session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to delete session'})
        }
