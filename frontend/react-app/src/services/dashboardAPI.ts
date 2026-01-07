import { apiRequest } from './api';
import { Dashboard } from '../types/dashboardTypes';
import { cleanupPaginationStates, validateDashboardForSaving } from '../utils/dashboardCleanup';

export interface CryptoTile {
  id: string;
  symbol: string;
  timeframe: string;
  displayOptions: {
    showPrice: boolean;
    show24hChange: boolean;
    showAnnualReturn: boolean;
    showVolatility: boolean;
    showChart: boolean;
  };
  autoRefresh: boolean;
  isPinned: boolean;
  size: { width: number; height: number };
  position?: { x: number; y: number };
  created_at?: string;
}

export interface DashboardConfig {
  tabs: DashboardTab[];
  tabGroups: DashboardGroup[];
  activeTabId: string;
  last_updated: string;
  tabOrder?: string[];
  groupOrder?: string[];
  // Legacy fields for backward compatibility (deprecated)
  crypto_tiles?: CryptoTile[];
  layout?: string;
  dashboards?: Dashboard[];
}

export interface DashboardTab {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
  tiles: CryptoTile[];
  layout: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardGroup {
  id: string;
  name: string;
  color: string;
  tabs: string[];
  created_at: string;
  updated_at: string;
}

export interface DashboardResponse {
  dashboard_config: DashboardConfig;
  message?: string;
}

export interface AddTileResponse {
  tile: CryptoTile;
  message: string;
}

export interface RemoveTileResponse {
  message: string;
}

// Convert new simplified structure to legacy format for frontend compatibility
export const convertNewToLegacyFormat = (newConfig: any): DashboardConfig => {
  // Find the active tab or use the first tab
  const activeTab = newConfig.tabs.find((tab: any) => tab.id === newConfig.activeTabId) || newConfig.tabs[0];
  
  if (!activeTab) {
    // Fallback if no tabs
    return createDefaultDashboard();
  }
  
  // Convert tab tiles to legacy crypto_tiles format
  const crypto_tiles = activeTab.tiles.map((tile: any) => ({
    id: tile.id,
    symbol: tile.symbol || 'BTC',
    timeframe: tile.timeframe || '1d',
    displayOptions: tile.displayOptions || {
      showPrice: true,
      show24hChange: true,
      showAnnualReturn: true,
      showVolatility: true,
      showChart: true,
    },
    autoRefresh: tile.autoRefresh || false,
    isPinned: tile.isPinned || false,
    size: tile.size || { width: 350, height: 400 },
    position: tile.position || tile.gridPosition || { x: 0, y: 0 },
    created_at: tile.created_at || new Date().toISOString(),
  }));
  
  return {
    crypto_tiles,
    layout: activeTab.layout || 'grid',
    last_updated: newConfig.last_updated || new Date().toISOString(),
    // Keep new structure for future use
    tabs: newConfig.tabs,
    tabGroups: newConfig.tabGroups,
    activeTabId: newConfig.activeTabId,
  };
};

// Dashboard API functions
export const dashboardAPI = {
  // Get user's dashboard configuration
  getDashboard: async (): Promise<DashboardResponse> => {
    try {
      const response = await apiRequest<{ dashboard_config: any }>(`/dashboard`, {
        method: 'GET'
      });
      
      // Convert new simplified structure to legacy format for frontend compatibility
      const newConfig = response.dashboard_config;
      const legacyConfig = convertNewToLegacyFormat(newConfig);
      
      return {
        dashboard_config: legacyConfig,
      };
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      // Return default dashboard if API fails
      return {
        dashboard_config: createDefaultDashboard(),
      };
    }
  },

  // Update entire dashboard configuration
  updateDashboard: async (dashboardConfig: DashboardConfig): Promise<DashboardResponse> => {
    try {
      // Clean up overly nested pagination states to prevent DynamoDB errors
      const cleanedConfig = cleanupPaginationStates(dashboardConfig);
      
      // Log cleanup impact
      const originalSize = JSON.stringify(dashboardConfig).length;
      const cleanedSize = JSON.stringify(cleanedConfig).length;
      if (originalSize !== cleanedSize) {
        console.log(`🧹 Dashboard cleanup reduced payload: ${originalSize} -> ${cleanedSize} bytes (${Math.round((1 - cleanedSize/originalSize) * 100)}% reduction)`);
      }
      
      // Validate the dashboard before sending
      const validation = validateDashboardForSaving(cleanedConfig);
      if (!validation.isValid) {
        console.warn('Dashboard validation warnings:', validation.errors);
        // Log warnings but don't block - the backend cleanup will handle it
      }
      
      console.log('🧹 Sending cleaned dashboard config to backend');
      
      return await apiRequest<DashboardResponse>(`/dashboard`, {
        method: 'PUT',
        body: JSON.stringify({ dashboard_config: cleanedConfig })
      });
    } catch (error) {
      console.error('Error updating dashboard:', error);
      throw error;
    }
  },

  // Add a new crypto tile
  addTile: async (tileData: Omit<CryptoTile, 'id' | 'created_at'>): Promise<AddTileResponse> => {
    try {
      return await apiRequest<AddTileResponse>(`/tiles`, {
        method: 'POST',
        body: JSON.stringify(tileData)
      });
    } catch (error) {
      console.error('Error adding tile:', error);
      throw error;
    }
  },

  // Remove a crypto tile
  removeTile: async (tileId: string): Promise<RemoveTileResponse> => {
    try {
      return await apiRequest<RemoveTileResponse>(`/tiles/${tileId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Error removing tile:', error);
      throw error;
    }
  },

  // Update a specific tile
  updateTile: async (tileId: string, tileData: Partial<CryptoTile>): Promise<AddTileResponse> => {
    try {
      return await apiRequest<AddTileResponse>(`/tiles/${tileId}`, {
        method: 'PUT',
        body: JSON.stringify(tileData)
      });
    } catch (error) {
      console.error('Error updating tile:', error);
      throw error;
    }
  },
};

// Helper functions
export const createDefaultDashboard = (): DashboardConfig => ({
  tabs: [
    {
      id: 'default-tab-1',
      name: 'My Dashboard',
      color: '#3b82f6',
      isPinned: false,
      tiles: [],
      layout: 'grid',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  tabGroups: [],
  activeTabId: 'default-tab-1',
  last_updated: new Date().toISOString(),
});

export const validateDashboardConfig = (config: DashboardConfig): boolean => {
  if (!config.tabs || !Array.isArray(config.tabs)) {
    return false;
  }
  
  for (const tab of config.tabs) {
    if (!tab.id || !tab.name || !tab.color) {
      return false;
    }
    if (!tab.tiles || !Array.isArray(tab.tiles)) {
      return false;
    }
  }
  
  return true;
};

export const validateTileConfig = (tile: CryptoTile): boolean => {
  return !!(tile.id && tile.symbol && tile.timeframe);
};

export const generateTileId = (): string => {
  return `tile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
