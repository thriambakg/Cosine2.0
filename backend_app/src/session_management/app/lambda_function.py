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
sns_client = boto3.client('sns')

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

def process_session_request(event, context):
    """
    Process session request (extracted from lambda_handler for reuse)
    """
    try:
        # Parse request
        http_method = event.get('httpMethod', 'GET')
        path = event.get('path', '')
        query_params = event.get('queryStringParameters') or {}
        # Support both userId and user_id for compatibility
        user_id = query_params.get('user_id') or query_params.get('userId') if query_params else None
        
        if not user_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'user_id or userId is required'})
            }
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Route to export/import/share handlers based on path
        # Normalize path for matching (remove leading/trailing slashes and stage prefix)
        normalized_path = path.strip('/').lower()
        if '/production/' in normalized_path or '/staging/' in normalized_path:
            # Remove stage prefix if present
            normalized_path = normalized_path.split('/', 1)[-1] if '/' in normalized_path else normalized_path
        
        if 'session-share' in normalized_path or normalized_path.endswith('share'):
            return handle_share_session(user_id, http_method, event)
        elif 'session-import' in normalized_path or normalized_path.endswith('import'):
            return handle_import_session(user_id, http_method, event)
        elif 'session-export' in normalized_path or normalized_path.endswith('export'):
            return handle_export_session(user_id, http_method, event)
        
        # Route to appropriate handler for standard session operations
        session_id = query_params.get('session_id') if query_params else None
        if http_method == 'GET':
            if session_id:
                return get_session(user_id, session_id)
            else:
                return list_sessions(user_id)
        elif http_method == 'POST':
            body = event.get('body', '{}')
            body_data = json.loads(body) if body else {}
            
            # Check if this is a kill signal request
            if body_data.get('action') == 'kill_session':
                session_id = body_data.get('session_id')
                reason = body_data.get('reason', 'user_cancellation')
                return kill_session(user_id, session_id, reason)
            else:
                return create_session(user_id, body_data)
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
            messages = item.get('messages', [])
            session = {
                'session_id': item['session_id'],
                'user_id': user_id,
                'created_at': item['created_at'],
                'last_updated': item.get('last_updated', item['created_at']),
                'title': item.get('title', f'Chat {item["session_id"][:8]}'),
                'model': item.get('model', 'claude-sonnet-4'),
                'message_count': len(messages),  # Use actual message count from array
                'messages': messages,
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
            'model': session_data.get('model', 'claude-sonnet-4'),
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
        model = session_data.get('model', 'claude-sonnet-4')
        
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
            # Get existing session_variables to merge with new data
            response = table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            # Get existing session_variables or create empty dict
            existing_session_vars = response.get('Item', {}).get('session_variables', {})
            
            # Merge new session_variables with existing ones
            merged_session_vars = {
                **existing_session_vars,  # Preserve existing data
                **convert_floats_to_decimal(metadata['session_variables'])  # Add new data
            }
            
            update_expression_parts.append('session_variables = :session_variables')
            expression_attribute_values[':session_variables'] = merged_session_vars
        
        if update_expression_parts:
            update_expression_parts.append('last_updated = :timestamp')
            expression_attribute_values[':timestamp'] = int(time.time())
            
            table.update_item(
                Key={'user_id': user_id, 'session_id': session_id},
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

def kill_session(user_id: str, session_id: str, reason: str = 'user_cancellation') -> Dict[str, Any]:
    """Set kill flag for a session to stop any active processing"""
    try:
        logger.info(f"🔴 KILL: Setting kill flag for session {session_id}, reason: {reason}")
        
        if not session_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'session_id is required'})
            }
        
        # Set kill flag in the session to stop any active chat agent processing
        try:
            timestamp_ms = int(datetime.now().timestamp() * 1000)
            table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET killed_at = :kill_timestamp, kill_reason = :kill_reason',
                ExpressionAttributeValues={
                    ':kill_timestamp': timestamp_ms,
                    ':kill_reason': reason
                },
                ConditionExpression='attribute_exists(user_id) AND attribute_exists(session_id)'
            )
            logger.info(f"🔴 KILL: Successfully set kill flag for session {session_id}")
        except Exception as kill_error:
            logger.error(f"❌ KILL: Failed to set kill flag for session {session_id}: {str(kill_error)}")
            return {
                'statusCode': 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Failed to set kill flag'})
            }
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({
                'message': 'Kill signal sent successfully',
                'session_id': session_id,
                'reason': reason,
                'killed_at': timestamp_ms
            })
        }
        
    except Exception as e:
        logger.error(f"❌ KILL: Error setting kill flag: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Failed to set kill flag'})
        }

def handle_share_session(user_id: str, http_method: str, event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle session sharing operations (export for download or share link)"""
    if http_method != 'POST':
        return {
            'statusCode': 405,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Method not allowed'})
        }
    
    try:
        from exporter import ChatSessionExporter
        
        body = json.loads(event.get('body', '{}'))
        session_id = body.get('sessionId')
        share_type = body.get('shareType', 'download')  # 'link' or 'download'
        
        if not session_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'sessionId is required'})
            }
        
        # Get session title
        response = table.get_item(Key={'user_id': user_id, 'session_id': session_id})
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        session_title = response['Item'].get('title', 'Untitled')
        
        # Initialize exporter
        exporter = ChatSessionExporter()
        
        if share_type == 'link':
            result = exporter.export_for_share_link(user_id, session_id)
            if result.get('success'):
                # Generate share link (frontend will construct the full URL)
                share_id = result.get('share_id')
                return {
                    'statusCode': 200,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({
                        'success': True,
                        'shareId': share_id,
                        'shareLink': f"/import-chat?shareId={share_id}"
                    })
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe(result)
                }
        else:  # download
            result = exporter.export_for_download(user_id, session_id, session_title)
            if result.get('success'):
                # Transform snake_case to camelCase to match frontend expectations (consistent with dashboard)
                return {
                    'statusCode': 200,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({
                        'success': True,
                        'downloadUrl': result.get('download_url'),
                        'shareId': result.get('share_id'),
                        'expiresIn': result.get('expires_in'),
                    })
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe(result)
                }
            
    except Exception as e:
        logger.error(f"❌ Error handling share session: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': f'Failed to share session: {str(e)}'})
        }


def handle_export_session(user_id: str, http_method: str, event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle session export operations (alias for share with download type)"""
    # This is essentially the same as share with download type
    return handle_share_session(user_id, http_method, event)


def handle_import_session(user_id: str, http_method: str, event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle session import operations (from file or share link)"""
    if http_method != 'POST':
        return {
            'statusCode': 405,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Method not allowed'})
        }
    
    try:
        from importer import ChatSessionImporter
        
        body = json.loads(event.get('body', '{}'))
        import_type = body.get('importType')  # 'file' or 'link'
        
        if not import_type:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'importType is required'})
            }
        
        # Initialize importer
        importer = ChatSessionImporter()
        
        if import_type == 'file':
            file_content_base64 = body.get('fileContent')
            if not file_content_base64:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({'error': 'fileContent is required for file import'})
                }
            
            # Decode base64 file content
            import base64 as b64
            file_content = b64.b64decode(file_content_base64)
            
            result = importer.import_from_file(file_content, user_id)
            return {
                'statusCode': 200 if result.get('success') else 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe(result)
            }
            
        elif import_type == 'link':
            share_id = body.get('shareId')
            if not share_id:
                return {
                    'statusCode': 400,
                    'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                    'body': json_dumps_safe({'error': 'shareId is required for link import'})
                }
            
            result = importer.import_from_share_link(share_id, user_id)
            return {
                'statusCode': 200 if result.get('success') else 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe(result)
            }
        else:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Invalid importType. Must be "file" or "link"'})
            }
            
    except Exception as e:
        logger.error(f"❌ Error handling import session: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': f'Failed to import session: {str(e)}'})
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


def lambda_handler(event, context):
    """
    Lambda handler for session management operations
    
    Expected event structure:
    {
        "httpMethod": "GET|POST|PUT|DELETE",
        "queryStringParameters": {"user_id": "required", "session_id": "required for specific session operations"},
        "body": "JSON string for POST/PUT"
    }
    
    Or from SQS:
    {
        "Records": [
            {
                "body": "{\"request_id\": \"...\", \"api_gateway_event\": {...}}"
            }
        ]
    }
    """
    completion_sns_topic = os.environ.get('SESSION_MANAGEMENT_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract request_id and API Gateway event
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', {})
                
                logger.info(f"📬 Processing SQS message - request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
                # Process the request
                try:
                    result = process_session_request(event, context)
                    
                    # Publish completion notification
                    if completion_sns_topic:
                        sns_client.publish(
                            TopicArn=completion_sns_topic,
                            Message=json.dumps({
                                'request_id': request_id,
                                'status': 'completed',
                                'response': result
                            }),
                            MessageAttributes={
                                'request_id': {
                                    'DataType': 'String',
                                    'StringValue': request_id
                                }
                            }
                        )
                    
                    return result
                except Exception as e:
                    logger.error(f"❌ Error processing SQS event: {str(e)}", exc_info=True)
                    
                    # Publish failure notification
                    if completion_sns_topic:
                        sns_client.publish(
                            TopicArn=completion_sns_topic,
                            Message=json.dumps({
                                'request_id': request_id,
                                'status': 'failed',
                                'error': str(e)
                            }),
                            MessageAttributes={
                                'request_id': {
                                    'DataType': 'String',
                                    'StringValue': request_id
                                }
                            }
                        )
                    
                    raise
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'body': json_dumps_safe({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    # Regular API Gateway or direct invocation
    return process_session_request(event, context)
