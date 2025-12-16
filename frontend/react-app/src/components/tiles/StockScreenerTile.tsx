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
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  TrendingUp as TrendingUpIcon,
  Business as BusinessIcon,
  AttachMoney as MoneyIcon,
  Speed as SpeedIcon,
  Dashboard as AddToContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  ViewColumn as ViewColumnIcon,
} from '@mui/icons-material';
import { useStockScreener } from '../../hooks/useAPI';
import { useTilePinning, TileHeaderActions, addStockToContext, addMultipleStocksToContext, confirmDialog } from './common';

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
    showPERatio: boolean;
    showDividendYield: boolean;
    showResultsTable: boolean;
    showCriteriaSummary: boolean;
    maxResults: number;
  };
  filterSettings?: {
    industries?: string[];
    marketCapRanges?: string[];
    volatilityRanges?: string[];
    priceChangeRanges?: string[];
  };
  isPinned?: boolean;
}

interface StockScreenerCriteria {
  industries: string[];
  volatilityRange: [number, number];
  priceChangeRange: [number, number];
  marketCapRange: [number, number];
  priceRange: [number, number];
  peRatioRange: [number, number];
  dividendYieldRange: [number, number];
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
  size,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
  criteria = {
    industries: [],
    volatilityRange: [0, 100],
    priceChangeRange: [-50, 50],
    marketCapRange: [0, 10000000000000], // $0 to $10 trillion
    priceRange: [0, 1000],
    peRatioRange: [0, 100],
    dividendYieldRange: [0, 20],
    timeframe: '1d',
  },
  results = [],
  displayOptions = {
    showIndustry: true,
    showMarketCap: true,
    showVolatility: true,
    showPriceChange: true,
    showPERatio: true,
    showDividendYield: true,
    showResultsTable: true,
    showCriteriaSummary: true,
    maxResults: 100000, // Get all matching stocks (effectively unlimited)
  },
  filterSettings: initialFilterSettings,
  isPinned = false,
}) => {
  const [criteriaDialogOpen, setCriteriaDialogOpen] = useState(false);
  // const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });
  // Ensure new criteria fields have defaults for old tiles
  const [localCriteria, setLocalCriteria] = useState<StockScreenerCriteria>({
    ...criteria,
    peRatioRange: criteria.peRatioRange || [0, 100],
    dividendYieldRange: criteria.dividendYieldRange || [0, 20],
  });
  // Ensure maxResults is high enough for proper pagination (upgrade old tiles with maxResults: 10)
  const [localDisplayOptions, setLocalDisplayOptions] = useState({
    ...displayOptions,
    maxResults: Math.max(displayOptions.maxResults || 100000, 100000),
    showPERatio: displayOptions.showPERatio ?? true,
    showDividendYield: displayOptions.showDividendYield ?? true,
  });
  const [currentPage, setCurrentPage] = useState(1);
  // Store all results for client-side filtering
  const [allResults, setAllResults] = useState<StockResult[]>(results || []);
  const [filteredResults, setFilteredResults] = useState<StockResult[]>(results || []);
  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Client-side filter state - restore from props if available
  const [selectedFilters] = useState<{
    industries: Set<string>;
    marketCapRanges: Set<string>;
    volatilityRanges: Set<string>;
    priceChangeRanges: Set<string>;
  }>({
    industries: new Set(initialFilterSettings?.industries || []),
    marketCapRanges: new Set(initialFilterSettings?.marketCapRanges || []),
    volatilityRanges: new Set(initialFilterSettings?.volatilityRanges || []),
    priceChangeRanges: new Set(initialFilterSettings?.priceChangeRanges || []),
  });
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState({
    industry: localDisplayOptions.showIndustry,
    marketCap: localDisplayOptions.showMarketCap,
    volatility: localDisplayOptions.showVolatility,
    priceChange: localDisplayOptions.showPriceChange,
    peRatio: localDisplayOptions.showPERatio,
    dividendYield: localDisplayOptions.showDividendYield,
  });

  // Sync visibleColumns with localDisplayOptions when it changes
  useEffect(() => {
    setVisibleColumns({
      industry: localDisplayOptions.showIndustry,
      marketCap: localDisplayOptions.showMarketCap,
      volatility: localDisplayOptions.showVolatility,
      priceChange: localDisplayOptions.showPriceChange,
      peRatio: localDisplayOptions.showPERatio,
      dividendYield: localDisplayOptions.showDividendYield,
    });
  }, [localDisplayOptions.showIndustry, localDisplayOptions.showMarketCap, localDisplayOptions.showVolatility, localDisplayOptions.showPriceChange, localDisplayOptions.showPERatio, localDisplayOptions.showDividendYield]);

  // Handle column toggle
  const handleColumnToggle = useCallback((columnKey: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => {
      const newColumns = {
        ...prev,
        [columnKey]: !prev[columnKey],
      };
      
      // Update display options via onSettingsChange to persist
      const displayOptionKey = columnKey === 'peRatio' ? 'showPERatio' : 
                               columnKey === 'priceChange' ? 'showPriceChange' :
                               `show${columnKey.charAt(0).toUpperCase() + columnKey.slice(1)}` as keyof typeof localDisplayOptions;
      const newDisplayOptions = {
        ...localDisplayOptions,
        [displayOptionKey]: newColumns[columnKey],
      };
      setLocalDisplayOptions(newDisplayOptions);
      onSettingsChange(id, { displayOptions: newDisplayOptions });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);
  const tileRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number>(0);

  // Mock loading and error states for now
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GICS Sector options (mapped from SEC SIC codes)
  // Note: These are sectors, not industries. The backend stores GICS sectors.
  const sectorOptions = [
    'Information Technology',
    'Health Care',
    'Financials',
    'Consumer Discretionary',
    'Consumer Staples',
    'Industrials',
    'Energy',
    'Materials',
    'Real Estate',
    'Utilities',
    'Communication Services',
  ];
  
  // Keep as industryOptions for backwards compatibility with existing code
  const industryOptions = sectorOptions;

  // Mock stock data for demonstration (currently unused)
  /*
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
  */

  // Filter stocks based on criteria (currently unused)
  /*
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
  */

  // Use the real stock screener API hook
  const stockScreenerHook = useStockScreener();
  const { loading: apiLoading, error: apiError, execute: executeScreener } = stockScreenerHook;

  // Handle API loading state - only update if we're not already in a manual loading state
  // This prevents the API hook from clearing loading state prematurely
  useEffect(() => {
    if (apiLoading !== undefined && apiLoading) {
      setIsLoading(true);
    }
  }, [apiLoading]);

  // Handle API errors
  useEffect(() => {
    if (apiError) {
      const errorMessage = typeof apiError === 'string' ? apiError : (apiError as any)?.message || 'Failed to fetch stock data';
      setError(`API Error: ${errorMessage}`);
    }
  }, [apiError]);

  // Run stock screener
  const runScreener = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Format the request properly for the API
      // Map 'industries' to 'sectors' for backend compatibility (industries are actually GICS sectors)
      const { industries, ...criteriaWithoutIndustries } = localCriteria;
      const backendCriteria = {
        ...criteriaWithoutIndustries,
        sectors: industries,  // Map industries to sectors (and remove industries field)
      };
      
      const requestPayload = {
        criteria: backendCriteria,
        maxResults: localDisplayOptions.maxResults || 100000  // Get all matching stocks (effectively unlimited)
      };
      
      // Use the API hook to fetch data with criteria
      const response = await executeScreener(requestPayload);
      
      if (response?.results) {
        setAllResults(response.results);
        // Don't set filteredResults here - let applyFilters handle it after state update
        
        // Update tile with results
        onUpdate(id, {
          results: response.results,
          criteria: localCriteria,
          lastUpdated: new Date().toISOString(),
        });
        
        // Clear error if successful
        setError(null);
      } else if (response?.message) {
        // Show message from backend (e.g., "No stocks match criteria")
        setAllResults([]);
        setFilteredResults([]);
        setError(null);  // Not an error, just no results
      } else {
        // Unknown response format
        setAllResults([]);
        setFilteredResults([]);
        setError('Unexpected response format');
      }
    } catch (err) {
      setError('Failed to fetch stock data. Please try again.');
      setAllResults([]);
      setFilteredResults([]);
      console.error('Stock screener error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [executeScreener, localCriteria, localDisplayOptions.maxResults, id, onUpdate]);

  // Initial load
  useEffect(() => {
    if (allResults.length === 0) {
      runScreener();
    }
  }, [runScreener, allResults.length]);

  const handleCriteriaChange = (newCriteria: StockScreenerCriteria) => {
    setLocalCriteria(newCriteria);
    onSettingsChange(id, { criteria: newCriteria });
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Stock Screener from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });
    if (confirmed) {
      onRemove(id);
    }
  };

  const handleStockSelect = (symbol: string) => {
    setSelectedStocks(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const handleAddToContextClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (selectedStocks.length === 0) {
      alert('Please select at least one stock to add to context');
      return;
    }
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    if (selectedStocks.length === 0) return;
    
    // Get the selected stock objects from filteredResults state
    const selectedStockObjects = filteredResults.filter(stock => 
      selectedStocks.includes(stock.symbol)
    );
    
    console.log(`📦 Adding ${selectedStockObjects.length} stock(s) to context (target: ${target})`);
    
    // Prepare stock data for batch addition
    const stocksToAdd = selectedStockObjects.map(stock => {
      const stockData = stock as any; // Type assertion for backend compatibility
      return {
        symbol: stock.symbol,
        name: stock.name || stock.symbol,
        timeframe: localCriteria.timeframe,
        stockData: {
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          price: stock.price ?? stockData.current_price ?? 0,
          priceChange: stock.priceChange ?? stockData.price_change ?? 0,
          priceChangePercent: stock.priceChangePercent ?? stockData.price_change_percent ?? 0,
          marketCap: stock.marketCap ?? stockData.market_cap ?? 0,
          volatility: stock.volatility ?? 0,
          volume: stock.volume ?? 0,
          avgVolume: stockData.avg_volume ?? 0,
          industry: stock.industry ?? 'Unknown',
          sector: stockData.sector ?? 'Unknown',
          peRatio: stockData.pe_ratio ?? 0,
          dividendYield: stockData.dividend_yield ?? 0,
          dayHigh: stockData.day_high ?? 0,
          dayLow: stockData.day_low ?? 0,
          yearHigh: stockData.year_high ?? 0,
          yearLow: stockData.year_low ?? 0,
          weekReturn: stockData.week_return ?? 0,
          previousClose: stockData.previous_close ?? 0,
          timeframe: localCriteria.timeframe,
        }
      };
    });
    
    // Use batch addition for multiple stocks, single addition for one stock
    if (stocksToAdd.length > 1) {
      addMultipleStocksToContext(stocksToAdd, target);
      console.log(`✅ Added ${stocksToAdd.length} stocks to context in batch`);
    } else if (stocksToAdd.length === 1) {
      const stock = stocksToAdd[0];
      addStockToContext(
        stock.symbol,
        stock.name,
        stock.timeframe,
        stock.stockData,
        target
      );
      console.log(`✅ Added stock to context: ${stock.symbol}`);
    }
    
    // Clear selection and close menu
    setSelectedStocks([]);
    handleContextMenuClose();
  };

  const formatMarketCap = (marketCap: number | null | undefined) => {
    if (marketCap === null || marketCap === undefined || marketCap === 0) return 'N/A';
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T USD`;
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B USD`;
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M USD`;
    return `$${marketCap.toFixed(0)} USD`;
  };

  const formatVolatilityRange = (range: [number, number]) => {
    return `${range[0]}% - ${range[1]}%`;
  };

  const formatPriceRange = (range: [number, number]) => {
    return `$${range[0]} - $${range[1]}`;
  };

  // Dynamic pagination based on tile height
  const calculateResultsPerPage = useCallback(() => {
    if (!tileRef.current) return 5; // Default fallback
    
    const tileHeight = tileRef.current.clientHeight;
    const headerHeight = 60; // Approximate header height
    const paginationHeight = 40; // Approximate pagination height
    const tableHeaderHeight = 40; // Table header height
    const rowHeight = 32; // Approximate row height
    const padding = 24; // Tile padding (12px * 2)
    
    // Calculate available height for table rows
    const availableHeight = tileHeight - headerHeight - paginationHeight - tableHeaderHeight - padding;
    const maxRows = Math.floor(availableHeight / rowHeight);
    
    // Ensure minimum of 3 rows and maximum of 20 rows
    return Math.max(3, Math.min(20, maxRows));
  }, []);

  const [resultsPerPage, setResultsPerPage] = useState(5);
  
  // Update results per page when tile size changes
  useEffect(() => {
    const newResultsPerPage = calculateResultsPerPage();
    setResultsPerPage(newResultsPerPage);
  }, [calculateResultsPerPage, size]);

  // Add ResizeObserver to recalculate when tile is resized
  useEffect(() => {
    if (!tileRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      const newResultsPerPage = calculateResultsPerPage();
      setResultsPerPage(newResultsPerPage);
    });

    resizeObserver.observe(tileRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateResultsPerPage]);

  // Client-side filtering function
  const applyFilters = useCallback(() => {
    // If no filters are selected, show all results
    const hasFilters = selectedFilters.industries.size > 0 || 
                       selectedFilters.marketCapRanges.size > 0 || 
                       selectedFilters.volatilityRanges.size > 0 ||
                       selectedFilters.priceChangeRanges.size > 0;
    
    if (!hasFilters) {
      setFilteredResults([...allResults]);
      return;
    }
    
    let filtered = [...allResults];
    
    // Industry filter
    if (selectedFilters.industries.size > 0) {
      filtered = filtered.filter(stock => 
        selectedFilters.industries.has(stock.industry || 'Unknown')
      );
    }
    
    // Market cap range filter
    if (selectedFilters.marketCapRanges.size > 0) {
      filtered = filtered.filter(stock => {
        const marketCap = stock.marketCap || 0;
        return Array.from(selectedFilters.marketCapRanges).some(range => {
          if (range === 'micro') return marketCap < 300_000_000; // < $300M
          if (range === 'small') return marketCap >= 300_000_000 && marketCap < 2_000_000_000; // $300M - $2B
          if (range === 'mid') return marketCap >= 2_000_000_000 && marketCap < 10_000_000_000; // $2B - $10B
          if (range === 'large') return marketCap >= 10_000_000_000 && marketCap < 200_000_000_000; // $10B - $200B
          if (range === 'mega') return marketCap >= 200_000_000_000; // >= $200B
          return false;
        });
      });
    }
    
    // Volatility range filter
    if (selectedFilters.volatilityRanges.size > 0) {
      filtered = filtered.filter(stock => {
        const volatility = stock.volatility || 0;
        return Array.from(selectedFilters.volatilityRanges).some(range => {
          if (range === 'low') return volatility < 20;
          if (range === 'medium') return volatility >= 20 && volatility < 40;
          if (range === 'high') return volatility >= 40;
          return false;
        });
      });
    }
    
    // Price change range filter
    if (selectedFilters.priceChangeRanges.size > 0) {
      filtered = filtered.filter(stock => {
        const priceChange = stock.priceChangePercent || 0;
        return Array.from(selectedFilters.priceChangeRanges).some(range => {
          if (range === 'gain') return priceChange > 0;
          if (range === 'loss') return priceChange < 0;
          if (range === 'big-gain') return priceChange > 5;
          if (range === 'big-loss') return priceChange < -5;
          return false;
        });
      });
    }
    
    setFilteredResults(filtered);
  }, [allResults, selectedFilters]);

  // Apply filters when selectedFilters or allResults change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Generate available filters from all results
  // TODO: Implement filter dialog that uses availableFilters
  // const availableFilters = useMemo(() => {
  //   const industryMap = new Map<string, number>();
  //   const marketCapCounts = { micro: 0, small: 0, mid: 0, large: 0, mega: 0 };
  //   const volatilityCounts = { low: 0, medium: 0, high: 0 };
  //   const priceChangeCounts = { gain: 0, loss: 0, 'big-gain': 0, 'big-loss': 0 };
  //   
  //   allResults.forEach(stock => {
  //     // Industries
  //     const industry = stock.industry || 'Unknown';
  //     industryMap.set(industry, (industryMap.get(industry) || 0) + 1);
  //     
  //     // Market cap ranges
  //     const marketCap = stock.marketCap || 0;
  //     if (marketCap < 300_000_000) marketCapCounts.micro++;
  //     else if (marketCap < 2_000_000_000) marketCapCounts.small++;
  //     else if (marketCap < 10_000_000_000) marketCapCounts.mid++;
  //     else if (marketCap < 200_000_000_000) marketCapCounts.large++;
  //     else marketCapCounts.mega++;
  //     
  //     // Volatility ranges
  //     const volatility = stock.volatility || 0;
  //     if (volatility < 20) volatilityCounts.low++;
  //     else if (volatility < 40) volatilityCounts.medium++;
  //     else volatilityCounts.high++;
  //     
  //     // Price change ranges
  //     const priceChange = stock.priceChangePercent || 0;
  //     if (priceChange > 5) priceChangeCounts['big-gain']++;
  //     else if (priceChange > 0) priceChangeCounts.gain++;
  //     else if (priceChange < -5) priceChangeCounts['big-loss']++;
  //     else if (priceChange < 0) priceChangeCounts.loss++;
  //   });
  //   
  //   return {
  //     industries: Array.from(industryMap.entries())
  //       .map(([industry, count]) => ({ industry, count }))
  //       .sort((a, b) => b.count - a.count),
  //     marketCapRanges: Object.entries(marketCapCounts)
  //       .map(([range, count]) => ({ range, count }))
  //       .filter(item => item.count > 0),
  //     volatilityRanges: Object.entries(volatilityCounts)
  //       .map(([range, count]) => ({ range, count }))
  //       .filter(item => item.count > 0),
  //     priceChangeRanges: Object.entries(priceChangeCounts)
  //       .map(([range, count]) => ({ range, count }))
  //       .filter(item => item.count > 0),
  //   };
  // }, [allResults]);

  const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentResults = filteredResults.slice(startIndex, endIndex);

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
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          borderColor: '#3b82f6',
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : '0 8px 25px rgba(59, 130, 246, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: filteredResults.length > 0 ? '#3b82f6' : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
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
            label={`${filteredResults.length}${filteredResults.length !== allResults.length ? ` of ${allResults.length}` : ''} results`}
            size="small"
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
            }}
          />
          
        </Box>

        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          contextButton={{
            onClick: handleAddToContextClick,
            disabled: selectedStocks.length === 0,
            tooltip: `Add ${selectedStocks.length > 0 ? `${selectedStocks.length} stock(s)` : 'selected stocks'} to context`,
            icon: <AddToContextIcon sx={{ fontSize: 18 }} />,
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          collapsibleActions={
            <>
              <Tooltip title="Refresh">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    runScreener();
                  }}
                  disabled={isLoading}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  {isLoading ? (
                    <CircularProgress size={18} sx={{ color: '#3b82f6' }} />
                  ) : (
                    <RefreshIcon sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </Tooltip>

              <Tooltip title="Select columns to display">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColumnMenuAnchor(e.currentTarget);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <ViewColumnIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title={
                (selectedFilters.industries.size > 0 || 
                 selectedFilters.marketCapRanges.size > 0 || 
                 selectedFilters.volatilityRanges.size > 0 ||
                 selectedFilters.priceChangeRanges.size > 0) 
                  ? `Filter Results (${selectedFilters.industries.size + selectedFilters.marketCapRanges.size + selectedFilters.volatilityRanges.size + selectedFilters.priceChangeRanges.size} active)`
                  : "Filter Results"
              }>
                <Box sx={{ position: 'relative' }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterDialogOpen(true);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{ 
                      color: (selectedFilters.industries.size > 0 || 
                              selectedFilters.marketCapRanges.size > 0 || 
                              selectedFilters.volatilityRanges.size > 0 ||
                              selectedFilters.priceChangeRanges.size > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.industries.size > 0 || 
                    selectedFilters.marketCapRanges.size > 0 || 
                    selectedFilters.volatilityRanges.size > 0 ||
                    selectedFilters.priceChangeRanges.size > 0) && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 8,
                        height: 8,
                        backgroundColor: '#3b82f6',
                        borderRadius: '50%',
                        border: '1px solid #1e293b',
                      }}
                    />
                  )}
                </Box>
              </Tooltip>

              <Tooltip title="Edit Criteria">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCriteriaDialogOpen(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <SearchIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
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
      {localDisplayOptions.showResultsTable && filteredResults.length > 0 && !isLoading && (
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
                  <TableCell padding="checkbox" sx={{ width: '48px' }}>
                    <Checkbox
                      size="small"
                      checked={selectedStocks.length === currentResults.length && currentResults.length > 0}
                      indeterminate={selectedStocks.length > 0 && selectedStocks.length < currentResults.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedStocks(currentResults.map(s => s.symbol));
                        } else {
                          setSelectedStocks([]);
                        }
                      }}
                      sx={{
                        color: '#9ca3af',
                        '&.Mui-checked': { color: '#10b981' },
                        '&.MuiCheckbox-indeterminate': { color: '#10b981' },
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Symbol</TableCell>
                  {visibleColumns.industry && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Industry</TableCell>
                  )}
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Price</TableCell>
                  {visibleColumns.priceChange && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Change</TableCell>
                  )}
                  {visibleColumns.marketCap && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Market Cap</TableCell>
                  )}
                  {visibleColumns.volatility && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Volatility</TableCell>
                  )}
                  {visibleColumns.peRatio && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>P/E</TableCell>
                  )}
                  {visibleColumns.dividendYield && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Div Yield</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentResults.map((stock) => {
                  // Safe accessors with defaults - type assertion for backend compatibility
                  const stockData = stock as any;
                  const price = stock.price ?? stockData.current_price ?? 0;
                  const priceChangePercent = stock.priceChangePercent ?? stockData.price_change_percent ?? 0;
                  const marketCap = stock.marketCap ?? stockData.market_cap ?? 0;
                  const volatility = stock.volatility ?? 0;
                  const industry = stock.industry ?? 'Unknown';
                  const peRatio = stockData.pe_ratio ?? stock.pe ?? 0;
                  const dividendYield = stockData.dividend_yield ?? 0;
                  
                  return (
                    <TableRow 
                      key={stock.symbol} 
                      hover
                      selected={selectedStocks.includes(stock.symbol)}
                      sx={{
                        '&.Mui-selected': {
                          backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        },
                        '&.Mui-selected:hover': {
                          backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        },
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={selectedStocks.includes(stock.symbol)}
                          onChange={() => handleStockSelect(stock.symbol)}
                          sx={{
                            color: '#9ca3af',
                            '&.Mui-checked': { color: '#10b981' },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'white', fontWeight: 600, fontSize: '0.875rem' }}>{stock.symbol}</TableCell>
                      {visibleColumns.industry && (
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{industry}</TableCell>
                      )}
                      <TableCell sx={{ color: 'white', fontWeight: 600, fontSize: '0.875rem' }}>
                        ${price.toFixed(2)}
                      </TableCell>
                      {visibleColumns.priceChange && (
                        <TableCell
                          sx={{
                            color: priceChangePercent >= 0 ? '#22c55e' : '#dc2626',
                            fontWeight: 600,
                            fontSize: '0.875rem',
                          }}
                        >
                          {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                        </TableCell>
                      )}
                      {visibleColumns.marketCap && (
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{formatMarketCap(marketCap)}</TableCell>
                      )}
                      {visibleColumns.volatility && (
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>{volatility.toFixed(1)}%</TableCell>
                      )}
                      {visibleColumns.peRatio && (
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                          {peRatio > 0 ? peRatio.toFixed(1) : 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.dividendYield && (
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                          {dividendYield > 0 ? `${dividendYield.toFixed(2)}%` : 'N/A'}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              mt: 1, 
              pt: 1, 
              borderTop: '1px solid rgba(55, 65, 81, 0.3)' 
            }}>
              <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                Showing {startIndex + 1}-{Math.min(endIndex, filteredResults.length)} of {filteredResults.length} results
              </Typography>
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
      {!isLoading && filteredResults.length === 0 && !error && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No stocks match your criteria. Try adjusting your filters.
          </Typography>
        </Box>
      )}


      {/* Context Target Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <MenuItem onClick={() => handleAddToContext('new')}>
          <NewChatIcon sx={{ mr: 1, fontSize: 18, color: '#10b981' }} />
          Add to New Chat
        </MenuItem>
        <MenuItem onClick={() => handleAddToContext('sidebar')}>
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Current Sidebar Chat
        </MenuItem>
      </Menu>

      {/* Column Selection Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
          },
        }}
      >
        {[
          { key: 'industry', label: 'Industry' },
          { key: 'marketCap', label: 'Market Cap' },
          { key: 'volatility', label: 'Volatility' },
          { key: 'priceChange', label: 'Price Change' },
          { key: 'peRatio', label: 'P/E Ratio' },
          { key: 'dividendYield', label: 'Dividend Yield' },
        ].map((column) => (
          <MenuItem
            key={column.key}
            onClick={() => handleColumnToggle(column.key as keyof typeof visibleColumns)}
            sx={{
              color: visibleColumns[column.key as keyof typeof visibleColumns] ? '#3b82f6' : '#94a3b8',
            }}
          >
            <Checkbox
              checked={visibleColumns[column.key as keyof typeof visibleColumns]}
              sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
            />
            {column.label}
          </MenuItem>
        ))}
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
                max={10000000000000}  // $10 trillion to include mega-caps like AAPL, NVDA
                step={10000000000}    // $10 billion steps
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

            {/* P/E Ratio Range */}
            <Box>
              <Typography gutterBottom>
                P/E Ratio Range: {localCriteria.peRatioRange[0].toFixed(1)} - {localCriteria.peRatioRange[1] === 100 ? '100+' : localCriteria.peRatioRange[1].toFixed(1)}
              </Typography>
              <Slider
                value={localCriteria.peRatioRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, peRatioRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={0}
                max={100}
                step={0.5}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            {/* Dividend Yield Range */}
            <Box>
              <Typography gutterBottom>
                Dividend Yield Range: {localCriteria.dividendYieldRange[0].toFixed(1)}% - {localCriteria.dividendYieldRange[1] === 20 ? '20%+' : `${localCriteria.dividendYieldRange[1].toFixed(1)}%`}
              </Typography>
              <Slider
                value={localCriteria.dividendYieldRange}
                onChange={(_, newValue) => {
                  handleCriteriaChange({ ...localCriteria, dividendYieldRange: newValue as [number, number] });
                }}
                valueLabelDisplay="auto"
                min={0}
                max={20}
                step={0.1}
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
          <Button 
            onClick={() => setCriteriaDialogOpen(false)}
            sx={{ color: '#94a3b8' }}
          >
            Cancel
          </Button>
          <Button 
            onClick={async () => {
              // Persist criteria settings
              onSettingsChange(id, { criteria: localCriteria });
              // Close dialog
              setCriteriaDialogOpen(false);
              // Run screener with new criteria
              await runScreener();
            }}
            variant="contained"
            disabled={isLoading}
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
              color: '#ffffff',
              fontWeight: 600,
              '&.Mui-disabled': {
                background: 'rgba(59, 130, 246, 0.3)',
                color: 'rgba(255, 255, 255, 0.5)',
              },
            }}
          >
            {isLoading ? 'Running...' : 'Apply & Run'}
          </Button>
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
  if (prevProps.isPinned !== nextProps.isPinned ||
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
