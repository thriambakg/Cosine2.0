import json
import boto3
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging
from decimal import Decimal
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin

origin = None

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

def simplify_pagination_state(pagination_state):
    """Simplify pagination state only if it has problematic nesting issues
    
    Only simplifies pagination states that would cause DynamoDB nesting errors.
    For normal, working pagination states, preserves the original structure.
    """
    if not pagination_state or not isinstance(pagination_state, dict):
        return pagination_state
    
    last_eval_keys = pagination_state.get('lastEvaluatedKeys', [])
    
    # Check if this pagination state has problematic nesting
    has_nesting_issues = False
    
    if isinstance(last_eval_keys, list):
        for key in last_eval_keys:
            if isinstance(key, dict):
                # Check for deep nesting (like the recursive sponsor_last_key issue)
                depth = check_object_depth(key)
                if depth > 8:  # Only simplify if deeply nested
                    has_nesting_issues = True
                    logger.warning(f"🚨 Found problematic pagination nesting (depth: {depth})")
                    break
                
                # Check for recursive patterns specifically
                if key.get('query_type') == 'union_politician_pagination':
                    if has_recursive_sponsor_keys(key):
                        has_nesting_issues = True
                        logger.warning(f"🚨 Found recursive sponsor_last_key pattern")
                        break
    
    # If no nesting issues, preserve original pagination state
    if not has_nesting_issues:
        logger.info("✅ Pagination state is clean, preserving original structure")
        return pagination_state
    
    # Only if there are nesting issues, simplify to load more count
    total_loaded = pagination_state.get('totalResultsLoaded', 0)
    
    # Auto-detect page size from offset pattern if available
    results_per_page = 25  # Default fallback
    
    if last_eval_keys and isinstance(last_eval_keys, list) and len(last_eval_keys) > 0:
        first_key = last_eval_keys[0]
        if isinstance(first_key, dict) and 'offset' in first_key:
            detected_page_size = first_key['offset']
            if detected_page_size > 0:
                results_per_page = detected_page_size
    
    # Calculate load more count
    if total_loaded <= results_per_page:
        load_more_count = 0
    else:
        load_more_count = (total_loaded - results_per_page) // results_per_page
    
    logger.info(f"🧹 Simplifying problematic pagination: {total_loaded} results → {load_more_count} load mores (page size: {results_per_page})")
    
    # Return simplified state for problematic cases only
    return {
        'loadMoreCount': load_more_count,
        'totalResultsLoaded': total_loaded,
        'hasMore': pagination_state.get('hasMore', False),
        'pageSize': results_per_page,
        '_simplified': True  # Mark as simplified so frontend knows
    }

def check_object_depth(obj, current_depth=0):
    """Check the nesting depth of an object"""
    if not obj or not isinstance(obj, dict) or current_depth > 20:
        return current_depth
    
    max_depth = current_depth
    for value in obj.values():
        if isinstance(value, dict):
            depth = check_object_depth(value, current_depth + 1)
            max_depth = max(max_depth, depth)
    
    return max_depth

def has_recursive_sponsor_keys(obj, max_depth=3):
    """Check if object has recursive sponsor_last_key pattern"""
    current = obj
    depth = 0
    
    while current and isinstance(current, dict) and 'sponsor_last_key' in current:
        current = current['sponsor_last_key']
        depth += 1
        if depth >= max_depth:
            return True
    
    return False

def simplify_dashboard_pagination(dashboard_config):
    """Simplify all pagination states in a dashboard config"""
    if not dashboard_config or not isinstance(dashboard_config, dict):
        return dashboard_config
    
    config = dashboard_config.copy()
    
    # Process all tabs
    for tab in config.get('tabs', []):
        if not isinstance(tab, dict):
            continue
            
        # Process all tiles in the tab
        for tile in tab.get('tiles', []):
            if not isinstance(tile, dict):
                continue
                
            # Simplify pagination state if it exists
            if 'paginationState' in tile:
                original_state = tile['paginationState']
                simplified_state = simplify_pagination_state(original_state)
                
                # Log if we made significant changes
                if original_state != simplified_state:
                    tile_title = tile.get('title', tile.get('customTitle', 'Unknown'))
                    logger.info(f"🧹 Simplified pagination for tile '{tile_title}'")
                    
                tile['paginationState'] = simplified_state
    
    return config

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
    global origin
    headers = event.get('headers', {}) if isinstance(event, dict) else {}
    origin = headers.get('Origin') or headers.get('origin')

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
        if path.startswith('/share') or '/dashboard-share' in path or path.endswith('/share'):
            result = handle_share_dashboard(user_id, http_method, event)
        elif path.startswith('/import') or '/dashboard-import' in path or path.endswith('/import'):
            result = handle_import_dashboard(user_id, http_method, event)
        elif path.startswith('/tiles') or '/dashboard-tiles' in path or '/tiles' in path:
            result = handle_tiles_operations(user_id, http_method, path, event)
        elif path.startswith('/reorder'):
            result = handle_reorder_components(user_id, event)
        else:
            # Check for duplicate tab/group operations
            if http_method == 'POST':
                body = json.loads(event.get('body', '{}'))
                if body.get('operation') == 'duplicate_tab':
                    result = handle_duplicate_tab(user_id, event)
                elif body.get('operation') == 'duplicate_group':
                    result = handle_duplicate_group(user_id, event)
                else:
                    result = handle_dashboard_operations(user_id, http_method, path, event)
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
    Priority order:
    1. Lambda Authorizer context (extracted from API key)
    2. Query parameters (for backward compatibility)
    3. Path parameters (for backward compatibility)
    4. Headers (for backward compatibility)
    """
    # First, check Lambda Authorizer context (most secure)
    request_context = event.get('requestContext', {})
    authorizer = request_context.get('authorizer', {})
    user_id = authorizer.get('userId')
    if user_id:
        print(f"✅ User ID from API key authorizer: {user_id}")
        return user_id
    
    # Check query parameters (backward compatibility)
    query_params = event.get('queryStringParameters', {})
    if query_params:
        user_id = query_params.get('userId')
        if user_id:
            print(f"⚠️ User ID from query params (deprecated): {user_id}")
            return user_id
    
    # Check path parameters
    path_params = event.get('pathParameters', {})
    if path_params:
        user_id = path_params.get('userId')
        if user_id:
            print(f"⚠️ User ID from path params (deprecated): {user_id}")
            return user_id
    
    # Fallback to header (for testing/backward compatibility)
    headers = event.get('headers', {})
    user_id = headers.get('X-User-ID')
    if user_id:
        print(f"⚠️ User ID from header (deprecated): {user_id}")
    
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
        try:
            # Parse body - handle both string and dict
            body_str = event.get('body', '{}')
            if isinstance(body_str, str):
                body = json.loads(body_str) if body_str else {}
            else:
                body = body_str if body_str else {}
            
            logger.info(f"📋 Tiles POST operation: {body.get('operation', 'add_tile')}, body keys: {list(body.keys())}")
            
            # Check if this is an import tiles request
            if body.get('operation') == 'import_tiles':
                return handle_import_tiles(user_id, event)
            elif body.get('operation') == 'duplicate_tile':
                return handle_duplicate_tile(user_id, event)
            else:
                return handle_add_tile(user_id, event)
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON decode error in handle_tiles_operations: {str(e)}, body: {event.get('body')}")
            return create_response(400, {"error": f"Invalid JSON in request body: {str(e)}"})
        except Exception as e:
            logger.error(f"❌ Error parsing request body in handle_tiles_operations: {str(e)}")
            return create_response(400, {"error": f"Error parsing request: {str(e)}"})
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
        
        # Simplify pagination states to prevent DynamoDB nesting issues
        dashboard_config = simplify_dashboard_pagination(dashboard_config)
        
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
        tile_type = tile_config.get('type', 'crypto')
        
        # Get tile size for position calculation
        tile_size = tile_config.get('gridSize', {'width': 4, 'height': 4})
        tile_width = tile_size.get('width', 4) if isinstance(tile_size, dict) else 4
        tile_height = tile_size.get('height', 4) if isinstance(tile_size, dict) else 4
        
        # If no position provided, find next available position
        grid_position = tile_config.get('gridPosition')
        if not grid_position:
            existing_tiles = target_tab.get('tiles', [])
            grid_position = find_next_available_position(existing_tiles, tile_width, tile_height)
        
        # Base tile structure
        new_tile = {
            'id': str(uuid.uuid4()),
            'type': tile_type,
            'title': tile_config.get('title', 'Untitled'),
            'displayOptions': tile_config.get('displayOptions', {}),
            'autoRefresh': tile_config.get('autoRefresh', False),
            'isPinned': tile_config.get('isPinned', False),
            'gridPosition': grid_position,
            'gridSize': tile_size,
            'tab_id': target_tab['id'],
            'created_at': now,
            'updated_at': now
        }
        
        # Add type-specific fields
        if tile_type in ['crypto', 'stock']:
            new_tile['symbol'] = tile_config.get('symbol')
            new_tile['timeframe'] = tile_config.get('timeframe', '1d')
        elif tile_type == 'folder':
            new_tile['folderPath'] = tile_config.get('folderPath', '')
            if tile_config.get('folderId') is not None:
                new_tile['folderId'] = tile_config.get('folderId')
        elif tile_type == 'portfolio':
            new_tile['portfolioData'] = tile_config.get('portfolioData', {'entries': [], 'timeframe': '1y'})
        elif tile_type in ['news', 'politician_trades', 'sec_search', 'govt_contracts', 'congress_bills', 'lda_disclosures']:
            # Search tiles may have searchParams, filterSettings, etc.
            if 'searchParams' in tile_config:
                new_tile['searchParams'] = tile_config.get('searchParams')
            if 'filterSettings' in tile_config:
                new_tile['filterSettings'] = tile_config.get('filterSettings')
            if 'filters' in tile_config:
                new_tile['filters'] = tile_config.get('filters')
        elif tile_type == 'stock_screener':
            if 'criteria' in tile_config:
                new_tile['criteria'] = tile_config.get('criteria')
        
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

def handle_import_tiles(user_id: str, event: Dict) -> Dict:
    """Import tiles from a dashboard export (file or share link)"""
    try:
        from importer import DashboardImporter
        
        body = json.loads(event.get('body', '{}'))
        import_type = body.get('importType')  # 'file' or 'link'
        share_id = body.get('shareId')  # For link imports
        file_content = body.get('fileContent')  # Base64 encoded file content for file imports
        tab_id = body.get('tabId')  # Target tab to import tiles into
        tile_ids = body.get('tileIds', [])  # Optional: specific tile IDs to import (empty = all tiles)
        
        if not import_type:
            return create_response(400, {'error': 'importType is required (file or link)'})
        
        importer = DashboardImporter()
        
        # Get dashboard data from file or link
        if import_type == 'link':
            if not share_id:
                return create_response(400, {'error': 'shareId is required for link imports'})
            result = importer.import_from_share_link(share_id, user_id)
            if not result.get('success'):
                return create_response(400, {
                    'success': False,
                    'error': result.get('error', 'Failed to import dashboard from link')
                })
            dashboard_data = result.get('dashboard_data')
        elif import_type == 'file':
            if not file_content:
                return create_response(400, {'error': 'fileContent is required for file imports'})
            try:
                import base64
                file_bytes = base64.b64decode(file_content)
            except Exception as e:
                return create_response(400, {'error': f'Invalid file content encoding: {str(e)}'})
            result = importer.import_from_file(file_bytes, user_id)
            if not result.get('success'):
                return create_response(400, {
                    'success': False,
                    'error': result.get('error', 'Failed to import dashboard from file')
                })
            dashboard_data = result.get('dashboard_data')
        else:
            return create_response(400, {'error': 'importType must be "file" or "link"'})
        
        # Extract tiles from imported dashboard
        tab_data = dashboard_data.get('tab', {})
        source_tiles = tab_data.get('tiles', [])
        
        # Filter to specific tiles if tileIds provided
        if tile_ids:
            source_tiles = [tile for tile in source_tiles if tile.get('id') in tile_ids]
        
        if not source_tiles:
            return create_response(400, {'error': 'No tiles found to import'})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find target tab
        target_tab = None
        if tab_id:
            target_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == tab_id), None)
        else:
            active_tab_id = dashboard_config.get('activeTabId')
            if active_tab_id:
                target_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == active_tab_id), None)
            else:
                tabs = dashboard_config.get('tabs', [])
                target_tab = tabs[0] if tabs else None
        
        if not target_tab:
            return create_response(400, {"error": "No tab found to import tiles into"})
        
        # Import tiles (generate new IDs, clean runtime data)
        now = datetime.utcnow().isoformat()
        imported_tiles = []
        
        for source_tile in source_tiles:
            # Create new tile with new ID
            new_tile = source_tile.copy()
            new_tile['id'] = str(uuid.uuid4())
            new_tile['tab_id'] = target_tab['id']
            new_tile['created_at'] = now
            new_tile['updated_at'] = now
            
            # Remove runtime-specific data (results, etc.)
            # Keep all configuration (searchParams, filterSettings, portfolioData, etc.)
            if 'articles' in new_tile:
                del new_tile['articles']
            if 'trades' in new_tile:
                del new_tile['trades']
            
            # For portfolio tiles, preserve portfolioData but remove results
            if 'portfolioData' in new_tile and isinstance(new_tile['portfolioData'], dict):
                portfolio_data = new_tile['portfolioData'].copy()
                if 'results' in portfolio_data:
                    del portfolio_data['results']
                new_tile['portfolioData'] = portfolio_data
            
            imported_tiles.append(new_tile)
        
        # Add tiles to target tab
        if 'tiles' not in target_tab:
            target_tab['tiles'] = []
        
        target_tab['tiles'].extend(imported_tiles)
        target_tab['updated_at'] = now
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        logger.info(f"✅ Successfully imported {len(imported_tiles)} tile(s) to tab {target_tab['id']}")
        
        return create_response(200, {
            'success': True,
            'tiles': imported_tiles,
            'count': len(imported_tiles),
            'message': f'Successfully imported {len(imported_tiles)} tile(s)'
        })
        
    except Exception as e:
        logger.error(f"❌ Error importing tiles: {str(e)}", exc_info=True)
        return create_response(500, {
            'success': False,
            'error': f'Failed to import tiles: {str(e)}'
        })

def handle_duplicate_tile(user_id: str, event: Dict) -> Dict:
    """Duplicate a tile (table operation only - no S3 replication)"""
    try:
        # Parse body - handle both string and dict
        body_str = event.get('body', '{}')
        if isinstance(body_str, str):
            body = json.loads(body_str)
        else:
            body = body_str if body_str else {}
        
        tile_id = body.get('tileId')
        tab_id = body.get('tabId')  # Optional: target tab (defaults to same tab)
        
        logger.info(f"🔄 Duplicating tile: tileId={tile_id}, tabId={tab_id}, user_id={user_id}")
        
        if not tile_id:
            logger.error(f"❌ Missing tileId in request body: {body}")
            return create_response(400, {"error": "tileId is required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the source tile
        source_tile = None
        source_tab = None
        for tab in dashboard_config.get('tabs', []):
            for tile in tab.get('tiles', []):
                if tile['id'] == tile_id:
                    source_tile = tile
                    source_tab = tab
                    break
            if source_tile:
                break
        
        if not source_tile:
            return create_response(404, {"error": "Tile not found"})
        
        # Find target tab (use provided tab_id or same tab as source)
        target_tab = None
        if tab_id:
            target_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == tab_id), None)
        else:
            target_tab = source_tab
        
        if not target_tab:
            return create_response(400, {"error": "Target tab not found"})
        
        # Create duplicate tile with new ID
        now = datetime.utcnow().isoformat()
        duplicated_tile = source_tile.copy()
        duplicated_tile['id'] = str(uuid.uuid4())
        duplicated_tile['tab_id'] = target_tab['id']
        duplicated_tile['created_at'] = now
        duplicated_tile['updated_at'] = now
        
        # Update title to indicate it's a copy
        original_title = duplicated_tile.get('title', 'Untitled')
        duplicated_tile['title'] = f"{original_title} (Copy)"
        
        # Remove runtime-specific data (results, etc.)
        if 'articles' in duplicated_tile:
            del duplicated_tile['articles']
        if 'trades' in duplicated_tile:
            del duplicated_tile['trades']
        
        # For portfolio tiles, preserve portfolioData but remove results
        if 'portfolioData' in duplicated_tile and isinstance(duplicated_tile['portfolioData'], dict):
            portfolio_data = duplicated_tile['portfolioData'].copy()
            if 'results' in portfolio_data:
                del portfolio_data['results']
            duplicated_tile['portfolioData'] = portfolio_data
        
        # Use provided position or calculate next available position
        provided_position = body.get('gridPosition')
        if provided_position and isinstance(provided_position, dict):
            # Frontend calculated the position (consistent with new tiles)
            duplicated_tile['gridPosition'] = provided_position
        else:
            # Backend fallback: calculate position if frontend didn't provide it
            tile_size = duplicated_tile.get('gridSize', duplicated_tile.get('size', {}))
            if isinstance(tile_size, dict):
                tile_width = tile_size.get('width', 4)
                tile_height = tile_size.get('height', 4)
            else:
                # Legacy size format or missing
                tile_width = 4
                tile_height = 4
            
            # Get all tiles in the target tab (excluding the source tile we're duplicating)
            existing_tiles = [t for t in target_tab.get('tiles', []) if t.get('id') != tile_id]
            
            # Find next available position
            new_position = find_next_available_position(existing_tiles, tile_width, tile_height)
            duplicated_tile['gridPosition'] = new_position
        
        # Ensure gridSize is set
        if 'gridSize' not in duplicated_tile:
            tile_size = duplicated_tile.get('size', {})
            if isinstance(tile_size, dict):
                duplicated_tile['gridSize'] = {'width': tile_size.get('width', 4), 'height': tile_size.get('height', 4)}
            else:
                duplicated_tile['gridSize'] = {'width': 4, 'height': 4}
        
        # Add tile to target tab
        if 'tiles' not in target_tab:
            target_tab['tiles'] = []
        
        target_tab['tiles'].append(duplicated_tile)
        target_tab['updated_at'] = now
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        logger.info(f"✅ Successfully duplicated tile {tile_id} to tile {duplicated_tile['id']}")
        
        return create_response(200, {
            'success': True,
            'tile': duplicated_tile,
            'message': 'Tile duplicated successfully'
        })
        
    except json.JSONDecodeError as e:
        logger.error(f"❌ JSON decode error in handle_duplicate_tile: {str(e)}, body: {event.get('body')}")
        return create_response(400, {"error": f"Invalid JSON in request body: {str(e)}"})
    except Exception as e:
        logger.error(f"❌ Error duplicating tile: {str(e)}", exc_info=True)
        return create_response(500, {"error": f"Failed to duplicate tile: {str(e)}"})

def handle_duplicate_tab(user_id: str, event: Dict) -> Dict:
    """Duplicate a tab with all its tiles (table operation only - no S3 replication)"""
    try:
        body = json.loads(event.get('body', '{}'))
        tab_id = body.get('tabId')
        
        if not tab_id:
            return create_response(400, {"error": "tabId is required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the source tab
        source_tab = next((t for t in dashboard_config.get('tabs', []) if t['id'] == tab_id), None)
        if not source_tab:
            return create_response(404, {"error": "Tab not found"})
        
        # Create duplicate tab with new ID
        now = datetime.utcnow().isoformat()
        duplicated_tab = source_tab.copy()
        duplicated_tab['id'] = str(uuid.uuid4())
        duplicated_tab['name'] = f"{source_tab.get('name', 'Untitled')} (Copy)"
        duplicated_tab['created_at'] = now
        duplicated_tab['updated_at'] = now
        
        # Duplicate all tiles with new IDs
        duplicated_tiles = []
        for tile in source_tab.get('tiles', []):
            new_tile = tile.copy()
            new_tile['id'] = str(uuid.uuid4())
            new_tile['tab_id'] = duplicated_tab['id']
            new_tile['created_at'] = now
            new_tile['updated_at'] = now
            
            # Remove runtime-specific data
            if 'articles' in new_tile:
                del new_tile['articles']
            if 'trades' in new_tile:
                del new_tile['trades']
            
            # For portfolio tiles, preserve portfolioData but remove results
            if 'portfolioData' in new_tile and isinstance(new_tile['portfolioData'], dict):
                portfolio_data = new_tile['portfolioData'].copy()
                if 'results' in portfolio_data:
                    del portfolio_data['results']
                new_tile['portfolioData'] = portfolio_data
            
            duplicated_tiles.append(new_tile)
        
        duplicated_tab['tiles'] = duplicated_tiles
        
        # Add tab to dashboard
        if 'tabs' not in dashboard_config:
            dashboard_config['tabs'] = []
        
        dashboard_config['tabs'].append(duplicated_tab)
        
        # Add to tabOrder
        if 'tabOrder' not in dashboard_config:
            dashboard_config['tabOrder'] = []
        dashboard_config['tabOrder'].append(duplicated_tab['id'])
        
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        logger.info(f"✅ Successfully duplicated tab {tab_id} to tab {duplicated_tab['id']} with {len(duplicated_tiles)} tiles")
        
        return create_response(200, {
            'success': True,
            'tab': duplicated_tab,
            'message': f'Tab duplicated successfully with {len(duplicated_tiles)} tiles'
        })
        
    except Exception as e:
        logger.error(f"Error duplicating tab: {str(e)}")
        return create_response(500, {"error": "Failed to duplicate tab"})

def handle_duplicate_group(user_id: str, event: Dict) -> Dict:
    """Duplicate a group with all its tabs and nested tiles (recursive deep copy, table operation only)"""
    try:
        body = json.loads(event.get('body', '{}'))
        group_id = body.get('groupId')
        
        if not group_id:
            return create_response(400, {"error": "groupId is required"})
        
        # Get current dashboard
        dashboard_config = get_user_dashboard(user_id)
        if not dashboard_config:
            return create_response(404, {"error": "User not found"})
        
        # Find the source group
        source_group = next((g for g in dashboard_config.get('tabGroups', []) if g['id'] == group_id), None)
        if not source_group:
            return create_response(404, {"error": "Group not found"})
        
        # Get all tabs in the group
        group_tab_ids = source_group.get('tabs', []) or source_group.get('tabIds', [])
        source_tabs = [t for t in dashboard_config.get('tabs', []) if t['id'] in group_tab_ids]
        
        # Create duplicate group with new ID
        now = datetime.utcnow().isoformat()
        duplicated_group = source_group.copy()
        duplicated_group['id'] = str(uuid.uuid4())
        duplicated_group['name'] = f"{source_group.get('name', 'Untitled')} (Copy)"
        duplicated_group['created_at'] = now
        duplicated_group['updated_at'] = now
        duplicated_group['tabs'] = []
        duplicated_group['tabIds'] = []
        
        # Recursively duplicate all tabs and their tiles
        duplicated_tab_ids = []
        duplicated_tabs = []
        total_tiles_duplicated = 0
        
        for source_tab in source_tabs:
            # Create duplicate tab with new ID
            duplicated_tab = source_tab.copy()
            duplicated_tab['id'] = str(uuid.uuid4())
            duplicated_tab['name'] = f"{source_tab.get('name', 'Untitled')} (Copy)"
            duplicated_tab['created_at'] = now
            duplicated_tab['updated_at'] = now
            
            # Duplicate all tiles with new IDs
            duplicated_tiles = []
            for tile in source_tab.get('tiles', []):
                new_tile = tile.copy()
                new_tile['id'] = str(uuid.uuid4())
                new_tile['tab_id'] = duplicated_tab['id']
                new_tile['created_at'] = now
                new_tile['updated_at'] = now
                
                # Remove runtime-specific data
                if 'articles' in new_tile:
                    del new_tile['articles']
                if 'trades' in new_tile:
                    del new_tile['trades']
                
                # For portfolio tiles, preserve portfolioData but remove results
                if 'portfolioData' in new_tile and isinstance(new_tile['portfolioData'], dict):
                    portfolio_data = new_tile['portfolioData'].copy()
                    if 'results' in portfolio_data:
                        del portfolio_data['results']
                    new_tile['portfolioData'] = portfolio_data
                
                duplicated_tiles.append(new_tile)
                total_tiles_duplicated += 1
            
            duplicated_tab['tiles'] = duplicated_tiles
            duplicated_tabs.append(duplicated_tab)
            duplicated_tab_ids.append(duplicated_tab['id'])
        
        duplicated_group['tabs'] = duplicated_tab_ids
        duplicated_group['tabIds'] = duplicated_tab_ids
        
        # Add duplicated tabs to dashboard
        if 'tabs' not in dashboard_config:
            dashboard_config['tabs'] = []
        
        dashboard_config['tabs'].extend(duplicated_tabs)
        
        # Add group to dashboard
        if 'tabGroups' not in dashboard_config:
            dashboard_config['tabGroups'] = []
        
        dashboard_config['tabGroups'].append(duplicated_group)
        
        # Add to groupOrder
        if 'groupOrder' not in dashboard_config:
            dashboard_config['groupOrder'] = []
        dashboard_config['groupOrder'].append(duplicated_group['id'])
        
        # Add duplicated tab IDs to tabOrder
        if 'tabOrder' not in dashboard_config:
            dashboard_config['tabOrder'] = []
        dashboard_config['tabOrder'].extend(duplicated_tab_ids)
        
        dashboard_config['last_updated'] = now
        
        # Save updated dashboard
        save_user_dashboard(user_id, dashboard_config)
        
        logger.info(f"✅ Successfully duplicated group {group_id} to group {duplicated_group['id']} with {len(duplicated_tabs)} tabs and {total_tiles_duplicated} tiles")
        
        return create_response(200, {
            'success': True,
            'group': duplicated_group,
            'tabs': duplicated_tabs,
            'tileCount': total_tiles_duplicated,
            'message': f'Group duplicated successfully with {len(duplicated_tabs)} tabs and {total_tiles_duplicated} tiles'
        })
        
    except Exception as e:
        logger.error(f"Error duplicating group: {str(e)}")
        return create_response(500, {"error": "Failed to duplicate group"})


# Helper functions

def cleanup_old_data_structure(config: Dict) -> Dict:
    """Clean up old data structure by removing dashboards field and ensuring tabs have tiles
    
    Note: This function only removes the old 'dashboards' field and ensures structure.
    All tile properties (including paginationState, searchParams, filterSettings, etc.) 
    are preserved and not filtered out.
    IMPORTANT: This function preserves ALL existing tabs - it does NOT remove or modify them.
    """
    cleaned_config = config.copy()
    
    # Log tabs count before cleanup
    original_tabs_count = len(cleaned_config.get('tabs', []))
    if original_tabs_count > 0:
        logger.info(f"🧹 cleanup_old_data_structure: Found {original_tabs_count} existing tabs to preserve")
    
    # Remove old dashboards field if it exists
    if 'dashboards' in cleaned_config:
        logger.info("Removing old dashboards field from data structure")
        del cleaned_config['dashboards']
    
    # Ensure tabs key exists (preserve existing tabs if they exist)
    if 'tabs' not in cleaned_config:
        logger.warning("Missing 'tabs' key in dashboard config, initializing with empty array")
        cleaned_config['tabs'] = []
    else:
        # Verify we're preserving all tabs
        preserved_tabs_count = len(cleaned_config['tabs'])
        if preserved_tabs_count != original_tabs_count:
            logger.error(f"❌ CRITICAL: Tab count mismatch! Original: {original_tabs_count}, Preserved: {preserved_tabs_count}")
    
    # Ensure all tabs have tiles array
    # Note: All tile properties are preserved - we only ensure the array exists
    for tab in cleaned_config.get('tabs', []):
        if 'tiles' not in tab:
            tab['tiles'] = []
        if 'layout' not in tab:
            tab['layout'] = 'grid'
    
    # Ensure required fields exist (preserve existing values, don't overwrite)
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
        
        # Log raw config tabs count before conversion
        raw_tabs_count = len(raw_dashboard_config.get('tabs', []))
        if raw_tabs_count > 0:
            raw_tab_ids = [tab.get('id') for tab in raw_dashboard_config.get('tabs', []) if tab.get('id')]
            logger.info(f"📥 Retrieved from DB: {raw_tabs_count} tabs with IDs: {raw_tab_ids}")
        
        # Convert Decimals to regular numbers for easier manipulation
        raw_dashboard_config = convert_decimals(raw_dashboard_config)
        
        # Verify tabs are still present after conversion
        after_convert_tabs_count = len(raw_dashboard_config.get('tabs', []))
        if after_convert_tabs_count != raw_tabs_count:
            logger.error(f"❌ CRITICAL: Tab count changed during Decimal conversion! Before: {raw_tabs_count}, After: {after_convert_tabs_count}")
        
        # Clean up any old data structure
        dashboard_config = cleanup_old_data_structure(raw_dashboard_config)
        
        # Verify tabs are still present after cleanup
        final_tabs_count = len(dashboard_config.get('tabs', []))
        if final_tabs_count != raw_tabs_count:
            logger.error(f"❌ CRITICAL: Tab count changed during cleanup! Original: {raw_tabs_count}, Final: {final_tabs_count}")
        else:
            logger.info(f"✅ All {final_tabs_count} tabs preserved through get_user_dashboard")
        
        return dashboard_config
        
    except Exception as e:
        logger.error(f"Error getting user dashboard: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

def save_user_dashboard(user_id: str, dashboard_config: Dict) -> bool:
    """Save user's dashboard configuration to database"""
    try:
        # Log what we're about to save
        tabs_to_save = dashboard_config.get('tabs', [])
        tab_ids_to_save = [tab.get('id') for tab in tabs_to_save if tab.get('id')]
        logger.info(f"💾 Saving dashboard with {len(tabs_to_save)} tabs, IDs: {tab_ids_to_save}")
        
        # Simplify pagination states before saving to prevent DynamoDB nesting issues
        simplified_config = simplify_dashboard_pagination(dashboard_config)
        
        # Convert floats to Decimals for DynamoDB
        config_to_save = convert_floats_to_decimals(simplified_config)
        
        # Verify tabs are still present after conversion
        tabs_after_convert = config_to_save.get('tabs', [])
        if len(tabs_after_convert) != len(tabs_to_save):
            logger.error(f"❌ CRITICAL: Tab count changed during Decimal conversion before save! Before: {len(tabs_to_save)}, After: {len(tabs_after_convert)}")
        
        table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET dashboard_config = :config, updated_at = :updated',
            ExpressionAttributeValues={
                ':config': config_to_save,
                ':updated': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"✅ Successfully saved dashboard with {len(tabs_to_save)} tabs to database")
        return True
        
    except Exception as e:
        logger.error(f"Error saving user dashboard: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
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
    tile_type = tile.get('type', '')
    
    # Validate tile type exists
    if not tile_type:
        logger.warning(f"Tile validation failed: missing type")
        return False
    
    # Different tile types have different required fields
    if tile_type in ['crypto', 'stock']:
        # Crypto and stock tiles require symbol and timeframe
        if 'symbol' not in tile:
            logger.warning(f"Tile validation failed: crypto/stock tile missing symbol")
            return False
        if 'timeframe' not in tile:
            logger.warning(f"Tile validation failed: crypto/stock tile missing timeframe")
            return False
        
        # Validate symbol (allow any string for flexibility)
        if not isinstance(tile['symbol'], str) or not tile['symbol'].strip():
            logger.warning(f"Tile validation failed: invalid symbol")
            return False
        
        # Validate timeframe
        valid_timeframes = ['1d', '7d', '30d', '1y', '1h', '4h']
        if tile['timeframe'] not in valid_timeframes:
            logger.warning(f"Tile validation failed: invalid timeframe {tile.get('timeframe')}")
            return False
    
    # Other tile types (folder, news, portfolio, etc.) don't require symbol/timeframe
    # Title is optional (has default in backend), so we don't validate it here
    
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

def find_next_available_position(existing_tiles: List[Dict], tile_width: int, tile_height: int) -> Dict[str, int]:
    """
    Find the nearest available position for a tile using spiral search algorithm
    Matches the frontend findNextAvailablePosition logic
    """
    GRID_COLUMNS = 16  # Match frontend default
    MAX_ROWS = 50  # Match frontend constant
    
    # If no existing tiles, place at origin
    if not existing_tiles:
        return {'x': 0, 'y': 0}
    
    # Create a 2D grid to track occupied positions
    grid = [[False for _ in range(GRID_COLUMNS)] for _ in range(MAX_ROWS)]
    
    # Mark occupied positions
    for tile in existing_tiles:
        pos = tile.get('gridPosition', tile.get('position', {}))
        size = tile.get('gridSize', tile.get('size', {}))
        
        # Get position coordinates
        if isinstance(pos, dict):
            tile_x = pos.get('x', 0)
            tile_y = pos.get('y', 0)
        else:
            tile_x = 0
            tile_y = 0
        
        # Get size dimensions
        if isinstance(size, dict):
            tile_w = size.get('width', 4)
            tile_h = size.get('height', 4)
        else:
            tile_w = 4
            tile_h = 4
        
        # Mark all cells occupied by this tile
        for x in range(tile_x, min(tile_x + tile_w, GRID_COLUMNS)):
            for y in range(tile_y, min(tile_y + tile_h, MAX_ROWS)):
                if 0 <= y < MAX_ROWS and 0 <= x < GRID_COLUMNS:
                    grid[y][x] = True
    
    # Check if a position is available for the given tile size
    def is_position_available(x: int, y: int, width: int, height: int) -> bool:
        if x < 0 or y < 0 or x + width > GRID_COLUMNS or y + height > MAX_ROWS:
            return False
        for dx in range(width):
            for dy in range(height):
                if grid[y + dy][x + dx]:
                    return False
        return True
    
    # Spiral search from origin - finds the nearest available space
    directions = [
        {'dx': 1, 'dy': 0},   # Right
        {'dx': 0, 'dy': 1},   # Down
        {'dx': -1, 'dy': 0},  # Left
        {'dx': 0, 'dy': -1}   # Up
    ]
    
    x, y = 0, 0
    step = 1
    direction_index = 0
    steps_in_direction = 0
    
    while x < GRID_COLUMNS and y < MAX_ROWS:
        # Check current position
        if is_position_available(x, y, tile_width, tile_height):
            logger.info(f"📍 Found nearest available position: x={x}, y={y}, size={tile_width}x{tile_height}")
            return {'x': x, 'y': y}
        
        # Move in current direction
        direction = directions[direction_index]
        x += direction['dx']
        y += direction['dy']
        steps_in_direction += 1
        
        # Change direction when we've taken enough steps
        if steps_in_direction == step:
            steps_in_direction = 0
            direction_index = (direction_index + 1) % 4
            
            # Increase step size every 2 direction changes (completes a square)
            if direction_index == 0 or direction_index == 2:
                step += 1
    
    # Fallback: Linear search if spiral fails
    for y in range(MAX_ROWS):
        for x in range(GRID_COLUMNS - tile_width + 1):
            if is_position_available(x, y, tile_width, tile_height):
                logger.info(f"📍 Fallback position found: x={x}, y={y}")
                return {'x': x, 'y': y}
    
    # Ultimate fallback: place at origin
    logger.warning("📍 No space found, placing at origin")
    return {'x': 0, 'y': 0}

def create_response(status_code: int, body: Dict) -> Dict:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            **get_cors_headers(origin),
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-User-ID',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body, default=str)
    }

def handle_share_dashboard(user_id: str, http_method: str, event: Dict) -> Dict:
    """Handle dashboard sharing operations"""
    if http_method != 'POST':
        return create_response(405, {'error': 'Method not allowed'})
    
    try:
        # Import exporter
        from exporter import DashboardExporter
        
        body = json.loads(event.get('body', '{}'))
        tab_id = body.get('tabId')
        share_type = body.get('shareType', 'download')  # 'link' or 'download'
        
        if not tab_id:
            return create_response(400, {'error': 'tabId is required'})
        
        # Get dashboard configuration
        response = table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return create_response(404, {'error': 'Dashboard not found'})
        
        dashboard_config = convert_decimals(response['Item'].get('dashboard_config', {}))
        tabs = dashboard_config.get('tabs', [])
        
        # Find the specific tab
        tab = next((t for t in tabs if t.get('id') == tab_id), None)
        if not tab:
            return create_response(404, {'error': 'Tab not found'})
        
        # Log portfolio tiles in the tab for debugging
        for tile in tab.get('tiles', []):
            if tile.get('type') == 'portfolio':
                portfolio_data = tile.get('portfolioData', {})
                entries = portfolio_data.get('entries', [])
                entries_count = len(entries) if isinstance(entries, list) else 0
                logger.info(f"📊 Tab {tab_id} portfolio tile {tile.get('id', 'unknown')}: entries={entries_count}, timeframe={portfolio_data.get('timeframe')}")
                if entries_count == 0:
                    logger.warning(f"⚠️ Portfolio tile {tile.get('id', 'unknown')} has empty entries before export!")
        
        # Initialize exporter
        exporter = DashboardExporter()
        
        if share_type == 'link':
            # Export for share link
            result = exporter.export_for_share_link(tab, user_id)
            if result.get('success'):
                return create_response(200, {
                    'success': True,
                    'shareId': result.get('share_id'),
                    'shareLink': f'/dashboard/shared/{result.get("share_id")}',
                })
            else:
                return create_response(500, {
                    'success': False,
                    'error': result.get('error', 'Failed to generate share link')
                })
        
        elif share_type == 'download':
            # Export for download
            tab_name = tab.get('name', 'dashboard')
            result = exporter.export_for_download(tab, user_id, tab_name)
            if result.get('success'):
                return create_response(200, {
                    'success': True,
                    'downloadUrl': result.get('download_url'),
                    'shareId': result.get('share_id'),
                    'expiresIn': result.get('expires_in'),
                })
            else:
                return create_response(500, {
                    'success': False,
                    'error': result.get('error', 'Failed to export dashboard')
                })
        
        else:
            return create_response(400, {'error': 'Invalid shareType. Must be "link" or "download"'})
            
    except Exception as e:
        logger.error(f"Error sharing dashboard: {str(e)}", exc_info=True)
        return create_response(500, {'error': f'Failed to share dashboard: {str(e)}'})


def handle_import_dashboard(user_id: str, http_method: str, event: Dict) -> Dict:
    """Handle dashboard import operations"""
    if http_method != 'POST':
        return create_response(405, {'error': 'Method not allowed'})
    
    try:
        # Import importer
        from importer import DashboardImporter
        from datetime import datetime
        import uuid
        
        body = json.loads(event.get('body', '{}'))
        import_type = body.get('importType')  # 'file' or 'link'
        share_id = body.get('shareId')  # For link imports
        file_content = body.get('fileContent')  # Base64 encoded file content for file imports
        
        if not import_type:
            return create_response(400, {'error': 'importType is required (file or link)'})
        
        importer = DashboardImporter()
        
        if import_type == 'link':
            if not share_id:
                return create_response(400, {'error': 'shareId is required for link imports'})
            
            # Import from share link
            result = importer.import_from_share_link(share_id, user_id)
            
            if not result.get('success'):
                return create_response(400, {
                    'success': False,
                    'error': result.get('error', 'Failed to import dashboard from link')
                })
            
            dashboard_data = result.get('dashboard_data')
            
        elif import_type == 'file':
            if not file_content:
                return create_response(400, {'error': 'fileContent is required for file imports'})
            
            # Decode base64 file content
            try:
                import base64
                file_bytes = base64.b64decode(file_content)
            except Exception as e:
                return create_response(400, {'error': f'Invalid file content encoding: {str(e)}'})
            
            # Import from file
            result = importer.import_from_file(file_bytes, user_id)
            
            if not result.get('success'):
                return create_response(400, {
                    'success': False,
                    'error': result.get('error', 'Failed to import dashboard from file')
                })
            
            dashboard_data = result.get('dashboard_data')
        else:
            return create_response(400, {'error': 'importType must be "file" or "link"'})
        
        # Prepare imported tab
        imported_tab = importer.prepare_imported_tab(dashboard_data, user_id)
        logger.info(f"📦 Prepared imported tab: {imported_tab.get('name')} (id: {imported_tab.get('id')})")
        
        # Get current dashboard - get it directly from DynamoDB to ensure we have the latest
        try:
            response = table.get_item(Key={'user_id': user_id})
            if 'Item' not in response:
                return create_response(404, {'error': 'User not found'})
            
            user_data = response['Item']
            raw_dashboard_config = user_data.get('dashboard_config', {})
            
            # Convert Decimals to regular numbers
            dashboard_config = convert_decimals(raw_dashboard_config)
            
            # Clean up any old data structure (preserves all tabs)
            dashboard_config = cleanup_old_data_structure(dashboard_config)
            
        except Exception as e:
            logger.error(f"❌ Error getting dashboard for import: {str(e)}")
            return create_response(500, {'error': f'Failed to retrieve dashboard: {str(e)}'})
        
        # Log existing tabs before import
        existing_tabs = dashboard_config.get('tabs', [])
        existing_tab_ids = [tab.get('id') for tab in existing_tabs if tab.get('id')]
        logger.info(f"📋 Existing tabs before import: {len(existing_tabs)} tabs with IDs: {existing_tab_ids}")
        
        # CRITICAL: Verify we have tabs - if we don't, something is wrong
        if not isinstance(existing_tabs, list):
            logger.error(f"❌ CRITICAL: tabs is not a list! Type: {type(existing_tabs)}, Value: {existing_tabs}")
            dashboard_config['tabs'] = []
            existing_tabs = []
        
        # Ensure tabs array exists (don't overwrite if it already exists)
        if 'tabs' not in dashboard_config:
            dashboard_config['tabs'] = []
            logger.warning("⚠️ tabs array was missing, initialized empty array")
        else:
            logger.info(f"✅ tabs array exists with {len(dashboard_config['tabs'])} items")
        
        # Ensure tabOrder exists (don't overwrite if it already exists)
        if 'tabOrder' not in dashboard_config:
            dashboard_config['tabOrder'] = []
            logger.warning("⚠️ tabOrder was missing, initialized empty array")
        else:
            logger.info(f"✅ tabOrder exists with {len(dashboard_config['tabOrder'])} items: {dashboard_config['tabOrder']}")
        
        # Ensure other required fields exist (preserve existing values)
        if 'tabGroups' not in dashboard_config:
            dashboard_config['tabGroups'] = []
        if 'groupOrder' not in dashboard_config:
            dashboard_config['groupOrder'] = []
        if 'nextTabId' not in dashboard_config:
            dashboard_config['nextTabId'] = 1
        if 'nextGroupId' not in dashboard_config:
            dashboard_config['nextGroupId'] = 1
        
        # IMPORTANT: Append imported tab to existing tabs (don't replace)
        # Make a copy of the tabs list to ensure we're appending correctly
        tabs_before_append = list(dashboard_config['tabs'])
        logger.info(f"➕ Appending imported tab '{imported_tab.get('name')}' to existing {len(tabs_before_append)} tabs")
        dashboard_config['tabs'].append(imported_tab)
        
        # Verify append worked
        if len(dashboard_config['tabs']) != len(tabs_before_append) + 1:
            logger.error(f"❌ CRITICAL: Append failed! Before: {len(tabs_before_append)}, After: {len(dashboard_config['tabs'])}")
            return create_response(500, {'error': 'Failed to append imported tab'})
        
        # Add new tab to the end of tabOrder
        logger.info(f"➕ Appending imported tab ID to tabOrder: {imported_tab['id']}")
        dashboard_config['tabOrder'].append(imported_tab['id'])
        
        dashboard_config['last_updated'] = datetime.utcnow().isoformat()
        
        # Log final state
        final_tabs = dashboard_config.get('tabs', [])
        final_tab_ids = [tab.get('id') for tab in final_tabs if tab.get('id')]
        logger.info(f"📊 Dashboard config after import - tabs count: {len(final_tabs)}, tab IDs: {final_tab_ids}")
        logger.info(f"📊 tabOrder after import: {dashboard_config.get('tabOrder', [])}")
        
        # Save to database
        if not save_user_dashboard(user_id, dashboard_config):
            return create_response(500, {'error': 'Failed to save imported dashboard'})
        
        logger.info(f"✅ Successfully imported dashboard for user {user_id}: {imported_tab['name']}")
        
        return create_response(200, {
            'success': True,
            'tab': imported_tab,
            'message': 'Dashboard imported successfully'
        })
        
    except Exception as e:
        logger.error(f"❌ Error importing dashboard: {str(e)}", exc_info=True)
        return create_response(500, {
            'success': False,
            'error': f'Failed to import dashboard: {str(e)}'
        })