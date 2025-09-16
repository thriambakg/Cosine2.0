import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Box, 
  Typography, 
  Container,
  Alert,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Card,
  CardActionArea,
  Chip,
  IconButton
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { 
  Add as AddIcon, 
  Close as CloseIcon,
  TrendingUp as TrendingUpIcon,
  AccountBalance as AccountBalanceIcon,
  AutoAwesome as AutoAwesomeIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { loadConfig, validateConfig, getConfig } from '../config/configLoader';
import { logApiConfig } from '../config/api';
import GridDashboard from '../components/GridDashboard';
import { getDefaultTileSize } from '../utils/tileConfig';
// import { safeLoadDashboard } from '../utils/dashboardMigration';
import AddCryptoModal from '../components/AddCryptoModal';
import { dashboardAPI } from '../services/api';
import AddStockModal from '../components/AddStockModal';
import DashboardTabBar from '../components/DashboardTabBar';
import NewTabDialog from '../components/NewTabDialog';
import NewGroupDialog from '../components/NewGroupDialog';

// Import tab management hook and types
import { useTabManagement } from '../hooks/useTabManagement';
import { UnifiedTile, GridPosition } from '../types/dashboardTypes';

// Custom styled components for Wall Street chic
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Box
    sx={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #374151',
      borderRadius: '0px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      ...sx
    }}
    {...props}
  >
    {children}
  </Box>
);


// Tile type definitions for the selection interface
interface TileTypeDefinition {
  id: string;
  name: string;
  description: string;
  category: 'crypto' | 'stocks' | 'portfolio' | 'custom' | 'chat';
  icon: React.ReactNode;
  color: string;
  isAvailable: boolean;
  placeholder?: boolean; // For tiles not yet implemented
}

const tileTypes: TileTypeDefinition[] = [
  {
    id: 'crypto',
    name: 'Cryptocurrency',
    description: 'Track crypto prices, charts, and market data',
    category: 'crypto',
    icon: <TrendingUpIcon />,
    color: '#f59e0b',
    isAvailable: true,
    placeholder: false
  },
  {
    id: 'stock',
    name: 'Stock Analysis',
    description: 'Monitor stock prices, analysis, and alerts',
    category: 'stocks',
    icon: <AccountBalanceIcon />,
    color: '#10b981',
    isAvailable: true,
    placeholder: false
  },
  {
    id: 'portfolio',
    name: 'Portfolio Overview',
    description: 'View portfolio performance and allocation',
    category: 'portfolio',
    icon: <SettingsIcon />,
    color: '#3b82f6',
    isAvailable: true,
    placeholder: true
  },
  {
    id: 'custom',
    name: 'Custom Content',
    description: 'Create custom tiles with your own content',
    category: 'custom',
    icon: <AutoAwesomeIcon />,
    color: '#8b5cf6',
    isAvailable: true,
    placeholder: true
  },
  {
    id: 'chat_generated',
    name: 'AI Generated',
    description: 'Let AI create tiles based on your needs',
    category: 'chat',
    icon: <ChatIcon />,
    color: '#ef4444',
    isAvailable: true,
    placeholder: true
  }
];

const UnifiedDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Tab management - only initialize when user is authenticated
  const tabManagement = useTabManagement({ 
    userId: user?.id || undefined 
  });
  
  const {
    tabs,
    tabGroups,
    activeDashboard,
    activeTabId,
    createTab,
    closeTab,
    activateTab,
    editTab,
    createGroup,
    editGroup,
    addTabToGroup,
    removeTabFromGroup,
    dissolveGroup,
    moveTabToGroup,
    reorderTab,
    reorderGroup,
    // updateDashboardTiles: updateTabDashboardTiles, // Removed - using tab-based system
    updateTabTiles,
    getTabsByGroup,
    reloadFromDatabase
  } = tabManagement;

  // Derive activeTab from activeTabId
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Handle hot reload scenario where user might be temporarily undefined
  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      console.warn('🚨 No user found during dashboard load - this might be due to hot reload');
      // Refresh the page to properly reinitialize authentication
      console.log('🔄 Refreshing page to reinitialize authentication...');
      window.location.reload();
    }
  }, [user]);

  // Multi-step tile addition state
  const [addTileStep, setAddTileStep] = useState<'closed' | 'type-selection' | 'configuration'>('closed');
  const [selectedTileType, setSelectedTileType] = useState<TileTypeDefinition | null>(null);
  const [tileConfig, setTileConfig] = useState<any>({});

  // Dialog states
  const [cryptoModalOpen, setCryptoModalOpen] = useState(false);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);

  // Debounced save functionality (from crypto page)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<UnifiedTile[] | null>(null);

  // Removed old tile state variables - now using tab-based system via useTabManagement
  
  // Removed old state corruption tracking - no longer needed with tab-based system
  
  // Get current dashboard ID (either from active dashboard or default)
  const currentDashboardId = activeDashboard?.id || 'main';

  // Function to find the next available position for a new tile
  const findNextAvailablePosition = (tileSize: { width: number; height: number } = { width: 4, height: 4 }) => {
    const GRID_COLUMNS = 12; // Match the GridDashboard constant
    const MAX_ROWS = 50; // Match the GridDashboard constant for flexibility
    
    // Get all existing tiles for the current tab (not dashboard)
    const existingTiles = activeTab?.tiles || [];
    
    // If no existing tiles, place at the top-left (origin)
    if (existingTiles.length === 0) {
      console.log(`📍 No existing tiles, placing at origin:`, { x: 0, y: 0 });
      return { x: 0, y: 0 };
    }
    
    // Create a 2D grid to track occupied positions
    // This is more efficient than a Set for large grids
    const grid = Array(MAX_ROWS).fill(null).map(() => Array(GRID_COLUMNS).fill(false));
    
    // Mark occupied positions
    existingTiles.forEach(tile => {
      const pos = tile.gridPosition || { x: 0, y: 0 };
      const size = tile.gridSize || getDefaultTileSize(tile.type);
      
      // Mark all cells occupied by this tile
      for (let x = pos.x; x < pos.x + size.width && x < GRID_COLUMNS; x++) {
        for (let y = pos.y; y < pos.y + size.height && y < MAX_ROWS; y++) {
          grid[y][x] = true;
        }
      }
    });
    
    // Intelligent placement algorithm: Find the nearest available space to origin (0,0)
    // Use a spiral search pattern starting from origin
    const directions = [
      { dx: 1, dy: 0 },  // Right
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 0, dy: -1 }  // Up
    ];
    
    // Check if a position is available for the given tile size
    const isPositionAvailable = (x: number, y: number, width: number, height: number): boolean => {
      if (x < 0 || y < 0 || x + width > GRID_COLUMNS || y + height > MAX_ROWS) {
        return false;
      }
      
      for (let dx = 0; dx < width; dx++) {
        for (let dy = 0; dy < height; dy++) {
          if (grid[y + dy][x + dx]) {
            return false;
          }
        }
      }
      return true;
    };
    
    // Spiral search from origin - this finds the nearest available space
    let x = 0, y = 0;
    let step = 1;
    let directionIndex = 0;
    let stepsInDirection = 0;
    
    while (x < GRID_COLUMNS && y < MAX_ROWS) {
      // Check current position
      if (isPositionAvailable(x, y, tileSize.width, tileSize.height)) {
        console.log(`📍 Found nearest available position:`, { x, y, tileSize, distance: Math.abs(x) + Math.abs(y) });
        return { x, y };
      }
      
      // Move in current direction
      const direction = directions[directionIndex];
      x += direction.dx;
      y += direction.dy;
      stepsInDirection++;
      
      // Change direction when we've taken enough steps
      if (stepsInDirection === step) {
        stepsInDirection = 0;
        directionIndex = (directionIndex + 1) % 4;
        
        // Increase step size every 2 direction changes (completes a square)
        if (directionIndex === 0 || directionIndex === 2) {
          step++;
        }
      }
    }
    
    // Fallback: Linear search if spiral fails (shouldn't happen with reasonable grid size)
    for (let y = 0; y < MAX_ROWS; y++) {
      for (let x = 0; x <= GRID_COLUMNS - tileSize.width; x++) {
        if (isPositionAvailable(x, y, tileSize.width, tileSize.height)) {
          console.log(`📍 Fallback position found:`, { x, y, tileSize });
          return { x, y };
        }
      }
    }
    
    // Ultimate fallback: place at origin
    console.log(`📍 No space found, placing at origin:`, { x: 0, y: 0 });
    return { x: 0, y: 0 };
  };
  
  // Get tiles for current dashboard and ensure unique IDs
  const getTilesWithUniqueIds = (tiles: UnifiedTile[]) => {
    const seenIds = new Set<string>();
    return tiles.map(tile => {
      let uniqueId = tile.id;
      let counter = 1;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${tile.id}_${counter}`;
        counter++;
      }
      seenIds.add(uniqueId);
      return { ...tile, id: uniqueId };
    });
  };

  // Get current tiles from the active tab
  const getCurrentDashboardTiles = () => {
    if (activeTab) {
      console.log('🔍 getCurrentDashboardTiles (tab-based):', {
        activeTabId: activeTab.id,
        activeTabName: activeTab.name,
        activeTabTiles: (activeTab.tiles || []).length,
        activeTabTilesData: activeTab.tiles || []
      });
      
      return activeTab.tiles || [];
    } else {
      console.log('🔍 getCurrentDashboardTiles: No active tab found');
      return [];
    }
  };
  
  const tiles = getTilesWithUniqueIds(getCurrentDashboardTiles());
  
  // Debug: Log tiles being rendered
  console.log('🎯 TILES BEING RENDERED DEBUG START');
  console.log('Number of tiles:', tiles.length);
  tiles.forEach(tile => {
    console.log(`Rendering tile ${tile.id}:`, {
      gridPosition: tile.gridPosition,
      gridSize: tile.gridSize,
      position: tile.position,
      size: tile.size
    });
  });
  console.log('🎯 TILES BEING RENDERED DEBUG END');


  // Tab management handlers
  const handleCreateTab = () => {
    setNewTabDialogOpen(true);
  };

  const handleCreateNewTab = (name: string, groupId?: string, isPinned?: boolean, color?: string) => {
    createTab({ name, groupId, isPinned, color });
    setNewTabDialogOpen(false);
  };

  const handleCreateGroup = () => {
    setNewGroupDialogOpen(true);
  };

  const handleCreateNewGroup = (name: string, color: string) => {
    createGroup(name, color);
    setNewGroupDialogOpen(false);
  };

  const handleTabPin = (tabId: string) => {
    // TODO: Implement pin functionality
    console.log('Pin tab:', tabId);
  };

  const handleTabUnpin = (tabId: string) => {
    // TODO: Implement unpin functionality
    console.log('Unpin tab:', tabId);
  };


  // Load configuration and validate on component mount
  useEffect(() => {
    const initializeConfig = async () => {
      try {
        await loadConfig();
        const validation = validateConfig();
        setConfigValid(validation.isValid);
        setConfigErrors(validation.errors);
        
        logApiConfig();
        
        console.log('🔧 Configuration Status:', {
          isValid: validation.isValid,
          errors: validation.errors,
          apiUrl: getConfig('apiGatewayUrl')
        });
      } catch (error) {
        console.error('❌ Failed to load configuration:', error);
        setConfigValid(false);
        setConfigErrors(['Failed to load configuration']);
      }
    };

    initializeConfig();
  }, []);

  // Load user's dashboard configuration on mount
  useEffect(() => {
    if (configValid) {
      loadUserDashboard();
    }
  }, [configValid]);

  // Save to localStorage immediately for persistence
  const saveToLocalStorage = useCallback((updatedTiles: UnifiedTile[]) => {
    try {
      localStorage.setItem('unified-dashboard-tiles', JSON.stringify(updatedTiles));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, []);

  // Load from localStorage with migration support
  const loadFromLocalStorage = useCallback((): UnifiedTile[] | null => {
    try {
      const saved = localStorage.getItem('unified-dashboard-tiles');
      if (!saved) return null;
      
      const data = JSON.parse(saved);
      
      // Check if this is an old format that needs migration
      if (Array.isArray(data)) {
        // Old format: array of tiles
        console.log('🔄 Detected old localStorage format, migrating...');
        const migratedTiles = data.map((tile: any) => {
          const tileConfig = getDefaultTileSize(tile.type || 'custom');
          return {
            ...tile,
            gridPosition: tile.gridPosition || { x: 0, y: 0 },
            gridSize: tile.gridSize || tileConfig,
            dashboard_id: tile.dashboard_id || 'main',
            displayOptions: tile.displayOptions || {},
            autoRefresh: tile.autoRefresh || false,
            isPinned: tile.isPinned || false,
          };
        });
        
        // Save migrated format
        localStorage.setItem('unified-dashboard-tiles', JSON.stringify(migratedTiles));
        console.log('✅ Migration completed');
        
        return migratedTiles;
      }
      
      return data;
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      
      // Try to recover from corrupted data
      try {
        console.log('🔄 Attempting to recover from corrupted localStorage...');
        localStorage.removeItem('unified-dashboard-tiles');
        console.log('✅ Cleared corrupted data');
      } catch (cleanupError) {
        console.error('Failed to clear corrupted data:', cleanupError);
      }
      
      return null;
    }
  }, []);

  // Removed old tile loading useEffect - now using tab-based system via useTabManagement

  // Removed old override timeout cleanup - no longer needed with tab-based system

  // Removed debounced save - now using tab-based system via useTabManagement

  // Removed safeUpdateDashboardTiles - now using tab-based system via useTabManagement

  // Removed updateDashboardTilesFallback - now using tab-based system via useTabManagement

  // Removed updateDashboardTiles - now using tab-based system via useTabManagement

  // Save immediately on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingSaveRef.current) {
        saveUserDashboard(pendingSaveRef.current);
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

  const loadUserDashboard = async () => {
    try {
      setIsLoading(true);
      
      // Load tiles for the active dashboard
      if (activeDashboard) {
        // First try to load from localStorage for immediate persistence
        const cachedTiles = loadFromLocalStorage();
        if (cachedTiles && cachedTiles.length > 0) {
          // Filter tiles for the current dashboard
          const dashboardTiles = cachedTiles.filter(tile => tile.dashboard_id === activeDashboard.id);
          console.log(`Loaded ${dashboardTiles.length} tiles for dashboard ${activeDashboard.id} from localStorage`);
        } else {
          console.log('No cached tiles found for dashboard:', activeDashboard.id);
        }
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveUserDashboard = async (updatedTiles: UnifiedTile[]) => {
    try {
      saveToLocalStorage(updatedTiles);
      
      // Create dashboard config for the current dashboard
      const dashboardConfig = {
        id: activeDashboard?.id || 'main',
        name: activeDashboard?.name || 'Dashboard',
        tiles: updatedTiles,
        layout: 'grid' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDefault: false
      };
      
      console.log('💾 Saving dashboard configuration to backend:', dashboardConfig);
      
      await dashboardAPI.updateDashboard(dashboardConfig as any, user?.id || '');
      console.log('Successfully saved dashboard configuration to backend');
      
    } catch (error) {
      console.error('❌ Error saving dashboard to backend:', error);
      // Continue to work with localStorage even if backend fails
    }
  };

  // Enhanced tile addition flow
  const handleAddTileClick = () => {
    // Remove focus from the FAB button to prevent aria-hidden warning
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    setAddTileStep('type-selection');
    setSelectedTileType(null);
    setTileConfig({});
  };

  const handleTileTypeSelect = (tileType: TileTypeDefinition) => {
    // Remove focus from any active element to prevent aria-hidden warning
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    // If crypto tile, use the existing AddCryptoModal
    if (tileType.id === 'crypto') {
      setCryptoModalOpen(true);
      setAddTileStep('closed');
      return;
    }
    
    // If stock tile, use the new AddStockModal
    if (tileType.id === 'stock') {
      setStockModalOpen(true);
      setAddTileStep('closed');
      return;
    }
    
    // For other tile types, use the multi-step flow
    setSelectedTileType(tileType);
    setAddTileStep('configuration');
    
    // Initialize default config based on tile type
    const defaultConfig = getDefaultTileConfig(tileType.id);
    setTileConfig(defaultConfig);
  };

  const getDefaultTileConfig = (tileTypeId: string) => {
    switch (tileTypeId) {
      case 'stock':
        return {
          symbol: '',
          timeframe: '1d',
          displayOptions: {
            showPrice: true,
            show24hChange: true,
            showAnnualReturn: true,
            showVolatility: true,
            showChart: true,
          },
          autoRefresh: false
        };
      case 'portfolio':
        return {
          name: 'My Portfolio',
          displayOptions: {
            showAllocation: true,
            showPerformance: true,
            showRisk: true,
            showChart: true,
          }
        };
      case 'custom':
        return {
          title: '',
          content: '',
          displayOptions: {
            showTitle: true,
            showContent: true,
            showTimestamp: true,
          }
        };
      case 'chat_generated':
        return {
          prompt: '',
          displayOptions: {
            showPrompt: true,
            showResponse: true,
            showTimestamp: true,
          }
        };
      default:
        return {};
    }
  };

  const handleTileConfigSubmit = async () => {
    if (!selectedTileType || !activeTab) return;

    try {
      // Create tile data for the API
      const tileData = {
        type: selectedTileType.id as "crypto" | "custom" | "stock" | "placeholder",
        title: tileConfig.title || tileConfig.symbol || tileConfig.name || selectedTileType.name,
        symbol: tileConfig.symbol,
        timeframe: tileConfig.timeframe,
        name: tileConfig.name, // For portfolio tiles
        content: tileConfig.content, // For custom tiles
        prompt: tileConfig.prompt, // For chat_generated tiles
        displayOptions: tileConfig.displayOptions || {},
        autoRefresh: tileConfig.autoRefresh || false,
        gridPosition: findNextAvailablePosition(getDefaultTileSize(selectedTileType.id as any)),
        gridSize: getDefaultTileSize(selectedTileType.id as any)
      };

      // Call the backend API to create the tile
      await dashboardAPI.addTile(tileData, activeTab.id, user?.id);
      
      // Add a small delay to ensure the database has been updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reload from database to get the updated state
      await reloadFromDatabase();

      // Reset state
      setAddTileStep('closed');
      setSelectedTileType(null);
      setTileConfig({});
    } catch (error) {
      console.error('Failed to create tile:', error);
    }
  };

  // Handle crypto tile addition using the existing AddCryptoModal
  const handleAddCryptoTile = async (cryptoData: any) => {
    console.log('handleAddCryptoTile called with:', cryptoData);
    console.log('activeTab:', activeTab);
    
    if (!activeTab) {
      console.warn('No active tab found, cannot add tile');
      return;
    }
    
    if (!user?.id) {
      console.warn('No user ID found, cannot add tile');
      return;
    }
    
    const newTile = {
      type: 'crypto' as const,
      symbol: cryptoData.symbol,
      timeframe: cryptoData.timeframe,
      title: cryptoData.symbol,
      displayOptions: cryptoData.displayOptions,
      autoRefresh: cryptoData.autoRefresh,
      isPinned: false,
      gridPosition: findNextAvailablePosition(getDefaultTileSize('crypto')),
      gridSize: getDefaultTileSize('crypto'),
    };

    try {
      console.log('Creating tile via API:', newTile);
      console.log('Tab ID:', activeTab.id);
      console.log('User ID:', user.id);
      const response = await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      console.log('Tile created successfully:', response);
      
      // Add a small delay to ensure the database has been updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reload data from database to get the updated tiles
      await reloadFromDatabase();
      console.log('✅ Data reloaded from database after tile creation');
      
    } catch (error: any) {
      console.error('Failed to create tile:', error);
      console.error('Error details:', error.response?.data);
      console.error('Request config:', error.config);
      // TODO: Show error message to user
    }
  };

  // Handle stock tile addition using the new AddStockModal
  const handleAddStockTile = async (stockData: any) => {
    console.log('handleAddStockTile called with:', stockData);
    console.log('activeTab:', activeTab);
    
    if (!activeTab) {
      console.warn('No active tab found, cannot add tile');
      return;
    }
    
    if (!user?.id) {
      console.warn('No user ID found, cannot add tile');
      return;
    }
    
    const newTile = {
      type: 'stock' as const,
      symbol: stockData.symbol,
      timeframe: stockData.timeframe,
      title: stockData.symbol,
      displayOptions: stockData.displayOptions,
      autoRefresh: stockData.autoRefresh,
      isPinned: false,
      gridPosition: findNextAvailablePosition(getDefaultTileSize('stock')),
      gridSize: getDefaultTileSize('stock'),
    };

    try {
      console.log('Creating tile via API:', newTile);
      const response = await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      console.log('Tile created successfully:', response);
      
      // Reload data from database to get the updated tiles
      await reloadFromDatabase();
      console.log('✅ Data reloaded from database after tile creation');
      
    } catch (error) {
      console.error('Failed to create tile:', error);
      // TODO: Show error message to user
    }
  };

  const getExistingSymbols = () => tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol));

  const handleRemoveTile = (id: string) => {
    if (activeTab) {
      const updatedTiles = (activeTab.tiles || []).filter((tile: any) => tile.id !== id);
      updateTabTiles(activeTab.id, updatedTiles);
    } else {
      console.warn('No active tab found, cannot remove tile');
    }
  };

  const handleUpdateTile = (id: string, data: any) => {
    console.log('🔄 handleUpdateTile called:', { id, data });
    
    if (activeTab) {
      console.log('Current tiles before update:', (activeTab.tiles || []).map((t: any) => ({ id: t.id, gridPosition: t.gridPosition, gridSize: t.gridSize })));
      
      const updatedTiles = (activeTab.tiles || []).map((tile: any) => 
        tile.id === id ? { ...tile, ...data } : tile
      );
      
      console.log('Updated tiles after merge:', updatedTiles.map((t: any) => ({ id: t.id, gridPosition: t.gridPosition, gridSize: t.gridSize })));
      updateTabTiles(activeTab.id, updatedTiles);
    } else {
      console.warn('No active tab found, cannot update tile');
    }
  };

  const handleSettingsChange = (id: string, settings: any) => {
    if (activeTab) {
      const updatedTiles = (activeTab.tiles || []).map((tile: any) => 
        tile.id === id ? { ...tile, ...settings } : tile
      );
      updateTabTiles(activeTab.id, updatedTiles);
    } else {
      console.warn('No active tab found, cannot update tile settings');
    }
  };

  const handleResizeTile = (id: string, size: { width: number; height: number }) => {
    if (!activeTab) return;
    
    const updatedTiles = (activeTab.tiles || []).map(tile => 
      tile.id === id ? { ...tile, size } : tile
    );
    updateTabTiles(activeTab.id, updatedTiles);
  };

  const handleMoveTile = (id: string, position: GridPosition) => {
    if (!activeTab) return;
    
    const updatedTiles = (activeTab.tiles || []).map(tile => 
      tile.id === id ? { ...tile, gridPosition: position } : tile
    );
    updateTabTiles(activeTab.id, updatedTiles);
  };


  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh' }}>
      {/* Tab Bar */}
      <DashboardTabBar
        tabs={tabs}
        tabGroups={tabGroups}
        activeTabId={activeTabId}
        onTabCreate={handleCreateTab}
        onTabClose={closeTab}
        onTabActivate={activateTab}
        onTabEdit={editTab}
        onTabGroup={addTabToGroup}
        onTabUngroup={removeTabFromGroup}
        onTabMoveToGroup={moveTabToGroup}
        onTabPin={handleTabPin}
        onTabUnpin={handleTabUnpin}
        onGroupCreate={handleCreateGroup}
        onGroupEdit={editGroup}
        onGroupDissolve={dissolveGroup}
        onTabReorder={reorderTab}
        onGroupReorder={reorderGroup}
        getTabsByGroup={getTabsByGroup}
      />
      
      <Container maxWidth="xl" sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography 
            variant="h4" 
            sx={{ 
              color: '#ffffff', 
              fontWeight: 700, 
              mb: 1,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            {activeDashboard?.name || 'Dashboard'}
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            {activeDashboard?.name ? `Your ${activeDashboard.name.toLowerCase()} workspace` : 'Your personalized financial command center'}
          </Typography>
        </Box>

        {/* Configuration Status */}
        {!configValid && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="warning" sx={{ 
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid #f59e0b',
              color: '#fbbf24',
              '& .MuiAlert-icon': {
                color: '#fbbf24',
              }
            }}>
              <Typography variant="h6" sx={{ color: '#fbbf24', mb: 1 }}>
                Configuration Issue
              </Typography>
              <Typography variant="body2" sx={{ color: '#fbbf24', mb: 2 }}>
                The API configuration is not properly set up. Please check the following:
              </Typography>
              <Box component="ul" sx={{ color: '#fbbf24', pl: 2 }}>
                {configErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </Box>
              <Typography variant="body2" sx={{ color: '#fbbf24', mt: 2 }}>
                Current API URL: {getConfig('apiGatewayUrl') || 'Not configured'}
              </Typography>
            </Alert>
          </GlassCard>
        )}

        {/* Dashboard Grid */}
        {isLoading ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              Loading your dashboard...
            </Typography>
          </Box>
        ) : (
          <GridDashboard
            tiles={tiles}
            dashboardContext={currentDashboardId}
            onRemoveTile={handleRemoveTile}
            onUpdateTile={handleUpdateTile}
            onSettingsChange={handleSettingsChange}
            onResizeTile={handleResizeTile}
            onMoveTile={handleMoveTile}
          />
        )}

        {/* Multi-Step Add Tile Flow */}
        
        {/* Step 1: Tile Type Selection */}
        <Dialog 
          open={addTileStep === 'type-selection'} 
          onClose={() => setAddTileStep('closed')}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ 
            backgroundColor: '#1e293b', 
            color: '#ffffff',
            borderBottom: '1px solid #374151'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h6">Add New Tile</Typography>
              <IconButton 
                onClick={() => setAddTileStep('closed')}
                sx={{ color: '#9ca3af' }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent sx={{ backgroundColor: '#0f172a', p: 3 }}>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
              Choose the type of tile you want to add to your dashboard
            </Typography>
            <Grid container spacing={2}>
              {tileTypes.map((tileType) => (
                <Grid item xs={12} sm={6} md={4} key={tileType.id}>
                  <Card 
                    sx={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '2px solid #374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: tileType.color,
                        transform: 'translateY(-2px)',
                        boxShadow: `0 8px 32px ${tileType.color}20`
                      }
                    }}
                    onClick={() => handleTileTypeSelect(tileType)}
                  >
                    <CardActionArea sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Box 
                          sx={{ 
                            color: tileType.color,
                            mr: 2,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          {tileType.icon}
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff' }}>
                          {tileType.name}
                        </Typography>
                        {tileType.placeholder && (
                          <Chip 
                            label="Coming Soon" 
                            size="small" 
                            sx={{ 
                              ml: 'auto',
                              backgroundColor: '#374151',
                              color: '#9ca3af'
                            }} 
                          />
                        )}
                      </Box>
                      <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                        {tileType.description}
                      </Typography>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </DialogContent>
        </Dialog>

        {/* Step 2: Tile Configuration */}
        <Dialog 
          open={addTileStep === 'configuration'} 
          onClose={() => setAddTileStep('type-selection')}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ 
            backgroundColor: '#1e293b', 
            color: '#ffffff',
            borderBottom: '1px solid #374151'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h6">
                Configure {selectedTileType?.name}
              </Typography>
              <IconButton 
                onClick={() => setAddTileStep('type-selection')}
                sx={{ color: '#9ca3af' }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent sx={{ backgroundColor: '#0f172a', p: 3 }}>
            {selectedTileType && (
              <Box>
                {/* Dynamic configuration based on tile type */}
                {selectedTileType.id === 'stock' && (
                  <Box>
                    <TextField
                      fullWidth
                      label="Stock Symbol"
                      value={tileConfig.symbol || ''}
                      onChange={(e) => setTileConfig({ ...tileConfig, symbol: e.target.value.toUpperCase() })}
                      sx={{ mb: 2 }}
                      placeholder="e.g., AAPL, GOOGL, MSFT"
                    />
                    <TextField
                      fullWidth
                      select
                      label="Timeframe"
                      value={tileConfig.timeframe || '1d'}
                      onChange={(e) => setTileConfig({ ...tileConfig, timeframe: e.target.value })}
                      sx={{ mb: 2 }}
                    >
                      <option value="1d">1 Day</option>
                      <option value="7d">7 Days</option>
                      <option value="30d">30 Days</option>
                      <option value="1y">1 Year</option>
                    </TextField>
                  </Box>
                )}

                {selectedTileType.id === 'portfolio' && (
                  <Box>
                    <TextField
                      fullWidth
                      label="Portfolio Name"
                      value={tileConfig.name || ''}
                      onChange={(e) => setTileConfig({ ...tileConfig, name: e.target.value })}
                      sx={{ mb: 2 }}
                      placeholder="e.g., My Investment Portfolio"
                    />
                  </Box>
                )}

                {selectedTileType.id === 'custom' && (
                  <Box>
                    <TextField
                      fullWidth
                      label="Tile Title"
                      value={tileConfig.title || ''}
                      onChange={(e) => setTileConfig({ ...tileConfig, title: e.target.value })}
                      sx={{ mb: 2 }}
                      placeholder="Enter a title for your custom tile"
                    />
                    <TextField
                      fullWidth
                      multiline
                      rows={4}
                      label="Content"
                      value={tileConfig.content || ''}
                      onChange={(e) => setTileConfig({ ...tileConfig, content: e.target.value })}
                      sx={{ mb: 2 }}
                      placeholder="Enter your custom content here..."
                    />
                  </Box>
                )}

                {selectedTileType.id === 'chat_generated' && (
                  <Box>
                    <TextField
                      fullWidth
                      multiline
                      rows={3}
                      label="Describe what you want"
                      value={tileConfig.prompt || ''}
                      onChange={(e) => setTileConfig({ ...tileConfig, prompt: e.target.value })}
                      sx={{ mb: 2 }}
                      placeholder="e.g., 'Create a tile showing my top 5 crypto holdings' or 'Show me AAPL stock analysis'"
                    />
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ backgroundColor: '#0f172a', p: 3, borderTop: '1px solid #374151' }}>
            <Button 
              onClick={() => setAddTileStep('type-selection')}
              sx={{ color: '#9ca3af' }}
            >
              Back
            </Button>
            <Button 
              onClick={handleTileConfigSubmit}
              variant="contained"
              sx={{ 
                backgroundColor: selectedTileType?.color || '#f59e0b',
                '&:hover': {
                  backgroundColor: selectedTileType?.color || '#d97706',
                }
              }}
              disabled={!tileConfig.symbol && !tileConfig.title && !tileConfig.name && !tileConfig.prompt}
            >
              Add Tile
            </Button>
          </DialogActions>
        </Dialog>

        {/* Add Crypto Modal (existing component) */}
        <AddCryptoModal
          open={cryptoModalOpen}
          onClose={() => setCryptoModalOpen(false)}
          onAdd={handleAddCryptoTile}
          existingSymbols={getExistingSymbols()}
        />

        {/* Add Stock Modal (new component) */}
        <AddStockModal
          open={stockModalOpen}
          onClose={() => setStockModalOpen(false)}
          onAdd={handleAddStockTile}
          existingSymbols={getExistingSymbols()}
        />

        {/* New Tab Dialog */}
        <NewTabDialog
          open={newTabDialogOpen}
          onClose={() => setNewTabDialogOpen(false)}
          onCreateTab={handleCreateNewTab}
          tabGroups={tabGroups}
        />

        {/* New Group Dialog */}
        <NewGroupDialog
          open={newGroupDialogOpen}
          onClose={() => setNewGroupDialogOpen(false)}
          onCreateGroup={handleCreateNewGroup}
        />

        {/* Floating Add Button */}
        <Fab
          color="primary"
          aria-label="add tile"
          onClick={handleAddTileClick}
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            backgroundColor: '#f59e0b',
            color: 'white',
            '&:hover': {
              backgroundColor: '#d97706',
            },
            zIndex: 1000,
            boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)',
          }}
        >
          <AddIcon />
        </Fab>
      </Container>
    </Box>
  );
};

export default UnifiedDashboardPage;
