"""
File Upload Handler for Chat Agent
Handles file uploads via REST API and processes messages with attached files
Consolidated from file_upload Lambda for improved performance
"""

import json
import os
import boto3
import uuid
from datetime import datetime
import logging
import base64

# Configure logging
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

def convert_floats_to_decimal(obj):
    """Convert floats to Decimal for DynamoDB compatibility"""
    from decimal import Decimal
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj


class FileUploadHandler:
    """
    Handles file uploads and message processing with attached files
    """
    
    def __init__(self):
        self.bucket_name = os.environ['CHAT_FILES_BUCKET_NAME']
        self.chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])
    
    def handle_file_upload(self, event: dict) -> dict:
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
            logger.info(f"File upload request received")
            
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
            model = body.get('model', 'claude-sonnet-4')
            
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
                    file_content = base64.b64decode(data)
                    file_size = len(file_content)
                    
                    # Upload to S3
                    s3_client.put_object(
                        Bucket=self.bucket_name,
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
                    s3_url = f"https://{self.bucket_name}.s3.amazonaws.com/{s3_key}"
                    
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
            
            # Files uploaded successfully, update session variables
            session_variables_updated = False
            try:
                session_variables_updated = self._update_session_variables(
                    user_id, session_id, uploaded_files, context_items
                )
                logger.info(f"Session variables update result: {session_variables_updated}")
            except Exception as e:
                logger.error(f"Error updating session variables: {str(e)}")
            
            # Process message with uploaded files directly (no Lambda invocation!)
            try:
                from websocket_handler import WebSocketHandler
                ws_handler = WebSocketHandler()
                
                # Process message with files directly
                ws_handler.process_file_upload_message(
                    user_id, session_id, message, uploaded_files, context_items, model
                )
                
                logger.info("Successfully processed message with uploaded files")
            except Exception as e:
                logger.error(f"Error processing message with files: {str(e)}")
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
                    'message': f'Successfully uploaded {len(uploaded_files)} file(s) and processed message',
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
    
    def _update_session_variables(self, user_id: str, session_id: str, uploaded_files: list, context_items: list) -> bool:
        """
        Update session_variables in DynamoDB with uploaded files and context items.
        """
        try:
            uploaded_files_decimal = convert_floats_to_decimal(uploaded_files)
            context_items_decimal = convert_floats_to_decimal(context_items)
            
            # Get existing session_variables to merge with new data
            response = self.chat_sessions_table.get_item(
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
                }
                
                # Append uploaded files to existing files (don't overwrite)
                existing_files = existing_session_vars.get('uploaded_files', [])
                all_files = existing_files + uploaded_files_decimal
                merged_session_vars['uploaded_files'] = all_files
                logger.info(f"📌 Merged uploaded files: {len(existing_files)} existing + {len(uploaded_files_decimal)} new = {len(all_files)} total")
                
                # Preserve existing context items - only update if new context items are provided
                existing_context_items = existing_session_vars.get('context_items', [])
                if context_items_decimal and len(context_items_decimal) > 0:
                    # If new context items are provided, merge them (avoid duplicates by ID)
                    existing_ids = {item.get('id') for item in existing_context_items if item.get('id')}
                    new_items = [item for item in context_items_decimal if item.get('id') not in existing_ids]
                    merged_context_items = existing_context_items + new_items
                    merged_session_vars['context_items'] = merged_context_items
                    logger.info(f"📌 Merged context items: {len(existing_context_items)} existing + {len(new_items)} new = {len(merged_context_items)} total")
                else:
                    # No new context items provided, preserve existing ones
                    merged_session_vars['context_items'] = existing_context_items
                    logger.info(f"📌 Preserved existing context items: {len(existing_context_items)} items")
                
                # Update the session with merged session_variables
                self.chat_sessions_table.update_item(
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

