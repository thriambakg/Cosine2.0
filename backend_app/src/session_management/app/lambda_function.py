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

def lambda_handler(event, context):
    """
    Lambda handler for session management operations
    
    Expected event structure:
    {
        "httpMethod": "GET|POST|PUT|DELETE",
        "pathParameters": {"session_id": "optional"},
        "queryStringParameters": {"user_id": "required"},
        "body": "JSON string for POST/PUT"
    }
    """
    try:
        # Parse request
        http_method = event.get('httpMethod', 'GET')
        user_id = event.get('queryStringParameters', {}).get('user_id')
        
        if not user_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'user_id is required'})
            }
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Route to appropriate handler
        if http_method == 'GET':
            session_id = event.get('pathParameters', {}).get('session_id')
            if session_id:
                return get_session(user_id, session_id)
            else:
                return list_sessions(user_id)
        elif http_method == 'POST':
            return create_session(user_id, json.loads(event.get('body', '{}')))
        elif http_method == 'PUT':
            session_id = event.get('pathParameters', {}).get('session_id')
            if not session_id:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'session_id is required for PUT'})
                }
            return update_session(user_id, session_id, json.loads(event.get('body', '{}')))
        elif http_method == 'DELETE':
            session_id = event.get('pathParameters', {}).get('session_id')
            if not session_id:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'session_id is required for DELETE'})
                }
            return delete_session(user_id, session_id)
        else:
            return {
                'statusCode': 405,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Method not allowed'})
            }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }

def list_sessions(user_id: str) -> Dict[str, Any]:
    """Get list of user's chat sessions"""
    try:
        # Query sessions for user, sorted by timestamp descending
        response = table.query(
            IndexName='UserSessionsIndex',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False,  # Most recent first
            Limit=50  # Limit to prevent large responses
        )
        
        # Group messages by session
        sessions = {}
        for item in response.get('Items', []):
            session_id = item['session_id']
            message_id = item['message_id']
            
            if session_id not in sessions:
                sessions[session_id] = {
                    'session_id': session_id,
                    'user_id': user_id,
                    'created_at': item['timestamp'],
                    'last_updated': item['timestamp'],
                    'title': item.get('title', f'Chat {session_id[:8]}'),
                    'message_count': 0,
                    'messages': []
                }
            
            # Add message to session
            if 'message_content' in item:
                sessions[session_id]['messages'].append({
                    'message_id': message_id,
                    'timestamp': item['timestamp'],
                    'content': item['message_content'],
                    'sender': item.get('sender', 'user'),
                    'message_type': item.get('message_type', 'text')
                })
                sessions[session_id]['message_count'] += 1
                sessions[session_id]['last_updated'] = max(sessions[session_id]['last_updated'], item['timestamp'])
        
        # Convert to list and sort by last_updated
        session_list = list(sessions.values())
        session_list.sort(key=lambda x: x['last_updated'], reverse=True)
        
        # Limit messages to last 10 per session for list view
        for session in session_list:
            session['messages'] = session['messages'][-10:] if len(session['messages']) > 10 else session['messages']
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({
                'sessions': session_list,
                'count': len(session_list)
            })
        }
    
    except Exception as e:
        logger.error(f"Error listing sessions: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to list sessions'})
        }

def get_session(user_id: str, session_id: str) -> Dict[str, Any]:
    """Get full session with all messages"""
    try:
        # Query all messages for the session
        response = table.query(
            KeyConditionExpression='session_id = :session_id',
            ExpressionAttributeValues={':session_id': session_id},
            ScanIndexForward=True  # Chronological order
        )
        
        if not response.get('Items'):
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Session not found'})
            }
        
        # Verify user owns this session
        first_item = response['Items'][0]
        if first_item.get('user_id') != user_id:
            return {
                'statusCode': 403,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Access denied'})
            }
        
        # Build session object
        messages = []
        session_metadata = None
        
        for item in response['Items']:
            if 'message_content' in item:
                messages.append({
                    'message_id': item['message_id'],
                    'timestamp': item['timestamp'],
                    'content': item['message_content'],
                    'sender': item.get('sender', 'user'),
                    'message_type': item.get('message_type', 'text'),
                    'metadata': item.get('metadata', {})
                })
            elif item['message_id'] == 'SESSION_METADATA':
                session_metadata = item
        
        if not session_metadata:
            # Create default metadata if not found
            session_metadata = {
                'session_id': session_id,
                'user_id': user_id,
                'title': f'Chat {session_id[:8]}',
                'created_at': messages[0]['timestamp'] if messages else int(time.time()),
                'model': 'claude-3-sonnet'
            }
        
        session_data = {
            'session_id': session_id,
            'user_id': user_id,
            'title': session_metadata.get('title', f'Chat {session_id[:8]}'),
            'created_at': session_metadata.get('created_at', int(time.time())),
            'last_updated': messages[-1]['timestamp'] if messages else session_metadata.get('created_at'),
            'model': session_metadata.get('model', 'claude-3-sonnet'),
            'message_count': len(messages),
            'messages': messages
        }
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps(session_data)
        }
    
    except Exception as e:
        logger.error(f"Error getting session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to get session'})
        }

def create_session(user_id: str, session_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new chat session"""
    try:
        session_id = str(uuid.uuid4())
        timestamp = int(time.time())
        title = session_data.get('title', f'New Chat {datetime.now().strftime("%m/%d %H:%M")}')
        model = session_data.get('model', 'claude-3-sonnet')
        
        # Create session metadata
        metadata_item = {
            'session_id': session_id,
            'message_id': 'SESSION_METADATA',
            'user_id': user_id,
            'timestamp': timestamp,
            'title': title,
            'model': model,
            'created_at': timestamp,
            'last_updated': timestamp,
            'message_count': 0,
            'expires_at': int(time.time()) + (30 * 24 * 60 * 60)  # 30 days TTL
        }
        
        # Store metadata
        table.put_item(Item=metadata_item)
        
        # Create welcome message if specified
        if session_data.get('create_welcome_message', True):
            welcome_item = {
                'session_id': session_id,
                'message_id': f'msg_{timestamp}_{uuid.uuid4().hex[:8]}',
                'user_id': user_id,
                'timestamp': timestamp + 1,  # Slightly after metadata
                'message_content': "Hello! I'm Cosine, your AI financial analyst. How can I help you today?",
                'sender': 'bot',
                'message_type': 'text',
                'expires_at': int(time.time()) + (30 * 24 * 60 * 60)
            }
            table.put_item(Item=welcome_item)
            
            # Update message count
            table.update_item(
                Key={'session_id': session_id, 'message_id': 'SESSION_METADATA'},
                UpdateExpression='SET message_count = :count',
                ExpressionAttributeValues={':count': 1}
            )
        
        return {
            'statusCode': 201,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({
                'session_id': session_id,
                'title': title,
                'model': model,
                'created_at': timestamp,
                'message_count': 1 if session_data.get('create_welcome_message', True) else 0
            })
        }
    
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to create session'})
        }

def update_session(user_id: str, session_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """Update session metadata or add messages"""
    try:
        # Check if session exists and user owns it
        response = table.get_item(
            Key={'session_id': session_id, 'message_id': 'SESSION_METADATA'}
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Session not found'})
            }
        
        if response['Item']['user_id'] != user_id:
            return {
                'statusCode': 403,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Access denied'})
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
            'body': json.dumps({'error': 'Failed to update session'})
        }

def add_messages_to_session(user_id: str, session_id: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Add messages to an existing session"""
    try:
        timestamp = int(time.time())
        added_count = 0
        
        for message in messages:
            message_id = f'msg_{timestamp}_{uuid.uuid4().hex[:8]}'
            
            message_item = {
                'session_id': session_id,
                'message_id': message_id,
                'user_id': user_id,
                'timestamp': timestamp,
                'message_content': message.get('content', ''),
                'sender': message.get('sender', 'user'),
                'message_type': message.get('message_type', 'text'),
                'metadata': message.get('metadata', {}),
                'expires_at': int(time.time()) + (30 * 24 * 60 * 60)
            }
            
            table.put_item(Item=message_item)
            added_count += 1
            timestamp += 1  # Ensure chronological order
        
        # Update session metadata
        table.update_item(
            Key={'session_id': session_id, 'message_id': 'SESSION_METADATA'},
            UpdateExpression='ADD message_count :count SET last_updated = :timestamp',
            ExpressionAttributeValues={
                ':count': added_count,
                ':timestamp': int(time.time())
            }
        )
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({
                'message': f'Added {added_count} messages to session',
                'added_count': added_count
            })
        }
    
    except Exception as e:
        logger.error(f"Error adding messages: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to add messages'})
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
            'body': json.dumps({'message': 'Session updated successfully'})
        }
    
    except Exception as e:
        logger.error(f"Error updating metadata: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to update session metadata'})
        }

def delete_session(user_id: str, session_id: str) -> Dict[str, Any]:
    """Delete a chat session and all its messages"""
    try:
        # First, verify user owns the session
        response = table.get_item(
            Key={'session_id': session_id, 'message_id': 'SESSION_METADATA'}
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Session not found'})
            }
        
        if response['Item']['user_id'] != user_id:
            return {
                'statusCode': 403,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Access denied'})
            }
        
        # Query all messages in the session
        response = table.query(
            KeyConditionExpression='session_id = :session_id',
            ExpressionAttributeValues={':session_id': session_id}
        )
        
        # Delete all items in batch
        with table.batch_writer() as batch:
            for item in response['Items']:
                batch.delete_item(
                    Key={
                        'session_id': item['session_id'],
                        'message_id': item['message_id']
                    }
                )
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'message': 'Session deleted successfully'})
        }
    
    except Exception as e:
        logger.error(f"Error deleting session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to delete session'})
        }
