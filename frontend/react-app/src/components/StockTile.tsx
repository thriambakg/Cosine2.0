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
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { useStockData } from '../hooks/useAPI';
import { useTileCache } from '../hooks/useDashboardCache';

interface StockTileProps {
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

const StockTile: React.FC<StockTileProps> = ({
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
  onResizeStart: _onResizeStart,
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

  // Get the API hook for fetching data
  const { executeForceRefresh } = useStockData();
  
  // Memoize the fetch function to prevent constant re-renders
  const fetchStockData = useCallback(async () => {
    return await executeForceRefresh({ ticker: symbol, period: timeframe });
  }, [executeForceRefresh, symbol, timeframe]);
  
  const { data: stockData, loading: isLoading, error, refresh } = useTileCache(
    id,
    'stock',
    fetchStockData,
    [symbol, timeframe], // Cache parameters
    {
      ttl: 5 * 60 * 1000, // 5 minutes cache for stock data (same as crypto)
      useSessionStorage: true, // Persist across tab switches
      enabled: true,
      forceRefresh: false, // Don't force refresh on mount
      dashboardContext, // Include dashboard context for cache isolation
    }
  );

  // Note: Data fetching is now handled by the cache hook
  // No need to fetch on mount unless cache is empty

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
    handleFetchData();
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
    handleFetchData();
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
    onSettingsChange(id, { isPinned: !isPinned });
  };

  const handleRemove = () => {
    if (window.confirm(`Remove ${symbol} from dashboard?`)) {
      onRemove(id);
    }
  };

  // Timeframe descriptions for tooltips
  const timeframeDescriptions = {
    '1d': '1 Day - Shows daily price movement and intraday volatility',
    '7d': '7 Days - Shows weekly trends and short-term momentum',
    '30d': '30 Days - Shows monthly performance and medium-term patterns',
    '1y': '1 Year - Shows annual trends and long-term market behavior'
  };

  // Process chart data from stock API
  const getChartData = () => {
    if (!stockData || !stockData.chart_data || stockData.chart_data.length === 0) {
      return { data: [], isRealData: false };
    }

    // Transform chart data to match the expected format
    const transformedData = stockData.chart_data.map((point: any) => ({
      time: point.time,
      price: point.close,
      // Add formatted date for tooltips
      date: new Date(point.time * 1000).toLocaleDateString(),
      // Add time label if available
      timeLabel: point.time_label || new Date(point.time * 1000).toLocaleTimeString()
    }));

    return { data: transformedData, isRealData: true };
  };

  // Get chart color based on returns
  const getChartColor = () => {
    if (!stockData) return '#10b981'; // Default green
    
    // Use the most recent return for color determination
    const returnValue = stockData.price_change_24h || stockData.week_return || stockData.annual_return || 0;
    return returnValue >= 0 ? '#22c55e' : '#dc2626'; // Green for positive, red for negative
  };

  // Get timeframe-based return value for price marker
  const getTimeframeReturn = () => {
    if (!stockData) return 0;
    
    // Return the appropriate return based on timeframe
    switch (timeframe) {
      case '1d': return stockData.price_change_24h || 0;
      case '7d': return stockData.week_return || 0;
      case '30d': return stockData.week_return || 0; // Use week return for 30d as well
      case '1y': return stockData.annual_return || 0;
      default: return stockData.price_change_24h || 0;
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
    if (maxPrice < 10) {
      // For stocks under $10, use 5% padding
      padding = range * 0.05;
    } else if (maxPrice < 100) {
      // For stocks under $100, use 3% padding
      padding = range * 0.03;
    } else {
      // For higher priced stocks, use 2% padding
      padding = range * 0.02;
    }
    
    // Ensure minimum doesn't go below 0 for positive prices
    const domainMin = Math.max(0, minPrice - padding);
    const domainMax = maxPrice + padding;
    
    return [domainMin, domainMax];
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
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: stockData?.volatility ? '#10b981' : '#dc2626',
        },
      }}
      ref={tileRef}
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
                '&.Mui-checked': { color: '#10b981' },
                p: 0.5,
                '&:hover': { backgroundColor: 'rgba(16, 185, 129, 0.1)' }
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
          {/* Stock Market Symbol */}
          <TrendingUpIcon 
            sx={{ 
              color: '#10b981', 
              fontSize: '1.5rem',
              mr: 1
            }} 
          />
          <Typography variant="h6" color="white" fontWeight={600}>
            {symbol}
          </Typography>
          <Tooltip title={timeframeDescriptions[timeframe as keyof typeof timeframeDescriptions]}>
            <Chip
              label={timeframe.toUpperCase()}
              size="small"
              sx={{
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                border: '1px solid #10b981',
                fontSize: '0.75rem',
                height: '20px',
                cursor: 'help'
              }}
            />
          </Tooltip>
          {isPinned && (
            <Tooltip title="Pinned to top">
              <PinIcon sx={{ color: '#10b981', fontSize: 16 }} />
            </Tooltip>
          )}
          {autoRefresh && (
            <Tooltip title="Auto-refresh enabled">
              <AutoRefreshIcon sx={{ color: '#22c55e', fontSize: 16 }} />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Refresh data">
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={isLoading}
              sx={{ color: '#9ca3af', '&:hover': { color: '#10b981' } }}
            >
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton
              size="small"
              onClick={handleSettingsOpen}
              sx={{ color: '#9ca3af', '&:hover': { color: '#10b981' } }}
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
          {isLoading && (
            <Box sx={{ mb: 2, height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" color="#9ca3af">
                Loading chart...
              </Typography>
            </Box>
          )}
          {stockData && !isLoading && !error && isRealData && chartData && chartData.length > 0 && (
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
                    tickFormatter={(value) => {
                      const dataPoint = chartData.find(d => d.time === value);
                      return dataPoint?.timeLabel || new Date(value * 1000).toLocaleTimeString();
                    }}
                  />
                  <YAxis 
                    stroke="#9ca3af" 
                    fontSize={10}
                    tick={{ fill: '#9ca3af' }}
                    axisLine={{ stroke: '#374151' }}
                    domain={getYAxisDomain()}
                    tickFormatter={(value) => {
                      // Format Y-axis labels based on price range
                      if (value < 1) {
                        return value.toFixed(2);
                      } else if (value < 100) {
                        return value.toFixed(1);
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
                    labelStyle={{ color: getChartColor() }}
                    labelFormatter={(value) => {
                      // Find the data point and return the formatted time label
                      const dataPoint = chartData.find(d => d.time === value);
                      return dataPoint?.timeLabel || new Date(value * 1000).toLocaleString();
                    }}
                    formatter={(value) => {
                      // Format tooltip values based on price range
                      const price = Number(value);
                      let formattedPrice;
                      if (price < 1) {
                        formattedPrice = `$${price.toFixed(2)}`;
                      } else if (price < 100) {
                        formattedPrice = `$${price.toFixed(1)}`;
                      } else {
                        formattedPrice = `$${price.toFixed(0)}`;
                      }
                      return [formattedPrice, 'Price'];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke={getChartColor()}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: getChartColor() }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
          {stockData && !isLoading && !error && !isRealData && (
            <Box sx={{ mb: 2, height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" color="#9ca3af">
                Chart data unavailable
              </Typography>
            </Box>
          )}
        </>
      )}

      {/* Stock data */}
      {stockData && !isLoading && !error && (
        <Box>
          {localDisplayOptions.showPrice && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h5" color="white" fontWeight={700}>
                ${stockData.current_price ? stockData.current_price.toFixed(2) : '--'}
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
                color={getTimeframeReturn() >= 0 ? '#22c55e' : '#dc2626'}
                fontWeight={600}
              >
                {getTimeframeReturn() ? `${getTimeframeReturn() >= 0 ? '+' : ''}${getTimeframeReturn().toFixed(2)}%` : '--%'}
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
                color={stockData.annual_return >= 0 ? '#22c55e' : '#dc2626'}
                fontWeight={600}
              >
                {stockData.annual_return ? `${stockData.annual_return >= 0 ? '+' : ''}${stockData.annual_return.toFixed(2)}%` : '--%'}
              </Typography>
            </Box>
          )}

          {localDisplayOptions.showVolatility && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="#9ca3af">
                Annualized Volatility (%):
              </Typography>
              <Typography variant="body2" color="white" fontWeight={600}>
                {stockData.volatility ? `${stockData.volatility.toFixed(2)}%` : '--'}
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
const StockTileMemo = memo(StockTile, (prevProps, nextProps) => {
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

export default StockTileMemo;
