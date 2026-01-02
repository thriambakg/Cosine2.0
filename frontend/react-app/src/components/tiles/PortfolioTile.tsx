import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Autocomplete,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Close as CloseIcon,
  FilterList as FilterIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Calculate as CalculateIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { usePortfolioAnalysis } from '../../hooks/useAPI';
import { useTileCache } from '../../hooks/useDashboardCache';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, confirmDialog } from './common';
import { getIconByName, getDefaultIconForTileType } from './common/tileIconHelper';
import { CircularProgress } from '@mui/material';
import { securitySuggestionsServiceV2, Security } from '../../services/securitySuggestionsV2';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { useStockData } from '../../hooks/useAPI';

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
    showChart: boolean;
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
    showChart: true,
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
  const navigate = useNavigate();
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
  const [hasPerformedInitialAnalysis, setHasPerformedInitialAnalysis] = useState(false);
  const [recalculateDialogOpen, setRecalculateDialogOpen] = useState(false);
  const [displayOptionsDialogOpen, setDisplayOptionsDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [isSecurityDataLoaded, setIsSecurityDataLoaded] = useState(false);
  const [securitySuggestions, setSecuritySuggestions] = useState<Security[]>([]);
  
  // Local state for dialog - only persists on Calculate button click
  const [dialogEntries, setDialogEntries] = useState<PortfolioEntry[]>([]);
  const [dialogTimeframe, setDialogTimeframe] = useState<string>('1y');
  
  // Chart feature state - tile only shows combined view
  const [chartData, setChartData] = useState<any[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  
  // Stock data hook for fetching individual stock data (handles S3 check internally)
  const { executeForceRefresh: fetchStockData } = useStockData();
  
  // Use the portfolio analysis hook
  const { executeForceRefresh: analyzePortfolio, loading: isLoading, error: apiError } = usePortfolioAnalysis();
  
  // Load security data when dialog opens
  useEffect(() => {
    const loadSecurityData = async () => {
      if (recalculateDialogOpen && !isSecurityDataLoaded) {
        try {
          await securitySuggestionsServiceV2.loadSecurities();
          setIsSecurityDataLoaded(true);
          // Deduplicate securities by symbol (keep first occurrence)
          const allSecurities = securitySuggestionsServiceV2.getAllSecurities();
          const seen = new Set<string>();
          const uniqueSecurities = allSecurities.filter(security => {
            if (seen.has(security.symbol)) {
              return false;
            }
            seen.add(security.symbol);
            return true;
          });
          setSecuritySuggestions(uniqueSecurities.slice(0, 50));
        } catch (error) {
          console.error('Failed to load security suggestions:', error);
        }
      }
    };

    loadSecurityData();
  }, [recalculateDialogOpen, isSecurityDataLoaded]);
  
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

  // Sync portfolioData prop to state when it changes (e.g., on refresh when parent loads saved state)
  const prevPortfolioDataRef = useRef<string>('');
  useEffect(() => {
    if (portfolioData) {
      const portfolioDataStr = JSON.stringify(portfolioData);
      // Only update if the prop actually changed
      if (prevPortfolioDataRef.current !== portfolioDataStr) {
        prevPortfolioDataRef.current = portfolioDataStr;
        // Always sync entries if they exist in portfolioData (even if empty array)
        // This ensures imported tiles with empty entries are properly initialized
        if (portfolioData.entries !== undefined) {
          // If entries is an empty array, use default, otherwise use the provided entries
          setEntries(portfolioData.entries.length > 0 ? portfolioData.entries : [{ stock: '', shares: 0 }]);
        }
        if (portfolioData.timeframe) {
          setTimeframe(portfolioData.timeframe);
        }
      }
    }
  }, [portfolioData]);

  // Remove auto-persistence - now only persists on Calculate button click
  // This useEffect is removed to prevent auto-persistence

  // Also update local state via onUpdate for runtime state (including results)
  useEffect(() => {
    if (!onUpdate) return;

    const currentData = {
      entries: entries.filter(e => e.stock && e.shares > 0),
      results,
      timeframe,
    };

    onUpdate(id, {
      portfolioData: currentData
    });
  }, [entries, results, timeframe, id, onUpdate]);


  const handleStockInputChange = useCallback((_index: number, inputValue: string) => {
    // Only update suggestions based on input, don't update the entry value yet
    // The entry value will be updated when a selection is made or on blur
    if (isSecurityDataLoaded && inputValue) {
      const suggestions = securitySuggestionsServiceV2.getSuggestions(inputValue, 50);
      // Deduplicate by symbol
      const seen = new Set<string>();
      const uniqueSuggestions = suggestions.filter(security => {
        if (seen.has(security.symbol)) {
          return false;
        }
        seen.add(security.symbol);
        return true;
      });
      setSecuritySuggestions(uniqueSuggestions);
    } else if (isSecurityDataLoaded) {
      const allSecurities = securitySuggestionsServiceV2.getAllSecurities();
      const seen = new Set<string>();
      const uniqueSecurities = allSecurities.filter(security => {
        if (seen.has(security.symbol)) {
          return false;
        }
        seen.add(security.symbol);
        return true;
      });
      setSecuritySuggestions(uniqueSecurities.slice(0, 50));
    }
  }, [isSecurityDataLoaded]);


  const calculateRisk = useCallback(async () => {
    setHasPerformedInitialAnalysis(true);
    setError(null);
    
    try {
      const portfolioData = entries
        .filter(entry => entry.stock && entry.shares > 0)
        .map(entry => {
          // Extract just the symbol if entry.stock is in display format
          // Pattern: "SYMBOL - Name (Cap)" or just "SYMBOL"
          const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
          const symbol = symbolMatch ? symbolMatch[1].trim() : entry.stock.trim();
          return [symbol.toUpperCase(), entry.shares, 0] as [string, number, number];
        });
      
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

  // Trigger analysis when portfolioData is restored from import/load
  // This must be after calculateRisk is defined
  useEffect(() => {
    if (portfolioData && portfolioData.entries !== undefined) {
      const portfolioHasValidEntries = portfolioData.entries.some((e: any) => e.stock && e.shares > 0);
      
      // If portfolioData has valid entries but we haven't performed analysis yet, trigger it
      if (portfolioHasValidEntries && !hasPerformedInitialAnalysis && !isLoading) {
        setHasPerformedInitialAnalysis(true);
        // Trigger analysis after a short delay to ensure state is updated
        setTimeout(() => {
          calculateRisk();
        }, 100);
      }
    }
  }, [portfolioData, isLoading, hasPerformedInitialAnalysis, calculateRisk]);

  // Run fresh analysis when opened in preview mode (like other tiles)
  // This must be after calculateRisk is defined
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading && !hasPerformedInitialAnalysis) {
      const hasValidEntries = entries.some(e => e.stock && e.shares > 0);
      if (hasValidEntries) {
        setHasPerformedInitialAnalysis(true);
        calculateRisk();
      }
    }
  }, [dashboardContext, isLoading, entries, hasPerformedInitialAnalysis, calculateRisk]);

  const getRiskLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Low', color: '#22c55e' };
    if (volatility < 20) return { level: 'Medium', color: '#f59e0b' };
    return { level: 'High', color: '#ef4444' };
  };

  // Fetch chart data for portfolio stocks
  const loadChartData = useCallback(async () => {
    if (!results || !entries.some(e => e.stock && e.shares > 0)) {
      setChartData([]);
      return;
    }

    setIsLoadingChart(true);
    try {
      const validEntries = entries.filter(e => e.stock && e.shares > 0);
      
      // Extract symbols properly (handle cases where it might be "AAPL - APPLE INC. (HIGH CAP)" or just "AAPL")
      const stockSymbols = validEntries.map(e => {
        const symbolMatch = e.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
        return symbolMatch ? symbolMatch[1].trim().toUpperCase() : e.stock.trim().toUpperCase();
      });
      
      // Map stock symbols to their corresponding entries to ensure correct order and shares
      const symbolToEntryMap = new Map<string, PortfolioEntry>();
      validEntries.forEach(entry => {
        const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
        const symbol = symbolMatch ? symbolMatch[1].trim().toUpperCase() : entry.stock.trim().toUpperCase();
        symbolToEntryMap.set(symbol, entry);
      });
      
      // Fetch data for all stocks (tile only shows combined view)
      const stockDataPromises = stockSymbols.map(symbol => 
        fetchStockData({ ticker: symbol, period: timeframe })
      );
      
      const allStockData = await Promise.all(stockDataPromises);
      
      // Get stock data in the same order as stockSymbols, ensuring we match entries correctly
      const allStockDataWithSymbols = stockSymbols.map((symbol, idx) => {
        const data = allStockData[idx] || null;
        return { symbol, data };
      }).filter(item => item.data !== null);
      
      // Tile only shows combined portfolio value
      const portfolioChartData: any[] = [];
      const timePoints = new Set<number>();
      
      // Collect all time points
      allStockDataWithSymbols.forEach(({ data }) => {
        if (data && data.chart_data) {
          data.chart_data.forEach((point: any) => {
            timePoints.add(point.time);
          });
        }
      });
      
      const sortedTimes = Array.from(timePoints).sort();
      const expectedStockCount = allStockDataWithSymbols.length;
      
      // For each time point, calculate portfolio value
      sortedTimes.forEach((time) => {
        let portfolioValue = 0;
        let stocksWithData = 0;
        
        allStockDataWithSymbols.forEach(({ symbol, data }) => {
          const entry = symbolToEntryMap.get(symbol);
          if (entry && data && data.chart_data) {
            const point = data.chart_data.find((p: any) => p.time === time);
            if (point) {
              const shares = entry.shares;
              const stockValue = point.close * shares;
              portfolioValue += stockValue;
              stocksWithData++;
            }
          }
        });
        
        // Only add data point if we have data for ALL stocks (to ensure accurate portfolio value)
        if (portfolioValue > 0 && stocksWithData === expectedStockCount) {
          portfolioChartData.push({
            time,
            value: portfolioValue,
            date: new Date(time * 1000).toLocaleDateString(),
          });
        }
      });
      
      setChartData(portfolioChartData);
    } catch (error) {
      console.error('Error loading chart data:', error);
      setChartData([]);
    } finally {
      setIsLoadingChart(false);
    }
  }, [results, entries, timeframe, fetchStockData]);

  // Load chart data when results change (tile only shows combined view)
  useEffect(() => {
    if (results) {
      loadChartData();
    }
  }, [results, timeframe, loadChartData]);


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
    // Initialize dialog state from current entries/timeframe
    setDialogEntries([...entries]);
    setDialogTimeframe(timeframe);
    setRecalculateDialogOpen(true);
  };

  const handleRecalculateDialogClose = () => {
    // Reset dialog state when closing without saving
    setDialogEntries([]);
    setDialogTimeframe('1y');
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
    // Update main state from dialog state and persist
    setEntries(dialogEntries);
    setTimeframe(dialogTimeframe);
    
    // Persist to settings
    if (onSettingsChange) {
      const dataToPersist = {
        entries: dialogEntries.filter(e => e.stock && e.shares > 0),
        timeframe: dialogTimeframe,
      };
      onSettingsChange(id, {
        portfolioData: dataToPersist
      });
    }
    
    // Calculate with new values
    const portfolioData = dialogEntries
      .filter(entry => entry.stock && entry.shares > 0)
      .map(entry => {
        const symbol = entry.stock.trim().toUpperCase();
        return [symbol, entry.shares, 0] as [string, number, number];
      });
    
    if (portfolioData.length === 0) {
      setError('Please add at least one stock with shares > 0');
      return;
    }
    
    setHasPerformedInitialAnalysis(true);
    setError(null);
    
    analyzePortfolio({
      portfolio_data: portfolioData,
      period: dialogTimeframe,
      analysis_type: 'standalone'
    }).then((response) => {
      if (response && response.success) {
        setResults(response.portfolio_metrics);
      } else {
        setError('Failed to analyze portfolio. Please check your stock tickers.');
      }
    }).catch((err) => {
      console.error('Portfolio analysis error:', err);
      setError(apiError || 'An error occurred while analyzing your portfolio.');
    });
    
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
          refreshButton={{
            onClick: (e) => {
              e.stopPropagation();
              handleRefresh();
            },
            disabled: isLoading || !results,
            isLoading: isLoading,
            icon: isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />,
          }}
          collapsibleActions={
            <>
              {/* Refresh Button - shown when expanded */}
              <Tooltip title="Refresh" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefresh();
                    }}
                    disabled={isLoading || !results}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{
                      color: (isLoading || !results) ? '#6b7280' : '#9ca3af',
                      '&:hover': { color: (isLoading || !results) ? '#6b7280' : '#3b82f6' },
                      '&.Mui-disabled': { color: '#6b7280' },
                      padding: '6px',
                    }}
                  >
                    {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>

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

              <Tooltip title="Export to Portfolio Risk Analysis page">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Save portfolio data to sessionStorage for export
                    const exportData = {
                      entries: entries.filter(e => e.stock && e.shares > 0),
                      timeframe: timeframe,
                    };
                    sessionStorage.setItem('portfolio-export-data', JSON.stringify(exportData));
                    navigate('/portfolio-risk');
                  }}
                  disabled={!entries.some(e => e.stock && e.shares > 0)}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ 
                    color: '#9ca3af', 
                    '&:hover': { color: '#3b82f6' },
                    '&.Mui-disabled': { color: '#6b7280' },
                  }}
                >
                  <OpenInNewIcon fontSize="small" />
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

        {/* Chart Section - Always visible at top when results exist (Combined view only) */}
        {displayOptions.showChart && results && entries.some(e => e.stock && e.shares > 0) && (
          <Box sx={{ mb: 2, position: 'relative', height: '200px', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', p: 1 }}>
            {isLoadingChart ? (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress size={24} sx={{ color: tileColor }} />
              </Box>
            ) : chartData && chartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#9ca3af" 
                      fontSize={10}
                      tick={{ fill: '#9ca3af' }}
                      axisLine={{ stroke: '#374151' }}
                      label={{ value: 'Date', position: 'insideBottom', offset: -5, fill: '#9ca3af', fontSize: 11 }}
                      tickFormatter={(value) => {
                        const dataPoint = chartData.find(d => d.time === value);
                        return dataPoint?.date || new Date(value * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                    />
                    <YAxis 
                      stroke="#9ca3af" 
                      fontSize={10}
                      tick={{ fill: '#9ca3af' }}
                      axisLine={{ stroke: '#374151' }}
                      label={{ value: 'Portfolio Value ($)', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
                      domain={(() => {
                        // Calculate Y-axis domain: +/- 20% of highest/lowest point
                        if (chartData.length === 0) return ['auto', 'auto'];
                        const values = chartData.map(d => d.value).filter(v => v != null && !isNaN(v));
                        if (values.length === 0) return ['auto', 'auto'];
                        const minValue = Math.min(...values);
                        const maxValue = Math.max(...values);
                        const range = maxValue - minValue;
                        const padding = range * 0.2; // 20% padding
                        return [Math.max(0, minValue - padding), maxValue + padding];
                      })()}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
                        return `$${value.toFixed(0)}`;
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid #374151',
                        borderRadius: '4px',
                        color: 'white'
                      }}
                      labelFormatter={(value) => {
                        const dataPoint = chartData.find(d => d.time === value);
                        return dataPoint?.date || new Date(value * 1000).toLocaleDateString();
                      }}
                      formatter={(value: any) => {
                        if (typeof value === 'number') {
                          return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                        return value;
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="value" 
                      stroke={tileColor} 
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: tileColor }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                {/* Info Icon with Tooltip - Bottom Left */}
                <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10 }}>
                  <Tooltip 
                    title="Export to Portfolio Risk Analysis page"
                    arrow
                    placement="top"
                  >
                    <IconButton
                      size="small"
                      onClick={() => {
                        // Save portfolio data to sessionStorage for export
                        const exportData = {
                          entries: entries.filter(e => e.stock && e.shares > 0),
                          timeframe: timeframe,
                        };
                        sessionStorage.setItem('portfolio-export-data', JSON.stringify(exportData));
                        navigate('/portfolio-risk');
                      }}
                      disabled={!entries.some(e => e.stock && e.shares > 0)}
                      sx={{
                        width: 20,
                        height: 20,
                        padding: 0,
                        color: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#2563eb',
                          borderColor: '#2563eb',
                        },
                        '&.Mui-disabled': {
                          color: '#6b7280',
                          backgroundColor: 'rgba(107, 114, 128, 0.1)',
                          borderColor: 'rgba(107, 114, 128, 0.2)',
                        },
                      }}
                    >
                      <OpenInNewIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                  No chart data available
                </Typography>
              </Box>
            )}
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
                  value={dialogTimeframe}
                  label="Timeframe"
                  onChange={(e) => setDialogTimeframe(e.target.value)}
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

              {dialogEntries.map((entry, index) => {
                // Find security object for current entry
                const currentSecurity = isSecurityDataLoaded && entry.stock
                  ? securitySuggestionsServiceV2.findBySymbol(entry.stock.toUpperCase())
                  : null;
                
                // For freeSolo, use the string value if no security object is found
                // This allows manually typed symbols (like ETFs) to display correctly
                const autocompleteValue = currentSecurity ?? (entry.stock || null);
                
                // Use unique key combining stock and index to prevent React from removing elements
                const entryKey = `${entry.stock || 'empty'}-${index}`;

                return (
                  <Box key={entryKey} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                    <Autocomplete
                      value={autocompleteValue}
                      onChange={(_, newValue) => {
                        // Only update when user explicitly selects from dropdown
                        if (newValue) {
                          if (typeof newValue === 'string') {
                            // Extract symbol if it's in display format
                            const symbolMatch = newValue.match(/^([A-Z.]+)(?:\s*-|$)/);
                            const symbol = symbolMatch ? symbolMatch[1].trim() : newValue.trim();
                            const newEntries = [...dialogEntries];
                            newEntries[index] = { ...newEntries[index], stock: symbol.toUpperCase() };
                            setDialogEntries(newEntries);
                          } else {
                            // Security object selected
                            const newEntries = [...dialogEntries];
                            newEntries[index] = { ...newEntries[index], stock: newValue.symbol.toUpperCase() };
                            setDialogEntries(newEntries);
                          }
                        }
                      }}
                      onInputChange={(_, newInputValue) => {
                        // Only update suggestions, don't update entry value
                        handleStockInputChange(index, newInputValue);
                        // Don't update entry on input - only on selection or blur
                      }}
                      onBlur={(e) => {
                        // On blur, normalize and save the current input value (for freeSolo entries)
                        const inputValue = (e.target as HTMLInputElement).value;
                        if (inputValue && !currentSecurity) {
                          // Normalize to uppercase
                          const normalizedSymbol = inputValue.trim().toUpperCase();
                          if (normalizedSymbol && normalizedSymbol.length > 0) {
                            const newEntries = [...dialogEntries];
                            newEntries[index] = { ...newEntries[index], stock: normalizedSymbol };
                            setDialogEntries(newEntries);
                          }
                        }
                      }}
                      options={securitySuggestions}
                      getOptionLabel={(option) => {
                        if (typeof option === 'string') return option;
                        return option.displayText || option.symbol || '';
                      }}
                      isOptionEqualToValue={(option: Security | string, value: Security | string | null) => {
                        // Compare by symbol to handle selection, including string values for freeSolo
                        if (!value) return false;
                        
                        if (typeof option === 'string' && typeof value === 'string') {
                          return option.toUpperCase() === value.toUpperCase();
                        }
                        if (typeof option === 'string' && typeof value === 'object' && 'symbol' in value) {
                          return option.toUpperCase() === (value.symbol?.toUpperCase() || '');
                        }
                        if (typeof value === 'string' && typeof option === 'object' && 'symbol' in option) {
                          return value.toUpperCase() === (option.symbol?.toUpperCase() || '');
                        }
                        if (typeof option === 'object' && typeof value === 'object' && 'symbol' in option && 'symbol' in value) {
                          return option.symbol === value.symbol;
                        }
                        return false;
                      }}
                      loading={!isSecurityDataLoaded}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          label="Stock"
                          sx={{
                            flexGrow: 1,
                            '& .MuiOutlinedInput-root': {
                              color: 'white',
                              '& fieldset': {
                                borderColor: '#374151',
                              },
                              '&:hover fieldset': {
                                borderColor: '#3b82f6',
                              },
                              '&.Mui-focused fieldset': {
                                borderColor: '#3b82f6',
                              },
                            },
                            '& .MuiInputLabel-root': {
                              color: '#9ca3af',
                            },
                          }}
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {!isSecurityDataLoaded ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                      renderOption={(props, option) => {
                        // Handle both Security objects and strings (for freeSolo)
                        if (typeof option === 'string') {
                          return (
                            <Box component="li" {...props} key={option} sx={{ py: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                                {option}
                              </Typography>
                            </Box>
                          );
                        }
                        
                        // Type guard: option is a Security object
                        const security = option as Security;
                        const capColor = security.marketCap === 'high' ? '#10b981' : security.marketCap === 'mid' ? '#f59e0b' : '#ef4444';
                        const capLabel = security.marketCap === 'high' ? 'High Cap' : security.marketCap === 'mid' ? 'Mid Cap' : 'Low Cap';
                        const uniqueKey = `${security.symbol}-${security.marketCap}-${security.name}`;
                        return (
                          <Box component="li" {...props} key={uniqueKey} sx={{ py: 1 }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                                  {security.symbol}
                                </Typography>
                                <Chip 
                                  label={capLabel} 
                                  size="small" 
                                  sx={{ 
                                    height: '18px', 
                                    fontSize: '0.65rem',
                                    backgroundColor: capColor,
                                    color: 'white'
                                  }} 
                                />
                              </Box>
                              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                {security.name}
                              </Typography>
                            </Box>
                          </Box>
                        );
                      }}
                      sx={{
                        flexGrow: 1,
                        '& .MuiAutocomplete-popper': {
                          '& .MuiPaper-root': {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            border: '1px solid #374151',
                          },
                          '& .MuiAutocomplete-listbox': {
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
                          },
                        },
                      }}
                      ListboxProps={{
                        sx: {
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
                        },
                      }}
                      freeSolo
                      autoSelect={false}
                      selectOnFocus={false}
                      clearOnBlur={false}
                      autoHighlight={false}
                      disableListWrap={true}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Shares"
                      value={entry.shares}
                      onChange={(e) => {
                        const newEntries = [...dialogEntries];
                        newEntries[index] = { ...newEntries[index], shares: parseFloat(e.target.value) || 0 };
                        setDialogEntries(newEntries);
                      }}
                      sx={{ 
                        flexGrow: 1,
                        '& .MuiOutlinedInput-root': {
                          color: 'white',
                          '& fieldset': {
                            borderColor: '#374151',
                          },
                          '&:hover fieldset': {
                            borderColor: '#3b82f6',
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: '#3b82f6',
                          },
                        },
                        '& .MuiInputLabel-root': {
                          color: '#9ca3af',
                        },
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => {
                        const newEntries = dialogEntries.filter((_, i) => i !== index);
                        if (newEntries.length === 0) {
                          setDialogEntries([{ stock: '', shares: 0 }]);
                        } else {
                          setDialogEntries(newEntries);
                        }
                      }}
                      disabled={dialogEntries.length === 1}
                      sx={{ color: '#ef4444' }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                );
              })}

              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    setDialogEntries([...dialogEntries, { stock: '', shares: 0 }]);
                  }}
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
            disabled={isLoading || dialogEntries.some(e => !e.stock || e.shares <= 0)}
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
                    onChange={(e) => {
                      const newDisplayOptions = { ...displayOptions, showHoldings: e.target.checked };
                      onUpdate?.(id, { displayOptions: newDisplayOptions });
                      onSettingsChange?.(id, { displayOptions: newDisplayOptions });
                    }}
                  />
                }
                label="Show Holdings Input"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showPerformance}
                    onChange={(e) => {
                      const newDisplayOptions = { ...displayOptions, showPerformance: e.target.checked };
                      onUpdate?.(id, { displayOptions: newDisplayOptions });
                      onSettingsChange?.(id, { displayOptions: newDisplayOptions });
                    }}
                  />
                }
                label="Show Performance Metrics"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showRiskMetrics}
                    onChange={(e) => {
                      const newDisplayOptions = { ...displayOptions, showRiskMetrics: e.target.checked };
                      onUpdate?.(id, { displayOptions: newDisplayOptions });
                      onSettingsChange?.(id, { displayOptions: newDisplayOptions });
                    }}
                  />
                }
                label="Show Risk Metrics"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showStockDetails}
                    onChange={(e) => {
                      const newDisplayOptions = { ...displayOptions, showStockDetails: e.target.checked };
                      onUpdate?.(id, { displayOptions: newDisplayOptions });
                      onSettingsChange?.(id, { displayOptions: newDisplayOptions });
                    }}
                  />
                }
                label="Show Stock Details Table"
                sx={{ color: '#ffffff' }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={displayOptions.showChart}
                    onChange={(e) => {
                      const newDisplayOptions = { ...displayOptions, showChart: e.target.checked };
                      onUpdate?.(id, { displayOptions: newDisplayOptions });
                      onSettingsChange?.(id, { displayOptions: newDisplayOptions });
                    }}
                  />
                }
                label="Show Chart"
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
        prevDisplay.showStockDetails !== nextDisplay.showStockDetails ||
        prevDisplay.showChart !== nextDisplay.showChart) {
      return false; // Re-render
    }
  }
  
  // Check if portfolioData changed (entries and timeframe)
  const prevPortfolioData = prevProps.portfolioData;
  const nextPortfolioData = nextProps.portfolioData;
  if (prevPortfolioData !== nextPortfolioData) {
    // Deep compare portfolioData entries and timeframe
    if (prevPortfolioData && nextPortfolioData) {
      const prevEntriesStr = JSON.stringify(prevPortfolioData.entries || []);
      const nextEntriesStr = JSON.stringify(nextPortfolioData.entries || []);
      const prevTimeframe = prevPortfolioData.timeframe || '1y';
      const nextTimeframe = nextPortfolioData.timeframe || '1y';
      if (prevEntriesStr !== nextEntriesStr || prevTimeframe !== nextTimeframe) {
        return false; // Re-render
      }
    } else {
      return false; // Re-render if one is null/undefined
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
