import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  FormControl,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  InputLabel,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Close as CloseIcon,
  FilterList as FilterIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Calculate as CalculateIcon,
} from '@mui/icons-material';
import { usePortfolioAnalysis } from '../../hooks/useAPI';
import { useTileCache } from '../../hooks/useDashboardCache';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, confirmDialog } from './common';
import { getIconByName, getDefaultIconForTileType } from './common/tileIconHelper';
import { CircularProgress } from '@mui/material';

interface PortfolioEntry {
  stock: string;
  shares: number;
}

interface PortfolioResults {
  total_portfolio_value: number;
  portfolio_expected_return: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  stock_details: {
    [key: string]: {
      weight: number;
      annual_return: number;
      annual_volatility: number;
      shares: number;
      current_price: number;
      total_value: number;
    }
  }
}

interface PortfolioTileProps {
  id: string;
  displayOptions?: {
    showHoldings: boolean;
    showPerformance: boolean;
    showAllocation: boolean;
    showRiskMetrics: boolean;
    showStockDetails: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  size?: { width: number; height: number };
  dashboardContext?: string;
  portfolioData?: {
    entries: PortfolioEntry[];
    results: PortfolioResults | null;
    timeframe: string;
  };
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
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const PortfolioTile = ({
  id,
  displayOptions = {
    showHoldings: true,
    showPerformance: true,
    showAllocation: false,
    showRiskMetrics: true,
    showStockDetails: true,
  },
  autoRefresh: _autoRefresh = false,
  isPinned = false,
  size: _size = { width: 6, height: 8 },
  dashboardContext = 'default',
  portfolioData,
  onRemove,
  onUpdate,
  onSettingsChange,
  onResize: _onResize,
  onDragStart,
  onResizeStart: _onResizeStart,
  isDragging = false,
  isResizing: _isResizing = false,
  isSelected = false,
  onSelectionChange,
  customTitle,
  customColor,
  customIcon,
}: PortfolioTileProps) => {
  const [entries, setEntries] = useState<PortfolioEntry[]>(
    portfolioData?.entries || [{ stock: '', shares: 0 }]
  );
  const [results, setResults] = useState<PortfolioResults | null>(
    portfolioData?.results || null
  );
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<string>(
    portfolioData?.timeframe || '1y'
  );
  const [recalculateDialogOpen, setRecalculateDialogOpen] = useState(false);
  const [displayOptionsDialogOpen, setDisplayOptionsDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  
  // Use the portfolio analysis hook
  const { executeForceRefresh: analyzePortfolio, loading: isLoading, error: apiError } = usePortfolioAnalysis();
  
  // Pinning functionality using common hook
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onUpdate?.(id, { isPinned: pinned });
    },
  });
  
  // Cache for portfolio data
  const fetchPortfolioData = useCallback(async () => {
    // This is just a placeholder - the actual data fetching is done in calculateRisk
    return { entries, results, timeframe };
  }, [entries, results, timeframe]);
  
  const { clearCache } = useTileCache(
    id,
    'portfolio',
    fetchPortfolioData,
    [entries.length, results?.total_portfolio_value || 0, timeframe],
    {
      ttl: 10 * 60 * 1000, // 10 minutes cache
      useSessionStorage: true,
      enabled: true,
      forceRefresh: false,
      dashboardContext,
    }
  );

  // Use ref to track previous data and prevent unnecessary updates
  const prevDataRef = useRef<any>(null);

  // Update tile data when portfolio data changes
  useEffect(() => {
    if (!onUpdate) return;

    const currentData = {
      entries: entries.filter(e => e.stock && e.shares > 0),
      results,
      timeframe,
    };

    // Only update if data has actually changed
    const hasChanged = !prevDataRef.current || 
      JSON.stringify(prevDataRef.current) !== JSON.stringify(currentData);

    if (hasChanged) {
      prevDataRef.current = currentData;
      onUpdate(id, {
        portfolioData: currentData
      });
    }
  }, [entries, results, timeframe, id, onUpdate]);

  const addEntry = useCallback(() => {
    setEntries([...entries, { stock: '', shares: 0 }]);
  }, [entries]);

  const removeEntry = useCallback((index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  }, [entries]);

  const updateEntry = useCallback((index: number, field: keyof PortfolioEntry, value: string | number) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntries(newEntries);
  }, [entries]);

  const calculateRisk = useCallback(async () => {
    setError(null);
    
    try {
      const portfolioData = entries
        .filter(entry => entry.stock && entry.shares > 0)
        .map(entry => [entry.stock, entry.shares, 0] as [string, number, number]);
      
      if (portfolioData.length === 0) {
        setError('Please add at least one stock with shares > 0');
        return;
      }
      
      const response = await analyzePortfolio({
        portfolio_data: portfolioData,
        period: timeframe,
        analysis_type: 'standalone'
      });
      
      if (response && response.success) {
        setResults(response.portfolio_metrics);
      } else {
        setError('Failed to analyze portfolio. Please check your stock tickers.');
      }
    } catch (err) {
      console.error('Portfolio analysis error:', err);
      setError(apiError || 'An error occurred while analyzing your portfolio.');
    }
  }, [entries, timeframe, analyzePortfolio, apiError]);

  const getRiskLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Low', color: '#22c55e' };
    if (volatility < 20) return { level: 'Medium', color: '#f59e0b' };
    return { level: 'High', color: '#ef4444' };
  };


  const handleRefresh = useCallback(() => {
    if (results) {
      calculateRisk();
    }
  }, [calculateRisk, results]);

  const handleClear = useCallback(() => {
    setEntries([{ stock: '', shares: 0 }]);
    setResults(null);
    setError(null);
    clearCache();
  }, [clearCache]);

  const handleRecalculateDialogOpen = () => {
    setRecalculateDialogOpen(true);
  };

  const handleRecalculateDialogClose = () => {
    setRecalculateDialogOpen(false);
  };

  const handleDisplayOptionsDialogOpen = () => {
    setDisplayOptionsDialogOpen(true);
  };

  const handleDisplayOptionsDialogClose = () => {
    setDisplayOptionsDialogOpen(false);
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Portfolio Analysis from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });
    if (confirmed) {
      onRemove?.(id);
    }
  };

  const handleRecalculate = () => {
    calculateRisk();
    handleRecalculateDialogClose();
  };

  const handleSelectionChange = (selected: boolean) => {
    if (onSelectionChange) {
      // The portfolio data is already stored in the tile via onUpdate
      // Just pass the selection state
      onSelectionChange(id, selected);
    }
  };

  const tileColor = customColor || '#3b82f6';

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        border: `1px solid ${tileColor}40`,
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        '&:hover': {
          borderColor: tileColor,
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : `0 8px 25px ${tileColor}25`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: results ? tileColor : '#6b7280',
        },
      }}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Selection checkbox */}
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                handleSelectionChange(!isSelected);
              }}
              sx={{ 
                color: '#9ca3af',
                '&.Mui-checked': { color: '#10b981' },
                p: 0.5,
              }}
              size="small"
            />
          )}
          {(() => {
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('portfolio'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'Portfolio Analysis';
            return (
              <>
                <TileIcon sx={{ color: iconColor, fontSize: '1.2rem', mr: 1 }} />
                <Typography
                  variant="h6"
                  sx={{
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                >
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
          
          {isLoading && (
            <>
              <CircularProgress size={16} sx={{ color: tileColor, ml: 1 }} />
              <Typography variant="caption" sx={{ color: tileColor, ml: 1, fontWeight: 500 }}>
                Calculating...
              </Typography>
            </>
          )}
        </Box>
        
        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          customizeButton={{
            onClick: () => setCustomizeDialogOpen(true),
          }}
          collapsibleActions={
            <>
              <Tooltip title="Recalculate Portfolio">
                <IconButton
                  size="small"
                  onClick={handleRecalculateDialogOpen}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <CalculateIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Refresh data">
                <IconButton
                  size="small"
                  onClick={handleRefresh}
                  disabled={isLoading || !results}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#10b981' } }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Display Options">
                <IconButton
                  size="small"
                  onClick={handleDisplayOptionsDialogOpen}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <FilterIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Clear Data">
                <IconButton
                  size="small"
                  onClick={handleClear}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#ef4444' } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
      </Box>

      {/* Loading state */}
      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <CircularProgress size={32} sx={{ color: tileColor, mb: 2 }} />
          <Typography variant="body2" color="#9ca3af">
            Calculating portfolio metrics...
          </Typography>
        </Box>
      )}

      {/* Content */}
      {!isLoading && (
        <Box 
          sx={{ 
            flex: 1, 
            overflow: 'auto', 
            p: 2, 
            position: 'relative',
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#475569',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: tileColor,
              borderRadius: '3px',
              '&:hover': {
                backgroundColor: '#2563eb',
              },
            },
          }}
        >
          {error && (
            <Alert severity="error" sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
              {error}
            </Alert>
          )}

          {/* Empty State - Show when no results */}
          {!results && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af', textAlign: 'center' }}>
                No portfolio analysis yet. Click the Recalculate button in the toolbar to get started.
              </Typography>
            </Box>
          )}


        {/* Results Section */}
        {results && (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Key Metrics - Side by side in a single row */}
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Box
                sx={{
                  flex: 1,
                  p: 1.5,
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '6px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                  Total Value
                </Typography>
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>
                  ${results.total_portfolio_value.toLocaleString()}
                </Typography>
              </Box>
              
              <Box
                sx={{
                  flex: 1,
                  p: 1.5,
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '6px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                  Expected Return
                </Typography>
                <Typography variant="body2" sx={{ color: '#22c55e', fontWeight: 600, fontSize: '0.9rem' }}>
                  {results.portfolio_expected_return >= 0 ? '+' : ''}{results.portfolio_expected_return.toFixed(2)}%
                </Typography>
              </Box>
              
              <Box
                sx={{
                  flex: 1,
                  p: 1.5,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                  Volatility
                </Typography>
                <Typography variant="body2" sx={{ color: '#ef4444', fontWeight: 600, fontSize: '0.9rem' }}>
                  {results.portfolio_volatility.toFixed(2)}%
                </Typography>
                <Chip
                  label={getRiskLevel(results.portfolio_volatility).level}
                  size="small"
                  sx={{
                    backgroundColor: getRiskLevel(results.portfolio_volatility).color,
                    color: '#ffffff',
                    fontSize: '0.6rem',
                    height: '16px',
                    mt: 0.5,
                  }}
                />
              </Box>
              
              <Box
                sx={{
                  flex: 1,
                  p: 1.5,
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: '6px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                  Sharpe Ratio
                </Typography>
                <Typography variant="body2" sx={{ color: '#a855f7', fontWeight: 600, fontSize: '0.9rem' }}>
                  {results.sharpe_ratio.toFixed(2)}
                </Typography>
              </Box>
            </Box>

            {/* Individual Stock Details Table - Takes remaining space */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600, mb: 1, fontSize: '0.8rem' }}>
                Individual Stock Details
              </Typography>
              <TableContainer
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  flex: 1,
                  overflowY: 'auto',
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: '#475569',
                    borderRadius: '3px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: '#3b82f6',
                    borderRadius: '3px',
                    '&:hover': {
                      backgroundColor: '#2563eb',
                    },
                  },
                }}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                      <TableCell sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Stock</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Weight</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Return</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Volatility</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Shares</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Price</TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(results.stock_details).map(([stock, details]) => (
                      <TableRow key={stock} sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>{stock}</TableCell>
                        <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.75rem', py: 1 }}>
                          {(details.weight * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: details.annual_return >= 0 ? '#22c55e' : '#ef4444', fontSize: '0.75rem', py: 1 }}>
                          {details.annual_return >= 0 ? '+' : ''}{details.annual_return.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.75rem', py: 1 }}>
                          {details.annual_volatility.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.75rem', py: 1 }}>
                          {details.shares.toLocaleString()}
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.75rem', py: 1 }}>
                          ${details.current_price.toFixed(2)}
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.75rem', py: 1 }}>
                          ${details.total_value.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Box>
        )}
        </Box>
      )}

      {/* Recalculate Dialog */}
      <Dialog
        open={recalculateDialogOpen}
        onClose={handleRecalculateDialogClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            backdropFilter: 'blur(10px)',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff' }}>Recalculate Portfolio</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            {/* Portfolio Holdings Input */}
            <Box>
              <Typography variant="h6" sx={{ color: '#ffffff', mb: 2 }}>
                Portfolio Holdings
              </Typography>
              
              <FormControl size="small" sx={{ minWidth: 100, mb: 2 }}>
                <InputLabel sx={{ color: '#9ca3af' }}>Timeframe</InputLabel>
                <Select
                  value={timeframe}
                  label="Timeframe"
                  onChange={(e) => setTimeframe(e.target.value)}
                  sx={{
                    color: '#ffffff',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                  }}
                >
                  <MenuItem value="1d">1 Day</MenuItem>
                  <MenuItem value="5d">5 Days</MenuItem>
                  <MenuItem value="1mo">1 Month</MenuItem>
                  <MenuItem value="3mo">3 Months</MenuItem>
                  <MenuItem value="6mo">6 Months</MenuItem>
                  <MenuItem value="1y">1 Year</MenuItem>
                  <MenuItem value="2y">2 Years</MenuItem>
                  <MenuItem value="5y">5 Years</MenuItem>
                  <MenuItem value="max">Max</MenuItem>
                </Select>
              </FormControl>

              {entries.map((entry, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Stock"
                    value={entry.stock}
                    onChange={(e) => updateEntry(index, 'stock', e.target.value.toUpperCase())}
                    sx={{ flexGrow: 1 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Shares"
                    value={entry.shares}
                    onChange={(e) => updateEntry(index, 'shares', parseFloat(e.target.value) || 0)}
                    sx={{ flexGrow: 1 }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => removeEntry(index)}
                    disabled={entries.length === 1}
                    sx={{ color: '#ef4444' }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}

              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={addEntry}
                  sx={{ color: '#3b82f6' }}
                >
                  Add Stock
                </Button>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRecalculateDialogClose} sx={{ color: '#9ca3af' }}>
            Cancel
          </Button>
          <Button
            onClick={handleRecalculate}
            variant="contained"
            startIcon={<CalculateIcon />}
            disabled={isLoading || entries.some(e => !e.stock || e.shares <= 0)}
            sx={{ backgroundColor: '#3b82f6' }}
          >
            {isLoading ? 'Calculating...' : 'Calculate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Display Options Dialog */}
      <Dialog
        open={displayOptionsDialogOpen}
        onClose={handleDisplayOptionsDialogClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            backdropFilter: 'blur(10px)',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff' }}>Display Options</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            {/* Display Options */}
            <Box>
              <Typography variant="h6" sx={{ color: '#ffffff', mb: 2 }}>
                Display Options
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showHoldings}
                    onChange={(e) => onUpdate?.(id, { displayOptions: { ...displayOptions, showHoldings: e.target.checked } })}
                  />
                }
                label="Show Holdings Input"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showPerformance}
                    onChange={(e) => onUpdate?.(id, { displayOptions: { ...displayOptions, showPerformance: e.target.checked } })}
                  />
                }
                label="Show Performance Metrics"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showRiskMetrics}
                    onChange={(e) => onUpdate?.(id, { displayOptions: { ...displayOptions, showRiskMetrics: e.target.checked } })}
                  />
                }
                label="Show Risk Metrics"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showStockDetails}
                    onChange={(e) => onUpdate?.(id, { displayOptions: { ...displayOptions, showStockDetails: e.target.checked } })}
                  />
                }
                label="Show Stock Details Table"
                sx={{ color: '#ffffff' }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDisplayOptionsDialogClose} sx={{ color: '#9ca3af' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'Portfolio Analysis'}
        currentColor={customColor}
        currentIcon={customIcon}
      />
    </Box>
  );
};

// Custom comparison function for memo - matches SEC tile pattern but with optimization
const PortfolioTileMemo = memo(PortfolioTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.id !== nextProps.id ||
      prevProps.dashboardContext !== nextProps.dashboardContext) {
    return false; // Re-render
  }
  
  // Check customization props FIRST - these should always trigger re-render
  if (prevProps.customTitle !== nextProps.customTitle ||
      prevProps.customColor !== nextProps.customColor ||
      prevProps.customIcon !== nextProps.customIcon) {
    return false; // Re-render
  }
  
  // Check if display options changed
  const prevDisplay = prevProps.displayOptions;
  const nextDisplay = nextProps.displayOptions;
  if (prevDisplay && nextDisplay) {
    if (prevDisplay.showHoldings !== nextDisplay.showHoldings ||
        prevDisplay.showPerformance !== nextDisplay.showPerformance ||
        prevDisplay.showAllocation !== nextDisplay.showAllocation ||
        prevDisplay.showRiskMetrics !== nextDisplay.showRiskMetrics ||
        prevDisplay.showStockDetails !== nextDisplay.showStockDetails) {
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
  
  return true; // Don't re-render
});

PortfolioTileMemo.displayName = 'PortfolioTile';

export default PortfolioTileMemo;
