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
        bucket_name = body.get('bucket')  # Optional: specify bucket (for SEC filings)
        
        # Determine if this is a SEC filing download (SEC filings don't require session validation)
        is_sec_filing = bucket_name == 'SEC_FILINGS' or (s3_key and s3_key.startswith('filings/'))
        
        if is_sec_filing:
            # SEC filing download - skip session validation
            if not s3_key or not filename:
                return {
                    'statusCode': 400,
                    'headers': get_cors_headers(),
                    'body': json.dumps({'error': 'Missing required parameters: s3_key, filename'})
                }
            
            # Use SEC filings bucket
            target_bucket = SEC_FILINGS_BUCKET or S3_BUCKET
            logger.info(f"📄 SEC filing download request: {s3_key} from bucket {target_bucket}")
        else:
            # Chat session file download - require session validation
        if not session_id or not user_id or not filename:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Missing required parameters: session_id, user_id, filename'})
            }
        
        # Validate that the authenticated user matches the requested user
        if authenticated_user_id != user_id:
            logger.warning(f"🚫 Security violation: User {authenticated_user_id} attempted to download file for user {user_id}")
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Forbidden: User mismatch'})
            }
        
        # Validate session access
        if not validate_session_access(user_id, session_id):
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Forbidden: Session access denied'})
            }
        
        # Use provided s3_key or construct it
        if not s3_key:
            s3_key = f"users/{user_id}/sessions/{session_id}/files/{filename}"
            
            target_bucket = S3_BUCKET
        
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
        
        # Check if this is a SEC filing download (doesn't require authentication)
        bucket_name = body.get('bucket')
        s3_key = body.get('s3_key')
        is_sec_filing = bucket_name == 'SEC_FILINGS' or (s3_key and s3_key.startswith('filings/'))
        
        # For SEC filings, skip authentication
        if is_sec_filing:
            logger.info("📄 SEC filing download - skipping authentication")
            # Use a dummy user_id for SEC filings (not used in validation)
            return handle_file_download(event, body, 'SEC_FILING_USER')
        else:
            # For chat files, require authentication
        authenticated_user_id = validate_user_identity(event)
        
        if not authenticated_user_id:
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Authentication failed: No authenticated user ID found in request'})
            }
        
        # Generate fresh presigned URL for download
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
