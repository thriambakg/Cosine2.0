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
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin


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
        
        Args:
            event: API Gateway event containing headers and body
        """
        # Extract origin from event headers for CORS
        headers = event.get('headers', {}) if isinstance(event, dict) else {}
        origin = headers.get('Origin') or headers.get('origin')
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
        # Extract origin from event headers for CORS
        headers = event.get('headers', {}) if isinstance(event, dict) else {}
        origin = headers.get('Origin') or headers.get('origin')
        
        try:
            logger.info(f"File upload request received")
            logger.debug(f"Event structure: {json.dumps({k: str(type(v).__name__) for k, v in event.items() if k != 'body'}, indent=2)}")
            
            # Parse request body
            if isinstance(event.get('body'), str):
                try:
                    body = json.loads(event['body'])
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse JSON body: {str(e)}")
                    return {
                        'statusCode': 400,
                        'headers': {
                            'Content-Type': 'application/json',
                            **get_cors_headers(origin),
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'POST, OPTIONS'
                        },
                        'body': json.dumps({
                            'error': 'Invalid JSON in request body',
                            'details': str(e)
                        })
                    }
            else:
                body = event.get('body', {})
            
            logger.debug(f"Parsed body keys: {list(body.keys()) if isinstance(body, dict) else 'not a dict'}")
            
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
                        **get_cors_headers(origin),
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
                        **get_cors_headers(origin),
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
                        **get_cors_headers(origin),
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
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': 'Failed to upload any files'
                    })
                }
            
            # Files uploaded successfully, update session variables
            session_variables_updated = False
            updated_session_variables = None
            try:
                session_variables_updated = self._update_session_variables(
                    user_id, session_id, uploaded_files, context_items
                )
                logger.info(f"Session variables update result: {session_variables_updated}")
                
                # Get updated session_variables to send to frontend
                if session_variables_updated:
                    response = self.chat_sessions_table.get_item(
                        Key={'user_id': user_id, 'session_id': session_id}
                    )
                    if 'Item' in response:
                        updated_session_variables = response['Item'].get('session_variables', {})
            except Exception as e:
                logger.error(f"Error updating session variables: {str(e)}")
            
            # Send session_update notification to frontend via WebSocket
            if session_variables_updated and updated_session_variables:
                try:
                    from websocket_handler import WebSocketHandler
                    ws_handler = WebSocketHandler()
                    ws_handler._send_session_update_with_variables(user_id, session_id, updated_session_variables)
                    logger.info(f"✅ Sent session_update to WebSocket for session {session_id} after file upload")
                except Exception as ws_error:
                    logger.warning(f"Failed to send session_update to WebSocket: {str(ws_error)}")
                    # Non-critical - continue with response
            
            # Files are uploaded and session variables are updated
            # The message will be sent via WebSocket separately by the frontend
            # This ensures files are uploaded before message processing begins
            logger.info(f"Files uploaded successfully. Waiting for WebSocket message to process.")
            
            # Prepare response body with session_variables for frontend to update immediately
            response_body = {
                'message': f'Successfully uploaded {len(uploaded_files)} file(s)',
                'uploaded_files': uploaded_files
            }
            
            # Include updated session_variables in response so frontend can update immediately
            if updated_session_variables:
                # Convert Decimal types to native Python types for JSON serialization
                import json as json_module
                from decimal import Decimal
                
                def decimal_default(obj):
                    if isinstance(obj, Decimal):
                        return int(obj) if obj % 1 == 0 else float(obj)
                    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
                
                # Convert session_variables to JSON-serializable format
                try:
                    session_vars_json = json_module.loads(json_module.dumps(updated_session_variables, default=decimal_default))
                    response_body['session_variables'] = session_vars_json
                    logger.info(f"✅ Including session_variables in response for immediate frontend update")
                except Exception as e:
                    logger.warning(f"Failed to serialize session_variables for response: {str(e)}")
            
            # Return immediately - frontend will send message via WebSocket
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps(response_body)
            }
            
        except Exception as e:
            logger.error(f"Error in file upload handler: {str(e)}")
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
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

