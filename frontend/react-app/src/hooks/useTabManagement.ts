import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardTab, TabManagementState, UnifiedTile } from '../types/dashboardTypes';
import { robustStorage, isIncognitoMode } from '../utils/storageUtils';
import { dashboardAPI, DashboardConfig } from '../services/api';

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
    last_updated: new Date().toISOString(),
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
          tiles: tab.tiles || [],
          layout: tab.layout || 'grid',
          created_at: tab.created_at || new Date().toISOString(),
          updated_at: tab.updated_at || new Date().toISOString()
        })),
        tabGroups: tabState.tabGroups.map(group => ({
          id: group.id,
          name: group.name,
          color: group.color || '#8b5cf6',
          tabs: group.tabs || group.tabIds || [],
          tabIds: group.tabIds || group.tabs || [],
          created_at: group.created_at || new Date().toISOString()
        })),
        dashboards: (tabState.dashboards || []).map(dashboard => ({
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
        tabOrder: tabState.tabs.map(tab => tab.id),
        groupOrder: tabState.tabGroups.map(group => group.id),
        nextTabId: tabState.nextTabId || 1,
        nextGroupId: tabState.nextGroupId || 1,
        last_updated: new Date().toISOString()
      };
      
      await dashboardAPI.updateDashboard(dashboardConfig as any, userId || '');
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
          console.log('TabGroups in dbConfig:', dbConfig.tabGroups);
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
            
            // Debug: Log processed state
            console.log('🔍 PROCESSED STATE DEBUG START');
            console.log('Processed tabGroups:', dbState.tabGroups);
            console.log('🔍 PROCESSED STATE DEBUG END');
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
    const defaultDashboard = {
      id: 'dashboard-1',
      name: 'Main Dashboard',
      tiles: [],
      layout: 'grid' as 'grid' | 'list' | 'custom',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isDefault: true,
      isPinned: false
    };

    const defaultTab: DashboardTab = {
      id: 'tab-1',
      name: 'Main Dashboard',
      color: '#3b82f6',
      isPinned: false,
      tiles: [],
      layout: 'grid',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return {
      tabs: [defaultTab],
      tabGroups: [],
      activeTabId: 'tab-1',
      last_updated: new Date().toISOString(),
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
      const updatedTabs = state.tabs;
      
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

  const closeTab = useCallback(async (tabId: string) => {
    const tabToClose = state.tabs.find(tab => tab.id === tabId);
    if (!tabToClose) {
      console.log('❌ Tab not found for closing:', tabId);
      return;
    }

    if (!userId) {
      console.error('❌ User ID required for tab deletion');
      return;
    }

    console.log('🗑️ Closing tab:', { 
      tabToClose: { id: tabToClose.id, name: tabToClose.name },
      userId 
    });

    try {
      // Call backend API to delete the tab
      await dashboardAPI.deleteTab(tabId, userId);
      console.log('✅ Tab successfully deleted from backend');

      // Update local state after successful backend deletion
      const remainingTabs = state.tabs.filter(tab => tab.id !== tabId);
      
      // Also remove the associated dashboard
      const remainingDashboards = (state.dashboards || []).filter(dashboard => 
        (dashboard as any).tabId !== tabId
      );
      
      // Remove the tab from any groups it belongs to
      const updatedGroups = state.tabGroups.map(group => ({
        ...group,
        tabs: (group.tabs || group.tabIds || []).filter(id => id !== tabId),
        tabIds: (group.tabIds || group.tabs || []).filter(id => id !== tabId)
      }));
      
      // If closing the active tab, activate another tab
      let newActiveTabId = state.activeTabId;
      if (tabToClose.id === state.activeTabId && remainingTabs.length > 0) {
        // Find the next tab in the same group, or the first available tab
        const sameGroupTabs = remainingTabs;
        const nextTab = sameGroupTabs.length > 0 ? sameGroupTabs[0] : remainingTabs[0];
        newActiveTabId = nextTab.id;
      }

      // Update tabs to set new active tab
      const updatedTabs = remainingTabs;

      updateState({
        tabs: updatedTabs,
        dashboards: remainingDashboards,
        tabGroups: updatedGroups,
        activeTabId: newActiveTabId
      });

      console.log('✅ Tab successfully removed from local state');

    } catch (error) {
      console.error('❌ Failed to delete tab from backend:', error);
      // Don't update local state if backend deletion failed
      throw error;
    }
  }, [state, updateState, userId]);

  const activateTab = useCallback((tabId: string) => {
    const updatedTabs = state.tabs;

    updateState({
      tabs: updatedTabs,
      activeTabId: tabId
    });
  }, [state, updateState]);

  const renameTab = useCallback((tabId: string, newName: string) => {
    const updatedTabs = state.tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName } : tab
    );

    updateState({ tabs: updatedTabs });
  }, [state, updateState]);

  const editTab = useCallback((tabId: string, newName: string, newColor?: string) => {
    const updatedTabs = state.tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName, color: newColor || tab.color } : tab
    );

    updateState({ tabs: updatedTabs });
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
    const updatedGroups = state.tabGroups.map(group =>
      group.id === groupId 
        ? { ...group, tabs: [...(group.tabs || group.tabIds || []), tabId] }
        : group
    );

    updateState({
      tabGroups: updatedGroups
    });
  }, [state.tabGroups, updateState]);

  const removeTabFromGroup = useCallback((tabId: string) => {
    const updatedGroups = state.tabGroups.map(group => ({
      ...group,
      tabs: (group.tabs || group.tabIds || []).filter(id => id !== tabId)
    }));

    updateState({
      tabGroups: updatedGroups
    });
  }, [state.tabGroups, updateState]);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    const updatedGroups = state.tabGroups.map(group =>
      group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
    );

    updateState({ tabGroups: updatedGroups });
  }, [state, updateState]);

  const dissolveGroup = useCallback(async (groupId: string, deleteDashboards: boolean) => {
    const group = state.tabGroups.find(g => g.id === groupId);
    if (!group) return;

    if (!userId) {
      console.error('❌ User ID required for group operations');
      return;
    }

    const groupTabs = state.tabs.filter(tab => (group.tabs || group.tabIds || []).includes(tab.id));
    
    if (deleteDashboards) {
      console.log('🗑️ Deleting group and all tabs:', { groupId, groupName: group.name, tabCount: groupTabs.length });
      
      try {
        // Delete each tab in the group from backend
        for (const tab of groupTabs) {
          await dashboardAPI.deleteTab(tab.id, userId);
          console.log(`✅ Deleted tab: ${tab.name} (${tab.id})`);
        }

        // Delete the group from backend
        await dashboardAPI.deleteGroup(groupId, userId);
        console.log(`✅ Deleted group: ${group.name} (${groupId})`);

        // Update local state after successful backend deletion
        const remainingTabs = state.tabs.filter(tab => !(group.tabs || group.tabIds || []).includes(tab.id));
        
        // Update active tab if it was deleted
        let newActiveTabId = state.activeTabId;
        if (groupTabs.some(tab => tab.id === state.activeTabId) && remainingTabs.length > 0) {
          newActiveTabId = remainingTabs[0].id;
        } else if (groupTabs.some(tab => tab.id === state.activeTabId)) {
          newActiveTabId = null;
        }

        updateState({
          tabs: remainingTabs,
          tabGroups: state.tabGroups.filter(g => g.id !== groupId),
          activeTabId: newActiveTabId
        });

        console.log('✅ Group and all tabs successfully deleted from backend and local state');

      } catch (error) {
        console.error('❌ Failed to delete group and tabs from backend:', error);
        throw error;
      }
    } else {
      // Ungroup all tabs but keep the group (empty group) - no backend call needed
      console.log('🔄 Ungrouping all tabs from group:', { groupId, groupName: group.name });
      
      const updatedGroups = state.tabGroups.map(g => 
        g.id === groupId 
          ? { ...g, tabs: [], tabIds: [] }
          : g
      );

      updateState({
        tabGroups: updatedGroups
      });
    }
  }, [state.tabs, state.tabGroups, state.activeTabId, updateState, userId]);

  // Move tab between groups
  const moveTabToGroup = useCallback((tabId: string, targetGroupId: string) => {
    // Remove tab from all groups first
    const updatedGroups = state.tabGroups.map(group => ({
      ...group,
      tabs: (group.tabs || group.tabIds || []).filter(id => id !== tabId),
      tabIds: (group.tabIds || group.tabs || []).filter(id => id !== tabId)
    }));

    // Add tab to target group
    const finalGroups = updatedGroups.map(group =>
      group.id === targetGroupId
        ? { 
            ...group, 
            tabs: [...(group.tabs || []), tabId],
            tabIds: [...(group.tabIds || []), tabId]
          }
        : group
    );

    updateState({
      tabGroups: finalGroups
    });
  }, [state.tabGroups, updateState]);

  const reorderTab = useCallback(async (tabId: string, newPosition: number) => {
    try {
      // First update local state for immediate UI feedback
      const updatedTabs = [...state.tabs];
      const tabIndex = updatedTabs.findIndex(tab => tab.id === tabId);
      
      if (tabIndex === -1) return;
      
      const [movedTab] = updatedTabs.splice(tabIndex, 1);
      updatedTabs.splice(newPosition, 0, movedTab);
      
      // Update state - this will trigger automatic debounced save
      updateState({ tabs: updatedTabs });
      
      console.log('🔄 Tab reordered locally, will be saved automatically via debounced save');
      
    } catch (error) {
      console.error('❌ Failed to reorder tabs in frontend:', error);
      alert('Failed to reorder tabs. Please try again.');
    }
  }, [state.tabs, updateState]);

  const reorderGroup = useCallback(async (groupId: string, newPosition: number) => {
    try {
      // First update local state for immediate UI feedback
      const updatedGroups = [...state.tabGroups];
      const groupIndex = updatedGroups.findIndex(group => group.id === groupId);
      
      if (groupIndex === -1) return;
      
      const [movedGroup] = updatedGroups.splice(groupIndex, 1);
      updatedGroups.splice(newPosition, 0, movedGroup);
      
      // Update state - this will trigger automatic debounced save
      updateState({ tabGroups: updatedGroups });
      
      console.log('🔄 Group reordered locally, will be saved automatically via debounced save');
      
    } catch (error) {
      console.error('❌ Failed to reorder groups in frontend:', error);
      alert('Failed to reorder groups. Please try again.');
    }
  }, [state.tabGroups, updateState]);

  // Get current active tab and dashboard
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const activeDashboard = activeTab 
    ? (state.dashboards || []).find(dashboard => (dashboard as any).tabId === activeTab.id)
    : null;
    

  // Update dashboard tiles (legacy function - deprecated)
  const updateDashboardTiles = useCallback((dashboardId: string, tiles: UnifiedTile[]) => {
    const updatedDashboards = (state.dashboards || []).map(dashboard =>
      dashboard.id === dashboardId 
        ? { ...dashboard, tiles, updated_at: new Date().toISOString() }
        : dashboard
    );

    updateState({ dashboards: updatedDashboards });
  }, [state.dashboards, updateState]);

  // Update tiles for a specific tab
  const updateTabTiles = useCallback((tabId: string, tiles: UnifiedTile[] | ((currentTiles: UnifiedTile[]) => UnifiedTile[])) => {
    // Use functional update to get CURRENT state, not stale closure
    setState(prevState => {
      const updatedTabs = prevState.tabs.map(tab => {
        if (tab.id === tabId) {
          // Support both direct array and function that receives current tiles
          const newTiles = typeof tiles === 'function' 
            ? tiles(tab.tiles || [])  // Pass current tiles to function
            : tiles;
          
          return { ...tab, tiles: newTiles, updated_at: new Date().toISOString() };
        }
        return tab;
      });
      
      const newState = { ...prevState, tabs: updatedTabs };
      saveToStorage(newState);
      debouncedSaveToDatabase(newState);
      return newState;
    });
  }, [saveToStorage, debouncedSaveToDatabase]);

  // Get tabs by group
  const getTabsByGroup = useCallback(() => {
    const groupedTabs: { [groupId: string]: DashboardTab[] } = {};
    const ungroupedTabs: DashboardTab[] = [];

    // Group tabs by their group membership
    state.tabGroups.forEach(group => {
      // Handle both 'tabs' (array of tab IDs) and 'tabIds' for backward compatibility
      const groupTabIds = group.tabs || group.tabIds || [];
      groupedTabs[group.id] = state.tabs.filter(tab => groupTabIds.includes(tab.id));
    });
    
    // Find ungrouped tabs
    const groupedTabIds = new Set(state.tabGroups.flatMap(group => group.tabs || group.tabIds || []));
    state.tabs.forEach(tab => {
      if (!groupedTabIds.has(tab.id)) {
        ungroupedTabs.push(tab);
      }
    });

    return { groupedTabs, ungroupedTabs };
  }, [state.tabs, state.tabGroups]);

  // Reload data from database
  const reloadFromDatabase = useCallback(async () => {
    if (!userId) {
      console.warn('No userId provided, cannot reload from database');
      return;
    }

    try {
      console.log('🔄 Reloading data from database...');
      const dbResponse = await dashboardAPI.getDashboard(userId);
      const dbConfig: DashboardConfig = dbResponse.dashboard_config;
      
      // Convert DashboardConfig to TabManagementState
      let dbState: TabManagementState;
      
      if ('tabs' in dbConfig) {
        // New simplified format: tabs contain tiles directly
        dbState = {
          tabs: (dbConfig.tabs as any[]).map((tab: any) => ({
            id: tab.id,
            name: tab.name,
            color: tab.color || '#3b82f6',
            isPinned: tab.isPinned || false,
            tiles: tab.tiles || [],
            layout: tab.layout || 'grid',
            created_at: tab.created_at || new Date().toISOString(),
            updated_at: tab.updated_at || new Date().toISOString()
          })),
          tabGroups: (dbConfig.tabGroups || []).map((group: any) => ({
            id: group.id,
            name: group.name,
            color: group.color || '#8b5cf6',
            tabs: group.tabs || group.tabIds || [],
            tabIds: group.tabIds || group.tabs || [],
            collapsed: group.collapsed || false,
            position: group.position || 0,
            created_at: group.created_at || new Date().toISOString()
          })),
          activeTabId: dbConfig.activeTabId || null,
          last_updated: dbConfig.last_updated || new Date().toISOString(),
          dashboards: [], // Legacy field - not used in new structure
          nextTabId: 1, // Will be calculated from existing tabs
          nextGroupId: 1 // Will be calculated from existing groups
        };

        // Sort tabs and groups according to their order arrays
        if (dbConfig.tabOrder && Array.isArray(dbConfig.tabOrder)) {
          dbState.tabs.sort((a, b) => {
            const aIndex = dbConfig.tabOrder!.indexOf(a.id);
            const bIndex = dbConfig.tabOrder!.indexOf(b.id);
            return aIndex - bIndex;
          });
        }

        if (dbConfig.groupOrder && Array.isArray(dbConfig.groupOrder)) {
          dbState.tabGroups.sort((a, b) => {
            const aIndex = dbConfig.groupOrder!.indexOf(a.id);
            const bIndex = dbConfig.groupOrder!.indexOf(b.id);
            return aIndex - bIndex;
          });
        }

        setState(dbState);
        saveToStorage(dbState);
        console.log('✅ Successfully reloaded data from database');
      }
    } catch (error) {
      console.error('Failed to reload from database:', error);
    }
  }, [userId]);

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
    moveTabToGroup,
    reorderTab,
    reorderGroup,
    updateDashboardTiles,
    updateTabTiles,
    
    // Utilities
    getTabsByGroup,
    updateState,
    reloadFromDatabase
  };
};
