import json
import boto3
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
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
    Lambda handler for user dashboard operations
    
    Supported operations:
    - GET: Retrieve user's dashboard configuration
    - PUT: Update user's dashboard configuration
    - POST: Add a new crypto tile to dashboard
    - DELETE: Remove a crypto tile from dashboard
    """
    try:
        # Parse the HTTP method and path
        http_method = event.get('httpMethod', 'GET')
        path = event.get('path', '')
        
        logger.info(f"Processing {http_method} request for path: {path}")
        
        # Extract user ID from path or headers (you'll need to implement auth)
        user_id = extract_user_id(event)
        if not user_id:
            return create_response(401, {"error": "Unauthorized - User ID required"})
        
        # Route to appropriate handler
        if http_method == 'GET':
            return handle_get_dashboard(user_id)
        elif http_method == 'PUT':
            return handle_update_dashboard(user_id, event)
        elif http_method == 'POST':
            return handle_add_tile(user_id, event)
        elif http_method == 'DELETE':
            return handle_remove_tile(user_id, event)
        else:
            return create_response(405, {"error": "Method not allowed"})
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return create_response(500, {"error": "Internal server error"})

def extract_user_id(event: Dict) -> Optional[str]:
    """
    Extract user ID from the request
    TODO: Implement proper authentication/authorization
    """
    # Check query parameters first (for GET requests)
    query_params = event.get('queryStringParameters', {})
    if query_params:
        user_id = query_params.get('userId')
        if user_id:
            return user_id
    
    # Check path parameters
    path_params = event.get('pathParameters', {})
    if path_params:
        user_id = path_params.get('userId')
        if user_id:
            return user_id
    
    # Fallback to header (for testing)
    headers = event.get('headers', {})
    user_id = headers.get('X-User-ID')
    
    return user_id

def handle_get_dashboard(user_id: str) -> Dict:
    """Retrieve user's dashboard configuration"""
    try:
        response = table.get_item(Key={'user_id': user_id})
        
        if 'Item' not in response:
            # Create default dashboard for new user
            default_dashboard = create_default_dashboard()
            table.put_item(Item={
                'user_id': user_id,
                'dashboard_config': default_dashboard,
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            })
            return create_response(200, {'dashboard_config': default_dashboard})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        return create_response(200, {'dashboard_config': dashboard_config})
        
    except Exception as e:
        logger.error(f"Error retrieving dashboard: {str(e)}")
        return create_response(500, {"error": "Failed to retrieve dashboard"})

def handle_update_dashboard(user_id: str, event: Dict) -> Dict:
    """Update user's dashboard configuration"""
    try:
        body = json.loads(event.get('body', '{}'))
        dashboard_config = body.get('dashboard_config')
        
        if not dashboard_config:
            return create_response(400, {"error": "Dashboard configuration required"})
        
        # Validate dashboard configuration
        if not validate_dashboard_config(dashboard_config):
            return create_response(400, {"error": "Invalid dashboard configuration"})
        
        # Update the user profile
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': dashboard_config,
                ':updated': datetime.utcnow().isoformat()
            }
        )
        
        return create_response(200, {'message': 'Dashboard updated successfully'})
        
    except Exception as e:
        logger.error(f"Error updating dashboard: {str(e)}")
        return create_response(500, {"error": "Failed to update dashboard"})

def handle_add_tile(user_id: str, event: Dict) -> Dict:
    """Add a new crypto tile to user's dashboard"""
    try:
        body = json.loads(event.get('body', '{}'))
        tile_config = body.get('tile')
        
        if not tile_config:
            return create_response(400, {"error": "Tile configuration required"})
        
        # Validate tile configuration
        if not validate_tile_config(tile_config):
            return create_response(400, {"error": "Invalid tile configuration"})
        
        # Get current dashboard
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {"error": "User not found"})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Add new tile
        new_tile = {
            'id': f"tile_{len(dashboard_config['crypto_tiles']) + 1}",
            'symbol': tile_config['symbol'],
            'timeframe': tile_config['timeframe'],
            'position': tile_config.get('position', {'x': 0, 'y': 0}),
            'created_at': datetime.utcnow().isoformat()
        }
        
        dashboard_config['crypto_tiles'].append(new_tile)
        dashboard_config['last_updated'] = datetime.utcnow().isoformat()
        
        # Update the user profile
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': dashboard_config,
                ':updated': datetime.utcnow().isoformat()
            }
        )
        
        return create_response(200, {'tile': new_tile, 'message': 'Tile added successfully'})
        
    except Exception as e:
        logger.error(f"Error adding tile: {str(e)}")
        return create_response(500, {"error": "Failed to add tile"})

def handle_remove_tile(user_id: str, event: Dict) -> Dict:
    """Remove a crypto tile from user's dashboard"""
    try:
        path_params = event.get('pathParameters', {})
        tile_id = path_params.get('tileId')
        
        if not tile_id:
            return create_response(400, {"error": "Tile ID required"})
        
        # Get current dashboard
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {"error": "User not found"})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Remove tile
        original_length = len(dashboard_config['crypto_tiles'])
        dashboard_config['crypto_tiles'] = [
            tile for tile in dashboard_config['crypto_tiles'] 
            if tile['id'] != tile_id
        ]
        
        if len(dashboard_config['crypto_tiles']) == original_length:
            return create_response(404, {"error": "Tile not found"})
        
        dashboard_config['last_updated'] = datetime.utcnow().isoformat()
        
        # Update the user profile
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': dashboard_config,
                ':updated': datetime.utcnow().isoformat()
            }
        )
        
        return create_response(200, {'message': 'Tile removed successfully'})
        
    except Exception as e:
        logger.error(f"Error removing tile: {str(e)}")
        return create_response(500, {"error": "Failed to remove tile"})

def create_default_dashboard() -> Dict:
    """Create a default dashboard configuration"""
    return {
        'crypto_tiles': [
            {
                'id': 'tile_1',
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
                'created_at': datetime.utcnow().isoformat()
            }
        ],
        'layout': 'grid',
        'last_updated': datetime.utcnow().isoformat()
    }

def validate_dashboard_config(config: Dict) -> bool:
    """Validate dashboard configuration"""
    required_fields = ['crypto_tiles', 'layout', 'last_updated']
    
    for field in required_fields:
        if field not in config:
            return False
    
    if not isinstance(config['crypto_tiles'], list):
        return False
    
    for tile in config['crypto_tiles']:
        if not validate_tile_config(tile):
            return False
    
    return True

def validate_tile_config(tile: Dict) -> bool:
    """Validate tile configuration"""
    required_fields = ['symbol', 'timeframe']
    
    for field in required_fields:
        if field not in tile:
            return False
    
    # Validate symbol
    valid_symbols = ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI']
    if tile['symbol'] not in valid_symbols:
        return False
    
    # Validate timeframe
    valid_timeframes = ['1d', '7d', '30d', '1y']
    if tile['timeframe'] not in valid_timeframes:
        return False
    
    return True

def create_response(status_code: int, body: Dict) -> Dict:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body)
    }
