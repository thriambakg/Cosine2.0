import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  Select,
  TextField,
  Button,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  Slider,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Pagination,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Close as CloseIcon,
  PushPin as PinIcon,
  AutoAwesome as AutoRefreshIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  TrendingUp as TrendingUpIcon,
  Business as BusinessIcon,
  AttachMoney as MoneyIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';
// import { useStockScreener } from '../hooks/useAPI'; // Will be used when Lambda is ready

interface StockScreenerTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
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
  // Stock screener specific props
  criteria?: StockScreenerCriteria;
  results?: StockResult[];
  displayOptions?: {
    showIndustry: boolean;
    showMarketCap: boolean;
    showVolatility: boolean;
    showPriceChange: boolean;
    showResultsTable: boolean;
    showCriteriaSummary: boolean;
    maxResults: number;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
}

interface StockScreenerCriteria {
  industries: string[];
  volatilityRange: [number, number];
  priceChangeRange: [number, number];
  marketCapRange: [number, number];
  priceRange: [number, number];
  timeframe: string;
}

interface StockResult {
  symbol: string;
  name: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  marketCap: number;
  volatility: number;
  industry: string;
  volume: number;
  pe: number;
}

const StockScreenerTile: React.FC<StockScreenerTileProps> = ({
  id,
  size = { width: 400, height: 600 },
  onRemove,
  onUpdate,
  onSettingsChange,
  onResize,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
  criteria = {
    industries: [],
    volatilityRange: [0, 100],
    priceChangeRange: [-50, 50],
    marketCapRange: [0, 1000000000000],
    priceRange: [0, 1000],
    timeframe: '1d',
  },
  results = [],
  displayOptions = {
    showIndustry: true,
    showMarketCap: true,
    showVolatility: true,
    showPriceChange: true,
    showResultsTable: true,
    showCriteriaSummary: true,
    maxResults: 10,
  },
  autoRefresh = false,
  isPinned = false,
}) => {
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [criteriaDialogOpen, setCriteriaDialogOpen] = useState(false);
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false);
  const [localCriteria, setLocalCriteria] = useState<StockScreenerCriteria>(criteria);
  const [localDisplayOptions, setLocalDisplayOptions] = useState(displayOptions);
  const [currentPage, setCurrentPage] = useState(1);
  const [stockResults, setStockResults] = useState<StockResult[]>(results);
  const tileRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number>(0);

  // Mock loading and error states for now
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Industry options for autocomplete
  const industryOptions = [
    'Technology',
    'Healthcare',
    'Financial Services',
    'Consumer Discretionary',
    'Consumer Staples',
    'Industrials',
    'Energy',
    'Materials',
    'Real Estate',
    'Utilities',
    'Communication Services',
  ];

  // Mock stock data for demonstration
  const mockStockData: StockResult[] = [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 175.43,
      priceChange: 2.34,
      priceChangePercent: 1.35,
      marketCap: 2750000000000,
      volatility: 25.4,
      industry: 'Technology',
      volume: 45000000,
      pe: 28.5,
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      price: 378.85,
      priceChange: -1.23,
      priceChangePercent: -0.32,
      marketCap: 2810000000000,
      volatility: 22.1,
      industry: 'Technology',
      volume: 28000000,
      pe: 32.1,
    },
    {
      symbol: 'JNJ',
      name: 'Johnson & Johnson',
      price: 158.92,
      priceChange: 0.87,
      priceChangePercent: 0.55,
      marketCap: 420000000000,
      volatility: 15.8,
      industry: 'Healthcare',
      volume: 8500000,
      pe: 24.3,
    },
    {
      symbol: 'JPM',
      name: 'JPMorgan Chase & Co.',
      price: 142.67,
      priceChange: 3.21,
      priceChangePercent: 2.30,
      marketCap: 420000000000,
      volatility: 28.9,
      industry: 'Financial Services',
      volume: 12000000,
      pe: 11.2,
    },
    {
      symbol: 'TSLA',
      name: 'Tesla Inc.',
      price: 248.50,
      priceChange: -8.75,
      priceChangePercent: -3.40,
      marketCap: 790000000000,
      volatility: 45.2,
      industry: 'Consumer Discretionary',
      volume: 95000000,
      pe: 62.8,
    },
    {
      symbol: 'GOOGL',
      name: 'Alphabet Inc.',
      price: 142.56,
      priceChange: 1.89,
      priceChangePercent: 1.34,
      marketCap: 1780000000000,
      volatility: 31.2,
      industry: 'Technology',
      volume: 22000000,
      pe: 25.8,
    },
    {
      symbol: 'AMZN',
      name: 'Amazon.com Inc.',
      price: 151.94,
      priceChange: -2.15,
      priceChangePercent: -1.40,
      marketCap: 1580000000000,
      volatility: 35.6,
      industry: 'Consumer Discretionary',
      volume: 35000000,
      pe: 52.3,
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      price: 875.28,
      priceChange: 12.45,
      priceChangePercent: 1.44,
      marketCap: 2150000000000,
      volatility: 48.7,
      industry: 'Technology',
      volume: 42000000,
      pe: 65.2,
    },
  ];

  // Filter stocks based on criteria
  const filterStocks = useCallback((stocks: StockResult[], criteria: StockScreenerCriteria): StockResult[] => {
    return stocks.filter(stock => {
      // Industry filter
      if (criteria.industries.length > 0 && !criteria.industries.includes(stock.industry)) {
        return false;
      }

      // Volatility filter
      if (stock.volatility < criteria.volatilityRange[0] || stock.volatility > criteria.volatilityRange[1]) {
        return false;
      }

      // Price change filter
      if (stock.priceChangePercent < criteria.priceChangeRange[0] || stock.priceChangePercent > criteria.priceChangeRange[1]) {
        return false;
      }

      // Market cap filter
      if (stock.marketCap < criteria.marketCapRange[0] || stock.marketCap > criteria.marketCapRange[1]) {
        return false;
      }

      // Price filter
      if (stock.price < criteria.priceRange[0] || stock.price > criteria.priceRange[1]) {
        return false;
      }

      return true;
    });
  }, []);

  // Memoize the fetch function to prevent constant re-renders
  const fetchStockScreenerData = useCallback(async () => {
    // For now, use mock data. In the future, this will call the Lambda API
    return new Promise<StockResult[]>((resolve) => {
      setTimeout(() => {
        const filteredResults = filterStocks(mockStockData, localCriteria);
        resolve(filteredResults);
      }, 1000); // Simulate API delay
    });
  }, [localCriteria, filterStocks]);

  // Run stock screener
  const runScreener = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const filteredResults = await fetchStockScreenerData();
      setStockResults(filteredResults);
      
      // Update tile with results
      onUpdate(id, {
        results: filteredResults,
        criteria: localCriteria,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      setError('Failed to fetch stock data');
      console.error('Stock screener error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchStockScreenerData, onUpdate, id, localCriteria]);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      runScreener();
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(interval);
  }, [autoRefresh, runScreener]);

  // Initial load
  useEffect(() => {
    if (stockResults.length === 0) {
      runScreener();
    }
  }, [runScreener, stockResults.length]);

  const handleSettingsOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  };

  const handleSettingsClose = () => {
    setSettingsAnchor(null);
  };

  const handleCriteriaChange = (newCriteria: StockScreenerCriteria) => {
    setLocalCriteria(newCriteria);
    onSettingsChange(id, { criteria: newCriteria });
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
    if (window.confirm('Remove Stock Screener from dashboard?')) {
      onRemove(id);
    }
  };

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T`;
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B`;
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M`;
    return `$${marketCap.toFixed(0)}`;
  };

  const formatVolatilityRange = (range: [number, number]) => {
    return `${range[0]}% - ${range[1]}%`;
  };

  const formatPriceRange = (range: [number, number]) => {
    return `$${range[0]} - $${range[1]}`;
  };

  // Pagination
  const resultsPerPage = 5;
  const totalPages = Math.ceil(stockResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentResults = stockResults.slice(startIndex, endIndex);

  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid #374151',
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: size.width,
        height: size.height,
        resize: onDragStart ? 'none' : 'both',
        minWidth: 350,
        minHeight: 400,
        maxWidth: 800,
        maxHeight: 1000,
        cursor: isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default'),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          borderColor: '#3b82f6',
          transform: isDragging ? 'none' : 'translateY(-2px)',
          boxShadow: isDragging ? 'none' : '0 8px 25px rgba(59, 130, 246, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: stockResults.length > 0 ? '#3b82f6' : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={onDragStart}
      onMouseUp={() => {
        if (onResize && tileRef.current) {
          const rect = tileRef.current.getBoundingClientRect();
          onResize(id, { width: rect.width, height: rect.height });
        }
      }}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Selection checkbox */}
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onClick={(e) => {
                const now = Date.now();
                if (now - lastClickTimeRef.current < 200) {
                  return;
                }
                lastClickTimeRef.current = now;
                
                e.stopPropagation();
                onSelectionChange(id, !isSelected);
              }}
              sx={{ 
                color: '#9ca3af',
                '&.Mui-checked': { color: '#3b82f6' },
                p: 0.5,
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
              }}
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            />
          )}
          
          <FilterIcon sx={{ color: '#3b82f6', fontSize: '1.5rem', mr: 1 }} />
          <Typography variant="h6" color="white" fontWeight={600}>
            Stock Screener
          </Typography>
          
          <Chip
            label={`${stockResults.length} results`}
            size="small"
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
            }}
          />
          
          {isPinned && (
            <Tooltip title="Pinned to top">
              <PinIcon sx={{ color: '#3b82f6', fontSize: 16 }} />
            </Tooltip>
          )}
          {autoRefresh && (
            <Tooltip title="Auto-refresh enabled">
              <AutoRefreshIcon sx={{ color: '#22c55e', fontSize: 16 }} />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Run Screener">
            <IconButton
              size="small"
              onClick={runScreener}
              disabled={isLoading}
              sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
            >
              <SearchIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton
              size="small"
              onClick={handleSettingsOpen}
              sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
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
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            Screening stocks...
          </Typography>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 1, backgroundColor: 'rgba(220, 38, 38, 0.1)', flexShrink: 0 }}>
          {error}
        </Alert>
      )}

      {/* Criteria Summary - only show if enabled */}
      {localDisplayOptions.showCriteriaSummary && (
        <Box sx={{ mb: 1, p: 2, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px', flexShrink: 0 }}>
          <Typography variant="subtitle2" color="#3b82f6" gutterBottom>
            Current Criteria:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {localCriteria.industries.length > 0 && (
              <Chip
                icon={<BusinessIcon />}
                label={`Industries: ${localCriteria.industries.join(', ')}`}
                size="small"
                variant="outlined"
              />
            )}
            <Chip
              icon={<SpeedIcon />}
              label={`Volatility: ${formatVolatilityRange(localCriteria.volatilityRange)}`}
              size="small"
              variant="outlined"
            />
            <Chip
              icon={<TrendingUpIcon />}
              label={`Price Change: ${localCriteria.priceChangeRange[0]}% - ${localCriteria.priceChangeRange[1]}%`}
              size="small"
              variant="outlined"
            />
            <Chip
              icon={<MoneyIcon />}
              label={`Price: ${formatPriceRange(localCriteria.priceRange)}`}
              size="small"
              variant="outlined"
            />
          </Box>
        </Box>
      )}

      {/* Results Table */}
      {localDisplayOptions.showResultsTable && stockResults.length > 0 && !isLoading && (
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0, // Allow flex shrinking
          mt: 1 // Small top margin to separate from criteria
        }}>
          <TableContainer sx={{ 
            flex: 1,
            backgroundColor: 'transparent',
            borderRadius: 0,
            boxShadow: 'none',
            border: 'none',
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'rgba(55, 65, 81, 0.3)',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              backgroundColor: 'rgba(59, 130, 246, 0.7)',
            },
          }}>
            <Table size="small" sx={{ 
              '& .MuiTableCell-root': {
                borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                padding: '8px 12px',
              },
              '& .MuiTableHead-root .MuiTableCell-root': {
                borderBottom: '2px solid rgba(59, 130, 246, 0.5)',
                backgroundColor: 'rgba(15, 23, 42, 0.5)',
              },
              '& .MuiTableRow-root:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
              },
            }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Symbol</TableCell>
                  {localDisplayOptions.showIndustry && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Industry</TableCell>
                  )}
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Price</TableCell>
                  {localDisplayOptions.showPriceChange && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Change</TableCell>
                  )}
                  {localDisplayOptions.showMarketCap && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Market Cap</TableCell>
                  )}
                  {localDisplayOptions.showVolatility && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Volatility</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentResults.map((stock) => (
                  <TableRow key={stock.symbol} hover>
                    <TableCell sx={{ color: 'white', fontWeight: 600, fontSize: '0.875rem' }}>{stock.symbol}</TableCell>
                    {localDisplayOptions.showIndustry && (
                      <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{stock.industry}</TableCell>
                    )}
                    <TableCell sx={{ color: 'white', fontWeight: 600, fontSize: '0.875rem' }}>
                      ${stock.price.toFixed(2)}
                    </TableCell>
                    {localDisplayOptions.showPriceChange && (
                      <TableCell
                        sx={{
                          color: stock.priceChangePercent >= 0 ? '#22c55e' : '#dc2626',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                        }}
                      >
                        {stock.priceChangePercent >= 0 ? '+' : ''}{stock.priceChangePercent.toFixed(2)}%
                      </TableCell>
                    )}
                    {localDisplayOptions.showMarketCap && (
                      <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{formatMarketCap(stock.marketCap)}</TableCell>
                    )}
                    {localDisplayOptions.showVolatility && (
                      <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{stock.volatility.toFixed(1)}%</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1, pt: 1, borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_, page) => setCurrentPage(page)}
                color="primary"
                size="small"
                sx={{
                  '& .MuiPaginationItem-root': {
                    color: '#9ca3af',
                    fontSize: '0.875rem',
                  },
                  '& .Mui-selected': {
                    backgroundColor: '#3b82f6',
                    color: 'white',
                  },
                  '& .MuiPaginationItem-root:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              />
            </Box>
          )}
        </Box>
      )}

      {/* No Results */}
      {!isLoading && stockResults.length === 0 && !error && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No stocks match your criteria. Try adjusting your filters.
          </Typography>
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
        <MenuItem onClick={() => { setCriteriaDialogOpen(true); handleSettingsClose(); }}>
          <FilterIcon sx={{ mr: 1, fontSize: 18 }} />
          Edit Criteria
        </MenuItem>
        <MenuItem onClick={() => { setDisplayDialogOpen(true); handleSettingsClose(); }}>
          <SettingsIcon sx={{ mr: 1, fontSize: 18 }} />
          Display Options
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

      {/* Criteria Dialog */}
      <Dialog
        open={criteriaDialogOpen}
        onClose={() => setCriteriaDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <DialogTitle>Stock Screener Criteria</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'grid', gap: 3 }}>
            {/* Industry Selection */}
            <FormControl fullWidth>
              <Autocomplete
                multiple
                options={industryOptions}
                value={localCriteria.industries}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, industries: newValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Industries"
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { color: 'white' } }}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={option}
                      label={option}
                      size="small"
                      sx={{ backgroundColor: '#3b82f6', color: 'white' }}
                    />
                  ))
                }
              />
            </FormControl>

            {/* Volatility Range */}
            <Box>
              <Typography gutterBottom>Volatility Range: {formatVolatilityRange(localCriteria.volatilityRange)}</Typography>
              <Slider
                value={localCriteria.volatilityRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, volatilityRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={0}
                max={100}
                step={1}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            {/* Price Change Range */}
            <Box>
              <Typography gutterBottom>
                Price Change Range: {localCriteria.priceChangeRange[0]}% - {localCriteria.priceChangeRange[1]}%
              </Typography>
              <Slider
                value={localCriteria.priceChangeRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, priceChangeRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={-50}
                max={50}
                step={1}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            {/* Market Cap Range */}
            <Box>
              <Typography gutterBottom>
                Market Cap Range: {formatMarketCap(localCriteria.marketCapRange[0])} - {formatMarketCap(localCriteria.marketCapRange[1])}
              </Typography>
              <Slider
                value={localCriteria.marketCapRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, marketCapRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={0}
                max={1000000000000}
                step={1000000000}
                scale={(x) => Math.log10(x + 1)}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            {/* Price Range */}
            <Box>
              <Typography gutterBottom>Price Range: {formatPriceRange(localCriteria.priceRange)}</Typography>
              <Slider
                value={localCriteria.priceRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, priceRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={0}
                max={1000}
                step={1}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            {/* Timeframe */}
            <FormControl fullWidth>
              <Select
                value={localCriteria.timeframe}
                onChange={(e) => {
                  handleCriteriaChange({ ...localCriteria, timeframe: e.target.value });
                }}
                sx={{ color: 'white' }}
              >
                <MenuItem value="1d">1 Day</MenuItem>
                <MenuItem value="7d">7 Days</MenuItem>
                <MenuItem value="30d">30 Days</MenuItem>
                <MenuItem value="1y">1 Year</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCriteriaDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => { setCriteriaDialogOpen(false); runScreener(); }} variant="contained">
            Apply & Run
          </Button>
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
                  checked={localDisplayOptions.showIndustry}
                  onChange={() => handleDisplayOptionsChange('showIndustry')}
                />
              }
              label="Show Industry"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showMarketCap}
                  onChange={() => handleDisplayOptionsChange('showMarketCap')}
                />
              }
              label="Show Market Cap"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showVolatility}
                  onChange={() => handleDisplayOptionsChange('showVolatility')}
                />
              }
              label="Show Volatility"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showPriceChange}
                  onChange={() => handleDisplayOptionsChange('showPriceChange')}
                />
              }
              label="Show Price Change"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showResultsTable}
                  onChange={() => handleDisplayOptionsChange('showResultsTable')}
                />
              }
              label="Show Results Table"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showCriteriaSummary}
                  onChange={() => handleDisplayOptionsChange('showCriteriaSummary')}
                />
              }
              label="Show Criteria Summary"
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

// Custom comparison function for memo
const StockScreenerTileMemo = memo(StockScreenerTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.id !== nextProps.id ||
      prevProps.dashboardContext !== nextProps.dashboardContext) {
    return false; // Re-render
  }
  
  // Check if display options changed
  const prevDisplay = prevProps.displayOptions;
  const nextDisplay = nextProps.displayOptions;
  if (prevDisplay && nextDisplay) {
    if (prevDisplay.showIndustry !== nextDisplay.showIndustry ||
        prevDisplay.showMarketCap !== nextDisplay.showMarketCap ||
        prevDisplay.showVolatility !== nextDisplay.showVolatility ||
        prevDisplay.showPriceChange !== nextDisplay.showPriceChange ||
        prevDisplay.showResultsTable !== nextDisplay.showResultsTable ||
        prevDisplay.maxResults !== nextDisplay.maxResults) {
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

export default StockScreenerTileMemo;
