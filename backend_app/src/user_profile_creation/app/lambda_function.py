"""
Cognito Post-Authentication Trigger - Cosine2.0 Version
This is a backup/reference version. 
The active user profile creation Lambda is in Cosine-Base-Infra.
"""

import json


def lambda_handler(event, context):
    """
    This Lambda is not currently in use.
    The active user profile creation with API key generation 
    is located in: Cosine-Base-Infra/backend_app/src/user_profile_creation/
    """
    print("WARNING: This Lambda function is not active. User profile creation is handled by Cosine-Base-Infra.")
    return event
