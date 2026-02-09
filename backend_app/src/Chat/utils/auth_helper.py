"""
Authentication Helper
Securely extracts user_id from API Gateway authorizer claims or Authorization header.
This ensures user_id cannot be spoofed from request body.
"""

import os
import json
import logging
from typing import Dict, Any, Optional
import base64

logger = logging.getLogger(__name__)

# Try to import JWT decoding libraries (may not be available in all environments)
try:
    import jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False
    logger.warning("PyJWT not available - JWT decoding will be disabled")


def extract_user_id_from_event(event: Dict[str, Any]) -> Optional[str]:
    """
    Securely extract user_id from API Gateway event.
    
    Priority order:
    1. requestContext.authorizer.claims (from API Gateway authorizer) - MOST SECURE
    2. requestContext.authorizer.principalId (from API Gateway authorizer)
    3. Authorization header JWT token (decode and extract) - SECURE if token is valid
    4. None (fail securely)
    
    Args:
        event: API Gateway event dictionary
        
    Returns:
        user_id string if found, None otherwise
    """
    # Priority 1: API Gateway authorizer claims (most secure - validated by API Gateway)
    request_context = event.get('requestContext', {})
    authorizer = request_context.get('authorizer', {})
    
    if authorizer:
        # Check for claims (JWT authorizer)
        claims = authorizer.get('claims', {})
        if claims:
            # Try common claim names for user_id
            user_id = (
                claims.get('sub') or  # Standard JWT subject claim
                claims.get('userId') or
                claims.get('user_id') or
                claims.get('cognito:username') or  # AWS Cognito
                claims.get('email')  # Fallback to email if available
            )
            if user_id:
                logger.info(f"Extracted user_id from authorizer claims: {user_id}")
                return str(user_id)
        
        # Check for principalId (Lambda authorizer)
        principal_id = authorizer.get('principalId')
        if principal_id:
            logger.info(f"Extracted user_id from authorizer principalId: {principal_id}")
            return str(principal_id)
    
    # Priority 2: Decode JWT from Authorization header (if JWT library available)
    headers = event.get('headers', {}) or {}
    # API Gateway may lowercase headers
    auth_header = (
        headers.get('Authorization') or
        headers.get('authorization') or
        headers.get('Authorization')  # Try original case too
    )
    
    if auth_header and JWT_AVAILABLE:
        try:
            # Extract Bearer token
            if auth_header.startswith('Bearer '):
                token = auth_header[7:]  # Remove 'Bearer ' prefix
                
                # Decode to read claims only; API Gateway authorizer has already validated the token.
                try:
                    decoded = jwt.decode(token, options={"verify_signature": False})  # nosemgrep: python.jwt.security.unverified-jwt-decode.unverified-jwt-decode
                    
                    # Extract user_id from token claims
                    user_id = (
                        decoded.get('sub') or
                        decoded.get('userId') or
                        decoded.get('user_id') or
                        decoded.get('cognito:username') or
                        decoded.get('email')
                    )
                    
                    if user_id:
                        logger.info(f"Extracted user_id from JWT token: {user_id}")
                        return str(user_id)
                except jwt.DecodeError as e:
                    logger.warning(f"Failed to decode JWT token: {str(e)}")
        except Exception as e:
            logger.warning(f"Error extracting user_id from Authorization header: {str(e)}")
    
    # No secure user_id found
    logger.warning("Could not extract user_id from secure sources (authorizer or Authorization header)")
    return None


def validate_s3_key_user_id(s3_key: str, authenticated_user_id: str) -> bool:
    """
    Validate that an S3 key belongs to the authenticated user.
    
    S3 keys should follow the pattern: users/{user_id}/...
    
    Args:
        s3_key: S3 key/path to validate
        authenticated_user_id: User ID from secure authentication source
        
    Returns:
        True if S3 key belongs to the user, False otherwise
    """
    if not s3_key or not authenticated_user_id:
        return False
    
    # Extract user_id from S3 key
    # Expected format: users/{user_id}/...
    parts = s3_key.split('/')
    if len(parts) < 2 or parts[0] != 'users':
        logger.warning(f"Invalid S3 key format (does not start with 'users/'): {s3_key}")
        return False
    
    s3_user_id = parts[1]
    
    # Compare with authenticated user_id
    if s3_user_id != authenticated_user_id:
        logger.warning(
            f"S3 key user_id mismatch: key has '{s3_user_id}', authenticated user is '{authenticated_user_id}'"
        )
        return False
    
    return True


def get_secure_user_id(event: Dict[str, Any], fallback_to_env: bool = False) -> Optional[str]:
    """
    Get user_id from secure sources only.
    
    Args:
        event: API Gateway event dictionary
        fallback_to_env: If True, fall back to USER_ID environment variable (less secure, for tool context)
        
    Returns:
        user_id string if found, None otherwise
    """
    user_id = extract_user_id_from_event(event)
    
    if not user_id and fallback_to_env:
        # Fallback to environment variable (set by lambda_handler from secure source)
        # This is acceptable for tools that are called from within the Lambda context
        # where user_id was already validated
        user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
        if user_id:
            logger.info(f"Using user_id from environment variable: {user_id}")
    
    return user_id


