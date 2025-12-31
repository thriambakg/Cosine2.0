import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Box, 
  Typography, 
  Container,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Chip,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Alert,
  InputAdornment,
  CircularProgress
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { 
  Add as AddIcon, 
  TrendingUp as TrendingUpIcon,
  AccountBalance as AccountBalanceIcon,
  Settings as SettingsIcon,
  Article as ArticleIcon,
  Assessment as AssessmentIcon,
  Description as DescriptionIcon,
  Gavel as GavelIcon,
  Folder as FolderIcon,
  ZoomIn,
  ZoomOut,
  ZoomOutMap,
  Share as ShareIcon,
  Link as LinkIcon,
  Download as DownloadIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { loadConfig, validateConfig, getConfig } from '../config/configLoader';
import { logApiConfig } from '../config/api';
import GridDashboard from '../components/dashboard/GridDashboard';
import { getDefaultTileSize } from '../components/tiles/tileConfig';
import AddTileMenu from '../components/dialogs/AddTileMenu';
// import { safeLoadDashboard } from '../utils/dashboardMigration';
import AddCryptoModal from '../components/tiles/AddCryptoModal';
import AddStockModal from '../components/tiles/AddStockModal';
import { dashboardAPI } from '../services/api';
import DashboardTabBar from '../components/dashboard/DashboardTabBar';
import NewTabDialog from '../components/dialogs/NewTabDialog';
import NewGroupDialog from '../components/dialogs/NewGroupDialog';

// Import tab management hook and types
import { useTabManagement } from '../hooks/useTabManagement';
import { UnifiedTile, GridPosition, TileCategory } from '../types/dashboardTypes';

// Hierarchical tile categories
const tileCategories: TileCategory[] = [
  {
    id: 'crypto',
    name: 'Cryptocurrency',
    description: 'Track and analyze cryptocurrency markets',
    icon: <TrendingUpIcon />,
    color: '#f59e0b',
    subcategories: [
      {
        id: 'basic',
        name: 'Basic Tiles',
        description: 'Simple crypto tracking tiles',
        icon: <TrendingUpIcon />,
        color: '#f59e0b',
        tiles: [
          {
            id: 'crypto',
            name: 'Crypto Tracker',
            description: 'Track crypto prices, charts, and market data',
            category: 'crypto',
            subcategory: 'basic',
            icon: <TrendingUpIcon />,
            color: '#f59e0b',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  },
  {
    id: 'stocks',
    name: 'Stock Analysis',
    description: 'Comprehensive stock market analysis tools',
    icon: <AccountBalanceIcon />,
    color: '#10b981',
    subcategories: [
      {
        id: 'basic',
        name: 'Basic Tiles',
        description: 'Simple stock tracking tiles',
        icon: <AccountBalanceIcon />,
        color: '#10b981',
        tiles: [
          {
            id: 'stock',
            name: 'Stock Tracker',
            description: 'Monitor individual stock prices, analysis, and alerts',
            category: 'stocks',
            subcategory: 'basic',
            icon: <AccountBalanceIcon />,
            color: '#10b981',
            isAvailable: true,
            placeholder: false
          }
        ]
      },
      {
        id: 'analysis',
        name: 'Stock Analysis',
        description: 'Advanced stock screening and analysis tools',
        icon: <SettingsIcon />,
        color: '#3b82f6',
        tiles: [
          {
            id: 'stock_screener',
            name: 'Stock Filter',
            description: 'Screen stocks based on custom criteria (industry, volatility, price change, market cap)',
            category: 'stocks',
            subcategory: 'analysis',
            icon: <SettingsIcon />,
            color: '#3b82f6',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  },
  {
    id: 'portfolio',
    name: 'Portfolio Management',
    description: 'Portfolio tracking and management tools',
    icon: <SettingsIcon />,
    color: '#3b82f6',
    subcategories: [
      {
        id: 'overview',
        name: 'Portfolio Overview',
        description: 'Portfolio tracking and analysis',
        icon: <SettingsIcon />,
        color: '#3b82f6',
        tiles: [
          {
            id: 'portfolio',
            name: 'Portfolio Analysis',
            description: 'Analyze portfolio risk, performance, and allocation',
            category: 'portfolio',
            subcategory: 'overview',
            icon: <AssessmentIcon />,
            color: '#3b82f6',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  },
  {
    id: 'custom',
    name: 'File System',
    description: 'File system tiles',
    icon: <FolderIcon />,
    color: '#fbbf24',
    subcategories: [
      {
        id: 'folder',
        name: 'Folder',
        description: 'Display and manage files in a folder',
        icon: <FolderIcon />,
        color: '#fbbf24',
        tiles: [
          {
            id: 'folder',
            name: 'Folder',
            description: 'Display and manage files in a folder',
            category: 'custom',
            subcategory: 'folder',
            icon: <FolderIcon />,
            color: '#fbbf24',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  },
  {
    id: 'news',
    name: 'News',
    description: 'Stay updated with the latest financial news and market insights',
    icon: <ArticleIcon />,
    color: '#dc2626',
    subcategories: [
      {
        id: 'financial',
        name: 'News',
        description: 'Browse and filter financial news articles',
        icon: <ArticleIcon />,
        color: '#dc2626',
        tiles: [
          {
            id: 'news',
            name: 'News',
            description: 'Browse and filter financial news articles with keyword search and source filtering',
            category: 'news',
            subcategory: 'financial',
            icon: <ArticleIcon />,
            color: '#dc2626',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  },
  {
    id: 'government',
    name: 'Government Data',
    description: 'Access and analyze government financial disclosure data',
    icon: <AccountBalanceIcon />,
    color: '#3b82f6',
    subcategories: [
      {
        id: 'trades',
        name: 'Trading Disclosures',
        description: 'Politician trading and financial disclosures',
        icon: <AccountBalanceIcon />,
        color: '#3b82f6',
        tiles: [
          {
            id: 'politician_trades',
            name: 'Politician Trades',
            description: 'Search and analyze politician trading disclosures with advanced filtering',
            category: 'government',
            subcategory: 'trades',
            icon: <AccountBalanceIcon />,
            color: '#3b82f6',
            isAvailable: true,
            placeholder: false
          },
          {
            id: 'sec_search',
            name: 'SEC Filings',
            description: 'Search and analyze SEC filing documents with entity and form filtering',
            category: 'government',
            subcategory: 'trades',
            icon: <DescriptionIcon />,
            color: '#2563eb',
            isAvailable: true,
            placeholder: false
          },
          {
            id: 'govt_contracts',
            name: 'Government Contracts',
            description: 'Search and analyze government contract awards with agency and recipient filtering',
            category: 'government',
            subcategory: 'trades',
            icon: <AccountBalanceIcon />,
            color: '#059669',
            isAvailable: true,
            placeholder: false
          },
          {
            id: 'congress_bills',
            name: 'Congress Bills',
            description: 'Search and analyze congressional bills with sponsor and policy area filtering',
            category: 'government',
            subcategory: 'trades',
            icon: <GavelIcon />,
            color: '#7c3aed',
            isAvailable: true,
            placeholder: false
          },
          {
            id: 'lda_disclosures',
            name: 'LDA Disclosures',
            description: 'Search and analyze Lobbying Disclosure Act filings with registrant, client, and lobbyist filtering',
            category: 'government',
            subcategory: 'trades',
            icon: <GavelIcon />,
            color: '#dc2626',
            isAvailable: true,
            placeholder: false
          }
        ]
      }
    ]
  }
];

const UnifiedDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Zoom state with session persistence per tab
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.1;
  
  // Initialize zoom level from sessionStorage or default to 1.0
  const [zoomLevel, setZoomLevel] = useState(1.0);
  
  // Share menu state
  const [shareMenuAnchor, setShareMenuAnchor] = useState<null | HTMLElement>(null);
  const [shareLinkDialogOpen, setShareLinkDialogOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string>('');
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success'
  });

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

  // Load zoom level for the active tab from sessionStorage
  useEffect(() => {
    if (activeTabId && typeof window !== 'undefined') {
      const savedZoom = sessionStorage.getItem(`dashboard-zoom-level-${activeTabId}`);
      if (savedZoom) {
        const parsed = parseFloat(savedZoom);
        if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
          setZoomLevel(parsed);
        } else {
          setZoomLevel(1.0);
        }
      } else {
        setZoomLevel(1.0);
      }
    }
  }, [activeTabId]);

  // Persist zoom level to sessionStorage whenever it changes (per tab)
  useEffect(() => {
    if (activeTabId && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(`dashboard-zoom-level-${activeTabId}`, zoomLevel.toString());
      } catch (error: any) {
        // If quota exceeded, try cleaning up old zoom levels
        if (error.name === 'QuotaExceededError') {
          try {
            // Remove zoom levels for inactive tabs
            const keysToRemove: string[] = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && key.startsWith('dashboard-zoom-level-') && key !== `dashboard-zoom-level-${activeTabId}`) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => sessionStorage.removeItem(key));
            // Retry saving current zoom level
            sessionStorage.setItem(`dashboard-zoom-level-${activeTabId}`, zoomLevel.toString());
          } catch (retryError) {
            console.warn('Failed to save zoom level to sessionStorage:', retryError);
          }
        }
      }
    }
  }, [zoomLevel, activeTabId]);

  // Handle hot reload scenario where user might be temporarily undefined
  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      console.warn('🚨 No user found during dashboard load - this might be due to hot reload');
      // Refresh the page to properly reinitialize authentication
      console.log('🔄 Refreshing page to reinitialize authentication...');
      window.location.reload();
    }
  }, [user]);

  // Keyboard shortcuts for zoom (Ctrl/Cmd + Plus/Minus/0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoomLevel(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoomLevel(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
        } else if (e.key === '0') {
          e.preventDefault();
          setZoomLevel(1.0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Multi-step tile addition state
  const [addTileMenuOpen, setAddTileMenuOpen] = useState(false);

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
    // Use a reasonable default for grid columns - will be dynamically adjusted by GridDashboard
    const GRID_COLUMNS = 16; // Increased default to accommodate wider screens
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
      return activeTab.tiles || [];
    } else {
      return [];
    }
  };
  
  const tiles = getTilesWithUniqueIds(getCurrentDashboardTiles());
  


  // Tab management handlers
  const handleCreateTab = () => {
    setNewTabDialogOpen(true);
  };

  const handleCreateNewTab = (name: string, groupId?: string, isPinned?: boolean, color?: string) => {
    createTab({ name, groupId, isPinned, color });
    setNewTabDialogOpen(false);
  };

  const handleImportTab = async (file: File | null, shareLink: string | null) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    try {
      let response;
      
      if (file) {
        // Convert file to base64
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              // Convert ArrayBuffer to base64
              const bytes = new Uint8Array(reader.result);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64String = btoa(binary);
              resolve(base64String);
            } else if (typeof reader.result === 'string') {
              // If it's a data URL, extract the base64 part
              const base64String = reader.result.split(',')[1] || reader.result;
              resolve(base64String);
            } else {
              reject(new Error('Failed to read file'));
            }
          };
          reader.onerror = () => reject(new Error('Failed to read file'));
          // Use readAsArrayBuffer for binary files
          reader.readAsArrayBuffer(file);
        });

        // Import from file
        response = await dashboardAPI.importDashboard(user.id, 'file', fileContent);
      } else if (shareLink) {
        // Extract share ID from share link
        // Share links can be in formats:
        // - /dashboard/shared/{shareId}
        // - https://domain.com/dashboard/shared/{shareId}
        // - Just the shareId itself
        let shareId = shareLink.trim();
        
        // Try to extract share ID from URL
        const urlMatch = shareLink.match(/\/dashboard\/shared\/([a-f0-9-]+)/i);
        if (urlMatch) {
          shareId = urlMatch[1];
        } else {
          // If it's just a UUID, use it directly
          const uuidMatch = shareLink.match(/^[a-f0-9-]{36}$/i);
          if (!uuidMatch) {
            throw new Error('Invalid share link format. Please provide a valid dashboard share link.');
          }
        }

        // Import from share link
        response = await dashboardAPI.importDashboard(user.id, 'link', undefined, shareId);
      } else {
        throw new Error('Please provide either a file or a share link');
      }

      if (response.success) {
        // Reload dashboard to show the imported tab
        await reloadFromDatabase();
        
        // Activate the newly imported tab if available
        // Use setTimeout to ensure state has updated from reloadFromDatabase
        if (response.tab) {
          const importedTabId = response.tab.id;
          setTimeout(() => {
            activateTab(importedTabId);
          }, 100);
        }
        
        setSnackbar({
          open: true,
          message: response.message || 'Dashboard imported successfully!',
          severity: 'success'
        });
      } else {
        throw new Error(response.error || 'Failed to import dashboard');
      }
    } catch (error: any) {
      console.error('Error importing dashboard:', error);
      setSnackbar({
        open: true,
        message: error.message || 'Failed to import dashboard',
        severity: 'error'
      });
      throw error;
    }
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
        
        logApiConfig();
        
        console.log('🔧 Configuration Status:', {
          isValid: validation.isValid,
          errors: validation.errors,
          apiUrl: getConfig('apiGatewayUrl')
        });
      } catch (error) {
        console.error('❌ Failed to load configuration:', error);
        setConfigValid(false);
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
    
    setAddTileMenuOpen(true);
  };

  // Handle adding a single tile
  const handleAddTile = async (tileId: string) => {
    if (!activeTab || !user?.id) {
      console.warn('No active tab or user ID found, cannot add tile');
      return;
    }

    try {
      // Handle special tiles that need modals
      if (tileId === 'crypto') {
        setCryptoModalOpen(true);
        setAddTileMenuOpen(false);
        return;
      } else if (tileId === 'stock') {
        setStockModalOpen(true);
        setAddTileMenuOpen(false);
        return;
      }

      // Use existing tile creation handlers
      if (tileId === 'stock_screener') {
        await handleCreateStockScreenerTile();
      } else if (tileId === 'news') {
        await handleCreateNewsTile();
      } else if (tileId === 'portfolio') {
        await handleCreatePortfolioTile();
      } else if (tileId === 'politician_trades') {
        await handleCreatePoliticianTradesTile();
      } else if (tileId === 'sec_search') {
        await handleCreateSECSearchTile();
      } else if (tileId === 'govt_contracts') {
        await handleCreateGovtContractsTile();
      } else if (tileId === 'congress_bills') {
        await handleCreateCongressBillsTile();
      } else if (tileId === 'lda_disclosures') {
        await handleCreateLDASearchTile();
      } else if (tileId === 'folder') {
        await handleCreateFolderTile();
      }

      // Reload data from database after tile is created
      await reloadFromDatabase();
      setAddTileMenuOpen(false);
    } catch (error) {
      console.error(`Failed to create tile ${tileId}:`, error);
    }
  };

  // Navigation handlers for hierarchical tile selection - OLD SYSTEM (commented out)
  // These are kept for reference but not used with the new AddTileMenu component
  /*
  const handleCategorySelect = (category: TileCategory) => {
    setSelectedCategory(category);
    if (category.subcategories.length === 1) {
      // If only one subcategory, skip directly to tile selection
      setSelectedSubcategory(category.subcategories[0]);
      setAddTileStep('tile-selection');
    } else {
      // Multiple subcategories, show subcategory selection
      setAddTileStep('subcategory-selection');
    }
  };

  const handleSubcategorySelect = (subcategory: TileSubcategory) => {
    setSelectedSubcategory(subcategory);
    setAddTileStep('tile-selection');
  };

  const handleTileTypeSelect = (tileType: TileTypeDefinition) => {
    // Remove focus from any active element to prevent aria-hidden warning
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    setSelectedTileType(tileType);
    setTileConfig({});
    
    // Handle different tile types
    if (tileType.id === 'crypto') {
      setCryptoModalOpen(true);
      setAddTileStep('closed');
    } else if (tileType.id === 'stock') {
      setStockModalOpen(true);
      setAddTileStep('closed');
    } else if (tileType.id === 'stock_screener') {
      // Handle stock screener tile creation
      handleCreateStockScreenerTile();
    } else if (tileType.id === 'news') {
      // Handle news tile creation
      handleCreateNewsTile();
    } else if (tileType.id === 'portfolio') {
      // Handle portfolio tile creation
      handleCreatePortfolioTile();
    } else if (tileType.id === 'politician_trades') {
      // Handle politician trades tile creation
      handleCreatePoliticianTradesTile();
    } else if (tileType.id === 'sec_search') {
      // Handle SEC search tile creation
      handleCreateSECSearchTile();
    } else if (tileType.id === 'govt_contracts') {
      // Handle government contracts tile creation
      handleCreateGovtContractsTile();
    } else if (tileType.id === 'congress_bills') {
      // Handle congress bills tile creation
      handleCreateCongressBillsTile();
    } else if (tileType.id === 'lda_disclosures') {
      // Handle LDA disclosures tile creation
      handleCreateLDASearchTile();
    } else if (tileType.id === 'folder') {
      // Handle folder tile creation
      handleCreateFolderTile();
    } else if (tileType.placeholder) {
      // For placeholder tiles, show a message
      alert(`${tileType.name} tiles are coming soon!`);
      setAddTileStep('closed');
    } else {
      // For other tiles, go to configuration
      const defaultConfig = getDefaultTileConfig(tileType.id);
      setTileConfig(defaultConfig);
      setAddTileStep('configuration');
    }
  };
  */

  // Navigation back handlers - OLD SYSTEM (commented out)
  /*
  const handleBackToCategories = () => {
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setAddTileStep('category-selection');
  };

  const handleBackToSubcategories = () => {
    setSelectedSubcategory(null);
    setAddTileStep('subcategory-selection');
  };

  const handleBackToTiles = () => {
    setAddTileStep('tile-selection');
  };
  */

  // Stock screener tile creation handler
  const handleCreateStockScreenerTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'stock_screener' as const,
      title: 'Stock Screener',
      displayOptions: {
        showIndustry: true,
        showMarketCap: true,
        showVolatility: true,
        showPriceChange: true,
        showPERatio: true,
        showDividendYield: true,
        showResultsTable: true,
        showCriteriaSummary: true,
        maxResults: 100000,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 4, height: 6 }),
      gridSize: { width: 4, height: 6 },
      criteria: {
        industries: [],
        volatilityRange: [0, 100],
        priceChangeRange: [-50, 50],
        marketCapRange: [0, 1000000000000],
        priceRange: [0, 1000],
        peRatioRange: [0, 100],
        dividendYieldRange: [0, 20],
        timeframe: '1d',
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create stock screener tile:', error);
    }
  };

  // News tile creation handler
  const handleCreateNewsTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'news' as const,
      title: 'News',
      displayOptions: {
        showImages: true,
        showSource: true,
        showDate: true,
        showKeywords: false,
        maxResults: 20,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 4, height: 6 }),
      gridSize: { width: 4, height: 6 },
      filters: {
        keywords: [],
        sources: [],
        categories: [],
        dateRange: '12h',
        countries: [],
        keywordOperator: 'OR',
        categoryOperator: 'OR',
        sourceOperator: 'OR',
        countryOperator: 'OR',
        keywordExpression: [],
        sourceExpression: [],
        categoryExpression: [],
        countryExpression: [],
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create news tile:', error);
    }
  };

  // Portfolio tile creation handler
  const handleCreatePortfolioTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'portfolio' as const,
      title: 'Portfolio Analysis',
      displayOptions: {
        showHoldings: true,
        showPerformance: true,
        showAllocation: false,
        showRiskMetrics: true,
        showStockDetails: true,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 8 }),
      gridSize: { width: 6, height: 8 },
      portfolioData: {
        entries: [{ stock: '', shares: 0 }],
        timeframe: '1y',
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create portfolio tile:', error);
    }
  };

  // Politician trades tile creation handler
  const handleCreatePoliticianTradesTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'politician_trades' as const,
      title: 'Politician Trades',
      displayOptions: {
        showPolitician: true,
        showParty: true,
        showPosition: true,
        showSecurity: true,
        showTransactionType: true,
        showAmount: true,
        showDate: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 6 }),
      gridSize: { width: 6, height: 6 },
      searchParams: {
        dateFrom: '2020-01-01',
        dateTo: new Date().toISOString().split('T')[0],
        politicianName: [],
        party: [],
        position: [],
        security: [],
        transactionType: [],
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create politician trades tile:', error);
    }
  };

  // SEC search tile creation handler
  const handleCreateSECSearchTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'sec_search' as const,
      title: 'SEC Filings Search',
      displayOptions: {
        showEntity: true,
        showForm: true,
        showFilingDate: true,
        showLocation: true,
        showIncorporation: true,
        showCIK: true,
        showFile: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 6 }),
      gridSize: { width: 6, height: 6 },
      searchParams: {
        entityName: [],
        formTypes: [],
        dateFrom: '',
        dateTo: '',
        cik: '',
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create SEC search tile:', error);
    }
  };

  // Government contracts tile creation handler
  const handleCreateGovtContractsTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'govt_contracts' as const,
      title: 'Government Contracts',
      displayOptions: {
        showRecipient: true,
        showAwardingAgency: true,
        showFundingAgency: true,
        showAmount: true,
        showPeriodStartDate: false,
        showPeriodEndDate: false,
        showNaicsCode: false,
        showPscCode: false,
        showLastUpdated: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 6 }),
      gridSize: { width: 6, height: 6 },
      searchParams: {
        keywords: [],
        award_type: [],
        awarding_agency_name: [],
        funding_agency_name: [],
        recipient_name: [],
        recipient_location_state: [],
        naics_code: [],
        psc_code: [],
        cfda_number: [],
        date_from: '',
        date_to: '',
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create government contracts tile:', error);
    }
  };

  // Congress bills tile creation handler
  const handleCreateCongressBillsTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'congress_bills' as const,
      title: 'Congress Bills',
      displayOptions: {
        showBillTitle: true,
        showBillType: true,
        showBillNumber: false,
        showSponsorName: true,
        showSponsorParty: false,
        showSponsorState: false,
        showIntroducedDate: true,
        showLatestActionDate: false,
        showCongress: true,
        showBipartisan: false,
        showPolicyArea: false,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 6 }),
      gridSize: { width: 6, height: 6 },
      searchParams: {
        bill_title: [],
        bill_type: [],
        sponsor_name: [],
        introduced_date_from: '',
        introduced_date_to: '',
        congress: [],
        policy_area: [],
        sponsor_party: [],
        sponsor_state: [],
        latest_action_date_from: '',
        latest_action_date_to: '',
        bipartisan: undefined,
        bill_number: undefined,
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create congress bills tile:', error);
    }
  };

  // LDA disclosures tile creation handler
  const handleCreateLDASearchTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile = {
      type: 'lda_disclosures' as const,
      title: 'LDA Disclosures',
      displayOptions: {
        showFilingType: true,
        showFilingPeriod: true,
        showFilingYear: true,
        showRegistrant: true,
        showClient: true,
        showAmount: true,
        showDatePosted: true,
        showState: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 6, height: 6 }),
      gridSize: { width: 6, height: 6 },
      searchParams: {
        general_text_search_fields: {
          registrant: false,
          client: false,
          lobbyist: false,
          pac: false,
          foreign: false,
        },
        date_from: '',
        date_to: '',
        amount_min: undefined,
        amount_max: undefined,
        registrant_name: [],
        client_name: [],
        lobbyist_name: [],
        foreign_entity_name: [],
        general_issue_code: [],
        government_entity: [],
        state: [],
        filing_period: [],
        item_type: [],
      },
    };

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create LDA search tile:', error);
    }
  };

  // Folder tile creation handler
  const handleCreateFolderTile = async () => {
    if (!activeTab || !user?.id) return;

    const newTile: any = {
      type: 'folder' as const,
      title: 'Folder',
      folderPath: '',
      displayOptions: {
        showFolders: true,
        showFiles: true,
        showBreadcrumbs: true,
      },
      autoRefresh: false,
      isPinned: false,
      gridPosition: findNextAvailablePosition({ width: 4, height: 6 }),
      gridSize: { width: 4, height: 6 },
    };
    
    // folderId is optional, so we don't include it if undefined

    try {
      await dashboardAPI.addTile(newTile, activeTab.id, user.id);
      await reloadFromDatabase();
    } catch (error) {
      console.error('Failed to create folder tile:', error);
    }
  };


  // OLD SYSTEM - commented out
  /*
  const handleTileConfigSubmit = async () => {
    if (!selectedTileType || !activeTab) return;

    try {
      // Create tile data for the API
      const tileData = {
        type: selectedTileType.id as "crypto" | "custom" | "stock" | "placeholder" | "folder",
        title: tileConfig.title || tileConfig.symbol || tileConfig.name || selectedTileType.name,
        symbol: tileConfig.symbol,
        timeframe: tileConfig.timeframe,
        name: tileConfig.name, // For portfolio tiles
        content: tileConfig.content, // For custom tiles
        prompt: tileConfig.prompt, // For chat_generated tiles
        folderPath: tileConfig.folderPath || '', // For folder tiles
        folderId: tileConfig.folderId, // For folder tiles
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
  */

  // TODO: Handle crypto tile addition using the existing AddCryptoModal
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

  // const getExistingSymbols = () => tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol));

  const handleRemoveTile = useCallback(async (id: string) => {
    if (!activeTab || !user?.id) {
      console.warn('No active tab or user found, cannot remove tile');
      return;
    }

    try {
      // Immediately delete from backend to prevent tile from reappearing
      await dashboardAPI.removeTile(id);
      console.log('✅ Tile deleted from backend:', id);
      
      // Then update local state
      const updatedTiles = (activeTab.tiles || []).filter((tile: any) => tile.id !== id);
      updateTabTiles(activeTab.id, updatedTiles);
    } catch (error) {
      console.error('❌ Failed to delete tile from backend:', error);
      // Still update local state even if backend call fails
      const updatedTiles = (activeTab.tiles || []).filter((tile: any) => tile.id !== id);
      updateTabTiles(activeTab.id, updatedTiles);
    }
  }, [activeTab, updateTabTiles, user?.id]);

  const handleDuplicateTile = async (tileId: string) => {
    if (!user || !activeTab) {
      console.warn('No user or active tab found, cannot duplicate tile');
      return;
    }

    try {
      // Find the source tile to get its size
      const sourceTile = tiles.find(t => t.id === tileId);
      if (!sourceTile) {
        setSnackbar({
          open: true,
          message: 'Tile not found',
          severity: 'error'
        });
        return;
      }

      // Get tile size (use gridSize if available, otherwise default)
      const tileSize = sourceTile.gridSize || getDefaultTileSize(sourceTile.type);
      
      // Calculate next available position using the same logic as new tiles
      const gridPosition = findNextAvailablePosition(tileSize);

      const response = await dashboardAPI.duplicateTile(tileId, activeTab.id, user.id, gridPosition);
      if (response.success && response.tile) {
        // Reload from database to get the duplicated tile
        await reloadFromDatabase();
        setSnackbar({
          open: true,
          message: 'Tile duplicated successfully',
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: response.error || 'Failed to duplicate tile',
          severity: 'error'
        });
      }
    } catch (error: any) {
      console.error('Error duplicating tile:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to duplicate tile',
        severity: 'error'
      });
    }
  };

  const handleDuplicateTab = async (tabId: string) => {
    if (!user) {
      console.warn('No user found, cannot duplicate tab');
      return;
    }

    try {
      const response = await dashboardAPI.duplicateTab(tabId, user.id);
      if (response.success && response.tab) {
        // Reload from database to get the duplicated tab
        await reloadFromDatabase();
        // Activate the duplicated tab
        if (response.tab.id) {
          activateTab(response.tab.id);
        }
        setSnackbar({
          open: true,
          message: 'Tab duplicated successfully',
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: response.error || 'Failed to duplicate tab',
          severity: 'error'
        });
      }
    } catch (error: any) {
      console.error('Error duplicating tab:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to duplicate tab',
        severity: 'error'
      });
    }
  };

  const handleDuplicateGroup = async (groupId: string) => {
    if (!user) {
      console.warn('No user found, cannot duplicate group');
      return;
    }

    try {
      const response = await dashboardAPI.duplicateGroup(groupId, user.id);
      if (response.success && response.group) {
        // Reload from database to get the duplicated group
        await reloadFromDatabase();
        setSnackbar({
          open: true,
          message: response.message || `Group duplicated successfully with ${response.tileCount || 0} tiles`,
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: response.error || 'Failed to duplicate group',
          severity: 'error'
        });
      }
    } catch (error: any) {
      console.error('Error duplicating group:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to duplicate group',
        severity: 'error'
      });
    }
  };

  // Helper function to clean up old tile results from sessionStorage
  const cleanupOldTileResults = useCallback((keepTileIds: Set<string>) => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('tile_results_')) {
          const tileId = key.replace('tile_results_', '');
          if (!keepTileIds.has(tileId)) {
            keysToRemove.push(key);
          }
        }
      }
      // Remove old entries
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      if (keysToRemove.length > 0) {
        console.log(`🧹 Cleaned up ${keysToRemove.length} old tile results from sessionStorage`);
      }
    } catch (error) {
      console.warn('Failed to cleanup old tile results:', error);
    }
  }, []);

  const handleUpdateTile = useCallback((id: string, data: any) => {
    if (!activeTabId) {
      console.warn('No active tab ID found, cannot update tile');
      return;
    }

    // Filter out results, paginationState, and lastUpdated - these should only be in session storage, not database
    // onUpdate is for session-only data (results, paginationState), onSettingsChange is for database persistence (config)
    const { results, paginationState, lastUpdated, ...configData } = data;
    
    // Store results and paginationState in sessionStorage only (not in tile state that gets saved to database)
    if (results !== undefined || paginationState !== undefined) {
      try {
        const sessionData: any = {};
        if (results !== undefined) sessionData.results = results;
        if (paginationState !== undefined) sessionData.paginationState = paginationState;
        if (lastUpdated !== undefined) sessionData.lastUpdated = lastUpdated;
        sessionStorage.setItem(`tile_results_${id}`, JSON.stringify(sessionData));
      } catch (error: any) {
        // Handle quota exceeded errors gracefully
        if (error.name === 'QuotaExceededError') {
          console.warn(`⚠️ SessionStorage quota exceeded for tile ${id}, cleaning up and saving minimal data...`);
          try {
            // Clean up old tile results first (keep only current tab's tiles)
            const currentTiles = activeTab?.tiles || [];
            const currentTileIds = new Set(currentTiles.map((t: any) => t.id));
            cleanupOldTileResults(currentTileIds);
            
            // Try saving only pagination state and metadata, not full results
            const minimalData: any = {};
            if (paginationState !== undefined) minimalData.paginationState = paginationState;
            if (lastUpdated !== undefined) minimalData.lastUpdated = lastUpdated;
            // Don't save results at all if quota is exceeded - just metadata
            minimalData.totalResults = results !== undefined && Array.isArray(results) ? results.length : 0;
            minimalData.hasMore = results !== undefined && Array.isArray(results) && paginationState?.hasMore === true;
            
            sessionStorage.setItem(`tile_results_${id}`, JSON.stringify(minimalData));
            console.log(`✅ Saved minimal data for tile ${id} (pagination only, no results)`);
          } catch (retryError: any) {
            // If still failing, try removing this specific tile's old data and retry
            try {
              sessionStorage.removeItem(`tile_results_${id}`);
              const minimalData: any = {};
              if (paginationState !== undefined) minimalData.paginationState = paginationState;
              if (lastUpdated !== undefined) minimalData.lastUpdated = lastUpdated;
              sessionStorage.setItem(`tile_results_${id}`, JSON.stringify(minimalData));
              console.log(`✅ Saved minimal data for tile ${id} after cleanup`);
            } catch (finalError) {
              console.error('Failed to save even minimal data to sessionStorage after cleanup:', finalError);
              // At this point, we just skip storing in sessionStorage - the tile will work without cached results
            }
          }
        } else {
          console.error('Failed to store results in sessionStorage:', error);
        }
      }
    }

    // Only update tile state with non-result data (if any config data remains)
    if (Object.keys(configData).length > 0) {
      updateTabTiles(activeTabId, (currentTiles) => {
        const updatedTiles = currentTiles.map((tile: any) => 
          tile.id === id ? { ...tile, ...configData } : tile
        );
        
        return updatedTiles;
      });
    }
  }, [activeTabId, updateTabTiles, activeTab, cleanupOldTileResults]);

  const handleSettingsChange = useCallback((id: string, settings: any) => {
    if (!activeTabId) {
      console.warn('No active tab ID found, cannot update tile settings');
      return;
    }
    
    // Log when searchParams are being saved
    if (settings.searchParams) {
      console.log('💾 UnifiedDashboardPage: handleSettingsChange called with searchParams:', {
        tileId: id,
        searchParams: settings.searchParams,
        general_text_search_fields: settings.searchParams.general_text_search_fields
      });
    }
    
    // Use a function-based approach to get CURRENT tiles from state
    // This ensures we always work with the latest data, not stale closures
    // Note: All settings (including paginationState) are persisted to database via updateTabTiles -> debouncedSaveToDatabase
    // Deep merge for nested objects like paginationState to preserve existing values
    updateTabTiles(activeTabId, (currentTiles: any[]) => {
      const updatedTiles = currentTiles.map((tile: any) => {
        if (tile.id === id) {
          // Deep merge for nested objects (paginationState, displayOptions, etc.)
          // Always create a new object to ensure React detects the change
          const mergedSettings = { ...tile };
          Object.keys(settings).forEach(key => {
            // Special handling for paginationState - always replace entirely to preserve lastEvaluatedKeys array
            if (key === 'paginationState' && settings[key] && typeof settings[key] === 'object' && !Array.isArray(settings[key])) {
              mergedSettings[key] = { ...settings[key] }; // Replace entirely, don't merge
            } else if (key === 'searchParams' && settings[key] && typeof settings[key] === 'object' && !Array.isArray(settings[key])) {
              // Special handling for searchParams - replace entirely to preserve nested structure (general_text_search_fields, arrays, etc.)
              mergedSettings[key] = JSON.parse(JSON.stringify(settings[key])); // Deep copy to ensure all nested objects/arrays are preserved
            } else if (typeof settings[key] === 'object' && settings[key] !== null && !Array.isArray(settings[key]) && tile[key]) {
              // Deep merge for other objects (displayOptions, filterSettings, etc.)
              mergedSettings[key] = { ...tile[key], ...settings[key] };
            } else {
              // Shallow merge for primitives and arrays
              mergedSettings[key] = settings[key];
            }
          });
          
          // Always return a new object reference to ensure React detects changes
          // This is especially important for customization props (customTitle, customColor, customIcon)
          return { ...mergedSettings };
        }
        return tile;
      });
      
      return updatedTiles;
    });
  }, [activeTabId, updateTabTiles]);

  const handleResizeTile = useCallback((id: string, size: { width: number; height: number }) => {
    if (!activeTabId) return;

    // Convert pixel size back to grid size for consistency
    const GRID_CELL_SIZE = 80;
    const GRID_GAP = 16;
    const gridSize = {
      width: Math.round((size.width + GRID_GAP) / (GRID_CELL_SIZE + GRID_GAP)),
      height: Math.round((size.height + GRID_GAP) / (GRID_CELL_SIZE + GRID_GAP))
    };

    console.log('🔧 Converted to grid size:', gridSize);
    
    // Use functional update to get current tiles
    updateTabTiles(activeTabId, (currentTiles) => {
      const updatedTiles = currentTiles.map(tile => 
        tile.id === id ? { 
          ...tile, 
          size, // Keep legacy size for backward compatibility
          gridSize // Update grid size for new system
        } : tile
      );
      return updatedTiles;
    });
  }, [activeTabId, updateTabTiles]);

  const handleMoveTile = useCallback((id: string, position: GridPosition) => {
    if (!activeTabId) return;
    
    // Use functional update to get current tiles
    updateTabTiles(activeTabId, (currentTiles) => {
      return currentTiles.map(tile => 
        tile.id === id ? { ...tile, gridPosition: position } : tile
      );
    });
  }, [activeTabId, updateTabTiles]);

  // Share dashboard handlers
  const handleShareLink = async () => {
    if (!activeTab || !user?.id) {
      setSnackbar({ open: true, message: 'Unable to share: No active tab or user', severity: 'error' });
      return;
    }

    setShareLinkLoading(true);
    try {
      const response = await dashboardAPI.shareDashboard(activeTab.id, user.id, 'link');
      if (response.success && response.shareId) {
        // Construct full share link URL
        const fullLink = `${window.location.origin}${response.shareLink || `/dashboard/shared/${response.shareId}`}`;
        setShareLink(fullLink);
        setSnackbar({ open: true, message: 'Share link generated successfully!', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: response.error || 'Failed to generate share link', severity: 'error' });
      }
    } catch (error: any) {
      console.error('Error sharing dashboard:', error);
      setSnackbar({ open: true, message: 'Failed to generate share link', severity: 'error' });
    } finally {
      setShareLinkLoading(false);
    }
  };

  const handleCopyShareLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setShareLinkCopied(true);
      setSnackbar({ open: true, message: 'Link copied to clipboard!', severity: 'success' });
      setTimeout(() => setShareLinkCopied(false), 2000);
    }
  };

  const handleCloseShareDialog = () => {
    setShareLinkDialogOpen(false);
    setShareLink('');
    setShareLinkCopied(false);
  };

  const handleDownloadDashboard = async () => {
    if (!activeTab || !user?.id) {
      setSnackbar({ open: true, message: 'Unable to download: No active tab or user', severity: 'error' });
      return;
    }

    try {
      const response = await dashboardAPI.shareDashboard(activeTab.id, user.id, 'download');
      if (response.success && response.downloadUrl) {
        // Create a temporary link and trigger download
        const link = document.createElement('a');
        link.href = response.downloadUrl;
        link.download = `${activeTab.name || 'dashboard'}.cosine`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setSnackbar({ open: true, message: 'Dashboard downloaded successfully!', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: response.error || 'Failed to download dashboard', severity: 'error' });
      }
    } catch (error: any) {
      console.error('Error downloading dashboard:', error);
      setSnackbar({ open: true, message: 'Failed to download dashboard', severity: 'error' });
    }
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
        onTabDuplicate={handleDuplicateTab}
        onGroupDuplicate={handleDuplicateGroup}
        getTabsByGroup={getTabsByGroup}
      />
      
      <Container maxWidth={false} sx={{ p: 2, px: 4 }}>
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
            {activeTab?.name || 'Dashboard'}
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

        {/* Zoom Controls - positioned closer to dashboard */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 2,
            justifyContent: 'flex-start',
          }}
        >
            <Tooltip title="Zoom Out (Ctrl/Cmd + -)">
              <IconButton
                onClick={() => setZoomLevel(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM))}
                disabled={zoomLevel <= MIN_ZOOM}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomOut fontSize="small" />
              </IconButton>
            </Tooltip>
            
            <Chip
              label={`${Math.round(zoomLevel * 100)}%`}
              size="small"
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                fontWeight: 600,
                minWidth: 60,
                cursor: 'default',
              }}
            />
            
            <Tooltip title="Zoom In (Ctrl/Cmd + +)">
              <IconButton
                onClick={() => setZoomLevel(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM))}
                disabled={zoomLevel >= MAX_ZOOM}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomIn fontSize="small" />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Reset Zoom (Ctrl/Cmd + 0)">
              <IconButton
                onClick={() => setZoomLevel(1.0)}
                disabled={zoomLevel === 1.0}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomOutMap fontSize="small" />
              </IconButton>
            </Tooltip>
            
            {/* Divider */}
            <Box
              sx={{
                width: '1px',
                height: '24px',
                backgroundColor: '#374151',
                mx: 0.5,
              }}
            />
            
            {/* Share Button */}
            <Tooltip title="Share Dashboard">
              <IconButton
                onClick={(e) => setShareMenuAnchor(e.currentTarget)}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                }}
              >
                <ShareIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          
          {/* Share Menu */}
          <Menu
            anchorEl={shareMenuAnchor}
            open={Boolean(shareMenuAnchor)}
            onClose={() => setShareMenuAnchor(null)}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'left',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            PaperProps={{
              sx: {
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                minWidth: 200,
                mt: 0.5,
              }
            }}
          >
            <MenuItem
              onClick={() => {
                setShareMenuAnchor(null);
                setShareLinkDialogOpen(true);
              }}
              sx={{
                color: '#e5e7eb',
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              }}
            >
              <ListItemIcon>
                <LinkIcon fontSize="small" sx={{ color: '#60a5fa' }} />
              </ListItemIcon>
              <ListItemText>Share Link</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={async () => {
                setShareMenuAnchor(null);
                await handleDownloadDashboard();
              }}
              sx={{
                color: '#e5e7eb',
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              }}
            >
              <ListItemIcon>
                <DownloadIcon fontSize="small" sx={{ color: '#60a5fa' }} />
              </ListItemIcon>
              <ListItemText>Download as .cosine</ListItemText>
            </MenuItem>
          </Menu>
          
          {/* Share Link Dialog */}
          <Dialog
            open={shareLinkDialogOpen}
            onClose={handleCloseShareDialog}
            maxWidth="sm"
            fullWidth
            PaperProps={{
              sx: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid #374151',
              }
            }}
          >
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#ffffff' }}>
              <Typography variant="h6">Share Dashboard</Typography>
              <IconButton onClick={handleCloseShareDialog} sx={{ color: '#9ca3af' }}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pt: 2 }}>
              {!shareLink ? (
                <Box>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={handleShareLink}
                    disabled={shareLinkLoading || !activeTab}
                    sx={{
                      backgroundColor: 'rgba(31, 41, 55, 0.5) !important',
                      color: '#9ca3af !important',
                      borderRadius: '0px',
                      border: '2px solid #4b5563 !important',
                      fontWeight: 600,
                      textTransform: 'none',
                      px: 2,
                      py: 1,
                      '&.MuiButton-contained': {
                        backgroundColor: 'rgba(31, 41, 55, 0.5) !important',
                        color: '#9ca3af !important',
                        border: '2px solid #4b5563 !important',
                      },
                      '&:hover': {
                        backgroundColor: '#475569 !important',
                        borderColor: '#6b7280 !important',
                        color: '#9ca3af !important',
                      },
                      '&:disabled': {
                        backgroundColor: 'rgba(31, 41, 55, 0.3) !important',
                        borderColor: '#4b5563 !important',
                        color: '#6b7280 !important',
                      },
                    }}
                  >
                    {shareLinkLoading ? <CircularProgress size={24} sx={{ color: '#9ca3af' }} /> : 'Generate Share Link'}
                  </Button>
                </Box>
              ) : (
                <Box>
                  <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
                    Copy this link to share your dashboard:
                  </Typography>
                  <TextField
                    fullWidth
                    value={shareLink}
                    InputProps={{
                      readOnly: true,
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={handleCopyShareLink} sx={{ color: '#9ca3af', '&:hover': { color: '#d1d5db', backgroundColor: 'rgba(71, 85, 105, 0.2)' } }}>
                            {shareLinkCopied ? <CheckIcon /> : <CopyIcon />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      mb: 2,
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(31, 41, 55, 0.5)',
                        color: '#ffffff',
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block' }}>
                    {shareLinkCopied ? 'Link copied to clipboard!' : 'Click the copy icon to copy the link'}
                  </Typography>
                </Box>
              )}
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
              <Button onClick={handleCloseShareDialog} sx={{ color: '#9ca3af' }}>
                Close
              </Button>
            </DialogActions>
          </Dialog>
          
          {/* Snackbar for notifications */}
          <Snackbar
            open={snackbar.open}
            autoHideDuration={3000}
            onClose={() => setSnackbar({ ...snackbar, open: false })}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <Alert
              onClose={() => setSnackbar({ ...snackbar, open: false })}
              severity={snackbar.severity}
              sx={{
                backgroundColor: snackbar.severity === 'success' ? '#10b981' : '#ef4444',
                color: '#ffffff',
              }}
            >
              {snackbar.message}
            </Alert>
          </Snackbar>

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
            onDuplicateTile={handleDuplicateTile}
            zoomLevel={zoomLevel}
          />
        )}

        {/* New Add Tile Menu */}
        <AddTileMenu
          open={addTileMenuOpen}
          onClose={() => setAddTileMenuOpen(false)}
          onAddTile={handleAddTile}
          tileCategories={tileCategories}
        />

        {/* Old Multi-Step Add Tile Flow - Keeping for reference, can be removed */}
        {/* Step 1: Category Selection */}
        {/* <Dialog 
          open={addTileStep === 'category-selection'} 
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
              Choose a category to browse available tiles
            </Typography>
            <Grid container spacing={2}>
              {tileCategories.map((category) => (
                <Grid item xs={12} sm={6} md={4} key={category.id}>
                  <Card 
                    sx={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '2px solid #374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: category.color,
                        transform: 'translateY(-2px)',
                        boxShadow: `0 8px 32px ${category.color}20`
                      }
                    }}
                    onClick={() => handleCategorySelect(category)}
                  >
                    <CardActionArea sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Box 
                          sx={{ 
                            color: category.color,
                            mr: 2,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          {category.icon}
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff' }}>
                          {category.name}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                        {category.description}
                      </Typography>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </DialogContent>
        </Dialog> */}

        {/* Step 2: Subcategory Selection */}
        {/* <Dialog 
          open={addTileStep === 'subcategory-selection'} 
          onClose={handleBackToCategories}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ 
            backgroundColor: '#1e293b', 
            color: '#ffffff',
            borderBottom: '1px solid #374151'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <IconButton 
                  onClick={handleBackToCategories}
                  sx={{ color: '#9ca3af', mr: 1 }}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h6">{selectedCategory?.name}</Typography>
              </Box>
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
              Choose a subcategory to see available tiles
            </Typography>
            <Grid container spacing={2}>
              {selectedCategory?.subcategories.map((subcategory) => (
                <Grid item xs={12} sm={6} md={4} key={subcategory.id}>
                  <Card 
                    sx={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '2px solid #374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: subcategory.color,
                        transform: 'translateY(-2px)',
                        boxShadow: `0 8px 32px ${subcategory.color}20`
                      }
                    }}
                    onClick={() => handleSubcategorySelect(subcategory)}
                  >
                    <CardActionArea sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Box 
                          sx={{ 
                            color: subcategory.color,
                            mr: 2,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          {subcategory.icon}
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff' }}>
                          {subcategory.name}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                        {subcategory.description}
                      </Typography>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </DialogContent>
        </Dialog> */}

        {/* Step 3: Tile Selection */}
        {/* <Dialog 
          open={addTileStep === 'tile-selection'} 
          onClose={handleBackToCategories}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ 
            backgroundColor: '#1e293b', 
            color: '#ffffff',
            borderBottom: '1px solid #374151'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <IconButton 
                  onClick={selectedSubcategory ? handleBackToSubcategories : handleBackToCategories}
                  sx={{ color: '#9ca3af', mr: 1 }}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h6">
                  {selectedCategory?.name} - {selectedSubcategory?.name}
                </Typography>
              </Box>
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
              Select the tile you want to add to your dashboard
            </Typography>
            <Grid container spacing={2}>
              {selectedSubcategory?.tiles.map((tileType) => (
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


        {/* Crypto and Stock Modals */}
        {/* <AddCryptoModal
          open={cryptoModalOpen}
          onClose={() => setCryptoModalOpen(false)}
          onAdd={handleAddCryptoTile}
          existingSymbols={getExistingSymbols()}
        />

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
          onImportTab={handleImportTab}
          tabGroups={tabGroups}
        />

        {/* New Group Dialog */}
        <NewGroupDialog
          open={newGroupDialogOpen}
          onClose={() => setNewGroupDialogOpen(false)}
          onCreateGroup={handleCreateNewGroup}
        />

        {/* Add Crypto Modal */}
        <AddCryptoModal
          open={cryptoModalOpen}
          onClose={() => setCryptoModalOpen(false)}
          onAdd={handleAddCryptoTile}
          existingSymbols={tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol))}
        />

        {/* Add Stock Modal */}
        <AddStockModal
          open={stockModalOpen}
          onClose={() => setStockModalOpen(false)}
          onAdd={handleAddStockTile}
          existingSymbols={tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol))}
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
