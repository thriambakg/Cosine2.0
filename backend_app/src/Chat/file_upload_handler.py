"""
File Upload Handler for Chat Agent

Flow: Client uploads file → API Gateway POST /files → Lambda (this handler) → S3.
Agent then reads from S3 via read_pdf_tool(s3_key) / read_s3_file_tool(s3_key).

1. Client sends POST to /files with JSON body:
   { user_id, session_id, message: { id, text, timestamp }, files: [ { filename, content_type, data: base64 } ] }
2. Lambda receives event with event["body"] = stringified JSON (full request body from API Gateway).
3. Handler parses body, base64-decodes each file's data, and puts to S3:
   Bucket=CHAT_FILES_BUCKET_NAME, Key=users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}
4. Response includes s3_key and metadata; client/WebSocket can pass s3_key to the agent.
5. Agent uses read_pdf_tool(s3_key) or read_s3_file_tool(s3_key) to read from the same bucket/key.

If the stored file is exactly 8192 bytes, the request body was truncated (e.g. API Gateway
payload limit or client). Check [FILE_UPLOAD] logs for body length and base64_str_len.

Alternative flow (ported from filesystem lambda): use direct S3 upload to avoid body limits.
- operation='get_upload_url': body has files: [{ filename, content_type, file_size? }]. Returns presigned POST URLs.
- operation='register_uploads': body has files: [{ s3_key, filename, content_type }] + message. Registers existing S3 objects in session (no base64).
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
from utils.auth_helper import extract_user_id_from_event


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
    Handles file uploads and message processing with attached files.
    Supports: (1) one-shot base64 upload, (2) get_upload_url + register_uploads (direct S3, no body limit).
    """

    def __init__(self):
        self.bucket_name = os.environ['CHAT_FILES_BUCKET_NAME']
        self.chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])

    def _generate_presigned_post(self, user_id: str, session_id: str, filename: str, file_size: int = None) -> dict:
        """Generate presigned S3 POST for direct upload (same pattern as filesystem lambda)."""
        file_id = str(uuid.uuid4())
        s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}"
        conditions = []
        if file_size:
            conditions.append(['content-length-range', 1, file_size])
        post_data = s3_client.generate_presigned_post(
            Bucket=self.bucket_name,
            Key=s3_key,
            Fields={},
            Conditions=conditions,
            ExpiresIn=3600,
        )
        return {
            'upload_url': post_data['url'],
            'fields': post_data['fields'],
            's3_key': s3_key,
            'file_id': file_id,
            'filename': filename,
        }

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
        
        Args:
            event: API Gateway event containing headers and body
        """
        # Extract origin from event headers for CORS
        headers = event.get('headers', {}) if isinstance(event, dict) else {}
        origin = headers.get('Origin') or headers.get('origin')
        
        # SECURITY: Extract and validate user_id from bearer token (most secure)
        authenticated_user_id = None
        try:
            authenticated_user_id = extract_user_id_from_event(event)
            if authenticated_user_id:
                logger.info(f"🔐 File upload: Authenticated user_id from bearer token: {authenticated_user_id}")
            else:
                logger.warning("⚠️ File upload: No user_id found in bearer token or authorizer")
        except Exception as e:
            logger.error(f"❌ File upload: Error extracting user_id from bearer token: {str(e)}")
        
        # Log Authorization header presence (without logging the actual token)
        auth_header = headers.get('Authorization') or headers.get('authorization')
        if auth_header:
            logger.info(f"🔒 File upload: Authorization header present: {'Bearer ' + auth_header[:20] + '...' if len(auth_header) > 20 else 'Bearer [token]'}")
        else:
            logger.warning("⚠️ File upload: No Authorization header found in request")
        
        try:
            logger.info(f"File upload request received")
            logger.debug(f"Event structure: {json.dumps({k: str(type(v).__name__) for k, v in event.items() if k != 'body'}, indent=2)}")
            
            # Parse request body (log size to diagnose 8KB truncation)
            raw_body = event.get('body') or ''
            body_len = len(raw_body) if isinstance(raw_body, str) else 0
            logger.info("[FILE_UPLOAD] Request body length: %s chars (truncation suspected if ~11K for 8KB decoded)", body_len)
            if body_len == 0:
                logger.warning("[FILE_UPLOAD] Empty body")
            if isinstance(raw_body, str) and body_len in (10922, 10923, 8192):
                logger.warning("[FILE_UPLOAD] Body length is %s - likely truncated (8192 decoded base64 ~10923 chars)", body_len)
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
            
            # Get user_id from body (for comparison/fallback)
            body_user_id = body.get('user_id')
            session_id = body.get('session_id')
            
            # SECURITY: Use authenticated user_id if available, otherwise fall back to body (less secure)
            # If authenticated user_id exists, validate it matches body user_id
            if authenticated_user_id:
                user_id = authenticated_user_id
                # Validate that body user_id matches authenticated user_id (prevent spoofing)
                if body_user_id and body_user_id != authenticated_user_id:
                    logger.error(f"❌ File upload: user_id mismatch! Body: {body_user_id}, Authenticated: {authenticated_user_id}")
                    return {
                        'statusCode': 403,
                        'headers': {
                            'Content-Type': 'application/json',
                            **get_cors_headers(origin),
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'POST, OPTIONS'
                        },
                        'body': json.dumps({
                            'error': 'Forbidden: user_id in request body does not match authenticated user',
                            'message': 'Authentication failed'
                        })
                    }
                logger.info(f"✅ File upload: user_id validated - authenticated: {authenticated_user_id}")
            else:
                # Fallback to body user_id if no authentication (less secure, but for backward compatibility)
                user_id = body_user_id
                logger.warning(f"⚠️ File upload: Using user_id from request body (not authenticated): {user_id}")
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

            # Alternative flow: get presigned upload URLs (port from filesystem lambda)
            operation = body.get('operation')
            if operation == 'get_upload_url':
                upload_files = body.get('files', [])
                if not upload_files:
                    return {
                        'statusCode': 400,
                        'headers': {'Content-Type': 'application/json', **get_cors_headers(origin), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'},
                        'body': json.dumps({'error': 'files array required for get_upload_url'})
                    }
                upload_urls = []
                for f in upload_files:
                    fn = f.get('filename') or 'untitled'
                    ct = f.get('content_type', 'application/octet-stream')
                    size = f.get('file_size')
                    one = self._generate_presigned_post(user_id, session_id, fn, size)
                    one['content_type'] = ct
                    upload_urls.append(one)
                logger.info("[FILE_UPLOAD] get_upload_url: returned %s URL(s)", len(upload_urls))
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json', **get_cors_headers(origin), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'},
                    'body': json.dumps({
                        'upload_urls': upload_urls,
                        'message': 'Use each upload_url + fields to POST the file directly to S3, then call with operation=register_uploads and s3_key.',
                    })
                }

            # Alternative flow: register files already uploaded to S3 via presigned URL
            if operation == 'register_uploads':
                message = body.get('message', {})
                reg_files = body.get('files', [])
                context_items = body.get('context_items', [])
                if not message.get('id') or not message.get('text'):
                    return {
                        'statusCode': 400,
                        'headers': {'Content-Type': 'application/json', **get_cors_headers(origin), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'},
                        'body': json.dumps({'error': 'message.id and message.text required for register_uploads'})
                    }
                expected_prefix = f"users/{user_id}/sessions/{session_id}/files/"
                uploaded_files = []
                for f in reg_files:
                    s3_key = f.get('s3_key')
                    fn = f.get('filename') or f.get('name') or 'untitled'
                    ct = f.get('content_type', 'application/octet-stream')
                    if not s3_key or not s3_key.startswith(expected_prefix):
                        logger.warning("[FILE_UPLOAD] register_uploads: invalid s3_key %s", s3_key)
                        continue
                    try:
                        head = s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
                        file_size = head.get('ContentLength', 0)
                    except Exception as e:
                        logger.warning("[FILE_UPLOAD] register_uploads: head_object failed for %s: %s", s3_key, e)
                        continue
                    uploaded_files.append({
                        'file_id': s3_key.split('/')[-1].split('_', 1)[0] if '_' in s3_key.split('/')[-1] else '',
                        'filename': fn,
                        's3_key': s3_key,
                        's3_url': f"https://{self.bucket_name}.s3.amazonaws.com/{s3_key}",
                        'content_type': ct,
                        'file_size': file_size,
                        'upload_timestamp': int(datetime.utcnow().timestamp()),
                    })
                if not uploaded_files:
                    return {
                        'statusCode': 400,
                        'headers': {'Content-Type': 'application/json', **get_cors_headers(origin), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'},
                        'body': json.dumps({'error': 'No valid s3_key files to register'})
                    }
                session_variables_updated = False
                updated_session_variables = None
                try:
                    session_variables_updated = self._update_session_variables(user_id, session_id, uploaded_files, context_items)
                    if session_variables_updated:
                        resp = self.chat_sessions_table.get_item(Key={'user_id': user_id, 'session_id': session_id})
                        if 'Item' in resp:
                            updated_session_variables = resp['Item'].get('session_variables', {})
                except Exception as e:
                    logger.error("[FILE_UPLOAD] register_uploads: _update_session_variables failed: %s", e)
                try:
                    from websocket_handler import WebSocketHandler
                    ws_handler = WebSocketHandler()
                    ws_handler._send_session_update_with_variables(user_id, session_id, updated_session_variables or {})
                except Exception:
                    pass
                from decimal import Decimal
                def _decimal_default(obj):
                    if isinstance(obj, Decimal):
                        return int(obj) if obj % 1 == 0 else float(obj)
                    raise TypeError(type(obj).__name__)
                sv_json = json.loads(json.dumps(updated_session_variables or {}, default=_decimal_default)) if updated_session_variables else None
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json', **get_cors_headers(origin), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'},
                    'body': json.dumps({
                        'message': f'Registered {len(uploaded_files)} file(s)',
                        'uploaded_files': uploaded_files,
                        'session_variables': sv_json,
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
            for idx, file_data in enumerate(files):
                filename = file_data.get('filename')
                content_type = file_data.get('content_type', 'application/octet-stream')
                data = file_data.get('data')
                
                if not filename or not data:
                    logger.warning(f"Skipping invalid file: {filename}")
                    continue
                
                base64_len = len(data) if isinstance(data, str) else 0
                logger.info(
                    "[FILE_UPLOAD] File[%s] before decode: filename=%s base64_str_len=%s",
                    idx,
                    filename,
                    base64_len,
                )
                if base64_len in (10922, 10923) or (base64_len > 0 and base64_len <= 11000):
                    logger.warning(
                        "[FILE_UPLOAD] File[%s] base64 length %s decodes to ~8KB - likely truncated in request",
                        idx,
                        base64_len,
                    )
                try:
                    # Generate unique file ID
                    file_id = str(uuid.uuid4())
                    correlation_id = str(uuid.uuid4())
                    
                    # Create S3 key
                    s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}"
                    
                    # Decode base64 data
                    file_content = base64.b64decode(data)
                    file_size = len(file_content)
                    logger.info(
                        "[FILE_UPLOAD] decode: filename=%s base64_len=%s decoded_bytes=%s s3_key=%s",
                        filename,
                        base64_len,
                        file_size,
                        f"users/{user_id}/sessions/{session_id}/files/...",
                    )
                    if file_size == 8192:
                        logger.warning(
                            "[FILE_UPLOAD] File is exactly 8,192 bytes - likely truncated. "
                            "base64_len=%s (for 8KB binary expect ~10923). "
                            "Check: (1) API Gateway / Lambda payload limit, (2) client sending full base64.",
                            base64_len,
                        )
                    
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

