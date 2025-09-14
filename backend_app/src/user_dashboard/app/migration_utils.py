"""
Dashboard Migration Utilities for Backend
Ensures backward compatibility and safe migrations for production deployments
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

# Current dashboard schema version
CURRENT_DASHBOARD_VERSION = "2.0.0"

def migrate_dashboard_data(dashboard_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Migrate dashboard data to current version with backward compatibility
    """
    try:
        current_version = dashboard_config.get('_version', {}).get('version', '1.0.0')
        
        if current_version == CURRENT_DASHBOARD_VERSION:
            logger.info("Dashboard already at current version")
            return dashboard_config
        
        logger.info(f"Migrating dashboard from {current_version} to {CURRENT_DASHBOARD_VERSION}")
        
        # Apply migrations based on current version
        migrated_config = dashboard_config.copy()
        
        if current_version == "1.0.0":
            migrated_config = migrate_from_v1_0_0(migrated_config)
        
        if migrated_config.get('_version', {}).get('version') == "1.1.0":
            migrated_config = migrate_from_v1_1_0(migrated_config)
        
        # Ensure version is updated
        migrated_config['_version'] = {
            'version': CURRENT_DASHBOARD_VERSION,
            'lastUpdated': datetime.utcnow().isoformat(),
            'migrationHistory': dashboard_config.get('_version', {}).get('migrationHistory', [current_version]) + [CURRENT_DASHBOARD_VERSION]
        }
        
        logger.info("Dashboard migration completed successfully")
        return migrated_config
        
    except Exception as e:
        logger.error(f"Error during dashboard migration: {str(e)}")
        # Return original config with version info
        return {
            **dashboard_config,
            '_version': {
                'version': CURRENT_DASHBOARD_VERSION,
                'lastUpdated': datetime.utcnow().isoformat(),
                'migrationHistory': ['error'],
                'migrationError': str(e)
            }
        }

def migrate_from_v1_0_0(config: Dict[str, Any]) -> Dict[str, Any]:
    """Migrate from version 1.0.0 to 1.1.0"""
    logger.info("Applying migration from v1.0.0 to v1.1.0")
    
    migrated_config = config.copy()
    
    # Ensure dashboards array exists
    if 'dashboards' not in migrated_config:
        migrated_config['dashboards'] = []
    
    # Migrate each dashboard
    for dashboard in migrated_config['dashboards']:
        if 'tiles' not in dashboard:
            dashboard['tiles'] = []
        
        # Migrate each tile
        for tile in dashboard['tiles']:
            # Add missing properties with safe defaults
            if 'gridPosition' not in tile:
                tile['gridPosition'] = {'x': 0, 'y': 0}
            
            if 'gridSize' not in tile:
                tile['gridSize'] = get_default_tile_size(tile.get('type', 'custom'))
            
            if 'dashboard_id' not in tile:
                tile['dashboard_id'] = dashboard.get('id', 'main')
            
            if 'displayOptions' not in tile:
                tile['displayOptions'] = {}
            
            if 'autoRefresh' not in tile:
                tile['autoRefresh'] = False
            
            if 'isPinned' not in tile:
                tile['isPinned'] = False
            
            if 'created_at' not in tile:
                tile['created_at'] = datetime.utcnow().isoformat()
    
    migrated_config['_version'] = {
        'version': '1.1.0',
        'lastUpdated': datetime.utcnow().isoformat(),
        'migrationHistory': ['1.0.0']
    }
    
    return migrated_config

def migrate_from_v1_1_0(config: Dict[str, Any]) -> Dict[str, Any]:
    """Migrate from version 1.1.0 to 2.0.0"""
    logger.info("Applying migration from v1.1.0 to v2.0.0")
    
    migrated_config = config.copy()
    
    # Validate and fix tile configurations
    for dashboard in migrated_config.get('dashboards', []):
        for tile in dashboard.get('tiles', []):
            # Validate grid size constraints
            tile_type = tile.get('type', 'custom')
            constraints = get_tile_constraints(tile_type)
            
            if 'gridSize' in tile:
                tile['gridSize'] = {
                    'width': max(constraints['minWidth'], min(constraints['maxWidth'], tile['gridSize'].get('width', constraints['defaultWidth']))),
                    'height': max(constraints['minHeight'], min(constraints['maxHeight'], tile['gridSize'].get('height', constraints['defaultHeight'])))
                }
            
            # Ensure grid position is valid
            if 'gridPosition' in tile:
                tile['gridPosition'] = {
                    'x': max(0, tile['gridPosition'].get('x', 0)),
                    'y': max(0, tile['gridPosition'].get('y', 0))
                }
    
    migrated_config['_version'] = {
        'version': '2.0.0',
        'lastUpdated': datetime.utcnow().isoformat(),
        'migrationHistory': config.get('_version', {}).get('migrationHistory', ['1.0.0']) + ['1.1.0']
    }
    
    return migrated_config

def get_default_tile_size(tile_type: str) -> Dict[str, int]:
    """Get default tile size for a tile type"""
    tile_sizes = {
        'stock': {'width': 4, 'height': 4},
        'crypto': {'width': 4, 'height': 4},
        'portfolio': {'width': 6, 'height': 6},
        'custom': {'width': 3, 'height': 3},
        'chat_generated': {'width': 4, 'height': 4},
    }
    return tile_sizes.get(tile_type, {'width': 3, 'height': 3})

def get_tile_constraints(tile_type: str) -> Dict[str, int]:
    """Get tile size constraints for a tile type"""
    constraints = {
        'stock': {'minWidth': 2, 'maxWidth': 8, 'minHeight': 3, 'maxHeight': 8, 'defaultWidth': 4, 'defaultHeight': 4},
        'crypto': {'minWidth': 2, 'maxWidth': 8, 'minHeight': 3, 'maxHeight': 8, 'defaultWidth': 4, 'defaultHeight': 4},
        'portfolio': {'minWidth': 3, 'maxWidth': 10, 'minHeight': 4, 'maxHeight': 12, 'defaultWidth': 6, 'defaultHeight': 6},
        'custom': {'minWidth': 1, 'maxWidth': 12, 'minHeight': 1, 'maxHeight': 20, 'defaultWidth': 3, 'defaultHeight': 3},
        'chat_generated': {'minWidth': 2, 'maxWidth': 12, 'minHeight': 2, 'maxHeight': 15, 'defaultWidth': 4, 'defaultHeight': 4},
    }
    return constraints.get(tile_type, constraints['custom'])

def validate_dashboard_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Validate dashboard configuration and return validation results"""
    errors = []
    warnings = []
    
    try:
        # Check required fields
        if not isinstance(config, dict):
            errors.append("Dashboard config must be a dictionary")
            return {'valid': False, 'errors': errors, 'warnings': warnings}
        
        if 'dashboards' not in config:
            errors.append("Missing 'dashboards' field")
        elif not isinstance(config['dashboards'], list):
            errors.append("'dashboards' must be a list")
        else:
            # Validate each dashboard
            for i, dashboard in enumerate(config['dashboards']):
                dashboard_errors = validate_dashboard(dashboard, i)
                errors.extend(dashboard_errors)
        
        # Check version
        if '_version' not in config:
            warnings.append("Missing version information")
        elif config['_version'].get('version') != CURRENT_DASHBOARD_VERSION:
            warnings.append(f"Dashboard version {config['_version'].get('version')} is not current ({CURRENT_DASHBOARD_VERSION})")
        
    except Exception as e:
        errors.append(f"Validation error: {str(e)}")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings
    }

def validate_dashboard(dashboard: Dict[str, Any], index: int) -> List[str]:
    """Validate individual dashboard"""
    errors = []
    
    if not isinstance(dashboard, dict):
        errors.append(f"Dashboard {index} must be a dictionary")
        return errors
    
    # Check required fields
    if 'id' not in dashboard:
        errors.append(f"Dashboard {index} missing required 'id' field")
    
    if 'name' not in dashboard:
        errors.append(f"Dashboard {index} missing required 'name' field")
    
    if 'tiles' not in dashboard:
        errors.append(f"Dashboard {index} missing 'tiles' field")
    elif not isinstance(dashboard['tiles'], list):
        errors.append(f"Dashboard {index} 'tiles' must be a list")
    else:
        # Validate each tile
        for j, tile in enumerate(dashboard['tiles']):
            tile_errors = validate_tile(tile, index, j)
            errors.extend(tile_errors)
    
    return errors

def validate_tile(tile: Dict[str, Any], dashboard_index: int, tile_index: int) -> List[str]:
    """Validate individual tile"""
    errors = []
    
    if not isinstance(tile, dict):
        errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} must be a dictionary")
        return errors
    
    # Check required fields
    required_fields = ['id', 'type', 'title']
    for field in required_fields:
        if field not in tile:
            errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} missing required '{field}' field")
    
    # Validate grid properties
    if 'gridPosition' not in tile:
        errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} missing 'gridPosition'")
    elif not isinstance(tile['gridPosition'], dict) or 'x' not in tile['gridPosition'] or 'y' not in tile['gridPosition']:
        errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} has invalid 'gridPosition'")
    
    if 'gridSize' not in tile:
        errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} missing 'gridSize'")
    elif not isinstance(tile['gridSize'], dict) or 'width' not in tile['gridSize'] or 'height' not in tile['gridSize']:
        errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} has invalid 'gridSize'")
    else:
        # Validate size constraints
        tile_type = tile.get('type', 'custom')
        constraints = get_tile_constraints(tile_type)
        
        width = tile['gridSize'].get('width', 0)
        height = tile['gridSize'].get('height', 0)
        
        if width < constraints['minWidth'] or width > constraints['maxWidth']:
            errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} width {width} outside valid range [{constraints['minWidth']}, {constraints['maxWidth']}]")
        
        if height < constraints['minHeight'] or height > constraints['maxHeight']:
            errors.append(f"Dashboard {dashboard_index}, Tile {tile_index} height {height} outside valid range [{constraints['minHeight']}, {constraints['maxHeight']}]")
    
    return errors

def safe_load_dashboard(dashboard_data: Dict[str, Any]) -> Dict[str, Any]:
    """Safely load dashboard with migration and validation"""
    try:
        # Step 1: Migrate to current version
        migrated_data = migrate_dashboard_data(dashboard_data)
        
        # Step 2: Validate structure
        validation = validate_dashboard_config(migrated_data)
        
        if not validation['valid']:
            logger.warning(f"Dashboard validation failed: {validation['errors']}")
            
            # Try to repair common issues
            repaired_data = attempt_dashboard_repair(migrated_data)
            repaired_validation = validate_dashboard_config(repaired_data)
            
            if not repaired_validation['valid']:
                logger.error("Dashboard repair failed, using fallback")
                return create_fallback_dashboard()
            
            logger.info("Dashboard repaired successfully")
            return repaired_data
        
        if validation['warnings']:
            logger.info(f"Dashboard validation warnings: {validation['warnings']}")
        
        logger.info("Dashboard loaded and validated successfully")
        return migrated_data
        
    except Exception as e:
        logger.error(f"Critical error loading dashboard: {str(e)}")
        return create_fallback_dashboard()

def attempt_dashboard_repair(dashboard_data: Dict[str, Any]) -> Dict[str, Any]:
    """Attempt to repair corrupted dashboard"""
    logger.info("Attempting to repair corrupted dashboard")
    
    repaired_data = dashboard_data.copy()
    
    # Ensure basic structure
    if 'dashboards' not in repaired_data:
        repaired_data['dashboards'] = []
    
    # Repair each dashboard
    for dashboard in repaired_data['dashboards']:
        if 'tiles' not in dashboard:
            dashboard['tiles'] = []
        
        # Repair each tile
        for tile in dashboard['tiles']:
            tile_type = tile.get('type', 'custom')
            constraints = get_tile_constraints(tile_type)
            default_size = get_default_tile_size(tile_type)
            
            # Fix missing or invalid properties
            tile['id'] = tile.get('id', f"tile_{datetime.utcnow().timestamp()}_{hash(str(tile))}")
            tile['type'] = tile_type
            tile['title'] = tile.get('title', 'Repaired Tile')
            tile['gridPosition'] = {
                'x': max(0, tile.get('gridPosition', {}).get('x', 0)),
                'y': max(0, tile.get('gridPosition', {}).get('y', 0))
            }
            tile['gridSize'] = {
                'width': max(constraints['minWidth'], min(constraints['maxWidth'], tile.get('gridSize', {}).get('width', default_size['width']))),
                'height': max(constraints['minHeight'], min(constraints['maxHeight'], tile.get('gridSize', {}).get('height', default_size['height'])))
            }
            tile['dashboard_id'] = tile.get('dashboard_id', dashboard.get('id', 'main'))
            tile['displayOptions'] = tile.get('displayOptions', {})
            tile['autoRefresh'] = tile.get('autoRefresh', False)
            tile['isPinned'] = tile.get('isPinned', False)
            tile['created_at'] = tile.get('created_at', datetime.utcnow().isoformat())
    
    # Update version
    repaired_data['_version'] = {
        'version': CURRENT_DASHBOARD_VERSION,
        'lastUpdated': datetime.utcnow().isoformat(),
        'migrationHistory': dashboard_data.get('_version', {}).get('migrationHistory', ['1.0.0']) + ['repair']
    }
    
    return repaired_data

def create_fallback_dashboard() -> Dict[str, Any]:
    """Create fallback dashboard if all else fails"""
    logger.info("Creating fallback dashboard")
    
    return {
        'dashboards': [{
            'id': f'fallback_{int(datetime.utcnow().timestamp())}',
            'name': 'Default Dashboard',
            'tiles': [],
            'layout': 'grid',
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
            'isDefault': True
        }],
        '_version': {
            'version': CURRENT_DASHBOARD_VERSION,
            'lastUpdated': datetime.utcnow().isoformat(),
            'migrationHistory': ['fallback']
        }
    }
