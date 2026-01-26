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
import { useAuth } from '../../contexts/AuthContext';
import { filesystemAPI } from '../../services/api';
import { 
  ldaSearchAPI, 
  ldaAutocompleteAPI,
  LDASearchFilters,
  LDAFiling,
  LDAAutocompleteItem 
} from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, getIconByName, getDefaultIconForTileType } from './common';
import { addLDAFilingToContext, addMultipleLDAFilingsToContext } from './common/contextManager';
import { getTileMaxPages, getTileMaxPaginationKeys } from './config/tileConfig';

// Minimum date for date filters (January 1, 2000)
const MIN_DATE = '2000-01-01';
import MultiSelectField from '../MultiSelectField';
import { Collapse } from '@mui/material';
import { KeyboardArrowDown as KeyboardArrowDownIcon, KeyboardArrowUp as KeyboardArrowUpIcon } from '@mui/icons-material';

// US States
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

interface LDASearchTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  isDeletingTiles?: boolean;
  onResize?: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
  // LDA specific props
  searchParams?: LDASearchFilters;
  filterSettings?: {
    registrants?: string[];
    clients?: string[];
    lobbyists?: string[];
    filingTypes?: string[];
    issueCodes?: string[];
    states?: string[];
  };
  results?: LDAFiling[];
  displayOptions?: {
    showFilingType: boolean;
    showFilingPeriod: boolean;
    showFilingYear: boolean;
    showRegistrant: boolean;
    showClient: boolean;
    showAmount: boolean;
    showDatePosted: boolean;
    showState: boolean;
    showResultsTable: boolean;
    maxResults: number;
    compactView: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const LDASearchTile: React.FC<LDASearchTileProps> = ({
  id,
  size,
  dashboardContext,
  onRemove,
  onUpdate,
  onSettingsChange,
  isDeletingTiles = false,
  onDragStart,
  isDragging = false,
  isResizing = false,
  isSelected = false,
  onSelectionChange,
  searchParams = {
    general_text_search: [],
    date_from: '',
    date_to: '',
    amount_min: undefined,
    amount_max: undefined,
  },
  filterSettings: initialFilterSettings,
  results = [],
  displayOptions = {
    showFilingType: true,
    showFilingPeriod: true,
    showFilingYear: true,
    showRegistrant: true,
    showClient: true,
    showAmount: true,
    showDatePosted: true,
    showState: true,
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
  const { openItemDetails } = useDialogManagerHelpers();
  // const { activeSessionId } = useGlobalChat();
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  
  // General issues and government entities loaded from local CSV files
  const [generalIssues, setGeneralIssues] = useState<string[]>([]);
  const [governmentEntities, setGovernmentEntities] = useState<string[]>([]);
  
  // Filter state for client-side filtering - restore from props if available (session persistence)
  const [allResults, setAllResults] = useState<LDAFiling[]>(results || []);
  const [filteredResults, setFilteredResults] = useState<LDAFiling[]>(results || []);
  const [selectedFilters, setSelectedFilters] = useState<{
    registrants: Set<string>;
    clients: Set<string>;
    lobbyists: Set<string>;
    filingTypes: Set<string>;
    issueCodes: Set<string>;
    states: Set<string>;
  }>(() => {
    const initial = {
      registrants: new Set(initialFilterSettings?.registrants || []),
      clients: new Set(initialFilterSettings?.clients || []),
      lobbyists: new Set(initialFilterSettings?.lobbyists || []),
      filingTypes: new Set(initialFilterSettings?.filingTypes || []),
      issueCodes: new Set(initialFilterSettings?.issueCodes || []),
      states: new Set(initialFilterSettings?.states || []),
    };
    console.log('🔄 LDASearchTile: Initializing selectedFilters from props', {
      tileId: id,
      initialFilterSettings,
      initializedFilters: {
        registrants: Array.from(initial.registrants),
        clients: Array.from(initial.clients),
        lobbyists: Array.from(initial.lobbyists),
        filingTypes: Array.from(initial.filingTypes),
        issueCodes: Array.from(initial.issueCodes),
        states: Array.from(initial.states),
      },
    });
    return initial;
  });
  
  // Sync filterSettings prop to state (only if actually different)
  useEffect(() => {
    console.log('🔄 LDASearchTile: filterSettings sync effect triggered', {
      tileId: id,
      initialFilterSettings,
    });
    if (initialFilterSettings) {
      setSelectedFilters(prev => {
        const newFilters = {
          registrants: new Set(initialFilterSettings.registrants || []),
          clients: new Set(initialFilterSettings.clients || []),
          lobbyists: new Set(initialFilterSettings.lobbyists || []),
          filingTypes: new Set(initialFilterSettings.filingTypes || []),
          issueCodes: new Set(initialFilterSettings.issueCodes || []),
          states: new Set(initialFilterSettings.states || []),
        };
        // Check if filters actually changed
        const prevAll = JSON.stringify({
          registrants: Array.from(prev.registrants).sort(),
          clients: Array.from(prev.clients).sort(),
          lobbyists: Array.from(prev.lobbyists).sort(),
          filingTypes: Array.from(prev.filingTypes).sort(),
          issueCodes: Array.from(prev.issueCodes).sort(),
          states: Array.from(prev.states).sort(),
        });
        const newAll = JSON.stringify({
          registrants: Array.from(newFilters.registrants).sort(),
          clients: Array.from(newFilters.clients).sort(),
          lobbyists: Array.from(newFilters.lobbyists).sort(),
          filingTypes: Array.from(newFilters.filingTypes).sort(),
          issueCodes: Array.from(newFilters.issueCodes).sort(),
          states: Array.from(newFilters.states).sort(),
        });
        if (prevAll === newAll) {
          console.log('🔄 LDASearchTile: filterSettings unchanged, skipping update', {
            tileId: id,
            currentFilters: prevAll,
            newFilters: newAll,
          });
          return prev;
        }
        console.log('🔄 LDASearchTile: Updating selectedFilters from filterSettings prop', {
          tileId: id,
          previousFilters: prevAll,
          newFilters: newAll,
        });
        return newFilters;
      });
    } else {
      console.log('🔄 LDASearchTile: No initialFilterSettings prop provided', {
        tileId: id,
      });
    }
  }, [initialFilterSettings, id]);

  // Filters are client-side only - not persisted to dashboard

  const [selectedFilings, setSelectedFilings] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchParams, setCurrentSearchParams] = useState<LDASearchFilters>(searchParams);
  const [currentResults, setCurrentResults] = useState<LDAFiling[]>(results);
  
  // Initialize generalSearchItems from searchParams on mount (for restoration after refresh)
  const initializeGeneralSearchItems = (params: LDASearchFilters): LDAAutocompleteItem[] => {
    const items: LDAAutocompleteItem[] = [];
    if (params?.general_text_search_fields) {
      if (Array.isArray(params.general_text_search_fields.registrant) && params.general_text_search_fields.registrant.length > 0) {
        params.general_text_search_fields.registrant.forEach(value => {
          items.push({ value, type: 'registrant', label: value });
        });
      }
      if (Array.isArray(params.general_text_search_fields.client) && params.general_text_search_fields.client.length > 0) {
        params.general_text_search_fields.client.forEach(value => {
          items.push({ value, type: 'client', label: value });
        });
      }
      if (Array.isArray(params.general_text_search_fields.lobbyist) && params.general_text_search_fields.lobbyist.length > 0) {
        params.general_text_search_fields.lobbyist.forEach(value => {
          items.push({ value, type: 'lobbyist', label: value });
        });
      }
      if (Array.isArray(params.general_text_search_fields.pac) && params.general_text_search_fields.pac.length > 0) {
        params.general_text_search_fields.pac.forEach(value => {
          items.push({ value, type: 'pac', label: value });
        });
      }
      if (Array.isArray(params.general_text_search_fields.foreign) && params.general_text_search_fields.foreign.length > 0) {
        params.general_text_search_fields.foreign.forEach(value => {
          items.push({ value, type: 'foreign', label: value });
        });
      }
    }
    return items;
  };
  
  const [generalSearchItems, setGeneralSearchItems] = useState<LDAAutocompleteItem[]>(() => initializeGeneralSearchItems(searchParams));
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>([]);
  const [pageCount, setPageCount] = useState<number>(0); // Track additional pages loaded (0 = initial search only, 1-4 = additional pages)
  const [hasMore, setHasMore] = useState<boolean>(false);
  
  // Tile pagination configuration
  const MAX_PAGES = getTileMaxPages('lda_disclosures');
  const MAX_PAGINATION_KEYS = getTileMaxPaginationKeys('lda_disclosures');
  
  const defaultDisplayOptions = {
    showFilingType: true,
    showFilingPeriod: true,
    showFilingYear: true,
    showRegistrant: true,
    showClient: true,
    showAmount: true,
    showDatePosted: true,
    showState: true,
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
    'filing_type',
    'filing_period',
    'filing_year',
    'registrant',
    'client',
    'amount',
    'date_posted',
    'state',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['filing_type', 'filing_period', 'filing_year', 'registrant', 'client', 'amount', 'date_posted', 'state'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    // Convert display options to column array
    const cols: string[] = [];
    if (localDisplayOptions.showFilingType) cols.push('filing_type');
    if (localDisplayOptions.showFilingPeriod) cols.push('filing_period');
    if (localDisplayOptions.showFilingYear) cols.push('filing_year');
    if (localDisplayOptions.showRegistrant) cols.push('registrant');
    if (localDisplayOptions.showClient) cols.push('client');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showDatePosted) cols.push('date_posted');
    if (localDisplayOptions.showState) cols.push('state');
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
        showFilingType: newColumns.includes('filing_type'),
        showFilingPeriod: newColumns.includes('filing_period'),
        showFilingYear: newColumns.includes('filing_year'),
        showRegistrant: newColumns.includes('registrant'),
        showClient: newColumns.includes('client'),
        showAmount: newColumns.includes('amount'),
        showDatePosted: newColumns.includes('date_posted'),
        showState: newColumns.includes('state'),
      };
      // Update via onSettingsChange - this will update props, which will update localDisplayOptions via useMemo
      onSettingsChange(id, { displayOptions: newDisplayOptions });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);

  // Sync visibleColumns with localDisplayOptions when it changes (from props or internal updates)
  useEffect(() => {
    const cols: string[] = [];
    if (localDisplayOptions.showFilingType) cols.push('filing_type');
    if (localDisplayOptions.showFilingPeriod) cols.push('filing_period');
    if (localDisplayOptions.showFilingYear) cols.push('filing_year');
    if (localDisplayOptions.showRegistrant) cols.push('registrant');
    if (localDisplayOptions.showClient) cols.push('client');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showDatePosted) cols.push('date_posted');
    if (localDisplayOptions.showState) cols.push('state');
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
  }, [localDisplayOptions.showFilingType, localDisplayOptions.showFilingPeriod, localDisplayOptions.showFilingYear, localDisplayOptions.showRegistrant, localDisplayOptions.showClient, localDisplayOptions.showAmount, localDisplayOptions.showDatePosted, localDisplayOptions.showState]); // Depend on individual properties to avoid object reference issues

  // const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`lda_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const [isPageSizeManuallySet] = useState(() => {
    return localStorage.getItem(`lda_pageSize_${id}`) !== null;
  });
  const tileRef = useRef<HTMLDivElement>(null);

  // Helper function to clean double quotes from CSV values
  const cleanCSVValue = useCallback((value: string): string => {
    return value.trim().replace(/^"+|"+$/g, '');
  }, []);

  // Load general issues and government entities from local CSV files
  useEffect(() => {
    const loadCSVData = async () => {
      try {
        // Load general issues CSV
        const generalIssuesResponse = await fetch('/data/general_issues.csv');
        if (generalIssuesResponse.ok) {
          const text = await generalIssuesResponse.text();
          const lines = text.split('\n')
            .filter(line => line.trim() && !line.startsWith('value'))
            .map(line => cleanCSVValue(line))
            .filter(line => line.length > 0);
          setGeneralIssues(lines);
        }

        // Load government entities CSV
        const governmentEntitiesResponse = await fetch('/data/government_entities.csv');
        if (governmentEntitiesResponse.ok) {
          const text = await governmentEntitiesResponse.text();
          const lines = text.split('\n')
            .filter(line => line.trim() && !line.startsWith('value'))
            .map(line => cleanCSVValue(line))
            .filter(line => line.length > 0);
          setGovernmentEntities(lines);
        }
      } catch (error) {
        console.error('❌ Error loading CSV data:', error);
      }
    };
    loadCSVData();
  }, [cleanCSVValue]);

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

  // Advanced search expanded state
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState(false);

  const performSearch = useCallback(async (clearFilters: boolean = true) => {
    if (!currentSearchParams) return;
    
    console.log('📋 LDASearchTile: Starting search with params:', currentSearchParams, 'clearFilters:', clearFilters);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    // Clear client-side filters only on new search (not on refresh)
    if (clearFilters) {
      setSelectedFilters({
        registrants: new Set(),
        clients: new Set(),
        lobbyists: new Set(),
        filingTypes: new Set(),
        issueCodes: new Set(),
        states: new Set(),
      });
    }
    
    try {
      const filters: LDASearchFilters = { ...currentSearchParams };
      
      // Build general_text_search_fields from generalSearchItems
      if (generalSearchItems.length > 0) {
        const generalTextSearchFields: {
          registrant?: string[] | false;
          client?: string[] | false;
          lobbyist?: string[] | false;
          pac?: string[] | false;
          foreign?: string[] | false;
        } = {
          registrant: false,
          client: false,
          lobbyist: false,
          pac: false,
          foreign: false,
        };
        
        const itemsByType: Record<string, string[]> = {};
        generalSearchItems.forEach(item => {
          const type = item.type || 'unknown';
          if (!itemsByType[type]) {
            itemsByType[type] = [];
          }
          itemsByType[type].push(item.value);
        });
        
        if (itemsByType['registrant']) {
          generalTextSearchFields.registrant = itemsByType['registrant'];
        }
        if (itemsByType['client']) {
          generalTextSearchFields.client = itemsByType['client'];
        }
        if (itemsByType['lobbyist']) {
          generalTextSearchFields.lobbyist = itemsByType['lobbyist'];
        }
        if (itemsByType['pac']) {
          generalTextSearchFields.pac = itemsByType['pac'];
        }
        if (itemsByType['foreign']) {
          generalTextSearchFields.foreign = itemsByType['foreign'];
        }
        
        filters.general_text_search_fields = generalTextSearchFields;
      }

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        limit: 100, // Tile: fixed batch size of 100
      };
      
      const response = await ldaSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('📋 LDASearchTile: Retrieved', response.results.length, 'filings');
        
        // Handle last_evaluated_key: convert false/undefined to null, keep objects/truthy values
        const newLastEvaluatedKey = (response.last_evaluated_key && typeof response.last_evaluated_key === 'object') 
          ? response.last_evaluated_key 
          : null;
        setAllResults(response.results);
        setFilteredResults(response.results);
        setCurrentResults(response.results);
        setHasPerformedInitialSearch(true);
        
        // Limit pagination to 4 pages total (1 initial + 3 more)
        // Only set hasMore if we have a valid last_evaluated_key and haven't reached page limit
        const hasValidPaginationKey = newLastEvaluatedKey !== null && newLastEvaluatedKey !== undefined;
        const canLoadMore = (response.has_more || false) && hasValidPaginationKey;
        const hasReachedPageLimit = false; // Initial page, we haven't loaded any additional pages yet
        
        setHasMore(canLoadMore && !hasReachedPageLimit);
        setLastEvaluatedKey(newLastEvaluatedKey);
        setPageCount(0); // Initial search doesn't count as an additional page (0 = just initial, 1+ = additional pages)
        
        // Store pagination state - limit to MAX_PAGINATION_KEYS
        const newLastEvaluatedKeys = newLastEvaluatedKey ? [newLastEvaluatedKey].slice(0, MAX_PAGINATION_KEYS) : [];
        setLastEvaluatedKeys(newLastEvaluatedKeys);
        
        console.log('📋 LDASearchTile: Pagination state set', {
          hasMore: response.has_more,
          lastEvaluatedKey: newLastEvaluatedKey,
          lastEvaluatedKeys: newLastEvaluatedKeys,
        });
        
        // Persist search params only (no pagination state)
        onSettingsChange(id, {
          searchParams: currentSearchParams,
        });
        
        // Update parent component (no pagination state persistence)
        onUpdate(id, {
          lastUpdated: Date.now(),
        });
      } else {
        console.error('📋 LDASearchTile: Search failed');
        setError('Search failed');
        setCurrentResults([]);
        setHasMore(false);
        setHasPerformedInitialSearch(true);
        setLastEvaluatedKeys([]);
        // Persist search params only
        onSettingsChange(id, {
          searchParams: currentSearchParams,
        });
      }
    } catch (err: any) {
      console.error('📋 LDASearchTile: Search error:', err);
      setError(err.message || 'An error occurred during search');
      setCurrentResults([]);
      setHasPerformedInitialSearch(true);
      setHasMore(false);
      setLastEvaluatedKeys([]);
      // Persist search params only
      onSettingsChange(id, {
        searchParams: currentSearchParams,
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, onSettingsChange, generalSearchItems]);
  
  // Load more results
  const handleLoadMore = useCallback(async () => {
    // Check if we've reached the page limit (4 pages total)
    // pageCount represents additional pages loaded (0 = initial, 1-3 = additional)
    // MAX_PAGES = 4 means 4 total pages, so we stop when pageCount >= 3 (which means 4 total pages)
    if (pageCount >= MAX_PAGES - 1) {
      console.warn('📋 LDASearchTile: Load more blocked - reached maximum page limit', { 
        pageCount, 
        MAX_PAGES, 
        totalPages: pageCount + 1,
        maxTotalPages: MAX_PAGES 
      });
      setHasMore(false);
      return;
    }
    
    // Use lastEvaluatedKey if available, otherwise use the last key from lastEvaluatedKeys array
    // Handle case where lastEvaluatedKey might be false (boolean) - convert to null
    const validLastEvaluatedKey = (lastEvaluatedKey && typeof lastEvaluatedKey === 'object') ? lastEvaluatedKey : null;
    const keyToUse = validLastEvaluatedKey || (lastEvaluatedKeys && lastEvaluatedKeys.length > 0 ? lastEvaluatedKeys[lastEvaluatedKeys.length - 1] : null);
    
    if (!hasMore || !keyToUse || isLoadingMore || !currentSearchParams) {
      console.warn('📋 LDASearchTile: Load more blocked', {
        hasMore,
        keyToUse: keyToUse ? 'present' : 'missing',
        keyToUseType: typeof keyToUse,
        isLoadingMore,
        hasSearchParams: !!currentSearchParams,
        lastEvaluatedKey: lastEvaluatedKey ? (typeof lastEvaluatedKey === 'object' ? 'object' : typeof lastEvaluatedKey) : 'null/undefined',
        lastEvaluatedKeysLength: lastEvaluatedKeys?.length || 0,
      });
      
      // If hasMore is true but no key, this is a data inconsistency - log error
      if (hasMore && !keyToUse) {
        console.error('📋 LDASearchTile: Data inconsistency - hasMore is true but no pagination key available');
      }
      return;
    }
    
    console.log('📋 LDASearchTile: Loading more results with key:', keyToUse);
    setIsLoadingMore(true);
    setError(null);
    
    try {
      const filters: LDASearchFilters = { ...currentSearchParams };
      
      // Build general_text_search_fields from generalSearchItems
      if (generalSearchItems.length > 0) {
        const generalTextSearchFields: {
          registrant?: string[] | false;
          client?: string[] | false;
          lobbyist?: string[] | false;
          pac?: string[] | false;
          foreign?: string[] | false;
        } = {
          registrant: false,
          client: false,
          lobbyist: false,
          pac: false,
          foreign: false,
        };
        
        const itemsByType: Record<string, string[]> = {};
        generalSearchItems.forEach(item => {
          const type = item.type || 'unknown';
          if (!itemsByType[type]) {
            itemsByType[type] = [];
          }
          itemsByType[type].push(item.value);
        });
        
        if (itemsByType['registrant']) {
          generalTextSearchFields.registrant = itemsByType['registrant'];
        }
        if (itemsByType['client']) {
          generalTextSearchFields.client = itemsByType['client'];
        }
        if (itemsByType['lobbyist']) {
          generalTextSearchFields.lobbyist = itemsByType['lobbyist'];
        }
        if (itemsByType['pac']) {
          generalTextSearchFields.pac = itemsByType['pac'];
        }
        if (itemsByType['foreign']) {
          generalTextSearchFields.foreign = itemsByType['foreign'];
        }
        
        filters.general_text_search_fields = generalTextSearchFields;
      }

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const searchRequest = {
        filters,
        last_evaluated_key: keyToUse,
        limit: 100, // Tile: fixed batch size of 100
      };
      
      const response = await ldaSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        const updatedResults = [...allResults, ...response.results];
        // Handle last_evaluated_key: convert false/undefined to null, keep objects/truthy values
        const newLastEvaluatedKey = (response.last_evaluated_key && typeof response.last_evaluated_key === 'object') 
          ? response.last_evaluated_key 
          : null;
        setAllResults(updatedResults);
        // Don't set filteredResults/currentResults here - let applyFilters handle it after allResults updates
        // This ensures filters are properly applied and prevents duplicates
        
        // Update page count - calculate first, then set
        // pageCount represents additional pages loaded (0 = just initial, 1+ = additional pages)
        const newPageCount = pageCount + 1;
        console.log('📋 LDASearchTile: Updating pageCount', {
          currentPageCount: pageCount,
          newPageCount,
          lastEvaluatedKeysLength: lastEvaluatedKeys.length,
        });
        setPageCount(newPageCount);
        
        // Only set hasMore if we have a valid last_evaluated_key and haven't reached page limit
        // If backend says has_more but provides no key, we can't actually load more
        // newPageCount represents additional pages loaded (0 = initial, 1-3 = additional)
        // MAX_PAGES = 4 means 4 total pages, so we stop when newPageCount >= 3 (which means 4 total pages)
        const hasValidPaginationKey = newLastEvaluatedKey !== null && newLastEvaluatedKey !== undefined;
        const canLoadMore = (response.has_more || false) && hasValidPaginationKey;
        const hasReachedPageLimit = newPageCount >= MAX_PAGES - 1;
        
        setHasMore(canLoadMore && !hasReachedPageLimit);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Update lastEvaluatedKeys array - limit to MAX_PAGINATION_KEYS (3 keys for pages 2, 3, 4)
        const updatedKeys = newLastEvaluatedKey 
          ? [...lastEvaluatedKeys, newLastEvaluatedKey].slice(0, MAX_PAGINATION_KEYS)
          : lastEvaluatedKeys;
        setLastEvaluatedKeys(updatedKeys);
        
        console.log('📋 LDASearchTile: Load more pagination state updated', {
          hasMore: response.has_more,
          lastEvaluatedKey: newLastEvaluatedKey,
          lastEvaluatedKeysLength: updatedKeys.length,
        });
        
        // Update parent component (no pagination state persistence)
        onUpdate(id, {
          lastUpdated: Date.now(),
        });
      } else {
        console.error('📋 LDASearchTile: Load more failed');
        setError('Load more failed');
        setHasMore(false);
      }
    } catch (err: any) {
      console.error('📋 LDASearchTile: Load more error:', err);
      setError(err.message || 'An error occurred while loading more results');
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange, generalSearchItems, pageCount, MAX_PAGES]);

  // No pagination state restoration - on refresh, only show first batch
  // Removed restorePaginationState function - tiles now just perform fresh searches on mount

  // Removed restore pagination logic - tiles now just perform fresh searches on mount

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

  // Sync searchParams from props (when restored from backend)
  useEffect(() => {
    if (searchParams && JSON.stringify(searchParams) !== JSON.stringify(currentSearchParams)) {
      console.log('🔄 LDASearchTile: Syncing searchParams from props');
      isSyncingFromPropsRef.current = true; // Mark that we're syncing from props
      setCurrentSearchParams(searchParams);
      
      // Rebuild generalSearchItems from searchParams using the same helper function
      const newGeneralSearchItems = initializeGeneralSearchItems(searchParams);
      console.log('🔄 LDASearchTile: Rebuilt generalSearchItems from props:', newGeneralSearchItems.length, 'items', newGeneralSearchItems);
      setGeneralSearchItems(newGeneralSearchItems);
    }
  }, [searchParams]); // Sync when searchParams prop changes

  // Note: Removed redundant useEffects that were just setting state
  // The main restorePaginationState function (called from line 1058 useEffect) handles all restoration

  // Preview mode: Run fresh query when opened in preview ONLY if no results exist
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      // Skip fresh query if tile already has results (preserve existing state)
      if (currentResults.length > 0) {
        console.log('🔄 LDASearchTile: Preview mode - preserving existing results (count:', currentResults.length, ')');
        return;
      }
      
      const hasSearchCriteria = 
        (currentSearchParams.general_text_search && currentSearchParams.general_text_search.length > 0) ||
        (currentSearchParams.general_text_search_fields && (
          (currentSearchParams.general_text_search_fields.registrant && Array.isArray(currentSearchParams.general_text_search_fields.registrant) && currentSearchParams.general_text_search_fields.registrant.length > 0) ||
          (currentSearchParams.general_text_search_fields.client && Array.isArray(currentSearchParams.general_text_search_fields.client) && currentSearchParams.general_text_search_fields.client.length > 0) ||
          (currentSearchParams.general_text_search_fields.lobbyist && Array.isArray(currentSearchParams.general_text_search_fields.lobbyist) && currentSearchParams.general_text_search_fields.lobbyist.length > 0) ||
          (currentSearchParams.general_text_search_fields.pac && Array.isArray(currentSearchParams.general_text_search_fields.pac) && currentSearchParams.general_text_search_fields.pac.length > 0) ||
          (currentSearchParams.general_text_search_fields.foreign && Array.isArray(currentSearchParams.general_text_search_fields.foreign) && currentSearchParams.general_text_search_fields.foreign.length > 0)
        )) ||
        (currentSearchParams.registrant_name && currentSearchParams.registrant_name.length > 0) ||
        (currentSearchParams.client_name && currentSearchParams.client_name.length > 0) ||
        (currentSearchParams.lobbyist_name && currentSearchParams.lobbyist_name.length > 0) ||
        (currentSearchParams.foreign_entity_name && currentSearchParams.foreign_entity_name.length > 0) ||
        (currentSearchParams.general_issue_code && currentSearchParams.general_issue_code.length > 0) ||
        (currentSearchParams.government_entity && currentSearchParams.government_entity.length > 0) ||
        (currentSearchParams.filing_period && currentSearchParams.filing_period.length > 0) ||
        currentSearchParams.date_from ||
        currentSearchParams.date_to ||
        currentSearchParams.amount_min !== undefined ||
        currentSearchParams.amount_max !== undefined;
      
      if (hasSearchCriteria) {
        console.log('🔄 LDASearchTile: Preview mode - running fresh query (no pagination state)');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist and we have search criteria
  // Results are NOT saved - always fetch fresh using searchParams
  // Only run if no results exist (to prevent duplicate calls)
  useEffect(() => {
    // Only run initial load if:
    // 1. No results exist yet
    // 2. Not already loading or restoring
    if (!hasPerformedInitialSearch && 
        currentResults.length === 0 && 
        allResults.length === 0 && 
        !isLoading) {
      console.log('🔄 LDASearchTile: Initial load useEffect triggered (no pagination state)');
      const hasSearchCriteria = 
        (currentSearchParams.general_text_search && currentSearchParams.general_text_search.length > 0) ||
        (currentSearchParams.general_text_search_fields && (
          (currentSearchParams.general_text_search_fields.registrant && Array.isArray(currentSearchParams.general_text_search_fields.registrant) && currentSearchParams.general_text_search_fields.registrant.length > 0) ||
          (currentSearchParams.general_text_search_fields.client && Array.isArray(currentSearchParams.general_text_search_fields.client) && currentSearchParams.general_text_search_fields.client.length > 0) ||
          (currentSearchParams.general_text_search_fields.lobbyist && Array.isArray(currentSearchParams.general_text_search_fields.lobbyist) && currentSearchParams.general_text_search_fields.lobbyist.length > 0) ||
          (currentSearchParams.general_text_search_fields.pac && Array.isArray(currentSearchParams.general_text_search_fields.pac) && currentSearchParams.general_text_search_fields.pac.length > 0) ||
          (currentSearchParams.general_text_search_fields.foreign && Array.isArray(currentSearchParams.general_text_search_fields.foreign) && currentSearchParams.general_text_search_fields.foreign.length > 0)
        )) ||
        (currentSearchParams.registrant_name && currentSearchParams.registrant_name.length > 0) ||
        (currentSearchParams.client_name && currentSearchParams.client_name.length > 0) ||
        (currentSearchParams.lobbyist_name && currentSearchParams.lobbyist_name.length > 0) ||
        (currentSearchParams.foreign_entity_name && currentSearchParams.foreign_entity_name.length > 0) ||
        (currentSearchParams.general_issue_code && currentSearchParams.general_issue_code.length > 0) ||
        (currentSearchParams.government_entity && currentSearchParams.government_entity.length > 0) ||
        (currentSearchParams.item_type && currentSearchParams.item_type.length > 0) ||
        currentSearchParams.date_from ||
        currentSearchParams.date_to ||
        currentSearchParams.amount_min !== undefined ||
        currentSearchParams.amount_max !== undefined;
      
      if (hasSearchCriteria) {
        console.log('🔄 LDASearchTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - check conditions inside

  const handleRemove = () => {
    onRemove(id);
  };

  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToFiles = () => {
    if (selectedFilings.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const isSavingToFilesRef = useRef(false);
  
  const handleFileBrowserSelect = useCallback(async (folderPath: string) => {
    if (!user || selectedFilings.size === 0) return;
    
    // Prevent multiple simultaneous saves
    if (isSavingToFilesRef.current) {
      console.warn('📋 LDASearchTile: Save operation already in progress, ignoring duplicate call');
      return;
    }
    
    isSavingToFilesRef.current = true;
    
    try {
      // Clear selection immediately to prevent re-triggering
      const filingsToSave = new Set(selectedFilings);
      setSelectedFilings(new Set());
      
      const selectedFilingObjects = currentResults.filter(filing => 
        filingsToSave.has(filing.id || filing.filing_uuid || filing.PK || '')
      );

      // Save all filings to the filesystem with FULL data using bulk operation
      const items = selectedFilingObjects.map(filing => {
        const filingId = filing.id || filing.filing_uuid || `filing_${Date.now()}`;
        const title = filing.registrant_name 
          ? `LDA Filing - ${filing.registrant_name}${filing.client_name ? ` / ${filing.client_name}` : ''}`
          : `LDA Filing ${filingId}`;
        return {
          context_data: filing, // Full filing object with all fields
          title: title,
          item_type: 'lda_disclosure' as const,
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
        console.log(`✅ Saved ${result?.succeeded || selectedFilingObjects.length} of ${selectedFilingObjects.length} filing(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} filing(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save filings');
      }
    } catch (error) {
      console.error('Error saving filings to filesystem:', error);
    } finally {
      isSavingToFilesRef.current = false;
    }
  }, [user, selectedFilings, currentResults]);

  const handleAddToContext = () => {
    const selectedFilingObjects = currentResults.filter(filing => 
      selectedFilings.has(filing.id || filing.filing_uuid || filing.PK || '')
    );

    if (selectedFilingObjects.length === 0) return;

    if (selectedFilingObjects.length === 1) {
      // Add single filing to context
      addLDAFilingToContext(selectedFilingObjects[0]);
    } else {
      // Add multiple filings to context
      addMultipleLDAFilingsToContext(selectedFilingObjects);
    }

    setSelectedFilings(new Set());
    handleContextMenuClose();
  };

  
  const handleRefresh = useCallback(async () => {
    // Simple refresh: just perform a fresh search with current search params
    await performSearch();
  }, [performSearch]);

  // Client-side filtering function
  const applyFilters = useCallback(() => {
    let filtered = [...allResults];
    
    // Filter by registrants
    if (selectedFilters.registrants.size > 0) {
      filtered = filtered.filter(filing => 
        filing.registrant_name && selectedFilters.registrants.has(filing.registrant_name)
      );
    }
    
    // Filter by clients
    if (selectedFilters.clients.size > 0) {
      filtered = filtered.filter(filing =>
        filing.client_name && selectedFilters.clients.has(filing.client_name)
      );
    }
    
    // Filter by lobbyists
    if (selectedFilters.lobbyists.size > 0) {
      filtered = filtered.filter(filing =>
        filing.lobbyist_name && selectedFilters.lobbyists.has(filing.lobbyist_name)
      );
    }
    
    // Filter by filing types
    if (selectedFilters.filingTypes.size > 0) {
      filtered = filtered.filter(filing =>
        filing.report_type && selectedFilters.filingTypes.has(filing.report_type)
      );
    }
    
    // Filter by issue codes
    if (selectedFilters.issueCodes.size > 0) {
      filtered = filtered.filter(filing =>
        filing.general_issue_code && selectedFilters.issueCodes.has(filing.general_issue_code)
      );
    }
    
    // Filter by states
    if (selectedFilters.states.size > 0) {
      filtered = filtered.filter(filing =>
        filing.state && selectedFilters.states.has(filing.state)
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
  // Filters are client-side only - not persisted to dashboard

  // Refs for managing sync and persistence
  const isSyncingFromPropsRef = useRef(false);
  const prevSearchParamsRef = useRef<LDASearchFilters>(currentSearchParams);

  // Sync generalSearchItems to currentSearchParams.general_text_search_fields
  // Skip this sync when we're syncing from props to avoid overwriting
  useEffect(() => {
    if (isSyncingFromPropsRef.current) {
      return; // Don't sync when syncing from props
    }
    
    if (generalSearchItems.length > 0) {
      const generalTextSearchFields: {
        registrant?: string[] | false;
        client?: string[] | false;
        lobbyist?: string[] | false;
        pac?: string[] | false;
        foreign?: string[] | false;
      } = {
        registrant: false,
        client: false,
        lobbyist: false,
        pac: false,
        foreign: false,
      };
      
      const itemsByType: Record<string, string[]> = {};
      generalSearchItems.forEach(item => {
        const type = item.type || 'unknown';
        if (!itemsByType[type]) {
          itemsByType[type] = [];
        }
        itemsByType[type].push(item.value);
      });
      
      if (itemsByType['registrant']) {
        generalTextSearchFields.registrant = itemsByType['registrant'];
      }
      if (itemsByType['client']) {
        generalTextSearchFields.client = itemsByType['client'];
      }
      if (itemsByType['lobbyist']) {
        generalTextSearchFields.lobbyist = itemsByType['lobbyist'];
      }
      if (itemsByType['pac']) {
        generalTextSearchFields.pac = itemsByType['pac'];
      }
      if (itemsByType['foreign']) {
        generalTextSearchFields.foreign = itemsByType['foreign'];
      }
      
      setCurrentSearchParams(prev => ({
        ...prev,
        general_text_search_fields: generalTextSearchFields
      }));
    } else {
      // Clear general_text_search_fields if generalSearchItems is empty
      setCurrentSearchParams(prev => ({
        ...prev,
        general_text_search_fields: {
          registrant: false,
          client: false,
          lobbyist: false,
          pac: false,
          foreign: false,
        }
      }));
    }
  }, [generalSearchItems]);

  // Persist searchParams when they change (but not when syncing from props)
  useEffect(() => {
    // Skip persistence if we're currently syncing from props to avoid overwriting with stale data
    if (isSyncingFromPropsRef.current) {
      console.log('⏭️ LDASearchTile: Skipping persistence (syncing from props)');
      isSyncingFromPropsRef.current = false;
      prevSearchParamsRef.current = currentSearchParams; // Update ref to match new value
      return;
    }
    // Only persist if searchParams actually changed (deep comparison)
    const hasChanged = JSON.stringify(prevSearchParamsRef.current) !== JSON.stringify(currentSearchParams);
    if (hasChanged) {
      console.log('💾 LDASearchTile: Persisting searchParams:', {
        tileId: id,
        searchParams: currentSearchParams,
        general_text_search_fields: currentSearchParams.general_text_search_fields
      });
      prevSearchParamsRef.current = currentSearchParams;
      onSettingsChange(id, { searchParams: currentSearchParams });
    } else {
      console.log('➡️ LDASearchTile: searchParams unchanged, skipping persistence');
    }
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
    if (localDisplayOptions.showFilingType) cols.push('filing_type');
    if (localDisplayOptions.showFilingPeriod) cols.push('filing_period');
    if (localDisplayOptions.showFilingYear) cols.push('filing_year');
    if (localDisplayOptions.showRegistrant) cols.push('registrant');
    if (localDisplayOptions.showClient) cols.push('client');
    if (localDisplayOptions.showAmount) cols.push('amount');
    if (localDisplayOptions.showDatePosted) cols.push('date_posted');
    if (localDisplayOptions.showState) cols.push('state');
    if (cols.length > 0) {
      setVisibleColumns(cols);
    }
  }, [localDisplayOptions]);

  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const registrantMap = new Map<string, number>();
    const clientMap = new Map<string, number>();
    const lobbyistMap = new Map<string, number>();
    const filingTypeMap = new Map<string, number>();
    const issueCodeMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    
    allResults.forEach(filing => {
      if (filing.registrant_name) {
        registrantMap.set(filing.registrant_name, (registrantMap.get(filing.registrant_name) || 0) + 1);
      }
      if (filing.client_name) {
        clientMap.set(filing.client_name, (clientMap.get(filing.client_name) || 0) + 1);
      }
      if (filing.lobbyist_name) {
        lobbyistMap.set(filing.lobbyist_name, (lobbyistMap.get(filing.lobbyist_name) || 0) + 1);
      }
      if (filing.report_type) {
        filingTypeMap.set(filing.report_type, (filingTypeMap.get(filing.report_type) || 0) + 1);
      }
      if (filing.general_issue_code) {
        issueCodeMap.set(filing.general_issue_code, (issueCodeMap.get(filing.general_issue_code) || 0) + 1);
      }
      if (filing.state) {
        stateMap.set(filing.state, (stateMap.get(filing.state) || 0) + 1);
      }
    });
    
    return {
      registrants: Array.from(registrantMap.entries())
        .map(([registrant, count]) => ({ registrant, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50),
      clients: Array.from(clientMap.entries())
        .map(([client, count]) => ({ client, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50),
      lobbyists: Array.from(lobbyistMap.entries())
        .map(([lobbyist, count]) => ({ lobbyist, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50),
      filingTypes: Array.from(filingTypeMap.entries())
        .map(([filingType, count]) => ({ filingType, count }))
        .sort((a, b) => b.count - a.count),
      issueCodes: Array.from(issueCodeMap.entries())
        .map(([issueCode, count]) => ({ issueCode, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50),
      states: Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);

  // Handle filing selection with single click, Ctrl+click, and Shift+click
  const handleFilingClick = (e: React.MouseEvent, filingId: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedFilings(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const filingsToSelect = currentPageResults.slice(start, end + 1);
        filingsToSelect.forEach(filing => {
          const id = filing.id || filing.filing_uuid || filing.PK || '';
          if (id) newSelected.add(id);
        });
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(filingId)) {
          newSelected.delete(filingId);
        } else {
          newSelected.add(filingId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(filingId)) {
          newSelected.delete(filingId);
        } else {
          newSelected.clear();
          newSelected.add(filingId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, filingId: string) => {
    e.stopPropagation();
    
    // Determine which filings to drag
    const filingsToDrag = selectedFilings.has(filingId) ? selectedFilings : new Set([filingId]);
    
    // Set drag data
    const selectedFilingObjects = currentResults.filter(filing => {
      const id = filing.id || filing.filing_uuid || filing.PK || '';
      return filingsToDrag.has(id);
    });
    
    if (selectedFilingObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'lda_filings',
        filings: selectedFilingObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedFilingObjects.length} filing${selectedFilingObjects.length > 1 ? 's' : ''}`;
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
  const handleRowContextMenu = (e: React.MouseEvent, filingId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this filing is not selected, select only it
    if (!selectedFilings.has(filingId)) {
      setSelectedFilings(new Set([filingId]));
    }
    
    setContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  const formatCurrency = (amount: number | string | undefined) => {
    if (!amount) return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
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
  const totalPages = Math.ceil(currentResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = currentResults.slice(startIndex, endIndex);

  // Restore results from props on mount
  useEffect(() => {
    if (results.length > 0 && allResults.length === 0) {
      console.log('🔄 LDASearchTile: Restoring results from tile data:', results.length, 'results');
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
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('lda_disclosures'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'LDA Disclosures';
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
            disabled: selectedFilings.size === 0,
            tooltip: `Add ${selectedFilings.size > 0 ? `${selectedFilings.size} filing(s)` : 'selected filings'} to context`,
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
            disabled: isDeletingTiles,
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
                (selectedFilters.registrants.size > 0 || 
                 selectedFilters.clients.size > 0 || 
                 selectedFilters.lobbyists.size > 0 || 
                 selectedFilters.filingTypes.size > 0 ||
                 selectedFilters.issueCodes.size > 0 ||
                 selectedFilters.states.size > 0) 
                  ? `Filter Results (${selectedFilters.registrants.size + selectedFilters.clients.size + selectedFilters.lobbyists.size + selectedFilters.filingTypes.size + selectedFilters.issueCodes.size + selectedFilters.states.size} active)`
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
                      color: (selectedFilters.registrants.size > 0 || 
                              selectedFilters.clients.size > 0 || 
                              selectedFilters.lobbyists.size > 0 || 
                              selectedFilters.filingTypes.size > 0 ||
                              selectedFilters.issueCodes.size > 0 ||
                              selectedFilters.states.size > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.registrants.size > 0 || 
                    selectedFilters.clients.size > 0 || 
                    selectedFilters.lobbyists.size > 0 || 
                    selectedFilters.filingTypes.size > 0 ||
                    selectedFilters.issueCodes.size > 0 ||
                    selectedFilters.states.size > 0) && (
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
          {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            Searching filings...
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
      {localDisplayOptions.showResultsTable && currentResults.length > 0 && !isLoading && (
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
                      indeterminate={selectedFilings.size > 0 && selectedFilings.size < currentPageResults.length}
                      checked={currentPageResults.length > 0 && selectedFilings.size === currentPageResults.length}
                      onChange={() => {
                        if (selectedFilings.size === currentPageResults.length) {
                          const newSelected = new Set(selectedFilings);
                          currentPageResults.forEach(filing => {
                            const filingId = filing.id || filing.filing_uuid || '';
                            newSelected.delete(filingId);
                          });
                          setSelectedFilings(newSelected);
                        } else {
                          const newSelected = new Set(selectedFilings);
                          currentPageResults.forEach(filing => {
                            const filingId = filing.id || filing.filing_uuid || '';
                            newSelected.add(filingId);
                          });
                          setSelectedFilings(newSelected);
                        }
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                    />
                  </TableCell>
                  {visibleColumns.includes('filing_type') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Filing Type</TableCell>
                  )}
                  {visibleColumns.includes('filing_period') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Filing Period</TableCell>
                  )}
                  {visibleColumns.includes('filing_year') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Filing Year</TableCell>
                  )}
                  {visibleColumns.includes('registrant') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Registrant</TableCell>
                  )}
                  {visibleColumns.includes('client') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Client</TableCell>
                  )}
                  {visibleColumns.includes('amount') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Amount</TableCell>
                  )}
                  {visibleColumns.includes('date_posted') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Date Posted</TableCell>
                  )}
                  {visibleColumns.includes('state') && (
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>State</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((filing, index) => {
                  const filingId = filing.id || filing.filing_uuid || filing.PK || '';
                  return (
                  <TableRow
                    key={filingId}
                    draggable
                    onDragStart={(e) => handleDragStart(e, filingId)}
                    onClick={(e) => handleFilingClick(e, filingId, index)}
                    onDoubleClick={async (e) => {
                      e.stopPropagation();
                      if (user?.id) {
                        // Use PK directly if available (preferred), otherwise extract ID from other fields
                        let filingIdOrPk: string | undefined;
                        
                        if (filing.PK) {
                          // Use PK directly (format: FILING#uuid or CONTRIBUTION#uuid)
                          filingIdOrPk = typeof filing.PK === 'string' ? filing.PK : String(filing.PK);
                        } else if (filing.id || filing.filing_uuid) {
                          // Fallback to ID if PK not available
                          filingIdOrPk = filing.id || filing.filing_uuid;
                        }
                        
                        if (filingIdOrPk) {
                          try {
                            // Fetch full filing details from API using PK or ID
                            const response = await ldaSearchAPI.getFiling({ filing_id: filingIdOrPk });
                            if (response.success && response.result) {
                              openItemDetails(
                                'lda_disclosure',
                                response.result,
                                response.result.registrant_name 
                                  ? `LDA Filing - ${response.result.registrant_name}${response.result.client_name ? ` / ${response.result.client_name}` : ''}`
                                  : 'Filing Details',
                                { user_id: user.id }
                              );
                            } else {
                              // Fallback to using minimal filing data if fetch fails
                              console.warn('Failed to fetch full filing details, using minimal data:', response.error);
                              openItemDetails(
                                'lda_disclosure',
                                filing,
                                filing.registrant_name 
                                  ? `LDA Filing - ${filing.registrant_name}${filing.client_name ? ` / ${filing.client_name}` : ''}`
                                  : 'Filing Details',
                                { user_id: user.id }
                              );
                            }
                          } catch (error) {
                            console.error('Error fetching filing details:', error);
                            // Fallback to using minimal filing data on error
                            openItemDetails(
                              'lda_disclosure',
                              filing,
                              filing.registrant_name 
                                ? `LDA Filing - ${filing.registrant_name}${filing.client_name ? ` / ${filing.client_name}` : ''}`
                                : 'Filing Details',
                              { user_id: user.id }
                            );
                          }
                        } else {
                          // No filing ID or PK available, use minimal data
                          console.warn('No filing ID or PK found, using minimal data');
                          openItemDetails(
                            'lda_disclosure',
                            filing,
                            filing.registrant_name 
                              ? `LDA Filing - ${filing.registrant_name}${filing.client_name ? ` / ${filing.client_name}` : ''}`
                              : 'Filing Details',
                            { user_id: user.id }
                          );
                        }
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, filingId)}
                    sx={{
                      backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': {
                        backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
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
                    {visibleColumns.includes('filing_type') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.report_type_display || filing.filing_type_display || filing.report_type || filing.filing_type || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('filing_period') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.filing_period_display || filing.filing_period || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('filing_year') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.filing_year || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('registrant') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.registrant_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('client') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.client_name || 'N/A'}
                      </TableCell>
                    )}
                    {visibleColumns.includes('amount') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {formatCurrency(filing.amount_reported)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('date_posted') && (
                      <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                        {formatDate(filing.dt_posted)}
                      </TableCell>
                    )}
                    {visibleColumns.includes('state') && (
                      <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                        {filing.state || 'N/A'}
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
      {currentResults.length === 0 && !isLoading && (
        <Box 
          sx={{ 
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 6,
            px: 3,
            flexShrink: 0,
            minHeight: '200px',
          }}
        >
          {(() => {
            // Check if there's any search criteria
            const hasSearchCriteria = 
              (currentSearchParams.general_text_search && currentSearchParams.general_text_search.length > 0) ||
              (currentSearchParams.registrant_name && currentSearchParams.registrant_name.length > 0) ||
              (currentSearchParams.client_name && currentSearchParams.client_name.length > 0) ||
              (currentSearchParams.lobbyist_name && currentSearchParams.lobbyist_name.length > 0) ||
              (currentSearchParams.foreign_entity_name && currentSearchParams.foreign_entity_name.length > 0) ||
              (currentSearchParams.general_issue_code && currentSearchParams.general_issue_code.length > 0) ||
              (currentSearchParams.government_entity && currentSearchParams.government_entity.length > 0) ||
              (currentSearchParams.filing_period && currentSearchParams.filing_period.length > 0) ||
              (currentSearchParams.item_type && currentSearchParams.item_type.length > 0) ||
              currentSearchParams.date_from ||
              currentSearchParams.date_to ||
              currentSearchParams.amount_min !== undefined ||
              currentSearchParams.amount_max !== undefined;
            
            if (!hasPerformedInitialSearch && !hasSearchCriteria) {
              return (
                <>
                  <IconButton
                    onClick={() => setSearchDialogOpen(true)}
                    sx={{
                      color: '#3b82f6',
                      mb: 2,
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        transform: 'scale(1.1)',
                      },
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <SearchIcon sx={{ fontSize: '4rem' }} />
                  </IconButton>
                  <Typography variant="h6" color="#3b82f6" sx={{ fontWeight: 600, mb: 1 }}>
                    Start Your Search
                  </Typography>
                  <Typography variant="body2" color="#9ca3af" sx={{ textAlign: 'center', maxWidth: '300px' }}>
                    Click the magnifying glass above to configure your search parameters
                  </Typography>
                </>
              );
            } else {
              return (
                <>
                  <Typography variant="body2" color="#9ca3af" sx={{ mb: 2 }}>
                    No results found
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<SearchIcon />}
                    onClick={() => setSearchDialogOpen(true)}
                    sx={{
                      color: '#3b82f6',
                      borderColor: '#3b82f6',
                      '&:hover': {
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                    }}
                  >
                    Adjust Search Parameters
                  </Button>
                </>
              );
            }
          })()}
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
            <SearchIcon />
            <Typography variant="h6">Search LDA Disclosures</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Box display="flex" flexDirection="column" gap={3} mt={2}>
            {/* General Text Search */}
            <MultiSelectField<LDAAutocompleteItem>
              label="General Search"
              selectedItems={generalSearchItems}
              onItemsChange={(items) => {
                setGeneralSearchItems(items.map(item => typeof item === 'string' ? { value: item, type: 'unknown', label: item } : item));
              }}
              suggestions={[]}
              onSearch={async (query: string, offset?: number) => {
                if (!query || query.length < 2) return { results: [], has_more: false };
                try {
                  const response = await ldaAutocompleteAPI.search({
                    query,
                    field_types: ['registrant', 'client', 'lobbyist', 'pac', 'foreign'],
                    limit: 20,
                    offset: offset || 0,
                  });
                  return {
                    results: response.results || [],
                    has_more: response.has_more || false,
                  };
                } catch (error) {
                  console.error('Autocomplete error:', error);
                  return { results: [], has_more: false };
                }
              }}
              renderItem={(item) => typeof item === 'string' ? item : item.value}
              renderOptionCustom={(item) => {
                if (typeof item === 'string') {
                  return <Typography>{item}</Typography>;
                }
                const typeColors: Record<string, { bg: string; color: string; border: string }> = {
                  registrant: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '#3b82f6' },
                  client: { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '#10b981' },
                  lobbyist: { bg: 'rgba(168, 85, 247, 0.15)', color: '#a78bfa', border: '#a855f7' },
                  pac: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '#ef4444' },
                  foreign: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '#f59e0b' },
                };
                const typeColor = typeColors[item.type] || { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', border: '#64748b' };
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                    <Chip
                      label={item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                      size="small"
                      sx={{
                        backgroundColor: typeColor.bg,
                        color: typeColor.color,
                        border: `1px solid ${typeColor.border}`,
                        fontSize: '0.7rem',
                        height: '20px',
                        fontWeight: 500,
                        ml: 1,
                      }}
                    />
                  </Box>
                );
              }}
              getItemKey={(item) => typeof item === 'string' ? item : `${item.type}:${item.value}`}
              placeholder="Search registrants, clients, lobbyists, PACs, or foreign entities..."
              allowCustomInput={false}
            />

            {/* Advanced Search Toggle */}
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
              <Box display="flex" flexDirection="column" gap={3}>
                {/* Registrant Name */}
                <MultiSelectField<LDAAutocompleteItem>
                  label="Registrant Name"
                  selectedItems={(currentSearchParams.registrant_name || []).map(value => ({ value, type: 'registrant', label: value }))}
                  onItemsChange={(items) => {
                    const values = items.map(item => typeof item === 'string' ? item : item.value);
                    setCurrentSearchParams(prev => ({ ...prev, registrant_name: values }));
                  }}
                  suggestions={[]}
                  onSearch={async (query: string, offset?: number) => {
                    try {
                      const response = await ldaAutocompleteAPI.search({
                        query,
                        field_types: ['registrant'],
                        limit: 20,
                        offset: offset || 0,
                      });
                      return {
                        results: response.results || [],
                        has_more: response.has_more || false,
                      };
                    } catch (error) {
                      console.error('Autocomplete error:', error);
                      return { results: [], has_more: false };
                    }
                  }}
                  renderItem={(item) => typeof item === 'string' ? item : item.value}
                  getItemKey={(item) => typeof item === 'string' ? item : `${item.type}:${item.value}`}
                  placeholder="Search registrants..."
                  allowCustomInput={false}
                />

                {/* Client Name */}
                <MultiSelectField<LDAAutocompleteItem>
                  label="Client Name"
                  selectedItems={(currentSearchParams.client_name || []).map(value => ({ value, type: 'client', label: value }))}
                  onItemsChange={(items) => {
                    const values = items.map(item => typeof item === 'string' ? item : item.value);
                    setCurrentSearchParams(prev => ({ ...prev, client_name: values }));
                  }}
                  suggestions={[]}
                  onSearch={async (query: string, offset?: number) => {
                    try {
                      const response = await ldaAutocompleteAPI.search({
                        query,
                        field_types: ['client'],
                        limit: 20,
                        offset: offset || 0,
                      });
                      return {
                        results: response.results || [],
                        has_more: response.has_more || false,
                      };
                    } catch (error) {
                      console.error('Autocomplete error:', error);
                      return { results: [], has_more: false };
                    }
                  }}
                  renderItem={(item) => typeof item === 'string' ? item : item.value}
                  getItemKey={(item) => typeof item === 'string' ? item : `${item.type}:${item.value}`}
                  placeholder="Search clients..."
                  allowCustomInput={false}
                />

                {/* Lobbyist Name */}
                <MultiSelectField<LDAAutocompleteItem>
                  label="Lobbyist Name"
                  selectedItems={(currentSearchParams.lobbyist_name || []).map(value => ({ value, type: 'lobbyist', label: value }))}
                  onItemsChange={(items) => {
                    const values = items.map(item => typeof item === 'string' ? item : item.value);
                    setCurrentSearchParams(prev => ({ ...prev, lobbyist_name: values }));
                  }}
                  suggestions={[]}
                  onSearch={async (query: string, offset?: number) => {
                    try {
                      const response = await ldaAutocompleteAPI.search({
                        query,
                        field_types: ['lobbyist'],
                        limit: 20,
                        offset: offset || 0,
                      });
                      return {
                        results: response.results || [],
                        has_more: response.has_more || false,
                      };
                    } catch (error) {
                      console.error('Autocomplete error:', error);
                      return { results: [], has_more: false };
                    }
                  }}
                  renderItem={(item) => typeof item === 'string' ? item : item.value}
                  getItemKey={(item) => typeof item === 'string' ? item : `${item.type}:${item.value}`}
                  placeholder="Search lobbyists..."
                  allowCustomInput={false}
                />

                {/* Foreign Entity Name */}
                <MultiSelectField<LDAAutocompleteItem>
                  label="Foreign Entity Name"
                  selectedItems={(currentSearchParams.foreign_entity_name || []).map(value => ({ value, type: 'foreign', label: value }))}
                  onItemsChange={(items) => {
                    const values = items.map(item => typeof item === 'string' ? item : item.value);
                    setCurrentSearchParams(prev => ({ ...prev, foreign_entity_name: values }));
                  }}
                  suggestions={[]}
                  onSearch={async (query: string, offset?: number) => {
                    try {
                      const response = await ldaAutocompleteAPI.search({
                        query: query || '', // Allow empty query for default results
                        field_types: ['foreign'],
                        limit: query ? 20 : 10, // Default to 10 for empty query
                        offset: offset || 0,
                      });
                      return {
                        results: response.results || [],
                        has_more: response.has_more || false,
                      };
                    } catch (error) {
                      console.error('Autocomplete error:', error);
                      return { results: [], has_more: false };
                    }
                  }}
                  renderItem={(item) => typeof item === 'string' ? item : item.value}
                  getItemKey={(item) => typeof item === 'string' ? item : `${item.type}:${item.value}`}
                  placeholder="Search foreign entities..."
                  allowCustomInput={false}
                />

                {/* General Issue Code */}
                <MultiSelectField<string>
                  label="General Issue Code"
                  selectedItems={currentSearchParams.general_issue_code || []}
                  onItemsChange={(codes) => {
                    setCurrentSearchParams((prev) => ({ ...prev, general_issue_code: codes }));
                  }}
                  suggestions={generalIssues}
                  onSearch={(query: string) => {
                    if (!query || query.trim() === '') {
                      return generalIssues;
                    }
                    const queryLower = query.toLowerCase().trim();
                    const startsWith = generalIssues.filter(issue => 
                      issue.toLowerCase().startsWith(queryLower)
                    );
                    const contains = generalIssues.filter(issue => 
                      !issue.toLowerCase().startsWith(queryLower) && 
                      issue.toLowerCase().includes(queryLower)
                    );
                    return [...startsWith, ...contains];
                  }}
                  renderItem={(code) => code}
                  placeholder="Search issue codes..."
                  allowCustomInput={false}
                />

                {/* Government Entity */}
                <MultiSelectField<string>
                  label="Government Entity"
                  selectedItems={currentSearchParams.government_entity || []}
                  onItemsChange={(entities) => {
                    setCurrentSearchParams((prev) => ({ ...prev, government_entity: entities }));
                  }}
                  suggestions={governmentEntities}
                  onSearch={(query: string) => {
                    if (!query || query.trim() === '') {
                      return governmentEntities;
                    }
                    const queryLower = query.toLowerCase().trim();
                    const startsWith = governmentEntities.filter(entity => 
                      entity.toLowerCase().startsWith(queryLower)
                    );
                    const contains = governmentEntities.filter(entity => 
                      !entity.toLowerCase().startsWith(queryLower) && 
                      entity.toLowerCase().includes(queryLower)
                    );
                    return [...startsWith, ...contains];
                  }}
                  renderItem={(entity) => entity}
                  placeholder="Search government entities..."
                  allowCustomInput={false}
                />

                {/* Item Type (FILING or CONTRIBUTION) */}
                <Box>
                  <Typography variant="body2" sx={{ color: '#94a3b8', mb: 1 }}>
                    Item Type
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {['FILING', 'CONTRIBUTION'].map((type) => (
                      <Chip
                        key={type}
                        label={type}
                        onClick={() => {
                          setCurrentSearchParams((prev) => {
                            const currentTypes = prev.item_type || [];
                            const newTypes = currentTypes.includes(type)
                              ? currentTypes.filter(t => t !== type)
                              : [...currentTypes, type];
                            return { ...prev, item_type: newTypes.length > 0 ? newTypes : undefined };
                          });
                        }}
                        sx={{
                          backgroundColor: (currentSearchParams.item_type || []).includes(type)
                            ? 'rgba(59, 130, 246, 0.3)'
                            : 'rgba(55, 65, 81, 0.5)',
                          color: (currentSearchParams.item_type || []).includes(type)
                            ? '#60a5fa'
                            : '#94a3b8',
                          border: `1px solid ${(currentSearchParams.item_type || []).includes(type) ? '#3b82f6' : '#475569'}`,
                          cursor: 'pointer',
                          '&:hover': {
                            backgroundColor: (currentSearchParams.item_type || []).includes(type)
                              ? 'rgba(59, 130, 246, 0.4)'
                              : 'rgba(55, 65, 81, 0.7)',
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Box>

                {/* Amount Range */}
                <Box display="flex" gap={2}>
                  <TextField
                    label="Min Amount ($)"
                    type="number"
                    value={currentSearchParams.amount_min || ''}
                    onChange={(e) => {
                      setCurrentSearchParams((prev) => ({
                        ...prev,
                        amount_min: e.target.value ? Number(e.target.value) : undefined,
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
                    label="Max Amount ($)"
                    type="number"
                    value={currentSearchParams.amount_max || ''}
                    onChange={(e) => {
                      setCurrentSearchParams((prev) => ({
                        ...prev,
                        amount_max: e.target.value ? Number(e.target.value) : undefined,
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
                    onChange={(e) => {
                      let dateValue = e.target.value || undefined;
                      // Validate: if date is before minimum, default to minimum
                      if (dateValue && dateValue < MIN_DATE) {
                        dateValue = MIN_DATE;
                      }
                      setCurrentSearchParams(prev => ({ ...prev, date_from: dateValue }));
                    }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: MIN_DATE,
                    }}
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
                    onChange={(e) => {
                      let dateValue = e.target.value || undefined;
                      // Validate: if date is before minimum, default to minimum
                      if (dateValue && dateValue < MIN_DATE) {
                        dateValue = MIN_DATE;
                      }
                      setCurrentSearchParams(prev => ({ ...prev, date_to: dateValue }));
                    }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: MIN_DATE,
                    }}
                    size="small"
                    sx={{
                      '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />
                </Box>

                {/* State */}
                <MultiSelectField<string>
                  label="State"
                  selectedItems={currentSearchParams.state || []}
                  onItemsChange={(states) => {
                    setCurrentSearchParams((prev) => ({ ...prev, state: states }));
                  }}
                  suggestions={US_STATES}
                  renderItem={(state) => state}
                  placeholder="Select states..."
                />
              </Box>
            </Collapse>
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
          <Button
            onClick={() => {
              setCurrentSearchParams({
                general_text_search: [],
                date_from: '',
                date_to: '',
                amount_min: undefined,
                amount_max: undefined,
              });
              setGeneralSearchItems([]);
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
              // Build general_text_search_fields from generalSearchItems before persisting
              const searchParamsToPersist: LDASearchFilters = { ...currentSearchParams };
              
              if (generalSearchItems.length > 0) {
                const generalTextSearchFields: {
                  registrant?: string[] | false;
                  client?: string[] | false;
                  lobbyist?: string[] | false;
                  pac?: string[] | false;
                  foreign?: string[] | false;
                } = {
                  registrant: false,
                  client: false,
                  lobbyist: false,
                  pac: false,
                  foreign: false,
                };
                
                const itemsByType: Record<string, string[]> = {};
                generalSearchItems.forEach(item => {
                  const type = item.type || 'unknown';
                  if (!itemsByType[type]) {
                    itemsByType[type] = [];
                  }
                  itemsByType[type].push(item.value);
                });
                
                // Set arrays for types that have items, false for others
                Object.keys(generalTextSearchFields).forEach(type => {
                  if (itemsByType[type] && itemsByType[type].length > 0) {
                    generalTextSearchFields[type as keyof typeof generalTextSearchFields] = itemsByType[type];
                  }
                });
                
                searchParamsToPersist.general_text_search_fields = generalTextSearchFields;
                // Also set general_text_search for backward compatibility
                searchParamsToPersist.general_text_search = generalSearchItems.map(item => item.value);
              } else {
                // Clear general_text_search_fields if no items
                searchParamsToPersist.general_text_search_fields = undefined;
                searchParamsToPersist.general_text_search = [];
              }
              
              // Update currentSearchParams with the synced values
              setCurrentSearchParams(searchParamsToPersist);
              
              // Persist search params (only when search button is clicked)
              onSettingsChange(id, { searchParams: searchParamsToPersist });
              
              // Perform search
              performSearch();
              
              // Close dialog
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
          {(selectedFilters.registrants.size > 0 || 
            selectedFilters.clients.size > 0 || 
            selectedFilters.lobbyists.size > 0 || 
            selectedFilters.filingTypes.size > 0 ||
            selectedFilters.issueCodes.size > 0 ||
            selectedFilters.states.size > 0) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
              <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
                Applied Filters:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Array.from(selectedFilters.registrants).map(registrant => (
                  <Chip
                    key={`registrant-${registrant}`}
                    label={`Registrant: ${registrant}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.registrants);
                        newSet.delete(registrant);
                        return { ...prev, registrants: newSet };
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
                {Array.from(selectedFilters.clients).map(client => (
                  <Chip
                    key={`client-${client}`}
                    label={`Client: ${client}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.clients);
                        newSet.delete(client);
                        return { ...prev, clients: newSet };
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
                {Array.from(selectedFilters.lobbyists).map(lobbyist => (
                  <Chip
                    key={`lobbyist-${lobbyist}`}
                    label={`Lobbyist: ${lobbyist}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.lobbyists);
                        newSet.delete(lobbyist);
                        return { ...prev, lobbyists: newSet };
                      });
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(168, 85, 247, 0.2)',
                      color: '#a855f7',
                      border: '1px solid #a855f7',
                      '& .MuiChip-deleteIcon': { color: '#a855f7' }
                    }}
                  />
                ))}
                {Array.from(selectedFilters.filingTypes).map(filingType => (
                  <Chip
                    key={`filingType-${filingType}`}
                    label={`Filing Type: ${filingType}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.filingTypes);
                        newSet.delete(filingType);
                        return { ...prev, filingTypes: newSet };
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
                {Array.from(selectedFilters.issueCodes).map(issueCode => (
                  <Chip
                    key={`issueCode-${issueCode}`}
                    label={`Issue Code: ${issueCode}`}
                    onDelete={() => {
                      setSelectedFilters(prev => {
                        const newSet = new Set(prev.issueCodes);
                        newSet.delete(issueCode);
                        return { ...prev, issueCodes: newSet };
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
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      '& .MuiChip-deleteIcon': { color: '#f59e0b' }
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* No Results Message */}
          {availableFilters.registrants.length === 0 && 
           availableFilters.clients.length === 0 && 
           availableFilters.lobbyists.length === 0 &&
           availableFilters.filingTypes.length === 0 &&
           availableFilters.issueCodes.length === 0 &&
           availableFilters.states.length === 0 ? (
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
              {/* Registrants Filter */}
              {availableFilters.registrants.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Registrants ({availableFilters.registrants.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.registrants.map((filter) => (
                        <Box
                          key={filter.registrant}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.registrants.has(filter.registrant)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.registrants);
                            if (newSet.has(filter.registrant)) {
                              newSet.delete(filter.registrant);
                            } else {
                              newSet.add(filter.registrant);
                            }
                            setSelectedFilters(prev => ({ ...prev, registrants: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.registrant}
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

              {/* Clients Filter */}
              {availableFilters.clients.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Clients ({availableFilters.clients.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.clients.map((filter) => (
                        <Box
                          key={filter.client}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.clients.has(filter.client)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.clients);
                            if (newSet.has(filter.client)) {
                              newSet.delete(filter.client);
                            } else {
                              newSet.add(filter.client);
                            }
                            setSelectedFilters(prev => ({ ...prev, clients: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.client}
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

              {/* Lobbyists Filter */}
              {availableFilters.lobbyists.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Lobbyists ({availableFilters.lobbyists.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.lobbyists.map((filter) => (
                        <Box
                          key={filter.lobbyist}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.lobbyists.has(filter.lobbyist)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.lobbyists);
                            if (newSet.has(filter.lobbyist)) {
                              newSet.delete(filter.lobbyist);
                            } else {
                              newSet.add(filter.lobbyist);
                            }
                            setSelectedFilters(prev => ({ ...prev, lobbyists: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.lobbyist}
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

              {/* Filing Types Filter */}
              {availableFilters.filingTypes.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Filing Types ({availableFilters.filingTypes.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.filingTypes.map((filter) => (
                        <Box
                          key={filter.filingType}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.filingTypes.has(filter.filingType)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.filingTypes);
                            if (newSet.has(filter.filingType)) {
                              newSet.delete(filter.filingType);
                            } else {
                              newSet.add(filter.filingType);
                            }
                            setSelectedFilters(prev => ({ ...prev, filingTypes: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.filingType}
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

              {/* Issue Codes Filter */}
              {availableFilters.issueCodes.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                      Issue Codes ({availableFilters.issueCodes.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {availableFilters.issueCodes.map((filter) => (
                        <Box
                          key={filter.issueCode}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: selectedFilters.issueCodes.has(filter.issueCode)
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          }}
                          onClick={() => {
                            const newSet = new Set(selectedFilters.issueCodes);
                            if (newSet.has(filter.issueCode)) {
                              newSet.delete(filter.issueCode);
                            } else {
                              newSet.add(filter.issueCode);
                            }
                            setSelectedFilters(prev => ({ ...prev, issueCodes: newSet }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.issueCode}
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
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155' }}>
          <Button 
            onClick={() => {
              setSelectedFilters({
                registrants: new Set(),
                clients: new Set(),
                lobbyists: new Set(),
                filingTypes: new Set(),
                issueCodes: new Set(),
                states: new Set(),
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
            filing_type: 'Filing Type',
            filing_period: 'Filing Period',
            filing_year: 'Filing Year',
            registrant: 'Registrant',
            client: 'Client',
            amount: 'Amount',
            date_posted: 'Date Posted',
            state: 'State',
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
const LDASearchTileMemo = memo(LDASearchTile, (prevProps, nextProps) => {
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
    if (prevDisplay.showFilingType !== nextDisplay.showFilingType ||
        prevDisplay.showFilingPeriod !== nextDisplay.showFilingPeriod ||
        prevDisplay.showFilingYear !== nextDisplay.showFilingYear ||
        prevDisplay.showRegistrant !== nextDisplay.showRegistrant ||
        prevDisplay.showClient !== nextDisplay.showClient ||
        prevDisplay.showAmount !== nextDisplay.showAmount ||
        prevDisplay.showDatePosted !== nextDisplay.showDatePosted ||
        prevDisplay.showState !== nextDisplay.showState ||
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

LDASearchTileMemo.displayName = 'LDASearchTile';

export default LDASearchTileMemo;
