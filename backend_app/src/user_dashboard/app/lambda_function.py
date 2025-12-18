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
    
    Handles both:
    1. API Gateway events (direct invocation)
    2. SQS events (from wrapper Lambda when worker is at concurrency)
    
    Supported operations:
    - GET /dashboard: Retrieve user's dashboard configuration
    - PUT /dashboard: Update user's entire dashboard configuration
    - POST /dashboard: Create new dashboard/tab/group
    - DELETE /dashboard: Delete dashboard/tab/group (with cascading deletes)
    - GET /dashboard/tiles: Retrieve tiles for a dashboard
    - POST /dashboard/tiles: Add a new tile to dashboard
    - PUT /dashboard/tiles/{tileId}: Update a specific tile
    - DELETE /dashboard/tiles/{tileId}: Remove a specific tile
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "GET|POST|PUT|DELETE",
        "path": "/dashboard",
        "body": "..."
    }
    
    Expected event structure (SQS):
    {
        "Records": [{
            "eventSource": "aws:sqs",
            "body": "{\"request_id\": \"...\", \"job_id\": \"...\", \"api_gateway_event\": {...}}"
        }]
    }
    """
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('USER_DASHBOARD_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            is_sqs_event = True
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract job_id, request_id, and API Gateway event
                job_id = message_body.get('job_id')
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', {})
                
                logger.info(f"📬 Processing SQS message - job_id: {job_id}, request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return create_response(500, {'error': f'Failed to parse SQS message: {str(e)}'})
    
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
            logger.error("No user ID provided in request")
            return create_response(400, {'error': 'User ID is required'})
        
        # Route to appropriate handler based on path and method
        if path.startswith('/tiles'):
            result = handle_tiles_operations(user_id, http_method, path, event)
        elif path.startswith('/reorder'):
            result = handle_reorder_components(user_id, event)
        else:
            result = handle_dashboard_operations(user_id, http_method, path, event)
        
        # If this was from SQS, publish completion notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                # Extract body from result for SNS message
                result_body = json.loads(result.get('body', '{}')) if isinstance(result.get('body'), str) else result.get('body', {})
                completion_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': result.get('statusCode', 200),
                    'body': result_body,
                    'status': 'completed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(completion_message, default=str),
                    Subject=f'User Dashboard Completion: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published completion notification for job {job_id}")
            except Exception as e:
                logger.error(f"Error publishing completion notification: {e}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (results sent via SNS)
        if is_sqs_event:
            return create_response(200, {'message': 'Processed from SQS', 'job_id': job_id})
        
        # For direct API Gateway calls, return full response
        return result
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        
        # If this was from SQS, publish failure notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                failure_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 500,
                    'body': {'error': 'Internal server error'},
                    'status': 'failed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(failure_message, default=str),
                    Subject=f'User Dashboard Failure: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published failure notification for job {job_id}")
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {e2}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (error sent via SNS)
        if is_sqs_event:
            return create_response(500, {'message': 'Request failed', 'job_id': job_id, 'error': str(e)})
        
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
        raw_dashboard_config = user_data.get('dashboard_config', create_default_dashboard_clean())
        
        # Clean up any old data structure (remove dashboards field if present)
        dashboard_config = cleanup_old_data_structure(raw_dashboard_config)
        
        # Convert Decimal objects to regular numbers for JSON serialization
        dashboard_config = convert_decimals(dashboard_config)
        
        # Save cleaned data if it was modified
        if raw_dashboard_config != dashboard_config:
            logger.info("Cleaning up old data structure and saving to database")
            try:
                table.update_item(
                    Key={'user_id': user_id},
                    UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
                    ExpressionAttributeValues={
                        ':config': convert_floats_to_decimals(dashboard_config),
                        ':updated': datetime.utcnow().isoformat()
                    }
                )
                logger.info("Cleaned data structure saved successfully")
            except Exception as save_error:
                logger.warning(f"Failed to save cleaned data structure: {str(save_error)}")
        
        return create_response(200, {'dashboard_config': dashboard_config})
        
    except Exception as e:
        logger.error(f"Error retrieving dashboard: {str(e)}")
        return create_response(500, {"error": "Failed to retrieve dashboard"})

def handle_update_dashboard(user_id: str, event: Dict) -> Dict:
    """Update user's entire dashboard configuration"""
    try:
        body = json.loads(event.get('body', '{}'))
        
        # Check if this is a reorder request
        if body.get('type') in ['reorder_tabs', 'reorder_groups']:
            return handle_reorder_components(user_id, body)
        
        # Check if this is an add tile request
        if body.get('type') == 'add_tile':
            return handle_add_tile(user_id, event)
        
        dashboard_config = body.get('dashboard_config')
        
        if not dashboard_config:
            return create_response(400, {"error": "Dashboard configuration required"})
        
        # Log the received dashboard config for debugging
        logger.info(f"Received dashboard config for user {user_id}")
        logger.info(f"TabGroups in received config: {[{'id': g.get('id'), 'name': g.get('name'), 'tabs': g.get('tabs', []), 'tabIds': g.get('tabIds', [])} for g in dashboard_config.get('tabGroups', [])]}")
        
        # Clean up any old data structure
        dashboard_config = cleanup_old_data_structure(dashboard_config)
        
        # Log the cleaned config
        logger.info(f"TabGroups after cleanup: {[{'id': g.get('id'), 'name': g.get('name'), 'tabs': g.get('tabs', []), 'tabIds': g.get('tabIds', [])} for g in dashboard_config.get('tabGroups', [])]}")
        
        # Validate dashboard configuration has required fields
        if not validate_dashboard_structure(dashboard_config):
            return create_response(400, {"error": "Invalid dashboard configuration structure"})
        
        # Update the user profile
        # Note: All tile properties (including paginationState, searchParams, filterSettings, etc.) 
        # are preserved and saved to database. Only results and lastUpdated are filtered out on frontend.
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
    """Create new dashboard component (tab, group, or add tile)"""
    try:
        body = json.loads(event.get('body', '{}'))
        component_type = body.get('type')  # 'tab', 'group', or 'add_tile'
        
        logger.info(f"Creating dashboard component: type={component_type}, user_id={user_id}")
        
        if not component_type:
            return create_response(400, {"error": "Component type required (tab, group, or add_tile)"})
        
        # Handle add_tile requests
        if component_type == 'add_tile':
            return handle_add_tile(user_id, event)
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        logger.info(f"Retrieved dashboard config: keys={list(dashboard_config.keys())}")
        
        now = datetime.utcnow().isoformat()
        
        if component_type == 'tab':
            new_tab = {
                'id': str(uuid.uuid4()),
                'name': body.get('name', 'New Tab'),
                'color': body.get('color', '#3b82f6'),
                'isPinned': body.get('isPinned', False),
                'tiles': [],
                'layout': body.get('layout', 'grid'),
                'created_at': now,
                'updated_at': now
            }
            
            # Ensure tabs array exists
            if 'tabs' not in dashboard_config:
                logger.warning("Missing 'tabs' key in dashboard config, initializing")
                dashboard_config['tabs'] = []
            
            dashboard_config['tabs'].append(new_tab)
            
            # Add new tab to the end of tabOrder
            if 'tabOrder' not in dashboard_config:
                dashboard_config['tabOrder'] = []
            dashboard_config['tabOrder'].append(new_tab['id'])
            
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
            
            # Ensure tabGroups array exists
            if 'tabGroups' not in dashboard_config:
                logger.warning("Missing 'tabGroups' key in dashboard config, initializing")
                dashboard_config['tabGroups'] = []
            
            dashboard_config['tabGroups'].append(new_group)
            
            # Add new group to the end of groupOrder
            if 'groupOrder' not in dashboard_config:
                dashboard_config['groupOrder'] = []
            dashboard_config['groupOrder'].append(new_group['id'])
            
            dashboard_config['last_updated'] = now
            
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'group': new_group, 'message': 'Group created successfully'})
        
        else:
            return create_response(400, {"error": "Invalid component type. Must be 'tab' or 'group'"})
            
    except Exception as e:
        logger.error(f"Error creating dashboard component: {str(e)}")
        logger.error(f"Component type: {component_type}, User ID: {user_id}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return create_response(500, {"error": "Failed to create dashboard component"})

def handle_reorder_components(user_id: str, event: Dict) -> Dict:
    """Reorder tabs or groups"""
    try:
        body = json.loads(event.get('body', '{}'))
        component_type = body.get('type')  # 'reorder_tabs', 'reorder_groups', 'tab', or 'group'
        new_order = body.get('order', [])  # Array of IDs in new order
        
        if not component_type or not new_order:
            return create_response(400, {"error": "Component type and order array required"})
        
        # Normalize component type
        if component_type == 'reorder_tabs':
            component_type = 'tab'
        elif component_type == 'reorder_groups':
            component_type = 'group'
        
        if component_type not in ['tab', 'group']:
            return create_response(400, {"error": "Component type must be 'reorder_tabs', 'reorder_groups', 'tab', or 'group'"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Validate that all IDs in new_order exist
        if component_type == 'tab':
            existing_ids = {tab['id'] for tab in dashboard_config.get('tabs', [])}
            order_key = 'tabOrder'
        else:  # group
            existing_ids = {group['id'] for group in dashboard_config.get('tabGroups', [])}
            order_key = 'groupOrder'
        
        # Check if all IDs in new_order exist
        if not all(tab_id in existing_ids for tab_id in new_order):
            return create_response(400, {"error": f"Some {component_type} IDs in order array do not exist"})
        
        # Allow partial reordering - check if all IDs in new_order are valid
        # (Don't require all existing IDs to be in new_order)
        
        # Update the order
        dashboard_config[order_key] = new_order
        dashboard_config['last_updated'] = datetime.utcnow().isoformat()
        
        # Save to database
        save_user_dashboard(user_id, dashboard_config)
        
        return create_response(200, {
            'message': f'{component_type.capitalize()} order updated successfully',
            'order': new_order
        })
        
    except Exception as e:
        logger.error(f"Error reordering components: {str(e)}")
        return create_response(500, {"error": "Failed to reorder components"})

def handle_delete_dashboard_component(user_id: str, event: Dict) -> Dict:
    """Delete dashboard component (tab or group) with cascading deletes"""
    try:
        body = json.loads(event.get('body', '{}'))
        component_type = body.get('type')  # 'tab' or 'group'
        component_id = body.get('id')
        
        if not component_type or not component_id:
            return create_response(400, {"error": "Component type and ID required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        if component_type == 'tab':
            # Remove the tab (tiles are included in the tab)
            dashboard_config['tabs'] = [tab for tab in dashboard_config.get('tabs', []) if tab['id'] != component_id]
            
            # Remove tab from any groups
            for group in dashboard_config.get('tabGroups', []):
                if component_id in group.get('tabs', []):
                    group['tabs'] = [tid for tid in group['tabs'] if tid != component_id]
            
            # Update active tab if needed
            if dashboard_config.get('activeTabId') == component_id:
                remaining_tabs = dashboard_config.get('tabs', [])
                dashboard_config['activeTabId'] = remaining_tabs[0]['id'] if remaining_tabs else None
            
            # Remove tab ID from tabOrder
            if 'tabOrder' in dashboard_config:
                dashboard_config['tabOrder'] = [tid for tid in dashboard_config['tabOrder'] if tid != component_id]
            
            dashboard_config['last_updated'] = datetime.utcnow().isoformat()
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'message': 'Tab and all its tiles deleted successfully'})
            
        elif component_type == 'group':
            # Remove the group
            dashboard_config['tabGroups'] = [
                group for group in dashboard_config.get('tabGroups', []) 
                if group['id'] != component_id
            ]
            
            # Remove group ID from groupOrder
            if 'groupOrder' in dashboard_config:
                dashboard_config['groupOrder'] = [gid for gid in dashboard_config['groupOrder'] if gid != component_id]
            
            dashboard_config['last_updated'] = datetime.utcnow().isoformat()
            save_user_dashboard(user_id, dashboard_config)
            
            return create_response(200, {'message': 'Group deleted successfully'})
        
        else:
            return create_response(400, {"error": "Invalid component type. Must be 'tab' or 'group'"})
            
    except Exception as e:
        logger.error(f"Error deleting dashboard component: {str(e)}")
        return create_response(500, {"error": "Failed to delete dashboard component"})

def handle_get_tiles(user_id: str, event: Dict) -> Dict:
    """Get tiles for a specific tab"""
    try:
        query_params = event.get('queryStringParameters', {}) or {}
        tab_id = query_params.get('tabId')
        
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        if tab_id:
            # Get tiles for specific tab
            tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == tab_id), None)
            if not tab:
                return create_response(404, {"error": "Tab not found"})
            
            tiles = tab.get('tiles', [])
        else:
            # Get all tiles across all tabs
            tiles = []
            for tab in dashboard_config.get('tabs', []):
                tiles.extend(tab.get('tiles', []))
        
        return create_response(200, {'tiles': tiles})
        
    except Exception as e:
        logger.error(f"Error retrieving tiles: {str(e)}")
        return create_response(500, {"error": "Failed to retrieve tiles"})

def handle_add_tile(user_id: str, event: Dict) -> Dict:
    """Add a new tile to a tab"""
    try:
        body = json.loads(event.get('body', '{}'))
        tile_config = body.get('tile')
        tab_id = body.get('tabId')
        
        if not tile_config:
            return create_response(400, {"error": "Tile configuration required"})
        
        # Validate tile configuration
        if not validate_tile_config(tile_config):
            return create_response(400, {"error": "Invalid tile configuration"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the target tab
        target_tab = None
        if tab_id:
            target_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == tab_id), None)
        else:
            # Use active tab if no specific tab found
            active_tab_id = dashboard_config.get('activeTabId')
            if active_tab_id:
                target_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == active_tab_id), None)
            else:
                # Use first tab if no active tab
                tabs = dashboard_config.get('tabs', [])
                target_tab = tabs[0] if tabs else None
        
        if not target_tab:
            return create_response(400, {"error": "No tab found to add tile to"})
        
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
            'tab_id': target_tab['id'],
            'created_at': now,
            'updated_at': now
        }
        
        # Add tile to tab
        if 'tiles' not in target_tab:
            target_tab['tiles'] = []
        
        target_tab['tiles'].append(new_tile)
        target_tab['updated_at'] = now
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
        
        # Find the tile across all tabs
        target_tile = None
        target_tab = None
        
        for tab in dashboard_config.get('tabs', []):
            for tile in tab.get('tiles', []):
                if tile['id'] == tile_id:
                    target_tile = tile
                    target_tab = tab
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
        target_tab['updated_at'] = now
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        return create_response(200, {'tile': target_tile, 'message': 'Tile updated successfully'})
        
    except Exception as e:
        logger.error(f"Error updating tile: {str(e)}")
        return create_response(500, {"error": "Failed to update tile"})

def handle_remove_tile(user_id: str, tile_id: str) -> Dict:
    """Remove a tile from tab"""
    try:
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find and remove the tile
        tile_found = False
        for tab in dashboard_config.get('tabs', []):
            original_tile_count = len(tab.get('tiles', []))
            tab['tiles'] = [tile for tile in tab.get('tiles', []) if tile['id'] != tile_id]
            if len(tab['tiles']) < original_tile_count:
                tile_found = True
                tab['updated_at'] = datetime.utcnow().isoformat()
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

def cleanup_old_data_structure(config: Dict) -> Dict:
    """Clean up old data structure by removing dashboards field and ensuring tabs have tiles
    
    Note: This function only removes the old 'dashboards' field and ensures structure.
    All tile properties (including paginationState, searchParams, filterSettings, etc.) 
    are preserved and not filtered out.
    """
    cleaned_config = config.copy()
    
    # Remove old dashboards field if it exists
    if 'dashboards' in cleaned_config:
        logger.info("Removing old dashboards field from data structure")
        del cleaned_config['dashboards']
    
    # Ensure tabs key exists
    if 'tabs' not in cleaned_config:
        logger.warning("Missing 'tabs' key in dashboard config, initializing with empty array")
        cleaned_config['tabs'] = []
    
    # Ensure all tabs have tiles array
    # Note: All tile properties are preserved - we only ensure the array exists
    for tab in cleaned_config.get('tabs', []):
        if 'tiles' not in tab:
            tab['tiles'] = []
        if 'layout' not in tab:
            tab['layout'] = 'grid'
    
    # Ensure required fields exist
    if 'tabGroups' not in cleaned_config:
        cleaned_config['tabGroups'] = []
    
    # Ensure each tab group has proper structure
    for group in cleaned_config.get('tabGroups', []):
        # Ensure tabs array exists (for group membership)
        if 'tabs' not in group:
            # Initialize from tabIds if it exists, otherwise empty array
            group['tabs'] = group.get('tabIds', [])
            logger.info(f"Initialized tabs array for group {group.get('id', 'unknown')}: {group['tabs']}")
        # Ensure tabIds array exists for backward compatibility
        if 'tabIds' not in group:
            group['tabIds'] = group.get('tabs', [])
            logger.info(f"Initialized tabIds array for group {group.get('id', 'unknown')}: {group['tabIds']}")
        
        logger.info(f"Group {group.get('id', 'unknown')} final state: tabs={group.get('tabs', [])}, tabIds={group.get('tabIds', [])}")
    
    # Ensure order arrays exist and are properly initialized
    if 'tabOrder' not in cleaned_config:
        # Initialize tabOrder from existing tabs
        cleaned_config['tabOrder'] = [tab['id'] for tab in cleaned_config.get('tabs', [])]
        logger.info("Initialized tabOrder from existing tabs")
    
    if 'groupOrder' not in cleaned_config:
        cleaned_config['groupOrder'] = []
        logger.info("Initialized groupOrder as empty array")
    
    # Ensure tabOrder contains all tab IDs and no extras
    existing_tab_ids = {tab['id'] for tab in cleaned_config.get('tabs', [])}
    current_tab_order = cleaned_config.get('tabOrder', [])
    
    # Remove any tab IDs from tabOrder that don't exist in tabs
    cleaned_tab_order = [tab_id for tab_id in current_tab_order if tab_id in existing_tab_ids]
    
    # Add any new tab IDs that aren't in tabOrder
    for tab_id in existing_tab_ids:
        if tab_id not in cleaned_tab_order:
            cleaned_tab_order.append(tab_id)
    
    cleaned_config['tabOrder'] = cleaned_tab_order
    
    return cleaned_config

def get_user_dashboard(user_id: str) -> Optional[Dict]:
    """Get user's dashboard configuration from database"""
    try:
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return None
        
        user_data = response['Item']
        raw_dashboard_config = user_data.get('dashboard_config', create_default_dashboard_clean())
        
        # Clean up any old data structure
        dashboard_config = cleanup_old_data_structure(raw_dashboard_config)
        
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
    """Create a default dashboard configuration with simplified Tab = Dashboard structure"""
    now = datetime.utcnow().isoformat()
    tab_id = str(uuid.uuid4())
    
    return {
        'tabs': [
            {
                'id': tab_id,
                'name': 'My Dashboard',
                'color': '#3b82f6',
                'isPinned': False,
                'tiles': [],
                'layout': 'grid',
                'created_at': now,
                'updated_at': now
            }
        ],
        'tabGroups': [],
        'tabOrder': [tab_id],  # Ordered array of tab IDs
        'groupOrder': [],      # Ordered array of group IDs
        'activeTabId': tab_id,
        'last_updated': now
    }

def validate_dashboard_structure(config: Dict) -> bool:
    """Validate dashboard configuration structure"""
    required_fields = ['tabs', 'activeTabId', 'tabOrder', 'groupOrder']
    
    for field in required_fields:
        if field not in config:
            logger.error(f"Missing required field: {field}")
            return False
    
    if not isinstance(config['tabs'], list):
        logger.error("tabs must be an array")
        return False
    
    if not isinstance(config['tabOrder'], list):
        logger.error("tabOrder must be an array")
        return False
    
    if not isinstance(config['groupOrder'], list):
        logger.error("groupOrder must be an array")
        return False
    
    # Validate tabs
    for tab in config['tabs']:
        if not isinstance(tab, dict) or 'id' not in tab or 'name' not in tab:
            logger.error("Invalid tab structure")
            return False
        if 'tiles' not in tab or not isinstance(tab['tiles'], list):
            logger.error("Tab must have tiles array")
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