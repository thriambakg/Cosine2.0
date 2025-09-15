import { useState, useEffect, useCallback } from 'react';
import { dashboardAPI } from '../services/api';

// Types matching the current backend structure
interface DashboardTile {
  id: string;
  symbol: string;
  timeframe: string;
  autoRefresh: boolean;
  size: { width: number; height: number };
  isPinned: boolean;
  created_at: string;
  position: { x: number; y: number };
  displayOptions: {
    showVolatility: boolean;
    show24hChange: boolean;
    showAnnualReturn: boolean;
    showChart: boolean;
    showPrice: boolean;
  };
}

interface DashboardTab {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
  tiles: DashboardTile[];
  layout: string;
  created_at: string;
  updated_at: string;
}

interface DashboardGroup {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

interface DashboardConfig {
  tabs: DashboardTab[];
  tabGroups: DashboardGroup[];
  tabOrder: string[];
  groupOrder: string[];
  activeTabId: string;
  last_updated: string;
}

interface UseDashboardAPIOptions {
  userId: string;
}

export const useDashboardAPI = ({ userId }: UseDashboardAPIOptions) => {
  const [dashboard, setDashboard] = useState<DashboardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load dashboard from API
  const loadDashboard = useCallback(async () => {
    if (!userId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await dashboardAPI.getDashboard();
      console.log('📥 Loaded dashboard from API:', response);
      
      if (response.dashboard_config) {
        setDashboard(response.dashboard_config);
      } else {
        throw new Error('Invalid dashboard response structure');
      }
    } catch (err) {
      console.error('❌ Failed to load dashboard:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Create new tab
  const createTab = useCallback(async (tabData: { name: string; color?: string }) => {
    if (!userId) throw new Error('User ID required');
    
    try {
      console.log('➕ Creating new tab:', tabData);
      
      const response = await dashboardAPI.createTab({
        name: tabData.name,
        color: tabData.color || '#3b82f6'
      });
      
      console.log('✅ Tab created:', response);
      
      // Reload dashboard to get updated state
      await loadDashboard();
      
      return response;
    } catch (err) {
      console.error('❌ Failed to create tab:', err);
      throw err;
    }
  }, [userId, loadDashboard]);

  // Reorder tabs
  const reorderTabs = useCallback(async (tabIds: string[]) => {
    if (!userId) throw new Error('User ID required');
    
    try {
      console.log('🔄 Reordering tabs:', tabIds);
      
      const response = await dashboardAPI.reorderTabs(tabIds);
      
      console.log('✅ Tabs reordered:', response);
      
      // Reload dashboard to get updated state
      await loadDashboard();
      
      return response;
    } catch (err) {
      console.error('❌ Failed to reorder tabs:', err);
      throw err;
    }
  }, [userId, loadDashboard]);

  // Reorder groups
  const reorderGroups = useCallback(async (groupIds: string[]) => {
    if (!userId) throw new Error('User ID required');
    
    try {
      console.log('🔄 Reordering groups:', groupIds);
      
      const response = await dashboardAPI.reorderGroups(groupIds);
      
      console.log('✅ Groups reordered:', response);
      
      // Reload dashboard to get updated state
      await loadDashboard();
      
      return response;
    } catch (err) {
      console.error('❌ Failed to reorder groups:', err);
      throw err;
    }
  }, [userId, loadDashboard]);

  // Get tabs in the correct order
  const getOrderedTabs = useCallback(() => {
    if (!dashboard) return [];
    
    const { tabs, tabOrder } = dashboard;
    
    // If no tabOrder specified, return tabs as-is
    if (!tabOrder || tabOrder.length === 0) {
      return tabs;
    }
    
    // Return tabs in the order specified by tabOrder
    return tabOrder
      .map(tabId => tabs.find(tab => tab.id === tabId))
      .filter(tab => tab !== undefined) as DashboardTab[];
  }, [dashboard]);

  // Get groups in the correct order
  const getOrderedGroups = useCallback(() => {
    if (!dashboard) return [];
    
    const { tabGroups, groupOrder } = dashboard;
    
    // If no groupOrder specified, return groups as-is
    if (!groupOrder || groupOrder.length === 0) {
      return tabGroups;
    }
    
    // Return groups in the order specified by groupOrder
    return groupOrder
      .map(groupId => tabGroups.find(group => group.id === groupId))
      .filter(group => group !== undefined) as DashboardGroup[];
  }, [dashboard]);

  // Load dashboard on mount and when userId changes
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return {
    dashboard,
    loading,
    error,
    loadDashboard,
    createTab,
    reorderTabs,
    reorderGroups,
    getOrderedTabs,
    getOrderedGroups,
    // Helper properties
    tabs: getOrderedTabs(),
    groups: getOrderedGroups(),
    activeTabId: dashboard?.activeTabId || null,
    lastUpdated: dashboard?.last_updated || null
  };
};
