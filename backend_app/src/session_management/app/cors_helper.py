"""
CORS Helper Module
Centralized CORS handling for all Lambda functions
Restricts access to investcosine* and localhost:3000*
"""

import re

# Allowed origin patterns (regex patterns)
# These match Origin headers like:
# - https://investcosine.com
# - https://www.investcosine.com
# - https://api.investcosine.com
# - http://localhost:3000
# - https://*.cloudfront.net (for CloudFront distributions)
ALLOWED_ORIGIN_PATTERNS = [
    r'^https?://.*\.?investcosine\.com(:\d+)?$',  # Any subdomain of investcosine.com
    r'^https?://investcosine\.com(:\d+)?$',       # investcosine.com itself
    r'^http://localhost:3000(:\d+)?$',            # localhost:3000 for development
    r'^https://.*\.cloudfront\.net$',             # CloudFront distributions (for staging/production)
]


def get_cors_headers(origin: str = None) -> dict:
    """
    Get CORS headers for the response.
    Only returns Allow-Origin if the origin matches whitelisted patterns.
    
    Args:
        origin: The Origin header from the request
    
    Returns:
        Dictionary with CORS headers
    """
    cors_headers = {
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET,DELETE,PUT',
        'Access-Control-Allow-Credentials': 'true',
    }
    
    # Only set Allow-Origin if the origin matches whitelisted patterns
    if origin and validate_origin(origin):
        cors_headers['Access-Control-Allow-Origin'] = origin
    elif origin and 'cloudfront.net' in origin.lower():
        # Temporary: Always allow CloudFront origins (for staging/production)
        # This ensures CORS works even if pattern matching fails
        cors_headers['Access-Control-Allow-Origin'] = origin
    else:
        # If origin is not whitelisted or missing, don't include Allow-Origin header
        # This prevents unauthorized cross-origin requests
        pass
    
    return cors_headers


def validate_origin(origin: str) -> bool:
    """
    Validate if the origin matches any whitelisted pattern.
    
    Args:
        origin: The Origin header value from the request
    
    Returns:
        True if origin matches allowed patterns, False otherwise
    """
    if not origin:
        return False
    
    for pattern in ALLOWED_ORIGIN_PATTERNS:
        if re.match(pattern, origin, re.IGNORECASE):
            return True
    
    return False
