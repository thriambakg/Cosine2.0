"""
AWS Lambda function for generating fresh presigned URLs on-demand
Simplified to just serve download URLs when requested
"""

import json
import os
import logging
import time
import boto3
import base64
import hashlib
from typing import Dict, Any
from botocore.exceptions import ClientError
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import sys
from cors_helper import get_cors_headers, validate_origin


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3', config=boto3.session.Config(signature_version='s3v4'))
sns_client = boto3.client('sns')

# Environment variables
S3_BUCKET = os.environ.get('S3_BUCKET')
SEC_FILINGS_BUCKET = os.environ.get('SEC_FILINGS_BUCKET')
POLITICIAN_TRADES_BUCKET = os.environ.get('POLITICIAN_TRADES_BUCKET')
LDA_DISCLOSURES_BUCKET = os.environ.get('LDA_DISCLOSURES_BUCKET')
CONGRESS_BILLS_BUCKET = os.environ.get('CONGRESS_BILLS_DATA_S3_BUCKET_NAME')
SESSIONS_TABLE = os.environ.get('SESSIONS_TABLE')
S3_BASE_URL = os.environ.get('S3_BASE_URL', 'https://cosine-chat-files-production.s3.amazonaws.com')
USER_PROFILES_TABLE_NAME = os.environ.get('USER_PROFILES_TABLE_NAME')
ENCRYPTION_SECRET = os.environ.get('ENCRYPTION_SECRET', 'default-secret-change-in-production')  # Should match filesystem Lambda

# Manifest file name (matches filesystem Lambda)
MANIFEST_FILE = '.manifest.json'

def derive_platform_key() -> bytes:
    """Derive platform-wide encryption key from ENCRYPTION_SECRET (not user-specific)
    This allows .cosine files to be shared across all users in the platform"""
    salt = hashlib.sha256(f"{ENCRYPTION_SECRET}platform-wide".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"platform-wide{ENCRYPTION_SECRET}".encode()))
    return key

def derive_key_from_user_id(user_id: str) -> bytes:
    """Derive encryption key from user ID using PBKDF2 (legacy - kept for backward compatibility)"""
    salt = hashlib.sha256(f"{ENCRYPTION_SECRET}{user_id}".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{ENCRYPTION_SECRET}".encode()))
    return key

def derive_key_from_user_id_with_secret(user_id: str, encryption_secret: str) -> bytes:
    """Derive encryption key from user ID using PBKDF2 with a specific secret (legacy - kept for backward compatibility)"""
    salt = hashlib.sha256(f"{encryption_secret}{user_id}".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{encryption_secret}".encode()))
    return key

def decrypt_context_data(user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
    """Decrypt context data using Fernet with platform-wide key (shareable across all users)
    Falls back to user-specific keys for backward compatibility with old files"""
    from cryptography.fernet import InvalidToken
    
    # Try platform-wide key first (new format - shareable)
    try:
        logger.debug(f"🔐 Starting decryption with platform-wide key, data length: {len(encrypted_data)} bytes")
        key = derive_platform_key()
        logger.debug(f"🔐 Derived platform key length: {len(key)} bytes")
        fernet = Fernet(key)
        logger.debug(f"🔐 Attempting Fernet decryption with platform-wide key...")
        decrypted_data = fernet.decrypt(encrypted_data)
        logger.debug(f"🔐 Decrypted data length: {len(decrypted_data)} bytes")
        json_data = json.loads(decrypted_data.decode('utf-8'))
        logger.debug(f"🔐 Successfully parsed JSON with platform-wide key, keys: {list(json_data.keys()) if isinstance(json_data, dict) else 'N/A'}")
        return json_data
    except InvalidToken:
        logger.debug(f"⚠️ Platform-wide key failed, trying user-specific key for backward compatibility...")
        # Fallback: Try with user-specific key (for backward compatibility with old files)
        try:
            logger.debug(f"🔐 Starting decryption for user {user_id}, data length: {len(encrypted_data)} bytes")
            key = derive_key_from_user_id(user_id)
            logger.debug(f"🔐 Derived key length: {len(key)} bytes")
            fernet = Fernet(key)
            logger.debug(f"🔐 Attempting Fernet decryption with current secret...")
            decrypted_data = fernet.decrypt(encrypted_data)
            logger.debug(f"🔐 Decrypted data length: {len(decrypted_data)} bytes")
            json_data = json.loads(decrypted_data.decode('utf-8'))
            logger.debug(f"🔐 Successfully parsed JSON, keys: {list(json_data.keys()) if isinstance(json_data, dict) else 'N/A'}")
            return json_data
        except InvalidToken:
            # If decryption fails, try with default secret (for files encrypted before secret was set)
            logger.warning(f"⚠️ Decryption failed with current secret, trying default secret...")
            try:
                default_secret = 'default-secret-change-in-production'
                key = derive_key_from_user_id_with_secret(user_id, default_secret)
                fernet = Fernet(key)
                logger.debug(f"🔐 Attempting Fernet decryption with default secret...")
                decrypted_data = fernet.decrypt(encrypted_data)
                logger.warning(f"⚠️ Successfully decrypted with default secret - file should be re-encrypted with current secret")
                json_data = json.loads(decrypted_data.decode('utf-8'))
                return json_data
            except InvalidToken:
                logger.error(f"❌ Decryption failed with all methods (platform-wide, user-specific, and default secret)")
                raise ValueError("Failed to decrypt: File was encrypted with a different key. Please re-save the file.")
    except Exception as e:
        logger.error(f"❌ Error decrypting context data: {str(e)}")
        logger.error(f"❌ Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        raise

def build_cors_headers(origin: str = None):
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
    }

def validate_user_identity(event: Dict[str, Any]) -> str:
    """
    Extract and validate the authenticated user ID from the request
    """
    try:
        # Option 1: From API Gateway authorizer context
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            user_id = event['requestContext']['authorizer'].get('user_id')
            if user_id:
                return user_id
        
        # Option 2: From API Gateway request context
        if 'requestContext' in event and 'identity' in event['requestContext']:
            user_id = event['requestContext']['identity'].get('cognitoIdentityId')
            if user_id:
                return user_id
        
        # Option 3: From headers
        if 'headers' in event:
            user_id = event['headers'].get('x-user-id') or event['headers'].get('X-User-Id')
            if user_id:
                return user_id
        
        # Option 4: From direct Lambda invocation payload
        if not user_id:
            user_id = event.get('user_id')
        
        # Option 5: From request body (for API Gateway requests)
        if not user_id and 'body' in event:
            try:
                body = json.loads(event['body'])
                user_id = body.get('user_id')
            except (json.JSONDecodeError, KeyError):
                pass
        
        if not user_id:
            logger.error("❌ User validation failed: No authenticated user ID found in request")
            return None
            
        logger.info(f"🔐 Authenticated user ID: {user_id}")
        return user_id
        
    except Exception as e:
        logger.error(f"❌ User validation error: {str(e)}")
        return None

def validate_session_access(user_id: str, session_id: str) -> bool:
    """
    Validate that the user has access to the session
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
            logger.warning(f"🚫 Session access denied: Session {session_id} not found for user {user_id}")
            return False
        
        logger.info(f"✅ Session {session_id} validated for user {user_id}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Session validation failed: {str(e)}")
        return False

def generate_presigned_url(s3_key: str, expiration: int = 3600) -> str:
    """
    Generate a presigned URL for S3 object access with Signature Version 4 for KMS encryption
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

def handle_file_download(event: Dict[str, Any], body: Dict[str, Any], authenticated_user_id: str) -> Dict[str, Any]:
    """
    Handle file download requests - generate fresh presigned URLs
    Supports both chat session files and SEC filings
    """
    try:
        # Extract request parameters
        session_id = body.get('session_id') or None  # Normalize empty string to None
        user_id = body.get('user_id')
        filename = body.get('filename')
        s3_key = body.get('s3_key')
        bucket_name = body.get('bucket')  # Optional: specify bucket (for SEC filings or politician trades)
        
        logger.info(f"🔍 handle_file_download called with: user_id={user_id}, session_id={session_id}, bucket={bucket_name}, s3_key={s3_key}, filename={filename}")
        
        # Determine file type based on bucket name first, then S3 key pattern as fallback
        # Check bucket name first to avoid misclassification (LDA and SEC both use 'filings/' prefix)
        is_filesys = False
        is_congress_bill = False
        if bucket_name == 'SEC_FILINGS':
            is_sec_filing = True
            is_lda_disclosure = False
            is_politician_trade = False
            is_congress_bill = False
        elif bucket_name == 'LDA_DISCLOSURES':
            is_sec_filing = False
            is_lda_disclosure = True
            is_politician_trade = False
            is_congress_bill = False
        elif bucket_name == 'POLITICIAN_TRADES':
            is_sec_filing = False
            is_lda_disclosure = False
            is_politician_trade = True
            is_congress_bill = False
        elif bucket_name == 'CONGRESS_BILLS':
            is_sec_filing = False
            is_lda_disclosure = False
            is_politician_trade = False
            is_congress_bill = True
        else:
            # Fallback to S3 key pattern when bucket is not specified
            # Check for filesys path first (user's file system storage)
            is_filesys = s3_key and s3_key.startswith('users/') and '/filesys/' in s3_key
            # LDA disclosures use 'filings/RR/' or 'filings/LDA/' prefix
            is_lda_disclosure = s3_key and (s3_key.startswith('filings/RR/') or s3_key.startswith('filings/LDA/'))
            is_politician_trade = s3_key and s3_key.startswith('trades/')
            # SEC filings use 'filings/' but not the LDA-specific prefixes
            is_sec_filing = s3_key and s3_key.startswith('filings/') and not is_lda_disclosure
            # Congress bills use 'billtext/' prefix
            is_congress_bill = s3_key and s3_key.startswith('billtext/')
        
        is_public_filing = is_sec_filing or is_lda_disclosure or is_politician_trade or is_congress_bill
        
        logger.info(f"🔍 File type detection: bucket={bucket_name}, s3_key={s3_key}, is_sec_filing={is_sec_filing}, is_lda_disclosure={is_lda_disclosure}, is_politician_trade={is_politician_trade}, is_congress_bill={is_congress_bill}, is_public_filing={is_public_filing}, is_filesys={is_filesys}")
        
        # Handle filesys files (user's file system storage)
        if is_filesys:
            if not s3_key:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameter: s3_key'})
                }
            
            # Validate that s3_key belongs to the authenticated user
            expected_prefix = f"users/{authenticated_user_id}/filesys/"
            if not s3_key.startswith(expected_prefix):
                logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to access filesys file {s3_key}")
                return {
                    'statusCode': 403,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Forbidden: File does not belong to user'})
                }
            
            # Get filename from request parameter, or extract from S3 key as fallback
            requested_filename = body.get('filename')
            target_bucket = S3_BUCKET
            
            # Check if file exists in S3
            try:
                head_response = s3_client.head_object(Bucket=target_bucket, Key=s3_key)
                content_type = head_response.get('ContentType', 'application/octet-stream')
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    return {
                        'statusCode': 404,
                        'headers': build_cors_headers(origin),
                        'body': json.dumps({'error': 'File not found'})
                    }
                else:
                    raise e
            
            # Try to get original filename from filesystem manifest
            # Extract file_id from s3_key (format: users/{user_id}/filesys/{folder_path}/{file_id}{extension})
            s3_key_parts = s3_key.split('/')
            if len(s3_key_parts) >= 3 and s3_key_parts[0] == 'users' and s3_key_parts[2] == 'filesys':
                try:
                    # Get the file_id from the S3 key (last part before extension)
                    file_id_with_ext = s3_key_parts[-1]
                    # Try to find the folder path and get manifest
                    folder_path_parts = s3_key_parts[3:-1] if len(s3_key_parts) > 4 else []
                    folder_path = '/'.join(folder_path_parts) if folder_path_parts else ''
                    
                    # Get manifest to find original filename
                    manifest_key = f"users/{authenticated_user_id}/filesys/{folder_path}/{MANIFEST_FILE}" if folder_path else f"users/{authenticated_user_id}/filesys/{MANIFEST_FILE}"
                    try:
                        manifest_response = s3_client.get_object(Bucket=target_bucket, Key=manifest_key)
                        manifest = json.loads(manifest_response['Body'].read().decode('utf-8'))
                        
                        # Find the item by matching s3_key
                        for item_id, item_data in manifest.get('items', {}).items():
                            if item_data.get('s3_key') == s3_key:
                                # Use current name first (respects renames), then fall back to original filename
                                # Priority: name (current/renamed) > filename > original_filename > name from metadata
                                current_name = item_data.get('name')
                                filename_field = item_data.get('filename')
                                original_filename = item_data.get('metadata', {}).get('original_filename')
                                
                                # Use current name if available (this is what the user sees and may have renamed)
                                if current_name:
                                    requested_filename = current_name
                                    logger.info(f"📝 Using current name from manifest: {current_name}")
                                elif filename_field:
                                    requested_filename = filename_field
                                    logger.info(f"📝 Using filename field from manifest: {filename_field}")
                                elif original_filename:
                                    requested_filename = original_filename
                                    logger.info(f"📝 Using original filename from metadata: {original_filename}")
                                break
                    except ClientError:
                        # Manifest not found or can't read - use fallback
                        logger.debug(f"Could not read manifest for folder: {folder_path}")
                        pass
                except Exception as e:
                    logger.debug(f"Error trying to get filename from manifest: {str(e)}")
                    pass
            
            # Use requested filename if provided, otherwise extract from S3 key
            if requested_filename:
                filename = requested_filename
            else:
                filename = s3_key.split('/')[-1]
            
            # For .cosine encrypted context items, ensure proper content-type and filename
            is_cosine_file = s3_key.endswith('.cosine')
            if is_cosine_file:
                # Ensure filename has .cosine extension
                if not filename.endswith('.cosine'):
                    filename = f"{filename}.cosine" if '.' not in filename else filename.rsplit('.', 1)[0] + '.cosine'
                
                # Set proper content-type for encrypted files
                params = {
                    'Bucket': target_bucket,
                    'Key': s3_key,
                    'ResponseContentType': 'application/octet-stream',
                    'ResponseContentDisposition': f'attachment; filename="{filename}"'
                }
            else:
                # Regular files - use detected content-type
                params = {
                    'Bucket': target_bucket,
                    'Key': s3_key,
                    'ResponseContentDisposition': f'attachment; filename="{filename}"'
                }
                if content_type and content_type != 'application/octet-stream':
                    params['ResponseContentType'] = content_type
            
            presigned_url = s3_client.generate_presigned_url(
                'get_object',
                Params=params,
                ExpiresIn=3600  # 1 hour expiration
            )
            
            logger.info(f"🔗 Generated fresh presigned URL for filesys file {filename} (cosine={is_cosine_file})")
            
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'download_url': presigned_url,
                    'filename': filename,
                    'expires_in': 3600
                })
            }
        
        # Validate user_id (required for chat files, optional for public filings)
        if not is_public_filing and not user_id:
            logger.error("❌ Missing user_id for non-public filing")
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Missing required parameter: user_id'})
            }
        
        # session_id is required for chat files, but optional for public filings (SEC, LDA, politician trades, Congress bills)
        if not is_public_filing and not session_id:
            logger.error(f"❌ Missing session_id for non-public filing: is_public_filing={is_public_filing}, session_id={session_id}")
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Missing required parameter: session_id (required for chat files)'})
            }
        
        # Validate that the authenticated user matches the requested user (only if user_id is provided)
        # For public filings, user_id is optional, so we only validate if both are provided
        if user_id and authenticated_user_id and authenticated_user_id != user_id:
            logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to download file for user {user_id}")
            return {
                'statusCode': 403,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Forbidden: User mismatch'})
            }
        
        if is_sec_filing:
            # SEC filing download - validate user but skip session access check (SEC filings aren't session-specific)
            if not s3_key or not filename:
                logger.error(f"❌ Missing s3_key or filename for SEC filing: s3_key={s3_key}, filename={filename}")
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = SEC_FILINGS_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key so SEC downloads match the actual object (e.g., ZIP)
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 SEC filing download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        elif is_lda_disclosure:
            # LDA disclosure download - validate user but skip session access check (LDA disclosures aren't session-specific)
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = LDA_DISCLOSURES_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 LDA disclosure download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        elif is_politician_trade:
            # Politician trade filing download - validate user but skip session access check (politician trades aren't session-specific)
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = POLITICIAN_TRADES_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 Politician trade filing download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        elif is_congress_bill:
            # Congress bill text download - validate user but skip session access check (Congress bills aren't session-specific)
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = CONGRESS_BILLS_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 Congress bill text download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        else:
            # Chat session file download - require session validation
            if not filename:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing required parameter: filename'})
                }
            
            # Validate session access (ONLY for chat files - SEC filings skip this)
            if not validate_session_access(user_id, session_id):
                return {
                    'statusCode': 403,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Forbidden: Session access denied'})
                }
            
            # Use provided s3_key or construct it for chat files
            if not s3_key:
                s3_key = f"users/{user_id}/sessions/{session_id}/files/{filename}"
            
            target_bucket = S3_BUCKET
        
        # For SEC filings, target_bucket is already set above
        # For chat files, target_bucket is set in the else block above
        
        # Check if file exists in S3
        try:
            s3_client.head_object(Bucket=target_bucket, Key=s3_key)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return {
                    'statusCode': 404,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'File not found'})
                }
            else:
                raise e
        
        # Generate fresh presigned URL with download headers (S3 client already configured for Signature Version 4)
        params = {
            'Bucket': target_bucket,
            'Key': s3_key,
            'ResponseContentDisposition': f'attachment; filename="{filename}"'
        }
        
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params=params,
            ExpiresIn=3600  # 1 hour expiration
        )
        
        logger.info(f"🔗 Generated fresh presigned URL for {filename} from {target_bucket}")
        
        return {
            'statusCode': 200,
            'headers': build_cors_headers(origin),
            'body': json.dumps({
                'download_url': presigned_url,
                'filename': filename,
                'expires_in': 3600
            })
        }
            
    except Exception as e:
        logger.error(f"❌ File download error: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': 'Internal server error'})
        }

def handle_file_content(event: Dict[str, Any], body: Dict[str, Any], authenticated_user_id: str) -> Dict[str, Any]:
    """
    Handle file content requests - return file content directly as base64
    This avoids CORS issues when fetching files from S3
    """
    try:
        user_id = body.get('user_id')
        s3_key = body.get('s3_key')
        bucket_name = body.get('bucket')
        
        logger.info(f"🔍 handle_file_content called with: user_id={user_id}, bucket={bucket_name}, s3_key={s3_key}")
        
        if not s3_key:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Missing required parameter: s3_key'})
            }
        
        # Determine target bucket
        is_filesys = s3_key and s3_key.startswith('users/') and '/filesys/' in s3_key
        
        if is_filesys:
            # Filesystem file - validate user access
            expected_prefix = f"users/{authenticated_user_id}/filesys/"
            if not s3_key.startswith(expected_prefix):
                logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to access filesys file {s3_key}")
                return {
                    'statusCode': 403,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Forbidden: File does not belong to user'})
                }
            target_bucket = S3_BUCKET
        elif bucket_name:
            # Use specified bucket
            target_bucket = bucket_name
        else:
            target_bucket = S3_BUCKET
        
        # Check if file exists in S3
        try:
            s3_client.head_object(Bucket=target_bucket, Key=s3_key)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return {
                    'statusCode': 404,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'File not found'})
                }
            else:
                raise e
        
        # Get file content from S3
        try:
            response = s3_client.get_object(Bucket=target_bucket, Key=s3_key)
            file_content = response['Body'].read()
            
            # Encode to base64
            file_content_base64 = base64.b64encode(file_content).decode('utf-8')
            
            # Get filename from S3 key or request
            filename = body.get('filename') or s3_key.split('/')[-1]
            
            logger.info(f"✅ Retrieved file content for {filename} ({len(file_content)} bytes)")
            
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'file_content': file_content_base64,
                    'filename': filename,
                    'content_type': response.get('ContentType', 'application/octet-stream'),
                    'file_size': len(file_content)
                })
            }
        except Exception as e:
            logger.error(f"❌ Error reading file from S3: {str(e)}")
            return {
                'statusCode': 500,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Failed to read file from S3'})
            }
            
    except Exception as e:
        logger.error(f"❌ File content error: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': 'Internal server error'})
        }

def handle_file_preview(event: Dict[str, Any], body: Dict[str, Any], authenticated_user_id: str) -> Dict[str, Any]:
    """
    Handle file preview requests - return preview data or presigned URLs for viewing
    Supports context items (JSON), images, PDFs, and text files
    """
    try:
        # Extract request parameters
        user_id = body.get('user_id')
        s3_key = body.get('s3_key')
        item_type = body.get('item_type')  # 'context_item', 'uploaded_file', 'agent_file'
        
        logger.info(f"🔍 handle_file_preview called with: user_id={user_id}, s3_key={s3_key}, item_type={item_type}")
        
        # Validate user_id
        if not user_id:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Missing required parameter: user_id'})
            }
        
        # Validate that the authenticated user matches the requested user
        if authenticated_user_id != user_id:
            logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to preview file for user {user_id}")
            return {
                'statusCode': 403,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Forbidden: User mismatch'})
            }
        
        # For context items, we need s3_key
        if not s3_key:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Missing required parameter: s3_key'})
            }
        
        # Validate s3_key belongs to user
        expected_prefix = f"users/{user_id}/filesys/"
        if not s3_key.startswith(expected_prefix):
            logger.warning(f"🚫 Security violation: User {user_id} attempted to access file {s3_key}")
            return {
                'statusCode': 403,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Forbidden: File does not belong to user'})
            }
        
        # Check if file exists in S3
        try:
            head_response = s3_client.head_object(Bucket=S3_BUCKET, Key=s3_key)
            content_type = head_response.get('ContentType', 'application/octet-stream')
            file_size = head_response.get('ContentLength', 0)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return {
                    'statusCode': 404,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'File not found'})
                }
            else:
                raise e
        
        # Determine preview type based on content type and item type
        # .cosine files are ALWAYS encrypted context items (regardless of item_type parameter)
        is_cosine_file = s3_key.lower().endswith('.cosine')
        # Legacy .json files in filesys are context items if they match known context item types
        # Check if it's in the filesys directory to avoid false positives
        is_in_filesys = s3_key.startswith(f"users/{user_id}/filesys/")
        is_legacy_json = (
            s3_key.lower().endswith('.json') and 
            is_in_filesys and (
                item_type == 'context_item' or 
                item_type in ['news_article', 'lda_disclosure', 'sec_filing', 'politician_trade', 'govt_contract', 'congress_bill', 'stock_result'] or
                content_type == 'application/json'  # JSON files in filesys are likely context items
            )
        )
        # .cosine files are always context items, legacy .json files in filesys may be context items
        is_context_item = is_cosine_file or is_legacy_json
        is_image = content_type.startswith('image/')
        is_pdf = content_type == 'application/pdf'
        is_text = content_type.startswith('text/') or content_type in ['application/json', 'application/javascript']
        
        logger.info(f"🔍 Preview type detection: is_cosine_file={is_cosine_file}, is_legacy_json={is_legacy_json}, is_context_item={is_context_item}, content_type={content_type}, item_type={item_type}")
        
        # Handle context items (.cosine encrypted or legacy .json)
        if is_context_item:
            try:
                # Get file content from S3
                response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
                content_bytes = response['Body'].read()
                
                # For .cosine files, decrypt on backend and return decrypted data
                if is_cosine_file:
                    logger.info(f"🔐 Decrypting .cosine encrypted file for preview: {s3_key}")
                    try:
                        context_data = decrypt_context_data(user_id, content_bytes)
                        logger.info(f"✅ Successfully decrypted .cosine file, data keys: {list(context_data.keys()) if isinstance(context_data, dict) else 'N/A'}")
                        
                        return {
                            'statusCode': 200,
                            'headers': build_cors_headers(origin),
                            'body': json.dumps({
                                'preview_type': 'context_item',
                                'encrypted': False,
                                'content': context_data,
                                'metadata': {
                                    'type': context_data.get('type'),
                                    'title': context_data.get('title'),
                                    'subtitle': context_data.get('subtitle'),
                                    'timestamp': context_data.get('timestamp')
                                },
                                'download_url': None  # Will be generated on demand
                            }, default=str)
                        }
                    except Exception as decrypt_error:
                        logger.error(f"❌ Failed to decrypt .cosine file: {str(decrypt_error)}")
                        import traceback
                        logger.error(f"❌ Decryption error traceback: {traceback.format_exc()}")
                        logger.error(f"❌ ENCRYPTION_SECRET configured: {bool(ENCRYPTION_SECRET)}")
                        logger.error(f"❌ ENCRYPTION_SECRET length: {len(ENCRYPTION_SECRET) if ENCRYPTION_SECRET else 0}")
                        logger.error(f"❌ Encrypted data length: {len(content_bytes)} bytes")
                        return {
                            'statusCode': 500,
                            'headers': build_cors_headers(origin),
                            'body': json.dumps({
                                'error': 'Failed to decrypt encrypted context item. File may be corrupted or from a different user.',
                                'details': str(decrypt_error) if logger.level == logging.DEBUG else None
                            })
                        }
                else:
                    # Legacy unencrypted JSON file - parse and return as before
                    logger.info(f"📄 Reading legacy unencrypted JSON file for preview: {s3_key}")
                    context_data = json.loads(content_bytes.decode('utf-8'))
                    
                    return {
                        'statusCode': 200,
                        'headers': build_cors_headers(origin),
                        'body': json.dumps({
                            'preview_type': 'context_item',
                            'encrypted': False,
                            'content': context_data,
                            'metadata': {
                                'type': context_data.get('type'),
                                'title': context_data.get('title'),
                                'subtitle': context_data.get('subtitle'),
                                'timestamp': context_data.get('timestamp')
                            },
                            'download_url': None  # Will be generated on demand
                        }, default=str)
                    }
            except Exception as e:
                logger.error(f"Error reading context item: {str(e)}")
                return {
                    'statusCode': 500,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Failed to read context item'})
                }
        
        # Handle images - return presigned URL for inline viewing
        elif is_image:
            params = {
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ResponseContentType': content_type,
                'ResponseContentDisposition': 'inline'  # View in browser, not download
            }
            
            preview_url = s3_client.generate_presigned_url(
                'get_object',
                Params=params,
                ExpiresIn=3600  # 1 hour expiration
            )
            
            # Also generate download URL
            download_params = {
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ResponseContentDisposition': f'attachment; filename="{os.path.basename(s3_key)}"'
            }
            download_url = s3_client.generate_presigned_url(
                'get_object',
                Params=download_params,
                ExpiresIn=3600
            )
            
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'preview_type': 'image',
                    'preview_url': preview_url,
                    'download_url': download_url,
                    'content_type': content_type,
                    'file_size': file_size,
                    'filename': os.path.basename(s3_key)
                })
            }
        
        # Handle PDFs - return presigned URL for iframe embedding
        elif is_pdf:
            params = {
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ResponseContentType': 'application/pdf',
                'ResponseContentDisposition': 'inline'  # View in browser
            }
            
            preview_url = s3_client.generate_presigned_url(
                'get_object',
                Params=params,
                ExpiresIn=3600
            )
            
            # Also generate download URL
            download_params = {
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ResponseContentDisposition': f'attachment; filename="{os.path.basename(s3_key)}"'
            }
            download_url = s3_client.generate_presigned_url(
                'get_object',
                Params=download_params,
                ExpiresIn=3600
            )
            
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'preview_type': 'pdf',
                    'preview_url': preview_url,
                    'download_url': download_url,
                    'content_type': content_type,
                    'file_size': file_size,
                    'filename': os.path.basename(s3_key)
                })
            }
        
        # Handle text files - return content directly
        elif is_text:
            try:
                response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
                content = response['Body'].read().decode('utf-8')
                
                # Generate download URL
                download_params = {
                    'Bucket': S3_BUCKET,
                    'Key': s3_key,
                    'ResponseContentDisposition': f'attachment; filename="{os.path.basename(s3_key)}"'
                }
                download_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params=download_params,
                    ExpiresIn=3600
                )
                
                return {
                    'statusCode': 200,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({
                        'preview_type': 'text',
                        'content': content,
                        'download_url': download_url,
                        'content_type': content_type,
                        'file_size': file_size,
                        'filename': os.path.basename(s3_key)
                    })
                }
            except Exception as e:
                logger.error(f"Error reading text file: {str(e)}")
                return {
                    'statusCode': 500,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Failed to read file'})
                }
        
        # For other file types, just provide download option
        else:
            # Generate download URL
            download_params = {
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ResponseContentDisposition': f'attachment; filename="{os.path.basename(s3_key)}"'
            }
            download_url = s3_client.generate_presigned_url(
                'get_object',
                Params=download_params,
                ExpiresIn=3600
            )
            
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'preview_type': 'download_only',
                    'preview_url': None,
                    'download_url': download_url,
                    'content_type': content_type,
                    'file_size': file_size,
                    'filename': os.path.basename(s3_key),
                    'message': 'Preview not available for this file type. Please download to view.'
                })
            }
            
    except Exception as e:
        logger.error(f"❌ File preview error: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': 'Internal server error'})
        }

def process_file_return_request(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Process file return request (extracted from lambda_handler for reuse)
    """
    try:
        # Extract origin from request headers for CORS validation
        headers = event.get('headers', {})
        origin = headers.get('Origin') or headers.get('origin')
        
        logger.info(f"🔍 File return request: {json.dumps(event, default=str)}")
        
        # Check if this is a direct Lambda invocation or API Gateway request
        if 'body' in event:
            # API Gateway request - parse body
            body = json.loads(event.get('body', '{}'))
        else:
            # Direct Lambda invocation - event is the payload
            body = event
        
        # Always require authentication (for both SEC filings and chat files)
        authenticated_user_id = validate_user_identity(event)
        if not authenticated_user_id:
            return {
                'statusCode': 401,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Authentication failed: No authenticated user ID found in request'})
            }
        
        # Check if this is a preview request or content request
        request_type = body.get('request_type', 'download')  # 'download', 'preview', or 'content'
        
        if request_type == 'preview':
            return handle_file_preview(event, body, authenticated_user_id)
        elif request_type == 'content':
            return handle_file_content(event, body, authenticated_user_id)
        else:
            # Generate fresh presigned URL for download
            # handle_file_download will validate user_id and session_id for all requests
            # For SEC filings, it will skip session access check but still validate user_id
            return handle_file_download(event, body, authenticated_user_id)
            
    except Exception as e:
        logger.error(f"❌ Lambda handler error: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': 'Internal server error'})
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for file downloads - generates fresh presigned URLs
    Supports SQS events from wrapper Lambda
    """
    completion_sns_topic = os.environ.get('FILE_RETURN_COMPLETION_SNS_TOPIC_ARN')
    
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
                    result = process_file_return_request(event, context)
                    
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
                        try:
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
                        except Exception as sns_error:
                            logger.error(f"❌ Failed to publish SNS notification: {str(sns_error)}")
                    
                    # Return error response with CORS headers instead of raising
                    return {
                        'statusCode': 500,
                        'headers': build_cors_headers(origin),
                        'body': json.dumps({'error': 'Internal server error'})
                    }
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    # Regular API Gateway or direct invocation
    try:
        return process_file_return_request(event, context)
    except Exception as e:
        logger.error(f"❌ Unhandled error in lambda_handler: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': 'Internal server error'})
        }


