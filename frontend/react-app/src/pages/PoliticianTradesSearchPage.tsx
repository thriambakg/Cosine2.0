import React, { useState, useMemo, useEffect } from 'react';
import {
  TextField,
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
  CircularProgress,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Menu,
  Collapse,
  Chip,
  Tooltip,
  Link,
} from '@mui/material';
import {
  Search as SearchIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Launch as LaunchIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import { politicianTradesSearchAPI, PoliticianTradesSearchParams, PoliticianTrade } from '../services/api';
import { politicianSuggestionsService } from '../services/politicianSuggestions';
import { securitySuggestionsServiceV2 } from '../services/securitySuggestionsV2';
import { useAuth } from '@/contexts/AuthContext';
import { addTradeToContext, addMultipleTradesToContext } from '../components/tiles/common';
import MultiSelectField from '../components/MultiSelectField';
import FileBrowserDialog from '../components/common/FileBrowserDialog';
import ItemDetailsDialog from '../components/common/ItemDetailsDialog';
import { filesystemAPI } from '../services/api';

// Minimum date for date filters (January 1, 2025)
const MIN_DATE = '2025-01-01';

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

// Transaction types
const TRANSACTION_TYPES = [
  'Purchase',
  'Sale',
  'Exchange',
  'Gift',
  'Other',
];

// Parties
const PARTIES = [
  'Republican',
  'Democratic',
  'Independent',
];



// Position options - Database stores "House" and "Senate" directly
const POSITION_OPTIONS = ['House', 'Senate'];

// Standard amount ranges (matches Senate PTR ranges)
const AMOUNT_RANGES = [
  { value: '$0-$1,000', label: '$0 - $1,000' },
  { value: '$1,001-$15,000', label: '$1,001 - $15,000' },
  { value: '$15,001-$50,000', label: '$15,001 - $50,000' },
  { value: '$50,001-$100,000', label: '$50,001 - $100,000' },
  { value: '$100,001-$250,000', label: '$100,001 - $250,000' },
  { value: '$250,001-$500,000', label: '$250,001 - $500,000' },
  { value: '$500,001-$1,000,000', label: '$500,001 - $1,000,000' },
  { value: '$1,000,001-$5,000,000', label: '$1,000,001 - $5,000,000' },
  { value: '$5,000,001-$25,000,000', label: '$5,000,001 - $25,000,000' },
  { value: '$25,000,001-$50,000,000', label: '$25,000,001 - $50,000,000' },
  { value: '$50,000,001+', label: 'Over $50,000,000' },
];

// Filter expand state interface
interface ExpandedFiltersState {
  politician: boolean;
  party: boolean;
  position: boolean;
  security: boolean;
  transactionType: boolean;
  stateDistrict: boolean;
  amountRange: boolean;
}

const PoliticianTradesSearchPage: React.FC = () => {
  const { user } = useAuth();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'politician-trades-search-page-state';

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

  // Initialize state from sessionStorage immediately (using function initializer)
  const savedState = loadStateFromStorage();
  
  // Search state
  const [searchParams, setSearchParams] = useState<PoliticianTradesSearchParams>(
    savedState?.searchParams || {
      dateFrom: MIN_DATE,
      dateTo: new Date().toISOString().split('T')[0],
      // Initialize all search parameter arrays as empty
      politicianName: [],
      party: [],
      position: [],
      security: [],
      transactionType: [],
      stateDistrict: [],
      // amountRange is a single string, not array
    }
  );
  
  // Local state for amount min/max (will be converted to amountRange for API)
  const [amountMin, setAmountMin] = useState<number | ''>(savedState?.amountMin || '');
  const [amountMax, setAmountMax] = useState<number | ''>(savedState?.amountMax || '');
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== undefined ? savedState.advancedSearchExpanded : false);
  const [amountRangeError, setAmountRangeError] = useState<string | null>(null);
  
  // Column visibility state
  const AVAILABLE_COLUMNS = [
    'Politician',
    'Position',
    'Party',
    'Jurisdiction',
    'Security',
    'Transaction',
    'Transaction Date',
    'Filing Date',
    'Amount',
    'Details',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['Politician', 'Position', 'Party', 'Security', 'Transaction', 'Transaction Date', 'Amount', 'Details'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    savedState?.visibleColumns || DEFAULT_VISIBLE_COLUMNS
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const columnMenuOpen = Boolean(columnMenuAnchor);
  
  const [allSearchResults, setAllSearchResults] = useState<PoliticianTrade[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<PoliticianTrade[]>([]);
  const [selectedTradeForDetails, setSelectedTradeForDetails] = useState<PoliticianTrade | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [isSearching, setIsSearching] = useState<boolean>(savedState?.isSearching || false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 50);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<{ transactionDate?: number; tradeId?: string } | null>(
    savedState?.lastEvaluatedKey || null
  );
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== undefined ? savedState.searchFormExpanded : true);
  
  // Data loading state for suggestions
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState<boolean>(false);
  const [isSecurityDataLoaded, setIsSecurityDataLoaded] = useState<boolean>(false);
  
  // Selection state
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  // Filter state
  const [availableFilters, setAvailableFilters] = useState<{
    politician_filters?: Array<{ politician: string; count: number }>;
    party_filters?: Array<{ party: string; count: number }>;
    position_filters?: Array<{ position: string; count: number }>;
    security_filters?: Array<{ security: string; count: number }>;
    transaction_type_filters?: Array<{ transactionType: string; count: number }>;
    state_district_filters?: Array<{ stateDistrict: string; count: number }>;
    amount_range_filters?: Array<{ amount_range: string; count: number }>;
  }>(savedState?.availableFilters || {});
  
  const [expandedFilters, setExpandedFilters] = useState<ExpandedFiltersState>(
    savedState?.expandedFilters || {
      politician: false,
      party: false,
      position: false,
      security: false,
      transactionType: false,
      stateDistrict: false,
      amountRange: false,
    }
  );
  
  const [selectedFilters, setSelectedFilters] = useState<{
    politicians: string[];
    parties: string[];
    positions: string[];
    securities: string[];
    transactionTypes: string[];
    stateDistricts: string[];
    amountRanges: string[];
  }>({
    politicians: savedState?.selectedFilters?.politicians || [],
    parties: savedState?.selectedFilters?.parties || [],
    positions: savedState?.selectedFilters?.positions || [],
    securities: savedState?.selectedFilters?.securities || [],
    transactionTypes: savedState?.selectedFilters?.transactionTypes || [],
    stateDistricts: savedState?.selectedFilters?.stateDistricts || [],
    amountRanges: savedState?.selectedFilters?.amountRanges || [],
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(savedState?.isFiltered || false);
  
  // Log state restoration
  useEffect(() => {
    if (savedState) {
      console.log('🔄 Restored politician trades search page state from sessionStorage:', {
        hasSearchParams: !!savedState.searchParams,
        allResultsCount: savedState.allSearchResults?.length || 0,
        totalFound: savedState.totalFound || 0,
        currentPage: savedState.currentPage || 1,
        hasFilters: !!savedState.selectedFilters,
      });
    } else {
      console.log('🆕 Starting fresh politician trades search page session');
    }
  }, []); // Only log once on mount

  // Load politician data on component mount
  useEffect(() => {
    const loadPoliticianData = async () => {
      try {
        console.log('🏛️ Loading politician suggestions data...');
        await politicianSuggestionsService.loadPoliticians();
        setIsPoliticianDataLoaded(true);
        console.log('✅ Politician suggestions data loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load politician suggestions:', error);
      }
    };

    loadPoliticianData();
  }, []);

  // Load security data on component mount
  useEffect(() => {
    const loadSecurityData = async () => {
      try {
        console.log('🏦 Loading security suggestions data from StockList...');
        await securitySuggestionsServiceV2.loadSecurities();
        setIsSecurityDataLoaded(true);
        const counts = securitySuggestionsServiceV2.getCountByMarketCap();
        console.log('✅ Security suggestions data loaded successfully:', counts);
      } catch (error) {
        console.error('❌ Failed to load security suggestions:', error);
      }
    };

    loadSecurityData();
  }, []);

  // Save state to sessionStorage whenever relevant state changes
  useEffect(() => {
    try {
      const stateToSave = {
        searchParams,
        allSearchResults,
        totalFound,
        currentPage,
        pageSize,
        isSearching,
        selectedFilters,
        availableFilters,
        expandedFilters,
        isFiltered,
        lastEvaluatedKey,
        hasMore,
        searchFormExpanded,
        advancedSearchExpanded,
        amountMin,
        amountMax,
        visibleColumns,
      };
      
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving politician trades search page state:', error);
    }
  }, [
    searchParams,
    allSearchResults,
    totalFound,
    currentPage,
    pageSize,
    isSearching,
    selectedFilters,
    availableFilters,
    expandedFilters,
    isFiltered,
    lastEvaluatedKey,
    hasMore,
    searchFormExpanded,
    advancedSearchExpanded,
    amountMin,
    amountMax,
  ]);
  
  // Compute filters from search results
  const computeFiltersFromResults = (results: PoliticianTrade[]) => {
    const politicianMap = new Map<string, number>();
    const partyMap = new Map<string, number>();
    const positionMap = new Map<string, number>();
    const securityMap = new Map<string, number>();
    const transactionTypeMap = new Map<string, number>();
    const stateDistrictMap = new Map<string, number>();
    const amountRangeMap = new Map<string, number>();
    
    results.forEach(trade => {
      if (trade.politicianName) {
        politicianMap.set(trade.politicianName, (politicianMap.get(trade.politicianName) || 0) + 1);
      }
      if (trade.party) {
        partyMap.set(trade.party, (partyMap.get(trade.party) || 0) + 1);
      }
      if (trade.position) {
        positionMap.set(trade.position, (positionMap.get(trade.position) || 0) + 1);
      }
      // For security filters, prioritize symbol over name for cleaner filters
      const securityValue = trade.securitySymbol || trade.securityName;
      if (securityValue) {
        securityMap.set(securityValue, (securityMap.get(securityValue) || 0) + 1);
      }
      if (trade.transactionType) {
        transactionTypeMap.set(trade.transactionType, (transactionTypeMap.get(trade.transactionType) || 0) + 1);
      }
      if (trade.stateDistrict) {
        stateDistrictMap.set(trade.stateDistrict, (stateDistrictMap.get(trade.stateDistrict) || 0) + 1);
      }
      
      // Categorize by amount range
      const amountCategory = getAmountRangeCategory(trade);
      amountRangeMap.set(amountCategory, (amountRangeMap.get(amountCategory) || 0) + 1);
    });
    
    return {
      politician_filters: Array.from(politicianMap.entries())
        .map(([politician, count]) => ({ politician, count }))
        .sort((a, b) => b.count - a.count),
      party_filters: Array.from(partyMap.entries())
        .map(([party, count]) => ({ party, count }))
        .sort((a, b) => b.count - a.count),
      position_filters: Array.from(positionMap.entries())
        .map(([position, count]) => ({ position, count }))
        .sort((a, b) => b.count - a.count),
      security_filters: Array.from(securityMap.entries())
        .map(([security, count]) => ({ security, count }))
        .sort((a, b) => b.count - a.count),
      transaction_type_filters: Array.from(transactionTypeMap.entries())
        .map(([transactionType, count]) => ({ transactionType, count }))
        .sort((a, b) => b.count - a.count),
      state_district_filters: Array.from(stateDistrictMap.entries())
        .map(([stateDistrict, count]) => ({ stateDistrict, count }))
        .sort((a, b) => b.count - a.count),
      amount_range_filters: Array.from(amountRangeMap.entries())
        .map(([amount_range, count]) => ({ amount_range, count }))
        .sort((a, b) => b.count - a.count),
    };
  };
  
  
  // Convert amountMin/amountMax to amountRange string for API
  const convertAmountRangeToAPI = (min: number | '', max: number | ''): string | undefined => {
    if (min === '' && max === '') return undefined;
    if (min === '' && max !== '') {
      // If only max is set, find the matching standard range
      const maxVal = typeof max === 'number' ? max : 0;
      for (const range of AMOUNT_RANGES) {
        const rangeStr = range.value;
        if (rangeStr === '$50,000,001+') {
          if (maxVal >= 50000001) return rangeStr;
        } else {
          const match = rangeStr.match(/\$([0-9,]+)-\$([0-9,]+)/);
          if (match) {
            const rangeMax = parseInt(match[2].replace(/,/g, ''));
            if (maxVal <= rangeMax) return rangeStr;
          }
        }
      }
      return `$0-$${max.toLocaleString('en-US')}`;
    }
    if (min !== '' && max === '') {
      // If only min is set, find the matching standard range
      const minVal = typeof min === 'number' ? min : 0;
      for (const range of AMOUNT_RANGES) {
        const rangeStr = range.value;
        if (rangeStr === '$50,000,001+') {
          if (minVal >= 50000001) return rangeStr;
        } else {
          const match = rangeStr.match(/\$([0-9,]+)-\$([0-9,]+)/);
          if (match) {
            const rangeMin = parseInt(match[1].replace(/,/g, ''));
            const rangeMax = parseInt(match[2].replace(/,/g, ''));
            if (minVal >= rangeMin && minVal <= rangeMax) return rangeStr;
          }
        }
      }
      return `$${min.toLocaleString('en-US')}+`;
    }
    if (min !== '' && max !== '') {
      // Try to find a matching standard range first
      const minVal = typeof min === 'number' ? min : 0;
      const maxVal = typeof max === 'number' ? max : 0;
      for (const range of AMOUNT_RANGES) {
        const rangeStr = range.value;
        if (rangeStr === '$50,000,001+') {
          if (minVal >= 50000001) return rangeStr;
        } else {
          const match = rangeStr.match(/\$([0-9,]+)-\$([0-9,]+)/);
          if (match) {
            const rangeMin = parseInt(match[1].replace(/,/g, ''));
            const rangeMax = parseInt(match[2].replace(/,/g, ''));
            if (minVal >= rangeMin && maxVal <= rangeMax) return rangeStr;
          }
        }
      }
      // If no standard range matches, create custom range string
      return `$${min.toLocaleString('en-US')}-$${max.toLocaleString('en-US')}`;
    }
    return undefined;
  };
  
  // Perform search - fetch first batch of results (load more available)
  const handleSearch = async () => {
    // Validate amount range
    if (amountMin !== '' && amountMax !== '' && typeof amountMin === 'number' && typeof amountMax === 'number' && amountMax < amountMin) {
      setAmountRangeError('Max amount cannot be less than min amount');
      return;
    }
    
    setAmountRangeError(null);
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    setAllSearchResults([]);
    setCurrentResults([]);
    setLastEvaluatedKey(null);
    setHasMore(false);
    
    try {
      const fetchPageSize = 100; // Use large page size to minimize API calls
      
      // Convert amountMin/amountMax to amountRange for API
      const amountRange = convertAmountRangeToAPI(amountMin, amountMax);
      
      // Build search parameters using ONLY searchParams (never include filters)
      const searchRequest = {
        ...searchParams,
        amountRange: amountRange,
        page: 1,
        pageSize: fetchPageSize,
      };
      
      console.log('🔍 Search Request:', {
        searchParams,
        note: 'Filters will be applied client-side after receiving results',
        finalRequest: searchRequest
      });
      
      const response = await politicianTradesSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        setAllSearchResults(response.results);
        setTotalFound(response.total_found || response.results.length);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        
        // Compute filters from results
        const computedFilters = computeFiltersFromResults(response.results);
        setAvailableFilters(computedFilters);
        setIsFiltered(false);
      } else {
        setSearchError(response.error || 'Search failed');
        setAllSearchResults([]);
        setTotalFound(0);
        setHasMore(false);
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred during search');
      setAllSearchResults([]);
      setTotalFound(0);
      setHasMore(false);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Load more results using cursor-based pagination
  const handleLoadMore = async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
    try {
      const fetchPageSize = 100; // Use same page size as initial search
      
      // Convert amountMin/amountMax to amountRange for API
      const amountRange = convertAmountRangeToAPI(amountMin, amountMax);
      
      // Build search parameters using ONLY searchParams with cursor
      const searchRequest = {
        ...searchParams,
        amountRange: amountRange,
        page: 1, // Not used when lastEvaluatedKey is provided
        pageSize: fetchPageSize,
        lastEvaluatedKey: lastEvaluatedKey, // Cursor for pagination
      };
      
      console.log('📥 Load More Request:', {
        searchParams,
        lastEvaluatedKey,
        note: 'Loading next batch using cursor'
      });
      
      const response = await politicianTradesSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        // Append new results to existing results
        setAllSearchResults(prev => [...prev, ...response.results!]);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        
        // Update filters with new results
        const allResults = [...allSearchResults, ...response.results];
        const computedFilters = computeFiltersFromResults(allResults);
        setAvailableFilters(computedFilters);
      } else {
        setSearchError(response.error || 'Load more failed');
        setHasMore(false);
      }
    } catch (error: any) {
      console.error('Load more error:', error);
      setSearchError(error.message || 'An error occurred while loading more results');
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  };
  
  // Handle page change - just update the page number (frontend pagination)
  const handlePageChange = (newPage: number) => {
    const maxPages = Math.ceil(filteredResults.length / pageSize);
    if (newPage < 1 || newPage > maxPages) return;
    setCurrentPage(newPage);
  };
  
  // Toggle trade selection
  const toggleTradeSelection = (tradeId: string) => {
    setSelectedTrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };
  
  // Select all trades on current page
  const selectAllTrades = () => {
    const allIds = new Set(currentResults.map(trade => trade.tradeId));
    setSelectedTrades(allIds);
  };
  
  // Deselect all trades
  const deselectAllTrades = () => {
    setSelectedTrades(new Set());
  };
  
  // Handle context menu close
  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToFiles = () => {
    if (selectedTrades.size === 0 || !user) return;
    setFileBrowserOpen(true);
    setContextMenuAnchor(null);
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedTrades.size === 0) return;
    
    try {
      const selectedTradeObjects = currentResults.filter(trade => selectedTrades.has(trade.tradeId));

      // Save each trade to the filesystem with FULL data
      for (const trade of selectedTradeObjects) {
        const title = `${trade.politicianName || 'Politician'} - ${trade.securityName || trade.securitySymbol || 'Trade'}`;
        
        // Use full data mode for filesystem - send complete trade object with all fields
        await filesystemAPI.addContextItem({
          user_id: user.id,
          folder_path: folderPath,
          context_data: trade, // Full trade object with all fields (metadata, formS3Key, etc.)
          title: title,
          item_type: 'politician_trade',
        });
      }
      
      console.log(`✅ Saved ${selectedTradeObjects.length} trade(s) to filesystem`);
      setSelectedTrades(new Set());
    } catch (error) {
      console.error('Error saving trades to filesystem:', error);
    }
  };

  // Handle add to context - mirroring SEC page approach
  const handleAddToContext = () => {
    if (selectedTrades.size === 0) return;
    
    // Get the selected trade objects from currentResults
    const selectedTradeObjects = currentResults.filter(trade => selectedTrades.has(trade.tradeId));
    
    console.log(`🏛️ Adding ${selectedTradeObjects.length} politician trade(s) to context`);
    
    // Comprehensive logging of politician trade data structures
    selectedTradeObjects.forEach((trade, idx) => {
      console.group(`📊 Politician Trade ${idx + 1} - Complete Data Structure`);
      
      // Core trade identifiers
      console.log('🔍 Core Identifiers:', {
        tradeId: trade.tradeId,
        politicianName: trade.politicianName,
        securitySymbol: trade.securitySymbol,
      });
      
      // Transaction details
      console.log('💰 Transaction Details:', {
        transactionType: trade.transactionType,
        transactionDate: trade.transactionDate,
        transactionDateFormatted: trade.transactionDate ? new Date(trade.transactionDate * 1000).toLocaleDateString() : 'N/A',
        amountRange: trade.amountRange,
        amountMin: trade.amountMin,
        amountMax: trade.amountMax,
      });
      
      // Politician information
      console.log('👤 Politician Information:', {
        politicianName: trade.politicianName,
        party: trade.party,
        position: trade.position,
        stateDistrict: trade.stateDistrict,
      });
      
      // Security information
      console.log('📈 Security Information:', {
        securitySymbol: trade.securitySymbol,
        securityName: trade.securityName,
        assetType: trade.assetType,
      });
      
      // Filing information
      console.log('📋 Filing Information:', {
        filingDate: trade.filingDate,
        formType: trade.formType,
        owner: trade.owner,
        formS3Key: trade.formS3Key,
      });
      
      // Complete raw trade object
      console.log('📋 Complete Trade Object:', trade);
      
      // Data structure analysis
      const tradeKeys = Object.keys(trade);
      console.log(`🔢 Total Properties: ${tradeKeys.length}`);
      console.log('🗂️ All Property Keys:', tradeKeys);
      
      // Trade analysis
      const hasDocumentAccess = !!trade.formS3Key;
      const hasFinancialData = !!(trade.amountRange || trade.amountMin || trade.amountMax);
      const hasCompleteInfo = !!(trade.politicianName && trade.securitySymbol && trade.transactionDate);
      
      console.log('📊 Trade Analysis:', {
        hasDocumentAccess,
        hasFinancialData,
        hasCompleteTransactionInfo: hasCompleteInfo,
        tradeValue: trade.amountRange || `${trade.amountMin || 'Unknown'} - ${trade.amountMax || 'Unknown'}`,
        hasAmountData: hasFinancialData,
      });
      
      // Context integration metadata
      const contextMetadata = {
        contextId: `politician_trade_${trade.tradeId}_${Date.now()}`,
        contextType: 'custom',
        contextTitle: `${trade.politicianName || 'Unknown'} - ${trade.securitySymbol || 'Unknown Security'}`,
        contextSubtitle: `${trade.transactionType || 'Trade'} on ${trade.transactionDate ? new Date(trade.transactionDate * 1000).toLocaleDateString() : 'N/A'}`,
        dataIntegrityCheck: {
          hasRequiredFields: !!(trade.politicianName && trade.securitySymbol && trade.transactionDate),
          hasPoliticianInfo: !!(trade.politicianName && trade.party && trade.position),
          hasFinancialData: hasFinancialData,
          hasDocumentAccess: hasDocumentAccess,
        }
      };
      
      console.log('🔗 Context Integration Metadata:', contextMetadata);
      
      console.groupEnd();
    });
    
    // Summary logging for multiple trades
    if (selectedTradeObjects.length > 1) {
      console.group(`📊 Batch Context Addition Summary`);
      
      const summaryStats = {
        totalTrades: selectedTradeObjects.length,
        uniquePoliticians: [...new Set(selectedTradeObjects.map(t => t.politicianName))],
        uniqueSecurities: [...new Set(selectedTradeObjects.map(t => t.securitySymbol))],
        transactionTypes: [...new Set(selectedTradeObjects.map(t => t.transactionType))],
        dateRange: {
          earliest: Math.min(...selectedTradeObjects.map(t => t.transactionDate || 0)),
          latest: Math.max(...selectedTradeObjects.map(t => t.transactionDate || 0)),
        },
        tradesWithDocuments: selectedTradeObjects.filter(t => t.formS3Key).length,
      };
      
      console.log('📈 Batch Statistics:', summaryStats);
      console.log('📋 Date Range:', {
        earliest: summaryStats.dateRange.earliest ? new Date(summaryStats.dateRange.earliest * 1000).toLocaleDateString() : 'N/A',
        latest: summaryStats.dateRange.latest ? new Date(summaryStats.dateRange.latest * 1000).toLocaleDateString() : 'N/A',
      });
      
      console.groupEnd();
    }
    
    // Add to context using the context manager functions
    if (selectedTradeObjects.length > 1) {
      console.log(`🚀 Politician Trades Search: Initiating batch context addition for ${selectedTradeObjects.length} trades`);
      addMultipleTradesToContext(selectedTradeObjects);
      console.log(`✅ Added ${selectedTradeObjects.length} trades to context in batch`);
    } else if (selectedTradeObjects.length === 1) {
      console.log(`🚀 Politician Trades Search: Initiating single trade context addition`);
      addTradeToContext(selectedTradeObjects[0]);
      console.log(`✅ Added trade to context: ${selectedTradeObjects[0].politicianName || 'Unknown'} - ${selectedTradeObjects[0].securitySymbol || 'Unknown'}`);
    }
    
    // Add user feedback for context operations
    {
      // Listen for sidebar success/error events for user feedback
      const handleSidebarSuccess = () => {
        console.log('🎉 Politician Trades Search: Sidebar context addition successful');
        window.removeEventListener('sidebar-context-success', handleSidebarSuccess);
      };
      
      const handleSidebarError = () => {
        console.log('⚠️ Politician Trades Search: Sidebar context failed, but fallback to new chat should work');
        window.removeEventListener('sidebar-context-error', handleSidebarError);
      };
      
      // Temporary listeners for feedback
      window.addEventListener('sidebar-context-success', handleSidebarSuccess);
      window.addEventListener('sidebar-context-error', handleSidebarError);
      
      // Cleanup listeners after 2 seconds
      setTimeout(() => {
        window.removeEventListener('sidebar-context-success', handleSidebarSuccess);
        window.removeEventListener('sidebar-context-error', handleSidebarError);
      }, 2000);
    }
    
    // Clear selection and close menu
    setSelectedTrades(new Set());
    handleContextMenuClose();
  };
  
  // Determine which standard amount range a trade falls into
  const getAmountRangeCategory = (trade: PoliticianTrade): string => {
    const UNPARSED_AMOUNT_VALUE = 999999999999;
    
    // Check if this is an unparsed document
    const isUnparsed = 
      (trade.amountMin && trade.amountMin >= UNPARSED_AMOUNT_VALUE) ||
      (trade.amountMax && trade.amountMax >= UNPARSED_AMOUNT_VALUE) ||
      (Array.isArray(trade.amountRange) && trade.amountRange[0] >= UNPARSED_AMOUNT_VALUE);
    
    if (isUnparsed) {
      return 'See filing document';
    }

    // Get the minimum amount for categorization
    let minAmount = 0;
    
    if (trade.amountRange && Array.isArray(trade.amountRange) && trade.amountRange.length >= 2) {
      minAmount = trade.amountRange[0];
    } else if (trade.amountMin !== undefined) {
      minAmount = trade.amountMin;
    } else if (trade.amountMax !== undefined) {
      // If we only have max, assume it's in the range [0, max]
      minAmount = 0;
    }

    // Find the matching standard range
    for (const range of AMOUNT_RANGES) {
      const rangeStr = range.value;
      
      if (rangeStr === '$50,000,001+') {
        if (minAmount >= 50000001) return rangeStr;
      } else {
        // Parse the range (e.g., "$1,001-$15,000")
        const match = rangeStr.match(/\$([0-9,]+)-\$([0-9,]+)/);
        if (match) {
          const rangeMin = parseInt(match[1].replace(/,/g, ''));
          const rangeMax = parseInt(match[2].replace(/,/g, ''));
          if (minAmount >= rangeMin && minAmount <= rangeMax) {
            return rangeStr;
          }
        }
      }
    }
    
    // Default to first range if no match
    return AMOUNT_RANGES[0].value;
  };

  // Format amount range
  const formatAmountRange = (trade: PoliticianTrade): string => {
    const UNPARSED_AMOUNT_VALUE = 999999999999; // High value indicating unparsed/unreadable document
    
    // Check if this is an unparsed document (high amount values)
    const isUnparsed = 
      (trade.amountMin && trade.amountMin >= UNPARSED_AMOUNT_VALUE) ||
      (trade.amountMax && trade.amountMax >= UNPARSED_AMOUNT_VALUE) ||
      (Array.isArray(trade.amountRange) && trade.amountRange[0] >= UNPARSED_AMOUNT_VALUE);
    
    if (isUnparsed) {
      return 'See filing document';
    }
    
    // Handle amountRange array (from DynamoDB)
    if (trade.amountRange) {
      if (Array.isArray(trade.amountRange) && trade.amountRange.length >= 2) {
        const min = trade.amountRange[0];
        const max = trade.amountRange[1];
        return `$${formatNumber(min)} - $${formatNumber(max)}`;
      } else if (typeof trade.amountRange === 'string') {
        return trade.amountRange;
      }
    }
    // Handle amountMin/amountMax
    if (trade.amountMin !== undefined && trade.amountMax !== undefined) {
      return `$${formatNumber(trade.amountMin)} - $${formatNumber(trade.amountMax)}`;
    }
    if (trade.amountMin !== undefined) {
      return `$${formatNumber(trade.amountMin)}+`;
    }
    if (trade.amountMax !== undefined) {
      return `Up to $${formatNumber(trade.amountMax)}`;
    }
    return 'N/A';
  };
  
  // Format number with commas
  const formatNumber = (num: number | string): string => {
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numValue)) return 'N/A';
    return numValue.toLocaleString('en-US');
  };
  
  // Format transaction date from YYYYMMDD integer
  const formatTransactionDate = (dateNum?: number): string => {
    if (!dateNum) return 'N/A';
    // transactionDate is stored as YYYYMMDD integer (e.g., 20251103)
    const dateStr = dateNum.toString();
    if (dateStr.length === 8) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    return 'N/A';
  };
  
  // Format filing date (already a string in YYYY-MM-DD format)
  const formatFilingDate = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    // filingDate is already in YYYY-MM-DD format
    return dateStr;
  };
  
  // Filter results based on selected filters
  const filteredResults = useMemo(() => {
    if (!isFiltered || 
        (selectedFilters.politicians.length === 0 &&
         selectedFilters.parties.length === 0 &&
         selectedFilters.positions.length === 0 &&
         selectedFilters.securities.length === 0 &&
         selectedFilters.transactionTypes.length === 0 &&
         selectedFilters.stateDistricts.length === 0 &&
         selectedFilters.amountRanges.length === 0)) {
      return allSearchResults;
    }
    
    return allSearchResults.filter(trade => {
      // Filter by politicians (separate from search parameters)
      if (selectedFilters.politicians.length > 0 && 
          !selectedFilters.politicians.includes(trade.politicianName || '')) {
        return false;
      }
      if (selectedFilters.parties.length > 0 && 
          !selectedFilters.parties.includes(trade.party || '')) {
        return false;
      }
      if (selectedFilters.positions.length > 0 && 
          !selectedFilters.positions.includes(trade.position || '')) {
        return false;
      }
      // For security filtering, check both symbol and name
      if (selectedFilters.securities.length > 0) {
        const securityValue = trade.securitySymbol || trade.securityName;
        if (!securityValue || !selectedFilters.securities.includes(securityValue)) {
          return false;
        }
      }
      if (selectedFilters.transactionTypes.length > 0 && 
          !selectedFilters.transactionTypes.includes(trade.transactionType || '')) {
        return false;
      }
      if (selectedFilters.stateDistricts.length > 0 && 
          !selectedFilters.stateDistricts.includes(trade.stateDistrict || '')) {
        return false;
      }
      if (selectedFilters.amountRanges.length > 0) {
        const tradeAmountRange = getAmountRangeCategory(trade);
        if (!selectedFilters.amountRanges.includes(tradeAmountRange)) {
          return false;
        }
      }
      return true;
    });
  }, [allSearchResults, selectedFilters, isFiltered]);
  
  // Paginate filtered results on the frontend
  useEffect(() => {
    if (filteredResults.length > 0) {
      const startIdx = (currentPage - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      const paginatedResults = filteredResults.slice(startIdx, endIdx);
      setCurrentResults(paginatedResults);
      setTotalFound(filteredResults.length);
    } else if (allSearchResults.length === 0) {
      setCurrentResults([]);
      setTotalFound(0);
    } else {
      // Filtered out all results
      setCurrentResults([]);
      setTotalFound(0);
    }
  }, [filteredResults, currentPage, pageSize, allSearchResults]);

  // Auto-search on mount if no results exist
  useEffect(() => {
    // Only auto-search if we have no results and haven't performed a search yet
    if (allSearchResults.length === 0 && !isSearching && !savedState?.allSearchResults) {
      console.log('🔄 Politician Trades Search Page: Auto-running initial search on mount');
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount
  
  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 600 }}>
            Politician Trades Search
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              component="a"
              href="https://efdsearch.senate.gov/search/home/"
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              startIcon={<LaunchIcon />}
                sx={{
                color: '#3b82f6',
                borderColor: '#3b82f6',
                '&:hover': {
                  borderColor: '#2563eb',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
                textTransform: 'none',
                fontSize: '0.875rem',
              }}
            >
              Verify Senate EFD
            </Button>
            <Button
              component="a"
              href="https://disclosures-clerk.house.gov/FinancialDisclosure"
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              startIcon={<LaunchIcon />}
                sx={{
                color: '#3b82f6',
                borderColor: '#3b82f6',
                '&:hover': {
                  borderColor: '#2563eb',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
                textTransform: 'none',
                fontSize: '0.875rem',
              }}
            >
              Verify House Clerk
            </Button>
          </Box>
            </Box>

        {/* Main Layout: Search Filters (Left) | Results (Middle) | Client-side Filter Box (Right) */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Search Filters (Always visible) */}
          <GlassCard sx={{ 
            minWidth: 320, 
            maxWidth: 380,
            height: 'fit-content',
            position: 'sticky',
            top: 20,
            alignSelf: 'flex-start',
          }}>
            <Box sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  Search Filters
            </Typography>
            <IconButton
              onClick={() => setSearchFormExpanded(!searchFormExpanded)}
                  sx={{ color: '#94a3b8' }}
              size="small"
            >
              {searchFormExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </Box>
          <Collapse in={searchFormExpanded}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Transaction Date Range */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Transaction Date From"
                type="date"
                value={searchParams.dateFrom || ''}
                onChange={(e) => {
                  let dateValue = e.target.value || undefined;
                  // Validate: if date is before minimum, default to minimum
                  if (dateValue && dateValue < MIN_DATE) {
                    dateValue = MIN_DATE;
                  }
                  setSearchParams(prev => ({ ...prev, dateFrom: dateValue }));
                }}
                onBlur={(e) => {
                  // Additional validation on blur to ensure date is not before minimum
                  const dateValue = e.target.value;
                  if (dateValue && dateValue < MIN_DATE) {
                    setSearchParams(prev => ({ ...prev, dateFrom: MIN_DATE }));
                  }
                }}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: MIN_DATE,
                  max: new Date().toISOString().split('T')[0],
                  step: 1, // Ensure day-by-day selection
                }}
                variant="outlined"
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
              <TextField
                label="Transaction Date To"
                type="date"
                value={searchParams.dateTo || ''}
                onChange={(e) => {
                  let dateValue = e.target.value || undefined;
                  // Validate: if date is before minimum, default to minimum
                  if (dateValue && dateValue < MIN_DATE) {
                    dateValue = MIN_DATE;
                  }
                  setSearchParams(prev => ({ ...prev, dateTo: dateValue }));
                }}
                onBlur={(e) => {
                  // Additional validation on blur to ensure date is not before minimum
                  const dateValue = e.target.value;
                  if (dateValue && dateValue < MIN_DATE) {
                    setSearchParams(prev => ({ ...prev, dateTo: MIN_DATE }));
                  }
                }}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: MIN_DATE,
                  max: new Date().toISOString().split('T')[0],
                  step: 1, // Ensure day-by-day selection
                }}
                variant="outlined"
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
            </Box>

                  {/* Politicians Search */}
                <MultiSelectField<string>
                    label="Politicians"
                  selectedItems={(() => {
                    const names = Array.isArray(searchParams.politicianName) ? searchParams.politicianName : (searchParams.politicianName ? [searchParams.politicianName] : []);
                    if (!isPoliticianDataLoaded) return names;
                    
                    // Convert actual names to display format
                    return names.map(name => {
                      const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                      return politician ? politician.displayText : name;
                    });
                  })()}
                  onItemsChange={(politicians) => {
                    // Extract actual names from display text
                    const actualNames = politicians.map(politicianDisplay => {
                      const nameMatch = politicianDisplay.match(/^([^(]+)/);
                      return nameMatch ? nameMatch[1].trim() : politicianDisplay;
                    });
                    setSearchParams(prev => ({ ...prev, politicianName: actualNames }));
                  }}
                  suggestions={isPoliticianDataLoaded ? 
                    politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : 
                    []
                  }
                  onSearch={(query) => {
                    if (!isPoliticianDataLoaded) {
                      return [];
                    }
                    // If empty query, return top politicians
                    if (!query || query.length === 0) {
                      return politicianSuggestionsService.getAllPoliticians().slice(0, 20).map(p => p.displayText);
                    }
                    if (query.length < 2) {
                      return [];
                    }
                    return politicianSuggestionsService.getSuggestions(query, 20).map(p => p.displayText);
                  }}
                  renderItem={(politicianDisplay) => politicianDisplay}
                  renderOptionCustom={(politicianDisplay) => {
                    // Extract the name part for display while keeping full display text
                    const nameMatch = politicianDisplay.match(/^([^(]+)/);
                    const name = nameMatch ? nameMatch[1].trim() : politicianDisplay;
                    const details = politicianDisplay.replace(name, '').trim();
                    return (
                      <Box sx={{ width: '100%' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: '#ffffff', fontSize: '0.9rem' }}>
                          {name}
                        </Typography>
                        {details && (
                          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                            {details}
                          </Typography>
                        )}
                      </Box>
                    );
                  }}
                  getItemKey={(politician) => politician}
                  placeholder="Search politicians..."
                  allowCustomInput={false}
                  isLoading={!isPoliticianDataLoaded}
                />

                  {/* Securities Search */}
                <MultiSelectField<string>
                    label="Securities"
                  selectedItems={(() => {
                    const symbols = Array.isArray(searchParams.security) ? searchParams.security : (searchParams.security ? [searchParams.security] : []);
                    if (!isSecurityDataLoaded) return symbols;
                    
                    // Convert actual symbols to display format
                    return symbols.map(symbol => {
                      const security = securitySuggestionsServiceV2.findBySymbol(symbol);
                      return security ? security.displayText : symbol;
                    });
                  })()}
                  onItemsChange={(securities) => {
                    // Extract actual symbols from display text
                    const actualSymbols = securities.map(securityDisplay => {
                      const match = securityDisplay.match(/^([A-Z.]+)\s*-/);
                      return match ? match[1] : securityDisplay;
                    });
                    setSearchParams(prev => ({ ...prev, security: actualSymbols }));
                  }}
                  suggestions={isSecurityDataLoaded ? 
                    securitySuggestionsServiceV2.getAllSecurities().slice(0, 50).map(s => s.displayText) : 
                    []
                  }
                  onSearch={(query) => {
                    if (!isSecurityDataLoaded) {
                      return [];
                    }
                    // If empty query or short query, return top securities
                    if (!query || query.length < 1) {
                      return securitySuggestionsServiceV2.getAllSecurities().slice(0, 20).map(s => s.displayText);
                    }
                    return securitySuggestionsServiceV2.getSuggestions(query, 20).map(s => s.displayText);
                  }}
                  renderItem={(securityDisplay) => securityDisplay}
                  renderOptionCustom={(securityDisplay) => {
                    // Parse the display format: "AAPL - Apple Inc. (High Cap)"
                    const match = securityDisplay.match(/^([A-Z.]+)\s*-\s*(.+?)\s*\((.+?)\)$/);
                    if (match) {
                      const [, symbol, name, marketCap] = match;
                      const capColor = marketCap === 'High Cap' ? '#10b981' : marketCap === 'Mid Cap' ? '#f59e0b' : '#ef4444';
                      return (
                        <Box sx={{ width: '100%', py: 0.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  fontWeight: 700, 
                                  color: '#3b82f6',
                                  fontSize: '0.85rem',
                                  fontFamily: 'monospace',
                                  minWidth: 'fit-content'
                                }}
                              >
                                {symbol}
                              </Typography>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  color: '#ffffff', 
                                  fontSize: '0.85rem',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {name}
                              </Typography>
                            </Box>
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                color: capColor, 
                                fontSize: '0.7rem', 
                                fontWeight: 600,
                                backgroundColor: `${capColor}20`,
                                px: 0.5,
                                py: 0.1,
                                borderRadius: 0.5,
                                minWidth: 'fit-content'
                              }}
                            >
                              {marketCap}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    }
                    return (
                      <Typography variant="body2" sx={{ color: '#ffffff', py: 0.5 }}>
                        {securityDisplay}
                      </Typography>
                    );
                  }}
                  getItemKey={(security) => security}
                  placeholder="Search for stocks by ticker or company name..."
                  allowCustomInput={false}
                />

                  {/* Amount Range - Two Separate Dropdowns */}
                  <Box>
                    <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                      Amount Range
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="amount-min-label" sx={{ color: '#9ca3af' }}>Min Amount</InputLabel>
                        <Select
                          labelId="amount-min-label"
                          value={amountMin === '' ? '' : amountMin}
                          label="Min Amount"
                          onChange={(e) => {
                            const newMin = e.target.value === '' ? '' : Number(e.target.value);
                            setAmountMin(newMin);
                            // Clear error when user changes value
                            if (amountRangeError) {
                              setAmountRangeError(null);
                            }
                            // Validate immediately if both values are set
                            if (newMin !== '' && amountMax !== '' && typeof newMin === 'number' && typeof amountMax === 'number' && amountMax < newMin) {
                              setAmountRangeError('Max amount cannot be less than min amount');
                            } else if (amountRangeError) {
                              setAmountRangeError(null);
                            }
                          }}
                          error={!!amountRangeError}
                          sx={{
                            color: '#ffffff',
                            '& .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#374151' 
                            },
                            '&:hover .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#3b82f6' 
                            },
                            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#3b82f6' 
                            },
                            '& .MuiSelect-icon': { color: '#9ca3af' },
                          }}
                          MenuProps={{
                            PaperProps: {
                              sx: {
                                bgcolor: '#1f2937',
                                border: '1px solid #374151',
                                maxHeight: 300,
                                '& .MuiMenuItem-root': {
                                  color: '#ffffff',
                                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                  '&.Mui-selected': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.3)' },
                                  },
                                },
                                '&::-webkit-scrollbar': {
                                  width: '8px',
                                },
                                '&::-webkit-scrollbar-track': {
                                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                  backgroundColor: '#3b82f6',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb:hover': {
                                  backgroundColor: '#2563eb',
                                },
                              },
                            },
                          }}
                        >
                          {[0, 1000, 15000, 50000, 100000, 250000, 500000, 1000000, 5000000, 25000000, 50000000].map((val) => (
                            <MenuItem key={val} value={val}>
                              ${val.toLocaleString('en-US')}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl fullWidth size="small">
                        <InputLabel id="amount-max-label" sx={{ color: '#9ca3af' }}>Max Amount</InputLabel>
                        <Select
                          labelId="amount-max-label"
                          value={amountMax === '' ? '' : amountMax}
                          label="Max Amount"
                          onChange={(e) => {
                            const newMax = e.target.value === '' ? '' : Number(e.target.value);
                            setAmountMax(newMax);
                            // Clear error when user changes value
                            if (amountRangeError) {
                              setAmountRangeError(null);
                            }
                            // Validate immediately if both values are set
                            if (newMax !== '' && amountMin !== '' && typeof newMax === 'number' && typeof amountMin === 'number' && newMax < amountMin) {
                              setAmountRangeError('Max amount cannot be less than min amount');
                            } else if (amountRangeError) {
                              setAmountRangeError(null);
                            }
                          }}
                          error={!!amountRangeError}
                          sx={{
                            color: '#ffffff',
                            '& .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#374151' 
                            },
                            '&:hover .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#3b82f6' 
                            },
                            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { 
                              borderColor: amountRangeError ? '#ef4444' : '#3b82f6' 
                            },
                            '& .MuiSelect-icon': { color: '#9ca3af' },
                          }}
                          MenuProps={{
                            PaperProps: {
                              sx: {
                                bgcolor: '#1f2937',
                                border: '1px solid #374151',
                                maxHeight: 300,
                                '& .MuiMenuItem-root': {
                                  color: '#ffffff',
                                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                  '&.Mui-selected': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.3)' },
                                  },
                                },
                                '&::-webkit-scrollbar': {
                                  width: '8px',
                                },
                                '&::-webkit-scrollbar-track': {
                                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                  backgroundColor: '#3b82f6',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb:hover': {
                                  backgroundColor: '#2563eb',
                                },
                              },
                            },
                          }}
                        >
                          {[1000, 15000, 50000, 100000, 250000, 500000, 1000000, 5000000, 25000000, 50000000, 100000000].map((val) => (
                            <MenuItem key={val} value={val}>
                              ${val.toLocaleString('en-US')}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                    {amountRangeError && (
                      <Typography variant="body2" sx={{ color: '#ef4444', mt: 1, fontSize: '0.875rem' }}>
                        {amountRangeError}
                      </Typography>
                    )}
                  </Box>
            
                  {/* Advanced Search Parameters */}
                  <Box sx={{ mt: 2 }}>
                    <Box
                      onClick={() => setAdvancedSearchExpanded(!advancedSearchExpanded)}
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
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontSize: '1rem' }}>
                        Advanced Search
                      </Typography>
                      {advancedSearchExpanded ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                    </Box>
                    <Collapse in={advancedSearchExpanded}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                        {/* Filing Date Range */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <TextField
                            label="Filing Date From"
                            type="date"
                            value={searchParams.filingDateFrom || ''}
                            onChange={(e) => {
                              let dateValue = e.target.value || undefined;
                              // Validate: if date is before minimum, default to minimum
                              if (dateValue && dateValue < MIN_DATE) {
                                dateValue = MIN_DATE;
                              }
                              setSearchParams(prev => ({ ...prev, filingDateFrom: dateValue }));
                            }}
                            onBlur={(e) => {
                              // Additional validation on blur to ensure date is not before minimum
                              const dateValue = e.target.value;
                              if (dateValue && dateValue < MIN_DATE) {
                                setSearchParams(prev => ({ ...prev, filingDateFrom: MIN_DATE }));
                              }
                            }}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{
                              min: MIN_DATE,
                              max: new Date().toISOString().split('T')[0],
                              step: 1, // Ensure day-by-day selection
                            }}
                            variant="outlined"
                            sx={{
                              flex: 1,
                              '& .MuiOutlinedInput-root': {
                                '& fieldset': { borderColor: '#374151' },
                                '&:hover fieldset': { borderColor: '#3b82f6' },
                                '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                              },
                              '& .MuiInputLabel-root': { color: '#9ca3af' },
                              '& .MuiInputBase-input': { color: '#ffffff' },
                            }}
                          />
                          <TextField
                            label="Filing Date To"
                            type="date"
                            value={searchParams.filingDateTo || ''}
                            onChange={(e) => {
                              let dateValue = e.target.value || undefined;
                              // Validate: if date is before minimum, default to minimum
                              if (dateValue && dateValue < MIN_DATE) {
                                dateValue = MIN_DATE;
                              }
                              setSearchParams(prev => ({ ...prev, filingDateTo: dateValue }));
                            }}
                            onBlur={(e) => {
                              // Additional validation on blur to ensure date is not before minimum
                              const dateValue = e.target.value;
                              if (dateValue && dateValue < MIN_DATE) {
                                setSearchParams(prev => ({ ...prev, filingDateTo: MIN_DATE }));
                              }
                            }}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{
                              min: MIN_DATE,
                              max: new Date().toISOString().split('T')[0],
                              step: 1, // Ensure day-by-day selection
                            }}
                            variant="outlined"
                            sx={{
                              flex: 1,
                              '& .MuiOutlinedInput-root': {
                                '& fieldset': { borderColor: '#374151' },
                                '&:hover fieldset': { borderColor: '#3b82f6' },
                                '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                              },
                              '& .MuiInputLabel-root': { color: '#9ca3af' },
                              '& .MuiInputBase-input': { color: '#ffffff' },
                            }}
                          />
                        </Box>

                        {/* Positions - Checkbox Multiselect */}
                        <Box>
                          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                            Positions
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {POSITION_OPTIONS.map((position) => {
                              const isSelected = Array.isArray(searchParams.position) 
                                ? searchParams.position.includes(position)
                                : searchParams.position === position;
                              return (
                                <Box
                                  key={position}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    p: 1,
                                    borderRadius: '4px',
                                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                    border: isSelected ? '1px solid #3b82f6' : '1px solid #374151',
                                    cursor: 'pointer',
                                    '&:hover': {
                                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(55, 65, 81, 0.3)',
                                    },
                                  }}
                                  onClick={() => {
                                    setSearchParams(prev => {
                                      const currentPositions = Array.isArray(prev.position) ? prev.position : (prev.position ? [prev.position] : []);
                                      if (isSelected) {
                                        const newPositions = currentPositions.filter(p => p !== position);
                                        return { ...prev, position: newPositions.length > 0 ? newPositions : [] };
                                      } else {
                                        return { ...prev, position: [...currentPositions, position] };
                                      }
                                    });
                                  }}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    sx={{
                                      color: '#9ca3af',
                                      '&.Mui-checked': { color: '#3b82f6' },
                                      p: 0.5,
                                    }}
                                  />
                                  <Typography sx={{ color: '#ffffff', fontSize: '0.875rem', flex: 1 }}>
                                    {position}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>

                        {/* Political Parties */}
                <MultiSelectField<string>
                          label="Political Parties"
                  selectedItems={Array.isArray(searchParams.party) ? searchParams.party : (searchParams.party ? [searchParams.party] : [])}
                  onItemsChange={(parties) => 
                    setSearchParams(prev => ({ ...prev, party: parties }))
                  }
                  suggestions={PARTIES}
                          placeholder="Select parties..."
                  allowCustomInput={false}
                />

                        {/* Transaction Types */}
                <MultiSelectField<string>
                          label="Transaction Types"
                  selectedItems={Array.isArray(searchParams.transactionType) ? searchParams.transactionType : (searchParams.transactionType ? [searchParams.transactionType] : [])}
                  onItemsChange={(types) => 
                    setSearchParams(prev => ({ ...prev, transactionType: types }))
                  }
                  suggestions={TRANSACTION_TYPES}
                          placeholder="Select transaction types..."
                  allowCustomInput={false}
                />
              </Box>
                    </Collapse>
          </Box>



                  {/* Search and Clear Buttons */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                    <Button
                      variant="contained"
                      onClick={handleSearch}
                      disabled={isSearching}
                      startIcon={isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
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
                setSearchParams({
                  dateFrom: '2020-01-01',
                  dateTo: new Date().toISOString().split('T')[0],
                  politicianName: [],
                  party: [],
                  position: [],
                  security: [],
                  transactionType: [],
                  stateDistrict: [],
                });
                        setAmountMin('');
                        setAmountMax('');
                setSelectedFilters({
                  politicians: [],
                  parties: [],
                  positions: [],
                  securities: [],
                  transactionTypes: [],
                  stateDistricts: [],
                  amountRanges: [],
                });
                setAllSearchResults([]);
                setTotalFound(0);
                setSelectedTrades(new Set());
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
          </Collapse>
            </Box>
        </GlassCard>
      
          {/* Middle - Results Table */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Error Alert */}
        {searchError && (
          <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
            {searchError}
          </Alert>
        )}
        
        {/* Results */}
            {allSearchResults.length > 0 ? (
              <GlassCard>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Tooltip title="Select columns to display">
                      <IconButton
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
                      <Tooltip title={`Add ${selectedTrades.size > 0 ? `${selectedTrades.size} trade(s)` : 'selected trades'} to context`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              if (selectedTrades.size === 0) {
                                alert('Please select at least one trade to add to context');
                                return;
                              }
                              setContextMenuAnchor(e.currentTarget);
                            }}
                            disabled={selectedTrades.size === 0}
                            sx={{ 
                              color: selectedTrades.size > 0 ? '#10b981' : '#9ca3af', 
                              '&:hover': { color: '#10b981' },
                              '&:disabled': { color: '#4b5563' }
                            }}
                          >
                            <AddToContextIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {totalFound > 0 ? (
                      <Chip
                        label={`${totalFound} trade${totalFound !== 1 ? 's' : ''} found`}
                        sx={{
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          border: '1px solid #22c55e',
                          fontWeight: 600,
                        }}
                      />
                    ) : isFiltered && allSearchResults.length > 0 ? (
                      <Chip
                        label={`0 of ${allSearchResults.length} trades match filters`}
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : allSearchResults.length === 0 && !isSearching ? (
                      <Chip
                        label="No trades found"
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : null}
                    {/* Results per page selector */}
                    {totalFound > 0 && (
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
                                  color: '#ffffff',
                                  '&:hover': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                  },
                                  '&.Mui-selected': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    '&:hover': {
                                      backgroundColor: 'rgba(59, 130, 246, 0.3)',
                                    },
                                  },
                                },
                                '&::-webkit-scrollbar': {
                                  width: '8px',
                                },
                                '&::-webkit-scrollbar-track': {
                                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                  backgroundColor: '#3b82f6',
                                  borderRadius: '4px',
                                },
                                '&::-webkit-scrollbar-thumb:hover': {
                                  backgroundColor: '#2563eb',
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
                    )}
                  </Box>
                </Box>

                {/* Context Menu */}
                <Menu
                  anchorEl={contextMenuAnchor}
                  open={Boolean(contextMenuAnchor)}
                  onClose={() => setContextMenuAnchor(null)}
                  PaperProps={{
                    sx: {
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid #374151',
                    }
                  }}
                >
                  <MenuItem
                    onClick={handleAddToContext}
                    sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
                  >
                    <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
                    Add to Context
                  </MenuItem>
                  <MenuItem
                    onClick={handleAddToFiles}
                    sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
                  >
                    <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
                    Add to Files
                  </MenuItem>
                </Menu>
                
                <FileBrowserDialog
                  open={fileBrowserOpen}
                  onClose={() => setFileBrowserOpen(false)}
                  onSelect={handleFileBrowserSelect}
                  allowCreateFolder={true}
                  title="Save to Files"
                />

                {/* Column Selection Menu */}
                <Menu
                  anchorEl={columnMenuAnchor}
                  open={columnMenuOpen}
                  onClose={() => setColumnMenuAnchor(null)}
                  PaperProps={{
                    sx: {
                      backgroundColor: 'rgba(15, 23, 42, 0.98)',
                      border: '2px solid #374151',
                      color: '#ffffff',
                    },
                  }}
                >
                  {AVAILABLE_COLUMNS.map((column) => (
                    <MenuItem
                      key={column}
                      onClick={() => {
                        setVisibleColumns((prev) => {
                          if (prev.includes(column)) {
                            const newCols = prev.filter((c) => c !== column);
                            return newCols.length === 0 ? DEFAULT_VISIBLE_COLUMNS : newCols;
                          } else {
                            return [...prev, column];
                          }
                        });
                      }}
                      sx={{
                        color: visibleColumns.includes(column) ? '#3b82f6' : '#94a3b8',
                      }}
                    >
                      <Checkbox
                        checked={visibleColumns.includes(column)}
                        sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                      />
                      {column}
                    </MenuItem>
                  ))}
                </Menu>

                {currentResults.length > 0 ? (
                  <>
                  <TableContainer sx={{ 
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
                    <Table size="small" sx={{ 
                      tableLayout: 'fixed',
                      width: 'max-content',
                      minWidth: '100%',
                      '& .MuiTableCell-root': {
                        borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                        padding: '12px',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                        verticalAlign: 'top',
                      },
                      '& .MuiTableHead-root .MuiTableCell-root': {
                        borderBottom: '2px solid rgba(59, 130, 246, 0.5)',
                        backgroundColor: 'rgba(15, 23, 42, 0.5)',
                        padding: '8px 12px',
                      },
                      '& .MuiTableRow-root:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                      },
                      '& .MuiTableRow-root': {
                        height: 'auto',
                        minHeight: '100px',
                      },
                    }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ 
                            color: '#9ca3af', 
                            fontWeight: 600, 
                            fontSize: '0.875rem',
                            width: 50,
                            minWidth: 50,
                            maxWidth: 50,
                          }}>
                            <Checkbox
                              size="small"
                              indeterminate={selectedTrades.size > 0 && selectedTrades.size < currentResults.length}
                              checked={currentResults.length > 0 && selectedTrades.size === currentResults.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  selectAllTrades();
                                } else {
                                  deselectAllTrades();
                                }
                              }}
                              sx={{ 
                                color: '#9ca3af', 
                                '&.Mui-checked': { color: '#10b981' }, 
                                '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                              }}
                            />
                          </TableCell>
                          {visibleColumns.includes('Politician') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Politician</TableCell>
                          )}
                          {visibleColumns.includes('Position') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Position</TableCell>
                          )}
                          {visibleColumns.includes('Party') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Party</TableCell>
                          )}
                          {visibleColumns.includes('Jurisdiction') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Jurisdiction</TableCell>
                          )}
                          {visibleColumns.includes('Security') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Security</TableCell>
                          )}
                          {visibleColumns.includes('Transaction') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Transaction</TableCell>
                          )}
                          {visibleColumns.includes('Transaction Date') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Transaction Date</TableCell>
                          )}
                          {visibleColumns.includes('Filing Date') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Filing Date</TableCell>
                          )}
                          {visibleColumns.includes('Amount') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Amount</TableCell>
                          )}
                          {visibleColumns.includes('Details') && (
                            <TableCell sx={{ 
                              color: '#9ca3af', 
                              fontWeight: 600, 
                              fontSize: '0.875rem',
                            }}>Details</TableCell>
                          )}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {currentResults.map((trade) => (
                          <TableRow
                            key={trade.tradeId}
                            sx={{
                              backgroundColor: selectedTrades.has(trade.tradeId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                              '&:hover': {
                                backgroundColor: selectedTrades.has(trade.tradeId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                              },
                              cursor: 'pointer',
                            }}
                            onClick={() => toggleTradeSelection(trade.tradeId)}
                          >
                            <TableCell sx={{ 
                              padding: '8px 12px',
                              width: 50,
                              minWidth: 50,
                              maxWidth: 50,
                            }}>
                              <Checkbox
                                size="small"
                                checked={selectedTrades.has(trade.tradeId)}
                                onChange={() => toggleTradeSelection(trade.tradeId)}
                                onClick={(e) => e.stopPropagation()}
                                sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                              />
                            </TableCell>
                            {visibleColumns.includes('Politician') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {trade.websiteUrl ? (
                                  <Tooltip title="Click to visit politician's website" arrow>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Link
                                        href={trade.websiteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={{
                                          color: '#3b82f6',
                                          textDecoration: 'none',
                                          fontWeight: 500,
                                          fontSize: '0.875rem',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 0.5,
                                          '&:hover': {
                                            color: '#60a5fa',
                                            textDecoration: 'underline',
                                          },
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {trade.politicianName || 'N/A'}
                                        <LaunchIcon sx={{ fontSize: '0.75rem' }} />
                                      </Link>
                                    </Box>
                                  </Tooltip>
                                ) : (
                                  <Typography sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                    {trade.politicianName || 'N/A'}
                                  </Typography>
                                )}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Position') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {trade.position || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Party') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {trade.party || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Jurisdiction') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {trade.stateDistrict || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Security') && (
                              <TableCell sx={{ 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                <Box>
                                  <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.875rem' }}>
                                    {trade.securitySymbol || 'N/A'}
                                  </Typography>
                                  {trade.securityName && (
                                    <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                      {trade.securityName}
                                    </Typography>
                                  )}
                                </Box>
                              </TableCell>
                            )}
                            {visibleColumns.includes('Transaction') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {trade.transactionType || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Transaction Date') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {formatTransactionDate(trade.transactionDate)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Filing Date') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {formatFilingDate(trade.filingDate)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Amount') && (
                              <TableCell sx={{ 
                                color: '#ffffff', 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                {formatAmountRange(trade)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('Details') && (
                              <TableCell sx={{ 
                                fontSize: '0.875rem',
                                padding: '12px',
                              }}>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTradeForDetails(trade);
                                    setDetailsDialogOpen(true);
                                  }}
                                  sx={{
                                    color: '#3b82f6',
                                    '&:hover': {
                                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                    },
                                  }}
                                >
                                  <VisibilityIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {/* Pagination */}
                  {filteredResults.length > pageSize && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, pt: 2, borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
                      <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                        Page {currentPage} of {Math.ceil(filteredResults.length / pageSize)}
                        {' '}(Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredResults.length)} of {filteredResults.length} results)
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                          variant="outlined"
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1 || isSearching}
                          startIcon={<ChevronLeftIcon />}
                          size="small"
                          sx={{
                            color: '#9ca3af',
                            borderColor: '#374151',
                            fontSize: '0.75rem',
                            '&:hover': {
                              borderColor: '#3b82f6',
                              color: '#3b82f6',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                            '&:disabled': {
                              borderColor: '#374151',
                              color: '#6b7280',
                            },
                          }}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage >= Math.ceil(filteredResults.length / pageSize) || isSearching}
                          endIcon={<ChevronRightIcon />}
                          size="small"
                          sx={{
                            color: '#9ca3af',
                            borderColor: '#374151',
                            fontSize: '0.75rem',
                            '&:hover': {
                              borderColor: '#3b82f6',
                              color: '#3b82f6',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                            '&:disabled': {
                              borderColor: '#374151',
                              color: '#6b7280',
                            },
                          }}
                        >
                          Next
                        </Button>
                      </Box>
                    </Box>
                  )}

                  {/* Load More Button */}
                  {!isFiltered && hasMore && lastEvaluatedKey && allSearchResults.length > 0 && (
                    <Box sx={{ 
                      display: 'flex', 
                      justifyContent: 'center', 
                      mt: 2, 
                      pt: 2, 
                      borderTop: filteredResults.length > pageSize ? 'none' : '1px solid rgba(55, 65, 81, 0.3)' 
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
                        {isLoadingMore ? 'Loading...' : `Load More (${allSearchResults.length} loaded)`}
                      </Button>
                    </Box>
                  )}
                </>
              ) : (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <Typography variant="body2" color="#9ca3af">
                    {isFiltered && allSearchResults.length > 0
                      ? 'No trades match the selected filters. Try adjusting your filters.'
                      : 'No trades found. Try adjusting your search parameters.'}
                  </Typography>
                </Box>
              )}
              </Box>
              </GlassCard>
            ) : null}
          </Box>

          {/* Right Sidebar - Client-side Filter Box (Only when results exist) */}
        {allSearchResults.length > 0 && (
            <GlassCard sx={{ 
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
                Document counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.politicians.length > 0 ||
                selectedFilters.parties.length > 0 ||
                selectedFilters.positions.length > 0 ||
                selectedFilters.securities.length > 0 ||
                selectedFilters.transactionTypes.length > 0 ||
                selectedFilters.stateDistricts.length > 0 ||
                selectedFilters.amountRanges.length > 0) && (
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
                    {selectedFilters.politicians.map((politician, idx) => (
                      <Chip
                        key={`politician-${idx}`}
                        label={politician}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            politicians: prev.politicians.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.parties.map((party, idx) => (
                      <Chip
                        key={`party-${idx}`}
                        label={party}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            parties: prev.parties.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.positions.map((position, idx) => (
                      <Chip
                        key={`position-${idx}`}
                        label={position}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            positions: prev.positions.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.securities.map((security, idx) => (
                      <Chip
                        key={`security-${idx}`}
                        label={security}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            securities: prev.securities.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.transactionTypes.map((type, idx) => (
                      <Chip
                        key={`transaction-${idx}`}
                        label={type}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            transactionTypes: prev.transactionTypes.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.stateDistricts.map((stateDistrict, idx) => (
                      <Chip
                        key={`state-${idx}`}
                        label={stateDistrict}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            stateDistricts: prev.stateDistricts.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    {selectedFilters.amountRanges.map((range, idx) => (
                      <Chip
                        key={`amount-${idx}`}
                        label={range}
                        onDelete={() => {
                          setSelectedFilters(prev => ({
                            ...prev,
                            amountRanges: prev.amountRanges.filter((_, i) => i !== idx),
                          }));
                          setIsFiltered(true);
                        }}
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
                    onClick={() => {
                      setSelectedFilters({
                        politicians: [],
                        parties: [],
                        positions: [],
                        securities: [],
                        transactionTypes: [],
                        stateDistricts: [],
                        amountRanges: [],
                      });
                      setIsFiltered(false);
                    }}
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

              {/* Politician Filter */}
              {availableFilters.politician_filters && availableFilters.politician_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, politician: !prev.politician }))}
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
                      Politician
                    </Typography>
                    {expandedFilters.politician ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.politician}>
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
                      {availableFilters.politician_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.politicians.includes(filter.politician);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.politicians.includes(filter.politician);
                                if (exists) {
                                  return {
                                    ...prev,
                                    politicians: prev.politicians.filter(p => p !== filter.politician),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    politicians: [...prev.politicians, filter.politician],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.politician}
                            </Typography>
                            <Chip
                              label={filter.count}
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

              {/* Party Filter */}
              {availableFilters.party_filters && availableFilters.party_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, party: !prev.party }))}
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
                      Party
                    </Typography>
                    {expandedFilters.party ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.party}>
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
                      {availableFilters.party_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.parties.includes(filter.party);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.parties.includes(filter.party);
                                if (exists) {
                                  return {
                                    ...prev,
                                    parties: prev.parties.filter(p => p !== filter.party),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    parties: [...prev.parties, filter.party],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.party}
                            </Typography>
                            <Chip
                              label={filter.count}
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

              {/* Position Filter */}
              {availableFilters.position_filters && availableFilters.position_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, position: !prev.position }))}
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
                      Position
                    </Typography>
                    {expandedFilters.position ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.position}>
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
                      {availableFilters.position_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.positions.includes(filter.position);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.positions.includes(filter.position);
                                if (exists) {
                                  return {
                                    ...prev,
                                    positions: prev.positions.filter(p => p !== filter.position),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    positions: [...prev.positions, filter.position],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.position}
                            </Typography>
                            <Chip
                              label={filter.count}
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

              {/* Security Filter */}
              {availableFilters.security_filters && availableFilters.security_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, security: !prev.security }))}
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
                      Security Symbol
                    </Typography>
                    {expandedFilters.security ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.security}>
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
                      {availableFilters.security_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.securities.includes(filter.security);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.securities.includes(filter.security);
                                if (exists) {
                                  return {
                                    ...prev,
                                    securities: prev.securities.filter(s => s !== filter.security),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    securities: [...prev.securities, filter.security],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.security}
                            </Typography>
                            <Chip
                              label={filter.count}
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

              {/* Transaction Type Filter */}
              {availableFilters.transaction_type_filters && availableFilters.transaction_type_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, transactionType: !prev.transactionType }))}
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
                      Transaction Type
                    </Typography>
                    {expandedFilters.transactionType ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.transactionType}>
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
                      {availableFilters.transaction_type_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.transactionTypes.includes(filter.transactionType);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.transactionTypes.includes(filter.transactionType);
                                if (exists) {
                                  return {
                                    ...prev,
                                    transactionTypes: prev.transactionTypes.filter(t => t !== filter.transactionType),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    transactionTypes: [...prev.transactionTypes, filter.transactionType],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.transactionType}
                            </Typography>
                            <Chip
                              label={filter.count}
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

              {/* Jurisdiction Filter */}
              {availableFilters.state_district_filters && availableFilters.state_district_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, stateDistrict: !prev.stateDistrict }))}
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
                      Jurisdiction
                    </Typography>
                    {expandedFilters.stateDistrict ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.stateDistrict}>
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
                      {availableFilters.state_district_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.stateDistricts.includes(filter.stateDistrict);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.stateDistricts.includes(filter.stateDistrict);
                                if (exists) {
                                  return {
                                    ...prev,
                                    stateDistricts: prev.stateDistricts.filter(s => s !== filter.stateDistrict),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    stateDistricts: [...prev.stateDistricts, filter.stateDistrict],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
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
                              {filter.stateDistrict}
                            </Typography>
                            <Chip
                              label={filter.count}
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




              {/* Amount Range Filter */}
              {availableFilters.amount_range_filters && availableFilters.amount_range_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, amountRange: !prev.amountRange }))}
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
                      Amount Range
                    </Typography>
                    {expandedFilters.amountRange ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.amountRange}>
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
                      {availableFilters.amount_range_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.amountRanges.includes(filter.amount_range);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.amountRanges.includes(filter.amount_range);
                                if (exists) {
                                  return {
                                    ...prev,
                                    amountRanges: prev.amountRanges.filter(a => a !== filter.amount_range),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    amountRanges: [...prev.amountRanges, filter.amount_range],
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(55, 65, 81, 0.2)',
                              },
                            }}
                          >
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                color: isSelected ? '#93c5fd' : '#e5e7eb',
                                fontWeight: isSelected ? 600 : 400,
                              }}
                            >
                              {filter.amount_range}
                            </Typography>
                            <Chip 
                              label={filter.count}
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

      {/* Trade Details Dialog */}
      <ItemDetailsDialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
        }}
        itemType="politician_trade"
        data={selectedTradeForDetails}
        title="Trade Details"
        user_id={user?.id}
      />
    </Box>
  );
};

export default PoliticianTradesSearchPage;

