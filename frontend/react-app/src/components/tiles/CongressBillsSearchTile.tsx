import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Pagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
  Dashboard as AddToContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  AutoAwesome as AutoRefreshIcon,
  Gavel as GavelIcon,
  ViewColumn as ViewColumnIcon,
} from '@mui/icons-material';
import { 
  congressBillsSearchAPI, 
  CongressBillsSearchFilters,
  CongressBill 
} from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, confirmDialog, addBillToContext, addMultipleBillsToContext, getIconByName, getDefaultIconForTileType } from './common';
import MultiSelectField from '../MultiSelectField';
import { politicianSuggestionsService } from '../../services/politicianSuggestions';
import { policyAreaSuggestionsService } from '../../services/policyAreaSuggestions';

// Bill Type options
const BILL_TYPES = ['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES'];

// US States
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

// Parties
const PARTIES = ['R', 'D', 'I'];

// Bipartisan options
const BIPARTISAN_OPTIONS = [
  { value: 1, label: 'Bipartisan' },
  { value: 0, label: 'Not Bipartisan' }
];

interface CongressBillsSearchTileProps {
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
  // Congress bills specific props
  searchParams?: CongressBillsSearchFilters;
  filterSettings?: {
    billTypes?: string[];
    sponsorParties?: string[];
    sponsorStates?: string[];
    policyAreas?: string[];
    congresses?: number[];
    bipartisan?: number[];
  };
  results?: CongressBill[];
  displayOptions?: {
    showBillTitle: boolean;
    showBillType: boolean;
    showBillNumber: boolean;
    showSponsorName: boolean;
    showSponsorParty: boolean;
    showSponsorState: boolean;
    showIntroducedDate: boolean;
    showLatestActionDate: boolean;
    showCongress: boolean;
    showBipartisan: boolean;
    showPolicyArea: boolean;
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

const CongressBillsSearchTile: React.FC<CongressBillsSearchTileProps> = ({
  id,
  size,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isResizing = false,
  isSelected = false,
  onSelectionChange,
  searchParams = {
    bill_title: [],
    bill_type: [],
    sponsor_name: [],
    introduced_date_from: '',
    introduced_date_to: '',
    congress: [],
    policy_area: [],
    sponsor_party: [],
    sponsor_state: [],
    latest_action_date_from: '',
    latest_action_date_to: '',
    bipartisan: undefined,
    bill_number: undefined,
  },
  filterSettings: initialFilterSettings,
  paginationState: initialPaginationState,
  results = [],
  displayOptions = {
    showBillTitle: true,
    showBillType: true,
    showBillNumber: false,
    showSponsorName: true,
    showSponsorParty: false,
    showSponsorState: false,
    showIntroducedDate: true,
    showLatestActionDate: false,
    showCongress: true,
    showBipartisan: false,
    showPolicyArea: false,
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
  // Alias paginationState for consistency
  const paginationState = initialPaginationState;
  // const { user } = useAuth();
  // const { activeSessionId } = useGlobalChat();
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<CongressBill | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  
  // Search state
  const [currentSearchParams, setCurrentSearchParams] = useState<CongressBillsSearchFilters>(searchParams);
  
  // Store all results for client-side filtering - restore from props if available (session persistence)
  const [allResults, setAllResults] = useState<CongressBill[]>(results || []);
  const [filteredResults, setFilteredResults] = useState<CongressBill[]>(results || []);
  
  // Track if initial search has been performed
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>([]);
  const [isRestoringPagination, setIsRestoringPagination] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  
  // Filter state - restore from props if available
  const [selectedFilters, setSelectedFilters] = useState<{
    billTypes: Set<string>;
    sponsorParties: Set<string>;
    sponsorStates: Set<string>;
    policyAreas: Set<string>;
    congresses: Set<number>;
    bipartisan: Set<number>;
  }>({
    billTypes: new Set(initialFilterSettings?.billTypes || []),
    sponsorParties: new Set(initialFilterSettings?.sponsorParties || []),
    sponsorStates: new Set(initialFilterSettings?.sponsorStates || []),
    policyAreas: new Set(initialFilterSettings?.policyAreas || []),
    congresses: new Set(initialFilterSettings?.congresses || []),
    bipartisan: new Set(initialFilterSettings?.bipartisan || []),
  });
  
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  
  // Display options state
  const localDisplayOptions = useMemo(() => ({
    ...{
      showBillTitle: true,
      showBillType: true,
      showBillNumber: false,
      showSponsorName: true,
      showSponsorParty: false,
      showSponsorState: false,
      showIntroducedDate: true,
      showLatestActionDate: false,
      showCongress: true,
      showBipartisan: false,
      showPolicyArea: false,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    ...displayOptions
  }), [displayOptions]);
  
  // Column visibility state - using array of strings like parent page
  // Note: 'details' is always visible and not selectable (like SEC tile actions)
  const AVAILABLE_COLUMNS = [
    'bill_title',
    'bill_type',
    'bill_number',
    'sponsor_name',
    'sponsor_party',
    'sponsor_state',
    'introduced_date',
    'latest_action_date',
    'congress',
    'bipartisan',
    'policy_area',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['bill_title', 'bill_type', 'sponsor_name', 'introduced_date', 'congress'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    // Convert display options to column array
    const cols: string[] = [];
    if (localDisplayOptions.showBillTitle) cols.push('bill_title');
    if (localDisplayOptions.showBillType) cols.push('bill_type');
    if (localDisplayOptions.showBillNumber) cols.push('bill_number');
    if (localDisplayOptions.showSponsorName) cols.push('sponsor_name');
    if (localDisplayOptions.showSponsorParty) cols.push('sponsor_party');
    if (localDisplayOptions.showSponsorState) cols.push('sponsor_state');
    if (localDisplayOptions.showIntroducedDate) cols.push('introduced_date');
    if (localDisplayOptions.showLatestActionDate) cols.push('latest_action_date');
    if (localDisplayOptions.showCongress) cols.push('congress');
    if (localDisplayOptions.showBipartisan) cols.push('bipartisan');
    if (localDisplayOptions.showPolicyArea) cols.push('policy_area');
    return cols.length > 0 ? cols : DEFAULT_VISIBLE_COLUMNS;
  });
  
  // Handle column toggle
  const handleColumnToggle = useCallback((column: string) => {
    setVisibleColumns((prev) => {
      const newColumns = prev.includes(column)
        ? prev.filter((c) => c !== column)
        : [...prev, column];
      
      // Update display options
      const newDisplayOptions = {
        ...localDisplayOptions,
        showBillTitle: newColumns.includes('bill_title'),
        showBillType: newColumns.includes('bill_type'),
        showBillNumber: newColumns.includes('bill_number'),
        showSponsorName: newColumns.includes('sponsor_name'),
        showSponsorParty: newColumns.includes('sponsor_party'),
        showSponsorState: newColumns.includes('sponsor_state'),
        showIntroducedDate: newColumns.includes('introduced_date'),
        showLatestActionDate: newColumns.includes('latest_action_date'),
        showCongress: newColumns.includes('congress'),
        showBipartisan: newColumns.includes('bipartisan'),
        showPolicyArea: newColumns.includes('policy_area'),
      };
      onSettingsChange(id, { displayOptions: newDisplayOptions });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);
  
  // const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`congressBills_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const [isPageSizeManuallySet] = useState(() => {
    return localStorage.getItem(`congressBills_pageSize_${id}`) !== null;
  });
  const tileRef = useRef<HTMLDivElement>(null);
  
  // Autocomplete state
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState<boolean>(false);
  const [isPolicyAreaDataLoaded, setIsPolicyAreaDataLoaded] = useState<boolean>(false);
  const [, setSponsorNameSuggestions] = useState<string[]>([]);
  const [sponsorNameLoading, setSponsorNameLoading] = useState<boolean>(false);
  // const [policyAreaLoading, setPolicyAreaLoading] = useState<boolean>(false);
  
  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });
  
  // Auto refresh functionality
  const autoRefreshRef = useRef<NodeJS.Timeout>();
  
  // Load politician data on mount
  useEffect(() => {
    const loadPoliticianData = async () => {
      try {
        await politicianSuggestionsService.loadPoliticians();
        setIsPoliticianDataLoaded(true);
      } catch (error) {
        console.error('Failed to load politician suggestions:', error);
      }
    };
    loadPoliticianData();
  }, []);
  
  // Load policy area data on mount
  useEffect(() => {
    const loadPolicyAreaData = async () => {
      try {
        await policyAreaSuggestionsService.loadPolicyAreas();
        setIsPolicyAreaDataLoaded(true);
      } catch (error) {
        console.error('Failed to load policy area suggestions:', error);
      }
    };
    loadPolicyAreaData();
  }, []);
  
  // Autocomplete search functions
  const sponsorNameSearch = useCallback((query: string): string[] => {
    if (!isPoliticianDataLoaded) {
      return [];
    }
    
    if (!query || query.length < 2) {
      setSponsorNameSuggestions([]);
      setSponsorNameLoading(false);
      return [];
    }
    
    setSponsorNameLoading(true);
    
    if (query.length < 2) {
      setSponsorNameSuggestions([]);
      setSponsorNameLoading(false);
      return [];
    }
    
    const suggestions = politicianSuggestionsService.getSuggestions(query, 20);
    const results = suggestions.map(p => p.displayText);
    setSponsorNameSuggestions(results);
    setSponsorNameLoading(false);
    return results;
  }, [isPoliticianDataLoaded]);
  
  const policyAreaSearch = useCallback((query: string): string[] => {
    if (!isPolicyAreaDataLoaded) {
      return [];
    }
    
    if (!query || query.length < 1) {
      return policyAreaSuggestionsService.getAllPolicyAreas();
    }
    
    return policyAreaSuggestionsService.getSuggestions(query, 20);
  }, [isPolicyAreaDataLoaded]);
  
  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('📋 CongressBillsSearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    try {
      const filters: any = {
        ...currentSearchParams,
      };
      
      // Remove empty arrays and empty strings
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
        if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
      });
      
      const searchRequest = {
        filters,
        limit: localDisplayOptions.maxResults,
      };
      
      const response = await congressBillsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('📋 CongressBillsSearchTile: Retrieved', response.results.length, 'bills');
        
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(response.results);
        setFilteredResults(response.results);
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
            totalResultsLoaded: response.results.length,
            lastEvaluatedKeys: newLastEvaluatedKeys,
            hasMore: response.has_more || false,
          },
        });
        
        // Update parent component
        onUpdate(id, {
          results: response.results,
          lastUpdated: Date.now(),
        });
      } else {
        console.error('📋 CongressBillsSearchTile: Search failed');
        setError('Search failed');
        setAllResults([]);
        setFilteredResults([]);
        setHasPerformedInitialSearch(true);
        setHasMore(false);
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
      console.error('📋 CongressBillsSearchTile: Search error:', err);
      setError(err.message || 'An error occurred during search');
      setAllResults([]);
      setFilteredResults([]);
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
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, onSettingsChange]);
  
  // Load more results
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore || !currentSearchParams) return;
    
    setIsLoadingMore(true);
    setError(null);
    
    try {
      const filters: any = {
        ...currentSearchParams,
      };
      
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
        if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
      });
      
      const searchRequest = {
        filters,
        limit: localDisplayOptions.maxResults,
        last_evaluated_key: lastEvaluatedKey,
      };
      
      const response = await congressBillsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        const updatedResults = [...allResults, ...response.results];
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(updatedResults);
        setFilteredResults(updatedResults);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Update lastEvaluatedKeys array (add new key if exists, limit to 100 pages)
        const updatedKeys = newLastEvaluatedKey 
          ? [...lastEvaluatedKeys, newLastEvaluatedKey].slice(-100) // Keep last 100 keys
          : lastEvaluatedKeys;
        setLastEvaluatedKeys(updatedKeys);
        
        // Persist pagination state
        onSettingsChange(id, {
          paginationState: {
            totalResultsLoaded: updatedResults.length,
            lastEvaluatedKeys: updatedKeys,
            hasMore: response.has_more || false,
          },
        });
        
        onUpdate(id, {
          results: updatedResults,
          lastUpdated: Date.now(),
        });
      } else {
        console.error('📋 CongressBillsSearchTile: Load more failed');
        setError('Load more failed');
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
      console.error('📋 CongressBillsSearchTile: Load more error:', err);
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
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange]);
  
  // Restore pagination state on mount
  const restorePaginationState = useCallback(async () => {
    if (!paginationState || !paginationState.lastEvaluatedKeys || paginationState.lastEvaluatedKeys.length === 0) {
      return;
    }

    if (paginationState.totalResultsLoaded <= (results?.length || 0)) {
      // Already have all results, no need to restore
      return;
    }

    console.log('🔄 CongressBillsSearchTile: Restoring pagination state', {
      totalResultsLoaded: paginationState.totalResultsLoaded,
      currentResults: results?.length || 0,
      keysToLoad: paginationState.lastEvaluatedKeys.length,
    });

    setIsRestoringPagination(true);
    setIsLoading(true);
    setError(null);

    try {
      let currentResults = [...(results || [])];
      let keysToLoad = [...paginationState.lastEvaluatedKeys];
      
      // Skip keys that were already used (if we have more results than initial page)
      const initialPageSize = localDisplayOptions.maxResults || 50;
      if (currentResults.length > initialPageSize) {
        // Calculate how many pages we've already loaded
        const pagesLoaded = Math.ceil(currentResults.length / initialPageSize);
        keysToLoad = keysToLoad.slice(pagesLoaded - 1); // Skip already loaded keys
      }

      // Load each page sequentially until we reach totalResultsLoaded
      while (currentResults.length < paginationState.totalResultsLoaded && keysToLoad.length > 0 && currentSearchParams) {
        const nextKey = keysToLoad[0];
        
        const filters: any = {
          ...currentSearchParams,
        };
        
        Object.keys(filters).forEach((key) => {
          const value = filters[key];
          if (Array.isArray(value) && value.length === 0) {
            delete filters[key];
          }
          if (value === '' || value === null || value === undefined) {
            delete filters[key];
          }
        });
        
        const searchRequest = {
          filters,
          limit: localDisplayOptions.maxResults,
          last_evaluated_key: nextKey,
        };
        
        const response = await congressBillsSearchAPI.search(searchRequest);
        
        if (response.success && response.results) {
          currentResults = [...currentResults, ...response.results];
          keysToLoad = keysToLoad.slice(1);
        } else {
          // No more results or error, stop loading
          break;
        }
      }
      
      // Update state with restored results
      setAllResults(currentResults);
      setFilteredResults(currentResults);
      setLastEvaluatedKeys(paginationState.lastEvaluatedKeys);
      setHasMore(paginationState.hasMore);
      setHasPerformedInitialSearch(true);
      
      // Update tile with restored results
      onUpdate(id, {
        results: currentResults,
        lastUpdated: Date.now(),
      });
      
      console.log('✅ CongressBillsSearchTile: Pagination state restored', {
        restoredCount: currentResults.length,
        targetCount: paginationState.totalResultsLoaded,
      });
    } catch (err) {
      console.error('❌ CongressBillsSearchTile: Error restoring pagination state', err);
      setError('Failed to restore previous results. Please refresh.');
    } finally {
      setIsRestoringPagination(false);
      setIsLoading(false);
    }
  }, [paginationState, results, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate]);

  // Restore pagination state on mount if needed
  useEffect(() => {
    if (paginationState && paginationState.totalResultsLoaded > (results?.length || 0) && !isRestoringPagination && !isLoading) {
      restorePaginationState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount
  
  // Dynamic pagination based on tile height
  const calculateResultsPerPage = useCallback(() => {
    if (!tileRef.current) return 5;
    
    const tileHeight = tileRef.current.clientHeight;
    const headerHeight = 60;
    const paginationHeight = 40;
    const tableHeaderHeight = 40;
    const rowHeight = 32;
    const padding = 24;
    
    const availableHeight = tileHeight - headerHeight - paginationHeight - tableHeaderHeight - padding;
    const maxRows = Math.floor(availableHeight / rowHeight);
    
    return Math.max(3, Math.min(20, maxRows));
  }, []);
  
  // Update results per page when tile size changes
  useEffect(() => {
    if (!isPageSizeManuallySet) {
      const newResultsPerPage = calculateResultsPerPage();
      setResultsPerPage(newResultsPerPage);
    }
  }, [calculateResultsPerPage, size, isPageSizeManuallySet]);
  
  // Add ResizeObserver
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
      autoRefreshRef.current = setInterval(performSearch, 600000); // 10 minutes
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
        }
      };
    }
  }, [autoRefresh, performSearch, isDragging, isResizing]);
  
  // Restore results from props on mount (session persistence)
  useEffect(() => {
    if (results && results.length > 0 && allResults.length === 0 && !isRestoringPagination) {
      console.log('🔄 CongressBillsSearchTile: Restoring', results.length, 'results from session');
      setAllResults(results);
      setFilteredResults(results);
      setHasPerformedInitialSearch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && filteredResults.length === 0 && !isLoading && !isRestoringPagination) {
      const hasSearchCriteria = 
        (currentSearchParams.bill_title && currentSearchParams.bill_title.length > 0) ||
        (currentSearchParams.bill_type && currentSearchParams.bill_type.length > 0) ||
        (currentSearchParams.sponsor_name && currentSearchParams.sponsor_name.length > 0) ||
        (currentSearchParams.policy_area && currentSearchParams.policy_area.length > 0) ||
        (currentSearchParams.sponsor_party && currentSearchParams.sponsor_party.length > 0) ||
        (currentSearchParams.sponsor_state && currentSearchParams.sponsor_state.length > 0) ||
        (currentSearchParams.congress && currentSearchParams.congress.length > 0) ||
        currentSearchParams.introduced_date_from ||
        currentSearchParams.introduced_date_to ||
        currentSearchParams.latest_action_date_from ||
        currentSearchParams.latest_action_date_to ||
        currentSearchParams.bipartisan !== undefined ||
        currentSearchParams.bill_number !== undefined;
      
      if (hasSearchCriteria) {
        console.log('🔄 CongressBillsSearchTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
  }, [hasPerformedInitialSearch, filteredResults.length, isLoading, currentSearchParams, performSearch]);
  
  // Restore results from props on mount
  useEffect(() => {
    if (results.length > 0 && allResults.length === 0) {
      console.log('🔄 CongressBillsSearchTile: Restoring results from tile data:', results.length, 'results');
      setAllResults(results);
      setFilteredResults(results);
    }
  }, [results, allResults.length]);
  
  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Congress Bills Tile from dashboard?',
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
  
  const handleAddToContext = (target: 'new' | 'sidebar') => {
    const selectedBillObjects = filteredResults.filter(bill => 
      selectedBills.has(bill.bill_id)
    );
    
    if (selectedBillObjects.length === 0) return;
    
    if (selectedBillObjects.length === 1) {
      addBillToContext(selectedBillObjects[0], target);
    } else {
      addMultipleBillsToContext(selectedBillObjects, target);
    }
    
    setSelectedBills(new Set());
    handleContextMenuClose();
  };
  
  
  const handleRefresh = () => {
    performSearch();
  };
  
  // Client-side filtering function
  const applyFilters = useCallback(() => {
    let filtered = [...allResults];
    
    // Filter by bill types
    if (selectedFilters.billTypes.size > 0) {
      filtered = filtered.filter(bill => 
        bill.bill_type && selectedFilters.billTypes.has(bill.bill_type)
      );
    }
    
    // Filter by sponsor parties
    if (selectedFilters.sponsorParties.size > 0) {
      filtered = filtered.filter(bill =>
        bill.sponsor_party && selectedFilters.sponsorParties.has(bill.sponsor_party)
      );
    }
    
    // Filter by sponsor states
    if (selectedFilters.sponsorStates.size > 0) {
      filtered = filtered.filter(bill =>
        bill.sponsor_state && selectedFilters.sponsorStates.has(bill.sponsor_state)
      );
    }
    
    // Filter by policy areas
    if (selectedFilters.policyAreas.size > 0) {
      filtered = filtered.filter(bill =>
        bill.policy_area && selectedFilters.policyAreas.has(bill.policy_area)
      );
    }
    
    // Filter by congresses
    if (selectedFilters.congresses.size > 0) {
      filtered = filtered.filter(bill =>
        bill.congress !== undefined && bill.congress !== null && selectedFilters.congresses.has(bill.congress)
      );
    }
    
    // Filter by bipartisan
    if (selectedFilters.bipartisan.size > 0) {
      filtered = filtered.filter(bill =>
        bill.bipartisan !== undefined && bill.bipartisan !== null && selectedFilters.bipartisan.has(bill.bipartisan)
      );
    }
    
    setFilteredResults(filtered);
  }, [allResults, selectedFilters]);
  
  // Apply filters when selectedFilters change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);
  
  // Sync visible columns with display options
  useEffect(() => {
    const cols: string[] = [];
    if (localDisplayOptions.showBillTitle) cols.push('bill_title');
    if (localDisplayOptions.showBillType) cols.push('bill_type');
    if (localDisplayOptions.showBillNumber) cols.push('bill_number');
    if (localDisplayOptions.showSponsorName) cols.push('sponsor_name');
    if (localDisplayOptions.showSponsorParty) cols.push('sponsor_party');
    if (localDisplayOptions.showSponsorState) cols.push('sponsor_state');
    if (localDisplayOptions.showIntroducedDate) cols.push('introduced_date');
    if (localDisplayOptions.showLatestActionDate) cols.push('latest_action_date');
    if (localDisplayOptions.showCongress) cols.push('congress');
    if (localDisplayOptions.showBipartisan) cols.push('bipartisan');
    if (localDisplayOptions.showPolicyArea) cols.push('policy_area');
    if (cols.length > 0) {
      setVisibleColumns(cols);
    }
  }, [localDisplayOptions]);
  
  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const billTypeMap = new Map<string, number>();
    const sponsorPartyMap = new Map<string, number>();
    const sponsorStateMap = new Map<string, number>();
    const policyAreaMap = new Map<string, number>();
    const congressMap = new Map<number, number>();
    const bipartisanMap = new Map<number, number>();
    
    allResults.forEach(bill => {
      if (bill.bill_type) {
        billTypeMap.set(bill.bill_type, (billTypeMap.get(bill.bill_type) || 0) + 1);
      }
      if (bill.sponsor_party) {
        sponsorPartyMap.set(bill.sponsor_party, (sponsorPartyMap.get(bill.sponsor_party) || 0) + 1);
      }
      if (bill.sponsor_state) {
        sponsorStateMap.set(bill.sponsor_state, (sponsorStateMap.get(bill.sponsor_state) || 0) + 1);
      }
      if (bill.policy_area) {
        policyAreaMap.set(bill.policy_area, (policyAreaMap.get(bill.policy_area) || 0) + 1);
      }
      if (bill.congress !== undefined && bill.congress !== null) {
        congressMap.set(bill.congress, (congressMap.get(bill.congress) || 0) + 1);
      }
      if (bill.bipartisan !== undefined && bill.bipartisan !== null) {
        bipartisanMap.set(bill.bipartisan, (bipartisanMap.get(bill.bipartisan) || 0) + 1);
      }
    });
    
    return {
      billTypes: Array.from(billTypeMap.entries())
        .map(([billType, count]) => ({ billType, count }))
        .sort((a, b) => b.count - a.count),
      sponsorParties: Array.from(sponsorPartyMap.entries())
        .map(([party, count]) => ({ party, count }))
        .sort((a, b) => b.count - a.count),
      sponsorStates: Array.from(sponsorStateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      policyAreas: Array.from(policyAreaMap.entries())
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
      congresses: Array.from(congressMap.entries())
        .map(([congress, count]) => ({ congress, count }))
        .sort((a, b) => a.congress - b.congress),
      bipartisan: Array.from(bipartisanMap.entries())
        .map(([bipartisan, count]) => ({ bipartisan, count }))
        .sort((a, b) => a.bipartisan - b.bipartisan),
    };
  }, [allResults]);
  
  const toggleBillSelection = (billId: string) => {
    setSelectedBills(prev => {
      const newSet = new Set(prev);
      if (newSet.has(billId)) {
        newSet.delete(billId);
      } else {
        newSet.add(billId);
      }
      return newSet;
    });
  };
  
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };
  
  // Calculate pagination values
  const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = filteredResults.slice(startIndex, endIndex);
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
          background: filteredResults.length > 0 ? tileColor : '#dc2626',
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
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('congress_bills'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'Congress Bills';
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
                  : allResults.length > 0 && filteredResults.length !== allResults.length 
                    ? `${filteredResults.length} of ${allResults.length} results`
                    : `${filteredResults.length} results`
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
            disabled: selectedBills.size === 0,
            tooltip: `Add ${selectedBills.size > 0 ? `${selectedBills.size} bill(s)` : 'selected bills'} to context`,
            icon: <AddToContextIcon fontSize="small" />,
          }}
          customizeButton={{
            onClick: (e) => {
              e.stopPropagation();
              setCustomizeDialogOpen(true);
            },
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          collapsibleActions={
            <>
              <Tooltip title="Run Search">
                <IconButton
                  size="small"
                  onClick={handleRefresh}
                  disabled={isLoading}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ 
                    color: isLoading ? '#6b7280' : '#9ca3af',
                    '&:hover': { color: '#3b82f6' },
                    '&.Mui-disabled': { color: '#6b7280' }
                  }}
                >
                  {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
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
                (selectedFilters.billTypes.size > 0 || 
                 selectedFilters.sponsorParties.size > 0 || 
                 selectedFilters.sponsorStates.size > 0 || 
                 selectedFilters.policyAreas.size > 0 ||
                 selectedFilters.congresses.size > 0 ||
                 selectedFilters.bipartisan.size > 0) 
                  ? `Filter Results (${Array.from(selectedFilters.billTypes).length + Array.from(selectedFilters.sponsorParties).length + Array.from(selectedFilters.sponsorStates).length + Array.from(selectedFilters.policyAreas).length + Array.from(selectedFilters.congresses).length + Array.from(selectedFilters.bipartisan).length} active)`
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
                      color: (selectedFilters.billTypes.size > 0 || 
                              selectedFilters.sponsorParties.size > 0 || 
                              selectedFilters.sponsorStates.size > 0 || 
                              selectedFilters.policyAreas.size > 0 ||
                              selectedFilters.congresses.size > 0 ||
                              selectedFilters.bipartisan.size > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.billTypes.size > 0 || 
                    selectedFilters.sponsorParties.size > 0 || 
                    selectedFilters.sponsorStates.size > 0 || 
                    selectedFilters.policyAreas.size > 0 ||
                    selectedFilters.congresses.size > 0 ||
                    selectedFilters.bipartisan.size > 0) && (
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
            {isRestoringPagination ? 'Restoring previous results...' : 'Searching bills...'}
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
      {localDisplayOptions.showResultsTable && filteredResults.length > 0 && !isLoading && !isRestoringPagination && (
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0,
          mt: 1
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
                  <TableCell padding="checkbox" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                    <Checkbox
                      size="small"
                      indeterminate={selectedBills.size > 0 && selectedBills.size < currentPageResults.length}
                      checked={currentPageResults.length > 0 && selectedBills.size === currentPageResults.length}
                      onChange={() => {
                        if (selectedBills.size === currentPageResults.length) {
                          const newSelected = new Set(selectedBills);
                          currentPageResults.forEach(bill => newSelected.delete(bill.bill_id));
                          setSelectedBills(newSelected);
                        } else {
                          const newSelected = new Set(selectedBills);
                          currentPageResults.forEach(bill => newSelected.add(bill.bill_id));
                          setSelectedBills(newSelected);
                        }
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                    />
                  </TableCell>
                  {visibleColumns.includes('bill_title') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Bill Title</TableCell>
                  )}
                  {visibleColumns.includes('bill_type') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Type</TableCell>
                  )}
                  {visibleColumns.includes('bill_number') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Number</TableCell>
                  )}
                  {visibleColumns.includes('sponsor_name') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Sponsor</TableCell>
                  )}
                  {visibleColumns.includes('sponsor_party') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Party</TableCell>
                  )}
                  {visibleColumns.includes('sponsor_state') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>State</TableCell>
                  )}
                  {visibleColumns.includes('introduced_date') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Introduced</TableCell>
                  )}
                  {visibleColumns.includes('latest_action_date') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Latest Action</TableCell>
                  )}
                  {visibleColumns.includes('congress') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Congress</TableCell>
                  )}
                  {visibleColumns.includes('bipartisan') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Bipartisan</TableCell>
                  )}
                  {visibleColumns.includes('policy_area') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Policy Area</TableCell>
                  )}
                  {/* Details column is always visible (not selectable) */}
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((bill) => (
                  <TableRow
                    key={bill.bill_id}
                    sx={{
                      backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      '&:hover': {
                        backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedBills.has(bill.bill_id)}
                        onChange={() => toggleBillSelection(bill.bill_id)}
                        sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                      />
                    </TableCell>
                    {visibleColumns.includes('bill_title') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.bill_title || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('bill_type') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.bill_type || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('bill_number') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.bill_number || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('sponsor_name') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.sponsor_full_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('sponsor_party') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.sponsor_party || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('sponsor_state') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.sponsor_state || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('introduced_date') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatDate(bill.introduced_date)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('latest_action_date') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatDate(bill.latest_action_date)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('congress') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.congress ? `${bill.congress}th` : 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('bipartisan') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.bipartisan === 1 ? 'Yes' : bill.bipartisan === 0 ? 'No' : 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('policy_area') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {bill.policy_area || 'N/A'}
                      </TableCell>
                    )}
                    {/* Details column is always visible (not selectable) */}
                    <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBillForDetails(bill);
                          setDetailsDialogOpen(true);
                        }}
                        sx={{
                          color: '#3b82f6',
                          borderColor: '#3b82f6',
                          fontSize: '0.75rem',
                          py: 0.5,
                          px: 1.5,
                          '&:hover': {
                            borderColor: '#60a5fa',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          },
                        }}
                      >
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, flexShrink: 0 }}>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_: React.ChangeEvent<unknown>, page: number) => setCurrentPage(page)}
                size="small"
                sx={{
                  '& .MuiPaginationItem-root': {
                    color: '#9ca3af',
                  },
                  '& .Mui-selected': {
                    backgroundColor: '#3b82f6',
                    color: 'white',
                  },
                }}
              />
            </Box>
          )}

          {/* Load More */}
          {hasMore && !isLoadingMore && filteredResults.length === allResults.length && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, flexShrink: 0 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={handleLoadMore}
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                Load More ({allResults.length} loaded)
              </Button>
            </Box>
          )}
          {isLoadingMore && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, flexShrink: 0 }}>
              <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
            </Box>
          )}
        </Box>
      )}

      {/* Empty state */}
      {filteredResults.length === 0 && !isLoading && !isRestoringPagination && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No results. Click the search icon to configure search parameters.
          </Typography>
        </Box>
      )}

      {/* Search Dialog */}
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
            <GavelIcon />
            <Typography variant="h6">Search Congress Bills</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Box display="flex" flexDirection="column" gap={3} mt={2}>
            {/* Sponsor Name - Multi-select with autocomplete */}
            <MultiSelectField<string>
              label="Sponsor Name"
              selectedItems={(() => {
                const names = Array.isArray(currentSearchParams?.sponsor_name) ? currentSearchParams.sponsor_name : (currentSearchParams?.sponsor_name ? [currentSearchParams.sponsor_name] : []);
                if (!isPoliticianDataLoaded) return names;
                return names.map(name => {
                  const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                  return politician ? politician.displayText : name;
                });
              })()}
              onItemsChange={(sponsors) => {
                const actualNames = sponsors.map(sponsorDisplay => {
                  const nameMatch = sponsorDisplay.match(/^([^(]+)/);
                  return nameMatch ? nameMatch[1].trim() : sponsorDisplay;
                });
                setCurrentSearchParams((prev) => ({ ...prev, sponsor_name: actualNames }));
              }}
              suggestions={isPoliticianDataLoaded ? 
                politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : 
                []
              }
              onSearch={sponsorNameSearch}
              renderItem={(sponsorDisplay) => sponsorDisplay}
              renderOptionCustom={(sponsorDisplay) => {
                const nameMatch = sponsorDisplay.match(/^([^(]+)/);
                const name = nameMatch ? nameMatch[1].trim() : sponsorDisplay;
                const details = sponsorDisplay.replace(name, '').trim();
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
              getItemKey={(sponsor) => sponsor}
              placeholder="Search sponsor names..."
              allowCustomInput={false}
              isLoading={!isPoliticianDataLoaded || sponsorNameLoading}
            />

            {/* Bill Title - Multi-select with autocomplete */}
            <MultiSelectField<string>
              label="Bill Title"
              selectedItems={currentSearchParams?.bill_title || []}
              onItemsChange={(titles) => {
                setCurrentSearchParams((prev) => ({ ...prev, bill_title: titles }));
              }}
              suggestions={[]}
              onSearch={(_query: string) => {
                // Note: MultiSelectField expects synchronous function, but autocomplete API is async
                // For now, return empty array - autocomplete functionality can be added later
                // TODO: Implement state-based autocomplete suggestions or update MultiSelectField to support async
                return [];
              }}
              renderItem={(title) => title}
              placeholder="Search bill titles..."
              allowCustomInput={true}
              isLoading={false}
            />

            {/* Bill Type - Multi-select */}
            <MultiSelectField<string>
              label="Bill Type"
              selectedItems={currentSearchParams?.bill_type || []}
              onItemsChange={(types) => {
                setCurrentSearchParams((prev) => ({ ...prev, bill_type: types }));
              }}
              suggestions={BILL_TYPES}
              renderItem={(type) => type}
              placeholder="Select bill types..."
            />

            {/* Introduced Date From */}
            <TextField
              label="Introduced Date From"
              type="date"
              value={currentSearchParams?.introduced_date_from || ''}
              onChange={(e) => {
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  introduced_date_from: e.target.value || undefined,
                }));
              }}
              InputLabelProps={{ shrink: true }}
              fullWidth
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  color: '#e2e8f0',
                  '& fieldset': { borderColor: '#475569' },
                  '&:hover fieldset': { borderColor: '#64748b' },
                  '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />

            {/* Introduced Date To */}
            <TextField
              label="Introduced Date To"
              type="date"
              value={currentSearchParams?.introduced_date_to || ''}
              onChange={(e) => {
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  introduced_date_to: e.target.value || undefined,
                }));
              }}
              InputLabelProps={{ shrink: true }}
              fullWidth
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  color: '#e2e8f0',
                  '& fieldset': { borderColor: '#475569' },
                  '&:hover fieldset': { borderColor: '#64748b' },
                  '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />

            {/* Policy Area - Multi-select with autocomplete */}
            <MultiSelectField<string>
              label="Policy Area"
              selectedItems={currentSearchParams?.policy_area || []}
              onItemsChange={(areas) => {
                setCurrentSearchParams((prev) => ({ ...prev, policy_area: areas }));
              }}
              suggestions={isPolicyAreaDataLoaded ? 
                policyAreaSuggestionsService.getAllPolicyAreas().slice(0, 50) : 
                []
              }
              onSearch={policyAreaSearch}
              renderItem={(area) => area}
              placeholder="Select policy areas..."
              allowCustomInput={false}
              isLoading={!isPolicyAreaDataLoaded}
            />

            {/* Advanced Search Section */}
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                <Typography variant="subtitle2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  Advanced Search
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={2}>
                  {/* Sponsor Party */}
                  <MultiSelectField<string>
                    label="Sponsor Party"
                    selectedItems={currentSearchParams?.sponsor_party || []}
                    onItemsChange={(parties) => {
                      setCurrentSearchParams((prev) => ({ ...prev, sponsor_party: parties }));
                    }}
                    suggestions={PARTIES}
                    renderItem={(party) => party}
                    placeholder="Select parties..."
                  />

                  {/* Sponsor State */}
                  <MultiSelectField<string>
                    label="Sponsor State"
                    selectedItems={currentSearchParams?.sponsor_state || []}
                    onItemsChange={(states) => {
                      setCurrentSearchParams((prev) => ({ ...prev, sponsor_state: states }));
                    }}
                    suggestions={US_STATES}
                    renderItem={(state) => state}
                    placeholder="Select states..."
                  />

                  {/* Bipartisan */}
                  <FormControl fullWidth>
                    <TextField
                      select
                      label="Bipartisan"
                      value={currentSearchParams?.bipartisan !== undefined ? currentSearchParams.bipartisan : ''}
                      onChange={(e) => {
                        setCurrentSearchParams((prev) => ({
                          ...prev,
                          bipartisan: e.target.value === '' ? undefined : Number(e.target.value),
                        }));
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          backgroundColor: 'rgba(30, 41, 59, 0.5)',
                          color: '#e2e8f0',
                          '& fieldset': { borderColor: '#475569' },
                          '&:hover fieldset': { borderColor: '#64748b' },
                          '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                        },
                        '& .MuiInputLabel-root': { color: '#94a3b8' },
                      }}
                      SelectProps={{
                        MenuProps: {
                          PaperProps: {
                            sx: {
                              backgroundColor: '#334155',
                              '& .MuiMenuItem-root': {
                                color: '#ffffff',
                                '&:hover': { backgroundColor: '#475569' },
                              },
                            },
                          },
                        },
                      }}
                    >
                      <MenuItem value="">All</MenuItem>
                      {BIPARTISAN_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </FormControl>

                  {/* Bill Number */}
                  <TextField
                    label="Bill Number"
                    type="number"
                    value={currentSearchParams?.bill_number || ''}
                    onChange={(e) => {
                      setCurrentSearchParams((prev) => ({
                        ...prev,
                        bill_number: e.target.value ? Number(e.target.value) : undefined,
                      }));
                    }}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& fieldset': { borderColor: '#475569' },
                        '&:hover fieldset': { borderColor: '#64748b' },
                        '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                      },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />

                  {/* Latest Action Date From */}
                  <TextField
                    label="Latest Action Date From"
                    type="date"
                    value={currentSearchParams?.latest_action_date_from || ''}
                    onChange={(e) => {
                      setCurrentSearchParams((prev) => ({
                        ...prev,
                        latest_action_date_from: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& fieldset': { borderColor: '#475569' },
                        '&:hover fieldset': { borderColor: '#64748b' },
                        '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                      },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />

                  {/* Latest Action Date To */}
                  <TextField
                    label="Latest Action Date To"
                    type="date"
                    value={currentSearchParams?.latest_action_date_to || ''}
                    onChange={(e) => {
                      setCurrentSearchParams((prev) => ({
                        ...prev,
                        latest_action_date_to: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& fieldset': { borderColor: '#475569' },
                        '&:hover fieldset': { borderColor: '#64748b' },
                        '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                      },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155' }}>
          <Button 
            onClick={() => {
              setCurrentSearchParams({
                bill_title: [],
                bill_type: [],
                sponsor_name: [],
                introduced_date_from: '',
                introduced_date_to: '',
                policy_area: [],
                sponsor_party: [],
                sponsor_state: [],
                latest_action_date_from: '',
                latest_action_date_to: '',
                bipartisan: undefined,
                bill_number: undefined,
              });
            }}
            sx={{ color: '#9ca3af' }}
          >
            Clear
          </Button>
          <Button onClick={() => setSearchDialogOpen(false)} sx={{ color: '#9ca3af' }}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              performSearch();
              setSearchDialogOpen(false);
            }}
            variant="contained"
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={16} /> : <SearchIcon />}
            sx={{
              backgroundColor: '#3b82f6',
              '&:hover': { backgroundColor: '#2563eb' },
              '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </DialogActions>
      </Dialog>

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
          {(selectedFilters.billTypes.size > 0 || 
            selectedFilters.sponsorParties.size > 0 || 
            selectedFilters.sponsorStates.size > 0 ||
            selectedFilters.policyAreas.size > 0 ||
            selectedFilters.congresses.size > 0 ||
            selectedFilters.bipartisan.size > 0) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
              <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
                Applied Filters:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Array.from(selectedFilters.billTypes).map(billType => (
                  <Chip
                    key={`billType-${billType}`}
                    label={`Bill Type: ${billType}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.billTypes);
                        newSet.delete(billType);
                        return { ...prev, billTypes: newSet };
                      });
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
                {Array.from(selectedFilters.sponsorParties).map(party => (
                  <Chip
                    key={`party-${party}`}
                    label={`Party: ${party}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.sponsorParties);
                        newSet.delete(party);
                        return { ...prev, sponsorParties: newSet };
                      });
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
                {Array.from(selectedFilters.sponsorStates).map(state => (
                  <Chip
                    key={`state-${state}`}
                    label={`State: ${state}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.sponsorStates);
                        newSet.delete(state);
                        return { ...prev, sponsorStates: newSet };
                      });
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
                {Array.from(selectedFilters.policyAreas).map(area => (
                  <Chip
                    key={`area-${area}`}
                    label={`Policy Area: ${area}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.policyAreas);
                        newSet.delete(area);
                        return { ...prev, policyAreas: newSet };
                      });
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
                {Array.from(selectedFilters.congresses).map(congress => (
                  <Chip
                    key={`congress-${congress}`}
                    label={`Congress: ${congress}th`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.congresses);
                        newSet.delete(congress);
                        return { ...prev, congresses: newSet };
                      });
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
                {Array.from(selectedFilters.bipartisan).map(bipartisan => (
                  <Chip
                    key={`bipartisan-${bipartisan}`}
                    label={`Bipartisan: ${bipartisan === 1 ? 'Yes' : 'No'}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.bipartisan);
                        newSet.delete(bipartisan);
                        return { ...prev, bipartisan: newSet };
                      });
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(34, 197, 94, 0.2)',
                      color: '#22c55e',
                      border: '1px solid #22c55e',
                      '& .MuiChip-deleteIcon': { color: '#22c55e' }
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* No Results Message */}
          {availableFilters.billTypes.length === 0 && 
           availableFilters.sponsorParties.length === 0 && 
           availableFilters.sponsorStates.length === 0 &&
           availableFilters.policyAreas.length === 0 &&
           availableFilters.congresses.length === 0 &&
           availableFilters.bipartisan.length === 0 ? (
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
                  '&:before': { display: 'none' },
                  '&.Mui-expanded': { margin: '8px 0' },
                  '&:not(:last-child)': { marginBottom: '8px' },
                },
                '& .MuiAccordionSummary-root': {
                  backgroundColor: '#475569',
                  borderRadius: '4px 4px 0 0',
                  minHeight: '56px',
                  '&.Mui-expanded': { minHeight: '56px', borderRadius: '4px 4px 0 0' },
                  '&:hover': { backgroundColor: '#64748b' },
                },
                '& .MuiAccordionDetails-root': {
                  padding: '16px',
                  backgroundColor: '#334155',
                  borderRadius: '0 0 4px 4px',
                  borderTop: '1px solid #475569',
                },
              }}
            >
              {/* Bill Types Filter */}
              {availableFilters.billTypes.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Bill Types ({availableFilters.billTypes.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.billTypes.map((filter) => (
                        <Box
                          key={filter.billType}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.billTypes.has(filter.billType)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.billTypes);
                            if (newSet.has(filter.billType)) {
                              newSet.delete(filter.billType);
                            } else {
                              newSet.add(filter.billType);
                            }
                            setSelectedFilters(prev => ({ ...prev, billTypes: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.billType}
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
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Sponsor Parties Filter */}
              {availableFilters.sponsorParties.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Sponsor Parties ({availableFilters.sponsorParties.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.sponsorParties.map((filter) => (
                        <Box
                          key={filter.party}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.sponsorParties.has(filter.party)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.sponsorParties);
                            if (newSet.has(filter.party)) {
                              newSet.delete(filter.party);
                            } else {
                              newSet.add(filter.party);
                            }
                            setSelectedFilters(prev => ({ ...prev, sponsorParties: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.party}
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
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Sponsor States Filter */}
              {availableFilters.sponsorStates.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Sponsor States ({availableFilters.sponsorStates.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.sponsorStates.map((filter) => (
                        <Box
                          key={filter.state}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.sponsorStates.has(filter.state)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.sponsorStates);
                            if (newSet.has(filter.state)) {
                              newSet.delete(filter.state);
                            } else {
                              newSet.add(filter.state);
                            }
                            setSelectedFilters(prev => ({ ...prev, sponsorStates: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.state}
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
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Policy Areas Filter */}
              {availableFilters.policyAreas.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Policy Areas ({availableFilters.policyAreas.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.policyAreas.map((filter) => (
                        <Box
                          key={filter.area}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.policyAreas.has(filter.area)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.policyAreas);
                            if (newSet.has(filter.area)) {
                              newSet.delete(filter.area);
                            } else {
                              newSet.add(filter.area);
                            }
                            setSelectedFilters(prev => ({ ...prev, policyAreas: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.area}
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
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Congresses Filter */}
              {availableFilters.congresses.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Congresses ({availableFilters.congresses.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.congresses.map((filter) => (
                        <Box
                          key={filter.congress}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.congresses.has(filter.congress)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.congresses);
                            if (newSet.has(filter.congress)) {
                              newSet.delete(filter.congress);
                            } else {
                              newSet.add(filter.congress);
                            }
                            setSelectedFilters(prev => ({ ...prev, congresses: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.congress}th Congress
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
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Bipartisan Filter */}
              {availableFilters.bipartisan.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Bipartisan ({availableFilters.bipartisan.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.bipartisan.map((filter) => (
                        <Box
                          key={filter.bipartisan}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.bipartisan.has(filter.bipartisan)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.bipartisan);
                            if (newSet.has(filter.bipartisan)) {
                              newSet.delete(filter.bipartisan);
                            } else {
                              newSet.add(filter.bipartisan);
                            }
                            setSelectedFilters(prev => ({ ...prev, bipartisan: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.bipartisan === 1 ? 'Bipartisan' : 'Not Bipartisan'}
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
        <DialogActions sx={{ borderTop: '1px solid #334155' }}>
          <Button 
            onClick={() => {
              setSelectedFilters({
                billTypes: new Set(),
                sponsorParties: new Set(),
                sponsorStates: new Set(),
                policyAreas: new Set(),
                congresses: new Set(),
                bipartisan: new Set(),
              });
            }}
            sx={{ color: '#9ca3af' }}
          >
            Clear All Filters
          </Button>
          <Button onClick={() => setFilterDialogOpen(false)} sx={{ color: '#9ca3af' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

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
          const columnLabels: Record<string, string> = {
            bill_title: 'Bill Title',
            bill_type: 'Bill Type',
            bill_number: 'Bill Number',
            sponsor_name: 'Sponsor Name',
            sponsor_party: 'Sponsor Party',
            sponsor_state: 'Sponsor State',
            introduced_date: 'Introduced Date',
            latest_action_date: 'Latest Action Date',
            congress: 'Congress',
            bipartisan: 'Bipartisan',
            policy_area: 'Policy Area',
            details: 'Details',
          };
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
              {columnLabels[column] || column.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Bill Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
          setSelectedBillForDetails(null);
        }}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
            maxHeight: '90vh',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff', borderBottom: '1px solid #374151', pb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600, mb: 1 }}>
                {selectedBillForDetails?.bill_title || 'Bill Details'}
              </Typography>
              {selectedBillForDetails?.bill_id && (
                <Typography variant="body2" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                  {selectedBillForDetails.bill_id}
                </Typography>
              )}
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent
          sx={{
            mt: 2,
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
          }}
        >
          {selectedBillForDetails && (
            <Box>
              {/* Bill Overview Section */}
              <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {/* Left Column: Sponsor & Bill Info */}
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Sponsor
                      </Typography>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {selectedBillForDetails.sponsor_full_name || 'N/A'}
                      </Typography>
                      {selectedBillForDetails.sponsor_party && selectedBillForDetails.sponsor_state && (
                        <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                          {selectedBillForDetails.sponsor_party} - {selectedBillForDetails.sponsor_state}
                        </Typography>
                      )}
                    </Box>
                    
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Bill Information
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {selectedBillForDetails.bill_type && selectedBillForDetails.bill_number && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Type:</strong> {selectedBillForDetails.bill_type}.{selectedBillForDetails.bill_number}
                          </Typography>
                        )}
                        {selectedBillForDetails.congress && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Congress:</strong> {selectedBillForDetails.congress}
                          </Typography>
                        )}
                        {selectedBillForDetails.policy_area && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Policy Area:</strong> {selectedBillForDetails.policy_area}
                          </Typography>
                        )}
                        {selectedBillForDetails.bipartisan !== undefined && selectedBillForDetails.bipartisan !== null && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Bipartisan:</strong> {selectedBillForDetails.bipartisan === 1 ? 'Yes' : 'No'}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                  
                  {/* Right Column: Dates & Actions */}
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Dates
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {selectedBillForDetails.introduced_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Introduced:</strong> {formatDate(selectedBillForDetails.introduced_date)}
                          </Typography>
                        )}
                        {selectedBillForDetails.latest_action_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Latest Action:</strong> {formatDate(selectedBillForDetails.latest_action_date)}
                          </Typography>
                        )}
                        {(selectedBillForDetails as any).update_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Last Updated:</strong> {formatDate((selectedBillForDetails as any).update_date)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    
                    {(selectedBillForDetails as any).action_count !== undefined && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                          Actions
                        </Typography>
                        <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                          {(selectedBillForDetails as any).action_count || 0} action(s)
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Summary Section */}
              {(selectedBillForDetails as any).summary_text && (
                <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Summary
                  </Typography>
                  <Typography 
                    variant="body1" 
                    sx={{ 
                      color: '#e2e8f0', 
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                    dangerouslySetInnerHTML={{ 
                      __html: (selectedBillForDetails as any).summary_text?.replace(/\n/g, '<br />') || '' 
                    }}
                  />
                </Box>
              )}

              {/* Cosponsors Section */}
              {(selectedBillForDetails as any).cosponsor_count > 0 && (
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Cosponsors ({(selectedBillForDetails as any).cosponsor_count})
                  </Typography>
                  {(selectedBillForDetails as any).cosponsors_json && (() => {
                    try {
                      const cosponsors = JSON.parse((selectedBillForDetails as any).cosponsors_json);
                      return (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {Array.isArray(cosponsors) && cosponsors.map((cosponsor: any, idx: number) => (
                            <Chip
                              key={idx}
                              label={`${cosponsor.fullName || cosponsor.name || 'Unknown'} (${cosponsor.party || ''}-${cosponsor.state || ''})`}
                              sx={{
                                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                color: '#93c5fd',
                                border: '1px solid #3b82f6',
                              }}
                            />
                          ))}
                        </Box>
                      );
                    } catch (e) {
                      const cosponsorsStr = (selectedBillForDetails as any).cosponsors;
                      if (cosponsorsStr) {
                        return (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {cosponsorsStr.split('|').map((name: string, idx: number) => (
                              <Chip
                                key={idx}
                                label={name}
                                sx={{
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                  color: '#93c5fd',
                                  border: '1px solid #3b82f6',
                                }}
                              />
                            ))}
                          </Box>
                        );
                      }
                      return null;
                    }
                  })()}
                </Box>
              )}

              {/* Actions Section */}
              {(selectedBillForDetails as any).actions_json && (() => {
                try {
                  const actions = JSON.parse((selectedBillForDetails as any).actions_json);
                  if (Array.isArray(actions) && actions.length > 0) {
                    return (
                      <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                          Actions ({(selectedBillForDetails as any).action_count || actions.length})
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {actions.map((action: any, idx: number) => (
                            <Box
                              key={idx}
                              sx={{
                                p: 2,
                                backgroundColor: 'rgba(30, 41, 59, 0.5)',
                                borderRadius: '4px',
                                border: '1px solid #374151',
                              }}
                            >
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                <Typography variant="body2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                                  {action.actionDate && formatDate(action.actionDate)}
                                </Typography>
                                {action.type && (
                                  <Chip
                                    label={action.type}
                                    size="small"
                                    sx={{
                                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                      color: '#93c5fd',
                                      border: '1px solid #3b82f6',
                                    }}
                                  />
                                )}
                              </Box>
                              {action.text && (
                                <Typography variant="body1" sx={{ color: '#e2e8f0', mt: 1 }}>
                                  {action.text}
                                </Typography>
                              )}
                              {action.committees && Array.isArray(action.committees) && action.committees.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                    Committees:
                                  </Typography>
                                  {action.committees.map((committee: any, cIdx: number) => (
                                    <Typography key={cIdx} variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                                      • {committee.name || committee.systemCode}
                                    </Typography>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    );
                  }
                } catch (e) {
                  // If parsing fails, show the summary text
                  if ((selectedBillForDetails as any).actions_summary) {
                    return (
                      <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                          Actions Summary
                        </Typography>
                        <Typography variant="body1" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                          {(selectedBillForDetails as any).actions_summary}
                        </Typography>
                      </Box>
                    );
                  }
                }
                return null;
              })()}

              {/* Additional Details */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                  Additional Information
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  {(selectedBillForDetails as any).origin_chamber && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Origin Chamber
                      </Typography>
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        {(selectedBillForDetails as any).origin_chamber}
                      </Typography>
                    </Box>
                  )}
                  {(selectedBillForDetails as any).amendment_count !== undefined && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Amendments
                      </Typography>
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        {(selectedBillForDetails as any).amendment_count || 0}
                      </Typography>
                    </Box>
                  )}
                  {(selectedBillForDetails as any).bill_url && (
                    <Box sx={{ gridColumn: 'span 2' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Bill URL
                      </Typography>
                      <Typography
                        variant="body2"
                        component="a"
                        href={(selectedBillForDetails as any).bill_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{
                          color: '#3b82f6',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {(selectedBillForDetails as any).bill_url}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => {
              setDetailsDialogOpen(false);
              setSelectedBillForDetails(null);
            }}
            sx={{
              color: '#94a3b8',
              '&:hover': {
                backgroundColor: 'rgba(71, 85, 105, 0.1)',
              },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          }
        }}
      >
        <MenuItem
          onClick={() => handleAddToContext('new')}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <NewChatIcon sx={{ mr: 1, fontSize: 18, color: '#10b981' }} />
          Add to New Chat
        </MenuItem>
        <MenuItem
          onClick={() => handleAddToContext('sidebar')}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Current Sidebar Chat
        </MenuItem>
      </Menu>

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'Congress Bills'}
        currentColor={customColor}
        currentIcon={customIcon}
      />
    </Box>
  );
};

// Custom comparison function for memo - matches SEC tile pattern but with optimization
const CongressBillsSearchTileMemo = memo(CongressBillsSearchTile, (prevProps, nextProps) => {
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
    if (prevDisplay.showBillTitle !== nextDisplay.showBillTitle ||
        prevDisplay.showBillType !== nextDisplay.showBillType ||
        prevDisplay.showSponsorName !== nextDisplay.showSponsorName ||
        prevDisplay.showIntroducedDate !== nextDisplay.showIntroducedDate ||
        prevDisplay.showCongress !== nextDisplay.showCongress ||
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

CongressBillsSearchTileMemo.displayName = 'CongressBillsSearchTile';

export default CongressBillsSearchTileMemo;

