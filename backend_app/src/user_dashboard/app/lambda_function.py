import json
import boto3
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging
from decimal import Decimal
from migration_utils import safe_load_dashboard, migrate_dashboard_data, validate_dashboard_config

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('USER_PROFILES_TABLE_NAME', 'cosine-user-profiles-production')
table = dynamodb.Table(table_name)

def convert_decimals(obj):
    """Convert Decimal objects to regular numbers for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    else:
        return obj

def convert_floats_to_decimals(obj):
    """Convert float objects to Decimal for DynamoDB storage"""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimals(item) for item in obj]
    else:
        return obj

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
        
        # Handle CORS preflight requests
        if http_method == 'OPTIONS':
            return create_response(200, {'message': 'CORS preflight'})
        
        # Extract user ID from path or headers (you'll need to implement auth)
        user_id = extract_user_id(event)
        if not user_id:
            # For now, use a default user ID for testing
            # TODO: Implement proper authentication
            user_id = "current-user"
            logger.warning(f"No user ID provided, using default: {user_id}")
        
        # Route to appropriate handler based on path and method
        if path.startswith('/tiles'):
            # Handle tile-specific operations
            if http_method == 'POST' and path == '/tiles':
                return handle_add_tile(user_id, event)
            elif http_method == 'DELETE' and path.startswith('/tiles/'):
                # Extract tile ID from path (e.g., /tiles/tile123 -> tile123)
                tile_id = path.split('/')[-1]
                if not tile_id:
                    return create_response(400, {"error": "Tile ID required in path"})
                return handle_remove_tile_by_id(user_id, tile_id)
            elif http_method == 'PUT' and path.startswith('/tiles/'):
                # Extract tile ID from path (e.g., /tiles/tile123 -> tile123)
                tile_id = path.split('/')[-1]
                if not tile_id:
                    return create_response(400, {"error": "Tile ID required in path"})
                
                # Check if this is a position update request
                if path.endswith('/position'):
                    return handle_update_tile_position(user_id, tile_id, event)
                else:
                    return handle_update_tile(user_id, tile_id, event)
            else:
                return create_response(405, {"error": "Method not allowed for tiles endpoint"})
        else:
            # Handle dashboard operations
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
            # Convert Decimal objects to regular numbers for JSON serialization
            default_dashboard = convert_decimals(default_dashboard)
            return create_response(200, {'dashboard_config': default_dashboard})
        
        user_data = response['Item']
        raw_dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Safely load dashboard with migration and validation
        dashboard_config = safe_load_dashboard(raw_dashboard_config)
        
        # Convert Decimal objects to regular numbers for JSON serialization
        dashboard_config = convert_decimals(dashboard_config)
        
        # Check if migration occurred and save if needed
        if raw_dashboard_config != dashboard_config:
            logger.info("Dashboard was migrated, saving updated version")
            try:
                table.update_item(
                    Key={'user_id': user_id},
                    UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
                    ExpressionAttributeValues={
                        ':config': convert_floats_to_decimals(dashboard_config),
                        ':updated': datetime.utcnow().isoformat()
                    }
                )
                logger.info("Migrated dashboard saved successfully")
            except Exception as save_error:
                logger.warning(f"Failed to save migrated dashboard: {str(save_error)}")
        
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
        
        # Safely load and validate dashboard configuration
        dashboard_config = safe_load_dashboard(dashboard_config)
        
        # Additional validation
        validation = validate_dashboard_config(dashboard_config)
        if not validation['valid']:
            logger.warning(f"Dashboard validation failed: {validation['errors']}")
            return create_response(400, {"error": f"Invalid dashboard configuration: {', '.join(validation['errors'])}"})
        
        # Update the user profile
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': convert_floats_to_decimals(dashboard_config),
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
        
        # Find the dashboard to add the tile to (default to first dashboard)
        target_dashboard = None
        dashboard_id = body.get('dashboard_id')
        
        if dashboard_id:
            # Find specific dashboard
            for dashboard in dashboard_config.get('dashboards', []):
                if dashboard['id'] == dashboard_id:
                    target_dashboard = dashboard
                    break
        
        if not target_dashboard:
            # Use first dashboard if no specific dashboard found
            target_dashboard = dashboard_config.get('dashboards', [{}])[0]
        
        # Add new tile with grid properties
        new_tile = {
            'id': f"tile_{int(datetime.utcnow().timestamp() * 1000)}",
            'type': tile_config.get('type', 'crypto'),
            'symbol': tile_config['symbol'],
            'timeframe': tile_config['timeframe'],
            'title': tile_config.get('title', tile_config['symbol']),
            'displayOptions': tile_config.get('displayOptions', {}),
            'autoRefresh': tile_config.get('autoRefresh', False),
            'isPinned': tile_config.get('isPinned', False),
            'size': tile_config.get('size', {'width': 350, 'height': 400}),  # Legacy pixel size
            'gridPosition': tile_config.get('gridPosition', {'x': 0, 'y': 0}),  # Grid position
            'gridSize': tile_config.get('gridSize', {'width': 1, 'height': 1}),  # Grid size
            'dashboard_id': target_dashboard.get('id', 'main'),
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Ensure the dashboard has a tiles array
        if 'tiles' not in target_dashboard:
            target_dashboard['tiles'] = []
        
        target_dashboard['tiles'].append(new_tile)
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

def handle_remove_tile_by_id(user_id: str, tile_id: str) -> Dict:
    """Remove a crypto tile from user's dashboard by tile ID"""
    try:
        # Get current dashboard
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {"error": "User not found"})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Find and remove the tile from all dashboards
        tile_removed = False
        for dashboard in dashboard_config.get('dashboards', []):
            original_length = len(dashboard.get('tiles', []))
            dashboard['tiles'] = [
                tile for tile in dashboard.get('tiles', []) 
                if tile.get('id') != tile_id
            ]
            if len(dashboard.get('tiles', [])) < original_length:
                tile_removed = True
        
        if not tile_removed:
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
        logger.error(f"Error removing tile by ID: {str(e)}")
        return create_response(500, {"error": "Failed to remove tile"})

def handle_update_tile(user_id: str, tile_id: str, event: Dict) -> Dict:
    """Update a specific tile in user's dashboard"""
    try:
        body = json.loads(event.get('body', '{}'))
        
        # Get current dashboard
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {"error": "User not found"})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Find and update the tile
        tile_updated = False
        for dashboard in dashboard_config.get('dashboards', []):
            for tile in dashboard.get('tiles', []):
                if tile.get('id') == tile_id:
                    # Update tile properties
                    for key, value in body.items():
                        if key != 'id':  # Don't allow changing the ID
                            tile[key] = value
                    tile_updated = True
                    break
        
        if not tile_updated:
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
        
        return create_response(200, {'message': 'Tile updated successfully'})
        
    except Exception as e:
        logger.error(f"Error updating tile: {str(e)}")
        return create_response(500, {"error": "Failed to update tile"})

def handle_update_tile_position(user_id: str, tile_id: str, event: Dict) -> Dict:
    """Update a specific tile's position and size in user's dashboard"""
    try:
        body = json.loads(event.get('body', '{}'))
        grid_position = body.get('gridPosition')
        grid_size = body.get('gridSize')
        
        if not grid_position and not grid_size:
            return create_response(400, {"error": "gridPosition or gridSize required"})
        
        # Validate grid position if provided
        if grid_position:
            if not isinstance(grid_position, dict) or 'x' not in grid_position or 'y' not in grid_position:
                return create_response(400, {"error": "Invalid gridPosition format"})
            if not isinstance(grid_position['x'], (int, float)) or not isinstance(grid_position['y'], (int, float)):
                return create_response(400, {"error": "gridPosition x and y must be numbers"})
            if grid_position['x'] < 0 or grid_position['y'] < 0:
                return create_response(400, {"error": "gridPosition x and y must be non-negative"})
        
        # Validate grid size if provided
        if grid_size:
            if not isinstance(grid_size, dict) or 'width' not in grid_size or 'height' not in grid_size:
                return create_response(400, {"error": "Invalid gridSize format"})
            if not isinstance(grid_size['width'], (int, float)) or not isinstance(grid_size['height'], (int, float)):
                return create_response(400, {"error": "gridSize width and height must be numbers"})
            if grid_size['width'] < 1 or grid_size['height'] < 1:
                return create_response(400, {"error": "gridSize width and height must be at least 1"})
        
        # Get current dashboard
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {"error": "User not found"})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard())
        
        # Find and update the tile
        tile_updated = False
        for dashboard in dashboard_config.get('dashboards', []):
            for tile in dashboard.get('tiles', []):
                if tile.get('id') == tile_id:
                    # Update grid position and size
                    if grid_position:
                        tile['gridPosition'] = grid_position
                        # Also update legacy position for backward compatibility
                        tile['position'] = {
                            'x': grid_position['x'] * 60,  # GRID_CELL_SIZE + GRID_GAP
                            'y': grid_position['y'] * 60
                        }
                    
                    if grid_size:
                        tile['gridSize'] = grid_size
                        # Also update legacy size for backward compatibility
                        tile['size'] = {
                            'width': grid_size['width'] * 60,  # GRID_CELL_SIZE + GRID_GAP
                            'height': grid_size['height'] * 60
                        }
                    
                    tile_updated = True
                    break
        
        if not tile_updated:
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
        
        return create_response(200, {'message': 'Tile position/size updated successfully'})
        
    except Exception as e:
        logger.error(f"Error updating tile position/size: {str(e)}")
        return create_response(500, {"error": "Failed to update tile position/size"})

def create_default_dashboard() -> Dict:
    """Create a default dashboard configuration with full tab management"""
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
                'tiles': [],  # Start with empty tiles - no default BTC tile
                'layout': 'grid',
                'created_at': now
            }
        ],
        'activeTabId': 'tab_1',
        'nextTabId': 2,
        'nextGroupId': 1,
        'last_updated': now
    }

def validate_dashboard_config_legacy(config: Dict) -> bool:
    """Validate dashboard configuration"""
    required_fields = ['tabs', 'dashboards', 'last_updated']
    
    for field in required_fields:
        if field not in config:
            return False
    
    if not isinstance(config['tabs'], list) or not isinstance(config['dashboards'], list):
        return False
    
    # Validate tabs
    for tab in config['tabs']:
        if not isinstance(tab, dict) or 'id' not in tab or 'name' not in tab:
            return False
    
    # Validate dashboards
    for dashboard in config['dashboards']:
        if not isinstance(dashboard, dict) or 'id' not in dashboard or 'tiles' not in dashboard:
            return False
        if not isinstance(dashboard['tiles'], list):
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
    
    # Validate grid position if provided
    if 'gridPosition' in tile:
        grid_pos = tile['gridPosition']
        if not isinstance(grid_pos, dict) or 'x' not in grid_pos or 'y' not in grid_pos:
            return False
        if not isinstance(grid_pos['x'], (int, float)) or not isinstance(grid_pos['y'], (int, float)):
            return False
        if grid_pos['x'] < 0 or grid_pos['y'] < 0:
            return False
    
    # Validate grid size if provided
    if 'gridSize' in tile:
        grid_size = tile['gridSize']
        if not isinstance(grid_size, dict) or 'width' not in grid_size or 'height' not in grid_size:
            return False
        if not isinstance(grid_size['width'], (int, float)) or not isinstance(grid_size['height'], (int, float)):
            return False
        if grid_size['width'] < 1 or grid_size['height'] < 1:
            return False
    
    return True

def create_response(status_code: int, body: Dict) -> Dict:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-User-ID',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Max-Age': '86400'
        },
        'body': json.dumps(body)
    }
