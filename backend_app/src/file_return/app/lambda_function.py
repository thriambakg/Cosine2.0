"""
AWS Lambda function for secure file returns
Validates user identity and pushes file messages to chat interface
"""

import json
import os
import logging
import time
import uuid
import boto3
from typing import Dict, Any, List
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
apigateway_client = boto3.client('apigatewaymanagementapi')

# Environment variables
S3_BUCKET = os.environ.get('S3_BUCKET', 'cosine-uploads')
WEBSOCKET_ENDPOINT = os.environ.get('WEBSOCKET_ENDPOINT')
SESSIONS_TABLE = os.environ.get('SESSIONS_TABLE', 'cosine-sessions')

def convert_decimals(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    return obj

def validate_user_identity(event: Dict[str, Any]) -> str:
    """
    Extract and validate the authenticated user ID from the request
    This should match your authentication mechanism (Cognito, JWT, etc.)
    """
    try:
        # Extract user ID from request context (adjust based on your auth setup)
        request_context = event.get('requestContext', {})
        
        # Option 1: From API Gateway authorizer context
        authorizer = request_context.get('authorizer', {})
        user_id = authorizer.get('user_id') or authorizer.get('sub')
        
        # Option 2: From headers (if using custom auth)
        if not user_id:
            headers = event.get('headers', {})
            user_id = headers.get('x-user-id') or headers.get('X-User-Id')
        
        # Option 3: From request body (for internal service calls)
        if not user_id:
            body = json.loads(event.get('body', '{}'))
            user_id = body.get('authenticated_user_id')
        
        if not user_id:
            raise ValueError("No authenticated user ID found in request")
        
        logger.info(f"🔐 Authenticated user ID: {user_id}")
        return user_id
        
    except Exception as e:
        logger.error(f"❌ User validation failed: {str(e)}")
        raise ValueError(f"Authentication failed: {str(e)}")

def validate_session_access(user_id: str, session_id: str) -> bool:
    """
    Validate that the user has access to the specified session
    """
    try:
        table = dynamodb.Table(SESSIONS_TABLE)
        response = table.get_item(
            Key={
                'session_id': session_id,
                'user_id': user_id
            }
        )
        
        if 'Item' not in response:
            logger.warning(f"🚫 Session {session_id} not found for user {user_id}")
            return False
        
        logger.info(f"✅ Session {session_id} validated for user {user_id}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Session validation failed: {str(e)}")
        return False

def generate_presigned_url(s3_key: str, expiration: int = 3600) -> str:
    """
    Generate a presigned URL for S3 object access
    """
    try:
        response = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': S3_BUCKET, 'Key': s3_key},
            ExpiresIn=expiration
        )
        logger.info(f"🔗 Generated presigned URL for {s3_key}")
        return response
    except Exception as e:
        logger.error(f"❌ Failed to generate presigned URL: {str(e)}")
        raise

def get_session_files(session_id: str, user_id: str, file_indices: List[int] = None) -> List[Dict[str, Any]]:
    """
    Retrieve session files from DynamoDB and prepare file data
    """
    try:
        table = dynamodb.Table(SESSIONS_TABLE)
        response = table.get_item(
            Key={
                'session_id': session_id,
                'user_id': user_id
            }
        )
        
        if 'Item' not in response:
            raise ValueError(f"Session {session_id} not found")
        
        session_data = response['Item']
        files = session_data.get('files', [])
        
        if not files:
            logger.warning(f"📁 No files found in session {session_id}")
            return []
        
        # Filter files by indices if specified
        if file_indices is not None:
            if 'all' in file_indices:
                selected_files = files
            else:
                selected_files = [files[i] for i in file_indices if 0 <= i < len(files)]
        else:
            selected_files = files
        
        # Prepare file data with presigned URLs
        file_data = []
        for file_info in selected_files:
            try:
                s3_key = file_info.get('s3_key')
                if not s3_key:
                    logger.warning(f"⚠️ No S3 key found for file: {file_info}")
                    continue
                
                # Generate presigned URL
                download_url = generate_presigned_url(s3_key)
                
                file_data.append({
                    'filename': file_info.get('filename', 'Unknown'),
                    'file_type': file_info.get('file_type', 'application/octet-stream'),
                    'file_size': file_info.get('file_size', 0),
                    'download_url': download_url,
                    'uploaded_at': file_info.get('uploaded_at', int(time.time()))
                })
                
            except Exception as e:
                logger.error(f"❌ Failed to process file {file_info}: {str(e)}")
                continue
        
        logger.info(f"📁 Prepared {len(file_data)} files for return")
        return file_data
        
    except Exception as e:
        logger.error(f"❌ Failed to get session files: {str(e)}")
        raise

def create_agent_file(session_id: str, user_id: str, filename: str, content: str, file_type: str = 'text/plain') -> Dict[str, Any]:
    """
    Create a new file in the agent files folder and return file data
    """
    try:
        # Create S3 key for agent file
        timestamp = int(time.time())
        s3_key = f"users/{user_id}/sessions/{session_id}/agentfiles/{timestamp}_{filename}"
        
        # Upload content to S3
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=content.encode('utf-8'),
            ContentType=file_type
        )
        
        # Generate presigned URL
        download_url = generate_presigned_url(s3_key)
        
        file_data = {
            'filename': filename,
            'file_type': file_type,
            'file_size': len(content.encode('utf-8')),
            'download_url': download_url,
            'uploaded_at': timestamp
        }
        
        logger.info(f"📁 Created agent file: {filename}")
        return file_data
        
    except Exception as e:
        logger.error(f"❌ Failed to create agent file: {str(e)}")
        raise

def send_message_to_chat(user_id: str, session_id: str, message: str, file_data: List[Dict[str, Any]] = None) -> bool:
    """
    Send message with file data to the chat interface via WebSocket
    """
    try:
        if not WEBSOCKET_ENDPOINT:
            logger.warning("⚠️ WebSocket endpoint not configured")
            return False
        
        # Get the WebSocket connection ID from DynamoDB
        table = dynamodb.Table(SESSIONS_TABLE)
        response = table.get_item(
            Key={
                'session_id': session_id,
                'user_id': user_id
            }
        )
        
        if 'Item' not in response:
            logger.error(f"❌ Session {session_id} not found for user {user_id}")
            return False
        
        session_data = response['Item']
        connection_id = session_data.get('connection_id')
        
        if not connection_id:
            logger.warning(f"⚠️ No WebSocket connection found for session {session_id}")
            return False
        
        # Prepare message payload
        message_payload = {
            'type': 'agent_file_return',
            'message': message,
            'file_data': file_data or [],
            'timestamp': int(time.time())
        }
        
        # Send via WebSocket
        try:
            apigateway_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(message_payload)
            )
            logger.info(f"📤 Message sent to WebSocket connection {connection_id}: {len(file_data or [])} files")
            return True
        except apigateway_client.exceptions.GoneException:
            logger.warning(f"⚠️ WebSocket connection {connection_id} is gone")
            return False
        except Exception as e:
            logger.error(f"❌ Failed to send WebSocket message: {str(e)}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Failed to send message to chat: {str(e)}")
        return False

def send_message_to_chat_rest(user_id: str, session_id: str, message: str, file_data: List[Dict[str, Any]] = None) -> bool:
    """
    Send message with file data to the chat interface via REST endpoint
    This is used for large payloads that exceed WebSocket limits
    """
    try:
        # For now, we'll use the session management endpoint to add the message
        # This ensures the message is persisted in DynamoDB and can be retrieved by the frontend
        
        table = dynamodb.Table(SESSIONS_TABLE)
        
        # Prepare message data
        timestamp = int(time.time())
        message_data = {
            'id': f'msg_{timestamp}_{uuid.uuid4().hex[:8]}',
            'text': message,
            'sender': 'agent',
            'timestamp': timestamp,
            'message_type': 'agent_file_return',
            'file_data': file_data or []
        }
        
        # Add message to session
        response = table.update_item(
            Key={
                'session_id': session_id,
                'user_id': user_id
            },
            UpdateExpression='SET messages = list_append(if_not_exists(messages, :empty_list), :message)',
            ExpressionAttributeValues={
                ':empty_list': [],
                ':message': [message_data]
            },
            ReturnValues='UPDATED_NEW'
        )
        
        logger.info(f"📤 Message added to session {session_id}: {len(file_data or [])} files")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to send REST message: {str(e)}")
        return False

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for secure file returns and message sending
    """
    try:
        logger.info(f"🔍 File return request: {json.dumps(event, default=str)}")
        
        # Parse request body
        body = json.loads(event.get('body', '{}'))
        
        # Validate user identity
        authenticated_user_id = validate_user_identity(event)
        
        # Handle file return requests (always use REST endpoint for large payloads)
        return handle_file_return(event, body, authenticated_user_id)
            
    except Exception as e:
        logger.error(f"❌ Lambda handler error: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            },
            'body': json.dumps({'error': 'Internal server error'})
        }

def handle_file_return(event: Dict[str, Any], body: Dict[str, Any], authenticated_user_id: str) -> Dict[str, Any]:
    """
    Handle file return requests
    """
    try:
        # Extract request parameters
        session_id = body.get('session_id')
        user_id = body.get('user_id')  # User ID from the request
        action = body.get('action')  # 'return_files' or 'create_file'
        
        if not session_id or not user_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({'error': 'Missing required parameters: session_id, user_id'})
            }
        
        # SECURITY: Validate that the authenticated user matches the requested user
        if authenticated_user_id != user_id:
            logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to access files for user {user_id}")
            return {
                'statusCode': 403,
                'body': json.dumps({'error': 'Access denied: User ID mismatch'})
            }
        
        # Validate session access
        if not validate_session_access(user_id, session_id):
            return {
                'statusCode': 403,
                'body': json.dumps({'error': 'Access denied: Session not found or access denied'})
            }
        
        file_data = []
        message = ""
        
        if action == 'return_files':
            # Return existing session files
            file_indices = body.get('file_indices', ['all'])
            file_data = get_session_files(session_id, user_id, file_indices)
            message = f"Returned {len(file_data)} files from your session"
            
        elif action == 'create_file':
            # Create new agent file
            filename = body.get('filename')
            content = body.get('content')
            file_type = body.get('file_type', 'text/plain')
            
            if not filename or not content:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'Missing required parameters for file creation: filename, content'})
                }
            
            file_data = [create_agent_file(session_id, user_id, filename, content, file_type)]
            message = f"Created new file: {filename}"
            
        else:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid action. Must be "return_files" or "create_file"'})
            }
        
        # Send message to chat interface via REST endpoint (for large payloads)
        rest_sent = send_message_to_chat_rest(user_id, session_id, message, file_data)
        
        if rest_sent:
            logger.info(f"✅ File return completed and sent to chat: {len(file_data)} files for user {user_id}")
            # Return success response
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({
                    'success': True,
                    'message': 'Files sent to chat interface',
                    'file_count': len(file_data)
                })
            }
        else:
            logger.warning(f"⚠️ File return completed but failed to send to chat: {len(file_data)} files for user {user_id}")
            # Return the file data in HTTP response as fallback
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({
                    'success': True,
                    'message': message,
                    'file_data': file_data,
                    'session_id': session_id,
                    'user_id': user_id,
                    'timestamp': int(time.time()),
                    'websocket_sent': False
                }, default=str)
            }
        
    except ValueError as e:
        logger.error(f"❌ Validation error: {str(e)}")
        return {
            'statusCode': 400,
            'body': json.dumps({'error': str(e)})
        }
        
    except Exception as e:
        logger.error(f"❌ File return failed: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }
