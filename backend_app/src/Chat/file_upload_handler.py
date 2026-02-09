"""
File Upload Handler for Chat Agent (presigned-only, matches filesystem pattern).

All uploads use the same deterministic flow as the filesystem Lambda:
1. POST /files with operation='get_upload_url', body: { user_id, session_id, files: [ { filename, content_type?, file_size? } ] }
   → Returns upload_urls: [ { upload_url, fields, s3_key, file_id, filename [, content_type] } ]
2. Client uploads each file directly to S3: POST to upload_url with FormData (presigned fields + file as last field).
3. POST /files with operation='register_uploads', body: { user_id, session_id, message: { id, text [, timestamp] }, files: [ { s3_key, filename, content_type? } ] }
   → Validates s3_key prefix, confirms object exists in S3, updates session_variables.uploaded_files.

S3 key pattern: users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}
Agent reads via read_pdf_tool(s3_key) / read_s3_file_tool(s3_key).
"""

import json
import os
import boto3
import uuid
from datetime import datetime
import logging
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
    Handles file uploads via presigned S3 POST only (deterministic, matches filesystem Lambda).
    Only operations: get_upload_url, register_uploads.
    """

    def __init__(self):
        self.bucket_name = os.environ['CHAT_FILES_BUCKET_NAME']
        self.chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])

    def _generate_presigned_post(self, user_id: str, session_id: str, filename: str, file_size: int = None) -> dict:
        """Generate presigned S3 POST (same pattern as filesystem: key, conditions, no Content-Type in Fields)."""
        file_id = str(uuid.uuid4())
        s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}"
        conditions = []
        if file_size is not None and file_size > 0:
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
        
        Expected body (operation=get_upload_url): user_id, session_id, files: [ { filename, content_type?, file_size? } ]
        Expected body (operation=register_uploads): user_id, session_id, message: { id, text [, timestamp] }, files: [ { s3_key, filename, content_type? } ], context_items?: []
        
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
            
            # Parse request body (presigned flow: small JSON only, no file bytes)
            raw_body = event.get('body') or ''
            body_len = len(raw_body) if isinstance(raw_body, str) else 0
            logger.info("[FILE_UPLOAD] Request body length: %s chars", body_len)
            if body_len == 0:
                logger.warning("[FILE_UPLOAD] Empty body")
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

            # Require presigned flow (deterministic, matches filesystem)
            if operation not in ('get_upload_url', 'register_uploads'):
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    },
                    'body': json.dumps({
                        'error': 'Presigned upload required',
                        'message': (
                            'Use operation=get_upload_url to get presigned URLs, upload each file to S3, '
                            'then call operation=register_uploads with the returned s3_key values.'
                        ),
                        'code': 'PRESIGNED_REQUIRED',
                    }),
                }

            # Register files already uploaded to S3 via presigned URL
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

            # Unreachable if operation is get_upload_url or register_uploads (both return above)
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                },
                'body': json.dumps({
                    'error': 'Presigned upload required',
                    'message': 'Use operation=get_upload_url then upload to S3, then operation=register_uploads.',
                    'code': 'PRESIGNED_REQUIRED',
                }),
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

