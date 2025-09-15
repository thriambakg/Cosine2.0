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
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
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
    reorderTab,
    reorderGroup,
    updateDashboardTiles: updateTabDashboardTiles,
    getTabsByGroup
  } = tabManagement;

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

  // Get current tiles from active dashboard or localStorage
  const [localTiles, setLocalTiles] = useState<UnifiedTile[]>([]);
  
  // Local state to override activeDashboard tiles for immediate updates during drag/resize
  const [overrideTiles, setOverrideTiles] = useState<UnifiedTile[]>([]);
  
  // Ref to track override tiles timeout
  const overrideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Production safety: Track state corruption attempts
  const stateCorruptionRef = useRef<number>(0);
  const MAX_CORRUPTION_ATTEMPTS = 3;
  
  // Get current dashboard ID (either from active dashboard or default)
  const currentDashboardId = activeDashboard?.id || 'main';

  // Function to find the next available position for a new tile
  const findNextAvailablePosition = (tileSize: { width: number; height: number } = { width: 4, height: 4 }) => {
    const GRID_COLUMNS = 12; // Match the GridDashboard constant
    const MAX_ROWS = 50; // Match the GridDashboard constant for flexibility
    
    // Get all existing tiles for the current dashboard
    const existingTiles = activeDashboard?.tiles || [];
    
    // If no existing tiles, place at the top-left
    if (existingTiles.length === 0) {
      console.log(`📍 No existing tiles, placing at top-left:`, { x: 0, y: 0 });
      return { x: 0, y: 0 };
    }
    
    // Create a set of occupied positions
    const occupiedPositions = new Set<string>();
    existingTiles.forEach(tile => {
      const pos = tile.gridPosition || { x: 0, y: 0 };
      const size = tile.gridSize || getDefaultTileSize(tile.type);
      
      // Mark all cells occupied by this tile
      for (let x = pos.x; x < pos.x + size.width; x++) {
        for (let y = pos.y; y < pos.y + size.height; y++) {
          occupiedPositions.add(`${x},${y}`);
        }
      }
    });
    
    // Smart placement: Try to place tiles in a visually pleasing way
    // 1. First try to place in the next available column on the first row
    // 2. Then try to place in the next available row
    // 3. Finally, scan row by row
    
    // Strategy 1: Find the rightmost position on the first row
    for (let x = 0; x <= GRID_COLUMNS - tileSize.width; x++) {
      let canPlace = true;
      for (let dx = 0; dx < tileSize.width; dx++) {
        if (occupiedPositions.has(`${x + dx},0`)) {
          canPlace = false;
          break;
        }
      }
      if (canPlace) {
        console.log(`📍 Placing new tile on first row:`, { x, y: 0, tileSize });
        return { x, y: 0 };
      }
    }
    
    // Strategy 2: Find the first available position row by row
    for (let y = 0; y < MAX_ROWS; y++) {
      for (let x = 0; x <= GRID_COLUMNS - tileSize.width; x++) {
        let canPlace = true;
        
        // Check if this position is available
        for (let dx = 0; dx < tileSize.width; dx++) {
          for (let dy = 0; dy < tileSize.height; dy++) {
            if (occupiedPositions.has(`${x + dx},${y + dy}`)) {
              canPlace = false;
              break;
            }
          }
          if (!canPlace) break;
        }
        
        if (canPlace) {
          console.log(`📍 Found available position for new tile:`, { x, y, tileSize });
          return { x, y };
        }
      }
    }
    
    // Fallback to position 0,0 if no position found
    console.log(`⚠️ No available position found, using fallback position`);
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

  // Get current tiles with proper state priority: overrideTiles > localTiles > activeDashboard.tiles
  const getCurrentDashboardTiles = () => {
    if (activeDashboard) {
      const dashboardOverrideTiles = overrideTiles.filter(tile => tile.dashboard_id === activeDashboard.id);
      const dashboardLocalTiles = localTiles.filter(tile => tile.dashboard_id === activeDashboard.id);
      const dashboardActiveTiles = activeDashboard.tiles || [];
      
      console.log('🔍 getCurrentDashboardTiles:', {
        activeDashboardId: activeDashboard.id,
        dashboardOverrideTiles: dashboardOverrideTiles.length,
        dashboardLocalTiles: dashboardLocalTiles.length,
        dashboardActiveTiles: dashboardActiveTiles.length,
        usingOverrideTiles: dashboardOverrideTiles.length > 0,
        usingLocalTiles: dashboardOverrideTiles.length === 0 && dashboardLocalTiles.length > 0,
      });
      
      // Priority: overrideTiles > localTiles > activeDashboard.tiles
      if (dashboardOverrideTiles.length > 0) {
        return dashboardOverrideTiles;
      } else if (dashboardLocalTiles.length > 0) {
        return dashboardLocalTiles;
      } else {
        return dashboardActiveTiles;
      }
    } else {
      return localTiles.filter(tile => tile.dashboard_id === currentDashboardId);
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

  // Load tiles from localStorage based on dashboard state
  useEffect(() => {
    console.log('🔍 Dashboard state changed:', { activeDashboard, currentDashboardId, tabs: tabs?.length });
    
    if (activeDashboard) {
      // When switching to an active dashboard, clear local tiles and override tiles
      console.log('✅ Active dashboard found, clearing local tiles and override tiles');
      setLocalTiles([]);
      setOverrideTiles([]);
    } else {
      // When no active dashboard, load tiles for the current dashboard
      console.log('⚠️ No active dashboard, loading from localStorage');
      const cachedTiles = loadFromLocalStorage();
      console.log('🔍 Loading tiles from localStorage:', { cachedTiles, currentDashboardId, activeDashboard });
      if (cachedTiles && cachedTiles.length > 0) {
        // Handle tiles without dashboard_id (legacy tiles) by assigning them to 'main'
        const tilesWithDashboardId = cachedTiles.map(tile => ({
          ...tile,
          dashboard_id: tile.dashboard_id || 'main'
        }));
        
        const dashboardTiles = tilesWithDashboardId.filter(tile => tile.dashboard_id === currentDashboardId);
        console.log('🎯 Filtered tiles for current dashboard:', { dashboardTiles, currentDashboardId });
        setLocalTiles(dashboardTiles);
      } else {
        console.log('❌ No tiles found in localStorage');
      }
    }
  }, [activeDashboard, currentDashboardId, loadFromLocalStorage, tabs]);

  // Cleanup override timeout on unmount
  useEffect(() => {
    return () => {
      if (overrideTimeoutRef.current) {
        clearTimeout(overrideTimeoutRef.current);
      }
    };
  }, []);

  // Debounced save to database
  const debouncedSaveToDatabase = useCallback((updatedTiles: UnifiedTile[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    pendingSaveRef.current = updatedTiles;

    saveTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        saveUserDashboard(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    }, 2000);
  }, []);

  // Production-safe dashboard update with corruption protection
  const safeUpdateDashboardTiles = useCallback((updatedTiles: UnifiedTile[]) => {
    try {
      // Validate tiles before updating
      const validTiles = updatedTiles.filter(tile => {
        if (!tile.id || !tile.type) {
          console.warn('⚠️ Skipping invalid tile:', tile);
          return false;
        }
        return true;
      });

      if (validTiles.length !== updatedTiles.length) {
        console.warn(`⚠️ Filtered out ${updatedTiles.length - validTiles.length} invalid tiles`);
      }

      // Check for state corruption
      if (stateCorruptionRef.current >= MAX_CORRUPTION_ATTEMPTS) {
        console.error('🚨 Maximum corruption attempts reached, using fallback mode');
        return updateDashboardTilesFallback(validTiles);
      }

      return updateDashboardTiles(validTiles);
    } catch (error) {
      console.error('❌ Error in safe dashboard update:', error);
      stateCorruptionRef.current++;
      return updateDashboardTilesFallback(updatedTiles);
    }
  }, [activeDashboard, updateTabDashboardTiles, saveToLocalStorage, debouncedSaveToDatabase, loadFromLocalStorage, currentDashboardId]);

  // Fallback update function for corrupted states
  const updateDashboardTilesFallback = useCallback((updatedTiles: UnifiedTile[]) => {
    console.log('🆘 Using fallback dashboard update');
    
    try {
      // Simple localStorage-only approach
      const tilesWithDashboardId = updatedTiles.map(tile => ({
        ...tile,
        dashboard_id: tile.dashboard_id || currentDashboardId
      }));
      
      saveToLocalStorage(tilesWithDashboardId);
      setLocalTiles(tilesWithDashboardId);
      
      console.log('✅ Fallback update successful');
    } catch (error) {
      console.error('❌ Fallback update failed:', error);
    }
  }, [saveToLocalStorage, currentDashboardId]);

  // Helper function to update dashboard tiles
  const updateDashboardTiles = useCallback((updatedTiles: UnifiedTile[]) => {
    console.log('updateDashboardTiles called with:', updatedTiles);
    console.log('activeDashboard:', activeDashboard);
    
    // If we have an active dashboard, use the tab management system
    if (activeDashboard) {
      console.log('Updating tiles for dashboard:', activeDashboard.id);

      // Update the dashboard in the tab management system
      updateTabDashboardTiles(activeDashboard.id, updatedTiles);

      // Update localStorage with all tiles (including other dashboards)
      const allTiles = loadFromLocalStorage() || [];
      const otherDashboardTiles = allTiles.filter(tile => tile.dashboard_id !== activeDashboard.id);
      const allUpdatedTiles = [...otherDashboardTiles, ...updatedTiles];
      saveToLocalStorage(allUpdatedTiles);
      
      // Note: Database save is handled by useTabManagement when updateTabDashboardTiles is called above

      // Set override tiles for immediate visual feedback
      setOverrideTiles(updatedTiles);
      
      // Clear override tiles after a delay to allow activeDashboard state to update
      if (overrideTimeoutRef.current) {
        clearTimeout(overrideTimeoutRef.current);
      }
      overrideTimeoutRef.current = setTimeout(() => {
        console.log('🔄 Clearing override tiles after state update');
        setOverrideTiles([]);
      }, 1000); // 1 second delay

      console.log('Successfully updated tiles for dashboard:', activeDashboard.id, updatedTiles);
    } else {
      // Fallback: Direct localStorage approach (original behavior)
      console.log('No active dashboard, using direct localStorage approach');
      
      // Save tiles directly to localStorage with current dashboard_id
      const tilesWithDashboardId = updatedTiles.map(tile => ({
        ...tile,
        dashboard_id: tile.dashboard_id || currentDashboardId
      }));
      
      // Get existing tiles from localStorage
      const existingTiles = loadFromLocalStorage() || [];
      
      // Filter out tiles for the current dashboard and add the new ones
      const otherDashboardTiles = existingTiles.filter(tile => tile.dashboard_id !== currentDashboardId);
      const allTiles = [...otherDashboardTiles, ...tilesWithDashboardId];
      
      saveToLocalStorage(allTiles);
      
      // Update local state to trigger re-render
      setLocalTiles(allTiles);
      
      // Note: Database save is handled by useTabManagement

      console.log('Successfully saved tiles to localStorage:', allTiles);
    }
  }, [activeDashboard, updateTabDashboardTiles, saveToLocalStorage, debouncedSaveToDatabase, loadFromLocalStorage, currentDashboardId]);

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

  const handleTileConfigSubmit = () => {
    if (!selectedTileType) return;

    const newTile: UnifiedTile = {
      id: `tile_${Date.now()}`,
      type: selectedTileType.id as any,
      title: tileConfig.title || tileConfig.symbol || tileConfig.name || selectedTileType.name,
      symbol: tileConfig.symbol,
      timeframe: tileConfig.timeframe,
      name: tileConfig.name, // For portfolio tiles
      content: tileConfig.content, // For custom tiles
      prompt: tileConfig.prompt, // For chat_generated tiles
      displayOptions: tileConfig.displayOptions || {},
      autoRefresh: tileConfig.autoRefresh || false,
      isPinned: false,
      size: { width: 350, height: 400 }, // Legacy pixel size
      gridPosition: findNextAvailablePosition(getDefaultTileSize(selectedTileType.id as any)), // Smart placement
      gridSize: getDefaultTileSize(selectedTileType.id as any), // Tile-specific default size
      dashboard_id: activeDashboard?.id || 'main',
      created_at: new Date().toISOString(),
    };

    const updatedTiles = [...tiles, newTile];
    updateDashboardTiles(updatedTiles);

    // Reset state
    setAddTileStep('closed');
    setSelectedTileType(null);
    setTileConfig({});
  };

  // Handle crypto tile addition using the existing AddCryptoModal
  const handleAddCryptoTile = (cryptoData: any) => {
    console.log('handleAddCryptoTile called with:', cryptoData);
    console.log('activeDashboard:', activeDashboard);
    console.log('current tiles:', tiles);
    
    const newTile: UnifiedTile = {
      id: `tile_${Date.now()}`,
      type: 'crypto',
      title: cryptoData.symbol,
      symbol: cryptoData.symbol,
      timeframe: cryptoData.timeframe,
      displayOptions: cryptoData.displayOptions,
      autoRefresh: cryptoData.autoRefresh,
      isPinned: false,
      size: { width: 350, height: 400 }, // Legacy pixel size
      gridPosition: findNextAvailablePosition(getDefaultTileSize('crypto')), // Smart placement
      gridSize: getDefaultTileSize('crypto'), // Tile-specific default size
      dashboard_id: activeDashboard?.id || 'main',
      created_at: new Date().toISOString(),
    };

    console.log('Created new tile:', newTile);
    const updatedTiles = [...tiles, newTile];
    console.log('Updated tiles array:', updatedTiles);
    updateDashboardTiles(updatedTiles);
  };

  // Handle stock tile addition using the new AddStockModal
  const handleAddStockTile = (stockData: any) => {
    console.log('handleAddStockTile called with:', stockData);
    console.log('activeDashboard:', activeDashboard);
    console.log('current tiles:', tiles);
    
    const newTile: UnifiedTile = {
      id: `tile_${Date.now()}`,
      type: 'stock',
      title: stockData.symbol,
      symbol: stockData.symbol,
      timeframe: stockData.timeframe,
      displayOptions: stockData.displayOptions,
      autoRefresh: stockData.autoRefresh,
      isPinned: false,
      size: { width: 350, height: 400 }, // Legacy pixel size
      gridPosition: findNextAvailablePosition(getDefaultTileSize('stock')), // Smart placement
      gridSize: getDefaultTileSize('stock'), // Tile-specific default size
      dashboard_id: activeDashboard?.id || 'main',
      created_at: new Date().toISOString(),
    };

    console.log('Created new tile:', newTile);
    const updatedTiles = [...tiles, newTile];
    console.log('Updated tiles array:', updatedTiles);
    updateDashboardTiles(updatedTiles);
  };

  const getExistingSymbols = () => tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol));

  const handleRemoveTile = (id: string) => {
    const updatedTiles = tiles.filter(tile => tile.id !== id);
    safeUpdateDashboardTiles(updatedTiles);
  };

  const handleUpdateTile = (id: string, data: any) => {
    console.log('🔄 handleUpdateTile called:', { id, data });
    console.log('Current tiles before update:', tiles.map(t => ({ id: t.id, gridPosition: t.gridPosition, gridSize: t.gridSize })));
    
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, ...data } : tile
    );
    
    console.log('Updated tiles after merge:', updatedTiles.map(t => ({ id: t.id, gridPosition: t.gridPosition, gridSize: t.gridSize })));
    safeUpdateDashboardTiles(updatedTiles);
  };

  const handleSettingsChange = (id: string, settings: any) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, ...settings } : tile
    );
    safeUpdateDashboardTiles(updatedTiles);
  };

  const handleResizeTile = (id: string, size: { width: number; height: number }) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, size } : tile
    );
    safeUpdateDashboardTiles(updatedTiles);
  };

  const handleMoveTile = (id: string, position: GridPosition) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, gridPosition: position } : tile
    );
    safeUpdateDashboardTiles(updatedTiles);
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
