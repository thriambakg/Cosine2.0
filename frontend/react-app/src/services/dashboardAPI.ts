import axios from 'axios';
import { API_CONFIG } from '../config/api';

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
  crypto_tiles: CryptoTile[];
  layout: string;
  last_updated: string;
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

// Dashboard API functions
export const dashboardAPI = {
  // Get user's dashboard configuration
  getDashboard: async (): Promise<DashboardResponse> => {
    try {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/dashboard`);
      return response.data;
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
      const response = await axios.put(`${API_CONFIG.BASE_URL}/dashboard`, {
        dashboard_config: dashboardConfig,
      });
      return response.data;
    } catch (error) {
      console.error('Error updating dashboard:', error);
      throw error;
    }
  },

  // Add a new crypto tile
  addTile: async (tileData: Omit<CryptoTile, 'id' | 'created_at'>): Promise<AddTileResponse> => {
    try {
      const response = await axios.post(`${API_CONFIG.BASE_URL}/dashboard/tiles`, tileData);
      return response.data;
    } catch (error) {
      console.error('Error adding tile:', error);
      throw error;
    }
  },

  // Remove a crypto tile
  removeTile: async (tileId: string): Promise<RemoveTileResponse> => {
    try {
      const response = await axios.delete(`${API_CONFIG.BASE_URL}/dashboard/tiles/${tileId}`);
      return response.data;
    } catch (error) {
      console.error('Error removing tile:', error);
      throw error;
    }
  },

  // Update a specific tile
  updateTile: async (tileId: string, tileData: Partial<CryptoTile>): Promise<AddTileResponse> => {
    try {
      const response = await axios.put(`${API_CONFIG.BASE_URL}/dashboard/tiles/${tileId}`, tileData);
      return response.data;
    } catch (error) {
      console.error('Error updating tile:', error);
      throw error;
    }
  },
};

// Helper functions
export const createDefaultDashboard = (): DashboardConfig => ({
  crypto_tiles: [
    {
      id: 'tile_1',
      symbol: 'BTC',
      timeframe: '1d',
                   displayOptions: {
        showPrice: true,
        show24hChange: true,
        showAnnualReturn: true,
        showVolatility: true,
        showChart: true,
      },
      autoRefresh: false,
      isPinned: false,
             size: { width: 350, height: 400 },
      created_at: new Date().toISOString(),
    },
  ],
  layout: 'grid',
  last_updated: new Date().toISOString(),
});

export const validateDashboardConfig = (config: DashboardConfig): boolean => {
  if (!config.crypto_tiles || !Array.isArray(config.crypto_tiles)) {
    return false;
  }
  
  for (const tile of config.crypto_tiles) {
    if (!tile.id || !tile.symbol || !tile.timeframe) {
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
