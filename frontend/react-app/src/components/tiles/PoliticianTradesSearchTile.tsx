import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  TextField,
  Button,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Pagination,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Link,
} from '@mui/material';
import {
  Close as CloseIcon,
  AutoAwesome as AutoRefreshIcon,
  Search as SearchIcon,
  AccountBalance as GovernmentIcon,
  Launch as LaunchIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { filesystemAPI } from '../../services/api';
import { politicianTradesSearchAPI, PoliticianTradesSearchParams, PoliticianTrade } from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, addTradeToContext, addMultipleTradesToContext, confirmDialog } from './common';
import { getIconByName, getDefaultIconForTileType } from './common/tileIconHelper';
import MultiSelectField from '../MultiSelectField';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { politicianSuggestionsService } from '../../services/politicianSuggestions';
import { securitySuggestionsServiceV2 } from '../../services/securitySuggestionsV2';

// Minimum date for date filters (January 1, 2025)
const MIN_DATE = '2025-01-01';

interface PoliticianTradesSearchTileProps {
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
  // Politician trades specific props
  searchParams?: PoliticianTradesSearchParams;
  filterSettings?: {
    politicians?: string[];
    parties?: string[];
    positions?: string[];
    securities?: string[];
    transactionTypes?: string[];
  };
  results?: PoliticianTrade[];
  displayOptions?: {
    showPolitician: boolean;
    showParty: boolean;
    showPosition: boolean;
    showStateDistrict: boolean;
    showSecurity: boolean;
    showTransactionType: boolean;
    showAmount: boolean;
    showDate: boolean;
    showResultsTable: boolean;
    maxResults: number;
    compactView: boolean;
  };
  paginationState?: {
    totalResultsLoaded: number;
    lastEvaluatedKeys: any[];
    hasMore: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const PoliticianTradesSearchTile: React.FC<PoliticianTradesSearchTileProps> = ({
  id,
  size,
  dashboardContext,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isResizing = false,
  isSelected = false,
  onSelectionChange,
  searchParams = {
    dateFrom: MIN_DATE,
    dateTo: new Date().toISOString().split('T')[0],
    politicianName: [],
    party: [],
    position: [],
    security: [],
    transactionType: [],
  },
  filterSettings: initialFilterSettings,
  paginationState: _ = {
    totalResultsLoaded: 0,
    lastEvaluatedKeys: [],
    hasMore: false,
  },
  results = [],
  displayOptions = {
    showPolitician: true,
    showParty: true,
    showPosition: true,
    showStateDistrict: true,
    showSecurity: true,
    showTransactionType: true,
    showAmount: true,
    showDate: true,
    showResultsTable: true,
    maxResults: 50,
    compactView: false,
  },
  autoRefresh = false,
  isPinned = false,
  customTitle,
  customColor,
  customIcon,
}) => {
  const { user } = useAuth();
  const { activeSessionId } = useGlobalChat();
  const { openItemDetails } = useDialogManagerHelpers();
  const { isEasyMode } = useEasyMode();
  
  // Helper to get 3 months ago date
  const getThreeMonthsAgo = () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split('T')[0];
  };
  
  // Debug authentication state
  useEffect(() => {
    console.log('🔐 PoliticianTradesSearchTile Auth State:', { 
      userId: user?.id, 
      activeSessionId,
      userExists: !!user 
    });
  }, [user?.id, activeSessionId]);
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  // Filter state for client-side filtering - restore from props if available
  const [allResults, setAllResults] = useState<PoliticianTrade[]>([]);
  const [filteredResults, setFilteredResults] = useState<PoliticianTrade[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<{
    politicians: string[];
    parties: string[];
    positions: string[];
    securities: string[];
    transactionTypes: string[];
  }>({
    politicians: initialFilterSettings?.politicians || [],
    parties: initialFilterSettings?.parties || [],
    positions: initialFilterSettings?.positions || [],
    securities: initialFilterSettings?.securities || [],
    transactionTypes: initialFilterSettings?.transactionTypes || [],
  });

  const [currentSearchParams, setCurrentSearchParams] = useState<PoliticianTradesSearchParams>({
    ...searchParams,
    dateFrom: isEasyMode ? getThreeMonthsAgo() : searchParams.dateFrom,
  });
  
  // Update dateFrom when easy mode changes
  useEffect(() => {
    if (isEasyMode) {
      setCurrentSearchParams(prev => ({
        ...prev,
        dateFrom: getThreeMonthsAgo(),
      }));
    }
  }, [isEasyMode]);
  
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<PoliticianTrade[]>(results);
  const paginationState = _ as any;
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<{ transactionDate?: number; tradeId?: string } | null>(null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>([]);
  const [isRestoringPagination, setIsRestoringPagination] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  // Ensure defaults are set
  const defaultDisplayOptions = {
    showPolitician: true,
    showParty: true,
    showPosition: true,
    showStateDistrict: true,
    showSecurity: true,
    showTransactionType: true,
    showAmount: true,
    showTransactionDate: true,
    showDate: true,
    showFile: true,
    showResultsTable: true,
    maxResults: 50,
    compactView: false,
  };
  
  const [localDisplayOptions, setLocalDisplayOptions] = useState({
    ...defaultDisplayOptions,
    ...displayOptions
  });

  // Column visibility state - using array of strings like parent page
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
  
  const DEFAULT_VISIBLE_COLUMNS = ['Politician', 'Position', 'Party', 'Security', 'Transaction', 'Transaction Date', 'Amount'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    // Convert display options to column array
    const cols: string[] = [];
    if (localDisplayOptions.showPolitician) cols.push('Politician');
    if (localDisplayOptions.showPosition) cols.push('Position');
    if (localDisplayOptions.showParty) cols.push('Party');
    if (localDisplayOptions.showStateDistrict) cols.push('Jurisdiction');
    if (localDisplayOptions.showSecurity) cols.push('Security');
    if (localDisplayOptions.showTransactionType) cols.push('Transaction');
    if (localDisplayOptions.showTransactionDate) cols.push('Transaction Date');
    if (localDisplayOptions.showDate) cols.push('Filing Date');
    if (localDisplayOptions.showAmount) cols.push('Amount');
    // Details column is always available but not tied to displayOptions
    if (cols.length > 0 && !cols.includes('Details')) {
      cols.push('Details');
    }
    return cols.length > 0 ? cols : DEFAULT_VISIBLE_COLUMNS;
  });
  
  // Handle column toggle
  const handleColumnToggle = useCallback((column: string) => {
    setVisibleColumns((prev) => {
      const newColumns = prev.includes(column)
        ? prev.filter((c) => c !== column)
        : [...prev, column];
      
      // Don't update displayOptions for 'Details' column as it's not tied to displayOptions
      if (column === 'Details') {
        return newColumns;
      }
      
      // Update display options (excluding Details)
      const newDisplayOptions = {
        ...localDisplayOptions,
        showPolitician: newColumns.includes('Politician'),
        showPosition: newColumns.includes('Position'),
        showParty: newColumns.includes('Party'),
        showStateDistrict: newColumns.includes('Jurisdiction'),
        showSecurity: newColumns.includes('Security'),
        showTransactionType: newColumns.includes('Transaction'),
        showTransactionDate: newColumns.includes('Transaction Date'),
        showDate: newColumns.includes('Filing Date'),
        showAmount: newColumns.includes('Amount'),
      };
      setLocalDisplayOptions(newDisplayOptions);
      onSettingsChange(id, { displayOptions: newDisplayOptions });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);

  // Column width state for dynamic sizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`politicianTrades_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const [isPageSizeManuallySet, setIsPageSizeManuallySet] = useState(() => {
    return localStorage.getItem(`politicianTrades_pageSize_${id}`) !== null;
  });
  const tileRef = useRef<HTMLDivElement>(null);

  // Suggestion states
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState<boolean>(false);
  const [isSecurityDataLoaded, setIsSecurityDataLoaded] = useState<boolean>(false);

  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Auto refresh functionality
  const autoRefreshRef = useRef<NodeJS.Timeout>();
  
  // Track if initial search has been performed
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState(false);

  // Persistence is handled explicitly when user performs actions (search, apply filters)
  // Not in useEffect to avoid infinite loops

  // Load politician suggestions
  const loadPoliticianSuggestions = useCallback(async () => {
    if (isPoliticianDataLoaded) return;
    
    try {
      await politicianSuggestionsService.loadPoliticians();
      setIsPoliticianDataLoaded(true);
    } catch (error) {
      console.error('Failed to load politician suggestions:', error);
    }
  }, [isPoliticianDataLoaded]);

  // Load security suggestions
  const loadSecuritySuggestions = useCallback(async () => {
    if (isSecurityDataLoaded) return;
    
    try {
      await securitySuggestionsServiceV2.loadSecurities();
      setIsSecurityDataLoaded(true);
    } catch (error) {
      console.error('Failed to load security suggestions:', error);
    }
  }, [isSecurityDataLoaded]);


  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('🏛️ PoliticianTradesSearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    try {
      const searchRequest = {
        ...currentSearchParams,
        page: 1,
        pageSize: displayOptions.maxResults,
      };
      
      const response = await politicianTradesSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('🏛️ PoliticianTradesSearchTile: Retrieved', response.results.length, 'trades');
        
        // Ensure each trade has a tradeId for table rendering
        const processedResults = response.results.map((trade, index) => ({
          ...trade,
          tradeId: trade.tradeId || `trade_${index}_${Date.now()}`,
        }));
        
        // Store all results for filtering
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(processedResults);
        setFilteredResults(processedResults);
        setCurrentResults(processedResults);
        setHasPerformedInitialSearch(true);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Store pagination state (only first page key for initial search)
        const newLastEvaluatedKeys = newLastEvaluatedKey ? [newLastEvaluatedKey] : [];
        setLastEvaluatedKeys(newLastEvaluatedKeys);
        
        // Persist pagination state
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            totalResultsLoaded: processedResults.length,
            lastEvaluatedKeys: newLastEvaluatedKeys,
            hasMore: response.has_more || false,
          },
        });
        
        // Update parent component - persist results in session only (not database)
        // Include pagination state in session state
        onUpdate(id, {
          results: processedResults, // Session persistence - full results for duration of login only
          paginationState: {
            totalResultsLoaded: processedResults.length,
            lastEvaluatedKeys: response.last_evaluated_key ? [response.last_evaluated_key] : [],
            hasMore: response.has_more || false,
          },
          lastUpdated: Date.now(),
        });
      } else {
        console.error('🏛️ PoliticianTradesSearchTile: Search failed:', response.error);
        setError(response.error || 'Search failed');
        setCurrentResults([]);
        setHasMore(false);
        setHasPerformedInitialSearch(true);
        setLastEvaluatedKeys([]);
        // Clear pagination state
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            totalResultsLoaded: 0,
            lastEvaluatedKeys: [],
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('🏛️ PoliticianTradesSearchTile: Search error:', err);
      setError(err.message || 'An error occurred during search');
      setCurrentResults([]);
      setHasPerformedInitialSearch(true);
      setHasMore(false);
      setLastEvaluatedKeys([]);
      // Clear pagination state on error
      onSettingsChange(id, {
        searchParams: currentSearchParams,
        paginationState: {
          totalResultsLoaded: 0,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentSearchParams, displayOptions.maxResults, id, onUpdate, onSettingsChange]);

  // Restore pagination state by reloading results from saved pagination keys
  const restorePaginationState = useCallback(async () => {
    if (!paginationState || !paginationState.lastEvaluatedKeys || paginationState.lastEvaluatedKeys.length === 0) {
      return;
    }

    if (paginationState.totalResultsLoaded <= (currentResults?.length || 0)) {
      // Already have all results, no need to restore
      return;
    }

    console.log('🔄 PoliticianTradesSearchTile: Restoring pagination state', {
      totalResultsLoaded: paginationState.totalResultsLoaded,
      currentResults: currentResults?.length || 0,
      keysToLoad: paginationState.lastEvaluatedKeys.length,
    });

    setIsRestoringPagination(true);
    setIsLoading(true);
    setError(null);

    try {
      let restoredResults = [...(currentResults || [])];
      let keysToLoad = [...paginationState.lastEvaluatedKeys];
      
      // If we don't have the initial page (currentResults is empty), 
      // we need to load it first before loading continuation pages
      if (restoredResults.length === 0 && currentSearchParams) {
        const searchRequest = {
          ...currentSearchParams,
          page: 1,
          pageSize: displayOptions.maxResults,
        };

        const initialResponse = await politicianTradesSearchAPI.search(searchRequest);

        if (initialResponse.success && initialResponse.results) {
          const processedResults = initialResponse.results.map((trade, index) => ({
            ...trade,
            tradeId: trade.tradeId || `trade_${index}_${Date.now()}`,
          }));
          restoredResults = [...processedResults];
        }
      }

      // Load each continuation page sequentially until we reach totalResultsLoaded
      while (restoredResults.length < paginationState.totalResultsLoaded && keysToLoad.length > 0) {
        const nextKey = keysToLoad[0];

        const searchRequest = {
          ...currentSearchParams,
          page: 1,
          pageSize: displayOptions.maxResults,
          lastEvaluatedKey: nextKey,
        };

        const response = await politicianTradesSearchAPI.search(searchRequest);

        if (response.success && response.results && response.results.length > 0) {
          const processedResults = response.results.map((trade, index) => ({
            ...trade,
            tradeId: trade.tradeId || `trade_${index}_${Date.now()}`,
          }));
          restoredResults = [...restoredResults, ...processedResults];
          keysToLoad = keysToLoad.slice(1);
        } else {
          // No more results or error, stop loading
          break;
        }
      }

      // Update state with restored results
      setAllResults(restoredResults);
      setFilteredResults(restoredResults);
      setCurrentResults(restoredResults);
      setLastEvaluatedKeys(paginationState.lastEvaluatedKeys);
      setLastEvaluatedKey(paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] || null);
      setHasMore(paginationState.hasMore);
      setHasPerformedInitialSearch(true);

      // Update tile with restored results - include pagination state
      onUpdate(id, {
        results: restoredResults,
        paginationState: {
          totalResultsLoaded: restoredResults.length,
          lastEvaluatedKeys: paginationState.lastEvaluatedKeys,
          hasMore: paginationState.hasMore,
        },
        lastUpdated: Date.now(),
      });

      console.log('✅ PoliticianTradesSearchTile: Pagination state restored', {
        restoredCount: restoredResults.length,
        targetCount: paginationState.totalResultsLoaded,
      });
    } catch (err) {
      console.error('❌ PoliticianTradesSearchTile: Error restoring pagination state', err);
      setError('Failed to restore previous results. Please refresh.');
    } finally {
      setIsRestoringPagination(false);
      setIsLoading(false);
    }
  }, [paginationState, currentResults, currentSearchParams, displayOptions.maxResults, id, onUpdate]);
  
  // Load more results using cursor-based pagination
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore || !currentSearchParams) return;
    
    setIsLoadingMore(true);
    setError(null);
    
    try {
      const searchRequest = {
        ...currentSearchParams,
        page: 1, // Not used when lastEvaluatedKey is provided
        pageSize: displayOptions.maxResults,
        lastEvaluatedKey: lastEvaluatedKey, // Cursor for pagination
      };
      
      console.log('📥 PoliticianTradesSearchTile: Load More Request:', {
        lastEvaluatedKey,
        note: 'Loading next batch using cursor'
      });
      
      const response = await politicianTradesSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        // Ensure each trade has a tradeId for table rendering
        const processedResults = response.results.map((trade, index) => ({
          ...trade,
          tradeId: trade.tradeId || `trade_${index}_${Date.now()}`,
        }));
        
        // Append new results to existing results
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        
        // Update lastEvaluatedKeys array (add new key if exists, limit to 100 pages)
        let updatedKeys: any[] = [];
        setLastEvaluatedKeys(prev => {
          updatedKeys = newLastEvaluatedKey 
            ? [...prev, newLastEvaluatedKey].slice(-100) // Keep last 100 keys
            : prev;
          
          // Persist pagination state
          onSettingsChange(id, {
            paginationState: {
              totalResultsLoaded: allResults.length + processedResults.length,
              lastEvaluatedKeys: updatedKeys,
              hasMore: response.has_more || false,
            },
          });
          
          return updatedKeys;
        });
        
        setAllResults(prev => {
          const updated = [...prev, ...processedResults];
          // Update parent component - include pagination state
          onUpdate(id, {
            results: updated,
            paginationState: {
              totalResultsLoaded: updated.length,
              lastEvaluatedKeys: updatedKeys,
              hasMore: response.has_more || false,
            },
            lastUpdated: Date.now(),
          });
          return updated;
        });
        setFilteredResults(prev => [...prev, ...processedResults]);
        setCurrentResults(prev => [...prev, ...processedResults]);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(newLastEvaluatedKey);
      } else {
        console.error('🏛️ PoliticianTradesSearchTile: Load more failed:', response.error);
        setError(response.error || 'Load more failed');
        setHasMore(false);
        // Update pagination state to reflect no more results
        onSettingsChange(id, {
          paginationState: {
            totalResultsLoaded: allResults.length,
            lastEvaluatedKeys: lastEvaluatedKeys,
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('🏛️ PoliticianTradesSearchTile: Load more error:', err);
      setError(err.message || 'An error occurred while loading more results');
      setHasMore(false);
      // Preserve current pagination state on error
      onSettingsChange(id, {
        paginationState: {
          totalResultsLoaded: allResults.length,
          lastEvaluatedKeys: lastEvaluatedKeys,
          hasMore: false,
        },
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, displayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange]);

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

  // Update results per page when tile size changes (only if not manually set)
  useEffect(() => {
    if (!isPageSizeManuallySet) {
      const newResultsPerPage = calculateResultsPerPage();
      setResultsPerPage(newResultsPerPage);
    }
  }, [calculateResultsPerPage, size, isPageSizeManuallySet]);

  // Add ResizeObserver to recalculate when tile is resized (only if not manually set)
  useEffect(() => {
    if (!tileRef.current || isPageSizeManuallySet) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!isPageSizeManuallySet) {
        const newResultsPerPage = calculateResultsPerPage();
        setResultsPerPage(newResultsPerPage);
      }
    });

    resizeObserver.observe(tileRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateResultsPerPage, isPageSizeManuallySet]);

  // Auto refresh effect
  useEffect(() => {
    if (autoRefresh && !isDragging && !isResizing) {
      autoRefreshRef.current = setInterval(performSearch, 600000); // 10 minutes like StockScreener
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
        }
      };
    }
  }, [autoRefresh, performSearch, isDragging, isResizing]);

  // Restore pagination state on mount if needed
  useEffect(() => {
    if (paginationState && paginationState.totalResultsLoaded > (currentResults?.length || 0) && !isRestoringPagination && !isLoading) {
      restorePaginationState();
    }
  }, [paginationState, currentResults?.length, isRestoringPagination, isLoading, restorePaginationState]);

  // Load suggestion data on mount
  useEffect(() => {
    loadPoliticianSuggestions();
    loadSecuritySuggestions();
  }, [loadPoliticianSuggestions, loadSecuritySuggestions]);

  // Preview mode: Always run fresh query when opened in preview
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      const hasSearchCriteria = 
        (currentSearchParams.politicianName && currentSearchParams.politicianName.length > 0) ||
        (currentSearchParams.security && currentSearchParams.security.length > 0) ||
        (currentSearchParams.party && currentSearchParams.party.length > 0) ||
        (currentSearchParams.position && currentSearchParams.position.length > 0) ||
        (currentSearchParams.transactionType && currentSearchParams.transactionType.length > 0);
      
      if (hasSearchCriteria) {
        console.log('🔄 PoliticianTradesSearchTile: Preview mode - running fresh query');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading && !isRestoringPagination) {
      // Only auto-search if we have meaningful search params (not just defaults)
      const hasSearchCriteria = 
        (currentSearchParams.politicianName && currentSearchParams.politicianName.length > 0) ||
        (currentSearchParams.security && currentSearchParams.security.length > 0) ||
        (currentSearchParams.party && currentSearchParams.party.length > 0) ||
        (currentSearchParams.position && currentSearchParams.position.length > 0) ||
        (currentSearchParams.transactionType && currentSearchParams.transactionType.length > 0);
      
      if (hasSearchCriteria) {
        console.log('🔄 PoliticianTradesSearchTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch]);

  // Load suggestion data on component mount
  useEffect(() => {
    loadPoliticianSuggestions();
    loadSecuritySuggestions();
  }, [loadPoliticianSuggestions, loadSecuritySuggestions]);


  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Politician Trades Tile from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });

    if (confirmed) {
      onRemove(id);
    }
  };

  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToFiles = () => {
    if (selectedTrades.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedTrades.size === 0) return;
    
    try {
      const selectedTradeObjects = currentResults.filter(trade => 
        selectedTrades.has(trade.tradeId)
      );

      // Save all trades to the filesystem with FULL data using bulk operation
      const items = selectedTradeObjects.map(trade => {
        const title = `${trade.politicianName || 'Politician'} - ${trade.securityName || trade.securitySymbol || 'Trade'}`;
        return {
          context_data: trade, // Full trade object with all fields (metadata, formS3Key, etc.)
          title: title,
          item_type: 'politician_trade' as const,
        };
      });
      
      // Use bulk operation for better performance
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: folderPath,
        items: items,
      });
      
      if (response.success) {
        const result = response.result as any;
        console.log(`✅ Saved ${result?.succeeded || selectedTradeObjects.length} of ${selectedTradeObjects.length} trade(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} trade(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save trades');
      }
      setSelectedTrades(new Set());
    } catch (error) {
      console.error('Error saving trades to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedTradeObjects = currentResults.filter(trade => 
      selectedTrades.has(trade.tradeId)
    );

    if (selectedTradeObjects.length === 0) return;

    // Use the same context manager functions as the parent page
    // For single trade, use the same format as parent page: "Politician Name - Security Symbol"
    // For multiple trades, each gets its own context item with proper formatting
    if (selectedTradeObjects.length === 1) {
      addTradeToContext(selectedTradeObjects[0]);
    } else {
      addMultipleTradesToContext(selectedTradeObjects);
    }

    setSelectedTrades(new Set());
    handleContextMenuClose();
  };

  const handleDisplayOptionsChange = (option: keyof typeof displayOptions) => {
    const newOptions = {
      ...localDisplayOptions,
      [option]: !localDisplayOptions[option],
    };
    setLocalDisplayOptions(newOptions);
    onSettingsChange(id, { displayOptions: newOptions });
  };

  // Sync localDisplayOptions with displayOptions prop when it changes
  useEffect(() => {
    if (displayOptions) {
      setLocalDisplayOptions(prev => ({
        ...prev,
        ...displayOptions
      }));
    }
  }, [displayOptions]);

  // Persist displayOptions when localDisplayOptions changes (maxResults, compactView, showResultsTable, etc.)
  // Use ref to track previous value and only persist when it actually changes (not from prop updates)
  const prevDisplayOptionsRef = useRef(localDisplayOptions);
  useEffect(() => {
    // Only persist if displayOptions actually changed (deep comparison)
    const prev = prevDisplayOptionsRef.current;
    const hasChanged = JSON.stringify(prev) !== JSON.stringify(localDisplayOptions);
    if (hasChanged) {
      prevDisplayOptionsRef.current = localDisplayOptions;
      onSettingsChange(id, { displayOptions: localDisplayOptions });
    }
  }, [localDisplayOptions, id, onSettingsChange]);

  // Persist searchParams when they change
  useEffect(() => {
    onSettingsChange(id, { searchParams: currentSearchParams });
  }, [currentSearchParams, id, onSettingsChange]);

  const handleRefresh = () => {
    performSearch();
  };

  // Client-side filtering function - operates on existing results, never triggers API calls
  const applyFilters = useCallback(() => {
    let filtered = [...allResults];
    
    // Filter by politicians
    if (selectedFilters.politicians.length > 0) {
      filtered = filtered.filter(trade => 
        selectedFilters.politicians.includes(trade.politicianName || '')
      );
    }
    
    // Filter by parties
    if (selectedFilters.parties.length > 0) {
      filtered = filtered.filter(trade => 
        selectedFilters.parties.includes(trade.party || '')
      );
    }
    
    // Filter by positions
    if (selectedFilters.positions.length > 0) {
      filtered = filtered.filter(trade => 
        selectedFilters.positions.includes(trade.position || '')
      );
    }
    
    // Filter by securities (check both symbol and name)
    if (selectedFilters.securities.length > 0) {
      filtered = filtered.filter(trade => {
        const securityValue = trade.securitySymbol || trade.securityName;
        return securityValue && selectedFilters.securities.includes(securityValue);
      });
    }
    
    // Filter by transaction types
    if (selectedFilters.transactionTypes.length > 0) {
      filtered = filtered.filter(trade => 
        selectedFilters.transactionTypes.includes(trade.transactionType || '')
      );
    }
    
    setFilteredResults(filtered);
    setCurrentResults(filtered);
  }, [allResults, selectedFilters]);

  // Apply filters when selectedFilters change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Sync visible columns with display options when display options change
  // Note: This preserves the Details column state since it's not tied to displayOptions
  useEffect(() => {
    setVisibleColumns((prev) => {
      const cols: string[] = [];
      if (localDisplayOptions.showPolitician) cols.push('Politician');
      if (localDisplayOptions.showPosition) cols.push('Position');
      if (localDisplayOptions.showParty) cols.push('Party');
      if (localDisplayOptions.showStateDistrict) cols.push('Jurisdiction');
      if (localDisplayOptions.showSecurity) cols.push('Security');
      if (localDisplayOptions.showTransactionType) cols.push('Transaction');
      if (localDisplayOptions.showTransactionDate) cols.push('Transaction Date');
      if (localDisplayOptions.showDate) cols.push('Filing Date');
      if (localDisplayOptions.showAmount) cols.push('Amount');
      // Preserve Details column state from previous visibleColumns
      if (prev.includes('Details')) {
        cols.push('Details');
      }
      return cols.length > 0 ? cols : DEFAULT_VISIBLE_COLUMNS;
    });
  }, [localDisplayOptions]);

  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const politicianMap = new Map<string, number>();
    const partyMap = new Map<string, number>();
    const positionMap = new Map<string, number>();
    const securityMap = new Map<string, number>();
    const transactionTypeMap = new Map<string, number>();
    
    allResults.forEach(trade => {
      if (trade.politicianName) {
        politicianMap.set(trade.politicianName, (politicianMap.get(trade.politicianName) || 0) + 1);
      }
      if (trade.party) {
        partyMap.set(trade.party, (partyMap.get(trade.party) || 0) + 1);
      }
      if (trade.position) {
        positionMap.set(trade.position, (positionMap.get(trade.position) || 0) + 1);
      }
      const securityValue = trade.securitySymbol || trade.securityName;
      if (securityValue) {
        securityMap.set(securityValue, (securityMap.get(securityValue) || 0) + 1);
      }
      if (trade.transactionType) {
        transactionTypeMap.set(trade.transactionType, (transactionTypeMap.get(trade.transactionType) || 0) + 1);
      }
    });
    
    return {
      politicians: Array.from(politicianMap.entries())
        .map(([politician, count]) => ({ politician, count }))
        .sort((a, b) => b.count - a.count),
      parties: Array.from(partyMap.entries())
        .map(([party, count]) => ({ party, count }))
        .sort((a, b) => b.count - a.count),
      positions: Array.from(positionMap.entries())
        .map(([position, count]) => ({ position, count }))
        .sort((a, b) => b.count - a.count),
      securities: Array.from(securityMap.entries())
        .map(([security, count]) => ({ security, count }))
        .sort((a, b) => b.count - a.count),
      transactionTypes: Array.from(transactionTypeMap.entries())
        .map(([transactionType, count]) => ({ transactionType, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);

  // Handle trade selection with single click, Ctrl+click, and Shift+click
  const handleTradeClick = (e: React.MouseEvent, tradeId: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedTrades(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const tradesToSelect = currentPageResults.slice(start, end + 1);
        tradesToSelect.forEach(trade => newSelected.add(trade.tradeId));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(tradeId)) {
          newSelected.delete(tradeId);
        } else {
          newSelected.add(tradeId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(tradeId)) {
          newSelected.delete(tradeId);
        } else {
          newSelected.clear();
          newSelected.add(tradeId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, tradeId: string) => {
    e.stopPropagation();
    
    // Determine which trades to drag
    const tradesToDrag = selectedTrades.has(tradeId) ? selectedTrades : new Set([tradeId]);
    
    // Set drag data
    const selectedTradeObjects = currentResults.filter(trade => 
      tradesToDrag.has(trade.tradeId)
    );
    
    if (selectedTradeObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'politician_trades',
        trades: selectedTradeObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedTradeObjects.length} trade${selectedTradeObjects.length > 1 ? 's' : ''}`;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.padding = '8px 12px';
      dragImage.style.backgroundColor = '#3b82f6';
      dragImage.style.color = '#ffffff';
      dragImage.style.borderRadius = '4px';
      dragImage.style.fontSize = '14px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  };

  // Handle context menu for selected items
  const handleRowContextMenu = (e: React.MouseEvent, tradeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this trade is not selected, select only it
    if (!selectedTrades.has(tradeId)) {
      setSelectedTrades(new Set([tradeId]));
    }
    
    setContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  const formatCurrency = (amount: number | undefined) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getAmountRangeDisplay = (trade: PoliticianTrade): string => {
    if (trade.amountMin && trade.amountMax) {
      if (trade.amountMin === trade.amountMax) {
        return formatCurrency(trade.amountMin);
      }
      return `${formatCurrency(trade.amountMin)} - ${formatCurrency(trade.amountMax)}`;
    }
    return 'N/A';
  };

  const formatTransactionDate = (transactionDate?: number): string => {
    if (!transactionDate) return 'N/A';
    
    // Convert YYYYMMDD format to readable date
    const dateStr = transactionDate.toString();
    if (dateStr.length !== 8) return 'N/A';
    
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    
    try {
      const date = new Date(`${year}-${month}-${day}`);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return 'N/A';
    }
  };

  // Calculate optimal column widths based on content
  const calculateColumnWidths = useCallback((results: PoliticianTrade[]) => {
    const widths: Record<string, number> = {};
    
    // Sample of results to measure (use first 50 for performance)
    const sampleResults = results.slice(0, 50);
    
    if (sampleResults.length === 0) return widths;
    
    // Base minimum widths (in pixels)
    const minWidths = {
      checkbox: 50,
      politician: 120,
      position: 80,
      party: 90,
      stateDistrict: 100,
      security: 150,
      transactionType: 90,
      amount: 100,
      transactionDate: 120,
      date: 100,
      file: 80,
    };
    
    // Calculate content-based widths
    widths.checkbox = minWidths.checkbox;
    
    if (visibleColumns.includes('Politician')) {
      const maxLength = Math.max(...sampleResults.map(t => (t.politicianName || '').length));
      widths.politician = Math.max(minWidths.politician, Math.min(maxLength * 8 + 32, 200));
    }
    
    if (visibleColumns.includes('Position')) {
      widths.position = minWidths.position; // Fixed size for chips
    }
    
    if (visibleColumns.includes('Party')) {
      widths.party = minWidths.party; // Fixed size for chips
    }
    
    if (visibleColumns.includes('Jurisdiction')) {
      const maxLength = Math.max(...sampleResults.map(t => (t.stateDistrict || '').length));
      widths.stateDistrict = Math.max(minWidths.stateDistrict, Math.min(maxLength * 8 + 32, 120));
    }
    
    if (visibleColumns.includes('Security')) {
      const maxSymbolLength = Math.max(...sampleResults.map(t => (t.securitySymbol || '').length));
      const maxNameLength = Math.max(...sampleResults.map(t => (t.securityName || '').length));
      const estimatedWidth = Math.max(maxSymbolLength * 9, maxNameLength * 6) + 32;
      widths.security = Math.max(minWidths.security, Math.min(estimatedWidth, 250));
    }
    
    if (visibleColumns.includes('Transaction')) {
      const maxLength = Math.max(...sampleResults.map(t => (t.transactionType || '').length));
      widths.transactionType = Math.max(minWidths.transactionType, Math.min(maxLength * 7 + 32, 120));
    }
    
    if (visibleColumns.includes('Amount')) {
      // Amount column is typically formatted currency, estimate based on max values
      widths.amount = minWidths.amount;
    }
    
    if (visibleColumns.includes('Transaction Date')) {
      widths.transactionDate = minWidths.transactionDate; // Fixed for date format
    }
    
    if (visibleColumns.includes('Filing Date')) {
      widths.date = minWidths.date; // Fixed for date format
    }
    
    return widths;
  }, [visibleColumns]);

  // Calculate pagination values
  const totalPages = Math.ceil(currentResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = currentResults.slice(startIndex, endIndex);

  // Update column widths when results or visible columns change
  useEffect(() => {
    if (currentResults.length > 0) {
      const newWidths = calculateColumnWidths(currentResults);
      setColumnWidths(newWidths);
    }
  }, [currentResults, calculateColumnWidths]);

  const renderSearchDialog = () => (
    <Dialog
      open={searchDialogOpen}
      onClose={() => setSearchDialogOpen(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          color: '#ffffff',
          border: '1px solid #334155',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
        <Box display="flex" alignItems="center" gap={1}>
          <GovernmentIcon />
          <Typography variant="h6">Search Politician Trades</Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Box display="flex" flexDirection="column" gap={3} mt={2}>
          {/* Politicians Search Field */}
          <MultiSelectField<string>
            label="Politicians (Search Parameter)"
            selectedItems={(() => {
              const names = Array.isArray(currentSearchParams.politicianName) ? currentSearchParams.politicianName : (currentSearchParams.politicianName ? [currentSearchParams.politicianName] : []);
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
              setCurrentSearchParams(prev => ({ ...prev, politicianName: actualNames }));
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
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
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
            placeholder="Search for politicians..."
            helperText="Search by politician name (e.g., Nancy Pelosi, Mitch McConnell)"
          />

          {/* Securities Search Field */}
          <MultiSelectField<string>
            label="Securities (Search Parameter)"
            selectedItems={(() => {
              const securities = Array.isArray(currentSearchParams.security) ? currentSearchParams.security : (currentSearchParams.security ? [currentSearchParams.security] : []);
              if (!isSecurityDataLoaded) return securities;
              
              // Convert symbols to display format
              return securities.map((symbol: string) => {
                const security = securitySuggestionsServiceV2.findBySymbol(symbol);
                return security ? security.displayText : symbol;
              });
            })()}
            onItemsChange={(securities) => {
              // Extract symbols from display text
              const symbols = securities.map(securityDisplay => {
                const symbolMatch = securityDisplay.match(/^([A-Z]+)/);
                return symbolMatch ? symbolMatch[1] : securityDisplay;
              });
              setCurrentSearchParams(prev => ({ ...prev, security: symbols }));
            }}
            suggestions={isSecurityDataLoaded ? 
              securitySuggestionsServiceV2.getAllSecurities().slice(0, 100).map(s => s.displayText) : 
              []
            }
            onSearch={(query) => {
              if (!isSecurityDataLoaded) {
                return [];
              }
              if (!query || query.length === 0) {
                return securitySuggestionsServiceV2.getAllSecurities().slice(0, 20).map(s => s.displayText);
              }
              if (query.length < 1) {
                return [];
              }
              return securitySuggestionsServiceV2.getSuggestions(query, 20).map(s => s.displayText);
            }}
            renderItem={(securityDisplay) => securityDisplay}
            renderOptionCustom={(securityDisplay) => {
              // Extract symbol and name for display
              const parts = securityDisplay.split(' - ');
              const symbol = parts[0] || securityDisplay;
              const nameAndCap = parts[1] || '';
              const nameMatch = nameAndCap.match(/^([^(]+)/);
              const name = nameMatch ? nameMatch[1].trim() : nameAndCap;
              const capMatch = nameAndCap.match(/\(([^)]+)\)$/);
              const cap = capMatch ? capMatch[1] : '';
              
              return (
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                      {symbol}
                    </Typography>
                    {cap && (
                      <Chip 
                        label={cap} 
                        size="small" 
                        sx={{ 
                          height: '16px', 
                          fontSize: '0.65rem',
                          backgroundColor: cap.includes('High') ? '#059669' : cap.includes('Mid') ? '#d97706' : '#dc2626',
                          color: 'white'
                        }} 
                      />
                    )}
                  </Box>
                  {name && (
                    <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                      {name}
                    </Typography>
                  )}
                </Box>
              );
            }}
            placeholder="Search for securities..."
            helperText="Search by symbol or company name (e.g., AAPL, Apple, Tesla)"
          />

          {/* Date Range - Hidden in easy mode (auto-set to 3mo ago) */}
          {!isEasyMode && (
          <Box display="flex" gap={2}>
            <TextField
              label="From Date"
              type="date"
              value={currentSearchParams.dateFrom || ''}
              onChange={(e) => {
                let dateValue = e.target.value || undefined;
                // Validate: if date is before minimum, default to minimum
                if (dateValue && dateValue < MIN_DATE) {
                  dateValue = MIN_DATE;
                }
                setCurrentSearchParams(prev => ({ ...prev, dateFrom: dateValue }));
              }}
              onBlur={(e) => {
                // Additional validation on blur to ensure date is not before minimum
                const dateValue = e.target.value;
                if (dateValue && dateValue < MIN_DATE) {
                  setCurrentSearchParams(prev => ({ ...prev, dateFrom: MIN_DATE }));
                }
              }}
              InputLabelProps={{ shrink: true }}
              inputProps={{
                min: MIN_DATE,
                max: new Date().toISOString().split('T')[0],
                step: 1, // Ensure day-by-day selection
              }}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />
            <TextField
              label="To Date"
              type="date"
              value={currentSearchParams.dateTo || ''}
              onChange={(e) => {
                let dateValue = e.target.value || undefined;
                // Validate: if date is before minimum, default to minimum
                if (dateValue && dateValue < MIN_DATE) {
                  dateValue = MIN_DATE;
                }
                setCurrentSearchParams(prev => ({ ...prev, dateTo: dateValue }));
              }}
              onBlur={(e) => {
                // Additional validation on blur to ensure date is not before minimum
                const dateValue = e.target.value;
                if (dateValue && dateValue < MIN_DATE) {
                  setCurrentSearchParams(prev => ({ ...prev, dateTo: MIN_DATE }));
                }
              }}
              InputLabelProps={{ shrink: true }}
              inputProps={{
                min: MIN_DATE,
                max: new Date().toISOString().split('T')[0],
                step: 1, // Ensure day-by-day selection
              }}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />
          </Box>
          )}

          {/* Position Filter - Hidden in easy mode */}
          {!isEasyMode && (
          <FormControl size="small">
            <Autocomplete
              multiple
              options={['House', 'Senate']}
              value={Array.isArray(currentSearchParams.position) ? currentSearchParams.position : []}
              onChange={(_, newValue) => setCurrentSearchParams(prev => ({ ...prev, position: newValue }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Position"
                  sx={{
                    '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                    '& .MuiInputLabel-root': { color: '#94a3b8' },
                  }}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ backgroundColor: '#475569', color: '#ffffff' }}
                  />
                ))
              }
            />
          </FormControl>
          )}

          {/* Party Filter - Hidden in easy mode */}
          {!isEasyMode && (
          <FormControl size="small">
            <Autocomplete
              multiple
              options={['Republican', 'Democratic', 'Independent']}
              value={Array.isArray(currentSearchParams.party) ? currentSearchParams.party : []}
              onChange={(_, newValue) => setCurrentSearchParams(prev => ({ ...prev, party: newValue }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Political Party"
                  sx={{
                    '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                    '& .MuiInputLabel-root': { color: '#94a3b8' },
                  }}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ backgroundColor: '#475569', color: '#ffffff' }}
                  />
                ))
              }
            />
          </FormControl>
          )}

          {/* Transaction Type Filter - Hidden in easy mode */}
          {!isEasyMode && (
          <FormControl size="small">
            <Autocomplete
              multiple
              options={['Purchase', 'Sale', 'Exchange', 'Gift', 'Other']}
              value={Array.isArray(currentSearchParams.transactionType) ? currentSearchParams.transactionType : []}
              onChange={(_, newValue) => setCurrentSearchParams(prev => ({ ...prev, transactionType: newValue }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Transaction Type"
                  sx={{
                    '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                    '& .MuiInputLabel-root': { color: '#94a3b8' },
                  }}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ backgroundColor: '#475569', color: '#ffffff' }}
                  />
                ))
              }
            />
          </FormControl>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
        <Button
          onClick={() => setSearchDialogOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            // Persist search params before performing search
            onSettingsChange(id, { searchParams: currentSearchParams });
            performSearch();
            setSearchDialogOpen(false);
          }}
          variant="contained"
          startIcon={<SearchIcon />}
          sx={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
          }}
        >
          Search
        </Button>
      </DialogActions>
    </Dialog>
  );

  const tileColor = customColor || '#3b82f6';
  
  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: `1px solid ${tileColor}40`,
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
          background: currentResults.length > 0 ? tileColor : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
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
          
          {(() => {
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('politician_trades'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'Politician Trades';
            return (
              <>
                <TileIcon sx={{ color: iconColor, fontSize: '1.5rem', mr: 1 }} />
                <Typography variant="h6" color="white" fontWeight={600}>
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
          
          <Chip
            label={
              isLoadingMore 
                ? 'Loading...' 
                : hasMore && allResults.length > 0 && filteredResults.length === allResults.length
                  ? `Load More (${allResults.length} loaded)`
                  : allResults.length > 0 && currentResults.length !== allResults.length 
                    ? `${currentResults.length} of ${allResults.length} results`
                    : `${currentResults.length} results`
            }
            size="small"
            onClick={
              hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? handleLoadMore
                : undefined
            }
            disabled={isLoadingMore || isLoading || !hasMore || filteredResults.length !== allResults.length}
            sx={{
              backgroundColor: hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? 'rgba(59, 130, 246, 0.3)'
                : 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
              cursor: hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? 'pointer'
                : 'default',
              '&:hover': hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? {
                    backgroundColor: 'rgba(59, 130, 246, 0.4)',
                    transform: 'scale(1.05)',
                  }
                : {},
              '&.Mui-disabled': {
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#6b7280',
                borderColor: '#4b5563',
                cursor: 'not-allowed',
              },
            }}
          />
          
          {autoRefresh && (
            <AutoRefreshIcon sx={{ color: '#10b981', fontSize: '1rem', ml: 0.5 }} />
          )}
        </Box>

        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          contextButton={{
            onClick: handleContextMenuClick,
            disabled: selectedTrades.size === 0,
            tooltip: `Add ${selectedTrades.size > 0 ? `${selectedTrades.size} trade(s)` : 'selected trades'} to context`,
            icon: <AddToContextIcon fontSize="small" />,
          }}
          customizeButton={{
            onClick: () => setCustomizeDialogOpen(true),
          }}
          refreshButton={{
            onClick: (e) => {
              e.stopPropagation();
              handleRefresh();
            },
            disabled: isLoading,
            isLoading: isLoading,
            icon: isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />,
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
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
                    disabled={isLoading}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{
                      color: isLoading ? '#6b7280' : '#9ca3af',
                      '&:hover': { color: isLoading ? '#6b7280' : '#3b82f6' },
                      '&.Mui-disabled': { color: '#6b7280' },
                      padding: '6px',
                    }}
                  >
                    {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
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
                (selectedFilters.politicians.length > 0 || 
                 selectedFilters.parties.length > 0 || 
                 selectedFilters.positions.length > 0 || 
                 selectedFilters.securities.length > 0 || 
                 selectedFilters.transactionTypes.length > 0) 
                  ? `Filter Results (${Object.values(selectedFilters).flat().length} active)`
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
                      color: (selectedFilters.politicians.length > 0 || 
                              selectedFilters.parties.length > 0 || 
                              selectedFilters.positions.length > 0 || 
                              selectedFilters.securities.length > 0 || 
                              selectedFilters.transactionTypes.length > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.politicians.length > 0 || 
                    selectedFilters.parties.length > 0 || 
                    selectedFilters.positions.length > 0 || 
                    selectedFilters.securities.length > 0 || 
                    selectedFilters.transactionTypes.length > 0) && (
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

              <Tooltip title="Edit Search Criteria">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchDialogOpen(true);
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
      {(isLoading || isRestoringPagination) && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            {isRestoringPagination ? 'Restoring previous results...' : 'Searching trades...'}
          </Typography>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 1, backgroundColor: 'rgba(220, 38, 38, 0.1)', flexShrink: 0 }}>
          {error}
        </Alert>
      )}

      {/* Results Table */}
      {localDisplayOptions.showResultsTable && currentResults.length > 0 && !isLoading && !isRestoringPagination && (
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0, // Allow flex shrinking
          mt: 1 // Small top margin
        }}>
          <TableContainer sx={{ 
            flex: 1,
            backgroundColor: 'transparent',
            borderRadius: 0,
            boxShadow: 'none',
            border: 'none',
            overflow: 'auto',
            '&::-webkit-scrollbar': {
              width: '6px',
              height: '6px',
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
            '&::-webkit-scrollbar-corner': {
              backgroundColor: 'rgba(55, 65, 81, 0.3)',
            },
          }}>
            <Table size="small" sx={{ 
              tableLayout: 'fixed',
              width: 'max-content',
              minWidth: '100%',
              '& .MuiTableCell-root': {
                borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                padding: '8px 12px',
                overflow: 'hidden',
                wordBreak: 'break-word',
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
                  <TableCell sx={{ 
                    color: '#9ca3af', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.checkbox || 50,
                    minWidth: columnWidths.checkbox || 50,
                    maxWidth: columnWidths.checkbox || 50,
                  }}>
                    <Checkbox
                      size="small"
                      indeterminate={selectedTrades.size > 0 && selectedTrades.size < currentPageResults.length}
                      checked={currentPageResults.length > 0 && selectedTrades.size === currentPageResults.length}
                      onChange={() => {
                        if (selectedTrades.size === currentPageResults.length) {
                          // Deselect all on current page
                          const newSelected = new Set(selectedTrades);
                          currentPageResults.forEach(trade => newSelected.delete(trade.tradeId));
                          setSelectedTrades(newSelected);
                        } else {
                          // Select all on current page
                          const newSelected = new Set(selectedTrades);
                          currentPageResults.forEach(trade => newSelected.add(trade.tradeId));
                          setSelectedTrades(newSelected);
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
                      width: columnWidths.politician,
                      minWidth: columnWidths.politician,
                    }}>Politician</TableCell>
                  )}
                  {visibleColumns.includes('Position') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.position,
                      minWidth: columnWidths.position,
                    }}>Position</TableCell>
                  )}
                  {visibleColumns.includes('Party') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.party,
                      minWidth: columnWidths.party,
                    }}>Party</TableCell>
                  )}
                  {visibleColumns.includes('Jurisdiction') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.stateDistrict,
                      minWidth: columnWidths.stateDistrict,
                    }}>Jurisdiction</TableCell>
                  )}
                  {visibleColumns.includes('Security') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.security,
                      minWidth: columnWidths.security,
                    }}>Security</TableCell>
                  )}
                  {visibleColumns.includes('Transaction') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.transactionType,
                      minWidth: columnWidths.transactionType,
                    }}>Type</TableCell>
                  )}
                  {visibleColumns.includes('Amount') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.amount,
                      minWidth: columnWidths.amount,
                    }}>Amount</TableCell>
                  )}
                  {visibleColumns.includes('Transaction Date') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.transactionDate,
                      minWidth: columnWidths.transactionDate,
                    }}>Transaction Date</TableCell>
                  )}
                  {visibleColumns.includes('Filing Date') && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.date,
                      minWidth: columnWidths.date,
                    }}>Filing Date</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((trade, index) => (
                  <TableRow
                    key={trade.tradeId}
                    draggable
                    onDragStart={(e) => handleDragStart(e, trade.tradeId)}
                    onClick={(e) => handleTradeClick(e, trade.tradeId, index)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (user?.id) {
                        openItemDetails(
                          'politician_trade',
                          trade,
                          'Trade Details',
                          { user_id: user.id }
                        );
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, trade.tradeId)}
                    sx={{
                      backgroundColor: selectedTrades.has(trade.tradeId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': {
                        backgroundColor: selectedTrades.has(trade.tradeId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                  >
                    {/* Empty cell to maintain row height and alignment with header checkbox */}
                    <TableCell 
                      padding="none"
                      sx={{ 
                        width: '40px',
                        minWidth: '40px',
                        maxWidth: '40px',
                        padding: '8px 4px',
                      }}
                    />
                    {visibleColumns.includes('Politician') && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.politician,
                        minWidth: columnWidths.politician,
                        padding: '8px 12px',
                      }}>
                        {trade.websiteUrl ? (
                          <Tooltip title="Click to visit politician's website" arrow>
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
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                                {trade.politicianName}
                              </Typography>
                              <LaunchIcon sx={{ fontSize: '0.75rem', flexShrink: 0 }} />
                            </Link>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" noWrap title={trade.politicianName} sx={{ color: '#ffffff' }}>
                            {trade.politicianName}
                          </Typography>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes('Position') && (
                      <TableCell sx={{ 
                        fontSize: '0.875rem',
                        width: columnWidths.position,
                        minWidth: columnWidths.position,
                        padding: '8px 12px',
                      }}>
                        <Chip
                          label={trade.position}
                          size="small"
                          sx={{
                            backgroundColor: trade.position === 'Senate' ? '#dc2626' : '#2563eb',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                          }}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.includes('Party') && (
                      <TableCell sx={{ 
                        fontSize: '0.875rem',
                        width: columnWidths.party,
                        minWidth: columnWidths.party,
                        padding: '8px 12px',
                      }}>
                        <Chip
                          label={trade.party || 'N/A'}
                          size="small"
                          sx={{
                            backgroundColor: '#6b7280',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                          }}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.includes('Jurisdiction') && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.stateDistrict,
                        minWidth: columnWidths.stateDistrict,
                        padding: '8px 12px',
                      }}>
                        <Typography variant="body2" noWrap title={trade.stateDistrict || 'N/A'}>
                          {trade.stateDistrict || 'N/A'}
                        </Typography>
                      </TableCell>
                    )}
                    {visibleColumns.includes('Security') && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.security,
                        minWidth: columnWidths.security,
                        padding: '8px 12px',
                      }}>
                        <Box>
                          {trade.securitySymbol && (
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontWeight: 600, 
                                lineHeight: 1.2,
                                wordBreak: 'break-word',
                              }} 
                              title={trade.securitySymbol}
                            >
                              {trade.securitySymbol}
                            </Typography>
                          )}
                          {trade.securityName && (
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                color: '#9ca3af',
                                display: 'block',
                                lineHeight: 1.1,
                                fontSize: '0.7rem',
                                wordBreak: 'break-word',
                              }} 
                              title={trade.securityName}
                            >
                              {trade.securityName}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                    )}
                    {visibleColumns.includes('Transaction') && (
                      <TableCell sx={{ 
                        fontSize: '0.875rem',
                        width: columnWidths.transactionType,
                        minWidth: columnWidths.transactionType,
                        padding: '8px 12px',
                      }}>
                        <Chip
                          label={trade.transactionType}
                          size="small"
                          sx={{
                            backgroundColor: 
                              trade.transactionType?.includes('Purchase') || trade.transactionType?.includes('Buy') ? '#059669' : '#dc2626',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                          }}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.includes('Amount') && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.amount,
                        minWidth: columnWidths.amount,
                        padding: '8px 12px',
                      }}>
                        {getAmountRangeDisplay(trade)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('Transaction Date') && (
                      <TableCell sx={{ 
                        color: '#9ca3af', 
                        fontSize: '0.875rem',
                        width: columnWidths.transactionDate,
                        minWidth: columnWidths.transactionDate,
                        padding: '8px 12px',
                      }}>
                        {formatTransactionDate(trade.transactionDate)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('Filing Date') && (
                      <TableCell sx={{ 
                        color: '#9ca3af', 
                        fontSize: '0.875rem',
                        width: columnWidths.date,
                        minWidth: columnWidths.date,
                        padding: '8px 12px',
                      }}>
                        {formatDate(trade.filingDate)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
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
                Showing {startIndex + 1}-{Math.min(endIndex, currentResults.length)} of {currentResults.length} results
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
      {!isLoading && !isRestoringPagination && currentResults.length === 0 && !error && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No trades match your criteria. Try adjusting your search parameters.
          </Typography>
        </Box>
      )}


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
        {AVAILABLE_COLUMNS.map((column) => {
          return (
            <MenuItem
              key={column}
              onClick={() => handleColumnToggle(column)}
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
          );
        })}
      </Menu>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: '#334155',
            border: '1px solid #475569',
            '& .MuiMenuItem-root': {
              color: '#ffffff',
              '&:hover': { backgroundColor: '#475569' },
            },
          },
        }}
      >
        <MenuItem onClick={handleAddToContext} sx={{ color: '#3b82f6', fontWeight: 600 }}>
          <ListItemIcon><SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Context" />
        </MenuItem>
        <MenuItem onClick={handleAddToFiles} sx={{ fontWeight: 600 }}>
          <ListItemIcon><FolderIcon sx={{ color: '#fbbf24', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Files" />
        </MenuItem>
      </Menu>
      
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />

      {/* Search Dialog */}
      {renderSearchDialog()}

      {/* Filter Dialog */}
      <Dialog
        open={filterDialogOpen}
        onClose={() => setFilterDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            color: '#ffffff',
            border: '1px solid #334155',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
          <Box display="flex" alignItems="center" gap={1}>
            <FilterIcon />
            <Typography variant="h6">Filter Results</Typography>
            <Chip
              label={`${filteredResults.length} of ${allResults.length} results`}
              size="small"
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#3b82f6',
                border: '1px solid #3b82f6',
                ml: 1
              }}
            />
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
            Refine search results by: Click headings to show top filters. Document counts shown in <span style={{ color: '#3b82f6' }}>#</span>
          </Typography>

          {/* Applied Filters Section */}
          {(selectedFilters.politicians.length > 0 || 
            selectedFilters.parties.length > 0 || 
            selectedFilters.positions.length > 0 || 
            selectedFilters.securities.length > 0 || 
            selectedFilters.transactionTypes.length > 0) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
              <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
                Applied Filters:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {selectedFilters.politicians.map(politician => (
                  <Chip
                    key={`politician-${politician}`}
                    label={`Politician: ${politician}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        politicians: prev.politicians.filter(p => p !== politician)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#3b82f6',
                      border: '1px solid #3b82f6',
                      '& .MuiChip-deleteIcon': { color: '#3b82f6' }
                    }}
                  />
                ))}
                {selectedFilters.parties.map(party => (
                  <Chip
                    key={`party-${party}`}
                    label={`Party: ${party}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        parties: prev.parties.filter(p => p !== party)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      border: '1px solid #10b981',
                      '& .MuiChip-deleteIcon': { color: '#10b981' }
                    }}
                  />
                ))}
                {selectedFilters.positions.map(position => (
                  <Chip
                    key={`position-${position}`}
                    label={`Position: ${position}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        positions: prev.positions.filter(p => p !== position)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      '& .MuiChip-deleteIcon': { color: '#f59e0b' }
                    }}
                  />
                ))}
                {selectedFilters.securities.map(security => (
                  <Chip
                    key={`security-${security}`}
                    label={`Security: ${security}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        securities: prev.securities.filter(s => s !== security)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(139, 92, 246, 0.2)',
                      color: '#8b5cf6',
                      border: '1px solid #8b5cf6',
                      '& .MuiChip-deleteIcon': { color: '#8b5cf6' }
                    }}
                  />
                ))}
                {selectedFilters.transactionTypes.map(type => (
                  <Chip
                    key={`transaction-${type}`}
                    label={`Transaction: ${type}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        transactionTypes: prev.transactionTypes.filter(t => t !== type)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(236, 72, 153, 0.2)',
                      color: '#ec4899',
                      border: '1px solid #ec4899',
                      '& .MuiChip-deleteIcon': { color: '#ec4899' }
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Page Size Selection */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
            <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
              Results Per Page:
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl sx={{ minWidth: 120 }}>
                <TextField
                  select
                  value={resultsPerPage}
                  onChange={(e) => {
                    const newSize = parseInt(e.target.value);
                    setResultsPerPage(newSize);
                    setCurrentPage(1); // Reset to first page when changing page size
                    setIsPageSizeManuallySet(true); // Mark as manually set
                    localStorage.setItem(`politicianTrades_pageSize_${id}`, newSize.toString());
                  }}
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#475569',
                      color: '#ffffff',
                      '& fieldset': {
                        borderColor: '#64748b',
                      },
                      '&:hover fieldset': {
                        borderColor: '#3b82f6',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#3b82f6',
                      },
                    },
                    '& .MuiSelect-select': {
                      color: '#ffffff',
                    },
                    '& .MuiSelect-icon': {
                      color: '#94a3b8',
                    },
                    '& .MuiInputLabel-root': {
                      color: '#94a3b8',
                    },
                  }}
                  SelectProps={{
                    MenuProps: {
                      PaperProps: {
                        sx: {
                          backgroundColor: '#334155',
                          '& .MuiMenuItem-root': {
                            color: '#ffffff',
                            '&:hover': {
                              backgroundColor: '#475569',
                            },
                            '&.Mui-selected': {
                              backgroundColor: '#3b82f6',
                              '&:hover': {
                                backgroundColor: '#2563eb',
                              },
                            },
                          },
                        },
                      },
                    },
                  }}
                >
                  {[10, 25, 50, 100].map((size) => (
                    <MenuItem key={size} value={size}>
                      {size} results
                    </MenuItem>
                  ))}
                </TextField>
              </FormControl>
              
              {isPageSizeManuallySet && (
                <Button
                  onClick={() => {
                    setIsPageSizeManuallySet(false);
                    const newResultsPerPage = calculateResultsPerPage();
                    setResultsPerPage(newResultsPerPage);
                    setCurrentPage(1);
                    localStorage.removeItem(`politicianTrades_pageSize_${id}`);
                  }}
                  size="small"
                  sx={{
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    textTransform: 'none',
                    minWidth: 'auto',
                    px: 1.5,
                    '&:hover': {
                      color: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Auto
                </Button>
              )}
            </Box>
            {!isPageSizeManuallySet && (
              <Typography variant="caption" sx={{ color: '#94a3b8', mt: 1, display: 'block' }}>
                Automatically adjusts based on tile size
              </Typography>
            )}
          </Box>

          {/* No Results Message */}
          {availableFilters.politicians.length === 0 && 
           availableFilters.parties.length === 0 && 
           availableFilters.securities.length === 0 && 
           availableFilters.transactionTypes.length === 0 ? (
            <Box 
              sx={{ 
                textAlign: 'center', 
                py: 6, 
                backgroundColor: '#334155', 
                borderRadius: '4px',
                border: '1px solid #475569'
              }}
            >
              <Typography variant="h6" sx={{ color: '#cbd5e1', mb: 2, fontWeight: 500 }}>
                No Filters Available
              </Typography>
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                {allResults.length === 0 
                  ? 'No search results found. Try adjusting your search criteria.'
                  : 'All results are identical - no additional filters can be applied.'
                }
              </Typography>
            </Box>
          ) : (
            <Box 
              display="flex" 
              flexDirection="column" 
              gap={2}
              sx={{
                '& .MuiAccordion-root': {
                  backgroundColor: '#334155',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  boxShadow: 'none',
                  '&:before': {
                    display: 'none',
                  },
                  '&.Mui-expanded': {
                    margin: '8px 0',
                  },
                  '&:not(:last-child)': {
                    marginBottom: '8px',
                  },
                },
                '& .MuiAccordionSummary-root': {
                  backgroundColor: '#475569',
                  borderRadius: '4px 4px 0 0',
                  minHeight: '56px',
                  '&.Mui-expanded': {
                    minHeight: '56px',
                    borderRadius: '4px 4px 0 0',
                  },
                  '&:hover': {
                    backgroundColor: '#64748b',
                  },
                },
                '& .MuiAccordionDetails-root': {
                  padding: '16px',
                  backgroundColor: '#334155',
                  borderRadius: '0 0 4px 4px',
                  borderTop: '1px solid #475569',
                },
                '& .MuiAccordionSummary-content': {
                  margin: '12px 0',
                },
                '& .MuiAccordionSummary-expandIconWrapper': {
                  color: '#e2e8f0',
                  '&.Mui-expanded': {
                    transform: 'rotate(180deg)',
                  },
                },
              }}
            >
            {/* Politicians Filter */}
            {availableFilters.politicians.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Politicians ({availableFilters.politicians.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
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
                    {availableFilters.politicians.map((filter) => (
                      <Box
                        key={filter.politician}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1.5,
                          cursor: 'pointer',
                          borderRadius: '4px',
                          backgroundColor: selectedFilters.politicians.includes(filter.politician)
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          transition: 'background-color 0.15s ease',
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.politicians.includes(filter.politician);
                          setSelectedFilters(prev => ({
                            ...prev,
                            politicians: isSelected
                              ? prev.politicians.filter(p => p !== filter.politician)
                              : [...prev.politicians, filter.politician]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                          {filter.politician}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: '#ffffff',
                            minWidth: '28px',
                            height: '22px',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            '& .MuiChip-label': {
                              px: 0.75,
                            },
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Parties Filter */}
            {availableFilters.parties.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Parties ({availableFilters.parties.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
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
                    {availableFilters.parties.map((filter) => (
                      <Box
                        key={filter.party}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          cursor: 'pointer',
                          borderRadius: 1,
                          backgroundColor: selectedFilters.parties.includes(filter.party)
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.parties.includes(filter.party);
                          setSelectedFilters(prev => ({
                            ...prev,
                            parties: isSelected
                              ? prev.parties.filter(p => p !== filter.party)
                              : [...prev.parties, filter.party]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#ffffff', flex: 1 }}>
                          {filter.party}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            minWidth: '32px',
                            height: '20px',
                            fontSize: '0.7rem',
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Securities Filter */}
            {availableFilters.securities.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Securities ({availableFilters.securities.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '8px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#1e293b',
                        borderRadius: '4px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '4px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.securities.map((filter) => (
                      <Box
                        key={filter.security}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          cursor: 'pointer',
                          borderRadius: 1,
                          backgroundColor: selectedFilters.securities.includes(filter.security)
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.securities.includes(filter.security);
                          setSelectedFilters(prev => ({
                            ...prev,
                            securities: isSelected
                              ? prev.securities.filter(s => s !== filter.security)
                              : [...prev.securities, filter.security]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#ffffff', flex: 1 }}>
                          {filter.security}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            minWidth: '32px',
                            height: '20px',
                            fontSize: '0.7rem',
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Transaction Types Filter */}
            {availableFilters.transactionTypes.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Transaction Types ({availableFilters.transactionTypes.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '8px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#1e293b',
                        borderRadius: '4px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '4px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.transactionTypes.map((filter) => (
                      <Box
                        key={filter.transactionType}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          cursor: 'pointer',
                          borderRadius: 1,
                          backgroundColor: selectedFilters.transactionTypes.includes(filter.transactionType)
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.transactionTypes.includes(filter.transactionType);
                          setSelectedFilters(prev => ({
                            ...prev,
                            transactionTypes: isSelected
                              ? prev.transactionTypes.filter(t => t !== filter.transactionType)
                              : [...prev.transactionTypes, filter.transactionType]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#ffffff', flex: 1 }}>
                          {filter.transactionType}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            minWidth: '32px',
                            height: '20px',
                            fontSize: '0.7rem',
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
          </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155', p: 3, gap: 1 }}>
          <Button
            onClick={() => {
              setSelectedFilters({
                politicians: [],
                parties: [],
                positions: [],
                securities: [],
                transactionTypes: [],
              });
            }}
            disabled={
              selectedFilters.politicians.length === 0 && 
              selectedFilters.parties.length === 0 && 
              selectedFilters.positions.length === 0 && 
              selectedFilters.securities.length === 0 && 
              selectedFilters.transactionTypes.length === 0
            }
            sx={{ 
              color: '#94a3b8',
              '&:hover': {
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
              },
              '&.Mui-disabled': {
                color: '#64748b',
              },
            }}
          >
            Clear All
          </Button>
          <Button
            onClick={() => {
              // Update parent display options and filter settings
              onSettingsChange(id, { 
                displayOptions: localDisplayOptions,
                filterSettings: selectedFilters 
              });
              setFilterDialogOpen(false);
            }}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            Apply Filters
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showPolitician}
                  onChange={() => handleDisplayOptionsChange('showPolitician')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Politician"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showPosition}
                  onChange={() => handleDisplayOptionsChange('showPosition')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Position"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showParty}
                  onChange={() => handleDisplayOptionsChange('showParty')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Party"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showStateDistrict ?? true}
                  onChange={() => handleDisplayOptionsChange('showStateDistrict')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Jurisdiction"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showSecurity}
                  onChange={() => handleDisplayOptionsChange('showSecurity')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Security"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showTransactionType}
                  onChange={() => handleDisplayOptionsChange('showTransactionType')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Transaction Type"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showAmount}
                  onChange={() => handleDisplayOptionsChange('showAmount')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Amount"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showDate}
                  onChange={() => handleDisplayOptionsChange('showDate')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Date"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showResultsTable}
                  onChange={() => handleDisplayOptionsChange('showResultsTable')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Results Table"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDisplayDialogOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
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
        currentTitle={customTitle || 'Politician Trades'}
        currentColor={customColor}
        currentIcon={customIcon}
      />

    </Box>
  );
};

// Custom comparison function for memo - matches SEC tile pattern but with optimization
const PoliticianTradesSearchTileMemo = memo(PoliticianTradesSearchTile, (prevProps, nextProps) => {
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
    if (prevDisplay.showPolitician !== nextDisplay.showPolitician ||
        prevDisplay.showParty !== nextDisplay.showParty ||
        prevDisplay.showPosition !== nextDisplay.showPosition ||
        prevDisplay.showStateDistrict !== nextDisplay.showStateDistrict ||
        prevDisplay.showSecurity !== nextDisplay.showSecurity ||
        prevDisplay.showTransactionType !== nextDisplay.showTransactionType ||
        prevDisplay.showAmount !== nextDisplay.showAmount ||
        prevDisplay.showDate !== nextDisplay.showDate ||
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
  
  return true; // Don't re-render
});

PoliticianTradesSearchTileMemo.displayName = 'PoliticianTradesSearchTile';

export default PoliticianTradesSearchTileMemo;
