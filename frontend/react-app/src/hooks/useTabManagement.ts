import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardTab, DashboardGroup, Dashboard, TabManagementState, UnifiedTile } from '../types/dashboardTypes';
import { robustStorage, isIncognitoMode } from '../utils/storageUtils';
import { dashboardAPI } from '../services/api';

interface UseTabManagementOptions {
  userId?: string;
  localStorageKey?: string;
  debounceMs?: number;
}

export const useTabManagement = ({ 
  userId, 
  localStorageKey = 'dashboard-tabs',
  debounceMs = 2000 
}: UseTabManagementOptions) => {
  // State management
  const [state, setState] = useState<TabManagementState>({
    tabs: [],
    tabGroups: [],
    activeTabId: null,
    dashboards: [],
    nextTabId: 1,
    nextGroupId: 1
  });

  // Refs for debounced saves
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<TabManagementState | null>(null);

  // Load from robust storage (handles incognito mode)
  const loadFromStorage = useCallback((): TabManagementState | null => {
    try {
      const saved = robustStorage.get<TabManagementState>(`${localStorageKey}-${userId}`);
      if (saved && isIncognitoMode()) {
        console.warn('Running in incognito mode - data will be lost on page refresh');
      }
      return saved || null;
    } catch (error) {
      console.error('Error loading tabs from storage:', error);
      return null;
    }
  }, [localStorageKey, userId]);

  // Save to robust storage (handles incognito mode)
  const saveToStorage = useCallback((tabState: TabManagementState) => {
    try {
      robustStorage.set(`${localStorageKey}-${userId}`, tabState);
      if (isIncognitoMode()) {
        console.warn('Running in incognito mode - data will be lost on page refresh');
      }
    } catch (error) {
      console.error('Error saving tabs to storage:', error);
    }
  }, [localStorageKey, userId]);

  // Debounced save to database
  const debouncedSaveToDatabase = useCallback((tabState: TabManagementState) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    pendingSaveRef.current = tabState;

    saveTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        saveTabStateToDatabase(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    }, debounceMs);
  }, [debounceMs]);

  // Save to database using dashboard config API
  const saveTabStateToDatabase = async (tabState: TabManagementState) => {
    try {
      console.log('Saving tab state to database:', tabState);
      
      // Convert TabManagementState to format expected by existing dashboardAPI
      // The existing API expects the new format with tabs/dashboards
      const dashboardConfig = {
        tabs: tabState.tabs.map(tab => ({
          id: tab.id,
          name: tab.name,
          color: tab.color || '#3b82f6',
          isPinned: tab.isPinned || false,
          created_at: tab.created_at || new Date().toISOString()
        })),
        tabGroups: tabState.tabGroups.map(group => ({
          id: group.id,
          name: group.name,
          color: group.color || '#8b5cf6',
          tabIds: group.tabIds || [],
          created_at: group.created_at || new Date().toISOString()
        })),
        dashboards: tabState.dashboards.map(dashboard => ({
          id: dashboard.id,
          tabId: dashboard.tabId,
          name: dashboard.name,
          tiles: dashboard.tiles.map(tile => ({
            id: tile.id,
            type: tile.type,
            title: tile.title,
            symbol: tile.symbol,
            timeframe: tile.timeframe,
            name: tile.name,
            content: tile.content,
            prompt: tile.prompt,
            displayOptions: tile.displayOptions,
            autoRefresh: tile.autoRefresh,
            isPinned: tile.isPinned,
            size: tile.size,
            position: tile.position,
            gridPosition: tile.gridPosition,
            gridSize: tile.gridSize,
            dashboard_id: tile.dashboard_id,
            created_at: tile.created_at || new Date().toISOString()
          })),
          layout: dashboard.layout || 'grid',
          created_at: dashboard.created_at || new Date().toISOString()
        })),
        activeTabId: tabState.activeTabId || '',
        nextTabId: tabState.nextTabId || 1,
        nextGroupId: tabState.nextGroupId || 1,
        last_updated: new Date().toISOString()
      };
      
      await dashboardAPI.updateDashboard(dashboardConfig as any, userId);
      console.log('Successfully saved tab state to database');
      
    } catch (error) {
      console.error('Error saving tab state to database:', error);
      
      // Check if it's a CORS error specifically
      if (error instanceof Error && error.message && error.message.includes('CORS')) {
        console.warn('🚨 CORS error when saving to database - changes will only be saved locally');
        console.warn('💡 Tile positions and sizes are saved locally but won\'t persist across devices until CORS is fixed');
      }
      
      // Don't throw - we don't want to break the UI if database save fails
      // The local storage fallback will still work
    }
  };

  // Load tab state on mount
  useEffect(() => {
    const loadTabState = async () => {
      try {
        // Check storage status for debugging
        const storageStatus = robustStorage.getStorageStatus();
        console.log('Storage status:', storageStatus);

        // First try robust storage for immediate display
        const cachedState = loadFromStorage();
        if (cachedState) {
          setState(cachedState);
          console.log('Loaded tab state from robust storage');
        }

        // Try to load from database for latest changes (only if userId is available)
        if (userId) {
          try {
            const dbResponse = await dashboardAPI.getDashboard(userId);
          const dbConfig = dbResponse.dashboard_config;
          
          // Debug: Log raw database response
          console.log('🔍 RAW DATABASE RESPONSE DEBUG START');
          console.log('Raw dbConfig:', dbConfig);
          console.log('🔍 RAW DATABASE RESPONSE DEBUG END');
          
          // Convert DashboardConfig to TabManagementState
          // Use new simplified structure: Tab = Dashboard
          let dbState: TabManagementState;
          
          if ('tabs' in dbConfig) {
            // New simplified format: tabs contain tiles directly
            dbState = {
              tabs: (dbConfig.tabs as any[]).map((tab: any) => ({
                id: tab.id,
                name: tab.name,
                color: tab.color,
                isPinned: tab.isPinned || false,
                tiles: tab.tiles || [],
                layout: tab.layout || 'grid',
                created_at: tab.created_at,
                updated_at: tab.updated_at
              })),
              tabGroups: (dbConfig.tabGroups as any[]).map((group: any) => ({
                id: group.id,
                name: group.name,
                color: group.color,
                tabs: group.tabs || group.tabIds || [],
                tabIds: group.tabIds || group.tabs || [],
                collapsed: group.collapsed || false,
                position: group.position || 0,
                created_at: group.created_at
              })),
              dashboards: [], // No separate dashboards in new structure
              activeTabId: dbConfig.activeTabId || null,
              last_updated: dbConfig.last_updated || new Date().toISOString(),
              nextTabId: 1, // Not used with UUID-based IDs from backend
              nextGroupId: 1 // Not used with UUID-based IDs from backend
            };
          } else {
            // Fallback: create default structure if no tabs found
            const now = new Date().toISOString();
            dbState = {
              tabs: [{
                id: 'default-tab-1',
                name: 'My Dashboard',
                color: '#3b82f6',
                isPinned: false,
                tiles: [],
                layout: 'grid',
                created_at: now,
                updated_at: now
              }],
              tabGroups: [],
              dashboards: [], // No separate dashboards in new structure
              activeTabId: 'default-tab-1',
              last_updated: now,
              nextTabId: 2,
              nextGroupId: 1
            };
          }
          
          // Debug: Log which tab is being selected
          console.log('🔍 TAB SELECTION DEBUG START');
          console.log('Active tab ID from DB:', dbConfig.activeTabId);
          console.log('Total tabs loaded:', dbState.tabs.length);
          console.log('🔍 TAB SELECTION DEBUG END');
          
          // Update state with database data
          setState(dbState);
          saveToStorage(dbState);
          console.log('Loaded and updated tab state from database');
          
          // Debug: Log tile positions and sizes
          console.log('🔍 TILE POSITIONS DEBUG START');
          dbState.tabs.forEach(tab => {
            console.log(`Tab ${tab.id} tiles:`, tab.tiles.length);
            tab.tiles.forEach(tile => {
              console.log(`Tile ${tile.id}:`, {
                gridPosition: tile.gridPosition,
                gridSize: tile.gridSize,
                position: tile.position,
                size: tile.size
              });
            });
          });
          console.log('🔍 TILE POSITIONS DEBUG END');
          
        } catch (dbError) {
          console.warn('Failed to load from database, using local storage:', dbError);
          
          // Check if it's a CORS error specifically
          if (dbError instanceof Error && dbError.message && dbError.message.includes('CORS')) {
            console.warn('🚨 CORS error detected - this may prevent dashboard loading for new users');
            console.warn('💡 Consider deploying Lambda function with CORS fixes or check API Gateway configuration');
          }
          
          // If no cached state and database failed, create default
          if (!cachedState) {
            const defaultState = createDefaultTabState();
            setState(defaultState);
            saveToStorage(defaultState);
            console.log('Created default tab state due to database error');
          }
        }
        } else {
          console.log('No userId provided, skipping database load');
        }
      } catch (error) {
        console.error('Error loading tab state:', error);
        // Fallback to default state if loading fails
        const defaultState = createDefaultTabState();
        setState(defaultState);
      }
    };

    loadTabState();
  }, [userId, loadFromStorage, saveToStorage]);

  // Save immediately on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingSaveRef.current) {
        saveTabStateToDatabase(pendingSaveRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Create default tab state
  const createDefaultTabState = (): TabManagementState => {
    const defaultDashboard: Dashboard = {
      id: 'dashboard-1',
      name: 'Main Dashboard',
      tiles: [],
      layout: 'grid',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isDefault: true,
      isPinned: false
    };

    const defaultTab: DashboardTab = {
      id: 'tab-1',
      name: 'Main Dashboard',
      dashboardId: 'dashboard-1',
      isActive: true,
      position: 0,
      isPinned: false,
      isDirty: false,
      lastAccessed: new Date().toISOString()
    };

    return {
      tabs: [defaultTab],
      tabGroups: [],
      activeTabId: 'tab-1',
      dashboards: [defaultDashboard],
      nextTabId: 2,
      nextGroupId: 1
    };
  };

  // Update state and persist
  const updateState = useCallback((updates: Partial<TabManagementState>) => {
    setState(prevState => {
      const newState = { ...prevState, ...updates };
      saveToStorage(newState);
      debouncedSaveToDatabase(newState);
      return newState;
    });
  }, [saveToStorage, debouncedSaveToDatabase]);

  // Tab management functions
  const createTab = useCallback(async (options: {
    name: string;
    dashboardId?: string;
    groupId?: string;
    position?: number;
    isPinned?: boolean;
    color?: string;
  }) => {
    if (!userId) {
      console.warn('⚠️ User not authenticated - skipping tab creation');
      return Promise.reject(new Error('User not authenticated - cannot create tab'));
    }
    
    try {
      console.log('🆕 Creating new tab via API:', options);
      
      // Make API call to create tab - backend will generate UUID
      const response = await dashboardAPI.createTab({
        name: options.name,
        color: options.color
      }, userId);
      
      const newTab = response.tab;
      console.log('✅ Tab created successfully:', newTab);
      
      // Update local state with the new tab from backend
      const updatedTabs = state.tabs.map(tab => ({ ...tab, isActive: false }));
      
      updateState({
        tabs: [...updatedTabs, newTab],
        activeTabId: newTab.id
      });

      return newTab;
    } catch (error) {
      console.error('❌ Failed to create tab:', error);
      throw error;
    }
  }, [state, updateState, userId]);

  const closeTab = useCallback((tabId: string) => {
    const tabToClose = state.tabs.find(tab => tab.id === tabId);
    if (!tabToClose) return;

    const remainingTabs = state.tabs.filter(tab => tab.id !== tabId);
    
    // Also remove the associated dashboard
    const remainingDashboards = state.dashboards.filter(dashboard => 
      (dashboard as any).tabId !== tabId
    );
    
    console.log('🗑️ Closing tab:', { 
      tabToClose, 
      remainingTabs: remainingTabs.map(t => ({ id: t.id, name: t.name })),
      remainingDashboards: remainingDashboards.map(d => ({ id: d.id, name: d.name })),
      nextTabId: state.nextTabId
    });
    
    // If closing the active tab, activate another tab
    let newActiveTabId = state.activeTabId;
    if (tabToClose.isActive && remainingTabs.length > 0) {
      // Find the next tab in the same group, or the first available tab
      const sameGroupTabs = remainingTabs.filter(tab => tab.groupId === tabToClose.groupId);
      const nextTab = sameGroupTabs.length > 0 ? sameGroupTabs[0] : remainingTabs[0];
      newActiveTabId = nextTab.id;
    }

    // Update tabs to set new active tab
    const updatedTabs = remainingTabs.map(tab => ({
      ...tab,
      isActive: tab.id === newActiveTabId
    }));

    updateState({
      tabs: updatedTabs,
      dashboards: remainingDashboards,
      activeTabId: newActiveTabId
    });
  }, [state, updateState]);

  const activateTab = useCallback((tabId: string) => {
    const updatedTabs = state.tabs.map(tab => ({
      ...tab,
      isActive: tab.id === tabId,
      lastAccessed: tab.id === tabId ? new Date().toISOString() : tab.lastAccessed
    }));

    updateState({
      tabs: updatedTabs,
      activeTabId: tabId
    });
  }, [state, updateState]);

  const renameTab = useCallback((tabId: string, newName: string) => {
    const updatedTabs = state.tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName, isDirty: true } : tab
    );

    // Also update the corresponding dashboard name
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      const updatedDashboards = state.dashboards.map(dashboard =>
        dashboard.id === tab.dashboardId 
          ? { ...dashboard, name: newName, updated_at: new Date().toISOString() }
          : dashboard
      );

      updateState({
        tabs: updatedTabs,
        dashboards: updatedDashboards
      });
    } else {
      updateState({ tabs: updatedTabs });
    }
  }, [state, updateState]);

  const editTab = useCallback((tabId: string, newName: string, newColor?: string) => {
    const updatedTabs = state.tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName, color: newColor, isDirty: true } : tab
    );

    // Also update the corresponding dashboard name
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      const updatedDashboards = state.dashboards.map(dashboard =>
        dashboard.id === tab.dashboardId 
          ? { ...dashboard, name: newName, updated_at: new Date().toISOString() }
          : dashboard
      );

      updateState({
        tabs: updatedTabs,
        dashboards: updatedDashboards
      });
    } else {
      updateState({ tabs: updatedTabs });
    }
  }, [state, updateState]);

  const createGroup = useCallback(async (name: string, color: string = '#3b82f6') => {
    if (!userId) {
      console.warn('⚠️ User not authenticated - skipping group creation');
      return Promise.reject(new Error('User not authenticated - cannot create group'));
    }
    
    try {
      console.log('🆕 Creating new group via API:', { name, color });
      
      // Make API call to create group - backend will generate UUID
      const response = await dashboardAPI.createGroup({
        name,
        color
      }, userId);
      
      const newGroup = response.group;
      console.log('✅ Group created successfully:', newGroup);
      
      // Update local state with the new group from backend
      updateState({
        tabGroups: [...state.tabGroups, newGroup]
      });

      return newGroup;
    } catch (error) {
      console.error('❌ Failed to create group:', error);
      throw error;
    }
  }, [state, updateState, userId]);

  const editGroup = useCallback((groupId: string, newName: string, newColor: string) => {
    const updatedGroups = state.tabGroups.map(group => 
      group.id === groupId 
        ? { ...group, name: newName, color: newColor }
        : group
    );

    updateState({ tabGroups: updatedGroups });
  }, [state, updateState]);

  const addTabToGroup = useCallback((tabId: string, groupId: string) => {
    const updatedTabs = state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, groupId, isDirty: true } : tab
    );

    const updatedGroups = state.tabGroups.map(group =>
      group.id === groupId 
        ? { ...group, tabs: [...group.tabs, tabId] }
        : group
    );

    updateState({
      tabs: updatedTabs,
      tabGroups: updatedGroups
    });
  }, [state, updateState]);

  const removeTabFromGroup = useCallback((tabId: string) => {
    const updatedTabs = state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, groupId: undefined, isDirty: true } : tab
    );

    const updatedGroups = state.tabGroups.map(group => ({
      ...group,
      tabs: group.tabs.filter(id => id !== tabId)
    }));

    updateState({
      tabs: updatedTabs,
      tabGroups: updatedGroups
    });
  }, [state, updateState]);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    const updatedGroups = state.tabGroups.map(group =>
      group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
    );

    updateState({ tabGroups: updatedGroups });
  }, [state, updateState]);

  const dissolveGroup = useCallback((groupId: string, deleteDashboards: boolean) => {
    const group = state.tabGroups.find(g => g.id === groupId);
    if (!group) return;

    const groupTabs = state.tabs.filter(tab => tab.groupId === groupId);
    
    if (deleteDashboards) {
      // Delete all tabs in the group and their associated dashboards
      const remainingTabs = state.tabs.filter(tab => tab.groupId !== groupId);
      const remainingDashboards = state.dashboards.filter(dashboard => 
        !groupTabs.some(tab => tab.dashboardId === dashboard.id)
      );
      
      // Update active tab if it was deleted
      let newActiveTabId = state.activeTabId;
      if (groupTabs.some(tab => tab.id === state.activeTabId) && remainingTabs.length > 0) {
        newActiveTabId = remainingTabs[0].id;
      } else if (groupTabs.some(tab => tab.id === state.activeTabId)) {
        newActiveTabId = null;
      }

      // Update tabs to set new active tab
      const updatedTabs = remainingTabs.map(tab => ({
        ...tab,
        isActive: tab.id === newActiveTabId
      }));

      updateState({
        tabs: updatedTabs,
        dashboards: remainingDashboards,
        tabGroups: state.tabGroups.filter(g => g.id !== groupId),
        activeTabId: newActiveTabId
      });
    } else {
      // Just ungroup all tabs in the group
      const updatedTabs = state.tabs.map(tab =>
        tab.groupId === groupId ? { ...tab, groupId: undefined, isDirty: true } : tab
      );

      updateState({
        tabs: updatedTabs,
        tabGroups: state.tabGroups.filter(g => g.id !== groupId)
      });
    }
  }, [state, updateState]);

  const reorderTab = useCallback(async (tabId: string, newPosition: number) => {
    try {
      // First update local state for immediate UI feedback
      const updatedTabs = [...state.tabs];
      const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
      
      if (tabIndex === -1) return;
      
      const [movedTab] = updatedTabs.splice(tabIndex, 1);
      movedTab.position = newPosition;
      
      // Update positions of other tabs
      updatedTabs.forEach((tab, index) => {
        if (index >= newPosition) {
          tab.position = index + 1;
        } else {
          tab.position = index;
        }
      });
      
      updatedTabs.splice(newPosition, 0, movedTab);
      
      updateState({ tabs: updatedTabs });
      
      // Get the new order after reordering
      const newTabOrder = [...updatedTabs];
      const draggedTabIndex = newTabOrder.findIndex(tab => tab.id === tabId);
      if (draggedTabIndex !== -1) {
        // Remove the dragged tab from its current position
        const draggedTab = newTabOrder.splice(draggedTabIndex, 1)[0];
        // Insert it at the new position
        newTabOrder.splice(newPosition, 0, draggedTab);
      }
      
      // Extract the new order of tab IDs
      const tabIds = newTabOrder.map(tab => tab.id);
      console.log('🔄 Reordering tabs in backend:', tabIds);
      
      if (userId) {
        dashboardAPI.reorderTabs(tabIds, userId)
          .then(() => console.log('✅ Tab order updated in backend'))
          .catch(error => console.error('❌ Failed to reorder tabs in backend:', error));
      } else {
        console.warn('⚠️ User not authenticated - skipping tab reorder in backend');
      }
      
    } catch (error) {
      console.error('❌ Failed to reorder tabs in frontend:', error);
      alert('Failed to reorder tabs. Please try again.');
    }
  }, [state, updateState, userId]);

  const reorderGroup = useCallback(async (groupId: string, newPosition: number) => {
    try {
      // First update local state for immediate UI feedback
      const updatedGroups = [...state.tabGroups];
      const groupIndex = updatedGroups.findIndex(group => group.id === groupId);
      
      if (groupIndex === -1) return;
      
      const [movedGroup] = updatedGroups.splice(groupIndex, 1);
      movedGroup.position = newPosition;
      
      // Update positions of other groups
      updatedGroups.forEach((group, index) => {
        if (index >= newPosition) {
          group.position = index + 1;
        } else {
          group.position = index;
        }
      });
      
      updatedGroups.splice(newPosition, 0, movedGroup);
      
      updateState({ tabGroups: updatedGroups });
      
      // Get the new order after reordering
      const newGroupOrder = [...updatedGroups];
      const draggedGroupIndex = newGroupOrder.findIndex(group => group.id === groupId);
      if (draggedGroupIndex !== -1) {
        // Remove the dragged group from its current position
        const draggedGroup = newGroupOrder.splice(draggedGroupIndex, 1)[0];
        // Insert it at the new position
        newGroupOrder.splice(newPosition, 0, draggedGroup);
      }
      
      // Extract the new order of group IDs
      const groupIds = newGroupOrder.map(group => group.id);
      console.log('🔄 Reordering groups in backend:', groupIds);
      
      if (userId) {
        dashboardAPI.reorderGroups(groupIds, userId)
          .then(() => console.log('✅ Group order updated in backend'))
          .catch(error => console.error('❌ Failed to reorder groups in backend:', error));
      } else {
        console.warn('⚠️ User not authenticated - skipping group reorder in backend');
      }
      
    } catch (error) {
      console.error('❌ Failed to reorder groups in frontend:', error);
      alert('Failed to reorder groups. Please try again.');
    }
  }, [state, updateState, userId]);

  // Get current active tab and dashboard
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const activeDashboard = activeTab 
    ? state.dashboards.find(dashboard => (dashboard as any).tabId === activeTab.id)
    : null;
    

  // Update dashboard tiles
  const updateDashboardTiles = useCallback((dashboardId: string, tiles: UnifiedTile[]) => {
    const updatedDashboards = state.dashboards.map(dashboard =>
      dashboard.id === dashboardId 
        ? { ...dashboard, tiles, updated_at: new Date().toISOString() }
        : dashboard
    );

    updateState({ dashboards: updatedDashboards });
  }, [state.dashboards, updateState]);

  // Get tabs by group
  const getTabsByGroup = useCallback(() => {
    const groupedTabs: { [groupId: string]: DashboardTab[] } = {};
    const ungroupedTabs: DashboardTab[] = [];

    state.tabs.forEach(tab => {
      if (tab.groupId) {
        if (!groupedTabs[tab.groupId]) {
          groupedTabs[tab.groupId] = [];
        }
        groupedTabs[tab.groupId].push(tab);
      } else {
        ungroupedTabs.push(tab);
      }
    });

    return { groupedTabs, ungroupedTabs };
  }, [state.tabs]);

  return {
    // State
    tabs: state.tabs,
    tabGroups: state.tabGroups,
    activeTab,
    activeDashboard,
    activeTabId: state.activeTabId,
    
    // Actions
    createTab,
    closeTab,
    activateTab,
    renameTab,
    editTab,
    createGroup,
    editGroup,
    addTabToGroup,
    removeTabFromGroup,
    toggleGroupCollapse,
    dissolveGroup,
    reorderTab,
    reorderGroup,
    updateDashboardTiles,
    
    // Utilities
    getTabsByGroup,
    updateState
  };
};
