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
import gzip
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

def decompress_if_needed(data: bytes) -> bytes:
    """
    Detect and decompress gzip-compressed data if needed.
    
    Files may be compressed on the frontend to reduce payload size for API Gateway
    (which has a 6MB request body limit). This function detects gzip compression
    and decompresses the data before storing in S3.
    
    Args:
        data: Raw bytes that may be gzip-compressed
        
    Returns:
        Decompressed bytes (or original bytes if not compressed)
    """
    try:
        # Check if data starts with gzip magic bytes (0x1f 0x8b)
        if len(data) >= 2 and data[0] == 0x1f and data[1] == 0x8b:
            logger.info("📦 Detected gzip-compressed file data, decompressing...")
            decompressed = gzip.decompress(data)
            logger.info(f"✅ Decompressed: {len(data)} bytes -> {len(decompressed)} bytes")
            return decompressed
        else:
            # Not compressed, return as-is
            return data
    except Exception as e:
        # If decompression fails, assume it's not compressed or corrupted
        logger.warning(f"⚠️ Failed to decompress data (may not be compressed): {str(e)}")
        return data


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
                    
                    # Decompress if the file was compressed on the frontend
                    # Frontend compresses files >1MB to reduce API Gateway payload size (6MB limit)
                    file_content = decompress_if_needed(file_content)
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
    
    def generate_presigned_upload_url(self, event: dict) -> dict:
        """
        Generate a presigned URL for direct S3 file upload.
        
        This bypasses API Gateway's 6MB limit by allowing clients to upload
        directly to S3 using a temporary presigned URL.
        
        Expected event structure:
        {
            "user_id": "string",
            "session_id": "string",
            "filename": "string",
            "content_type": "string",
            "file_size": number
        }
        
        Args:
            event: API Gateway event containing headers and body
            
        Returns:
            Response with presigned URL, file_id, s3_key, and expiration
        """
        headers = event.get('headers', {}) if isinstance(event, dict) else {}
        origin = headers.get('Origin') or headers.get('origin')
        
        # SECURITY: Extract and validate user_id from bearer token
        authenticated_user_id = None
        try:
            authenticated_user_id = extract_user_id_from_event(event)
            if authenticated_user_id:
                logger.info(f"🔐 Presigned URL: Authenticated user_id from bearer token: {authenticated_user_id}")
            else:
                logger.warning("⚠️ Presigned URL: No user_id found in bearer token or authorizer")
        except Exception as e:
            logger.error(f"❌ Presigned URL: Error extracting user_id from bearer token: {str(e)}")
        
        try:
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
            
            # Get user_id and validate
            body_user_id = body.get('user_id')
            session_id = body.get('session_id')
            filename = body.get('filename')
            content_type = body.get('content_type', 'application/octet-stream')
            file_size = body.get('file_size', 0)
            
            # SECURITY: Use authenticated user_id if available
            if authenticated_user_id:
                user_id = authenticated_user_id
                if body_user_id and body_user_id != authenticated_user_id:
                    logger.error(f"❌ Presigned URL: user_id mismatch! Body: {body_user_id}, Authenticated: {authenticated_user_id}")
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
            else:
                user_id = body_user_id
                logger.warning(f"⚠️ Presigned URL: Using user_id from request body (not authenticated): {user_id}")
            
            # Validate required fields
            if not user_id or not session_id or not filename:
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': 'Missing required fields: user_id, session_id, and filename are required'
                    })
                }
            
            # Validate file size (50MB limit)
            MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
            if file_size > MAX_FILE_SIZE:
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': f'File too large: {file_size} bytes (max: {MAX_FILE_SIZE} bytes)'
                    })
                }
            
            # Generate unique file ID
            file_id = str(uuid.uuid4())
            
            # Create S3 key - validate to prevent path traversal
            # Ensure filename doesn't contain path separators
            safe_filename = os.path.basename(filename)  # Remove any path components
            s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{safe_filename}"
            
            # Validate S3 key matches expected pattern (security check)
            expected_prefix = f"users/{user_id}/"
            if not s3_key.startswith(expected_prefix):
                logger.error(f"❌ Presigned URL: Invalid S3 key pattern - potential path traversal attack")
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': 'Invalid filename'
                    })
                }
            
            # Generate presigned PUT URL (15 minutes expiration)
            expiration = 900  # 15 minutes
            presigned_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key,
                    'ContentType': content_type,
                    'Metadata': {
                        'user_id': user_id,
                        'session_id': session_id,
                        'file_id': file_id,
                        'filename': safe_filename,
                        'content_type': content_type,
                        'file_type': 'chat_upload',
                        'upload_timestamp': str(int(datetime.utcnow().timestamp()))
                    }
                },
                ExpiresIn=expiration
            )
            
            logger.info(f"✅ Generated presigned URL for file upload: {safe_filename} (file_id: {file_id})")
            
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'presigned_url': presigned_url,
                    'file_id': file_id,
                    's3_key': s3_key,
                    'expires_in': expiration,
                    'filename': safe_filename
                })
            }
            
        except Exception as e:
            logger.error(f"Error generating presigned URL: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
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
    
    def complete_file_upload(self, event: dict) -> dict:
        """
        Complete file upload after direct S3 upload.
        
        Verifies file exists in S3, updates session variables, and sends
        WebSocket notification to trigger agent processing.
        
        Expected event structure:
        {
            "user_id": "string",
            "session_id": "string",
            "file_ids": ["string"],  # Array of file_ids that were uploaded
            "message": {
                "id": "string",
                "text": "string",
                "timestamp": "number"
            },
            "context_items": []
        }
        
        Args:
            event: API Gateway event containing headers and body
            
        Returns:
            Response with uploaded file metadata and updated session variables
        """
        headers = event.get('headers', {}) if isinstance(event, dict) else {}
        origin = headers.get('Origin') or headers.get('origin')
        
        # SECURITY: Extract and validate user_id from bearer token
        authenticated_user_id = None
        try:
            authenticated_user_id = extract_user_id_from_event(event)
            if authenticated_user_id:
                logger.info(f"🔐 Complete upload: Authenticated user_id from bearer token: {authenticated_user_id}")
            else:
                logger.warning("⚠️ Complete upload: No user_id found in bearer token or authorizer")
        except Exception as e:
            logger.error(f"❌ Complete upload: Error extracting user_id from bearer token: {str(e)}")
        
        try:
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
            
            # Get user_id and validate
            body_user_id = body.get('user_id')
            session_id = body.get('session_id')
            file_ids = body.get('file_ids', [])
            message = body.get('message', {})
            context_items = body.get('context_items', [])
            
            # SECURITY: Use authenticated user_id if available
            if authenticated_user_id:
                user_id = authenticated_user_id
                if body_user_id and body_user_id != authenticated_user_id:
                    logger.error(f"❌ Complete upload: user_id mismatch! Body: {body_user_id}, Authenticated: {authenticated_user_id}")
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
            else:
                user_id = body_user_id
                logger.warning(f"⚠️ Complete upload: Using user_id from request body (not authenticated): {user_id}")
            
            # Validate required fields
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
            
            if not file_ids or not isinstance(file_ids, list):
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': 'Missing or invalid file_ids array'
                    })
                }
            
            # Verify files exist in S3 and collect metadata
            uploaded_files = []
            for file_id in file_ids:
                try:
                    # List objects with prefix to find the file
                    # S3 key format: users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}
                    prefix = f"users/{user_id}/sessions/{session_id}/files/{file_id}_"
                    response = s3_client.list_objects_v2(
                        Bucket=self.bucket_name,
                        Prefix=prefix,
                        MaxKeys=1
                    )
                    
                    if 'Contents' not in response or len(response['Contents']) == 0:
                        logger.warning(f"⚠️ File not found in S3: {file_id} (prefix: {prefix})")
                        continue
                    
                    s3_object = response['Contents'][0]
                    s3_key = s3_object['Key']
                    
                    # Get object metadata
                    head_response = s3_client.head_object(
                        Bucket=self.bucket_name,
                        Key=s3_key
                    )
                    
                    metadata = head_response.get('Metadata', {})
                    file_size = head_response.get('ContentLength', 0)
                    content_type = head_response.get('ContentType', 'application/octet-stream')
                    
                    # Extract filename from S3 key (remove file_id prefix)
                    filename = s3_key.split(f"{file_id}_", 1)[-1] if f"{file_id}_" in s3_key else os.path.basename(s3_key)
                    
                    uploaded_files.append({
                        'file_id': file_id,
                        'filename': filename,
                        's3_key': s3_key,
                        's3_url': f"https://{self.bucket_name}.s3.amazonaws.com/{s3_key}",
                        'content_type': content_type,
                        'file_size': file_size,
                        'upload_timestamp': metadata.get('upload_timestamp', str(int(datetime.utcnow().timestamp())))
                    })
                    
                    logger.info(f"✅ Verified file in S3: {filename} (file_id: {file_id})")
                    
                except Exception as e:
                    logger.error(f"❌ Error verifying file {file_id} in S3: {str(e)}")
                    continue
            
            if not uploaded_files:
                return {
                    'statusCode': 404,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS'
                    },
                    'body': json.dumps({
                        'error': 'No files found in S3. Upload may have failed.'
                    })
                }
            
            # Update session variables with uploaded files
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
            
            # Prepare response body
            response_body = {
                'message': f'Successfully completed upload for {len(uploaded_files)} file(s)',
                'uploaded_files': uploaded_files
            }
            
            # Include updated session_variables in response
            if updated_session_variables:
                import json as json_module
                from decimal import Decimal
                
                def decimal_default(obj):
                    if isinstance(obj, Decimal):
                        return int(obj) if obj % 1 == 0 else float(obj)
                    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
                
                try:
                    session_vars_json = json_module.loads(json_module.dumps(updated_session_variables, default=decimal_default))
                    response_body['session_variables'] = session_vars_json
                    logger.info(f"✅ Including session_variables in response for immediate frontend update")
                except Exception as e:
                    logger.warning(f"Failed to serialize session_variables for response: {str(e)}")
            
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
            logger.error(f"Error completing file upload: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
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

