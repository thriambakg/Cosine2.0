import json
import os
import boto3
import uuid
from datetime import datetime
import logging
import time
from boto3.dynamodb.conditions import Key

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client('s3')
sns_client = boto3.client('sns')

def lambda_handler(event, context):
    """
    Handle file upload requests with message orchestration via REST API.
    
    Expected event structure:
    {
        "user_id": "string",
        "session_id": "string",
        "message": {
            "id": "string",
            "text": "string", 
            "timestamp": "number"
        },
        "files": [
            {
                "filename": "string",
                "content_type": "string",
                "data": "base64_encoded_data"
            }
        ],
        "context_items": []
    }
    """
    try:
        logger.info(f"File upload request received: {json.dumps(event, default=str)}")
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        user_id = body.get('user_id')
        session_id = body.get('session_id')
        message = body.get('message', {})
        files = body.get('files', [])
        context_items = body.get('context_items', [])
        
        if not user_id or not session_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Missing required fields: user_id and session_id'
                })
            }
        
        if not message.get('id') or not message.get('text'):
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Missing required message fields: id and text'
                })
            }
        
        if not files:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'error': 'No files provided'
                })
            }
        
        # Get environment variables
        bucket_name = os.environ['CHAT_FILES_BUCKET_NAME']
        sns_topic_arn = os.environ['SNS_TOPIC_ARN']
        
        # Process each file
        uploaded_files = []
        
        for file_data in files:
            filename = file_data.get('filename')
            content_type = file_data.get('content_type', 'application/octet-stream')
            data = file_data.get('data')
            
            if not filename or not data:
                logger.warning(f"Skipping invalid file: {filename}")
                continue
            
            try:
                # Generate unique file ID
                file_id = str(uuid.uuid4())
                correlation_id = str(uuid.uuid4())
                
                # Create S3 key
                s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}"
                
                # Decode base64 data
                import base64
                file_content = base64.b64decode(data)
                file_size = len(file_content)
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=s3_key,
                    Body=file_content,
                    ContentType=content_type,
                    Metadata={
                        'user_id': user_id,
                        'session_id': session_id,
                        'file_id': file_id,
                        'filename': filename,
                        'content_type': content_type,
                        'file_type': 'chat_upload',
                        'correlation_id': correlation_id,
                        'upload_timestamp': str(int(datetime.utcnow().timestamp()))
                    }
                )
                
                # Create S3 URL
                s3_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
                
                uploaded_files.append({
                    'file_id': file_id,
                    'filename': filename,
                    's3_key': s3_key,
                    's3_url': s3_url,
                    'content_type': content_type,
                    'file_size': file_size,
                    'upload_timestamp': str(int(datetime.utcnow().timestamp()))
                })
                
                logger.info(f"Successfully uploaded file: {filename} to {s3_key}")
                
            except Exception as e:
                logger.error(f"Error uploading file {filename}: {str(e)}")
                continue
        
        if not uploaded_files:
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Failed to upload any files'
                })
            }
        
        # Send SNS notification for each uploaded file
        for file_info in uploaded_files:
            try:
                sns_message = {
                    'Records': [{
                        's3': {
                            'bucket': {'name': bucket_name},
                            'object': {'key': file_info['s3_key']}
                        }
                    }]
                }
                
                sns_client.publish(
                    TopicArn=sns_topic_arn,
                    Message=json.dumps(sns_message),
                    Subject=f"File uploaded: {file_info['filename']}"
                )
                
                logger.info(f"Sent SNS notification for file: {file_info['filename']}")
                
            except Exception as e:
                logger.error(f"Error sending SNS notification for {file_info['filename']}: {str(e)}")
        
        # Wait for SNS confirmation (simplified - in production, use proper async handling)
        logger.info("Waiting for SNS confirmation...")
        time.sleep(2)  # Give SNS time to process
        
        # Now send enriched message to WebSocket processor
        try:
            # Check if there are active WebSocket connections for this user/session
            active_connections = get_active_connections_for_user_session(user_id, session_id)
            
            if active_connections:
                logger.info(f"Found {len(active_connections)} active connections for user {user_id}, session {session_id}")
                # Send message through WebSocket for real-time response
                send_message_through_websocket(
                    user_id, session_id, message, uploaded_files, context_items, active_connections
                )
            else:
                logger.warning(f"No active WebSocket connections found for user {user_id}, session {session_id}")
                # Fallback to direct Lambda invocation
                send_enriched_message_to_websocket(
                    user_id, session_id, message, uploaded_files, context_items
                )
            
            logger.info("Successfully sent enriched message to WebSocket processor")
        except Exception as e:
            logger.error(f"Error sending enriched message to WebSocket processor: {str(e)}")
            # Continue anyway - files are uploaded
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            'body': json.dumps({
                'message': f'Successfully uploaded {len(uploaded_files)} file(s) and sent message to WebSocket processor',
                'uploaded_files': uploaded_files
            })
        }
        
    except Exception as e:
        logger.error(f"Error in file upload handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            'body': json.dumps({
                'error': f'Internal server error: {str(e)}'
            })
        }

# Note: File metadata is now passed in message payload instead of storing in DynamoDB

def send_enriched_message_to_websocket(user_id, session_id, message, uploaded_files, context_items):
    """
    Send enriched message with file references to WebSocket processor.
    
    Args:
        user_id: User ID
        session_id: Session ID  
        message: Original message data
        uploaded_files: List of uploaded file metadata with S3 keys/URLs
        context_items: Existing context items
    """
    try:
        # Get WebSocket processor function name from environment
        websocket_function_name = os.environ.get('WEBSOCKET_PROCESSOR_FUNCTION_NAME')
        if not websocket_function_name:
            logger.error("WEBSOCKET_PROCESSOR_FUNCTION_NAME not configured")
            return
        
        # Keep context items separate from file uploads
        # File uploads will be stored in a separate uploaded_files field
        enriched_context_items = list(context_items)
        
        # Create message payload for WebSocket processor
        websocket_payload = {
            'type': 'chat',
            'messageId': message['id'],
            'message': message['text'],
            'contextItems': enriched_context_items,
            'uploadedFiles': uploaded_files,  # Separate file uploads
            'model': 'claude-3-sonnet',  # Default model
            'sessionId': session_id,
            'userId': user_id,
            'timestamp': message.get('timestamp', int(datetime.utcnow().timestamp() * 1000))
        }
        
        # Invoke WebSocket processor Lambda
        lambda_client = boto3.client('lambda')
        response = lambda_client.invoke(
            FunctionName=websocket_function_name,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(websocket_payload)
        )
        
        logger.info(f"Successfully invoked WebSocket processor: {response['StatusCode']}")
        
    except Exception as e:
        logger.error(f"Error invoking WebSocket processor: {str(e)}")
        raise

def get_active_connections_for_user_session(user_id, session_id):
    """
    Get active WebSocket connections for a user and session.
    
    Args:
        user_id: User ID
        session_id: Session ID
        
    Returns:
        List of active connection IDs
    """
    try:
        dynamodb = boto3.resource('dynamodb')
        connections_table = dynamodb.Table(os.environ.get('CONNECTIONS_TABLE_NAME', 'cosine-connections-production'))
        
        # Query connections for this user
        response = connections_table.query(
            IndexName='user_id-index',
            KeyConditionExpression=Key('user_id').eq(user_id)
        )
        
        active_connections = []
        for connection in response.get('Items', []):
            if connection.get('session_id') == session_id and connection.get('status') == 'active':
                active_connections.append(connection['connection_id'])
        
        logger.info(f"Found {len(active_connections)} active connections for user {user_id}, session {session_id}")
        return active_connections
        
    except Exception as e:
        logger.error(f"Error getting active connections: {str(e)}")
        return []

def send_message_through_websocket(user_id, session_id, message, uploaded_files, context_items, active_connections):
    """
    Send message through WebSocket for real-time response.
    
    Args:
        user_id: User ID
        session_id: Session ID
        message: Message data
        uploaded_files: List of uploaded files
        context_items: Context items
        active_connections: List of active connection IDs
    """
    try:
        # Convert uploaded files to context items format
        all_context_items = list(context_items)
        
        # Add uploaded files as context items
        for file_info in uploaded_files:
            all_context_items.append({
                'type': 'file',
                'title': f"Uploaded File: {file_info['filename']}",
                'data': {
                    'original_filename': file_info['filename'],
                    's3_key': file_info['s3_key'],
                    's3_url': file_info['s3_url'],
                    'content_type': file_info['content_type'],
                    'file_size': file_info['file_size'],
                    'upload_timestamp': file_info['upload_timestamp']
                }
            })
        
        # Create message data for WebSocket
        message_data = {
            'type': 'chat',
            'sessionId': session_id,
            'message': message['text'],
            'messageId': message['id'],
            'contextItems': all_context_items,
            'timestamp': message.get('timestamp', int(datetime.utcnow().timestamp() * 1000))
        }
        
        # Send message to each active connection
        for connection_id in active_connections:
            try:
                # Send message through WebSocket
                send_websocket_message(connection_id, message_data)
                logger.info(f"Sent message to connection {connection_id}")
            except Exception as e:
                logger.error(f"Error sending message to connection {connection_id}: {str(e)}")
        
    except Exception as e:
        logger.error(f"Error sending message through WebSocket: {str(e)}")
        raise

def send_websocket_message(connection_id, message_data):
    """
    Send message through WebSocket connection.
    
    Args:
        connection_id: WebSocket connection ID
        message_data: Message data to send
    """
    try:
        # Get WebSocket API Gateway URL from environment
        websocket_url = os.environ.get('WEBSOCKET_API_URL')
        if not websocket_url:
            logger.error("WEBSOCKET_API_URL not configured")
            return
        
        # Create WebSocket client
        websocket_client = boto3.client('apigatewaymanagementapi', endpoint_url=websocket_url)
        
        # Send message
        response = websocket_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message_data)
        )
        
        logger.info(f"Successfully sent message to connection {connection_id}")
        
    except Exception as e:
        logger.error(f"Error sending WebSocket message: {str(e)}")
        raise
