// Dashboard Migration and Compatibility Utilities
// Ensures backward compatibility and safe migrations for production deployments

import { UnifiedTile, Dashboard } from '../types/dashboardTypes';
import { getDefaultTileSize, getTileConfig } from './tileConfig';

// Version tracking for dashboard configurations
export interface DashboardVersion {
  version: string;
  lastUpdated: string;
  migrationHistory: string[];
}

export interface MigratedDashboard extends Dashboard {
  _version?: DashboardVersion;
}

// Current dashboard schema version
export const CURRENT_DASHBOARD_VERSION = '2.0.0';

// Migration functions for different versions
export const DASHBOARD_MIGRATIONS = {
  '1.0.0': migrateFromV1_0_0,
  '1.1.0': migrateFromV1_1_0,
  '2.0.0': migrateFromV2_0_0,
};

// Migrate from version 1.0.0 (original system)
function migrateFromV1_0_0(dashboard: any): MigratedDashboard {
  console.log('🔄 Migrating dashboard from v1.0.0 to v1.1.0');
  
  const migratedTiles = (dashboard.tiles || []).map((tile: any) => {
    // Add missing properties with safe defaults
    return {
      ...tile,
      gridPosition: tile.gridPosition || { x: 0, y: 0 },
      gridSize: tile.gridSize || getDefaultTileSize(tile.type),
      dashboard_id: tile.dashboard_id || 'main',
      displayOptions: tile.displayOptions || {},
      autoRefresh: tile.autoRefresh || false,
      isPinned: tile.isPinned || false,
      created_at: tile.created_at || new Date().toISOString(),
    };
  });

  return {
    ...dashboard,
    tiles: migratedTiles,
    _version: {
      version: '1.1.0',
      lastUpdated: new Date().toISOString(),
      migrationHistory: ['1.0.0'],
    },
  };
}

// Migrate from version 1.1.0 (added grid system)
function migrateFromV1_1_0(dashboard: any): MigratedDashboard {
  console.log('🔄 Migrating dashboard from v1.1.0 to v2.0.0');
  
  const migratedTiles = (dashboard.tiles || []).map((tile: any) => {
    // Validate and fix tile configurations
    const tileConfig = getTileConfig(tile.type);
    const defaultSize = tileConfig.sizeConstraints;
    
    // Ensure grid size is within valid constraints
    const validatedGridSize = {
      width: Math.max(defaultSize.minWidth, Math.min(defaultSize.maxWidth, tile.gridSize?.width || defaultSize.defaultWidth)),
      height: Math.max(defaultSize.minHeight, Math.min(defaultSize.maxHeight, tile.gridSize?.height || defaultSize.defaultHeight)),
    };

    return {
      ...tile,
      gridSize: validatedGridSize,
      // Ensure grid position is valid
      gridPosition: {
        x: Math.max(0, tile.gridPosition?.x || 0),
        y: Math.max(0, tile.gridPosition?.y || 0),
      },
    };
  });

  return {
    ...dashboard,
    tiles: migratedTiles,
    _version: {
      version: '2.0.0',
      lastUpdated: new Date().toISOString(),
      migrationHistory: dashboard._version?.migrationHistory || ['1.0.0', '1.1.0'],
    },
  };
}

// Current version migration (no-op but updates version)
function migrateFromV2_0_0(dashboard: any): MigratedDashboard {
  console.log('✅ Dashboard already at current version v2.0.0');
  
  return {
    ...dashboard,
    _version: {
      version: '2.0.0',
      lastUpdated: new Date().toISOString(),
      migrationHistory: dashboard._version?.migrationHistory || ['1.0.0', '1.1.0', '2.0.0'],
    },
  };
}

// Main migration function
export function migrateDashboard(dashboard: any): MigratedDashboard {
  const currentVersion = dashboard._version?.version || '1.0.0';
  
  if (currentVersion === CURRENT_DASHBOARD_VERSION) {
    return migrateFromV2_0_0(dashboard);
  }

  console.log(`🔄 Migrating dashboard from ${currentVersion} to ${CURRENT_DASHBOARD_VERSION}`);
  
  let migratedDashboard = dashboard;
  const migrationHistory = dashboard._version?.migrationHistory || [currentVersion];
  
  // Apply migrations in sequence
  const versionChain = ['1.0.0', '1.1.0', '2.0.0'];
  const startIndex = versionChain.indexOf(currentVersion);
  
  if (startIndex === -1) {
    console.warn(`⚠️ Unknown dashboard version ${currentVersion}, treating as 1.0.0`);
    migratedDashboard = migrateFromV1_0_0(dashboard);
  } else {
    for (let i = startIndex + 1; i < versionChain.length; i++) {
      const version = versionChain[i];
      const migrationFn = DASHBOARD_MIGRATIONS[version as keyof typeof DASHBOARD_MIGRATIONS];
      if (migrationFn) {
        migratedDashboard = migrationFn(migratedDashboard);
      }
    }
  }

  return migratedDashboard;
}

// Validate dashboard structure
export function validateDashboard(dashboard: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!dashboard) {
    errors.push('Dashboard is null or undefined');
    return { isValid: false, errors };
  }
  
  if (!dashboard.id) {
    errors.push('Dashboard missing required id');
  }
  
  if (!dashboard.name) {
    errors.push('Dashboard missing required name');
  }
  
  if (!Array.isArray(dashboard.tiles)) {
    errors.push('Dashboard tiles must be an array');
  } else {
    // Validate each tile
    dashboard.tiles.forEach((tile: any, index: number) => {
      if (!tile.id) {
        errors.push(`Tile ${index} missing required id`);
      }
      
      if (!tile.type) {
        errors.push(`Tile ${index} missing required type`);
      }
      
      if (!tile.gridPosition) {
        errors.push(`Tile ${index} missing gridPosition`);
      }
      
      if (!tile.gridSize) {
        errors.push(`Tile ${index} missing gridSize`);
      }
      
      // Validate grid constraints
      if (tile.gridPosition && tile.gridSize) {
        const tileConfig = getTileConfig(tile.type);
        const constraints = tileConfig.sizeConstraints;
        
        if (tile.gridSize.width < constraints.minWidth || tile.gridSize.width > constraints.maxWidth) {
          errors.push(`Tile ${index} width ${tile.gridSize.width} outside valid range [${constraints.minWidth}, ${constraints.maxWidth}]`);
        }
        
        if (tile.gridSize.height < constraints.minHeight || tile.gridSize.height > constraints.maxHeight) {
          errors.push(`Tile ${index} height ${tile.gridSize.height} outside valid range [${constraints.minHeight}, ${constraints.maxHeight}]`);
        }
      }
    });
  }
  
  return { isValid: errors.length === 0, errors };
}

// Safe dashboard loader with migration and validation
export function safeLoadDashboard(dashboardData: any): MigratedDashboard | null {
  try {
    console.log('🔍 Loading dashboard with migration and validation');
    
    // Step 1: Migrate to current version
    const migratedDashboard = migrateDashboard(dashboardData);
    
    // Step 2: Validate structure
    const validation = validateDashboard(migratedDashboard);
    
    if (!validation.isValid) {
      console.error('❌ Dashboard validation failed:', validation.errors);
      
      // Try to fix common issues
      const fixedDashboard = attemptDashboardRepair(migratedDashboard);
      const fixedValidation = validateDashboard(fixedDashboard);
      
      if (!fixedValidation.isValid) {
        console.error('❌ Dashboard repair failed, using fallback');
        return createFallbackDashboard();
      }
      
      console.log('✅ Dashboard repaired successfully');
      return fixedDashboard;
    }
    
    console.log('✅ Dashboard loaded and validated successfully');
    return migratedDashboard;
    
  } catch (error) {
    console.error('❌ Critical error loading dashboard:', error);
    return createFallbackDashboard();
  }
}

// Attempt to repair corrupted dashboard
function attemptDashboardRepair(dashboard: any): MigratedDashboard {
  console.log('🔧 Attempting to repair dashboard');
  
  const repairedTiles = (dashboard.tiles || []).map((tile: any) => {
    const tileConfig = getTileConfig(tile.type || 'custom');
    const defaultSize = tileConfig.sizeConstraints;
    
    return {
      id: tile.id || `tile_${Date.now()}_${Math.random()}`,
      type: tile.type || 'custom',
      title: tile.title || 'Repaired Tile',
      symbol: tile.symbol,
      timeframe: tile.timeframe,
      displayOptions: tile.displayOptions || {},
      autoRefresh: tile.autoRefresh || false,
      isPinned: tile.isPinned || false,
      size: tile.size || { width: 350, height: 400 },
      gridPosition: tile.gridPosition || { x: 0, y: 0 },
      gridSize: {
        width: Math.max(defaultSize.minWidth, Math.min(defaultSize.maxWidth, tile.gridSize?.width || defaultSize.defaultWidth)),
        height: Math.max(defaultSize.minHeight, Math.min(defaultSize.maxHeight, tile.gridSize?.height || defaultSize.defaultHeight)),
      },
      dashboard_id: tile.dashboard_id || dashboard.id || 'main',
      created_at: tile.created_at || new Date().toISOString(),
    };
  });

  return {
    ...dashboard,
    tiles: repairedTiles,
    _version: {
      version: CURRENT_DASHBOARD_VERSION,
      lastUpdated: new Date().toISOString(),
      migrationHistory: ['1.0.0', '1.1.0', '2.0.0', 'repair'],
    },
  };
}

// Create fallback dashboard if all else fails
function createFallbackDashboard(): MigratedDashboard {
  console.log('🆘 Creating fallback dashboard');
  
  return {
    id: `fallback_${Date.now()}`,
    name: 'Default Dashboard',
    tiles: [],
    layout: 'grid',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    isDefault: true,
    _version: {
      version: CURRENT_DASHBOARD_VERSION,
      lastUpdated: new Date().toISOString(),
      migrationHistory: ['fallback'],
    },
  };
}

// Check if dashboard needs migration
export function needsMigration(dashboard: any): boolean {
  const currentVersion = dashboard._version?.version || '1.0.0';
  return currentVersion !== CURRENT_DASHBOARD_VERSION;
}

// Get dashboard version info
export function getDashboardVersion(dashboard: any): DashboardVersion {
  return dashboard._version || {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    migrationHistory: ['1.0.0'],
  };
}
