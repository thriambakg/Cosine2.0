"""
AWS Lambda function for generating fresh presigned URLs on-demand
Simplified to just serve download URLs when requested
"""

import json
import os
import logging
import time
import boto3
from typing import Dict, Any
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3', config=boto3.session.Config(signature_version='s3v4'))

# Environment variables
S3_BUCKET = os.environ.get('S3_BUCKET')
SEC_FILINGS_BUCKET = os.environ.get('SEC_FILINGS_BUCKET')
POLITICIAN_TRADES_BUCKET = os.environ.get('POLITICIAN_TRADES_BUCKET')
SESSIONS_TABLE = os.environ.get('SESSIONS_TABLE')

def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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
        session_id = body.get('session_id')
        user_id = body.get('user_id')
        filename = body.get('filename')
        s3_key = body.get('s3_key')
        bucket_name = body.get('bucket')  # Optional: specify bucket (for SEC filings or politician trades)
        
        # Determine file type based on bucket name or S3 key pattern
        is_sec_filing = bucket_name == 'SEC_FILINGS' or (s3_key and s3_key.startswith('filings/'))
        is_politician_trade = bucket_name == 'POLITICIAN_TRADES' or (s3_key and s3_key.startswith('trades/'))
        
        # Validate user_id and session_id are provided (required for all downloads)
        if not user_id or not session_id:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Missing required parameters: user_id, session_id'})
            }
        
        # Validate that the authenticated user matches the requested user (for all downloads)
        if authenticated_user_id != user_id:
            logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to download file for user {user_id}")
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Forbidden: User mismatch'})
            }
        
        if is_sec_filing:
            # SEC filing download - validate user but skip session access check (SEC filings aren't session-specific)
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': get_cors_headers(),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = SEC_FILINGS_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key so SEC downloads match the actual object (e.g., ZIP)
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 SEC filing download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        elif is_politician_trade:
            # Politician trade filing download - validate user but skip session access check (politician trades aren't session-specific)
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': get_cors_headers(),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            target_bucket = POLITICIAN_TRADES_BUCKET or S3_BUCKET
            # Always derive filename from the requested S3 key
            filename = s3_key.split('/')[-1]
            logger.info(f"📄 Politician trade filing download request: {s3_key} from bucket {target_bucket} for user {user_id}")
        else:
            # Chat session file download - require session validation
            if not filename:
                return {
                    'statusCode': 400,
                    'headers': get_cors_headers(),
                    'body': json.dumps({'error': 'Missing required parameter: filename'})
                }
            
            # Validate session access (ONLY for chat files - SEC filings skip this)
            if not validate_session_access(user_id, session_id):
                return {
                    'statusCode': 403,
                    'headers': get_cors_headers(),
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
                    'headers': get_cors_headers(),
                    'body': json.dumps({'error': 'File not found'})
                }
            else:
                raise e
        
        # Generate fresh presigned URL with download headers (S3 client already configured for Signature Version 4)
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': target_bucket,
                'Key': s3_key,
                'ResponseContentDisposition': f'attachment; filename="{filename}"'
            },
            ExpiresIn=3600  # 1 hour expiration
        )
        
        logger.info(f"🔗 Generated fresh presigned URL for {filename} from {target_bucket}")
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
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
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for file downloads - generates fresh presigned URLs
    """
    try:
        logger.info(f"🔍 File download request: {json.dumps(event, default=str)}")
        
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
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Authentication failed: No authenticated user ID found in request'})
            }
        
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
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }
