import { apiRequest } from './api';

// ============================================================================
// DASHBOARD API TYPES
// ============================================================================

export interface DashboardTile {
  id: string;
  symbol: string;
  timeframe: '1d' | '7d' | '30d' | '1y';
  position: { x: number; y: number };
  created_at: string;
}

export interface DashboardConfig {
  crypto_tiles: DashboardTile[];
  layout: 'grid' | 'freeform';
  last_updated: string;
}

export interface DashboardResponse {
  dashboard_config: DashboardConfig;
}

export interface AddTileRequest {
  tile: {
    symbol: string;
    timeframe: '1d' | '7d' | '30d' | '1y';
    position?: { x: number; y: number };
  };
}

export interface AddTileResponse {
  tile: DashboardTile;
  message: string;
}

export interface UpdateDashboardRequest {
  dashboard_config: DashboardConfig;
}

export interface UpdateDashboardResponse {
  message: string;
}

export interface RemoveTileResponse {
  message: string;
}

// ============================================================================
// DASHBOARD API FUNCTIONS
// ============================================================================

export const dashboardAPI = {
  /**
   * Get user's dashboard configuration
   * @param userId - User ID (for now, will be replaced with auth token)
   */
  getDashboard: async (userId: string): Promise<DashboardResponse> => {
    return apiRequest<DashboardResponse>(`/dashboard?userId=${userId}`);
  },

  /**
   * Update user's dashboard configuration
   * @param userId - User ID (for now, will be replaced with auth token)
   * @param config - Dashboard configuration
   */
  updateDashboard: async (
    userId: string, 
    config: DashboardConfig
  ): Promise<UpdateDashboardResponse> => {
    return apiRequest<UpdateDashboardResponse>(`/dashboard?userId=${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ dashboard_config: config }),
    });
  },

  /**
   * Add a new crypto tile to user's dashboard
   * @param userId - User ID (for now, will be replaced with auth token)
   * @param tile - Tile configuration
   */
  addTile: async (
    userId: string, 
    tile: AddTileRequest['tile']
  ): Promise<AddTileResponse> => {
    return apiRequest<AddTileResponse>(`/dashboard?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({ tile }),
    });
  },

  /**
   * Remove a crypto tile from user's dashboard
   * @param userId - User ID (for now, will be replaced with auth token)
   * @param tileId - Tile ID to remove
   */
  removeTile: async (
    userId: string, 
    tileId: string
  ): Promise<RemoveTileResponse> => {
    return apiRequest<RemoveTileResponse>(`/dashboard/${tileId}?userId=${userId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a default dashboard configuration
 */
export const createDefaultDashboard = (): DashboardConfig => {
  return {
    crypto_tiles: [
      {
        id: 'tile_1',
        symbol: 'BTC',
        timeframe: '1d',
        position: { x: 0, y: 0 },
        created_at: new Date().toISOString(),
      },
    ],
    layout: 'grid',
    last_updated: new Date().toISOString(),
  };
};

/**
 * Validate dashboard configuration
 */
export const validateDashboardConfig = (config: DashboardConfig): boolean => {
  if (!config.crypto_tiles || !Array.isArray(config.crypto_tiles)) {
    return false;
  }

  if (!config.layout || !['grid', 'freeform'].includes(config.layout)) {
    return false;
  }

  for (const tile of config.crypto_tiles) {
    if (!validateTileConfig(tile)) {
      return false;
    }
  }

  return true;
};

/**
 * Validate tile configuration
 */
export const validateTileConfig = (tile: DashboardTile): boolean => {
  const validSymbols = ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI'];
  const validTimeframes = ['1d', '7d', '30d', '1y'];

  if (!tile.symbol || !validSymbols.includes(tile.symbol)) {
    return false;
  }

  if (!tile.timeframe || !validTimeframes.includes(tile.timeframe)) {
    return false;
  }

  if (!tile.position || typeof tile.position.x !== 'number' || typeof tile.position.y !== 'number') {
    return false;
  }

  return true;
};

/**
 * Generate a unique tile ID
 */
export const generateTileId = (): string => {
  return `tile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
