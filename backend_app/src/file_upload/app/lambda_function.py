import json
import os
import boto3
import uuid
from datetime import datetime
import logging
import time

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

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
        
        # Files uploaded successfully, update session variables and proceed to WebSocket processor
        
        # Update session variables in DynamoDB
        session_variables_updated = False
        try:
            session_variables_updated = update_session_variables(
                user_id, session_id, uploaded_files, context_items
            )
            logger.info(f"Session variables update result: {session_variables_updated}")
        except Exception as e:
            logger.error(f"Error updating session variables: {str(e)}")
            # Continue anyway - files are uploaded
        
        # Now send enriched message to WebSocket processor via direct Lambda invocation
        # The WebSocket processor will handle storing the message and sending responses
        try:
            send_enriched_message_to_websocket(
                user_id, session_id, message, uploaded_files, context_items, session_variables_updated
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

def update_session_variables(user_id, session_id, uploaded_files, context_items):
    """
    Update session_variables in DynamoDB with uploaded files and context items.
    
    Args:
        user_id: User ID
        session_id: Session ID
        uploaded_files: List of uploaded file metadata
        context_items: Existing context items
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Get table name from environment
        table_name = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
        if not table_name:
            logger.error("CHAT_SESSIONS_TABLE_NAME not configured")
            return False
            
        table = dynamodb.Table(table_name)
        
        # Convert floats to Decimal for DynamoDB compatibility
        def convert_floats_to_decimal(obj):
            if isinstance(obj, float):
                from decimal import Decimal
                return Decimal(str(obj))
            elif isinstance(obj, dict):
                return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_floats_to_decimal(item) for item in obj]
            else:
                return obj
        
        uploaded_files_decimal = convert_floats_to_decimal(uploaded_files)
        context_items_decimal = convert_floats_to_decimal(context_items)
        
        # Get existing session_variables to merge with new data
        response = table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' in response:
            # Get existing session_variables or create empty dict
            existing_session_vars = response.get('Item', {}).get('session_variables', {})
            
            # Merge uploaded files and context items into session_variables
            merged_session_vars = {
                **existing_session_vars,  # Preserve existing data
                'uploaded_files': uploaded_files_decimal,
                'context_items': context_items_decimal
            }
            
            # Update the session with merged session_variables
            table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                ExpressionAttributeValues={
                    ':vars': merged_session_vars,
                    ':updated': int(datetime.utcnow().timestamp())
                }
            )
            
            logger.info(f"📌 Successfully updated session_variables for session {session_id}")
            return True
        else:
            logger.error(f"❌ Session {session_id} not found for user {user_id}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Failed to update session_variables: {str(e)}")
        return False

def send_enriched_message_to_websocket(user_id, session_id, message, uploaded_files, context_items, session_variables_updated):
    """
    Send enriched message with file references to WebSocket processor.
    
    Args:
        user_id: User ID
        session_id: Session ID  
        message: Original message data
        uploaded_files: List of uploaded file metadata with S3 keys/URLs
        context_items: Existing context items
        session_variables_updated: Boolean indicating if session variables were successfully updated
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
            'model': 'claude-opus-4-1',  # Default model
            'sessionId': session_id,
            'userId': user_id,
            'timestamp': message.get('timestamp', int(datetime.utcnow().timestamp() * 1000)),
            'session_variables_updated': session_variables_updated  # Confirmation field
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
