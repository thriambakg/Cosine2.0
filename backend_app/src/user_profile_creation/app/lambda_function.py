"""
Cognito Post-Authentication Trigger
Creates user profile with API key on first successful login
"""

import json
import boto3
import uuid
import bcrypt
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['USER_PROFILES_TABLE_NAME'])


def lambda_handler(event, context):
    """
    Cognito trigger: Post-Authentication
    Creates or updates user profile on successful login
    Generates API key on first login
    """
    user_id = event['request']['userAttributes']['sub']
    email = event['request']['userAttributes']['email']
    
    try:
        # Check if profile exists
        response = table.get_item(Key={'user_id': user_id})
        
        if 'Item' in response:
            # Profile exists, just update last login
            table.update_item(
                Key={'user_id': user_id},
                UpdateExpression='SET last_login = :now',
                ExpressionAttributeValues={
                    ':now': datetime.utcnow().isoformat()
                }
            )
            print(f"Updated last login for user: {user_id}")
        else:
            # New user - generate API key
            # Format: sk_{uuid}_{uuid} = 64 random hex chars with prefix
            api_key = f"sk_{uuid.uuid4().hex}_{uuid.uuid4().hex}"
            api_key_prefix = api_key[:8]  # "sk_" + first 5 chars
            
            # Hash the API key using bcrypt
            api_key_hash = bcrypt.hashpw(api_key.encode('utf-8'), bcrypt.gensalt(rounds=10))
            
            # Create user profile with API key
            table.put_item(
                Item={
                    'user_id': user_id,
                    'email': email,
                    'api_key_prefix': api_key_prefix,
                    'api_key_hash': api_key_hash.decode('utf-8'),
                    'api_key_created_at': datetime.utcnow().isoformat(),
                    'created_at': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat(),
                    'last_login': datetime.utcnow().isoformat(),
                    'mfa_enabled': False,
                    'subscription_tier': 'free',
                    'usage': {
                        'api_calls': 0,
                        'quota_limit': 1000  # Free tier: 1000 calls/month
                    }
                }
            )
            
            print(f"Created new user profile for: {user_id}")
            print(f"API key generated (prefix: {api_key_prefix})")
            
            # In production, you would send the API key to the user via email
            # For now, the signup endpoint will return it once
        
        # Return the original event to allow the login to proceed
        return event
        
    except Exception as error:
        print(f"Error creating user profile: {str(error)}")
        raise error
