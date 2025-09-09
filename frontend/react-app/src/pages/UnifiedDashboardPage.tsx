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
import CryptoTile from '../components/CryptoTile';
import DashboardGrid from '../components/DashboardGrid';
import AddCryptoModal from '../components/AddCryptoModal';
import DashboardTabBar from '../components/DashboardTabBar';
import NewTabDialog from '../components/NewTabDialog';
import NewGroupDialog from '../components/NewGroupDialog';

// Import placeholder tile components (to be created)
import PlaceholderTile from '../components/PlaceholderTile';

// Import tab management hook and types
import { useTabManagement } from '../hooks/useTabManagement';
import { UnifiedTile } from '../types/dashboardTypes';

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
    placeholder: true
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
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Tab management
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
  } = useTabManagement({ userId: 'current-user' }); // TODO: Get actual user ID

  // Multi-step tile addition state
  const [addTileStep, setAddTileStep] = useState<'closed' | 'type-selection' | 'configuration'>('closed');
  const [selectedTileType, setSelectedTileType] = useState<TileTypeDefinition | null>(null);
  const [tileConfig, setTileConfig] = useState<any>({});

  // Dialog states
  const [cryptoModalOpen, setCryptoModalOpen] = useState(false);
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);

  // Debounced save functionality (from crypto page)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<UnifiedTile[] | null>(null);

  // Get current tiles from active dashboard
  const tiles = activeDashboard?.tiles || [];

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

  // Load from localStorage
  const loadFromLocalStorage = useCallback((): UnifiedTile[] | null => {
    try {
      const saved = localStorage.getItem('unified-dashboard-tiles');
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      return null;
    }
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

  // Helper function to update dashboard tiles
  const updateDashboardTiles = useCallback((updatedTiles: UnifiedTile[]) => {
    if (!activeDashboard) return;

    // Update the dashboard in the tab management system
    updateTabDashboardTiles(activeDashboard.id, updatedTiles);

    // Update localStorage with all tiles (including other dashboards)
    const allTiles = loadFromLocalStorage() || [];
    const otherDashboardTiles = allTiles.filter(tile => tile.dashboard_id !== activeDashboard.id);
    const allUpdatedTiles = [...otherDashboardTiles, ...updatedTiles];
    saveToLocalStorage(allUpdatedTiles);
    
    // Trigger debounced save to database
    debouncedSaveToDatabase(allUpdatedTiles);

    console.log('Updated tiles for dashboard:', activeDashboard.id, updatedTiles);
  }, [activeDashboard, updateTabDashboardTiles, saveToLocalStorage, debouncedSaveToDatabase, loadFromLocalStorage]);

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
      
      // TODO: Replace with actual API call to save user dashboard
      console.log('Saving dashboard configuration to database:', updatedTiles);
    } catch (error) {
      console.error('Error saving dashboard:', error);
    }
  };

  // Enhanced tile addition flow
  const handleAddTileClick = () => {
    setAddTileStep('type-selection');
    setSelectedTileType(null);
    setTileConfig({});
  };

  const handleTileTypeSelect = (tileType: TileTypeDefinition) => {
    // If crypto tile, use the existing AddCryptoModal
    if (tileType.id === 'crypto') {
      setCryptoModalOpen(true);
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
      title: tileConfig.title || tileConfig.symbol || selectedTileType.name,
      symbol: tileConfig.symbol,
      timeframe: tileConfig.timeframe,
      displayOptions: tileConfig.displayOptions,
      autoRefresh: tileConfig.autoRefresh || false,
      isPinned: false,
      size: { width: 350, height: 400 },
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
    const newTile: UnifiedTile = {
      id: `tile_${Date.now()}`,
      type: 'crypto',
      title: cryptoData.symbol,
      symbol: cryptoData.symbol,
      timeframe: cryptoData.timeframe,
      displayOptions: cryptoData.displayOptions,
      autoRefresh: cryptoData.autoRefresh,
      isPinned: false,
      size: { width: 350, height: 400 },
      dashboard_id: activeDashboard?.id || 'main',
      created_at: new Date().toISOString(),
    };

    const updatedTiles = [...tiles, newTile];
    updateDashboardTiles(updatedTiles);
  };

  const getExistingSymbols = () => tiles.map(tile => tile.symbol).filter((symbol): symbol is string => Boolean(symbol));

  const handleRemoveTile = (id: string) => {
    const updatedTiles = tiles.filter(tile => tile.id !== id);
    updateDashboardTiles(updatedTiles);
  };

  const handleUpdateTile = (id: string, data: any) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, ...data } : tile
    );
    updateDashboardTiles(updatedTiles);
  };

  const handleSettingsChange = (id: string, settings: any) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, ...settings } : tile
    );
    updateDashboardTiles(updatedTiles);
  };

  const handleResizeTile = (id: string, size: { width: number; height: number }) => {
    const updatedTiles = tiles.map(tile => 
      tile.id === id ? { ...tile, size } : tile
    );
    updateDashboardTiles(updatedTiles);
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
            Unified Dashboard
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Your personalized financial command center
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
          <DashboardGrid
            tiles={tiles}
            onRemoveTile={handleRemoveTile}
            onUpdateTile={handleUpdateTile}
            onSettingsChange={handleSettingsChange}
            onResizeTile={handleResizeTile}
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
