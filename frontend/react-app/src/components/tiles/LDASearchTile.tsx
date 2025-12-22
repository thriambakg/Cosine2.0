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
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ViewColumn as ViewColumnIcon,
} from '@mui/icons-material';
import { 
  ldaSearchAPI, 
  ldaAutocompleteAPI,
  LDASearchFilters,
  LDAFiling,
  LDAAutocompleteItem 
} from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, confirmDialog, getIconByName, getDefaultIconForTileType } from './common';
import { addLDAFilingToContext, addMultipleLDAFilingsToContext } from './common/contextManager';
import MultiSelectField from '../MultiSelectField';
import { Collapse } from '@mui/material';
import { KeyboardArrowDown as KeyboardArrowDownIcon, KeyboardArrowUp as KeyboardArrowUpIcon, Download as DownloadIcon } from '@mui/icons-material';

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

const LDASearchTile: React.FC<LDASearchTileProps> = ({
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
    general_text_search: [],
    date_from: '',
    date_to: '',
    amount_min: undefined,
    amount_max: undefined,
  },
  filterSettings: initialFilterSettings,
  paginationState: initialPaginationState,
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
  // Alias paginationState for consistency
  const paginationState = initialPaginationState;
  
  // const { user } = useAuth();
  // const { activeSessionId } = useGlobalChat();
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedFilingForDetails, setSelectedFilingForDetails] = useState<LDAFiling | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  const [expandedActivities, setExpandedActivities] = useState<Set<number>>(new Set());
  
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
  }>({
    registrants: new Set(initialFilterSettings?.registrants || []),
    clients: new Set(initialFilterSettings?.clients || []),
    lobbyists: new Set(initialFilterSettings?.lobbyists || []),
    filingTypes: new Set(initialFilterSettings?.filingTypes || []),
    issueCodes: new Set(initialFilterSettings?.issueCodes || []),
    states: new Set(initialFilterSettings?.states || []),
  });

  const [selectedFilings, setSelectedFilings] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchParams, setCurrentSearchParams] = useState<LDASearchFilters>(searchParams);
  const [currentResults, setCurrentResults] = useState<LDAFiling[]>(results);
  const [generalSearchItems, setGeneralSearchItems] = useState<LDAAutocompleteItem[]>([]);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>([]);
  const [isRestoringPagination, setIsRestoringPagination] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  
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

  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('📋 LDASearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    // Reset client-side filters on new search
    setSelectedFilters({
      registrants: new Set(),
      clients: new Set(),
      lobbyists: new Set(),
      filingTypes: new Set(),
      issueCodes: new Set(),
      states: new Set(),
    });
    
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
        limit: localDisplayOptions.maxResults,
      };
      
      const response = await ldaSearchAPI.search(searchRequest);
      
      if (response.success && response.results) {
        console.log('📋 LDASearchTile: Retrieved', response.results.length, 'filings');
        
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
        console.error('📋 LDASearchTile: Search failed');
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
      console.error('📋 LDASearchTile: Search error:', err);
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
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, onSettingsChange, generalSearchItems]);
  
  // Load more results
  const handleLoadMore = useCallback(async () => {
    // Use lastEvaluatedKey if available, otherwise use the last key from lastEvaluatedKeys array
    const keyToUse = lastEvaluatedKey || (lastEvaluatedKeys && lastEvaluatedKeys.length > 0 ? lastEvaluatedKeys[lastEvaluatedKeys.length - 1] : null);
    
    if (!hasMore || !keyToUse || isLoadingMore || !currentSearchParams) {
      console.log('📋 LDASearchTile: Load more blocked', {
        hasMore,
        keyToUse: !!keyToUse,
        isLoadingMore,
        hasSearchParams: !!currentSearchParams,
        lastEvaluatedKey: !!lastEvaluatedKey,
        lastEvaluatedKeysLength: lastEvaluatedKeys?.length || 0,
      });
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
        limit: localDisplayOptions.maxResults,
        last_evaluated_key: keyToUse,
      };
      
      const response = await ldaSearchAPI.search(searchRequest);
      
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
        console.error('📋 LDASearchTile: Load more failed');
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
      console.error('📋 LDASearchTile: Load more error:', err);
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
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange, generalSearchItems]);

  // Restore pagination state on mount
  const restorePaginationState = useCallback(async () => {
    if (!paginationState || !paginationState.lastEvaluatedKeys || paginationState.lastEvaluatedKeys.length === 0) {
      return;
    }

    if (paginationState.totalResultsLoaded <= (results?.length || 0)) {
      // Already have all results, no need to restore
      return;
    }

    console.log('🔄 LDASearchTile: Restoring pagination state', {
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
        
        const response = await ldaSearchAPI.search(searchRequest);
        
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
      // Set lastEvaluatedKey to the last key if there are keys and hasMore is true
      const lastKey = paginationState.lastEvaluatedKeys && paginationState.lastEvaluatedKeys.length > 0 
        ? paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] 
        : null;
      setLastEvaluatedKey(paginationState.hasMore ? lastKey : null);
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
      
      console.log('✅ LDASearchTile: Pagination state restored', {
        restoredCount: currentResults.length,
        targetCount: paginationState.totalResultsLoaded,
      });
    } catch (err) {
      console.error('❌ LDASearchTile: Error restoring pagination state', err);
      setError('Failed to restore previous results. Please refresh.');
    } finally {
      setIsRestoringPagination(false);
      setIsLoading(false);
    }
  }, [paginationState, results, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, generalSearchItems]);

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

  // Sync searchParams from props (when restored from backend)
  useEffect(() => {
    if (searchParams && JSON.stringify(searchParams) !== JSON.stringify(currentSearchParams)) {
      console.log('🔄 LDASearchTile: Syncing searchParams from props');
      setCurrentSearchParams(searchParams);
      
      // Rebuild generalSearchItems from searchParams
      const newGeneralSearchItems: LDAAutocompleteItem[] = [];
      if (searchParams.general_text_search_fields) {
        if (Array.isArray(searchParams.general_text_search_fields.registrant) && searchParams.general_text_search_fields.registrant.length > 0) {
          searchParams.general_text_search_fields.registrant.forEach(value => {
            newGeneralSearchItems.push({ value, type: 'registrant', label: value });
          });
        }
        if (Array.isArray(searchParams.general_text_search_fields.client) && searchParams.general_text_search_fields.client.length > 0) {
          searchParams.general_text_search_fields.client.forEach(value => {
            newGeneralSearchItems.push({ value, type: 'client', label: value });
          });
        }
        if (Array.isArray(searchParams.general_text_search_fields.lobbyist) && searchParams.general_text_search_fields.lobbyist.length > 0) {
          searchParams.general_text_search_fields.lobbyist.forEach(value => {
            newGeneralSearchItems.push({ value, type: 'lobbyist', label: value });
          });
        }
        if (Array.isArray(searchParams.general_text_search_fields.pac) && searchParams.general_text_search_fields.pac.length > 0) {
          searchParams.general_text_search_fields.pac.forEach(value => {
            newGeneralSearchItems.push({ value, type: 'pac', label: value });
          });
        }
        if (Array.isArray(searchParams.general_text_search_fields.foreign) && searchParams.general_text_search_fields.foreign.length > 0) {
          searchParams.general_text_search_fields.foreign.forEach(value => {
            newGeneralSearchItems.push({ value, type: 'foreign', label: value });
          });
        }
      }
      setGeneralSearchItems(newGeneralSearchItems);
    }
  }, [searchParams]); // Sync when searchParams prop changes

  // Restore results from props on mount (session persistence)
  useEffect(() => {
    if (results && results.length > 0 && allResults.length === 0 && !isRestoringPagination) {
      console.log('🔄 LDASearchTile: Restoring', results.length, 'results from session');
      setAllResults(results);
      setFilteredResults(results);
      setCurrentResults(results);
      setHasPerformedInitialSearch(true);
      
      // Also restore pagination state if available
      if (paginationState) {
        setLastEvaluatedKeys(paginationState.lastEvaluatedKeys || []);
        const lastKey = paginationState.lastEvaluatedKeys && paginationState.lastEvaluatedKeys.length > 0 
          ? paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] 
          : null;
        setLastEvaluatedKey(paginationState.hasMore ? lastKey : null);
        setHasMore(paginationState.hasMore || false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Sync results when props change (e.g., after restore from backend)
  useEffect(() => {
    if (results && results.length > 0 && allResults.length === 0 && !isRestoringPagination) {
      console.log('🔄 LDASearchTile: Restoring results from tile data:', results.length, 'results');
      setAllResults(results);
      setFilteredResults(results);
      setCurrentResults(results);
      setHasPerformedInitialSearch(true);
      
      // Also restore pagination state if available
      if (paginationState) {
        setLastEvaluatedKeys(paginationState.lastEvaluatedKeys || []);
        const lastKey = paginationState.lastEvaluatedKeys && paginationState.lastEvaluatedKeys.length > 0 
          ? paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] 
          : null;
        setLastEvaluatedKey(paginationState.hasMore ? lastKey : null);
        setHasMore(paginationState.hasMore || false);
      }
    }
  }, [results, allResults.length, isRestoringPagination, paginationState]);

  // Initial load: Fetch fresh results if none exist and we have search criteria
  // Don't trigger if we already have results from props (session persistence)
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading && !isRestoringPagination && (!results || results.length === 0)) {
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
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch, results, isRestoringPagination]);

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove LDA Disclosures Tile from dashboard?',
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
    const selectedFilingObjects = currentResults.filter(filing => 
      selectedFilings.has(filing.id || filing.filing_uuid || filing.PK || '')
    );

    if (selectedFilingObjects.length === 0) return;

    if (selectedFilingObjects.length === 1) {
      // Add single filing to context
      addLDAFilingToContext(selectedFilingObjects[0], target);
    } else {
      // Add multiple filings to context
      addMultipleLDAFilingsToContext(selectedFilingObjects, target);
    }

    setSelectedFilings(new Set());
    handleContextMenuClose();
  };

  
  const handleRefresh = () => {
    performSearch();
  };

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
  useEffect(() => {
    const filterSettings = {
      registrants: Array.from(selectedFilters.registrants),
      clients: Array.from(selectedFilters.clients),
      lobbyists: Array.from(selectedFilters.lobbyists),
      filingTypes: Array.from(selectedFilters.filingTypes),
      issueCodes: Array.from(selectedFilters.issueCodes),
      states: Array.from(selectedFilters.states),
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

  const toggleFilingSelection = (filingId: string) => {
    setSelectedFilings(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filingId)) {
        newSet.delete(filingId);
      } else {
        newSet.add(filingId);
      }
      return newSet;
    });
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
          {(isLoading || isRestoringPagination) && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            {isRestoringPagination ? 'Restoring previous results...' : 'Searching filings...'}
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
                  {/* Actions column is always visible (not selectable) */}
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((filing) => {
                  const filingId = filing.id || filing.filing_uuid || '';
                  return (
                  <TableRow
                    key={filingId}
                    sx={{
                      backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      '&:hover': {
                        backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedFilings.has(filingId)}
                        onChange={() => toggleFilingSelection(filingId)}
                        sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                      />
                    </TableCell>
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
                    {/* Actions column is always visible (not selectable) */}
                    <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFilingForDetails(filing);
                          setDetailsDialogOpen(true);
                          setExpandedActivities(new Set()); // Reset expanded activities
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
                        query,
                        field_types: ['foreign'],
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

      {/* Filing Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
          setExpandedActivities(new Set()); // Reset expanded activities when dialog closes
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '0px',
            color: '#ffffff',
          },
        }}
      >
        {selectedFilingForDetails && (
          <>
            <DialogTitle sx={{ 
              borderBottom: '1px solid #374151', 
              pb: 2, 
              color: '#ffffff', 
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <Typography variant="h6" component="span" sx={{ color: '#ffffff', fontWeight: 600 }}>
                Filing Details
              </Typography>
              {selectedFilingForDetails.s3_key && (
                <IconButton
                  size="small"
                  onClick={async () => {
                    try {
                      console.log('📥 Downloading LDA filing:', selectedFilingForDetails.s3_key);
                      
                      // Note: Download functionality may require auth context
                      // For now, we'll attempt the download without user_id if not available
                      const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                      const response = await fetch(`${apiUrl}/file-download`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          user_id: '', // Optional for LDA filings
                          session_id: '', // Optional for LDA filings
                          s3_key: selectedFilingForDetails.s3_key,
                          filename: selectedFilingForDetails.s3_key.split('/').pop() || 'filing',
                          bucket: 'LDA_DISCLOSURES',
                        }),
                      });
                      
                      if (!response.ok) {
                        throw new Error(`Download request failed: ${response.status}`);
                      }
                      
                      const { download_url } = await response.json();
                      
                      // Create download link and trigger download
                      const link = document.createElement('a');
                      link.href = download_url;
                      link.download = selectedFilingForDetails.s3_key.split('/').pop() || 'filing';
                      link.target = '_blank';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      
                      console.log('✅ File download started');
                    } catch (error) {
                      console.error('❌ Download failed:', error);
                      alert('Download failed. Please try again or contact support.');
                    }
                  }}
                  sx={{
                    color: '#3b82f6',
                    '&:hover': { 
                      color: '#60a5fa', 
                      backgroundColor: 'rgba(59, 130, 246, 0.1)' 
                    }
                  }}
                >
                  <DownloadIcon />
                </IconButton>
              )}
            </DialogTitle>
            <DialogContent sx={{ 
              pt: 3, 
              maxHeight: '80vh', 
              overflowY: 'auto',
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(55, 65, 81, 0.3)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
              },
            }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Basic Filing Information */}
                {/* Basic Filing Information */}
                <Box>
                  <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Filing Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Filing UUID:</strong> <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{selectedFilingForDetails.filing_uuid}</span>
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Filing Type:</strong> {selectedFilingForDetails.report_type || selectedFilingForDetails.filing_type || 'N/A'}
                      {selectedFilingForDetails.report_type_display || selectedFilingForDetails.filing_type_display ? ` (${selectedFilingForDetails.report_type_display || selectedFilingForDetails.filing_type_display})` : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Filing Period:</strong> {selectedFilingForDetails.filing_period_display || selectedFilingForDetails.filing_period || 'N/A'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Filing Year:</strong> {selectedFilingForDetails.filing_year || 'N/A'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Date Posted:</strong> {formatDate(selectedFilingForDetails.dt_posted)}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      <strong>Amount:</strong> {formatCurrency(selectedFilingForDetails.amount_reported)}
                    </Typography>
                    {selectedFilingForDetails.general_issue_code && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>General Issue Code:</strong> {selectedFilingForDetails.general_issue_code}
                        {selectedFilingForDetails.general_issue_code_display ? ` (${selectedFilingForDetails.general_issue_code_display})` : ''}
                      </Typography>
                    )}
                    {selectedFilingForDetails.state && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>State:</strong> {selectedFilingForDetails.state}
                      </Typography>
                    )}
                    {selectedFilingForDetails.income && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Income:</strong> {formatCurrency(selectedFilingForDetails.income)}
                      </Typography>
                    )}
                    {selectedFilingForDetails.expenses !== null && selectedFilingForDetails.expenses !== undefined && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Expenses:</strong> {formatCurrency(selectedFilingForDetails.expenses)}
                        {selectedFilingForDetails.expenses_method_display ? ` (${selectedFilingForDetails.expenses_method_display})` : selectedFilingForDetails.expenses_method ? ` (Method: ${selectedFilingForDetails.expenses_method})` : ''}
                      </Typography>
                    )}
                    {selectedFilingForDetails.amount_bucket && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Amount Bucket:</strong> {formatCurrency(selectedFilingForDetails.amount_bucket)}
                      </Typography>
                    )}
                    {selectedFilingForDetails.posted_by_name && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Posted By:</strong> {selectedFilingForDetails.posted_by_name}
                      </Typography>
                    )}
                    {selectedFilingForDetails.termination_date && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Termination Date:</strong> {formatDate(selectedFilingForDetails.termination_date)}
                      </Typography>
                    )}
                    {selectedFilingForDetails.no_contributions !== null && selectedFilingForDetails.no_contributions !== undefined && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>No Contributions:</strong> {selectedFilingForDetails.no_contributions ? 'Yes' : 'No'}
                      </Typography>
                    )}
                    {selectedFilingForDetails.government_entity_id && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Government Entity ID:</strong> <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.government_entity_id}</span>
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* Registrant Information */}
                {(selectedFilingForDetails.registrant || selectedFilingForDetails.registrant_name) && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Registrant
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                        {selectedFilingForDetails.registrant?.name || selectedFilingForDetails.registrant_name || 'N/A'}
                      </Typography>
                      
                      {/* PII - Contact Information */}
                      {selectedFilingForDetails.registrant?.contact_name && (
                        <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500 }}>
                          <strong>Contact Name:</strong> {selectedFilingForDetails.registrant.contact_name}
                        </Typography>
                      )}
                      {selectedFilingForDetails.registrant?.contact_telephone && (
                        <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500 }}>
                          <strong>Contact Phone:</strong> {selectedFilingForDetails.registrant.contact_telephone}
                        </Typography>
                      )}
                      
                      {/* PII - Address */}
                      {(selectedFilingForDetails.registrant?.address_1 || selectedFilingForDetails.address?.address_1) && (
                        <Box sx={{ mt: 0.5 }}>
                          <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, mb: 0.5 }}>
                            <strong>Address:</strong>
                          </Typography>
                          <Typography variant="body2" sx={{ color: '#fbbf24', pl: 2, fontStyle: 'italic' }}>
                            {selectedFilingForDetails.registrant?.address_1 || selectedFilingForDetails.address?.address_1}
                            {selectedFilingForDetails.registrant?.address_2 || selectedFilingForDetails.address?.address_2 ? `, ${selectedFilingForDetails.registrant?.address_2 || selectedFilingForDetails.address?.address_2}` : ''}
                            <br />
                            {selectedFilingForDetails.registrant?.city || selectedFilingForDetails.address?.city}, {selectedFilingForDetails.registrant?.state || selectedFilingForDetails.address?.state || selectedFilingForDetails.state} {selectedFilingForDetails.registrant?.zip || selectedFilingForDetails.address?.zip}
                            <br />
                            {selectedFilingForDetails.registrant?.country_display || selectedFilingForDetails.registrant?.country || selectedFilingForDetails.address?.country_display || selectedFilingForDetails.address?.country || 'N/A'}
                          </Typography>
                        </Box>
                      )}
                      
                      {/* IDs (less emphasized) */}
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #475569' }}>
                        {selectedFilingForDetails.registrant?.id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            Registrant ID: <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.registrant.id}</span>
                          </Typography>
                        )}
                        {selectedFilingForDetails.registrant?.house_registrant_id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            House Registrant ID: <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.registrant.house_registrant_id}</span>
                          </Typography>
                        )}
                        {selectedFilingForDetails.registrant_id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            Registrant ID (alt): <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.registrant_id}</span>
                          </Typography>
                        )}
                      </Box>
                      
                      {/* Other registrant info */}
                      {selectedFilingForDetails.registrant?.description && (
                        <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1, fontStyle: 'italic' }}>
                          {selectedFilingForDetails.registrant.description}
                        </Typography>
                      )}
                      {selectedFilingForDetails.registrant?.dt_updated && (
                        <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                          Last Updated: {formatDate(selectedFilingForDetails.registrant.dt_updated)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}

                {/* Client Information */}
                {(selectedFilingForDetails.client || selectedFilingForDetails.client_name) && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Client
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                        {selectedFilingForDetails.client?.name || selectedFilingForDetails.client_name || 'N/A'}
                      </Typography>
                      
                      {/* Client description */}
                      {selectedFilingForDetails.client?.general_description && (
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontStyle: 'italic' }}>
                          {selectedFilingForDetails.client.general_description}
                        </Typography>
                      )}
                      
                      {/* Client location */}
                      {(selectedFilingForDetails.client?.state_display || selectedFilingForDetails.client?.country_display) && (
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          <strong>Location:</strong> {selectedFilingForDetails.client.state_display || ''}
                          {selectedFilingForDetails.client.state_display && selectedFilingForDetails.client.country_display ? ', ' : ''}
                          {selectedFilingForDetails.client.country_display || selectedFilingForDetails.client.country || ''}
                        </Typography>
                      )}
                      
                      {/* IDs (less emphasized) */}
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #475569' }}>
                        {selectedFilingForDetails.client_id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            Client ID: <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.client_id}</span>
                          </Typography>
                        )}
                        {selectedFilingForDetails.client_client_id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            Client Client ID: <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.client_client_id}</span>
                          </Typography>
                        )}
                        {selectedFilingForDetails.client?.id && (
                          <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                            Client ID (alt): <span style={{ fontFamily: 'monospace' }}>{selectedFilingForDetails.client.id}</span>
                          </Typography>
                        )}
                      </Box>
                      
                      {/* Government entity flag */}
                      {selectedFilingForDetails.client?.client_government_entity !== undefined && (
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          <strong>Government Entity:</strong> {selectedFilingForDetails.client.client_government_entity ? 'Yes' : 'No'}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}

                {/* All General Issue Codes */}
                {selectedFilingForDetails.all_general_issue_codes && Array.isArray(selectedFilingForDetails.all_general_issue_codes) && selectedFilingForDetails.all_general_issue_codes.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      All General Issue Codes
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {selectedFilingForDetails.all_general_issue_codes.map((code: string, idx: number) => (
                        <Chip
                          key={idx}
                          label={code}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                            color: '#93c5fd',
                            border: '1px solid #3b82f6',
                            fontSize: '0.75rem',
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* All Government Entity IDs */}
                {selectedFilingForDetails.all_government_entity_ids && Array.isArray(selectedFilingForDetails.all_government_entity_ids) && selectedFilingForDetails.all_government_entity_ids.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Government Entity IDs
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {selectedFilingForDetails.all_government_entity_ids.map((id: number, idx: number) => (
                        <Chip
                          key={idx}
                          label={id}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(107, 114, 128, 0.3)',
                            color: '#9ca3af',
                            border: '1px solid #6b7280',
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Lobbying Activities */}
                {selectedFilingForDetails.lobbying_activities && Array.isArray(selectedFilingForDetails.lobbying_activities) && selectedFilingForDetails.lobbying_activities.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Lobbying Activities ({selectedFilingForDetails.lobbying_activities.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {selectedFilingForDetails.lobbying_activities.map((activity: any, idx: number) => {
                        const isExpanded = expandedActivities.has(idx);
                        
                        // Build activity title
                        const activityTitle = activity.description 
                          || activity.general_issue_code_display 
                          || activity.general_issue_code 
                          || `Activity ${idx + 1}`;
                        
                        return (
                          <Box
                            key={idx}
                            sx={{
                              border: '1px solid #475569',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(15, 23, 42, 0.5)',
                              overflow: 'hidden',
                            }}
                          >
                            {/* Collapsible Header */}
                            <Box
                              onClick={() => {
                                setExpandedActivities(prev => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(idx)) {
                                    newSet.delete(idx);
                                  } else {
                                    newSet.add(idx);
                                  }
                                  return newSet;
                                });
                              }}
                              sx={{
                                p: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                backgroundColor: 'rgba(31, 41, 55, 0.5)',
                                '&:hover': {
                                  backgroundColor: 'rgba(31, 41, 55, 0.7)',
                                },
                              }}
                            >
                              <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>
                                {activityTitle}
                              </Typography>
                              <IconButton
                                size="small"
                                sx={{
                                  color: '#9ca3af',
                                  '&:hover': { color: '#ffffff' },
                                  padding: '4px',
                                }}
                              >
                                {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                              </IconButton>
                            </Box>
                            
                            {/* Collapsible Content */}
                            <Collapse in={isExpanded}>
                              <Box sx={{ p: 1.5, pt: 1 }}>
                                {activity.description && activity.description !== activityTitle && (
                                  <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, mb: 1, fontSize: '0.95rem' }}>
                                    {activity.description}
                                  </Typography>
                                )}
                                
                                {activity.general_issue_code && (
                                  <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                                    <strong>Issue Code:</strong> {activity.general_issue_code}
                                    {activity.general_issue_code_display ? ` (${activity.general_issue_code_display})` : ''}
                                  </Typography>
                                )}
                                
                                {activity.specific_issue && (
                                  <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                                    <strong>Specific Issue:</strong> {activity.specific_issue}
                                  </Typography>
                                )}
                                
                                {activity.foreign_entity_issues && (
                                  <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                                    <strong>Foreign Entity Issues:</strong> {activity.foreign_entity_issues}
                                  </Typography>
                                )}
                                
                                {/* Government Entities for this activity */}
                                {activity.government_entities && Array.isArray(activity.government_entities) && activity.government_entities.length > 0 && (
                                  <Box sx={{ mt: 1, mb: 0.5 }}>
                                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5, fontWeight: 500 }}>
                                      <strong>Government Entities:</strong>
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 1 }}>
                                      {activity.government_entities.map((entity: any, entityIdx: number) => (
                                        <Chip
                                          key={entityIdx}
                                          label={entity.name || entity.id || `Entity ${entityIdx + 1}`}
                                          size="small"
                                          sx={{
                                            backgroundColor: 'rgba(107, 114, 128, 0.3)',
                                            color: '#9ca3af',
                                            border: '1px solid #6b7280',
                                            fontSize: '0.7rem',
                                          }}
                                        />
                                      ))}
                                    </Box>
                                  </Box>
                                )}
                                
                                {/* Lobbyists for this activity - recursively extract from nested structure */}
                                {activity.lobbyists && Array.isArray(activity.lobbyists) && activity.lobbyists.length > 0 && (
                                  <Box sx={{ mt: 1, mb: 0.5 }}>
                                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5, fontWeight: 500 }}>
                                      <strong>Lobbyists ({activity.lobbyists.length}):</strong>
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 1 }}>
                                      {activity.lobbyists.map((lobbyistItem: any, lobbyistIdx: number) => {
                                        // Handle nested structure: activity.lobbyists[].lobbyist
                                        const lobbyist = lobbyistItem.lobbyist || lobbyistItem;
                                        
                                        // Build full name from first_name, last_name, etc.
                                        let fullName = '';
                                        if (typeof lobbyist === 'string') {
                                          fullName = lobbyist;
                                        } else if (lobbyist.first_name || lobbyist.last_name) {
                                          const parts = [
                                            lobbyist.prefix_display || lobbyist.prefix,
                                            lobbyist.first_name,
                                            lobbyist.middle_name,
                                            lobbyist.last_name,
                                            lobbyist.suffix_display || lobbyist.suffix
                                          ].filter(Boolean);
                                          fullName = parts.join(' ').trim();
                                        } else {
                                          fullName = lobbyist.name || lobbyist.lobbyist_name || `Lobbyist ${lobbyistIdx + 1}`;
                                        }
                                        
                                        return (
                                          <Box
                                            key={lobbyistIdx}
                                            sx={{
                                              p: 1.5,
                                              border: '1px solid #475569',
                                              borderRadius: '4px',
                                              backgroundColor: 'rgba(15, 23, 42, 0.3)',
                                            }}
                                          >
                                            <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.85rem', mb: 0.5 }}>
                                              {fullName}
                                            </Typography>
                                            
                                            {/* PII - Contact Information */}
                                            {lobbyist.contact_name && (
                                              <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, fontSize: '0.8rem', mt: 0.5 }}>
                                                <strong>Contact:</strong> {lobbyist.contact_name}
                                              </Typography>
                                            )}
                                            {lobbyist.contact_telephone && (
                                              <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, fontSize: '0.8rem', mt: 0.5 }}>
                                                <strong>Phone:</strong> {lobbyist.contact_telephone}
                                              </Typography>
                                            )}
                                            {lobbyist.email && (
                                              <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, fontSize: '0.8rem', mt: 0.5 }}>
                                                <strong>Email:</strong> {lobbyist.email}
                                              </Typography>
                                            )}
                                            {lobbyist.phone && (
                                              <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, fontSize: '0.8rem', mt: 0.5 }}>
                                                <strong>Phone:</strong> {lobbyist.phone}
                                              </Typography>
                                            )}
                                            
                                            {/* PII - Address Information */}
                                            {(lobbyist.address_1 || lobbyist.address) && (
                                              <Box sx={{ mt: 0.5 }}>
                                                <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 500, fontSize: '0.8rem', mb: 0.25 }}>
                                                  <strong>Address:</strong>
                                                </Typography>
                                                <Typography variant="body2" sx={{ color: '#fbbf24', fontSize: '0.75rem', pl: 1, fontStyle: 'italic' }}>
                                                  {lobbyist.address_1 || lobbyist.address}
                                                  {lobbyist.address_2 ? `, ${lobbyist.address_2}` : ''}
                                                  {lobbyist.city || lobbyist.state || lobbyist.zip ? (
                                                    <>
                                                      <br />
                                                      {[lobbyist.city, lobbyist.state, lobbyist.zip].filter(Boolean).join(', ')}
                                                    </>
                                                  ) : null}
                                                  {lobbyist.country ? (
                                                    <>
                                                      <br />
                                                      {lobbyist.country}
                                                    </>
                                                  ) : null}
                                                </Typography>
                                              </Box>
                                            )}
                                            
                                            {/* Other lobbyist details */}
                                            {lobbyist.id && (
                                              <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', mt: 0.5 }}>
                                                ID: <span style={{ fontFamily: 'monospace' }}>{lobbyist.id}</span>
                                              </Typography>
                                            )}
                                            {lobbyist.lobbyist_id && (
                                              <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', mt: 0.5 }}>
                                                Lobbyist ID: <span style={{ fontFamily: 'monospace' }}>{lobbyist.lobbyist_id}</span>
                                              </Typography>
                                            )}
                                            {lobbyistItem.covered_position && lobbyistItem.covered_position !== 'N/A' && (
                                              <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 0.5 }}>
                                                Position: {lobbyistItem.covered_position}
                                              </Typography>
                                            )}
                                            {lobbyistItem.new !== null && lobbyistItem.new !== undefined && (
                                              <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 0.5 }}>
                                                New: {lobbyistItem.new ? 'Yes' : 'No'}
                                              </Typography>
                                            )}
                                          </Box>
                                        );
                                      })}
                                    </Box>
                                  </Box>
                                )}
                                
                                {activity.house_id && (
                                  <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', mt: 0.5 }}>
                                    House ID: <span style={{ fontFamily: 'monospace' }}>{activity.house_id}</span>
                                  </Typography>
                                )}
                                
                                {activity.senate_id && (
                                  <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', mt: 0.5 }}>
                                    Senate ID: <span style={{ fontFamily: 'monospace' }}>{activity.senate_id}</span>
                                  </Typography>
                                )}
                                
                                {activity.amount && (
                                  <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                                    <strong>Amount:</strong> {formatCurrency(activity.amount)}
                                  </Typography>
                                )}
                              </Box>
                            </Collapse>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                )}

                {/* Affiliated Organizations */}
                {selectedFilingForDetails.affiliated_organizations && Array.isArray(selectedFilingForDetails.affiliated_organizations) && selectedFilingForDetails.affiliated_organizations.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Affiliated Organizations ({selectedFilingForDetails.affiliated_organizations.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {selectedFilingForDetails.affiliated_organizations.map((org: any, idx: number) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 1,
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                          }}
                        >
                          {org.name && (
                            <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                              {org.name}
                            </Typography>
                          )}
                          {org.id && (
                            <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                              ID: <span style={{ fontFamily: 'monospace' }}>{org.id}</span>
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Foreign Entities */}
                {selectedFilingForDetails.foreign_entities && Array.isArray(selectedFilingForDetails.foreign_entities) && selectedFilingForDetails.foreign_entities.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Foreign Entities ({selectedFilingForDetails.foreign_entities.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {selectedFilingForDetails.foreign_entities.map((entity: any, idx: number) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 1,
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                          }}
                        >
                          {entity.name && (
                            <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                              {entity.name}
                            </Typography>
                          )}
                          {entity.country && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                              <strong>Country:</strong> {entity.country}
                            </Typography>
                          )}
                          {entity.id && (
                            <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                              ID: <span style={{ fontFamily: 'monospace' }}>{entity.id}</span>
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Contribution Items */}
                {selectedFilingForDetails.contribution_items && Array.isArray(selectedFilingForDetails.contribution_items) && selectedFilingForDetails.contribution_items.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Contribution Items ({selectedFilingForDetails.contribution_items.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {selectedFilingForDetails.contribution_items.map((item: any, idx: number) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 1.5,
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                          }}
                        >
                          {item.recipient_name && (
                            <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                              {item.recipient_name}
                            </Typography>
                          )}
                          {item.amount && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                              <strong>Amount:</strong> {formatCurrency(item.amount)}
                            </Typography>
                          )}
                          {item.date && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                              <strong>Date:</strong> {formatDate(item.date)}
                            </Typography>
                          )}
                          {item.description && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                              <strong>Description:</strong> {item.description}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Conviction Disclosures */}
                {selectedFilingForDetails.conviction_disclosures && Array.isArray(selectedFilingForDetails.conviction_disclosures) && selectedFilingForDetails.conviction_disclosures.length > 0 && (
                  <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: '4px', backgroundColor: 'rgba(31, 41, 55, 0.3)' }}>
                    <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Conviction Disclosures ({selectedFilingForDetails.conviction_disclosures.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {selectedFilingForDetails.conviction_disclosures.map((disclosure: any, idx: number) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 1.5,
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                          }}
                        >
                          {disclosure.description && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                              {disclosure.description}
                            </Typography>
                          )}
                          {disclosure.date && (
                            <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 0.5 }}>
                              <strong>Date:</strong> {formatDate(disclosure.date)}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => {
              setDetailsDialogOpen(false);
              setExpandedActivities(new Set());
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
          </>
        )}
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

