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
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ViewColumn as ViewColumnIcon,
  ArrowBack as ArrowBackIcon,
  InfoOutlined as InfoIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { 
  govtContractsSearchAPI, 
  govtContractsAutocompleteAPI,
  govtContractsEnrichmentAPI,
  GovtContractsSearchFilters,
  GovtContractAward 
} from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, addAwardToContext, addMultipleAwardsToContext, confirmDialog, getIconByName, getDefaultIconForTileType } from './common';
import MultiSelectField from '../MultiSelectField';

// Award type options
const AWARD_TYPES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'IDV', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

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

const GovtContractsSearchTile: React.FC<GovtContractsSearchTileProps> = ({
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
    keywords: [],
    award_type: [],
    awarding_agency_name: [],
    funding_agency_name: [],
    recipient_name: [],
    recipient_location_state: [],
    naics_code: [],
    psc_code: [],
    cfda_number: [],
    date_from: '',
    date_to: '',
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
  const [selectedAwardForDetails, setSelectedAwardForDetails] = useState<GovtContractAward | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  const [parentAwardForDetails, setParentAwardForDetails] = useState<GovtContractAward | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState<boolean>(false);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [enrichmentSuccess, setEnrichmentSuccess] = useState<string | null>(null);
  
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
  }>({
    awardTypes: new Set(initialFilterSettings?.awardTypes || []),
    agencies: new Set(initialFilterSettings?.agencies || []),
    recipients: new Set(initialFilterSettings?.recipients || []),
    states: new Set(initialFilterSettings?.states || []),
    countries: new Set(initialFilterSettings?.countries || []),
    naics: new Set(initialFilterSettings?.naics || []),
    psc: new Set(initialFilterSettings?.psc || []),
    cfda: new Set(initialFilterSettings?.cfda || []),
  });

  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchParams, setCurrentSearchParams] = useState<GovtContractsSearchFilters>(searchParams);
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

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        limit: localDisplayOptions.maxResults,
      };
      
      const response = await govtContractsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('🏛️ GovtContractsSearchTile: Retrieved', response.results.length, 'awards');
        
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(response.results);
        setFilteredResults(response.results);
        setCurrentResults(response.results);
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
        
        // Update parent component - include pagination state in session state
        onUpdate(id, {
          results: response.results,
          paginationState: {
            totalResultsLoaded: response.results.length,
            lastEvaluatedKeys: response.last_evaluated_key ? [response.last_evaluated_key] : [],
            hasMore: response.has_more || false,
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
            totalResultsLoaded: 0,
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

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        limit: localDisplayOptions.maxResults,
        last_evaluated_key: lastEvaluatedKey,
      };
      
      const response = await govtContractsSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        const updatedResults = [...allResults, ...response.results];
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(updatedResults);
        setFilteredResults(updatedResults);
        setCurrentResults(updatedResults);
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
          paginationState: {
            totalResultsLoaded: updatedResults.length,
            lastEvaluatedKeys: updatedKeys,
            hasMore: response.has_more || false,
          },
          lastUpdated: Date.now(),
        });
      } else {
        console.error('🏛️ GovtContractsSearchTile: Load more failed');
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
      console.error('🏛️ GovtContractsSearchTile: Load more error:', err);
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

    console.log('🔄 GovtContractsSearchTile: Restoring pagination state', {
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
        });
        
        const searchRequest = {
          filters,
          limit: localDisplayOptions.maxResults,
          last_evaluated_key: nextKey,
        };
        
        const response = await govtContractsSearchAPI.search(searchRequest);
        
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
      setCurrentResults(currentResults);
      setLastEvaluatedKeys(paginationState.lastEvaluatedKeys);
      setHasMore(paginationState.hasMore);
      setHasPerformedInitialSearch(true);
      
      // Update tile with restored results - include pagination state
      onUpdate(id, {
        results: currentResults,
        paginationState: {
          totalResultsLoaded: currentResults.length,
          lastEvaluatedKeys: paginationState.lastEvaluatedKeys,
          hasMore: paginationState.hasMore,
        },
        lastUpdated: Date.now(),
      });
      
      console.log('✅ GovtContractsSearchTile: Pagination state restored', {
        restoredCount: currentResults.length,
        targetCount: paginationState.totalResultsLoaded,
      });
    } catch (err) {
      console.error('❌ GovtContractsSearchTile: Error restoring pagination state', err);
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
      console.log('🔄 GovtContractsSearchTile: Restoring', results.length, 'results from session');
      setAllResults(results);
      setFilteredResults(results);
      setCurrentResults(results);
      setHasPerformedInitialSearch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

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
        currentSearchParams.date_from ||
        currentSearchParams.date_to;
      
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

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    const selectedAwardObjects = currentResults.filter(award => 
      selectedAwards.has(award.award_id)
    );

    if (selectedAwardObjects.length === 0) return;

    if (selectedAwardObjects.length === 1) {
      addAwardToContext(selectedAwardObjects[0], target);
    } else {
      addMultipleAwardsToContext(selectedAwardObjects, target);
    }

    setSelectedAwards(new Set());
    handleContextMenuClose();
  };

  
  const handleRefresh = () => {
    performSearch();
  };

  const handleEnrichAward = useCallback(async () => {
    if (!selectedAwardForDetails?.award_id || enrichmentLoading) return;

    setEnrichmentLoading(true);
    setEnrichmentError(null);
    setEnrichmentSuccess(null);

    try {
      const response = await govtContractsEnrichmentAPI.enrich({
        award_id: selectedAwardForDetails.award_id,
      });

      if (response.success) {
        if (response.updated) {
          const awardId = selectedAwardForDetails.award_id;
          
          setEnrichmentSuccess(
            `Refreshing award data... Updated ${response.transactions_count || 0} transactions, ${response.subawards_count || 0} subawards${response.child_awards_count ? `, ${response.child_awards_count} child awards` : ''}.`
          );
          
          // Wait a moment for DynamoDB to be consistent, then fetch just this single award
          setTimeout(async () => {
            try {
              // Fetch just the single award by ID
              const awardResponse = await govtContractsSearchAPI.getAward({
                award_id: awardId,
              });
              
              if (awardResponse.success && awardResponse.result) {
                // Update the award in current results if it exists
                setCurrentResults((prevResults) => {
                  const awardExists = prevResults.some((award: GovtContractAward) => award.award_id === awardId);
                  if (awardExists) {
                    return prevResults.map((award: GovtContractAward) =>
                      award.award_id === awardId ? awardResponse.result! : award
                    );
                  }
                  return prevResults;
                });
                
                // Update the selected award with fresh data (keep dialog open)
                setSelectedAwardForDetails(awardResponse.result);
                
                setEnrichmentSuccess(
                  `Award data refreshed successfully! Updated ${response.transactions_count || 0} transactions, ${response.subawards_count || 0} subawards${response.child_awards_count ? `, ${response.child_awards_count} child awards` : ''}.`
                );
                
                // Clear success message after 5 seconds
                setTimeout(() => {
                  setEnrichmentSuccess(null);
                }, 5000);
              } else {
                setEnrichmentError(awardResponse.error || 'Award updated but could not refresh award data.');
              }
            } catch (fetchError) {
              console.error('Error refreshing award after enrichment:', fetchError);
              setEnrichmentSuccess(
                `Award was updated successfully! Updated ${response.transactions_count || 0} transactions, ${response.subawards_count || 0} subawards${response.child_awards_count ? `, ${response.child_awards_count} child awards` : ''}. Please close and reopen the dialog to see the changes.`
              );
              setTimeout(() => {
                setEnrichmentSuccess(null);
              }, 5000);
            }
          }, 1500); // Wait 1.5 seconds for DynamoDB consistency
        } else {
          setEnrichmentSuccess('Award data is already up to date.');
          setTimeout(() => {
            setEnrichmentSuccess(null);
          }, 3000);
        }
      } else {
        setEnrichmentError('Failed to enrich award data');
      }
    } catch (error: any) {
      console.error('Error enriching award:', error);
      setEnrichmentError(error.message || 'Failed to enrich award data. Please try again.');
    } finally {
      setEnrichmentLoading(false);
    }
  }, [selectedAwardForDetails, enrichmentLoading]);

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
    
    setFilteredResults(filtered);
    setCurrentResults(filtered);
  }, [allResults, selectedFilters]);

  // Apply filters when selectedFilters change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Persist filterSettings when selectedFilters change
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
    };
    onSettingsChange(id, { filterSettings });
  }, [selectedFilters, id, onSettingsChange]);

  // Persist searchParams when they change
  useEffect(() => {
    onSettingsChange(id, { searchParams: currentSearchParams });
  }, [currentSearchParams, id, onSettingsChange]);

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

  const toggleAwardSelection = (awardId: string) => {
    setSelectedAwards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(awardId)) {
        newSet.delete(awardId);
      } else {
        newSet.add(awardId);
      }
      return newSet;
    });
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
                  {/* Actions column is always visible (not selectable) */}
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((award) => (
                  <TableRow
                    key={award.award_id}
                    sx={{
                      backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      '&:hover': {
                        backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedAwards.has(award.award_id)}
                        onChange={() => toggleAwardSelection(award.award_id)}
                        sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                      />
                    </TableCell>
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
                    {/* Actions column is always visible (not selectable) */}
                    <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAwardForDetails(award);
                          setParentAwardForDetails(null);
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
                        View More
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
            <Typography variant="h6">Search Government Contracts</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
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

            {/* Funding Agency */}
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

            {/* Min/Max Obligation */}
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

            {/* Date Range */}
            <Box display="flex" gap={2}>
              <TextField
                label="Date From"
                type="date"
                value={currentSearchParams.date_from || ''}
                onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, date_from: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                }}
              />
              <TextField
                label="Date To"
                type="date"
                value={currentSearchParams.date_to || ''}
                onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, date_to: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                }}
              />
            </Box>

            {/* Award Type */}
            <MultiSelectField<string>
              label="Award Type"
              selectedItems={currentSearchParams.award_type || []}
              onItemsChange={(awardTypes) => {
                setCurrentSearchParams((prev) => ({ ...prev, award_type: awardTypes }));
              }}
              suggestions={AWARD_TYPES}
              renderItem={(type) => type}
              placeholder="Select award types..."
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

            {/* NAICS Code */}
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
            />

            {/* PSC Code */}
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
            />

            {/* CFDA Number */}
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
            />
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
                recipient_location_country: [],
                naics_code: [],
                psc_code: [],
                cfda_number: [],
                date_from: '',
                date_to: '',
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

      {/* Award Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
          setParentAwardForDetails(null);
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
              {/* Back button for child awards */}
              {selectedAwardForDetails?.is_idv_child && parentAwardForDetails && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (parentAwardForDetails) {
                        setSelectedAwardForDetails(parentAwardForDetails);
                        setParentAwardForDetails(null);
                      }
                    }}
                    sx={{
                      color: '#3b82f6',
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                    }}
                  >
                    <ArrowBackIcon fontSize="small" />
                  </IconButton>
                  <Typography variant="caption" sx={{ color: '#94a3b8', cursor: 'pointer' }} onClick={() => {
                    if (parentAwardForDetails) {
                      setSelectedAwardForDetails(parentAwardForDetails);
                      setParentAwardForDetails(null);
                    }
                  }}>
                    Back to Parent IDV
                  </Typography>
                </Box>
              )}
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
                  {selectedAwardForDetails?.is_assistance ? 'Other Financial Assistance' : 'Contract'}
                </Typography>
                <Tooltip title="Refresh award data from USAspending API">
                  <IconButton
                    size="small"
                    onClick={handleEnrichAward}
                    disabled={enrichmentLoading || !selectedAwardForDetails?.award_id}
                    sx={{
                      color: '#3b82f6',
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                      '&:disabled': {
                        color: '#6b7280',
                      },
                    }}
                  >
                    {enrichmentLoading ? (
                      <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
                    ) : (
                      <RefreshIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </Box>
              {selectedAwardForDetails?.award_id_fain && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                    FAIN
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {selectedAwardForDetails.award_id_fain}
                  </Typography>
                </Box>
              )}
            </Box>
            <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              {/* Parent IDV Information for Child Awards */}
              {selectedAwardForDetails?.is_idv_child && selectedAwardForDetails?.parent_idv_id && (
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5, fontSize: '11px' }}>
                    This is a child award
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#3b82f6', fontWeight: 600, fontFamily: 'monospace' }}>
                    Parent: {selectedAwardForDetails.parent_idv_id}
                  </Typography>
                </Box>
              )}
              
              {(() => {
                const startDate = selectedAwardForDetails?.period_of_performance_start_date || selectedAwardForDetails?.period_start_date;
                const endDate = selectedAwardForDetails?.period_of_performance_current_end_date || 
                                (selectedAwardForDetails?.award_or_idv_flag === 'IDV' ? selectedAwardForDetails?.ordering_period_end_date : null) ||
                                selectedAwardForDetails?.period_end_date;
                if (!startDate || !endDate) return null;
                
                const end = new Date(endDate);
                const now = new Date();
                const remainingDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                const yearsRemaining = Math.floor(remainingDays / 365);
                
                return (
                  <>
                    <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                      In Progress
                    </Typography>
                    {yearsRemaining > 0 && (
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                        ({yearsRemaining} {yearsRemaining === 1 ? 'year' : 'years'} remain)
                      </Typography>
                    )}
                  </>
                );
              })()}
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
          {/* Enrichment status messages */}
          {enrichmentSuccess && (
            <Alert 
              severity="success" 
              onClose={() => setEnrichmentSuccess(null)}
              sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
            >
              {enrichmentSuccess}
            </Alert>
          )}
          {enrichmentError && (
            <Alert 
              severity="error" 
              onClose={() => setEnrichmentError(null)}
              sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
            >
              {enrichmentError}
            </Alert>
          )}
          
          {selectedAwardForDetails && (() => {
            // Calculate amounts for chart
            const obligatedAmount = selectedAwardForDetails.combined_obligated_amount || 
                                   selectedAwardForDetails.total_obligated_amount || 
                                   selectedAwardForDetails.total_obligation || 0;
            const outlayedAmount = parseFloat(selectedAwardForDetails.total_outlayed_amount_for_overall_award as string) || 0;
            const nonFederalFunding = parseFloat(selectedAwardForDetails.total_non_federal_funding_amount as string) || 0;
            const totalFunding = obligatedAmount;
            
            return (
            <Box>
              {/* Award Overview Section - Two Columns */}
              <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {/* Left Column: Awarding Agency & Recipient */}
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Awarding Agency
                      </Typography>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {selectedAwardForDetails.awarding_agency_name || 'N/A'}
                        {selectedAwardForDetails.awarding_agency_code && (
                          <Typography component="span" variant="body2" sx={{ color: '#64748b', ml: 1 }}>
                            ({selectedAwardForDetails.awarding_agency_code})
                          </Typography>
                        )}
                      </Typography>
                    </Box>
                    
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Recipient
                      </Typography>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {selectedAwardForDetails.recipient_name || (selectedAwardForDetails.recipient_name_normalized ? selectedAwardForDetails.recipient_name_normalized.toUpperCase() : 'N/A')}
                      </Typography>
                      {selectedAwardForDetails.recipient_city_name && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                            {selectedAwardForDetails.recipient_city_name}
                            {selectedAwardForDetails.recipient_location_state && `, ${selectedAwardForDetails.recipient_location_state}`}
                            {selectedAwardForDetails.recipient_zip_code && ` ${selectedAwardForDetails.recipient_zip_code}`}
                          </Typography>
                          <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                            {selectedAwardForDetails.recipient_country_name || selectedAwardForDetails.recipient_location_country || 'UNITED STATES'}
                          </Typography>
                          {selectedAwardForDetails.prime_award_transaction_recipient_cd_current && (
                            <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                              Congressional District: {selectedAwardForDetails.prime_award_transaction_recipient_cd_current}
                            </Typography>
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                  
                  {/* Right Column: CFDA & Dates */}
                  <Box>
                    {selectedAwardForDetails.cfda_number && (
                      <Box sx={{ mb: 3 }}>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                          Assistance Listings (CFDA Programs)
                        </Typography>
                        <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.cfda_number}
                          {selectedAwardForDetails.cfda_title && ` - ${selectedAwardForDetails.cfda_title}`}
                        </Typography>
                      </Box>
                    )}
                    
                    {(() => {
                      const startDate = selectedAwardForDetails?.period_of_performance_start_date || selectedAwardForDetails?.period_start_date;
                      const endDate = selectedAwardForDetails?.period_of_performance_current_end_date || 
                                      (selectedAwardForDetails?.award_or_idv_flag === 'IDV' ? selectedAwardForDetails?.ordering_period_end_date : null) ||
                                      selectedAwardForDetails?.period_end_date;
                      if (!startDate || !endDate) return null;
                      
                      const start = new Date(startDate);
                      const end = new Date(endDate);
                      const now = new Date();
                      const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                      const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                      const progressPercent = Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
                      
                      return (
                        <Box>
                          <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                            Dates
                          </Typography>
                          {/* Progress Bar */}
                          <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <svg width="304" height="40">
                              <rect x="0" y="0" rx="5" ry="5" width="304" height="10" fill="#f1f1f1" />
                              <rect x="0" y="0" rx="5" ry="5" width={`${progressPercent}%`} height="10" fill="#10b981" />
                              <circle cx="5" cy="5" r="5" fill="#10b981" />
                              <circle cx="299" cy="5" r="5" fill="#ef4444" />
                              <line 
                                x1={(progressPercent / 100) * 304} 
                                x2={(progressPercent / 100) * 304} 
                                y1="0" 
                                y2="10" 
                                stroke="#64748b" 
                                strokeWidth="2"
                              />
                              <polygon 
                                points={`${(progressPercent / 100) * 304},10 ${(progressPercent / 100) * 304 - 3},15 ${(progressPercent / 100) * 304 + 3},15`}
                                fill="#64748b"
                              />
                            </svg>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, width: '100%' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box sx={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Start Date</Typography>
                                <Typography variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                                  {formatDate(startDate)}
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box sx={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>End Date</Typography>
                                <Typography variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                                  {formatDate(endDate)}
                                </Typography>
                              </Box>
                            </Box>
                          </Box>
                        </Box>
                      );
                    })()}
                  </Box>
                </Box>
              </Box>

              {/* Award Amounts Visualization */}
              <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h5" sx={{ color: '#3b82f6', fontWeight: 600 }}>
                    $ Award Amounts
                  </Typography>
                </Box>
                <Box sx={{ borderBottom: '1px solid #374151', mb: 3 }} />
                
                {/* Chart Visualization */}
                <Box sx={{ mb: 3, position: 'relative', width: '100%', minHeight: '400px' }}>
                  {(() => {
                    const chartWidth = 647;
                    const chartHeight = 400;
                    const barHeight = 50;
                    const barY = 160;
                    
                    const obligatedWidth = chartWidth;
                    const outlayedWidth = obligatedAmount > 0 ? (outlayedAmount / obligatedAmount) * chartWidth : 0;
                    
                    return (
                      <Box sx={{ position: 'relative', width: '100%', height: `${chartHeight}px`, overflow: 'hidden' }}>
                        <svg width="100%" height={chartHeight} style={{ maxWidth: `${chartWidth}px` }}>
                          <rect x="0" y={barY} width={chartWidth} height={barHeight} fill="#dce4ee" rx="5" ry="5" />
                          <rect x="0" y={barY + 5} width={obligatedWidth} height={barHeight - 10} fill="#4773aa" rx="5" ry="5" />
                          {outlayedAmount > 0 && (
                            <rect 
                              x="0" 
                              y={barY + 5} 
                              width={outlayedWidth} 
                              height={barHeight - 10} 
                              fill="#10b981" 
                              rx="5" 
                              ry="5"
                              opacity="0.8"
                            />
                          )}
                          <line 
                            x1={obligatedWidth} 
                            y1={90} 
                            x2={obligatedWidth} 
                            y2={barY + barHeight + 10} 
                            stroke="#4773aa" 
                            strokeWidth="4"
                          />
                          {outlayedAmount > 0 && outlayedWidth < obligatedWidth && (
                            <line 
                              x1={outlayedWidth} 
                              y1={barY} 
                              x2={outlayedWidth} 
                              y2={barY + barHeight} 
                              stroke="#10b981" 
                              strokeWidth="4"
                            />
                          )}
                          {outlayedAmount > 0 && outlayedWidth > 50 && (
                            <foreignObject width={outlayedWidth} height="70" x="0" y={90}>
                              <Box sx={{ textAlign: 'left', backgroundColor: 'rgba(15, 23, 42, 0.98)', padding: '4px 8px', borderRadius: '4px', maxWidth: `${outlayedWidth}px` }}>
                                <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '18px' }}>
                                  {formatCurrency(outlayedAmount)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Amount Paid</Typography>
                              </Box>
                            </foreignObject>
                          )}
                          <foreignObject width={chartWidth} height="70" x="-8" y={90}>
                            <Box sx={{ float: 'right', textAlign: 'right', backgroundColor: 'rgba(15, 23, 42, 0.98)', padding: '4px 8px', borderRadius: '4px' }}>
                              <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '20px' }}>
                                {formatCurrency(obligatedAmount)}
                              </Typography>
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                            </Box>
                          </foreignObject>
                          <foreignObject width={chartWidth} height="60" x="0" y={300}>
                            <Box sx={{ float: 'right', textAlign: 'right', padding: '4px 8px' }}>
                              <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '20px' }}>
                                {formatCurrency(totalFunding)}
                              </Typography>
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Total Funding</Typography>
                            </Box>
                          </foreignObject>
                        </svg>
                      </Box>
                    );
                  })()}
                </Box>
                
                {/* Amount Details */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#10b981' }} />
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>Amount Paid</Typography>
                      <Tooltip
                        title="The total amount of money that has actually been paid out or spent from the obligated amount."
                        arrow
                        placement="top"
                      >
                        <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                      </Tooltip>
                    </Box>
                    <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {formatCurrency(outlayedAmount)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#4773aa' }} />
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                      <Tooltip
                        title="The total amount of money that the government has committed to spend on this award. This is the maximum amount that can be paid out."
                        arrow
                        placement="top"
                      >
                        <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                      </Tooltip>
                    </Box>
                    <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {formatCurrency(obligatedAmount)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: 'rgba(71, 115, 170, 0.3)' }} />
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>Non-Federal Funding</Typography>
                      <Tooltip
                        title="Funding provided by sources other than the federal government, such as state or local governments, private organizations, or other non-federal entities."
                        arrow
                        placement="top"
                      >
                        <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                      </Tooltip>
                    </Box>
                    <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {formatCurrency(nonFederalFunding)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#64748b' }} />
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>Total Funding</Typography>
                      <Tooltip
                        title="The sum of all funding sources for this award, including both federal obligated amounts and any non-federal funding contributions."
                        arrow
                        placement="top"
                      >
                        <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                      </Tooltip>
                    </Box>
                    <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {formatCurrency(totalFunding)}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Basic Award Information */}
              <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                  Award Information
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Award ID
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {selectedAwardForDetails.award_id || 'N/A'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Award Type
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {selectedAwardForDetails.award_type || 'N/A'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Type
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {selectedAwardForDetails.is_assistance ? 'Financial Assistance' : 'Contract'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Fiscal Year
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {selectedAwardForDetails.fiscal_year || 'N/A'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      {selectedAwardForDetails.combined_obligated_amount && selectedAwardForDetails.award_or_idv_flag === 'IDV' 
                        ? 'Combined Obligated Amount' 
                        : 'Total Obligated Amount'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {formatCurrency(
                        selectedAwardForDetails.combined_obligated_amount || 
                        selectedAwardForDetails.total_obligated_amount || 
                        selectedAwardForDetails.total_obligation
                      )}
                      {selectedAwardForDetails.award_or_idv_flag === 'IDV' && !selectedAwardForDetails.combined_obligated_amount && (selectedAwardForDetails.total_obligated_amount === 0 || !selectedAwardForDetails.total_obligated_amount) && (
                        <Typography component="span" variant="caption" sx={{ color: '#94a3b8', ml: 1, fontStyle: 'italic' }}>
                          (IDV - see child awards)
                        </Typography>
                      )}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      {selectedAwardForDetails.award_or_idv_flag === 'IDV' && !selectedAwardForDetails.period_of_performance_current_end_date 
                        ? 'Ordering Period End Date' 
                        : 'Period End Date'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(
                        selectedAwardForDetails.period_of_performance_current_end_date || 
                        (selectedAwardForDetails.award_or_idv_flag === 'IDV' ? selectedAwardForDetails.ordering_period_end_date : null) ||
                        selectedAwardForDetails.period_end_date
                      )}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Period Start Date
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(selectedAwardForDetails.period_of_performance_start_date || selectedAwardForDetails.period_start_date)}
                    </Typography>
                  </Box>
                  {(selectedAwardForDetails.transaction_count !== undefined || selectedAwardForDetails.subaward_count !== undefined) && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Transactions / Subawards
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.transaction_count ?? 0} / {selectedAwardForDetails.subaward_count ?? 0}
                      </Typography>
                    </Box>
                  )}
                </Box>
                {selectedAwardForDetails.usaspending_permalink && (
                  <Box sx={{ mt: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      href={selectedAwardForDetails.usaspending_permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: '#3b82f6',
                        borderColor: '#3b82f6',
                        '&:hover': {
                          borderColor: '#60a5fa',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      View on USAspending.gov
                    </Button>
                  </Box>
                )}
              </Box>

              {/* Agency Information */}
              <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                  Agency Information
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                      Awarding Agency
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      {selectedAwardForDetails.awarding_agency_name || 'N/A'}
                    </Typography>
                    {selectedAwardForDetails.awarding_agency_code && (
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Code: {selectedAwardForDetails.awarding_agency_code}
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                      Funding Agency
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      {selectedAwardForDetails.funding_agency_name || 'N/A'}
                    </Typography>
                    {selectedAwardForDetails.funding_agency_code && (
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Code: {selectedAwardForDetails.funding_agency_code}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Recipient Information */}
              <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                  Recipient Information
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Recipient Name
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {selectedAwardForDetails.recipient_name || (selectedAwardForDetails.recipient_name_normalized ? selectedAwardForDetails.recipient_name_normalized.toUpperCase() : 'N/A')}
                    </Typography>
                  </Box>
                  {(selectedAwardForDetails.recipient_id || selectedAwardForDetails.recipient_uei) && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        {selectedAwardForDetails.recipient_uei ? 'UEI' : 'Recipient ID'}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {selectedAwardForDetails.recipient_uei || selectedAwardForDetails.recipient_id || 'N/A'}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Classification Codes */}
              <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                  Classification Codes
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  {selectedAwardForDetails.naics_code && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        NAICS Code
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {selectedAwardForDetails.naics_code}
                      </Typography>
                      {selectedAwardForDetails.naics_description && (
                        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                          {selectedAwardForDetails.naics_description}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {selectedAwardForDetails.psc_code && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        PSC Code
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {selectedAwardForDetails.psc_code}
                      </Typography>
                      {selectedAwardForDetails.psc_description && (
                        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                          {selectedAwardForDetails.psc_description}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {selectedAwardForDetails.cfda_number && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        CFDA Number
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {selectedAwardForDetails.cfda_number}
                      </Typography>
                      {selectedAwardForDetails.cfda_title && (
                        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                          {selectedAwardForDetails.cfda_title}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Transactions */}
              {selectedAwardForDetails.transactions && selectedAwardForDetails.transactions.length > 0 && (
                <Box sx={{ mb: 3, position: 'relative' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                      Transactions ({selectedAwardForDetails.transactions.length})
                    </Typography>
                    <Tooltip
                      title={
                        <Box>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            The data available here may not represent the full transaction history.
                          </Typography>
                          {selectedAwardForDetails.usaspending_permalink ? (
                            <Typography variant="body2">
                              For complete transaction history, please visit{' '}
                              <Box
                                component="a"
                                href={selectedAwardForDetails.usaspending_permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  color: '#60a5fa',
                                  textDecoration: 'underline',
                                  '&:hover': {
                                    color: '#93c5fd',
                                  },
                                }}
                              >
                                USAspending.gov
                              </Box>
                              .
                            </Typography>
                          ) : (
                            <Typography variant="body2">
                              For complete transaction history, please visit the official USAspending.gov website.
                            </Typography>
                          )}
                        </Box>
                      }
                      arrow
                      placement="left"
                    >
                      <WarningIcon 
                        sx={{ 
                          color: '#fbbf24', 
                          fontSize: '20px',
                          cursor: 'help',
                          '&:hover': {
                            color: '#f59e0b',
                          },
                        }} 
                      />
                    </Tooltip>
                  </Box>
                  <Box sx={{ 
                    maxHeight: '300px', 
                    overflowY: 'auto',
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
                  }}>
                    {selectedAwardForDetails.transactions.map((transaction: any, idx: number) => (
                      <Box
                        key={transaction.transaction_id || idx}
                        sx={{
                          p: 2,
                          mb: 1,
                          backgroundColor: 'rgba(30, 41, 59, 0.5)',
                          borderRadius: '4px',
                          border: '1px solid #374151',
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                          <strong>ID:</strong> {transaction.transaction_id || 'N/A'}
                        </Typography>
                        {transaction.action_date && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Date:</strong> {formatDate(transaction.action_date)}
                          </Typography>
                        )}
                        {transaction.federal_action_obligation && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Amount:</strong> {formatCurrency(parseFloat(transaction.federal_action_obligation))}
                          </Typography>
                        )}
                        {transaction.transaction_description && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Description:</strong> {transaction.transaction_description}
                          </Typography>
                        )}
                        {transaction.action_type && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                            <strong>Type:</strong> {transaction.action_type}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Child Awards (for IDV parents) */}
              {selectedAwardForDetails.is_idv_parent && selectedAwardForDetails.child_awards_details && selectedAwardForDetails.child_awards_details.length > 0 && (
                <Box sx={{ mb: 3, position: 'relative' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                      Child Awards ({selectedAwardForDetails.child_awards_details.length})
                    </Typography>
                    <Tooltip
                      title={
                        <Box>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            Child awards (delivery orders) issued under this IDV. Each child award is a separate contract with its own transactions and obligations.
                          </Typography>
                          {selectedAwardForDetails.usaspending_permalink && (
                            <Typography variant="body2">
                              For complete child award details, please visit{' '}
                              <Box
                                component="a"
                                href={selectedAwardForDetails.usaspending_permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  color: '#60a5fa',
                                  textDecoration: 'underline',
                                  '&:hover': {
                                    color: '#93c5fd',
                                  },
                                }}
                              >
                                USAspending.gov
                              </Box>
                              .
                            </Typography>
                          )}
                        </Box>
                      }
                      arrow
                      placement="left"
                    >
                      <InfoIcon 
                        sx={{ 
                          color: '#3b82f6', 
                          fontSize: '20px',
                          cursor: 'help',
                          '&:hover': {
                            color: '#60a5fa',
                          },
                        }} 
                      />
                    </Tooltip>
                  </Box>
                  <Box sx={{ 
                    maxHeight: '400px', 
                    overflowY: 'auto',
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
                  }}>
                    {selectedAwardForDetails.child_awards_details.map((childAward: any, idx: number) => (
                      <Box
                        key={childAward.award_id || idx}
                        sx={{
                          p: 2,
                          mb: 1,
                          backgroundColor: 'rgba(30, 41, 59, 0.5)',
                          borderRadius: '4px',
                          border: '1px solid #374151',
                          cursor: 'pointer',
                          '&:hover': {
                            backgroundColor: 'rgba(30, 41, 59, 0.7)',
                            borderColor: '#3b82f6',
                          },
                        }}
                        onClick={() => {
                          // Store current award as parent before switching
                          if (selectedAwardForDetails) {
                            setParentAwardForDetails(selectedAwardForDetails);
                          }
                          setSelectedAwardForDetails(childAward as GovtContractAward);
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Box>
                            {childAward.award_id_piid && (
                              <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5, fontFamily: 'monospace' }}>
                                <strong>PIID:</strong> {childAward.award_id_piid}
                              </Typography>
                            )}
                            {childAward.description && (
                              <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                                <strong>Description:</strong> {childAward.description}
                              </Typography>
                            )}
                            {childAward.award_type_description && (
                              <Typography variant="body2" sx={{ color: '#94a3b8', mb: 0.5 }}>
                                {childAward.award_type_description}
                              </Typography>
                            )}
                          </Box>
                          {childAward.total_obligated_amount && (
                            <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                              {formatCurrency(parseFloat(childAward.total_obligated_amount.toString()))}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                          {childAward.recipient_name && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>Recipient:</strong> {childAward.recipient_name}
                            </Typography>
                          )}
                          {childAward.awarding_agency_name && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>Agency:</strong> {childAward.awarding_agency_name}
                            </Typography>
                          )}
                          {childAward.period_of_performance_start_date && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>Start:</strong> {formatDate(String(childAward.period_of_performance_start_date))}
                            </Typography>
                          )}
                          {childAward.period_of_performance_current_end_date && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>End:</strong> {formatDate(String(childAward.period_of_performance_current_end_date))}
                            </Typography>
                          )}
                          {childAward.transaction_count !== undefined && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>Transactions:</strong> {childAward.transaction_count}
                            </Typography>
                          )}
                          {childAward.subaward_count !== undefined && (
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                              <strong>Subawards:</strong> {childAward.subaward_count}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Subawards */}
              {selectedAwardForDetails.subawards && selectedAwardForDetails.subawards.length > 0 && (
                <Box sx={{ mb: 3, position: 'relative' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                      Subawards ({selectedAwardForDetails.subawards.length})
                    </Typography>
                    <Tooltip
                      title={
                        <Box>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            The data available here may not represent the full subaward history.
                          </Typography>
                          {selectedAwardForDetails.usaspending_permalink ? (
                            <Typography variant="body2">
                              For complete subaward history, please visit{' '}
                              <Box
                                component="a"
                                href={selectedAwardForDetails.usaspending_permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  color: '#60a5fa',
                                  textDecoration: 'underline',
                                  '&:hover': {
                                    color: '#93c5fd',
                                  },
                                }}
                              >
                                USAspending.gov
                              </Box>
                              .
                            </Typography>
                          ) : (
                            <Typography variant="body2">
                              For complete subaward history, please visit the official USAspending.gov website.
                            </Typography>
                          )}
                        </Box>
                      }
                      arrow
                      placement="left"
                    >
                      <WarningIcon 
                        sx={{ 
                          color: '#fbbf24', 
                          fontSize: '20px',
                          cursor: 'help',
                          '&:hover': {
                            color: '#f59e0b',
                          },
                        }} 
                      />
                    </Tooltip>
                  </Box>
                  <Box sx={{ 
                    maxHeight: '300px', 
                    overflowY: 'auto',
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
                  }}>
                    {selectedAwardForDetails.subawards.map((subaward: any, idx: number) => (
                      <Box
                        key={subaward.subaward_id || idx}
                        sx={{
                          p: 2,
                          mb: 1,
                          backgroundColor: 'rgba(30, 41, 59, 0.5)',
                          borderRadius: '4px',
                          border: '1px solid #374151',
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                          <strong>ID:</strong> {subaward.subaward_id || 'N/A'}
                        </Typography>
                        {subaward.subawardee_name && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Recipient:</strong> {subaward.subawardee_name}
                          </Typography>
                        )}
                        {subaward.subaward_amount && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Amount:</strong> {formatCurrency(parseFloat(subaward.subaward_amount))}
                          </Typography>
                        )}
                        {subaward.subaward_date && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                            <strong>Date:</strong> {formatDate(subaward.subaward_date)}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Description */}
              {selectedAwardForDetails.description && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', mb: 1, fontWeight: 600 }}>
                    Description
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                    {selectedAwardForDetails.description}
                  </Typography>
                </Box>
              )}
            </Box>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => {
              setDetailsDialogOpen(false);
              setParentAwardForDetails(null);
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

