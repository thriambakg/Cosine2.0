import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Container,
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Menu,
  Collapse,
  Chip,
  Pagination,
  Tooltip,
  Slider,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Chat as SidebarChatIcon,
  ViewColumn as ViewColumnIcon,
  Dashboard as AddToContextIcon,
  InfoOutlined as InfoIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { useStockScreener } from '../hooks/useAPI';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { addStockToContext, addMultipleStocksToContext } from '../components/tiles/common';
import { useDialogManagerHelpers } from '../hooks/useDialogManagerHelpers';
import { useAuth } from '@/contexts/AuthContext';
import { getSearchPageBatchSize } from './config/searchPageConfig';

// Custom styled components
const GlassCard = ({ children, sx = {}, ...props }: any) => {
  const safeSx = sx && typeof sx === 'object' ? sx : {};
  
  return (
    <Card
      sx={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '0px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        '&:hover': {
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          transform: 'none',
          zIndex: 'auto',
        },
        ...safeSx
      }}
      {...props}
    >
      <CardContent sx={{ p: 0 }}>
        {children}
      </CardContent>
    </Card>
  );
};

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
  dividendYield?: number;
}

const StockScreenerSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { openItemDetails, openFilePreview } = useDialogManagerHelpers();
  const {} = useGlobalChat();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'stock-screener-search-page-state';

  // Helper function to load state from sessionStorage
  const loadStateFromStorage = () => {
    try {
      const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (savedState) {
        return JSON.parse(savedState);
      }
    } catch (error) {
      console.error('❌ Error loading state from sessionStorage:', error);
    }
    return null;
  };

  // Initialize state from sessionStorage immediately
  const savedState = loadStateFromStorage();
  
  // Criteria state
  const [criteria, setCriteria] = useState<StockScreenerCriteria>(() => {
    const saved = savedState?.criteria;
    return saved || {
      industries: [],
      volatilityRange: [0, 100],
      priceChangeRange: [-50, 50],
      marketCapRange: [0, 10000000000000],
      priceRange: [0, 1000],
      peRatioRange: [0, 100],
      dividendYieldRange: [0, 20],
      timeframe: '1d',
    };
  });
  
  const [allResults, setAllResults] = useState<StockResult[]>(savedState?.allResults || []);
  const [filteredResults, setFilteredResults] = useState<StockResult[]>(savedState?.filteredResults || []);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);

  const handleOpenStockDetails = useCallback((stock: StockResult) => {
    openItemDetails(
      'stock_result',
      { ...stock, timeframe: criteria.timeframe },
      `${stock.symbol} Details`
    );
  }, [criteria.timeframe, openItemDetails]);

  const handleOpenStockPreview = useCallback((stock: StockResult) => {
    if (!user?.id) {
      console.warn('Cannot open stock preview without a user id');
      return;
    }

    const previewItem = {
      id: `stock_${stock.symbol}_${Date.now()}`,
      name: `${stock.symbol} - ${stock.name}`,
      type: 'context_item' as const,
      metadata: {
        type: 'stock_result',
        title: `${stock.symbol} - ${stock.name}`,
        subtitle: `${(criteria.timeframe || '1d').toUpperCase()} • ${stock.industry || 'Unknown industry'}`,
        data: {
          ...stock,
          timeframe: criteria.timeframe,
        },
      },
      parentId: null,
    };

    openFilePreview(previewItem, user.id, 'stock-screener');
  }, [criteria.timeframe, openFilePreview, user?.id]);
  
  // Column visibility state
  const AVAILABLE_COLUMNS = [
    'symbol',
    'name',
    'price',
    'priceChange',
    'marketCap',
    'volatility',
    'industry',
    'peRatio',
    'dividendYield',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['symbol', 'name', 'price', 'priceChange', 'marketCap', 'volatility', 'industry'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    savedState?.visibleColumns || DEFAULT_VISIBLE_COLUMNS
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const columnMenuOpen = Boolean(columnMenuAnchor);
  
  // Filter state for client-side filtering
  const [selectedFilters, setSelectedFilters] = useState<{
    industries: Set<string>;
    marketCapRanges: Set<string>;
    volatilityRanges: Set<string>;
    priceChangeRanges: Set<string>;
  }>({
    industries: new Set(savedState?.filterSettings?.industries || []),
    marketCapRanges: new Set(savedState?.filterSettings?.marketCapRanges || []),
    volatilityRanges: new Set(savedState?.filterSettings?.volatilityRanges || []),
    priceChangeRanges: new Set(savedState?.filterSettings?.priceChangeRanges || []),
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 25);
  // Ref to track if we just set results from API to avoid overwriting with applyFilters
  const justSetResultsRef = useRef(false);
  // const [criteriaDialogOpen, setCriteriaDialogOpen] = useState<boolean>(false);
  const [searchSidebarVisible, setSearchSidebarVisible] = useState<boolean>(savedState?.searchSidebarVisible !== undefined ? savedState.searchSidebarVisible : true);
  const [expandedFilters, setExpandedFilters] = useState<{
    industries: boolean;
    marketCap: boolean;
    volatility: boolean;
    priceChange: boolean;
  }>({
    industries: false,
    marketCap: false,
    volatility: false,
    priceChange: false,
  });

  // GICS Sector options
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

  // Use the stock screener API hook
  const stockScreenerHook = useStockScreener();
  const { execute: executeScreener } = stockScreenerHook;

  // Run stock screener (initial search)
  const runScreener = useCallback(async () => {
    // Prevent duplicate calls
    if (isSearching) {
      console.log('📊 Stock Screener: Search already in progress, skipping duplicate call');
      return;
    }
    
    console.log('📊 Stock Screener: Starting new search with criteria:', criteria);
    setIsSearching(true);
    setSearchError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setAllResults([]);
    setFilteredResults([]);
    setSelectedStocks(new Set());
    // Reset the ref flag
    justSetResultsRef.current = false;
    
    try {
      // Format the request properly for the API
      const { industries, ...criteriaWithoutIndustries } = criteria;
      const backendCriteria = {
        ...criteriaWithoutIndustries,
        sectors: industries,  // Map industries to sectors
      };
      
      const requestPayload = {
        criteria: backendCriteria,
        maxResults: getSearchPageBatchSize('stock_screener')
      };
      
      console.log('📊 Stock Screener: Making API call with payload:', requestPayload);
      // Use the API hook to fetch data with criteria
      const response = await executeScreener(requestPayload);
      console.log('📊 Stock Screener: API response received:', {
        hasResults: !!response?.results,
        resultsCount: response?.results?.length || 0,
        hasMessage: !!response?.message,
        responseKeys: response ? Object.keys(response) : [],
      });
      
      if (response?.results) {
        console.log('📊 Stock Screener: Received results from API:', {
          resultsCount: response.results.length,
          sampleResult: response.results[0],
          fullResponse: response,
        });
        // Set flag to prevent applyFilters from overwriting
        justSetResultsRef.current = true;
        const resultsArray = Array.isArray(response.results) ? response.results : [];
        console.log('📊 Stock Screener: Setting state with results:', {
          resultsArrayLength: resultsArray.length,
          isArray: Array.isArray(resultsArray),
        });
        setAllResults(resultsArray);
        // Immediately set filteredResults to show results (applyFilters will refine if needed)
        setFilteredResults(resultsArray);
        console.log('📊 Stock Screener: Set allResults and filteredResults:', {
          allResultsCount: resultsArray.length,
          filteredResultsCount: resultsArray.length,
        });
        setLastEvaluatedKey(response.last_evaluated_key || null);
        setHasMore(response.has_more || false);
        // Clear error if successful
        setSearchError(null);
      } else if (response?.message) {
        // Show message from backend (e.g., "No stocks match criteria")
        setAllResults([]);
        setFilteredResults([]);
        setHasMore(false);
        setSearchError(null);
      } else {
        // Unknown response format
        setAllResults([]);
        setFilteredResults([]);
        setHasMore(false);
        setSearchError('Unexpected response format');
      }
    } catch (err) {
      setSearchError('Failed to fetch stock data. Please try again.');
      setAllResults([]);
      setFilteredResults([]);
      setHasMore(false);
      console.error('Stock screener error:', err);
    } finally {
      setIsSearching(false);
      // Reset the ref flag after a delay to allow applyFilters to run if needed
      setTimeout(() => {
        justSetResultsRef.current = false;
      }, 200);
    }
  }, [executeScreener, criteria, isSearching]);

  // Load more results (pagination)
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;

    setIsLoadingMore(true);
    setSearchError(null);

    try {
      // Format the request properly for the API
      const { industries, ...criteriaWithoutIndustries } = criteria;
      const backendCriteria = {
        ...criteriaWithoutIndustries,
        sectors: industries,  // Map industries to sectors
      };
      
      const requestPayload = {
        criteria: backendCriteria,
        maxResults: getSearchPageBatchSize('stock_screener'),
        lastEvaluatedKey: lastEvaluatedKey
      };
      
      // Use the API hook to fetch data with criteria
      const response = await executeScreener(requestPayload);
      
      if (response?.results) {
        // Check if filters are active before updating state
        const hasFilters = selectedFilters.industries.size > 0 || 
                           selectedFilters.marketCapRanges.size > 0 || 
                           selectedFilters.volatilityRanges.size > 0 ||
                           selectedFilters.priceChangeRanges.size > 0;
        
        setAllResults(prev => {
          const updatedResults = [...prev, ...response.results];
          // Update filteredResults with new results if no filters are active
          if (!hasFilters) {
            setFilteredResults(updatedResults);
          }
          // If filters are active, applyFilters will be called by useEffect
          return updatedResults;
        });
        setLastEvaluatedKey(response.last_evaluated_key || null);
        setHasMore(response.has_more || false);
      }
    } catch (err) {
      setSearchError('Failed to load more results. Please try again.');
      console.error('Load more error:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [executeScreener, criteria, hasMore, lastEvaluatedKey, isLoadingMore, selectedFilters]);

  // Client-side filtering function
  const applyFilters = useCallback(() => {
    console.log('📊 Stock Screener: applyFilters called', {
      allResultsCount: allResults.length,
      selectedFilters,
      justSetResults: justSetResultsRef.current,
    });
    
    // Don't apply filters if we just set results from API
    if (justSetResultsRef.current) {
      console.log('📊 Stock Screener: Skipping applyFilters - results just set from API');
      return;
    }
    
    // If no filters are selected, show all results
    const hasFilters = selectedFilters.industries.size > 0 || 
                       selectedFilters.marketCapRanges.size > 0 || 
                       selectedFilters.volatilityRanges.size > 0 ||
                       selectedFilters.priceChangeRanges.size > 0;
    
    if (!hasFilters) {
      console.log('📊 Stock Screener: No filters active, setting filteredResults to allResults');
      setFilteredResults([...allResults]);
      setIsFiltered(false);
      return;
    }
    
    console.log('📊 Stock Screener: Filters active, applying filters');
    setIsFiltered(true);
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
    
    console.log('📊 Stock Screener: Filtered results:', {
      beforeFilter: allResults.length,
      afterFilter: filtered.length,
    });
    setFilteredResults(filtered);
  }, [allResults, selectedFilters]);

  // Restore results and apply filters on mount if saved state exists
  useEffect(() => {
    // If we have results from sessionStorage but filteredResults is empty, apply filters
    if (allResults.length > 0 && filteredResults.length === 0) {
      // Results were restored from sessionStorage, apply filters
      applyFilters();
    }
  }, []); // Only run once on mount

  // Apply filters when selectedFilters or allResults change
  // Use a ref to track if we just set results from API to avoid overwriting
  useEffect(() => {
    console.log('📊 Stock Screener: applyFilters useEffect triggered', {
      allResultsLength: allResults.length,
      justSetResults: justSetResultsRef.current,
      isSearching,
    });
    
    // Don't apply filters if we're currently searching or just set results
    if (isSearching || justSetResultsRef.current) {
      console.log('📊 Stock Screener: Skipping applyFilters - search in progress or results just set');
      return;
    }
    
    if (allResults.length > 0) {
      console.log('📊 Stock Screener: applyFilters called by useEffect, allResults.length:', allResults.length);
      applyFilters();
    }
  }, [applyFilters, isSearching]);

  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const industryMap = new Map<string, number>();
    const marketCapCounts = { micro: 0, small: 0, mid: 0, large: 0, mega: 0 };
    const volatilityCounts = { low: 0, medium: 0, high: 0 };
    const priceChangeCounts = { gain: 0, loss: 0, 'big-gain': 0, 'big-loss': 0 };
    
    allResults.forEach(stock => {
      // Industries
      const industry = stock.industry || 'Unknown';
      industryMap.set(industry, (industryMap.get(industry) || 0) + 1);
      
      // Market cap ranges
      const marketCap = stock.marketCap || 0;
      if (marketCap < 300_000_000) marketCapCounts.micro++;
      else if (marketCap < 2_000_000_000) marketCapCounts.small++;
      else if (marketCap < 10_000_000_000) marketCapCounts.mid++;
      else if (marketCap < 200_000_000_000) marketCapCounts.large++;
      else marketCapCounts.mega++;
      
      // Volatility ranges
      const volatility = stock.volatility || 0;
      if (volatility < 20) volatilityCounts.low++;
      else if (volatility < 40) volatilityCounts.medium++;
      else volatilityCounts.high++;
      
      // Price change ranges
      const priceChange = stock.priceChangePercent || 0;
      if (priceChange > 5) priceChangeCounts['big-gain']++;
      else if (priceChange > 0) priceChangeCounts.gain++;
      else if (priceChange < -5) priceChangeCounts['big-loss']++;
      else if (priceChange < 0) priceChangeCounts.loss++;
    });
    
    return {
      industries: Array.from(industryMap.entries())
        .map(([industry, count]) => ({ industry, count }))
        .sort((a, b) => b.count - a.count),
      marketCapRanges: Object.entries(marketCapCounts)
        .map(([range, count]) => ({ range, count }))
        .filter(item => item.count > 0),
      volatilityRanges: Object.entries(volatilityCounts)
        .map(([range, count]) => ({ range, count }))
        .filter(item => item.count > 0),
      priceChangeRanges: Object.entries(priceChangeCounts)
        .map(([range, count]) => ({ range, count }))
        .filter(item => item.count > 0),
    };
  }, [allResults]);

  // Save state to sessionStorage whenever relevant state changes
  // Try to save results like other search pages, but handle quota exceeded gracefully
  useEffect(() => {
    try {
      const stateToSave = {
        criteria,
        allResults,
        filteredResults,
        lastEvaluatedKey,
        hasMore,
        visibleColumns,
        filterSettings: {
          industries: Array.from(selectedFilters.industries),
          marketCapRanges: Array.from(selectedFilters.marketCapRanges),
          volatilityRanges: Array.from(selectedFilters.volatilityRanges),
          priceChangeRanges: Array.from(selectedFilters.priceChangeRanges),
        },
        currentPage,
        pageSize,
        searchSidebarVisible,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error: any) {
      // Handle quota exceeded errors gracefully
      if (error.name === 'QuotaExceededError') {
        console.warn('SessionStorage quota exceeded, saving state without results...');
        try {
          // Save state without results if quota is exceeded
          const stateWithoutResults = {
            criteria,
            lastEvaluatedKey,
            hasMore,
            visibleColumns,
            filterSettings: {
              industries: Array.from(selectedFilters.industries),
              marketCapRanges: Array.from(selectedFilters.marketCapRanges),
              volatilityRanges: Array.from(selectedFilters.volatilityRanges),
              priceChangeRanges: Array.from(selectedFilters.priceChangeRanges),
            },
            currentPage,
            pageSize,
          };
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateWithoutResults));
        } catch (retryError) {
          console.error('Failed to save state to sessionStorage:', retryError);
        }
      } else {
        console.error('Error saving state to sessionStorage:', error);
      }
    }
  }, [criteria, allResults, filteredResults, lastEvaluatedKey, hasMore, visibleColumns, selectedFilters, currentPage, pageSize, searchSidebarVisible]);

  // Pagination
  const totalPages = Math.ceil(filteredResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentResults = filteredResults.slice(startIndex, endIndex);
  
  // Debug logging
  useEffect(() => {
    console.log('📊 Stock Screener: State update:', {
      allResultsCount: allResults.length,
      filteredResultsCount: filteredResults.length,
      currentResultsCount: currentResults.length,
      currentPage,
      pageSize,
      startIndex,
      endIndex,
      totalPages,
    });
  }, [allResults.length, filteredResults.length, currentResults.length, currentPage, pageSize, startIndex, endIndex, totalPages]);

  // Format helpers
  const formatMarketCap = (marketCap: number | null | undefined) => {
    if (marketCap === null || marketCap === undefined || marketCap === 0) return 'N/A';
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T`;
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B`;
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M`;
    return `$${marketCap.toFixed(0)}`;
  };

  const formatPriceChange = (change: number, percent: number) => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
  };

  // Handle stock selection
  const handleStockSelect = (symbol: string) => {
    setSelectedStocks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) {
        newSet.delete(symbol);
      } else {
        newSet.add(symbol);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedStocks.size === currentResults.length && currentResults.length > 0) {
      setSelectedStocks(new Set());
    } else {
      setSelectedStocks(new Set(currentResults.map(stock => stock.symbol)));
    }
  };

  // Context menu handlers
  const handleContextMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (selectedStocks.size === 0) {
      alert('Please select at least one stock to add to context');
      return;
    }
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToContext = () => {
    if (selectedStocks.size === 0) return;
    
    const selectedStockObjects = filteredResults.filter(stock => 
      selectedStocks.has(stock.symbol)
    );
    
    const stocksToAdd = selectedStockObjects.map(stock => {
      return {
        symbol: stock.symbol,
        name: stock.name || stock.symbol,
        timeframe: criteria.timeframe,
        stockData: {
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          price: stock.price ?? 0,
          priceChange: stock.priceChange ?? 0,
          priceChangePercent: stock.priceChangePercent ?? 0,
          marketCap: stock.marketCap ?? 0,
          volatility: stock.volatility ?? 0,
          volume: stock.volume ?? 0,
          industry: stock.industry ?? 'Unknown',
          peRatio: stock.pe ?? 0,
          dividendYield: stock.dividendYield ?? 0,
          timeframe: criteria.timeframe,
        }
      };
    });
    
    if (stocksToAdd.length > 1) {
      addMultipleStocksToContext(stocksToAdd);
    } else if (stocksToAdd.length === 1) {
      const stock = stocksToAdd[0];
      addStockToContext(
        stock.symbol,
        stock.name,
        stock.timeframe,
        stock.stockData
      );
    }
    
    setSelectedStocks(new Set());
    handleContextMenuClose();
  };

  // Column toggle
  const handleColumnToggle = (column: string) => {
    setVisibleColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(c => c !== column);
      } else {
        return [...prev, column];
      }
    });
  };

  // Filter handlers
  const handleFilterToggle = (filterType: 'industries' | 'marketCapRanges' | 'volatilityRanges' | 'priceChangeRanges', value: string) => {
    setSelectedFilters(prev => {
      const newFilters = { ...prev };
      const filterSet = new Set(newFilters[filterType]);
      if (filterSet.has(value)) {
        filterSet.delete(value);
      } else {
        filterSet.add(value);
      }
      newFilters[filterType] = filterSet;
      return newFilters;
    });
  };

  const handleClearFilters = () => {
    setSelectedFilters({
      industries: new Set(),
      marketCapRanges: new Set(),
      volatilityRanges: new Set(),
      priceChangeRanges: new Set(),
    });
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 4, fontWeight: 600 }}>
          Stock Screener
        </Typography>

        {/* Main Layout: Search Filters (Left) | Results (Middle) | Client-side Filter Box (Right) */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Search Filters (Collapsible) */}
          {searchSidebarVisible ? (
            <GlassCard data-tutorial="criteria-panel" sx={{ 
              minWidth: 320, 
              maxWidth: 380,
              width: 320,
              height: 'fit-content',
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
              transition: 'all 0.3s ease-in-out',
            }}>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    Search Criteria
                  </Typography>
                  <IconButton
                    onClick={() => setSearchSidebarVisible(false)}
                    sx={{ color: '#94a3b8' }}
                    size="small"
                    title="Hide search filters"
                  >
                    <KeyboardArrowDownIcon sx={{ transform: 'rotate(-90deg)' }} />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Industries */}
                  <FormControl fullWidth data-tutorial="industries">
                    <InputLabel sx={{ color: '#94a3b8' }}>Industries (Sectors)</InputLabel>
                    <Select
                      multiple
                      value={criteria.industries}
                      onChange={(e) => setCriteria({ ...criteria, industries: e.target.value as string[] })}
                      label="Industries (Sectors)"
                      sx={{ color: '#f1f5f9' }}
                      renderValue={(selected) => (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(selected as string[]).map((value) => (
                            <Chip key={value} label={value} size="small" sx={{ background: '#3b82f6', color: '#ffffff' }} />
                          ))}
                        </Box>
                      )}
                    >
                      {sectorOptions.map((sector) => (
                        <MenuItem key={sector} value={sector} sx={{ color: '#f1f5f9' }}>
                          <Checkbox checked={criteria.industries.includes(sector)} sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }} />
                          {sector}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Volatility Range */}
                  <Box data-tutorial="range-sliders">
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>Volatility: {criteria.volatilityRange[0]}% - {criteria.volatilityRange[1]}%</Typography>
                    <Slider
                      value={criteria.volatilityRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, volatilityRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={0}
                      max={100}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* Price Change Range */}
                  <Box>
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>Price Change: {criteria.priceChangeRange[0]}% - {criteria.priceChangeRange[1]}%</Typography>
                    <Slider
                      value={criteria.priceChangeRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, priceChangeRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={-50}
                      max={50}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* Market Cap Range */}
                  <Box>
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>
                      Market Cap: {formatMarketCap(criteria.marketCapRange[0])} - {formatMarketCap(criteria.marketCapRange[1])}
                    </Typography>
                    <Slider
                      value={criteria.marketCapRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, marketCapRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={0}
                      max={10000000000000}
                      step={1000000000}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* Price Range */}
                  <Box>
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>Price: ${criteria.priceRange[0]} - ${criteria.priceRange[1]}</Typography>
                    <Slider
                      value={criteria.priceRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, priceRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={0}
                      max={1000}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* P/E Ratio Range */}
                  <Box>
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>P/E Ratio: {criteria.peRatioRange[0]} - {criteria.peRatioRange[1]}</Typography>
                    <Slider
                      value={criteria.peRatioRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, peRatioRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={0}
                      max={100}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* Dividend Yield Range */}
                  <Box>
                    <Typography sx={{ color: '#f1f5f9', mb: 1 }}>Dividend Yield: {criteria.dividendYieldRange[0]}% - {criteria.dividendYieldRange[1]}%</Typography>
                    <Slider
                      value={criteria.dividendYieldRange}
                      onChange={(_, newValue) => setCriteria({ ...criteria, dividendYieldRange: newValue as [number, number] })}
                      valueLabelDisplay="auto"
                      min={0}
                      max={20}
                      step={0.1}
                      sx={{ color: '#3b82f6' }}
                    />
                  </Box>

                  {/* Timeframe */}
                  <FormControl fullWidth data-tutorial="timeframe">
                    <InputLabel sx={{ color: '#94a3b8' }}>Timeframe</InputLabel>
                    <Select
                      value={criteria.timeframe}
                      onChange={(e) => setCriteria({ ...criteria, timeframe: e.target.value })}
                      label="Timeframe"
                      sx={{ color: '#f1f5f9' }}
                    >
                      <MenuItem value="1d">1 Day</MenuItem>
                      <MenuItem value="7d">7 Days</MenuItem>
                      <MenuItem value="30d">30 Days</MenuItem>
                      <MenuItem value="1y">1 Year</MenuItem>
                    </Select>
                  </FormControl>

                  {/* Search and Clear Buttons */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                    <Button
                      data-tutorial="search-button"
                      variant="contained"
                      onClick={runScreener}
                      disabled={isSearching}
                      fullWidth
                      sx={{
                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                        color: '#ffffff',
                        '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                        '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
                      }}
                    >
                      {isSearching ? 'Searching...' : 'Search'}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setCriteria({
                          industries: [],
                          volatilityRange: [0, 100],
                          priceChangeRange: [-50, 50],
                          marketCapRange: [0, 10000000000000],
                          priceRange: [0, 1000],
                          peRatioRange: [0, 100],
                          dividendYieldRange: [0, 20],
                          timeframe: '1d',
                        });
                      }}
                      fullWidth
                      sx={{
                        borderColor: '#475569',
                        color: '#94a3b8',
                        '&:hover': { borderColor: '#64748b', backgroundColor: 'rgba(71, 85, 105, 0.1)' },
                      }}
                    >
                      Clear
                    </Button>
                  </Box>
                </Box>
              </Box>
            </GlassCard>
          ) : (
            <Box sx={{ 
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
              height: 'fit-content',
            }}>
              <IconButton
                onClick={() => setSearchSidebarVisible(true)}
                sx={{
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  border: '2px solid #374151',
                  borderRadius: '50%',
                  width: 48,
                  height: 48,
                  color: '#3b82f6',
                  '&:hover': {
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    borderColor: '#3b82f6',
                    transform: 'scale(1.05)',
                  },
                  transition: 'all 0.3s ease-in-out',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}
                title="Show search filters"
              >
                <SearchIcon />
              </IconButton>
            </Box>
          )}

          {/* Middle - Results Table */}
          <Box sx={{ flex: 1, minWidth: 0, transition: 'flex 0.3s ease-in-out' }} data-tutorial="results-section">
            {/* Error Alert */}
            {searchError && (
              <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {searchError}
              </Alert>
            )}

            {/* Results */}
            {allResults.length > 0 ? (
              <GlassCard>
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title="Select columns to display">
                        <IconButton
                          data-tutorial="column-picker"
                          onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                          sx={{ color: '#94a3b8' }}
                          size="small"
                        >
                          <ViewColumnIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      {/* Add to Context Button */}
                      {currentResults.length > 0 && (
                        <Tooltip title={`Add ${selectedStocks.size > 0 ? `${selectedStocks.size} stock(s)` : 'selected stocks'} to context`}>
                          <span>
                            <IconButton
                              data-tutorial="add-to-context"
                              size="small"
                              onClick={handleContextMenuClick}
                              disabled={selectedStocks.size === 0}
                              sx={{ 
                                color: selectedStocks.size > 0 ? '#F59E0B' : '#9ca3af', 
                                '&:hover': { color: '#F59E0B' },
                                '&:disabled': { color: '#4b5563' }
                              }}
                            >
                              <AddToContextIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      {currentResults.length > 0 ? (
                        <Chip
                          label={`${allResults.length} stock${allResults.length !== 1 ? 's' : ''} found`}
                          sx={{
                            backgroundColor: 'rgba(245, 158, 11, 0.2)',
                            color: '#FDE047',
                            border: '1px solid #F59E0B',
                            fontWeight: 600,
                          }}
                        />
                      ) : isFiltered && allResults.length > 0 ? (
                        <Chip
                          label={`0 of ${allResults.length} stocks match filters`}
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : allResults.length === 0 && !isSearching ? (
                        <Chip
                          label="No stocks found"
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : null}
                      {currentResults.length > 0 && (
                        <>
                          <FormControl size="small" sx={{ minWidth: 120, ml: 1 }}>
                            <InputLabel id="results-per-page-label" sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
                            <Select
                              labelId="results-per-page-label"
                              value={pageSize}
                              label="Per Page"
                              onChange={(e) => {
                                const newPageSize = Number(e.target.value);
                                setPageSize(newPageSize);
                                setCurrentPage(1);
                              }}
                              sx={{
                                color: '#ffffff',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                                '& .MuiSelect-icon': { color: '#9ca3af' },
                              }}
                              MenuProps={{
                                PaperProps: {
                                  sx: {
                                    bgcolor: '#1f2937',
                                    border: '1px solid #374151',
                                    '& .MuiMenuItem-root': {
                                      color: '#f1f5f9',
                                      '&:hover': {
                                        bgcolor: 'rgba(59, 130, 246, 0.2)',
                                      },
                                      '&.Mui-selected': {
                                        bgcolor: 'rgba(59, 130, 246, 0.3)',
                                      },
                                    },
                                  },
                                },
                              }}
                            >
                              <MenuItem value={10}>10</MenuItem>
                              <MenuItem value={25}>25</MenuItem>
                              <MenuItem value={50}>50</MenuItem>
                              <MenuItem value={100}>100</MenuItem>
                            </Select>
                          </FormControl>
                        </>
                      )}
                    </Box>
                  </Box>

                  {/* Results Table */}
                  {filteredResults.length > 0 ? (
                    <>
                      <TableContainer data-tutorial="results-table" sx={{ 
                        backgroundColor: 'transparent',
                        borderRadius: 0,
                        boxShadow: 'none',
                        border: 'none',
                        overflow: 'auto',
                        width: '100%',
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
                        <Table>
                          <TableHead>
                            <TableRow sx={{ background: 'rgba(30, 41, 59, 0.5)' }}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedStocks.size === currentResults.length && currentResults.length > 0}
                                  indeterminate={selectedStocks.size > 0 && selectedStocks.size < currentResults.length}
                                  onChange={handleSelectAll}
                                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                                />
                              </TableCell>
                              {visibleColumns.includes('symbol') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Symbol</TableCell>
                              )}
                              {visibleColumns.includes('name') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Name</TableCell>
                              )}
                              {visibleColumns.includes('price') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Price</TableCell>
                              )}
                              {visibleColumns.includes('priceChange') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Change</TableCell>
                              )}
                              {visibleColumns.includes('marketCap') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Market Cap</TableCell>
                              )}
                              {visibleColumns.includes('volatility') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Volatility</TableCell>
                              )}
                              {visibleColumns.includes('industry') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Industry</TableCell>
                              )}
                              {visibleColumns.includes('peRatio') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>P/E Ratio</TableCell>
                              )}
                              {visibleColumns.includes('dividendYield') && (
                                <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>Dividend Yield</TableCell>
                              )}
                              <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }} align="right">Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {currentResults.map((stock) => (
                              <TableRow
                                key={stock.symbol}
                                onDoubleClick={() => handleOpenStockDetails(stock)}
                                onClick={(e) => {
                                  // Don't select if clicking on checkbox (checkbox handles its own selection)
                                  if ((e.target as HTMLElement).closest('input[type="checkbox"]') || (e.target as HTMLElement).closest('span.MuiCheckbox-root')) {
                                    return;
                                  }
                                  // Single click = select for context addition
                                  handleStockSelect(stock.symbol);
                                }}
                                sx={{
                                  '&:hover': { background: 'rgba(59, 130, 246, 0.1)' },
                                  cursor: 'pointer',
                                }}
                              >
                                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selectedStocks.has(stock.symbol)}
                                    onChange={() => handleStockSelect(stock.symbol)}
                                    sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                                  />
                                </TableCell>
                                {visibleColumns.includes('symbol') && (
                                  <TableCell sx={{ color: '#f1f5f9', fontWeight: 600 }}>{stock.symbol}</TableCell>
                                )}
                                {visibleColumns.includes('name') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>{stock.name}</TableCell>
                                )}
                                {visibleColumns.includes('price') && (
                                  <TableCell sx={{ color: '#f1f5f9' }}>${stock.price.toFixed(2)}</TableCell>
                                )}
                                {visibleColumns.includes('priceChange') && (
                                  <TableCell 
                                    sx={{ 
                                      color: stock.priceChange >= 0 ? '#10b981' : '#ef4444',
                                      fontWeight: 500 
                                    }}
                                  >
                                    {formatPriceChange(stock.priceChange, stock.priceChangePercent)}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('marketCap') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>{formatMarketCap(stock.marketCap)}</TableCell>
                                )}
                                {visibleColumns.includes('volatility') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>{stock.volatility.toFixed(2)}%</TableCell>
                                )}
                                {visibleColumns.includes('industry') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>{stock.industry || 'Unknown'}</TableCell>
                                )}
                                {visibleColumns.includes('peRatio') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>{stock.pe ? stock.pe.toFixed(2) : 'N/A'}</TableCell>
                                )}
                                {visibleColumns.includes('dividendYield') && (
                                  <TableCell sx={{ color: '#cbd5e1' }}>
                                    {stock.dividendYield ? `${stock.dividendYield.toFixed(2)}%` : 'N/A'}
                                  </TableCell>
                                )}
                                <TableCell align="right" sx={{ color: '#cbd5e1' }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                                    <Tooltip title="View details">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenStockDetails(stock);
                                        }}
                                        sx={{ color: '#94a3af', '&:hover': { color: '#3b82f6' } }}
                                      >
                                        <InfoIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Open preview">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenStockPreview(stock);
                                        }}
                                        sx={{ color: '#94a3af', '&:hover': { color: '#3b82f6' } }}
                                      >
                                        <OpenInNewIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, pt: 2, borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
                          <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                            Showing {startIndex + 1}-{Math.min(endIndex, filteredResults.length)} of {filteredResults.length} results
                          </Typography>
                          <Pagination
                            count={totalPages}
                            page={currentPage}
                            onChange={(_: React.ChangeEvent<unknown>, page: number) => setCurrentPage(page)}
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

                      {/* Load More Button */}
                      {!isFiltered && hasMore && lastEvaluatedKey && allResults.length > 0 && (
                        <Box sx={{ 
                          display: 'flex', 
                          justifyContent: 'center', 
                          mt: 2, 
                          pt: 2, 
                          borderTop: totalPages > 1 ? 'none' : '1px solid rgba(55, 65, 81, 0.3)' 
                        }}>
                          <Button
                            variant="outlined"
                            onClick={handleLoadMore}
                            disabled={isLoadingMore || isSearching}
                            size="small"
                            sx={{
                              color: '#3b82f6',
                              borderColor: '#3b82f6',
                              fontSize: '0.75rem',
                              '&:hover': {
                                borderColor: '#60a5fa',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                              '&:disabled': {
                                borderColor: '#4b5563',
                                color: '#6b7280',
                              },
                            }}
                          >
                            {isLoadingMore ? 'Loading...' : `Load More (${allResults.length} loaded)`}
                          </Button>
                        </Box>
                      )}
                    </>
                  ) : filteredResults.length > 0 && currentResults.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 6 }}>
                      <Typography variant="body2" color="#9ca3af">
                        No results on this page. Try changing the page or adjusting page size.
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 6 }}>
                      <Typography variant="body2" color="#9ca3af">
                        {isFiltered && allResults.length > 0
                          ? 'No stocks match the selected filters. Try adjusting your filters.'
                          : 'No stocks found. Try adjusting your search criteria.'}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </GlassCard>
            ) : (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography variant="body2" color="#9ca3af">
                  {isSearching ? 'Searching...' : 'No results found. Adjust your criteria and try again.'}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Right Sidebar - Client-side Filter Box (Only when results exist) */}
          {allResults.length > 0 && (
            <GlassCard data-tutorial="refine-filters" sx={{ 
              p: 2, 
              minWidth: 280, 
              maxWidth: 320,
              height: 'fit-content',
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
            }}>
              <Typography
                variant="h6"
                sx={{
                  color: '#ffffff',
                  fontWeight: 600,
                  mb: 2,
                  fontSize: '1rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Refine search results by:
              </Typography>
              
              <Typography
                variant="caption"
                sx={{
                  color: '#9ca3af',
                  mb: 2,
                  display: 'block',
                  fontSize: '0.75rem',
                }}
              >
                Click headings to show top filters.
                <br />
                Stock counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.industries.size > 0 ||
                selectedFilters.marketCapRanges.size > 0 ||
                selectedFilters.volatilityRanges.size > 0 ||
                selectedFilters.priceChangeRanges.size > 0) && (
                <Box sx={{ 
                  mb: 2, 
                  p: 2, 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                }}>
                  <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600 }}>
                    Selected Filters:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                    {Array.from(selectedFilters.industries).map((industry, idx) => (
                      <Chip
                        key={`industry-${idx}`}
                        label={industry}
                        onDelete={() => handleFilterToggle('industries', industry)}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.marketCapRanges).map((range, idx) => (
                      <Chip
                        key={`marketcap-${idx}`}
                        label={range}
                        onDelete={() => handleFilterToggle('marketCapRanges', range)}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.volatilityRanges).map((range, idx) => (
                      <Chip
                        key={`volatility-${idx}`}
                        label={range}
                        onDelete={() => handleFilterToggle('volatilityRanges', range)}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.priceChangeRanges).map((range, idx) => (
                      <Chip
                        key={`pricechange-${idx}`}
                        label={range}
                        onDelete={() => handleFilterToggle('priceChangeRanges', range)}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                  </Box>
                  <Button
                    size="small"
                    onClick={handleClearFilters}
                    sx={{
                      color: '#93c5fd',
                      fontSize: '0.75rem',
                      textTransform: 'none',
                      mt: 1,
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    Clear All Filters
                  </Button>
                </Box>
              )}

              {/* Industries Filter */}
              {availableFilters.industries && availableFilters.industries.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, industries: !prev.industries }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Industries
                    </Typography>
                    {expandedFilters.industries ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.industries}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                      {availableFilters.industries.map(({ industry, count }, idx) => {
                        const isSelected = selectedFilters.industries.has(industry);
                        return (
                          <Box
                            key={idx}
                            onClick={() => handleFilterToggle('industries', industry)}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {industry}
                            </Typography>
                            <Chip
                              label={count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Market Cap Ranges Filter */}
              {availableFilters.marketCapRanges && availableFilters.marketCapRanges.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, marketCap: !prev.marketCap }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Market Cap
                    </Typography>
                    {expandedFilters.marketCap ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.marketCap}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                      {availableFilters.marketCapRanges.map(({ range, count }, idx) => {
                        const isSelected = selectedFilters.marketCapRanges.has(range);
                        return (
                          <Box
                            key={idx}
                            onClick={() => handleFilterToggle('marketCapRanges', range)}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {range}
                            </Typography>
                            <Chip
                              label={count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Volatility Ranges Filter */}
              {availableFilters.volatilityRanges && availableFilters.volatilityRanges.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, volatility: !prev.volatility }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Volatility
                    </Typography>
                    {expandedFilters.volatility ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.volatility}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                      {availableFilters.volatilityRanges.map(({ range, count }, idx) => {
                        const isSelected = selectedFilters.volatilityRanges.has(range);
                        return (
                          <Box
                            key={idx}
                            onClick={() => handleFilterToggle('volatilityRanges', range)}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {range}
                            </Typography>
                            <Chip
                              label={count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Price Change Ranges Filter */}
              {availableFilters.priceChangeRanges && availableFilters.priceChangeRanges.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, priceChange: !prev.priceChange }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Price Change
                    </Typography>
                    {expandedFilters.priceChange ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.priceChange}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                      {availableFilters.priceChangeRanges.map(({ range, count }, idx) => {
                        const isSelected = selectedFilters.priceChangeRanges.has(range);
                        return (
                          <Box
                            key={idx}
                            onClick={() => handleFilterToggle('priceChangeRanges', range)}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {range}
                            </Typography>
                            <Chip
                              label={count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}
            </GlassCard>
          )}
        </Box>
      </Container>

      {/* Column Selection Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={columnMenuOpen}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{
          sx: {
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            color: '#f1f5f9',
          },
        }}
      >
        {AVAILABLE_COLUMNS.map((column) => (
          <MenuItem key={column} onClick={() => handleColumnToggle(column)}>
            <Checkbox
              checked={visibleColumns.includes(column)}
              sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
            />
            <Typography sx={{ color: '#f1f5f9', textTransform: 'capitalize' }}>
              {column === 'priceChange' ? 'Price Change' : column === 'peRatio' ? 'P/E Ratio' : column === 'dividendYield' ? 'Dividend Yield' : column === 'marketCap' ? 'Market Cap' : column}
            </Typography>
          </MenuItem>
        ))}
      </Menu>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            color: '#f1f5f9',
          },
        }}
      >
        <MenuItem onClick={handleAddToContext}>
          <SidebarChatIcon sx={{ mr: 1, color: '#3b82f6' }} />
          <Typography sx={{ color: '#f1f5f9' }}>Add to Context</Typography>
        </MenuItem>
      </Menu>

      {/* Stock Details Dialog */}
    </Box>
  );
};

export default StockScreenerSearchPage;