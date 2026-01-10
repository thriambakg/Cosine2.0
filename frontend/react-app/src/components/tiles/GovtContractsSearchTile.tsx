import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
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
  AutoAwesome as AutoRefreshIcon,
  Search as SearchIcon,
  AccountBalance as GovernmentIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { 
  govtContractsSearchAPI, 
  govtContractsAutocompleteAPI,
  GovtContractsSearchFilters,
  GovtContractAward 
} from '../../services/api';
import { filesystemAPI } from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, addAwardToContext, addMultipleAwardsToContext, confirmDialog, getIconByName, getDefaultIconForTileType } from './common';
import MultiSelectField from '../MultiSelectField';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';

// US States
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

interface GovtContractsSearchTileProps {
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
  // Govt contracts specific props
  searchParams?: GovtContractsSearchFilters;
  filterSettings?: {
    awardTypes?: string[];
    agencies?: string[];
    recipients?: string[];
    states?: string[];
    countries?: string[];
    naics?: string[];
    psc?: string[];
    cfda?: string[];
    months?: number[];
  };
  results?: GovtContractAward[];
  displayOptions?: {
    showRecipient: boolean;
    showAwardingAgency: boolean;
    showFundingAgency: boolean;
    showAmount: boolean;
    showPeriodStartDate: boolean;
    showPeriodEndDate: boolean;
    showNaicsCode: boolean;
    showPscCode: boolean;
    showLastUpdated: boolean;
    // Note: showActions removed - actions column is always visible
    showResultsTable: boolean;
    maxResults: number;
    compactView: boolean;
  };
  paginationState?: {
    totalResultsLoaded?: number;
    pageCount?: number;
    lastEvaluatedKeys: any[];
    hasMore: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const GovtContractsSearchTile: React.FC<GovtContractsSearchTileProps> = ({
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
    keywords: [],
    award_type: [],
    awarding_agency_name: [],
    funding_agency_name: [],
    recipient_name: [],
    recipient_location_state: [],
    recipient_zip_code: [],
    naics_code: [],
    psc_code: [],
    cfda_number: [],
    date_year: undefined,
    // Don't include legacy date_from/date_to - they're no longer used
  },
  filterSettings: initialFilterSettings,
  paginationState: initialPaginationState,
  results = [],
  displayOptions = {
    showRecipient: true,
    showAwardingAgency: true,
    showFundingAgency: true,
    showAmount: true,
    showPeriodStartDate: false,
    showPeriodEndDate: false,
    showNaicsCode: false,
    showPscCode: false,
    showLastUpdated: true,
    // Note: showActions removed - actions column is always visible
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
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const { user } = useAuth();
  const { isEasyMode } = useEasyMode();
  const { openItemDetails } = useDialogManagerHelpers();
  
  // Filter state for client-side filtering - restore from props if available (session persistence)
  const [allResults, setAllResults] = useState<GovtContractAward[]>(results || []);
  const [filteredResults, setFilteredResults] = useState<GovtContractAward[]>(results || []);
  const [selectedFilters, setSelectedFilters] = useState<{
    awardTypes: Set<string>;
    agencies: Set<string>;
    recipients: Set<string>;
    states: Set<string>;
    countries: Set<string>;
    naics: Set<string>;
    psc: Set<string>;
    cfda: Set<string>;
    months: Set<number>;
  }>({
    awardTypes: new Set(initialFilterSettings?.awardTypes || []),
    agencies: new Set(initialFilterSettings?.agencies || []),
    recipients: new Set(initialFilterSettings?.recipients || []),
    states: new Set(initialFilterSettings?.states || []),
    countries: new Set(initialFilterSettings?.countries || []),
    naics: new Set(initialFilterSettings?.naics || []),
    psc: new Set(initialFilterSettings?.psc || []),
    cfda: new Set(initialFilterSettings?.cfda || []),
    months: new Set(initialFilterSettings?.months || []),
  });

  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchParams, setCurrentSearchParams] = useState<GovtContractsSearchFilters>({
    ...searchParams,
  });
  const [currentResults, setCurrentResults] = useState<GovtContractAward[]>(results);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>([]);
  const [isRestoringPagination, setIsRestoringPagination] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  
  const defaultDisplayOptions = {
    showRecipient: true,
    showAwardingAgency: true,
    showFundingAgency: true,
    showAmount: true,
    showPeriodStartDate: false,
    showPeriodEndDate: false,
    showNaicsCode: false,
    showPscCode: false,
    showLastUpdated: true,
    // Note: showActions removed - actions column is always visible
    showResultsTable: true,
    maxResults: 50,
    compactView: false,
  };
  
  // Display options state - use useMemo like CongressBillsSearchTile so it auto-updates when displayOptions prop changes
  const localDisplayOptions = useMemo(() => {
    const computed = {
      ...defaultDisplayOptions,
      ...displayOptions
    };
    return computed;
  }, [displayOptions]);

  // Column visibility state - using array of strings like parent page
  // Note: 'actions' is always visible and not selectable (like SEC tile)
  const AVAILABLE_COLUMNS = [
    'recipient',
    'awarding_agency',
    'funding_agency',
    'recipient_location',
    'amount',
    'period_start_date',
    'period_end_date',
    'naics_code',
    'psc_code',
    'last_updated',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['recipient', 'awarding_agency', 'funding_agency', 'amount', 'last_updated'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    // Convert display options to column array
    const cols: string[] = [];
    if (localDisplayOptions.showRecipient) cols.push('recipient');
    if (localDisplayOptions.showAwardingAgency) cols.push('awarding_agency');
    if (localDisplayOptions.showFundingAgency) cols.push('funding_agency');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showPeriodStartDate) cols.push('period_start_date');
    if (localDisplayOptions.showPeriodEndDate) cols.push('period_end_date');
    if (localDisplayOptions.showNaicsCode) cols.push('naics_code');
    if (localDisplayOptions.showPscCode) cols.push('psc_code');
    if (localDisplayOptions.showLastUpdated) cols.push('last_updated');
    // Note: 'actions' column is always visible, not included in visibleColumns array
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
        showRecipient: newColumns.includes('recipient'),
        showAwardingAgency: newColumns.includes('awarding_agency'),
        showFundingAgency: newColumns.includes('funding_agency'),
        showAmount: newColumns.includes('amount'),
        showPeriodStartDate: newColumns.includes('period_start_date'),
        showPeriodEndDate: newColumns.includes('period_end_date'),
        showNaicsCode: newColumns.includes('naics_code'),
        showPscCode: newColumns.includes('psc_code'),
        showLastUpdated: newColumns.includes('last_updated'),
        // Note: showActions removed - actions column is always visible
      };
      // Update via onSettingsChange - this will update props, which will update localDisplayOptions via useMemo
      onSettingsChange(id, { displayOptions: newDisplayOptions });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);

  // Sync visibleColumns with localDisplayOptions when it changes (from props or internal updates)
  useEffect(() => {
    const cols: string[] = [];
    if (localDisplayOptions.showRecipient) cols.push('recipient');
    if (localDisplayOptions.showAwardingAgency) cols.push('awarding_agency');
    if (localDisplayOptions.showFundingAgency) cols.push('funding_agency');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showPeriodStartDate) cols.push('period_start_date');
    if (localDisplayOptions.showPeriodEndDate) cols.push('period_end_date');
    if (localDisplayOptions.showNaicsCode) cols.push('naics_code');
    if (localDisplayOptions.showPscCode) cols.push('psc_code');
    if (localDisplayOptions.showLastUpdated) cols.push('last_updated');
    // Note: 'actions' column is always visible, not included in visibleColumns array
    const syncedColumns = cols.length > 0 ? cols : DEFAULT_VISIBLE_COLUMNS;
    
    setVisibleColumns(prev => {
      const prevSorted = [...prev].sort();
      const syncedSorted = [...syncedColumns].sort();
      const match = JSON.stringify(prevSorted) === JSON.stringify(syncedSorted);
      
      if (!match) {
        return syncedColumns;
      }
      return prev;
    });
  }, [localDisplayOptions.showRecipient, localDisplayOptions.showAwardingAgency, localDisplayOptions.showFundingAgency, localDisplayOptions.showAmount, localDisplayOptions.showPeriodStartDate, localDisplayOptions.showPeriodEndDate, localDisplayOptions.showNaicsCode, localDisplayOptions.showPscCode, localDisplayOptions.showLastUpdated]); // Depend on individual properties to avoid object reference issues

  // const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`govtContracts_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const [isPageSizeManuallySet] = useState(() => {
    return localStorage.getItem(`govtContracts_pageSize_${id}`) !== null;
  });
  const tileRef = useRef<HTMLDivElement>(null);

  // Autocomplete state
  const [recipientSuggestions, setRecipientSuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const [awardingAgencySuggestions, setAwardingAgencySuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const [fundingAgencySuggestions, setFundingAgencySuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  
  const [recipientLoading, setRecipientLoading] = useState<boolean>(false);
  const [awardingAgencyLoading, setAwardingAgencyLoading] = useState<boolean>(false);
  const [fundingAgencyLoading, setFundingAgencyLoading] = useState<boolean>(false);
  
  const recipientSuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const awardingAgencySuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const fundingAgencySuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  
  const latestRecipientSearchRef = useRef<number>(0);
  const latestAwardingAgencySearchRef = useRef<number>(0);
  const latestFundingAgencySearchRef = useRef<number>(0);
  
  const lastRecipientQueryRef = useRef<string>('');
  const lastAwardingAgencyQueryRef = useRef<string>('');
  const lastFundingAgencyQueryRef = useRef<string>('');

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

  // Transform API response to match expected format
  const transformAutocompleteResults = useCallback((results: any[], type: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    return results.map((item: any) => {
      if (type === 'recipient' && item.recipient_name) {
        return {
          ...item,
          name: item.recipient_name,
          text: item.recipient_name,
          id: item.uei || item.duns || item.recipient_name,
        };
      }
      return item;
    });
  }, []);

  // Autocomplete search functions
  const recipientSearch = useCallback((query: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    if (!query || query.length < 2) {
      setRecipientSuggestions([]);
      recipientSuggestionsRef.current = [];
      lastRecipientQueryRef.current = '';
      setRecipientLoading(false);
      return [];
    }

    if (lastRecipientQueryRef.current !== query) {
      setRecipientSuggestions([]);
      recipientSuggestionsRef.current = [];
    }

    const searchTimestamp = Date.now();
    latestRecipientSearchRef.current = searchTimestamp;
    lastRecipientQueryRef.current = query;

    setRecipientLoading(true);

    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'recipient',
          search_text: query,
          limit: 10,
        });

        if (latestRecipientSearchRef.current === searchTimestamp && response.success && response.results) {
          const transformedResults = transformAutocompleteResults(response.results, 'recipient');
          setRecipientSuggestions(transformedResults);
          recipientSuggestionsRef.current = transformedResults;
        }
      } catch (error) {
        if (latestRecipientSearchRef.current === searchTimestamp) {
          console.error(`Error loading autocomplete for recipient:`, error);
          setRecipientSuggestions([]);
          recipientSuggestionsRef.current = [];
        }
      } finally {
        if (latestRecipientSearchRef.current === searchTimestamp) {
          setRecipientLoading(false);
        }
      }
    })();

    return [];
  }, [transformAutocompleteResults]);

  const awardingAgencySearch = useCallback((query: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    if (!query || query.length < 2) {
      setAwardingAgencySuggestions([]);
      awardingAgencySuggestionsRef.current = [];
      lastAwardingAgencyQueryRef.current = '';
      setAwardingAgencyLoading(false);
      return [];
    }

    if (lastAwardingAgencyQueryRef.current !== query) {
      setAwardingAgencySuggestions([]);
      awardingAgencySuggestionsRef.current = [];
    }

    const searchTimestamp = Date.now();
    latestAwardingAgencySearchRef.current = searchTimestamp;
    lastAwardingAgencyQueryRef.current = query;

    setAwardingAgencyLoading(true);

    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'awarding_agency',
          search_text: query,
          limit: 10,
        });

        if (latestAwardingAgencySearchRef.current === searchTimestamp && response.success && response.results) {
          const transformedResults = transformAutocompleteResults(response.results, 'awarding_agency');
          setAwardingAgencySuggestions(transformedResults);
          awardingAgencySuggestionsRef.current = transformedResults;
        }
      } catch (error) {
        if (latestAwardingAgencySearchRef.current === searchTimestamp) {
          console.error(`Error loading autocomplete for awarding_agency:`, error);
          setAwardingAgencySuggestions([]);
          awardingAgencySuggestionsRef.current = [];
        }
      } finally {
        if (latestAwardingAgencySearchRef.current === searchTimestamp) {
          setAwardingAgencyLoading(false);
        }
      }
    })();

    return [];
  }, [transformAutocompleteResults]);

  const fundingAgencySearch = useCallback((query: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    if (!query || query.length < 2) {
      setFundingAgencySuggestions([]);
      fundingAgencySuggestionsRef.current = [];
      lastFundingAgencyQueryRef.current = '';
      setFundingAgencyLoading(false);
      return [];
    }

    if (lastFundingAgencyQueryRef.current !== query) {
      setFundingAgencySuggestions([]);
      fundingAgencySuggestionsRef.current = [];
    }

    const searchTimestamp = Date.now();
    latestFundingAgencySearchRef.current = searchTimestamp;
    lastFundingAgencyQueryRef.current = query;

    setFundingAgencyLoading(true);

    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'funding_agency',
          search_text: query,
          limit: 10,
        });

        if (latestFundingAgencySearchRef.current === searchTimestamp && response.success && response.results) {
          const transformedResults = transformAutocompleteResults(response.results, 'funding_agency');
          setFundingAgencySuggestions(transformedResults);
          fundingAgencySuggestionsRef.current = transformedResults;
        }
      } catch (error) {
        if (latestFundingAgencySearchRef.current === searchTimestamp) {
          console.error(`Error loading autocomplete for funding_agency:`, error);
          setFundingAgencySuggestions([]);
          fundingAgencySuggestionsRef.current = [];
        }
      } finally {
        if (latestFundingAgencySearchRef.current === searchTimestamp) {
          setFundingAgencyLoading(false);
        }
      }
    })();

    return [];
  }, [transformAutocompleteResults]);

  // Helper function to find option by name
  const findOptionByName = useCallback((
    name: string,
    type: 'recipient' | 'awarding_agency' | 'funding_agency'
  ): { id?: string; code?: string; name?: string; text?: string; [key: string]: any } | undefined => {
    let suggestions: Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> = [];
    
    switch (type) {
      case 'recipient':
        suggestions = recipientSuggestions;
        break;
      case 'awarding_agency':
        suggestions = awardingAgencySuggestions;
        break;
      case 'funding_agency':
        suggestions = fundingAgencySuggestions;
        break;
    }
    
    return suggestions.find(opt => opt.name === name || opt.text === name);
  }, [recipientSuggestions, awardingAgencySuggestions, fundingAgencySuggestions]);

  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('🏛️ GovtContractsSearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    try {
      const filters: any = {
        ...currentSearchParams,
      };

      // Remove legacy date fields (date_from, date_to) - use date_year instead
      delete filters.date_from;
      delete filters.date_to;

      // Remove empty arrays, empty strings, null, and undefined
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        } else if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
        // Also explicitly remove legacy date fields if they somehow got through
        if (key === 'date_from' || key === 'date_to') {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        limit: 25,
      };
      
      const response = await govtContractsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('🏛️ GovtContractsSearchTile: Retrieved', response.results.length, 'awards');
        
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(response.results);
        setFilteredResults(response.results);
        setCurrentResults(response.results);
        setHasPerformedInitialSearch(true);
        
        // Limit pagination to 4 pages total (1 initial + 3 more)
        const MAX_PAGES = 4;
        const MAX_PAGINATION_KEYS = MAX_PAGES - 1; // 3 keys for pages 2, 3, 4
        
        // Only allow hasMore if we haven't reached the page limit
        const canLoadMore = response.has_more && newLastEvaluatedKey !== null;
        const hasReachedPageLimit = false; // Initial page, we haven't loaded any additional pages yet
        
        setHasMore(canLoadMore && !hasReachedPageLimit);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Store pagination state - limit to MAX_PAGINATION_KEYS
        const newLastEvaluatedKeys = newLastEvaluatedKey ? [newLastEvaluatedKey].slice(0, MAX_PAGINATION_KEYS) : [];
        setLastEvaluatedKeys(newLastEvaluatedKeys);
        
        // Persist searchParams and pagination state (max 4 pages)
        const pageCount = 1; // Initial page
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            pageCount: pageCount,
            lastEvaluatedKeys: newLastEvaluatedKeys,
            hasMore: canLoadMore && !hasReachedPageLimit,
          },
        });
        
        // Update parent component with pagination metadata
        onUpdate(id, {
          paginationState: {
            pageCount: pageCount,
            lastEvaluatedKeys: newLastEvaluatedKeys,
            hasMore: canLoadMore && !hasReachedPageLimit,
          },
          lastUpdated: Date.now(),
        });
      } else {
        console.error('🏛️ GovtContractsSearchTile: Search failed');
        setError('Search failed');
        setCurrentResults([]);
        setHasMore(false);
        setHasPerformedInitialSearch(true);
        setLastEvaluatedKeys([]);
        // Clear pagination state
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            pageCount: 0,
            lastEvaluatedKeys: [],
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('🏛️ GovtContractsSearchTile: Search error:', err);
      setError(err.message || 'An error occurred during search');
      setCurrentResults([]);
      setHasPerformedInitialSearch(true);
      setHasMore(false);
      setLastEvaluatedKeys([]);
      // Clear pagination state on error
      onSettingsChange(id, {
        searchParams: currentSearchParams,
        paginationState: {
          pageCount: 0,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, onSettingsChange]);
  
  // Load more results - limited to 4 pages total
  const handleLoadMore = useCallback(async () => {
    const MAX_PAGES = 4;
    const MAX_PAGINATION_KEYS = MAX_PAGES - 1; // 3 keys for pages 2, 3, 4
    
    // Check if we've reached the page limit
    const currentPageCount = lastEvaluatedKeys.length + 1; // +1 for initial page
    const hasReachedPageLimit = currentPageCount >= MAX_PAGES;
    
    if (!hasMore || !lastEvaluatedKey || isLoadingMore || !currentSearchParams || hasReachedPageLimit) {
      if (hasReachedPageLimit) {
        console.log('🏛️ GovtContractsSearchTile: Reached maximum page limit (4 pages)');
      }
      return;
    }
    
    setIsLoadingMore(true);
    setError(null);
    
    try {
      const filters: any = {
        ...currentSearchParams,
      };

      // Remove legacy date fields (date_from, date_to) - use date_year instead
      delete filters.date_from;
      delete filters.date_to;

      // Remove empty arrays, empty strings, null, and undefined
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        } else if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
        // Also explicitly remove legacy date fields if they somehow got through
        if (key === 'date_from' || key === 'date_to') {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        limit: 25,
        last_evaluated_key: lastEvaluatedKey,
      };
      
      const response = await govtContractsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        const updatedResults = [...allResults, ...response.results];
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        const newPageCount = currentPageCount + 1; // Increment page count
        
        // Check if we've reached the page limit after loading this page
        const willReachPageLimit = newPageCount >= MAX_PAGES;
        
        setAllResults(updatedResults);
        setFilteredResults(updatedResults);
        setCurrentResults(updatedResults);
        
        // Only allow hasMore if backend says there's more AND we haven't reached the page limit
        setHasMore(response.has_more && !willReachPageLimit && newLastEvaluatedKey !== null);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Update lastEvaluatedKeys array - limit to MAX_PAGINATION_KEYS (3 keys)
        const updatedKeys = newLastEvaluatedKey 
          ? [...lastEvaluatedKeys, newLastEvaluatedKey].slice(0, MAX_PAGINATION_KEYS) // Keep only first 3 keys
          : lastEvaluatedKeys;
        setLastEvaluatedKeys(updatedKeys);
        
        // Persist pagination state (max 4 pages)
        onSettingsChange(id, {
          paginationState: {
            pageCount: newPageCount,
            lastEvaluatedKeys: updatedKeys,
            hasMore: response.has_more && !willReachPageLimit && newLastEvaluatedKey !== null,
          },
        });
        
        onUpdate(id, {
          paginationState: {
            pageCount: newPageCount,
            lastEvaluatedKeys: updatedKeys,
            hasMore: response.has_more && !willReachPageLimit && newLastEvaluatedKey !== null,
          },
          lastUpdated: Date.now(),
        });
        
        if (willReachPageLimit) {
          console.log('🏛️ GovtContractsSearchTile: Reached maximum page limit (4 pages) after loading');
        }
      } else {
        console.error('🏛️ GovtContractsSearchTile: Load more failed');
        setError('Load more failed');
        setHasMore(false);
        // Update pagination state to reflect no more results
        onSettingsChange(id, {
          paginationState: {
            pageCount: currentPageCount,
            lastEvaluatedKeys: lastEvaluatedKeys,
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('🏛️ GovtContractsSearchTile: Load more error:', err);
      setError(err.message || 'An error occurred while loading more results');
      setHasMore(false);
      // Preserve current pagination state on error
      onSettingsChange(id, {
        paginationState: {
          pageCount: currentPageCount,
          lastEvaluatedKeys: lastEvaluatedKeys,
          hasMore: false,
        },
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange]);

  // Restore pagination state on mount - limited to 4 pages
  const restorePaginationState = useCallback(async () => {
    const MAX_PAGES = 4;
    const MAX_PAGINATION_KEYS = MAX_PAGES - 1; // 3 keys for pages 2, 3, 4
    
    if (!paginationState || !paginationState.lastEvaluatedKeys || paginationState.lastEvaluatedKeys.length === 0) {
      return;
    }

    // If we already have results from a previous page, we're good
    if (results && results.length > 0) {
      return;
    }

    // Limit to MAX_PAGES
    const savedPageCount = paginationState.pageCount || 0;
    const pageCountToRestore = Math.min(savedPageCount, MAX_PAGES);
    const keysToRestore = paginationState.lastEvaluatedKeys.slice(0, MAX_PAGINATION_KEYS);

    console.log('🔄 GovtContractsSearchTile: Restoring pagination state (page-based, max 4 pages)', {
      savedPageCount: savedPageCount,
      pageCountToRestore: pageCountToRestore,
      keysToRestore: keysToRestore.length,
    });

    setIsRestoringPagination(true);
    setIsLoading(true);
    setError(null);

    try {
      let currentResults: any[] = [];
      let currentPageCount = 0;
      
      // Load the initial page first
      if (currentSearchParams && pageCountToRestore > 0) {
        const filters: any = { ...currentSearchParams };
        
        // Remove legacy date fields (date_from, date_to) - use date_year instead
        delete filters.date_from;
        delete filters.date_to;
        
        Object.keys(filters).forEach((key) => {
          const value = filters[key];
          if (Array.isArray(value) && value.length === 0) {
            delete filters[key];
          } else if (value === '' || value === null || value === undefined) {
            delete filters[key];
          }
        });
        
        // Load the initial page (no pagination key)
        const initialSearchRequest = {
          filters,
          limit: 25,
        };
        
        const initialResponse = await govtContractsSearchAPI.search(initialSearchRequest);
        
        if (initialResponse.success && initialResponse.results) {
          currentResults = [...initialResponse.results];
          currentPageCount = 1;
        }
      }

      // Load continuation pages up to the saved page count (max 4 pages)
      for (const nextKey of keysToRestore) {
        if (!currentSearchParams || currentPageCount >= MAX_PAGES) break;
        
        const filters: any = { ...currentSearchParams };
        
        // Remove legacy date fields
        delete filters.date_from;
        delete filters.date_to;
        
        Object.keys(filters).forEach((key) => {
          const value = filters[key];
          if (Array.isArray(value) && value.length === 0) {
            delete filters[key];
          } else if (value === '' || value === null || value === undefined) {
            delete filters[key];
          }
        });
        
        const searchRequest = {
          filters,
          limit: 25,
          last_evaluated_key: nextKey,
        };
        
        const response = await govtContractsSearchAPI.search(searchRequest);
        
        if (response.success && response.results && response.results.length > 0) {
          currentResults = [...currentResults, ...response.results];
          currentPageCount += 1;
        } else {
          // No more results, stop loading
          break;
        }
      }
      
      // Determine hasMore based on restored state and page limit
      const hasReachedPageLimit = currentPageCount >= MAX_PAGES;
      const lastKey = keysToRestore[keysToRestore.length - 1] || null;
      const restoredHasMore = paginationState.hasMore && !hasReachedPageLimit && lastKey !== null;
      
      // Update state with restored results
      setAllResults(currentResults);
      setFilteredResults(currentResults);
      setCurrentResults(currentResults);
      setLastEvaluatedKeys(keysToRestore);
      setLastEvaluatedKey(lastKey);
      setHasMore(restoredHasMore);
      setHasPerformedInitialSearch(true);
      
      console.log('✅ GovtContractsSearchTile: Pagination restoration complete', {
        pagesRestored: currentPageCount,
        maxPages: MAX_PAGES,
        resultsCount: currentResults.length,
        hasMore: restoredHasMore,
      });
      
      // Update tile with restored pagination state
      onUpdate(id, {
        paginationState: {
          pageCount: currentPageCount,
          lastEvaluatedKeys: keysToRestore,
          hasMore: restoredHasMore,
        },
        lastUpdated: Date.now(),
      });
    } catch (err) {
      console.error('❌ GovtContractsSearchTile: Error restoring pagination state', err);
      setError('Failed to restore previous results. Please refresh.');
    } finally {
      setIsRestoringPagination(false);
      setIsLoading(false);
    }
  }, [paginationState, results, currentSearchParams, id, onUpdate]);

  // Restore pagination state on mount if needed (max 4 pages)
  useEffect(() => {
    if (paginationState && paginationState.pageCount !== undefined && paginationState.pageCount > 0 && paginationState.pageCount <= 4 && !isRestoringPagination && !isLoading) {
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
      console.log('🔄 GovtContractsSearchTile: Restoring', results.length, 'results from session');
      setAllResults(results);
      setFilteredResults(results);
      setCurrentResults(results);
      setHasPerformedInitialSearch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Preview mode: Run fresh query when opened in preview ONLY if no pagination state exists
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      // Skip fresh query if tile already has pagination state (preserve "load more +X" state)
      if (paginationState && paginationState.totalResultsLoaded !== undefined && paginationState.totalResultsLoaded > 0) {
        console.log('🔄 GovtContractsSearchTile: Preview mode - preserving existing pagination state (totalResultsLoaded:', paginationState.totalResultsLoaded, ')');
        return;
      }
      
      const hasSearchCriteria = 
        (currentSearchParams.awarding_agency_name && currentSearchParams.awarding_agency_name.length > 0) ||
        (currentSearchParams.funding_agency_name && currentSearchParams.funding_agency_name.length > 0) ||
        (currentSearchParams.recipient_name && currentSearchParams.recipient_name.length > 0) ||
        (currentSearchParams.award_type && currentSearchParams.award_type.length > 0) ||
        (currentSearchParams.naics_code && currentSearchParams.naics_code.length > 0) ||
        (currentSearchParams.psc_code && currentSearchParams.psc_code.length > 0) ||
        (currentSearchParams.cfda_number && currentSearchParams.cfda_number.length > 0) ||
        currentSearchParams.date_year ||
        currentSearchParams.date_from ||  // Legacy
        currentSearchParams.date_to;  // Legacy
      
      if (hasSearchCriteria) {
        console.log('🔄 GovtContractsSearchTile: Preview mode - running fresh query (no pagination state)');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading && !isRestoringPagination) {
      const hasSearchCriteria = 
        (currentSearchParams.awarding_agency_name && currentSearchParams.awarding_agency_name.length > 0) ||
        (currentSearchParams.funding_agency_name && currentSearchParams.funding_agency_name.length > 0) ||
        (currentSearchParams.recipient_name && currentSearchParams.recipient_name.length > 0) ||
        (currentSearchParams.award_type && currentSearchParams.award_type.length > 0) ||
        (currentSearchParams.naics_code && currentSearchParams.naics_code.length > 0) ||
        (currentSearchParams.psc_code && currentSearchParams.psc_code.length > 0) ||
        (currentSearchParams.cfda_number && currentSearchParams.cfda_number.length > 0) ||
        currentSearchParams.date_year ||
        currentSearchParams.date_from ||  // Legacy
        currentSearchParams.date_to;  // Legacy
      
      if (hasSearchCriteria) {
        console.log('🔄 GovtContractsSearchTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch]);

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Government Contracts Tile from dashboard?',
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
    if (selectedAwards.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedAwards.size === 0) return;
    
    try {
      const selectedAwardObjects = currentResults.filter(award => 
        selectedAwards.has(award.award_id)
      );

      // Save all awards to the filesystem with FULL data using bulk operation
      // Note: currentResults contains the full award objects from the search API
      // This ensures we save the complete award with all fields
      const items = selectedAwardObjects.map(award => {
        const title = award.recipient_name 
          ? `Government Contract - ${award.recipient_name}${award.awarding_agency_name ? ` / ${award.awarding_agency_name}` : ''}`
          : `Government Contract ${award.award_id || ''}`;
        return {
          context_data: award, // Full award object with all fields
          title: title,
          item_type: 'govt_contract' as const,
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
        console.log(`✅ Saved ${result?.succeeded || selectedAwardObjects.length} of ${selectedAwardObjects.length} award(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} award(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save awards');
      }
      setSelectedAwards(new Set());
    } catch (error) {
      console.error('Error saving awards to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedAwardObjects = currentResults.filter(award => 
      selectedAwards.has(award.award_id)
    );

    if (selectedAwardObjects.length === 0) return;

    if (selectedAwardObjects.length === 1) {
      addAwardToContext(selectedAwardObjects[0]);
    } else {
      addMultipleAwardsToContext(selectedAwardObjects);
    }

    setSelectedAwards(new Set());
    handleContextMenuClose();
  };

  
  const handleRefresh = () => {
    performSearch();
  };

  // Handle award enrichment - update the award in tile results
  const handleAwardEnrichment = useCallback((enrichedAward: GovtContractAward) => {
    console.log('🔄 GovtContractsSearchTile: Award enriched, updating results', {
      award_id: enrichedAward.award_id,
      transactions_count: enrichedAward.transactions?.length || 0,
      subawards_count: enrichedAward.subawards?.length || 0,
      transaction_count_field: enrichedAward.transaction_count,
      subaward_count_field: enrichedAward.subaward_count,
    });
    
    // Update the award in allResults, filteredResults, and currentResults
    const updateAwardInArray = (arr: GovtContractAward[]) => {
      return arr.map(award => {
        if (award.award_id === enrichedAward.award_id) {
          // Merge enriched data with existing award data
          // This ensures we preserve all fields and update transactions/subawards
          const updatedAward = {
            ...award,
            ...enrichedAward,
            // Explicitly update transactions and subawards arrays
            transactions: enrichedAward.transactions || award.transactions || [],
            subawards: enrichedAward.subawards || award.subawards || [],
            transaction_count: enrichedAward.transaction_count ?? award.transaction_count,
            subaward_count: enrichedAward.subaward_count ?? award.subaward_count,
          };
          console.log('🔄 GovtContractsSearchTile: Updating award in array', {
            award_id: updatedAward.award_id,
            old_transactions: award.transactions?.length || 0,
            new_transactions: updatedAward.transactions?.length || 0,
            old_subawards: award.subawards?.length || 0,
            new_subawards: updatedAward.subawards?.length || 0,
          });
          return updatedAward;
        }
        return award;
      });
    };
    
    setAllResults(prev => {
      const updated = updateAwardInArray(prev);
      console.log('✅ GovtContractsSearchTile: Updated allResults', {
        total_awards: updated.length,
        updated_award_index: updated.findIndex(a => a.award_id === enrichedAward.award_id),
      });
      return updated;
    });
    setFilteredResults(prev => updateAwardInArray(prev));
    setCurrentResults(prev => updateAwardInArray(prev));
    
    console.log('✅ GovtContractsSearchTile: Award updated in tile results', {
      award_id: enrichedAward.award_id,
      transactions_count: enrichedAward.transactions?.length || 0,
      subawards_count: enrichedAward.subawards?.length || 0,
    });
  }, []);


  // Client-side filtering function
  const applyFilters = useCallback(() => {
    let filtered = [...allResults];
    
    // Filter by award types
    if (selectedFilters.awardTypes.size > 0) {
      filtered = filtered.filter(award => 
        award.award_type && selectedFilters.awardTypes.has(award.award_type)
      );
    }
    
    // Filter by agencies
    if (selectedFilters.agencies.size > 0) {
      filtered = filtered.filter(award =>
        (award.awarding_agency_name && selectedFilters.agencies.has(award.awarding_agency_name)) ||
        (award.funding_agency_name && selectedFilters.agencies.has(award.funding_agency_name))
      );
    }
    
    // Filter by recipients
    if (selectedFilters.recipients.size > 0) {
      filtered = filtered.filter(award =>
        award.recipient_name && selectedFilters.recipients.has(award.recipient_name)
      );
    }
    
    // Filter by states
    if (selectedFilters.states.size > 0) {
      filtered = filtered.filter(award =>
        award.recipient_location_state && selectedFilters.states.has(award.recipient_location_state)
      );
    }
    
    // Filter by countries
    if (selectedFilters.countries.size > 0) {
      filtered = filtered.filter(award =>
        award.recipient_location_country && selectedFilters.countries.has(award.recipient_location_country)
      );
    }
    
    // Filter by NAICS codes
    if (selectedFilters.naics.size > 0) {
      filtered = filtered.filter(award =>
        award.naics_code && selectedFilters.naics.has(award.naics_code)
      );
    }
    
    // Filter by PSC codes
    if (selectedFilters.psc.size > 0) {
      filtered = filtered.filter(award =>
        award.psc_code && selectedFilters.psc.has(award.psc_code)
      );
    }
    
    // Filter by CFDA numbers
    if (selectedFilters.cfda.size > 0) {
      filtered = filtered.filter(award =>
        award.cfda_number && selectedFilters.cfda.has(award.cfda_number)
      );
    }
    
    // Filter by month (extract month from period_start_date or period_end_date)
    if (selectedFilters.months.size > 0) {
      filtered = filtered.filter((award) => {
        const dateStr = award.period_start_date || award.period_end_date;
        if (!dateStr) return false;
        
        try {
          // Parse date string (format: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss")
          const date = new Date(dateStr);
          const month = date.getMonth() + 1; // getMonth() returns 0-11, we want 1-12
          return selectedFilters.months.has(month);
        } catch {
          return false;
        }
      });
    }
    
    setFilteredResults(filtered);
    setCurrentResults(filtered);
  }, [allResults, selectedFilters]);

  // Apply filters when selectedFilters change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Persist filterSettings when selectedFilters change
  // Use ref to track previous value and only persist when it actually changes
  const prevFilterSettingsRef = useRef({
    awardTypes: Array.from(selectedFilters.awardTypes),
    agencies: Array.from(selectedFilters.agencies),
    recipients: Array.from(selectedFilters.recipients),
    states: Array.from(selectedFilters.states),
    countries: Array.from(selectedFilters.countries),
    naics: Array.from(selectedFilters.naics),
    psc: Array.from(selectedFilters.psc),
    cfda: Array.from(selectedFilters.cfda),
    months: Array.from(selectedFilters.months),
  });
  useEffect(() => {
    const filterSettings = {
      awardTypes: Array.from(selectedFilters.awardTypes),
      agencies: Array.from(selectedFilters.agencies),
      recipients: Array.from(selectedFilters.recipients),
      states: Array.from(selectedFilters.states),
      countries: Array.from(selectedFilters.countries),
      naics: Array.from(selectedFilters.naics),
      psc: Array.from(selectedFilters.psc),
      cfda: Array.from(selectedFilters.cfda),
      months: Array.from(selectedFilters.months),
    };
    // Only persist if filterSettings actually changed (deep comparison)
    const prev = prevFilterSettingsRef.current;
    const hasChanged = JSON.stringify(prev) !== JSON.stringify(filterSettings);
    if (hasChanged) {
      prevFilterSettingsRef.current = filterSettings;
      onSettingsChange(id, { filterSettings });
    }
  }, [selectedFilters, id, onSettingsChange]);

  // Persist searchParams when they change
  useEffect(() => {
    onSettingsChange(id, { searchParams: currentSearchParams });
  }, [currentSearchParams, id, onSettingsChange]);

  // Persist displayOptions when they change (maxResults, compactView, showResultsTable, etc.)
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

  // Sync visible columns with display options
  useEffect(() => {
    const cols: string[] = [];
    if (localDisplayOptions.showRecipient) cols.push('recipient');
    if (localDisplayOptions.showAwardingAgency) cols.push('awarding_agency');
    if (localDisplayOptions.showFundingAgency) cols.push('funding_agency');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showPeriodStartDate) cols.push('period_start_date');
    if (localDisplayOptions.showPeriodEndDate) cols.push('period_end_date');
    if (localDisplayOptions.showNaicsCode) cols.push('naics_code');
    if (localDisplayOptions.showPscCode) cols.push('psc_code');
    if (localDisplayOptions.showLastUpdated) cols.push('last_updated');
    if (cols.length > 0) {
      setVisibleColumns(cols);
    }
  }, [localDisplayOptions]);

  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const awardTypeMap = new Map<string, number>();
    const agencyMap = new Map<string, number>();
    const recipientMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    const naicsMap = new Map<string, number>();
    const pscMap = new Map<string, number>();
    const cfdaMap = new Map<string, number>();
    
    allResults.forEach(award => {
      if (award.award_type) {
        awardTypeMap.set(award.award_type, (awardTypeMap.get(award.award_type) || 0) + 1);
      }
      if (award.awarding_agency_name) {
        agencyMap.set(award.awarding_agency_name, (agencyMap.get(award.awarding_agency_name) || 0) + 1);
      }
      if (award.funding_agency_name && award.funding_agency_name !== award.awarding_agency_name) {
        agencyMap.set(award.funding_agency_name, (agencyMap.get(award.funding_agency_name) || 0) + 1);
      }
      if (award.recipient_name) {
        recipientMap.set(award.recipient_name, (recipientMap.get(award.recipient_name) || 0) + 1);
      }
      if (award.recipient_location_state) {
        stateMap.set(award.recipient_location_state, (stateMap.get(award.recipient_location_state) || 0) + 1);
      }
      if (award.recipient_location_country) {
        countryMap.set(award.recipient_location_country, (countryMap.get(award.recipient_location_country) || 0) + 1);
      }
      if (award.naics_code) {
        naicsMap.set(award.naics_code, (naicsMap.get(award.naics_code) || 0) + 1);
      }
      if (award.psc_code) {
        pscMap.set(award.psc_code, (pscMap.get(award.psc_code) || 0) + 1);
      }
      if (award.cfda_number) {
        cfdaMap.set(award.cfda_number, (cfdaMap.get(award.cfda_number) || 0) + 1);
      }
    });
    
    return {
      awardTypes: Array.from(awardTypeMap.entries())
        .map(([awardType, count]) => ({ awardType, count }))
        .sort((a, b) => b.count - a.count),
      agencies: Array.from(agencyMap.entries())
        .map(([agency, count]) => ({ agency, count }))
        .sort((a, b) => b.count - a.count),
      recipients: Array.from(recipientMap.entries())
        .map(([recipient, count]) => ({ recipient, count }))
        .sort((a, b) => b.count - a.count),
      states: Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      countries: Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count),
      naics: Array.from(naicsMap.entries())
        .map(([naics, count]) => ({ naics, count }))
        .sort((a, b) => b.count - a.count),
      psc: Array.from(pscMap.entries())
        .map(([psc, count]) => ({ psc, count }))
        .sort((a, b) => b.count - a.count),
      cfda: Array.from(cfdaMap.entries())
        .map(([cfda, count]) => ({ cfda, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);

  // Handle award selection with single click, Ctrl+click, and Shift+click
  const handleAwardClick = (e: React.MouseEvent, awardId: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedAwards(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const awardsToSelect = currentPageResults.slice(start, end + 1);
        awardsToSelect.forEach(award => newSelected.add(award.award_id));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(awardId)) {
          newSelected.delete(awardId);
        } else {
          newSelected.add(awardId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(awardId)) {
          newSelected.delete(awardId);
        } else {
          newSelected.clear();
          newSelected.add(awardId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, awardId: string) => {
    e.stopPropagation();
    
    // Determine which awards to drag
    const awardsToDrag = selectedAwards.has(awardId) ? selectedAwards : new Set([awardId]);
    
    // Set drag data
    const selectedAwardObjects = currentResults.filter(award => 
      awardsToDrag.has(award.award_id)
    );
    
    if (selectedAwardObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'govt_contracts',
        awards: selectedAwardObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedAwardObjects.length} award${selectedAwardObjects.length > 1 ? 's' : ''}`;
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
  const handleRowContextMenu = (e: React.MouseEvent, awardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this award is not selected, select only it
    if (!selectedAwards.has(awardId)) {
      setSelectedAwards(new Set([awardId]));
    }
    
    setContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  const formatCurrency = (amount: number | undefined) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const [year, month, day] = dateString.split('T')[0].split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formatLastUpdated = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  // Calculate pagination values
  const totalPages = Math.ceil(currentResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = currentResults.slice(startIndex, endIndex);

  // Restore results from props on mount
  useEffect(() => {
    if (results.length > 0 && allResults.length === 0) {
      console.log('🔄 GovtContractsSearchTile: Restoring results from tile data:', results.length, 'results');
      setAllResults(results);
      setFilteredResults(results);
      setCurrentResults(results);
    }
  }, [results, allResults.length]);

  // This is a simplified version - the full file would continue with dialogs and table rendering
  // Due to file size limits, I'll create the complete file in the next step
  
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
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('govt_contracts'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'Government Contracts';
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
            disabled: selectedAwards.size === 0,
            tooltip: `Add ${selectedAwards.size > 0 ? `${selectedAwards.size} award(s)` : 'selected awards'} to context`,
            icon: <AddToContextIcon fontSize="small" />,
          }}
          customizeButton={{
            onClick: (e) => {
              e.stopPropagation();
              setCustomizeDialogOpen(true);
            },
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
                (selectedFilters.awardTypes.size > 0 || 
                 selectedFilters.agencies.size > 0 || 
                 selectedFilters.recipients.size > 0 || 
                 selectedFilters.states.size > 0 ||
                 selectedFilters.countries.size > 0 ||
                 selectedFilters.naics.size > 0 ||
                 selectedFilters.psc.size > 0 ||
                 selectedFilters.cfda.size > 0) 
                  ? `Filter Results (${selectedFilters.awardTypes.size + selectedFilters.agencies.size + selectedFilters.recipients.size + selectedFilters.states.size + selectedFilters.countries.size + selectedFilters.naics.size + selectedFilters.psc.size + selectedFilters.cfda.size} active)`
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
                      color: (selectedFilters.awardTypes.size > 0 || 
                              selectedFilters.agencies.size > 0 || 
                              selectedFilters.recipients.size > 0 || 
                              selectedFilters.states.size > 0 ||
                              selectedFilters.countries.size > 0 ||
                              selectedFilters.naics.size > 0 ||
                              selectedFilters.psc.size > 0 ||
                              selectedFilters.cfda.size > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.awardTypes.size > 0 || 
                    selectedFilters.agencies.size > 0 || 
                    selectedFilters.recipients.size > 0 || 
                    selectedFilters.states.size > 0 ||
                    selectedFilters.countries.size > 0 ||
                    selectedFilters.naics.size > 0 ||
                    selectedFilters.psc.size > 0 ||
                    selectedFilters.cfda.size > 0) && (
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
            {isRestoringPagination ? 'Restoring previous results...' : 'Searching contracts...'}
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
                      indeterminate={selectedAwards.size > 0 && selectedAwards.size < currentPageResults.length}
                      checked={currentPageResults.length > 0 && selectedAwards.size === currentPageResults.length}
                      onChange={() => {
                        if (selectedAwards.size === currentPageResults.length) {
                          const newSelected = new Set(selectedAwards);
                          currentPageResults.forEach(award => newSelected.delete(award.award_id));
                          setSelectedAwards(newSelected);
                        } else {
                          const newSelected = new Set(selectedAwards);
                          currentPageResults.forEach(award => newSelected.add(award.award_id));
                          setSelectedAwards(newSelected);
                        }
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                    />
                  </TableCell>
                  {visibleColumns.includes('recipient') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Recipient</TableCell>
                  )}
                  {visibleColumns.includes('awarding_agency') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Awarding Agency</TableCell>
                  )}
                  {visibleColumns.includes('funding_agency') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Funding Agency</TableCell>
                  )}
                  {visibleColumns.includes('recipient_location') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Recipient Location</TableCell>
                  )}
                  {visibleColumns.includes('amount') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Amount</TableCell>
                  )}
                  {visibleColumns.includes('period_start_date') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Start Date</TableCell>
                  )}
                  {visibleColumns.includes('period_end_date') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>End Date</TableCell>
                  )}
                  {visibleColumns.includes('naics_code') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>NAICS</TableCell>
                  )}
                  {visibleColumns.includes('psc_code') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>PSC</TableCell>
                  )}
                  {visibleColumns.includes('last_updated') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Last Updated</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((award, index) => (
                  <TableRow
                    key={award.award_id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, award.award_id)}
                    onClick={(e) => handleAwardClick(e, award.award_id, index)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (user?.id) {
                        openItemDetails(
                          'govt_contract',
                          award,
                          award.award_title || 'Award Details',
                          { 
                            user_id: user.id,
                            parentAward: null,
                            onEnrich: handleAwardEnrichment,
                          }
                        );
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, award.award_id)}
                    sx={{
                      backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': {
                        backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
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
                    {visibleColumns.includes('recipient') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {award.recipient_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('awarding_agency') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {award.awarding_agency_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('funding_agency') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {award.funding_agency_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('recipient_location') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {(() => {
                          const state = award.recipient_location_state || award.recipient_state_name;
                          const zip = award.recipient_zip_code;
                          if (zip) {
                            return state ? `${state}, ${zip}` : zip;
                          }
                          return state || 'N/A';
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.includes('amount') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatCurrency(
                          (award.is_idv_parent || award.award_or_idv_flag === 'IDV') && award.combined_obligated_amount
                            ? award.combined_obligated_amount
                            : award.total_obligated_amount || award.total_obligation
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes('period_start_date') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatDate(award.period_start_date)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('period_end_date') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatDate(award.period_of_performance_current_end_date || award.period_end_date)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('naics_code') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {award.naics_code || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('psc_code') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {award.psc_code || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('last_updated') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatLastUpdated(award.last_updated)}
                      </TableCell>
                    )}
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
        </Box>
      )}

      {/* Empty state */}
      {currentResults.length === 0 && !isLoading && !isRestoringPagination && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No results. Click the search icon to configure search parameters.
          </Typography>
        </Box>
      )}

      {/* Search Dialog */}
      <Dialog
        open={searchDialogOpen}
        onClose={() => {
          // Don't persist on close - only persist when user clicks "Search" (matching NewsTile pattern)
          setSearchDialogOpen(false);
        }}
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
            <Typography variant="h6">Search Government Contracts</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ 
          p: 3,
          maxHeight: '70vh',
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
          <Box display="flex" flexDirection="column" gap={3} mt={2}>
            {/* Awarding Agency */}
            <MultiSelectField<{ code?: string; name?: string; id?: string; text?: string; [key: string]: any }>
              label="Awarding Agency"
              selectedItems={(() => {
                const names = currentSearchParams.awarding_agency_name || [];
                return names.map(name => {
                  const found = findOptionByName(name, 'awarding_agency');
                  if (found) return found;
                  return { name: name || '', code: '', text: name || '' };
                });
              })()}
              onItemsChange={(items) => {
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  awarding_agency_name: items.map(item => 
                    typeof item === 'string' ? item : item.name || item.text || ''
                  ),
                }));
              }}
              suggestions={awardingAgencySuggestions}
              onSearch={awardingAgencySearch}
              isLoading={awardingAgencyLoading}
              renderItem={(item) => {
                if (typeof item === 'string') return item;
                return item.name || item.text || item.code || '';
              }}
              getItemKey={(item) => {
                if (typeof item === 'string') return item;
                return item.code || item.id || item.name || '';
              }}
              placeholder="Search for awarding agencies..."
              allowCustomInput={false}
            />

            {/* Recipient */}
            <MultiSelectField<{ id?: string; name?: string; text?: string; [key: string]: any }>
              label="Recipient"
              selectedItems={(() => {
                const names = currentSearchParams.recipient_name || [];
                return names.map(name => {
                  const found = findOptionByName(name, 'recipient');
                  if (found) return found;
                  const nameStr = typeof name === 'string' ? name : (name as any)?.name || (name as any)?.text || '';
                  return { name: nameStr, text: nameStr };
                });
              })()}
              onItemsChange={(items) => {
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  recipient_name: items.map(item => 
                    typeof item === 'string' ? item : item.name || item.text || ''
                  ),
                }));
              }}
              suggestions={recipientSuggestions}
              onSearch={recipientSearch}
              isLoading={recipientLoading}
              renderItem={(item) => {
                if (typeof item === 'string') return item;
                return item.name || item.text || '';
              }}
              getItemKey={(item) => {
                if (typeof item === 'string') return item;
                const key = item.id || item.name || item.text || '';
                if (key) return key;
                const itemStr = JSON.stringify(item);
                return `recipient-${itemStr.slice(0, 100).replace(/[^a-zA-Z0-9]/g, '-')}`;
              }}
              placeholder="Search for recipients..."
              allowCustomInput={false}
            />

            {/* State */}
            <MultiSelectField<string>
              label="Recipient State"
              selectedItems={currentSearchParams.recipient_location_state || []}
              onItemsChange={(states) => {
                setCurrentSearchParams((prev) => ({ ...prev, recipient_location_state: states }));
              }}
              suggestions={US_STATES}
              renderItem={(state) => state}
              placeholder="Select states..."
            />

            {/* Zip Code */}
            <MultiSelectField<string>
              label="Recipient Zip Code"
              selectedItems={currentSearchParams.recipient_zip_code || []}
              onItemsChange={(zipCodes) => {
                setCurrentSearchParams((prev) => ({ ...prev, recipient_zip_code: zipCodes }));
              }}
              suggestions={[]}
              onSearch={() => []}
              renderItem={(zipCode) => zipCode}
              placeholder="Enter zip codes..."
              disableAutocomplete={true}
            />

            {/* Date Range */}
            <TextField
              label="Fiscal Year"
              type="number"
              value={currentSearchParams.date_year || ''}
              onChange={(e) => {
                const year = e.target.value ? parseInt(e.target.value) : undefined;
                setCurrentSearchParams(prev => ({ ...prev, date_year: year }));
              }}
              inputProps={{
                min: 2000,
                max: 2100,
              }}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{
                mt: 3,
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />

            {/* Funding Agency - Hidden in easy mode */}
            {!isEasyMode && (
            <MultiSelectField<{ code?: string; name?: string; id?: string; text?: string; [key: string]: any }>
              label="Funding Agency"
              selectedItems={(() => {
                const names = currentSearchParams.funding_agency_name || [];
                return names.map(name => {
                  const found = findOptionByName(name, 'funding_agency');
                  if (found) return found;
                  return { name: name || '', code: '', text: name || '' };
                });
              })()}
              onItemsChange={(items) => {
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  funding_agency_name: items.map(item => 
                    typeof item === 'string' ? item : item.name || item.text || ''
                  ),
                }));
              }}
              suggestions={fundingAgencySuggestions}
              onSearch={fundingAgencySearch}
              isLoading={fundingAgencyLoading}
              renderItem={(item) => {
                if (typeof item === 'string') return item;
                return item.name || item.text || item.code || '';
              }}
              getItemKey={(item) => {
                if (typeof item === 'string') return item;
                return item.code || item.id || item.name || '';
              }}
              placeholder="Search for funding agencies..."
              allowCustomInput={false}
            />
            )}

            {/* Min/Max Obligation - Hidden in easy mode */}
            {!isEasyMode && (
            <Box display="flex" gap={2}>
              <TextField
                label="Min Obligation ($)"
                type="number"
                value={currentSearchParams.min_obligation || ''}
                onChange={(e) => {
                  setCurrentSearchParams((prev) => ({
                    ...prev,
                    min_obligation: e.target.value ? Number(e.target.value) : undefined,
                  }));
                }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                  '& input[type=number]': { MozAppearance: 'textfield' },
                  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
                }}
              />
              <TextField
                label="Max Obligation ($)"
                type="number"
                value={currentSearchParams.max_obligation || ''}
                onChange={(e) => {
                  setCurrentSearchParams((prev) => ({
                    ...prev,
                    max_obligation: e.target.value ? Number(e.target.value) : undefined,
                  }));
                }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                  '& input[type=number]': { MozAppearance: 'textfield' },
                  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
                }}
              />
            </Box>
            )}

            {/* NAICS Code - Hidden in easy mode */}
            {!isEasyMode && (
            <MultiSelectField<string>
              label="NAICS Code"
              selectedItems={currentSearchParams.naics_code || []}
              onItemsChange={(codes) => {
                setCurrentSearchParams((prev) => ({ ...prev, naics_code: codes }));
              }}
              suggestions={[]}
              onSearch={() => []}
              renderItem={(code) => code}
              placeholder="Enter NAICS codes..."
              disableAutocomplete={true}
            />
            )}

            {/* PSC Code - Hidden in easy mode */}
            {!isEasyMode && (
            <MultiSelectField<string>
              label="PSC Code"
              selectedItems={currentSearchParams.psc_code || []}
              onItemsChange={(codes) => {
                setCurrentSearchParams((prev) => ({ ...prev, psc_code: codes }));
              }}
              suggestions={[]}
              onSearch={() => []}
              renderItem={(code) => code}
              placeholder="Enter PSC codes..."
              disableAutocomplete={true}
            />
            )}

            {/* CFDA Number - Hidden in easy mode */}
            {!isEasyMode && (
            <MultiSelectField<string>
              label="CFDA Number"
              selectedItems={currentSearchParams.cfda_number || []}
              onItemsChange={(numbers) => {
                setCurrentSearchParams((prev) => ({ ...prev, cfda_number: numbers }));
              }}
              suggestions={[]}
              onSearch={() => []}
              renderItem={(number) => number}
              placeholder="Enter CFDA numbers..."
              disableAutocomplete={true}
            />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
          <Button
            onClick={() => {
              setCurrentSearchParams({
                keywords: [],
                award_type: [],
                awarding_agency_name: [],
                funding_agency_name: [],
                recipient_id: [],
                recipient_name: [],
                recipient_location_state: [],
                recipient_zip_code: [],
                recipient_location_country: [],
                naics_code: [],
                psc_code: [],
                cfda_number: [],
                date_year: undefined,
              });
            }}
            sx={{ color: '#94a3b8' }}
          >
            Clear
          </Button>
          <Button onClick={() => setSearchDialogOpen(false)} sx={{ color: '#94a3af' }}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              // Persist search params before performing search (matching NewsTile pattern)
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

      {/* Filter Dialog */}
      <Dialog
        open={filterDialogOpen}
        onClose={() => {
          // Persist filter settings when dialog is closed
          const filterSettings = {
            awardTypes: Array.from(selectedFilters.awardTypes),
            agencies: Array.from(selectedFilters.agencies),
            recipients: Array.from(selectedFilters.recipients),
            states: Array.from(selectedFilters.states),
            countries: Array.from(selectedFilters.countries),
            naics: Array.from(selectedFilters.naics),
            psc: Array.from(selectedFilters.psc),
            cfda: Array.from(selectedFilters.cfda),
          };
          onSettingsChange(id, { filterSettings });
          setFilterDialogOpen(false);
        }}
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
        <DialogContent sx={{ 
          p: 3,
          maxHeight: '70vh',
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
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
            Refine search results by: Click headings to show top filters. Document counts shown in <span style={{ color: '#3b82f6' }}>#</span>
          </Typography>

          {/* Applied Filters Section */}
          {(selectedFilters.awardTypes.size > 0 || 
            selectedFilters.agencies.size > 0 || 
            selectedFilters.recipients.size > 0 || 
            selectedFilters.states.size > 0 ||
            selectedFilters.countries.size > 0 ||
            selectedFilters.naics.size > 0 ||
            selectedFilters.psc.size > 0 ||
            selectedFilters.cfda.size > 0) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
              <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
                Applied Filters:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Array.from(selectedFilters.awardTypes).map(awardType => (
                  <Chip
                    key={`awardType-${awardType}`}
                    label={`Award Type: ${awardType}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.awardTypes);
                        newSet.delete(awardType);
                        return { ...prev, awardTypes: newSet };
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
                {Array.from(selectedFilters.agencies).map(agency => (
                  <Chip
                    key={`agency-${agency}`}
                    label={`Agency: ${agency}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.agencies);
                        newSet.delete(agency);
                        return { ...prev, agencies: newSet };
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
                {Array.from(selectedFilters.recipients).map(recipient => (
                  <Chip
                    key={`recipient-${recipient}`}
                    label={`Recipient: ${recipient}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.recipients);
                        newSet.delete(recipient);
                        return { ...prev, recipients: newSet };
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
                {Array.from(selectedFilters.states).map(state => (
                  <Chip
                    key={`state-${state}`}
                    label={`State: ${state}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.states);
                        newSet.delete(state);
                        return { ...prev, states: newSet };
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
                {Array.from(selectedFilters.countries).map(country => (
                  <Chip
                    key={`country-${country}`}
                    label={`Country: ${country}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.countries);
                        newSet.delete(country);
                        return { ...prev, countries: newSet };
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
                {Array.from(selectedFilters.naics).map(code => (
                  <Chip
                    key={`naics-${code}`}
                    label={`NAICS: ${code}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.naics);
                        newSet.delete(code);
                        return { ...prev, naics: newSet };
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
                {Array.from(selectedFilters.psc).map(code => (
                  <Chip
                    key={`psc-${code}`}
                    label={`PSC: ${code}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.psc);
                        newSet.delete(code);
                        return { ...prev, psc: newSet };
                      });
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      border: '1px solid #ef4444',
                      '& .MuiChip-deleteIcon': { color: '#ef4444' }
                    }}
                  />
                ))}
                {Array.from(selectedFilters.cfda).map(code => (
                  <Chip
                    key={`cfda-${code}`}
                    label={`CFDA: ${code}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.cfda);
                        newSet.delete(code);
                        return { ...prev, cfda: newSet };
                      });
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(251, 191, 36, 0.2)',
                      color: '#fbbf24',
                      border: '1px solid #fbbf24',
                      '& .MuiChip-deleteIcon': { color: '#fbbf24' }
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* No Results Message */}
          {availableFilters.awardTypes.length === 0 && 
           availableFilters.agencies.length === 0 && 
           availableFilters.recipients.length === 0 &&
           availableFilters.states.length === 0 &&
           availableFilters.countries.length === 0 &&
           availableFilters.naics.length === 0 &&
           availableFilters.psc.length === 0 &&
           availableFilters.cfda.length === 0 ? (
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
              {/* Award Types Filter */}
              {availableFilters.awardTypes.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Award Types ({availableFilters.awardTypes.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.awardTypes.map((filter) => (
                        <Box
                          key={filter.awardType}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.awardTypes.has(filter.awardType)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.awardTypes);
                            if (newSet.has(filter.awardType)) {
                              newSet.delete(filter.awardType);
                            } else {
                              newSet.add(filter.awardType);
                            }
                            setSelectedFilters(prev => ({ ...prev, awardTypes: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.awardType}
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

              {/* Agencies Filter */}
              {availableFilters.agencies.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Agencies ({availableFilters.agencies.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.agencies.map((filter) => (
                        <Box
                          key={filter.agency}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.agencies.has(filter.agency)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.agencies);
                            if (newSet.has(filter.agency)) {
                              newSet.delete(filter.agency);
                            } else {
                              newSet.add(filter.agency);
                            }
                            setSelectedFilters(prev => ({ ...prev, agencies: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.agency}
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

              {/* Recipients Filter */}
              {availableFilters.recipients.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Recipients ({availableFilters.recipients.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.recipients.map((filter) => (
                        <Box
                          key={filter.recipient}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.recipients.has(filter.recipient)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.recipients);
                            if (newSet.has(filter.recipient)) {
                              newSet.delete(filter.recipient);
                            } else {
                              newSet.add(filter.recipient);
                            }
                            setSelectedFilters(prev => ({ ...prev, recipients: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.recipient}
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

              {/* States Filter */}
              {availableFilters.states.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      States ({availableFilters.states.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.states.map((filter) => (
                        <Box
                          key={filter.state}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.states.has(filter.state)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.states);
                            if (newSet.has(filter.state)) {
                              newSet.delete(filter.state);
                            } else {
                              newSet.add(filter.state);
                            }
                            setSelectedFilters(prev => ({ ...prev, states: newSet }));
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

              {/* Countries Filter */}
              {availableFilters.countries.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Countries ({availableFilters.countries.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.countries.map((filter) => (
                        <Box
                          key={filter.country}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.countries.has(filter.country)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.countries);
                            if (newSet.has(filter.country)) {
                              newSet.delete(filter.country);
                            } else {
                              newSet.add(filter.country);
                            }
                            setSelectedFilters(prev => ({ ...prev, countries: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.country}
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

              {/* NAICS Filter */}
              {availableFilters.naics.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      NAICS Codes ({availableFilters.naics.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.naics.map((filter) => (
                        <Box
                          key={filter.naics}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.naics.has(filter.naics)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.naics);
                            if (newSet.has(filter.naics)) {
                              newSet.delete(filter.naics);
                            } else {
                              newSet.add(filter.naics);
                            }
                            setSelectedFilters(prev => ({ ...prev, naics: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.naics}
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

              {/* PSC Filter */}
              {availableFilters.psc.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      PSC Codes ({availableFilters.psc.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.psc.map((filter) => (
                        <Box
                          key={filter.psc}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.psc.has(filter.psc)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.psc);
                            if (newSet.has(filter.psc)) {
                              newSet.delete(filter.psc);
                            } else {
                              newSet.add(filter.psc);
                            }
                            setSelectedFilters(prev => ({ ...prev, psc: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.psc}
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

              {/* CFDA Filter */}
              {availableFilters.cfda.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      CFDA Numbers ({availableFilters.cfda.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.cfda.map((filter) => (
                        <Box
                          key={filter.cfda}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.cfda.has(filter.cfda)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.cfda);
                            if (newSet.has(filter.cfda)) {
                              newSet.delete(filter.cfda);
                            } else {
                              newSet.add(filter.cfda);
                            }
                            setSelectedFilters(prev => ({ ...prev, cfda: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.cfda}
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
                awardTypes: new Set(),
                agencies: new Set(),
                recipients: new Set(),
                states: new Set(),
                countries: new Set(),
                naics: new Set(),
                psc: new Set(),
                cfda: new Set(),
                months: new Set(),
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
        onClose={() => {
          setColumnMenuAnchor(null);
        }}
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
            recipient: 'Recipient',
            awarding_agency: 'Awarding Agency',
            funding_agency: 'Funding Agency',
            recipient_location: 'Recipient Location',
            amount: 'Amount',
            period_start_date: 'Period Start Date',
            period_end_date: 'Period End Date',
            naics_code: 'NAICS Code',
            psc_code: 'PSC Code',
            last_updated: 'Last Updated',
            actions: 'Actions',
          };
          const isVisible = visibleColumns.includes(column);
          return (
            <MenuItem
              key={column}
              onClick={() => {
                handleColumnToggle(column);
              }}
              sx={{
                color: isVisible ? '#3b82f6' : '#94a3b8',
              }}
            >
                <Checkbox
                  checked={isVisible}
                  sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                />
                {columnLabels[column] || column.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
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
          sx={{ '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files
        </MenuItem>
      </Menu>

      {/* File Browser Dialog */}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
      />

      {/* Tile Customization Dialog */}
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
          onClick={handleAddToContext}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context
        </MenuItem>
        <MenuItem
          onClick={handleAddToFiles}
          sx={{ '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files
        </MenuItem>
      </Menu>

      {/* File Browser Dialog */}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
      />

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'Government Contracts'}
        currentColor={customColor}
        currentIcon={customIcon}
      />
    </Box>
  );
};

// Custom comparison function for memo - matches SEC tile pattern but with optimization
const GovtContractsSearchTileMemo = memo(GovtContractsSearchTile, (prevProps, nextProps) => {
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
    if (prevDisplay.showRecipient !== nextDisplay.showRecipient ||
        prevDisplay.showAwardingAgency !== nextDisplay.showAwardingAgency ||
        prevDisplay.showFundingAgency !== nextDisplay.showFundingAgency ||
        prevDisplay.showAmount !== nextDisplay.showAmount ||
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
  
  // Skip size comparison for performance (only re-render on significant changes)
  // Customization props are checked above, so they will always trigger re-render
  
  return true; // Don't re-render
});

GovtContractsSearchTileMemo.displayName = 'GovtContractsSearchTile';

export default GovtContractsSearchTileMemo;

