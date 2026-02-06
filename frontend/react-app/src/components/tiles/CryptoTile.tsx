import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  Select,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Close as CloseIcon,
  PushPin as PinIcon,
  AutoAwesome as AutoRefreshIcon,
  Visibility as VisibilityIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { useCryptoStats } from '../../hooks/useAPI';
import { useTileCache } from '../../hooks/useDashboardCache';
import { useTilePinning, PinButton, confirmDialog } from './common';
import { useDemoDashboard } from '@/contexts/DemoDashboardContext';

interface CryptoTileProps {
  id: string;
  symbol: string;
  timeframe: string;
  displayOptions?: {
    showPrice: boolean;
    showPriceMarker: boolean;
    show24hChange: boolean;
    showAnnualReturn: boolean;
    showVolatility: boolean;
    showChart: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  size?: { width: number; height: number };
  dashboardContext?: string; // Add dashboard context for cache isolation
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResize?: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
}

const CryptoTile: React.FC<CryptoTileProps> = ({
  id,
  symbol,
  timeframe,
  displayOptions = {
    showPrice: true,
    showPriceMarker: false,
    show24hChange: true,
    showAnnualReturn: true,
    showVolatility: true,
    showChart: true,
  },
  autoRefresh = false,
  isPinned = false,
  dashboardContext,
  onRemove,
  onUpdate: _onUpdate,
  onSettingsChange,
  onDragStart,
  onResizeStart: _onResizeStart,
  isDragging = false,
  isResizing: _isResizing = false,
  isSelected = false,
  onSelectionChange,
}) => {
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const lastClickTimeRef = useRef<number>(0);
  
  const [timeframeDialogOpen, setTimeframeDialogOpen] = useState(false);
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false);
  const [localTimeframe, setLocalTimeframe] = useState(timeframe);
  const [localDisplayOptions, setLocalDisplayOptions] = useState(displayOptions);
  const tileRef = useRef<HTMLDivElement>(null);
  const { isDemo: isDemoContext } = useDemoDashboard();
  const isDemo = Boolean(isDemoContext || dashboardContext === 'demo');

  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Get the API hook for fetching data (skip in demo)
  const { executeForceRefresh } = useCryptoStats();
  
  const fetchCryptoData = useCallback(async () => {
    const result = await executeForceRefresh({ symbols: [symbol], timeframe });
    return result;
  }, [executeForceRefresh, symbol, timeframe]);
  
  const { data: cryptoData, loading: isLoading, error, refresh } = useTileCache(
    id,
    'crypto',
    fetchCryptoData,
    [symbol, timeframe],
    {
      ttl: 5 * 60 * 1000,
      useSessionStorage: true,
      enabled: !isDemo,
      forceRefresh: false,
      dashboardContext,
    }
  );

  const crypto = cryptoData?.data?.find((c: any) => c.symbol === symbol);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      handleFetchData();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [autoRefresh, symbol, timeframe]);

  const handleFetchData = async () => {
    try {
      await refresh();
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error);
    }
  };

  const handleRefresh = () => {
    refresh(); // Use the cache refresh method
  };

  const handleSettingsOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  };

  const handleSettingsClose = () => {
    setSettingsAnchor(null);
  };

  const handleTimeframeChange = (newTimeframe: string) => {
    setLocalTimeframe(newTimeframe);
    onSettingsChange(id, { timeframe: newTimeframe });
    setTimeframeDialogOpen(false);
    // Force refresh data to get new chart data for the timeframe
    refresh();
  };

  const handleDisplayOptionsChange = (option: keyof typeof displayOptions) => {
    const newOptions = {
      ...localDisplayOptions,
      [option]: !localDisplayOptions[option],
    };
    setLocalDisplayOptions(newOptions);
    onSettingsChange(id, { displayOptions: newOptions });
  };

  const handleAutoRefreshToggle = () => {
    onSettingsChange(id, { autoRefresh: !autoRefresh });
  };

  const handlePinToggle = () => {
    togglePin();
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: isDemo ? `Remove this tile from the demo?` : `Remove ${symbol} from dashboard?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });
    if (confirmed) onRemove(id);
  };

  // Timeframe descriptions for tooltips
  const timeframeDescriptions = {
    '1d': '1 Day - Shows 24-hour price movement and daily volatility',
    '7d': '7 Days - Shows weekly trends and short-term momentum',
    '30d': '30 Days - Shows monthly performance and medium-term patterns',
    '1y': '1 Year - Shows annual trends and long-term market behavior'
  };

  // Get chart data from API response
  const getChartData = () => {
    if (crypto?.chartData && Array.isArray(crypto.chartData) && crypto.chartData.length > 0) {
      return { data: crypto.chartData, isRealData: true };
    }
    
    // No fallback data - show unavailable message
    return { data: [], isRealData: false };
  };

  const { data: chartData, isRealData } = getChartData();

  // Calculate appropriate Y-axis domain based on price range
  const getYAxisDomain = () => {
    if (!chartData || chartData.length === 0) {
      return ['auto', 'auto'];
    }

    const prices = chartData.map(d => d.price).filter(p => p && !isNaN(p));
    if (prices.length === 0) {
      return ['auto', 'auto'];
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;
    
    // Calculate padding based on price range
    let padding;
    if (maxPrice < 1) {
      // For coins under $1, use 5% padding
      padding = range * 0.05;
    } else if (maxPrice < 100) {
      // For coins under $100, use 3% padding
      padding = range * 0.03;
    } else {
      // For higher priced coins, use 2% padding
      padding = range * 0.02;
    }
    
    // Ensure minimum doesn't go below 0 for positive prices
    const domainMin = Math.max(0, minPrice - padding);
    const domainMax = maxPrice + padding;
    
    return [domainMin, domainMax];
  };

  // Get timeframe-based return value for price marker
  const getTimeframeReturn = () => {
    if (!crypto) return 0;
    
    // Use the appropriate return based on timeframe
    switch (timeframe) {
      case '1d': return crypto.return24h || 0; // 24h change
      case '7d': return crypto.annualReturn || 0; // Period return (7 days)
      case '30d': return crypto.annualReturn || 0; // Period return (30 days)
      case '1y': return crypto.annualReturn || 0; // Period return (1 year)
      default: return crypto.return24h || 0;
    }
  };

  // Get timeframe label for price marker
  const getTimeframeLabel = () => {
    switch (timeframe) {
      case '1d': return '24h';
      case '7d': return '7d';
      case '30d': return '30d';
      case '1y': return '1y';
      default: return '24h';
    }
  };

     return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid #374151',
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        pointerEvents: pinnedState ? 'auto' : 'auto',
        userSelect: pinnedState ? 'none' : 'auto',
        '&:hover': {
          borderColor: '#f59e0b',
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : '0 8px 25px rgba(245, 158, 11, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: (crypto?.return24h ?? 0) > 0 ? '#22c55e' : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
             {/* Header with controls */}
       <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
         <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
           {/* Selection checkbox */}
           {onSelectionChange && (
             <Checkbox
               checked={isSelected}
               onClick={(e) => {
                 const now = Date.now();
                 if (now - lastClickTimeRef.current < 200) {
                   // Prevent double clicks within 200ms
                   return;
                 }
                 lastClickTimeRef.current = now;
                 
                 e.stopPropagation();
                 onSelectionChange(id, !isSelected);
               }}
               sx={{ 
                 color: '#9ca3af',
                 '&.Mui-checked': { color: '#f59e0b' },
                 p: 0.5,
                 '&:hover': { backgroundColor: 'rgba(245, 158, 11, 0.1)' }
               }}
               size="small"
               onMouseDown={(e) => {
                 e.stopPropagation();
               }}
               onMouseUp={(e) => {
                 e.stopPropagation();
               }}
             />
           )}
           {/* Crypto Symbol */}
           <Typography 
             variant="h4" 
             sx={{ 
               color: '#f59e0b', 
               fontWeight: 700, 
               fontFamily: 'monospace',
               mr: 1,
               fontSize: '1.5rem'
             }}
           >
             ₿
           </Typography>
           <Typography variant="h6" color="white" fontWeight={600}>
             {symbol}
           </Typography>
           <Tooltip title={timeframeDescriptions[timeframe as keyof typeof timeframeDescriptions]}>
             <Chip
               label={timeframe.toUpperCase()}
               size="small"
               sx={{
                 backgroundColor: 'rgba(245, 158, 11, 0.2)',
                 color: '#f59e0b',
                 border: '1px solid #f59e0b',
                 fontSize: '0.75rem',
                 height: '20px',
                 cursor: 'help'
               }}
             />
          </Tooltip>
          {autoRefresh && (
             <Tooltip title="Auto-refresh enabled">
               <AutoRefreshIcon sx={{ color: '#22c55e', fontSize: 16 }} />
             </Tooltip>
           )}
         </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <PinButton
            isPinned={pinnedState}
            onTogglePin={handlePinToggle}
          />

          <Tooltip title="Refresh data">
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={isLoading}
              sx={{ color: '#9ca3af', '&:hover': { color: '#f59e0b' } }}
            >
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton
              size="small"
              onClick={handleSettingsOpen}
              sx={{ color: '#9ca3af', '&:hover': { color: '#f59e0b' } }}
            >
              <SettingsIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Remove tile">
            <IconButton
              size="small"
              onClick={handleRemove}
              sx={{ color: '#9ca3af', '&:hover': { color: '#dc2626' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Demo: placeholder body only */}
      {isDemo ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3, px: 2 }}>
          <Typography variant="body2" sx={{ color: '#9ca3af', textAlign: 'center', maxWidth: 320 }}>
            Data for BTC and other cryptos you select would be shown here after you sign up and log in on the actual app.
          </Typography>
        </Box>
      ) : (
        <>
      {/* Loading state */}
      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <Typography variant="body2" color="#9ca3af">
            Loading {symbol}...
          </Typography>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <Typography variant="body2" color="#dc2626">
            Error loading {symbol}
          </Typography>
        </Box>
      )}

      {/* Chart Section */}
      {localDisplayOptions.showChart && (
        <>
          {isLoading && !isDemo && (
            <Box sx={{ mb: 2, height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" color="#9ca3af">
                Loading chart...
              </Typography>
            </Box>
          )}
          {(crypto && !isLoading && !error && chartData && chartData.length > 0) && (
              <Box sx={{ mb: 2, height: '120px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#9ca3af" 
                      fontSize={10}
                      tick={{ fill: '#9ca3af' }}
                      axisLine={{ stroke: '#374151' }}
                    />
                                         <YAxis 
                       stroke="#9ca3af" 
                       fontSize={10}
                       tick={{ fill: '#9ca3af' }}
                       axisLine={{ stroke: '#374151' }}
                       domain={getYAxisDomain()}
                       tickFormatter={(value) => {
                         // Format Y-axis labels based on price range
                         if (value < 0.01) {
                           return value.toFixed(4);
                         } else if (value < 1) {
                           return value.toFixed(3);
                         } else if (value < 100) {
                           return value.toFixed(2);
                         } else {
                           return value.toFixed(0);
                         }
                       }}
                     />
                                         <RechartsTooltip
                       contentStyle={{
                         backgroundColor: 'rgba(15, 23, 42, 0.95)',
                         border: '1px solid #374151',
                         borderRadius: '4px',
                         color: 'white'
                       }}
                       labelStyle={{ color: '#f59e0b' }}
                       labelFormatter={(value) => {
                         // Find the data point and return the formatted time label
                         const dataPoint = chartData.find(d => d.time === value);
                         return dataPoint?.time || value;
                       }}
                       formatter={(value) => {
                         // Format tooltip values based on price range
                         const price = Number(value);
                         let formattedPrice;
                         if (price < 0.01) {
                           formattedPrice = `$${price.toFixed(4)}`;
                         } else if (price < 1) {
                           formattedPrice = `$${price.toFixed(3)}`;
                         } else if (price < 100) {
                           formattedPrice = `$${price.toFixed(2)}`;
                         } else {
                           formattedPrice = `$${price.toFixed(0)}`;
                         }
                         return [formattedPrice, 'Price'];
                       }}
                     />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#f59e0b' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
            {crypto && !isLoading && !error && !isRealData && (
              <Box sx={{ mb: 2, height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" color="#9ca3af">
                  Chart data unavailable
                </Typography>
              </Box>
            )}
          </>
        )}

       {/* Crypto data */}
       {crypto && !isLoading && !error && (
         <Box>
           {localDisplayOptions.showPrice && (
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
               <Typography variant="h5" color="white" fontWeight={700}>
                 ${crypto.currentPrice.toFixed(2)}
               </Typography>
               {localDisplayOptions.showPriceMarker && (
                 <Typography
                   variant="caption"
                   sx={{
                     color: getTimeframeReturn() >= 0 ? '#22c55e' : '#dc2626',
                     fontWeight: 600,
                     fontSize: '0.75rem',
                     backgroundColor: 'rgba(0, 0, 0, 0.3)',
                     px: 1,
                     py: 0.25,
                     borderRadius: '4px',
                     border: `1px solid ${getTimeframeReturn() >= 0 ? '#22c55e' : '#dc2626'}`
                   }}
                 >
                   {getTimeframeReturn() >= 0 ? '+' : ''}{getTimeframeReturn().toFixed(2)}% ({getTimeframeLabel()})
                 </Typography>
               )}
             </Box>
           )}

          {localDisplayOptions.show24hChange && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="#9ca3af">
                {timeframe === '1d' ? '24h Return (%)' :
                 timeframe === '7d' ? '7-Day Return (%)' :
                 timeframe === '30d' ? '30-Day Return (%)' : '1-Year Return (%)'}:
              </Typography>
              <Typography
                variant="body2"
                color={getTimeframeReturn() > 0 ? '#22c55e' : '#dc2626'}
                fontWeight={600}
              >
                {getTimeframeReturn() > 0 ? '+' : ''}{getTimeframeReturn().toFixed(2)}%
              </Typography>
            </Box>
          )}

          {localDisplayOptions.showAnnualReturn && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="#9ca3af">
                Annualized Return (%):
              </Typography>
              <Typography
                variant="body2"
                color={crypto.annualReturn > 0 ? '#22c55e' : '#dc2626'}
                fontWeight={600}
              >
                {crypto.annualReturn > 0 ? '+' : ''}{crypto.annualReturn.toFixed(2)}%
              </Typography>
            </Box>
          )}

          {localDisplayOptions.showVolatility && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="#9ca3af">
                {timeframe === '1d' ? 'Daily Volatility (%)' : 'Annualized Volatility (%)'}:
              </Typography>
              <Typography variant="body2" color="white" fontWeight={600}>
                {crypto.annualizedVolatility.toFixed(2)}%
              </Typography>
            </Box>
                     )}
         </Box>
       )}

      {/* Settings Menu */}
      <Menu
        anchorEl={settingsAnchor}
        open={Boolean(settingsAnchor)}
        onClose={handleSettingsClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <MenuItem onClick={() => { setTimeframeDialogOpen(true); handleSettingsClose(); }}>
          <TimelineIcon sx={{ mr: 1, fontSize: 18 }} />
          Change Timeframe
        </MenuItem>
        <MenuItem onClick={() => { setDisplayDialogOpen(true); handleSettingsClose(); }}>
          <VisibilityIcon sx={{ mr: 1, fontSize: 18 }} />
          Customize Display
        </MenuItem>
        <MenuItem onClick={handleAutoRefreshToggle}>
          <AutoRefreshIcon sx={{ mr: 1, fontSize: 18 }} />
          {autoRefresh ? 'Disable' : 'Enable'} Auto-refresh
        </MenuItem>
        <MenuItem onClick={handlePinToggle}>
          <PinIcon sx={{ mr: 1, fontSize: 18 }} />
          {isPinned ? 'Unpin' : 'Pin'} to Top
        </MenuItem>
      </Menu>

      </> )}

      {/* Timeframe Dialog */}
      <Dialog
        open={timeframeDialogOpen}
        onClose={() => setTimeframeDialogOpen(false)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <DialogTitle>Select Timeframe</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <Select
              value={localTimeframe}
              onChange={(e) => handleTimeframeChange(e.target.value)}
              sx={{ color: 'white' }}
            >
              <MenuItem value="1d">1 Day</MenuItem>
              <MenuItem value="7d">7 Days</MenuItem>
              <MenuItem value="30d">30 Days</MenuItem>
              <MenuItem value="1y">1 Year</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTimeframeDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => handleTimeframeChange(localTimeframe)}>Apply</Button>
        </DialogActions>
      </Dialog>

      {/* Display Options Dialog */}
      <Dialog
        open={displayDialogOpen}
        onClose={() => setDisplayDialogOpen(false)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <DialogTitle>Display Options</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showPrice}
                  onChange={() => handleDisplayOptionsChange('showPrice')}
                />
              }
              label="Current Price"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showPriceMarker}
                  onChange={() => handleDisplayOptionsChange('showPriceMarker')}
                />
              }
              label="Price Change Marker"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.show24hChange}
                  onChange={() => handleDisplayOptionsChange('show24hChange')}
                />
              }
              label="24h Change"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showAnnualReturn}
                  onChange={() => handleDisplayOptionsChange('showAnnualReturn')}
                />
              }
              label="Annual Return"
            />
                         <FormControlLabel
               control={
                 <Checkbox
                   checked={localDisplayOptions.showVolatility}
                   onChange={() => handleDisplayOptionsChange('showVolatility')}
                 />
               }
               label="Volatility"
             />
             <FormControlLabel
               control={
                 <Checkbox
                   checked={localDisplayOptions.showChart}
                   onChange={() => handleDisplayOptionsChange('showChart')}
                 />
               }
               label="Price Chart"
             />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisplayDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Custom comparison function to ensure proper re-rendering when data changes
const CryptoTileMemo = memo(CryptoTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.id !== nextProps.id ||
      prevProps.symbol !== nextProps.symbol ||
      prevProps.timeframe !== nextProps.timeframe ||
      prevProps.dashboardContext !== nextProps.dashboardContext) {
    return false; // Re-render
  }
  
  // Check if display options changed
  const prevDisplay = prevProps.displayOptions;
  const nextDisplay = nextProps.displayOptions;
  if (prevDisplay && nextDisplay) {
    if (prevDisplay.showPrice !== nextDisplay.showPrice ||
        prevDisplay.showPriceMarker !== nextDisplay.showPriceMarker ||
        prevDisplay.show24hChange !== nextDisplay.show24hChange ||
        prevDisplay.showAnnualReturn !== nextDisplay.showAnnualReturn ||
        prevDisplay.showVolatility !== nextDisplay.showVolatility ||
        prevDisplay.showChart !== nextDisplay.showChart) {
      return false; // Re-render
    }
  }
  
  // Check if other important props changed
  if (prevProps.autoRefresh !== nextProps.autoRefresh ||
      prevProps.isPinned !== nextProps.isPinned ||
      prevProps.isDragging !== nextProps.isDragging ||
      prevProps.isResizing !== nextProps.isResizing ||
      prevProps.isSelected !== nextProps.isSelected) {
    return false; // Re-render
  }
  
  // If size changed significantly, re-render
  if (prevProps.size && nextProps.size) {
    const sizeThreshold = 10; // 10px threshold
    if (Math.abs(prevProps.size.width - nextProps.size.width) > sizeThreshold ||
        Math.abs(prevProps.size.height - nextProps.size.height) > sizeThreshold) {
      return false; // Re-render
    }
  }
  
  return true; // Don't re-render
});

export default CryptoTileMemo;
