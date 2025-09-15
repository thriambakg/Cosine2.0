import json
import boto3
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging
from decimal import Decimal
# Removed migration imports - using clean data structure

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
    Lambda handler for user dashboard operations with clean data structure
    
    Supported operations:
    - GET /dashboard: Retrieve user's dashboard configuration
    - PUT /dashboard: Update user's entire dashboard configuration
    - POST /dashboard: Create new dashboard/tab/group
    - DELETE /dashboard: Delete dashboard/tab/group (with cascading deletes)
    - GET /dashboard/tiles: Retrieve tiles for a dashboard
    - POST /dashboard/tiles: Add a new tile to dashboard
    - PUT /dashboard/tiles/{tileId}: Update a specific tile
    - DELETE /dashboard/tiles/{tileId}: Remove a specific tile
    """
    try:
        # Parse the HTTP method and path
        http_method = event.get('httpMethod', 'GET')
        path = event.get('path', '')
        
        logger.info(f"Processing {http_method} request for path: {path}")
        
        # Handle CORS preflight requests
        if http_method == 'OPTIONS':
            return create_response(200, {'message': 'CORS preflight'})
        
        # Extract user ID from path or headers
        user_id = extract_user_id(event)
        if not user_id:
            # For now, use a default user ID for testing
            # TODO: Implement proper authentication
            user_id = "current-user"
            logger.warning(f"No user ID provided, using default: {user_id}")
        
        # Route to appropriate handler based on path and method
        if path.startswith('/tiles'):
            return handle_tiles_operations(user_id, http_method, path, event)
        else:
            return handle_dashboard_operations(user_id, http_method, path, event)
            
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

def handle_dashboard_operations(user_id: str, http_method: str, path: str, event: Dict) -> Dict:
    """Handle main dashboard operations"""
    if http_method == 'GET':
        return handle_get_dashboard(user_id)
    elif http_method == 'PUT':
        return handle_update_dashboard(user_id, event)
    elif http_method == 'POST':
        return handle_create_dashboard_component(user_id, event)
    elif http_method == 'DELETE':
        return handle_delete_dashboard_component(user_id, event)
    else:
        return create_response(405, {"error": "Method not allowed"})

def handle_tiles_operations(user_id: str, http_method: str, path: str, event: Dict) -> Dict:
    """Handle tile-specific operations"""
    if http_method == 'GET':
        return handle_get_tiles(user_id, event)
    elif http_method == 'POST':
        return handle_add_tile(user_id, event)
    elif http_method == 'PUT':
        # Extract tile ID from path (e.g., /tiles/tile123 -> tile123)
        tile_id = path.split('/')[-1]
        if not tile_id or tile_id == 'tiles':
            return create_response(400, {"error": "Tile ID required in path"})
        return handle_update_tile(user_id, tile_id, event)
    elif http_method == 'DELETE':
        # Extract tile ID from path (e.g., /tiles/tile123 -> tile123)
        tile_id = path.split('/')[-1]
        if not tile_id or tile_id == 'tiles':
            return create_response(400, {"error": "Tile ID required in path"})
        return handle_remove_tile(user_id, tile_id)
    else:
        return create_response(405, {"error": "Method not allowed for tiles endpoint"})

def handle_get_dashboard(user_id: str) -> Dict:
    """Retrieve user's dashboard configuration with clean data structure"""
    try:
        response = table.get_item(Key={'user_id': user_id})
        
        if 'Item' not in response:
            # Create default dashboard for new user with clean structure
            default_dashboard = create_default_dashboard_clean()
            table.put_item(Item={
                'user_id': user_id,
                'dashboard_config': convert_floats_to_decimals(default_dashboard),
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            })
            # Convert Decimal objects to regular numbers for JSON serialization
            default_dashboard = convert_decimals(default_dashboard)
            return create_response(200, {'dashboard_config': default_dashboard})
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard_clean())
        
        # Convert Decimal objects to regular numbers for JSON serialization
        dashboard_config = convert_decimals(dashboard_config)
        
        return create_response(200, {'dashboard_config': dashboard_config})
        
    except Exception as e:
        logger.error(f"Error retrieving dashboard: {str(e)}")
        return create_response(500, {"error": "Failed to retrieve dashboard"})

def handle_update_dashboard(user_id: str, event: Dict) -> Dict:
    """Update user's entire dashboard configuration"""
    try:
        body = json.loads(event.get('body', '{}'))
        dashboard_config = body.get('dashboard_config')
        
        if not dashboard_config:
            return create_response(400, {"error": "Dashboard configuration required"})
        
        # Validate dashboard configuration has required fields
        if not validate_dashboard_structure(dashboard_config):
            return create_response(400, {"error": "Invalid dashboard configuration structure"})
        
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

def handle_create_dashboard_component(user_id: str, event: Dict) -> Dict:
    """Create new dashboard component (tab, group, or dashboard)"""
    try:
        body = json.loads(event.get('body', '{}'))
        component_type = body.get('type')  # 'tab', 'group', or 'dashboard'
        
        if not component_type:
            return create_response(400, {"error": "Component type required (tab, group, or dashboard)"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        now = datetime.utcnow().isoformat()
        
        if component_type == 'tab':
            new_tab = {
                'id': str(uuid.uuid4()),
                'name': body.get('name', 'New Tab'),
                'color': body.get('color', '#3b82f6'),
                'isPinned': body.get('isPinned', False),
                'created_at': now,
                'updated_at': now
            }
            
            dashboard_config['tabs'].append(new_tab)
            dashboard_config['last_updated'] = now
            
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'tab': new_tab, 'message': 'Tab created successfully'})
            
        elif component_type == 'group':
            new_group = {
                'id': str(uuid.uuid4()),
                'name': body.get('name', 'New Group'),
                'color': body.get('color', '#6b7280'),
                'tabs': body.get('tabs', []),
                'created_at': now,
                'updated_at': now
            }
            
            dashboard_config['tabGroups'].append(new_group)
            dashboard_config['last_updated'] = now
            
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'group': new_group, 'message': 'Group created successfully'})
            
        elif component_type == 'dashboard':
            tab_id = body.get('tabId')
            if not tab_id:
                return create_response(400, {"error": "tabId required for dashboard creation"})
            
            # Verify tab exists
            tab_exists = any(tab['id'] == tab_id for tab in dashboard_config.get('tabs', []))
            if not tab_exists:
                return create_response(400, {"error": "Invalid tabId"})
            
            new_dashboard = {
                'id': str(uuid.uuid4()),
                'tabId': tab_id,
                'name': body.get('name', 'New Dashboard'),
                'tiles': [],
                'layout': body.get('layout', 'grid'),
                'created_at': now,
                'updated_at': now,
                'isDefault': body.get('isDefault', False),
                'isPinned': body.get('isPinned', False)
            }
            
            dashboard_config['dashboards'].append(new_dashboard)
            dashboard_config['last_updated'] = now
            
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'dashboard': new_dashboard, 'message': 'Dashboard created successfully'})
        
        else:
            return create_response(400, {"error": "Invalid component type. Must be 'tab', 'group', or 'dashboard'"})
            
    except Exception as e:
        logger.error(f"Error creating dashboard component: {str(e)}")
        return create_response(500, {"error": "Failed to create dashboard component"})

def handle_delete_dashboard_component(user_id: str, event: Dict) -> Dict:
    """Delete dashboard component (tab, group, or dashboard) with cascading deletes"""
    try:
        body = json.loads(event.get('body', '{}'))
        component_type = body.get('type')  # 'tab', 'group', or 'dashboard'
        component_id = body.get('id')
        
        if not component_type or not component_id:
            return create_response(400, {"error": "Component type and ID required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        if component_type == 'tab':
            # Cascading delete: Remove all dashboards and tiles associated with this tab
            dashboard_config['tabs'] = [tab for tab in dashboard_config.get('tabs', []) if tab['id'] != component_id]
            
            # Remove all dashboards for this tab
            original_dashboard_count = len(dashboard_config.get('dashboards', []))
            dashboard_config['dashboards'] = [
                dashboard for dashboard in dashboard_config.get('dashboards', []) 
                if dashboard.get('tabId') != component_id
            ]
            removed_dashboards = original_dashboard_count - len(dashboard_config['dashboards'])
            
            # Remove tab from any groups
            for group in dashboard_config.get('tabGroups', []):
                if component_id in group.get('tabs', []):
                    group['tabs'] = [tid for tid in group['tabs'] if tid != component_id]
            
            # Update active tab if needed
            if dashboard_config.get('activeTabId') == component_id:
                remaining_tabs = dashboard_config.get('tabs', [])
                dashboard_config['activeTabId'] = remaining_tabs[0]['id'] if remaining_tabs else None
            
            dashboard_config['last_updated'] = datetime.utcnow().isoformat()
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {
                'message': f'Tab and {removed_dashboards} associated dashboards deleted successfully'
            })
            
        elif component_type == 'group':
            # Remove the group
            original_group_count = len(dashboard_config.get('tabGroups', []))
            dashboard_config['tabGroups'] = [
                group for group in dashboard_config.get('tabGroups', []) 
                if group['id'] != component_id
            ]
            
            dashboard_config['last_updated'] = datetime.utcnow().isoformat()
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'message': 'Group deleted successfully'})
            
        elif component_type == 'dashboard':
            # Remove the dashboard and all its tiles
            original_dashboard_count = len(dashboard_config.get('dashboards', []))
            dashboard_config['dashboards'] = [
                dashboard for dashboard in dashboard_config.get('dashboards', []) 
                if dashboard['id'] != component_id
            ]
            
            dashboard_config['last_updated'] = datetime.utcnow().isoformat()
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'message': 'Dashboard and all its tiles deleted successfully'})
        
        else:
            return create_response(400, {"error": "Invalid component type. Must be 'tab', 'group', or 'dashboard'"})
            
    except Exception as e:
        logger.error(f"Error deleting dashboard component: {str(e)}")
        return create_response(500, {"error": "Failed to delete dashboard component"})

def handle_get_tiles(user_id: str, event: Dict) -> Dict:
    """Get tiles for a specific dashboard"""
    try:
        query_params = event.get('queryStringParameters', {}) or {}
        dashboard_id = query_params.get('dashboardId')
        
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        if dashboard_id:
            # Get tiles for specific dashboard
            dashboard = next((d for d in dashboard_config.get('dashboards', []) if d['id'] == dashboard_id), None)
            if not dashboard:
                return create_response(404, {"error": "Dashboard not found"})
            
            tiles = dashboard.get('tiles', [])
        else:
            # Get all tiles across all dashboards
            tiles = []
            for dashboard in dashboard_config.get('dashboards', []):
                tiles.extend(dashboard.get('tiles', []))
        
        return create_response(200, {'tiles': tiles})
        
    except Exception as e:
        logger.error(f"Error retrieving tiles: {str(e)}")
        return create_response(500, {"error": "Failed to retrieve tiles"})

def handle_add_tile(user_id: str, event: Dict) -> Dict:
    """Add a new tile to a dashboard"""
    try:
        body = json.loads(event.get('body', '{}'))
        tile_config = body.get('tile')
        dashboard_id = body.get('dashboardId')
        
        if not tile_config:
            return create_response(400, {"error": "Tile configuration required"})
        
        # Validate tile configuration
        if not validate_tile_config(tile_config):
            return create_response(400, {"error": "Invalid tile configuration"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the target dashboard
        target_dashboard = None
        if dashboard_id:
            target_dashboard = next((d for d in dashboard_config.get('dashboards', []) if d['id'] == dashboard_id), None)
        else:
            # Use first dashboard if no specific dashboard found
            dashboards = dashboard_config.get('dashboards', [])
            target_dashboard = dashboards[0] if dashboards else None
        
        if not target_dashboard:
            return create_response(400, {"error": "No dashboard found to add tile to"})
        
        # Create new tile with clean structure
        now = datetime.utcnow().isoformat()
        new_tile = {
            'id': str(uuid.uuid4()),
            'type': tile_config.get('type', 'crypto'),
            'symbol': tile_config.get('symbol'),
            'timeframe': tile_config.get('timeframe', '1d'),
            'title': tile_config.get('title', tile_config.get('symbol', 'Untitled')),
            'displayOptions': tile_config.get('displayOptions', {}),
            'autoRefresh': tile_config.get('autoRefresh', False),
            'isPinned': tile_config.get('isPinned', False),
            'gridPosition': tile_config.get('gridPosition', {'x': 0, 'y': 0}),
            'gridSize': tile_config.get('gridSize', {'width': 1, 'height': 1}),
            'dashboard_id': target_dashboard['id'],
            'created_at': now,
            'updated_at': now
        }
        
        # Add tile to dashboard
        if 'tiles' not in target_dashboard:
            target_dashboard['tiles'] = []
        
        target_dashboard['tiles'].append(new_tile)
        target_dashboard['updated_at'] = now
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        return create_response(200, {'tile': new_tile, 'message': 'Tile added successfully'})
        
    except Exception as e:
        logger.error(f"Error adding tile: {str(e)}")
        return create_response(500, {"error": "Failed to add tile"})

def handle_update_tile(user_id: str, tile_id: str, event: Dict) -> Dict:
    """Update an existing tile"""
    try:
        body = json.loads(event.get('body', '{}'))
        tile_updates = body.get('tile', {})
        
        if not tile_updates:
            return create_response(400, {"error": "Tile updates required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the tile across all dashboards
        target_tile = None
        target_dashboard = None
        
        for dashboard in dashboard_config.get('dashboards', []):
            for tile in dashboard.get('tiles', []):
                if tile['id'] == tile_id:
                    target_tile = tile
                    target_dashboard = dashboard
                    break
            if target_tile:
                break
        
        if not target_tile:
            return create_response(404, {"error": "Tile not found"})
        
        # Update tile properties
        now = datetime.utcnow().isoformat()
        for key, value in tile_updates.items():
            if key in ['id', 'created_at']:  # Protect immutable fields
                continue
            target_tile[key] = value
        
        target_tile['updated_at'] = now
        target_dashboard['updated_at'] = now
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        return create_response(200, {'tile': target_tile, 'message': 'Tile updated successfully'})
        
    except Exception as e:
        logger.error(f"Error updating tile: {str(e)}")
        return create_response(500, {"error": "Failed to update tile"})

def handle_remove_tile(user_id: str, tile_id: str) -> Dict:
    """Remove a tile from dashboard"""
    try:
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find and remove the tile
        tile_found = False
        for dashboard in dashboard_config.get('dashboards', []):
            original_tile_count = len(dashboard.get('tiles', []))
            dashboard['tiles'] = [tile for tile in dashboard.get('tiles', []) if tile['id'] != tile_id]
            if len(dashboard['tiles']) < original_tile_count:
                tile_found = True
                dashboard['updated_at'] = datetime.utcnow().isoformat()
                break
        
        if not tile_found:
            return create_response(404, {"error": "Tile not found"})
        
        dashboard_config['last_updated'] = datetime.utcnow().isoformat()
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        return create_response(200, {'message': 'Tile removed successfully'})
        
    except Exception as e:
        logger.error(f"Error removing tile: {str(e)}")
        return create_response(500, {"error": "Failed to remove tile"})


# Helper functions

def get_user_dashboard(user_id: str) -> Optional[Dict]:
    """Get user's dashboard configuration from database"""
    try:
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return None
        
        user_data = response['Item']
        dashboard_config = user_data.get('dashboard_config', create_default_dashboard_clean())
        
        return dashboard_config
        
    except Exception as e:
        logger.error(f"Error getting user dashboard: {str(e)}")
        return None

def save_user_dashboard(user_id: str, dashboard_config: Dict) -> bool:
    """Save user's dashboard configuration to database"""
    try:
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': convert_floats_to_decimals(dashboard_config),
                ':updated': datetime.utcnow().isoformat()
            }
        )
        return True
        
    except Exception as e:
        logger.error(f"Error saving user dashboard: {str(e)}")
        return False

def create_default_dashboard_clean() -> Dict:
    """Create a default dashboard configuration with clean data structure"""
    now = datetime.utcnow().isoformat()
    tab_id = str(uuid.uuid4())
    dashboard_id = str(uuid.uuid4())
    
    return {
        'tabs': [
            {
                'id': tab_id,
                'name': 'My Dashboard',
                'color': '#3b82f6',
                'isPinned': False,
                'created_at': now,
                'updated_at': now
            }
        ],
        'tabGroups': [],
        'dashboards': [
            {
                'id': dashboard_id,
                'tabId': tab_id,
                'name': 'My Dashboard',
                'tiles': [],
                'layout': 'grid',
                'created_at': now,
                'updated_at': now,
                'isDefault': True,
                'isPinned': False
            }
        ],
        'activeTabId': tab_id,
        'last_updated': now
    }

def validate_dashboard_structure(config: Dict) -> bool:
    """Validate dashboard configuration structure"""
    required_fields = ['tabs', 'dashboards', 'activeTabId']
    
    for field in required_fields:
        if field not in config:
            logger.error(f"Missing required field: {field}")
            return False
    
    if not isinstance(config['tabs'], list) or not isinstance(config['dashboards'], list):
        logger.error("tabs and dashboards must be arrays")
        return False
    
    # Validate tabs
    for tab in config['tabs']:
        if not isinstance(tab, dict) or 'id' not in tab or 'name' not in tab:
            logger.error("Invalid tab structure")
            return False
    
    # Validate dashboards
    for dashboard in config['dashboards']:
        if not isinstance(dashboard, dict) or 'id' not in dashboard or 'tiles' not in dashboard:
            logger.error("Invalid dashboard structure")
            return False
        if not isinstance(dashboard['tiles'], list):
            logger.error("Dashboard tiles must be an array")
            return False
    
    return True

def validate_tile_config(tile: Dict) -> bool:
    """Validate tile configuration"""
    required_fields = ['symbol', 'timeframe']
    
    for field in required_fields:
        if field not in tile:
            return False
    
    # Validate symbol (allow any string for flexibility)
    if not isinstance(tile['symbol'], str) or not tile['symbol'].strip():
        return False
    
    # Validate timeframe
    valid_timeframes = ['1d', '7d', '30d', '1y', '1h', '4h']
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
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body)
    }