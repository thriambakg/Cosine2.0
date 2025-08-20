import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Box, 
  Typography, 
  Container,
  Alert,
  Fab,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { loadConfig, validateConfig, getConfig } from '../config/configLoader';
import { logApiConfig } from '../config/api';
import CryptoTile from '../components/CryptoTile';
import AddCryptoModal from '../components/AddCryptoModal';
import DashboardGrid from '../components/DashboardGrid';

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

interface CryptoTile {
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

const CryptoStatsPage: React.FC = () => {
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const [tiles, setTiles] = useState<CryptoTile[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Debounced save functionality
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<CryptoTile[] | null>(null);

  // Load configuration and validate on component mount
  useEffect(() => {
    const initializeConfig = async () => {
      try {
        await loadConfig();
        const validation = validateConfig();
        setConfigValid(validation.isValid);
        setConfigErrors(validation.errors);
        
        // Log API configuration for debugging
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
  const saveToLocalStorage = useCallback((updatedTiles: CryptoTile[]) => {
    try {
      localStorage.setItem('crypto-dashboard-tiles', JSON.stringify(updatedTiles));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, []);

  // Load from localStorage
  const loadFromLocalStorage = useCallback((): CryptoTile[] | null => {
    try {
      const saved = localStorage.getItem('crypto-dashboard-tiles');
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      return null;
    }
  }, []);

  // Debounced save to database
  const debouncedSaveToDatabase = useCallback((updatedTiles: CryptoTile[]) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set pending save
    pendingSaveRef.current = updatedTiles;

    // Set new timeout for 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        saveUserDashboard(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    }, 2000);
  }, []);

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
      
      // First try to load from localStorage for immediate persistence
      const cachedTiles = loadFromLocalStorage();
      if (cachedTiles && cachedTiles.length > 0) {
        setTiles(cachedTiles);
        console.log('Loaded dashboard from localStorage');
      } else {
        // TODO: Replace with actual API call to load user dashboard
        // For now, use default configuration
                 const defaultTiles: CryptoTile[] = [
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
           }
         ];
        setTiles(defaultTiles);
        // Save default to localStorage
        saveToLocalStorage(defaultTiles);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveUserDashboard = async (updatedTiles: CryptoTile[]) => {
    try {
      // Save to localStorage immediately
      saveToLocalStorage(updatedTiles);
      
      // TODO: Replace with actual API call to save user dashboard
      console.log('Saving dashboard configuration to database:', updatedTiles);
      // API call would go here
    } catch (error) {
      console.error('Error saving dashboard:', error);
    }
  };

           const handleAddTile = (cryptoData: any) => {
      const newTile: CryptoTile = {
        id: `tile_${Date.now()}`,
        symbol: cryptoData.symbol,
        timeframe: cryptoData.timeframe,
        displayOptions: cryptoData.displayOptions,
        autoRefresh: cryptoData.autoRefresh,
        isPinned: false,
        size: { width: 350, height: 400 },
        created_at: new Date().toISOString(),
      };

     const updatedTiles = [...tiles, newTile];
     setTiles(updatedTiles);
     saveToLocalStorage(updatedTiles);
     debouncedSaveToDatabase(updatedTiles);
   };

     const handleRemoveTile = (id: string) => {
     const updatedTiles = tiles.filter(tile => tile.id !== id);
     setTiles(updatedTiles);
     saveToLocalStorage(updatedTiles);
     debouncedSaveToDatabase(updatedTiles);
   };

     const handleUpdateTile = (id: string, data: any) => {
     const updatedTiles = tiles.map(tile => 
       tile.id === id ? { ...tile, ...data } : tile
     );
     setTiles(updatedTiles);
     saveToLocalStorage(updatedTiles);
     debouncedSaveToDatabase(updatedTiles);
   };

           const handleSettingsChange = (id: string, settings: any) => {
      const updatedTiles = tiles.map(tile => 
        tile.id === id ? { ...tile, ...settings } : tile
      );
      setTiles(updatedTiles);
      saveToLocalStorage(updatedTiles);
      debouncedSaveToDatabase(updatedTiles);
    };

       const handleResizeTile = (id: string, size: { width: number; height: number }) => {
      const updatedTiles = tiles.map(tile => 
        tile.id === id ? { ...tile, size } : tile
      );
      setTiles(updatedTiles);
      saveToLocalStorage(updatedTiles);
      debouncedSaveToDatabase(updatedTiles);
    };

  const getExistingSymbols = () => tiles.map(tile => tile.symbol);

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth="xl">
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
            Cryptocurrency Dashboard
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Personalized cryptocurrency tracking and analysis
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

        {/* Add Crypto Modal */}
        <AddCryptoModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onAdd={handleAddTile}
          existingSymbols={getExistingSymbols()}
        />

                 {/* Floating Add Button */}
         <Fab
           color="primary"
           aria-label="add tile"
           onClick={() => setAddModalOpen(true)}
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

export default CryptoStatsPage;
