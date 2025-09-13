"""
Dashboard Configuration Lambda Function
Handles CRUD operations for user dashboard configurations in DynamoDB
"""

import json
import boto3
import os
from datetime import datetime
from typing import Dict, Any, Optional
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('USER_PROFILES_TABLE_NAME', 'cosine-user-profiles-production')
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """
    AWS Lambda handler for dashboard configuration operations
    
    Expected event structure:
    {
        "httpMethod": "GET|POST|PUT|DELETE",
        "pathParameters": {"userId": "user_id"},
        "body": "JSON string with dashboard config"
    }
    """
    try:
        # Parse the request
        http_method = event.get('httpMethod', 'GET')
        path_params = event.get('pathParameters') or {}
        user_id = path_params.get('userId')
        
        # Parse body if present
        body = {}
        if event.get('body'):
            try:
                body = json.loads(event['body'])
            except json.JSONDecodeError:
                return create_response(400, {'error': 'Invalid JSON in request body'})
        
        # Set CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        # Handle preflight requests
        if http_method == 'OPTIONS':
            return create_response(200, {}, headers)
        
        # Validate user_id
        if not user_id:
            return create_response(400, {'error': 'User ID is required'}, headers)
        
        # Route to appropriate handler
        if http_method == 'GET':
            return get_dashboard_config(user_id, headers)
        elif http_method == 'PUT':
            return update_dashboard_config(user_id, body, headers)
        elif http_method == 'POST':
            return create_dashboard_config(user_id, body, headers)
        elif http_method == 'DELETE':
            return delete_dashboard_config(user_id, headers)
        else:
            return create_response(405, {'error': f'Method {http_method} not allowed'}, headers)
            
    except Exception as e:
        logger.error(f"Error in dashboard config handler: {str(e)}")
        return create_response(500, {'error': 'Internal server error'}, headers)

def get_dashboard_config(user_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    """Get dashboard configuration for a user"""
    try:
        logger.info(f"Getting dashboard config for user: {user_id}")
        
        # Get user profile
        response = table.get_item(Key={'user_id': user_id})
        
        if 'Item' not in response:
            logger.warning(f"User profile not found for user: {user_id}")
            return create_response(404, {'error': 'User profile not found'}, headers)
        
        user_profile = response['Item']
        dashboard_config = user_profile.get('dashboard_config', {})
        
        logger.info(f"Successfully retrieved dashboard config for user: {user_id}")
        return create_response(200, {
            'user_id': user_id,
            'dashboard_config': dashboard_config,
            'last_updated': user_profile.get('updated_at')
        }, headers)
        
    except Exception as e:
        logger.error(f"Error getting dashboard config: {str(e)}")
        return create_response(500, {'error': 'Failed to retrieve dashboard configuration'}, headers)

def update_dashboard_config(user_id: str, body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    """Update dashboard configuration for a user"""
    try:
        logger.info(f"Updating dashboard config for user: {user_id}")
        
        # Validate request body
        if 'dashboard_config' not in body:
            return create_response(400, {'error': 'dashboard_config is required in request body'}, headers)
        
        dashboard_config = body['dashboard_config']
        now = datetime.utcnow().isoformat()
        
        # Update the user profile with new dashboard config
        response = table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated_at',
            ExpressionAttributeValues={
                ':config': dashboard_config,
                ':updated_at': now
            },
            ConditionExpression='attribute_exists(user_id)',  # Ensure user exists
            ReturnValues='ALL_NEW'
        )
        
        if 'Attributes' not in response:
            return create_response(404, {'error': 'User profile not found'}, headers)
        
        logger.info(f"Successfully updated dashboard config for user: {user_id}")
        return create_response(200, {
            'user_id': user_id,
            'dashboard_config': dashboard_config,
            'last_updated': now,
            'message': 'Dashboard configuration updated successfully'
        }, headers)
        
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        logger.warning(f"User profile not found for update: {user_id}")
        return create_response(404, {'error': 'User profile not found'}, headers)
    except Exception as e:
        logger.error(f"Error updating dashboard config: {str(e)}")
        return create_response(500, {'error': 'Failed to update dashboard configuration'}, headers)

def create_dashboard_config(user_id: str, body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    """Create or initialize dashboard configuration for a user"""
    try:
        logger.info(f"Creating dashboard config for user: {user_id}")
        
        # Check if user exists
        response = table.get_item(Key={'user_id': user_id})
        
        if 'Item' not in response:
            logger.warning(f"User profile not found for user: {user_id}")
            return create_response(404, {'error': 'User profile not found. Please create user profile first.'}, headers)
        
        # Get default dashboard config or use provided one
        dashboard_config = body.get('dashboard_config', create_default_dashboard_config())
        now = datetime.utcnow().isoformat()
        
        # Update the user profile with dashboard config
        response = table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated_at',
            ExpressionAttributeValues={
                ':config': dashboard_config,
                ':updated_at': now
            },
            ReturnValues='ALL_NEW'
        )
        
        logger.info(f"Successfully created dashboard config for user: {user_id}")
        return create_response(201, {
            'user_id': user_id,
            'dashboard_config': dashboard_config,
            'last_updated': now,
            'message': 'Dashboard configuration created successfully'
        }, headers)
        
    except Exception as e:
        logger.error(f"Error creating dashboard config: {str(e)}")
        return create_response(500, {'error': 'Failed to create dashboard configuration'}, headers)

def delete_dashboard_config(user_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    """Delete dashboard configuration for a user (reset to default)"""
    try:
        logger.info(f"Deleting dashboard config for user: {user_id}")
        
        # Reset to default dashboard config
        default_config = create_default_dashboard_config()
        now = datetime.utcnow().isoformat()
        
        # Update the user profile with default dashboard config
        response = table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated_at',
            ExpressionAttributeValues={
                ':config': default_config,
                ':updated_at': now
            },
            ConditionExpression='attribute_exists(user_id)',  # Ensure user exists
            ReturnValues='ALL_NEW'
        )
        
        if 'Attributes' not in response:
            return create_response(404, {'error': 'User profile not found'}, headers)
        
        logger.info(f"Successfully reset dashboard config for user: {user_id}")
        return create_response(200, {
            'user_id': user_id,
            'dashboard_config': default_config,
            'last_updated': now,
            'message': 'Dashboard configuration reset to default'
        }, headers)
        
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        logger.warning(f"User profile not found for deletion: {user_id}")
        return create_response(404, {'error': 'User profile not found'}, headers)
    except Exception as e:
        logger.error(f"Error deleting dashboard config: {str(e)}")
        return create_response(500, {'error': 'Failed to reset dashboard configuration'}, headers)

def create_default_dashboard_config() -> Dict[str, Any]:
    """Create a default dashboard configuration"""
    now = datetime.utcnow().isoformat()
    
    return {
        'tabs': [
            {
                'id': 'tab_1',
                'name': 'My Dashboard',
                'color': '#3b82f6',
                'isPinned': False,
                'created_at': now
            }
        ],
        'tabGroups': [],
        'dashboards': [
            {
                'id': 'dashboard_1',
                'tabId': 'tab_1',
                'name': 'My Dashboard',
                'tiles': [
                    {
                        'id': 'tile_1',
                        'type': 'crypto',
                        'symbol': 'BTC',
                        'timeframe': '1d',
                        'displayOptions': {
                            'showPrice': True,
                            'show24hChange': True,
                            'showAnnualReturn': True,
                            'showVolatility': True,
                            'showChart': True
                        },
                        'autoRefresh': False,
                        'isPinned': False,
                        'size': {'width': 350, 'height': 400},
                        'position': {'x': 0, 'y': 0},
                        'created_at': now
                    }
                ],
                'layout': 'grid',
                'created_at': now
            }
        ],
        'activeTabId': 'tab_1',
        'nextTabId': 2,
        'nextGroupId': 1,
        'last_updated': now
    }

def create_response(status_code: int, body: Dict[str, Any], headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': headers or {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body)
    }
