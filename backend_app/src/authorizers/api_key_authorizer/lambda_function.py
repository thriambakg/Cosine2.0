"""
Lambda Authorizer for API Key Authentication
Validates API keys and returns IAM policy to allow/deny access
Caches validation results for 1 hour
"""

import json
import boto3
import bcrypt
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['USER_PROFILES_TABLE_NAME'])

# In-memory cache for validation results (API Lambda container persistence)
auth_cache = {}
CACHE_TTL_SECONDS = 3600  # 1 hour


def lambda_handler(event, context):
    """
    API Gateway Lambda Authorizer
    Validates X-API-Key header and returns IAM policy
    """
    token = event.get('authorizationToken', '')
    method_arn = event.get('methodArn', '')
    
    if not token or not token.startswith('sk_'):
        print(f"Invalid token format")
        raise Exception('Unauthorized')
    
    try:
        # Check cache first
        cached = auth_cache.get(token)
        if cached:
            from time import time
            if time() - cached['timestamp'] < CACHE_TTL_SECONDS:
                print(f"Auth cache hit for token: {token[:20]}...")
                return generate_policy(cached['principal_id'], 'Allow', method_arn)
        
        # Query DynamoDB by API key prefix for fast lookup
        api_key_prefix = token[:8]
        
        response = table.query(
            IndexName='api_key_prefix-index',
            KeyConditionExpression='api_key_prefix = :prefix',
            ExpressionAttributeValues={
                ':prefix': api_key_prefix
            },
            ProjectionExpression='user_id, api_key_hash, last_api_call'
        )
        
        if not response.get('Items'):
            print(f"No user found with prefix: {api_key_prefix}")
            raise Exception('Unauthorized')
        
        # Verify bcrypt hash against candidates
        valid_user_id = None
        for item in response['Items']:
            try:
                is_valid = bcrypt.checkpw(
                    token.encode('utf-8'),
                    item['api_key_hash'].encode('utf-8')
                )
                if is_valid:
                    valid_user_id = item['user_id']
                    break
            except Exception as e:
                print(f"Bcrypt check error: {str(e)}")
                continue
        
        if not valid_user_id:
            print(f"API key hash mismatch for prefix: {api_key_prefix}")
            raise Exception('Unauthorized')
        
        # Cache the result
        from time import time
        auth_cache[token] = {
            'principal_id': valid_user_id,
            'timestamp': time()
        }
        
        # Update last_api_call timestamp (async, non-blocking)
        try:
            table.update_item(
                Key={'user_id': valid_user_id},
                UpdateExpression='SET last_api_call = :now',
                ExpressionAttributeValues={
                    ':now': datetime.utcnow().isoformat()
                }
            )
        except Exception as e:
            print(f"Failed to update last_api_call: {str(e)}")
            # Don't fail auth if timestamp update fails
        
        print(f"Auth successful for user: {valid_user_id}")
        return generate_policy(valid_user_id, 'Allow', method_arn)
        
    except Exception as error:
        print(f"Authorization error: {str(error)}")
        raise Exception('Unauthorized')


def generate_policy(principal_id, effect, resource):
    """
    Generate IAM policy to allow/deny API Gateway invocation
    """
    auth_response = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource
                }
            ]
        },
        'context': {
            'userId': principal_id
        }
    }
    
    return auth_response
