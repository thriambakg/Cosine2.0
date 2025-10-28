import json
import os
import boto3
import uuid
from datetime import datetime
import logging
import time
from decimal import Decimal
from typing import List, Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Import context builder for enriching messages with context
try:
    from context_builder import build_context_prompt, extract_context_summary
    logger.info("✅ Successfully imported context_builder")
    CONTEXT_BUILDER_AVAILABLE = True
except ImportError as e:
    logger.warning(f"⚠️ Could not import context_builder: {e}")
    CONTEXT_BUILDER_AVAILABLE = False
    # Fallback functions if import fails
    def build_context_prompt(user_message, context_items):
        return user_message
    def extract_context_summary(context_items):
        return {'total_items': len(context_items) if context_items else 0}

def json_dumps_safe(obj):
    """JSON dumps with Decimal support for DynamoDB"""
    def decimal_default(obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
    
    return json.dumps(obj, default=decimal_default)

def convert_floats_to_decimal(obj):
    """
    Recursively convert all float values to Decimal for DynamoDB compatibility
    """
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimal(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj

# Initialize DynamoDB table
chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])

# Initialize WebSocket client
websocket_client = boto3.client('apigatewaymanagementapi')
websocket_endpoint = os.environ.get('WEBSOCKET_ENDPOINT')
if not websocket_endpoint:
    api_gateway_id = os.environ.get('WEBSOCKET_API_ID')
    if api_gateway_id:
        websocket_endpoint = f"https://{api_gateway_id}.execute-api.us-east-1.amazonaws.com/production"

def update_session_variables(user_id: str, session_id: str, uploaded_files: List[Dict], context_items: List[Dict] = None):
    """
    Update session variables in DynamoDB with uploaded files and context items.
    This replaces the session variable update logic from the WebSocket processor.
    """
    try:
        if context_items:
            logger.info(f"📌 Context items preview: {json_dumps_safe(context_items[:1])}")  # Log first item
        if uploaded_files:
            logger.info(f"📌 Uploaded files preview: {json_dumps_safe(uploaded_files[:1])}")  # Log first file
        
        # Store context and files in session_variables for persistence
        if CONTEXT_BUILDER_AVAILABLE:
            context_summary = extract_context_summary(context_items) if context_items else {}
            logger.info(f"📌 Context summary: {context_summary}")
            
            # Update session variables in DynamoDB
            try:
                # Convert all floats to Decimal for DynamoDB compatibility
                context_items_decimal = convert_floats_to_decimal(context_items) if context_items else []
                context_summary_decimal = convert_floats_to_decimal(context_summary)
                uploaded_files_decimal = convert_floats_to_decimal(uploaded_files)
                
                # Get existing session_variables to merge with new data
                response = chat_sessions_table.get_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    }
                )
                
                # Get existing session_variables or create empty dict
                existing_session_vars = response.get('Item', {}).get('session_variables', {})
                
                # Prepare session variables with separate fields
                session_vars = {
                    **existing_session_vars,  # Preserve existing data
                    'last_updated': int(datetime.now().timestamp())
                }
                
                # Add context items if present
                if context_items:
                    session_vars.update({
                        'context_items': context_items_decimal,
                        'context_added_at': int(datetime.now().timestamp()),
                        'context_summary': context_summary_decimal,
                    })
                
                # Add uploaded files if present
                if uploaded_files:
                    # Get existing uploaded files or create empty list
                    existing_files = existing_session_vars.get('uploaded_files', [])
                    
                    # Merge new files with existing files
                    all_files = existing_files + uploaded_files_decimal
                    
                    session_vars.update({
                        'uploaded_files': all_files,
                        'files_added_at': int(datetime.now().timestamp())
                    })
                
                chat_sessions_table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET session_variables = :vars, last_updated = :updated',
                    ExpressionAttributeValues={
                        ':vars': session_vars,
                        ':updated': int(datetime.now().timestamp())
                    }
                )
                logger.info(f"📌 Stored context and uploaded files in session_variables")
                
                # Send session update to WebSocket clients
                send_session_update_to_websocket(user_id, session_id, session_vars)
                
            except Exception as e:
                logger.error(f"❌ Failed to store context and files in session_variables: {e}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
                
    except Exception as e:
        logger.error(f"❌ Error updating session variables: {str(e)}")
        raise

def send_session_update_to_websocket(user_id: str, session_id: str, session_variables: Dict):
    """
    Send session update message to WebSocket clients.
    This replaces the session update logic from the WebSocket processor.
    """
    try:
        # Get active connections for this user
        connections_response = chat_sessions_table.query(
            IndexName='user_id-index',
            KeyConditionExpression='user_id = :user_id',
            FilterExpression='attribute_exists(connection_id)'
        )
        
        active_connections = connections_response.get('Items', [])
        
        if active_connections:
            logger.info(f"📁 Found {len(active_connections)} active connections for user {user_id}")
            
            # Send session update to all active connections
            for connection in active_connections:
                connection_id = connection.get('connection_id')
                if connection_id:
                    try:
                        session_update_message = {
                            'type': 'session_updated',
                            'session_id': session_id,
                            'session_variables': session_variables,
                            'timestamp': datetime.now().isoformat()
                        }
                        
                        websocket_client.post_to_connection(
                            ConnectionId=connection_id,
                            Data=json_dumps_safe(session_update_message)
                        )
                        logger.info(f"📁 Sent session variables update to connection {connection_id}")
                        
                    except Exception as e:
                        logger.error(f"❌ Failed to send session variables update to connection {connection_id}: {str(e)}")
        else:
            logger.warning(f"⚠️ No active connections found for user {user_id}, session {session_id}")
            
    except Exception as e:
        logger.error(f"❌ Error sending session update to WebSocket: {str(e)}")

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
        
        # Files uploaded successfully, update session variables immediately
        try:
            update_session_variables(user_id, session_id, uploaded_files, context_items)
            logger.info("Successfully updated session variables with uploaded files")
        except Exception as e:
            logger.error(f"Error updating session variables: {str(e)}")
            # Continue anyway - files are uploaded
        
        # Now send enriched message to WebSocket processor via direct Lambda invocation
        # The WebSocket processor will handle storing the message and sending responses
        try:
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
            'model': 'claude-opus-4-1',  # Default model
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
