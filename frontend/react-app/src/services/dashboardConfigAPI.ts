/**
 * Dashboard Configuration API Service
 * Handles CRUD operations for user dashboard configurations
 */

import { api } from './api';

export interface DashboardConfig {
  tabs: Array<{
    id: string;
    name: string;
    color: string;
    isPinned: boolean;
    created_at: string;
  }>;
  tabGroups: Array<{
    id: string;
    name: string;
    color: string;
    tabIds: string[];
    created_at: string;
  }>;
  dashboards: Array<{
    id: string;
    tabId: string;
    name: string;
    tiles: Array<{
      id: string;
      type: string;
      symbol?: string;
      timeframe?: string;
      displayOptions?: any;
      autoRefresh?: boolean;
      isPinned?: boolean;
      size?: { width: number; height: number };
      position?: { x: number; y: number };
      created_at: string;
    }>;
    layout: string;
    created_at: string;
  }>;
  activeTabId: string;
  nextTabId: number;
  nextGroupId: number;
  last_updated: string;
}

export interface DashboardConfigResponse {
  user_id: string;
  dashboard_config: DashboardConfig;
  last_updated: string;
  message?: string;
}

class DashboardConfigAPI {
  private baseUrl = '/dashboard-config';

  /**
   * Get dashboard configuration for the current user
   */
  async getDashboardConfig(userId: string): Promise<DashboardConfigResponse> {
    try {
      const response = await api.get(`${this.baseUrl}/${userId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching dashboard config:', error);
      throw new Error('Failed to fetch dashboard configuration');
    }
  }

  /**
   * Update dashboard configuration for the current user
   */
  async updateDashboardConfig(userId: string, config: DashboardConfig): Promise<DashboardConfigResponse> {
    try {
      const response = await api.put(`${this.baseUrl}/${userId}`, {
        dashboard_config: config
      });
      return response.data;
    } catch (error) {
      console.error('Error updating dashboard config:', error);
      throw new Error('Failed to update dashboard configuration');
    }
  }

  /**
   * Create or initialize dashboard configuration for the current user
   */
  async createDashboardConfig(userId: string, config?: DashboardConfig): Promise<DashboardConfigResponse> {
    try {
      const response = await api.post(`${this.baseUrl}/${userId}`, {
        dashboard_config: config
      });
      return response.data;
    } catch (error) {
      console.error('Error creating dashboard config:', error);
      throw new Error('Failed to create dashboard configuration');
    }
  }

  /**
   * Reset dashboard configuration to default for the current user
   */
  async resetDashboardConfig(userId: string): Promise<DashboardConfigResponse> {
    try {
      const response = await api.delete(`${this.baseUrl}/${userId}`);
      return response.data;
    } catch (error) {
      console.error('Error resetting dashboard config:', error);
      throw new Error('Failed to reset dashboard configuration');
    }
  }

  /**
   * Get default dashboard configuration
   */
  getDefaultConfig(): DashboardConfig {
    const now = new Date().toISOString();
    
    return {
      tabs: [
        {
          id: 'tab_1',
          name: 'My Dashboard',
          color: '#3b82f6',
          isPinned: false,
          created_at: now
        }
      ],
      tabGroups: [],
      dashboards: [
        {
          id: 'dashboard_1',
          tabId: 'tab_1',
          name: 'My Dashboard',
          tiles: [
            {
              id: 'tile_1',
              type: 'crypto',
              symbol: 'BTC',
              timeframe: '1d',
              displayOptions: {
                showPrice: true,
                show24hChange: true,
                showAnnualReturn: true,
                showVolatility: true,
                showChart: true
              },
              autoRefresh: false,
              isPinned: false,
              size: { width: 350, height: 400 },
              position: { x: 0, y: 0 },
              created_at: now
            }
          ],
          layout: 'grid',
          created_at: now
        }
      ],
      activeTabId: 'tab_1',
      nextTabId: 2,
      nextGroupId: 1,
      last_updated: now
    };
  }
}

export const dashboardConfigAPI = new DashboardConfigAPI();
export default dashboardConfigAPI;
