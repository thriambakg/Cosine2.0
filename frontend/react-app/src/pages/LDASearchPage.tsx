import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Pagination,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { ldaSearchAPI, ldaAutocompleteAPI, LDASearchFilters, LDAFiling, LDAAutocompleteItem } from '../services/api';
import MultiSelectField from '../components/MultiSelectField';
import { useAuth } from '../contexts/AuthContext';
import { useEasyMode } from '../contexts/EasyModeContext';
import FileBrowserDialog from '../components/common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../hooks/useDialogManagerHelpers';
import { filesystemAPI } from '../services/api';
import { compressedSessionStorage } from '../utils/compressedStorage';
import { getSearchPageBatchSize } from './config/searchPageConfig';

// Minimum date for date filters (January 1, 2000)
const MIN_DATE = '2000-01-01';
import { addLDAFilingToContext, addMultipleLDAFilingsToContext } from '../components/tiles/common/contextManager';

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

// Filter expand state interface
interface ExpandedFiltersState {
  registrants: boolean;
  clients: boolean;
  lobbyists: boolean;
  filingTypes: boolean;
  issueCodes: boolean;
  states: boolean;
}

// Types are imported from api.ts - using LDASearchFilters and LDAFiling from there

const LDASearchPage: React.FC = () => {
  // Session persistence key
  const SESSION_STORAGE_KEY = 'lda-search-page-state';

  // Helper function to load state from sessionStorage (with compression support)
  const loadStateFromStorage = () => {
    try {
      return compressedSessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch (error) {
      console.error('❌ Error loading state from sessionStorage:', error);
      // Fallback to uncompressed
      try {
        const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (savedState) {
          return JSON.parse(savedState);
        }
      } catch (fallbackError) {
        console.error('❌ Error loading state from uncompressed storage:', fallbackError);
      }
    }
    return null;
  };

  // Get user and session info for authenticated downloads
  const { user } = useAuth();
  const { openItemDetails } = useDialogManagerHelpers();
  const { isEasyMode } = useEasyMode();

  // Initialize state from sessionStorage immediately
  const savedState = loadStateFromStorage();


  // Search state
  const [searchParams, setSearchParams] = useState<LDASearchFilters>(
    savedState?.searchParams || {
      general_text_search: [],
      date_from: '',
      date_to: '',
      amount_min: undefined,
      amount_max: undefined,
    }
  );
  
  // Store selected general search items with their types - restore from saved state
  const [generalSearchItems, setGeneralSearchItems] = useState<LDAAutocompleteItem[]>(
    savedState?.generalSearchItems || []
  );
  
  const [allSearchResults, setAllSearchResults] = useState<LDAFiling[]>(
    savedState?.allSearchResults || [] // Restore cached results
  );
  const [currentResults, setCurrentResults] = useState<LDAFiling[]>(
    savedState?.allSearchResults || [] // Initialize with cached results
  );
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 50);
  
  
  // Selection state
  const [selectedFilings, setSelectedFilings] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  // Column visibility state
  const AVAILABLE_COLUMNS = [
    'filing_type',
    'filing_period',
    'filing_year',
    'registrant',
    'client',
    'amount',
    'date_posted',
    'state',
  ];
  const DEFAULT_VISIBLE_COLUMNS = ['filing_type', 'filing_period', 'filing_year', 'registrant', 'client', 'amount', 'date_posted', 'state'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Handle column toggle
  const handleColumnToggle = useCallback((column: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        return prev.filter((c) => c !== column);
      } else {
        return [...prev, column];
      }
    });
  }, []);
  
  // Filter state (client-side filtering)
  const [availableFilters, setAvailableFilters] = useState<{
    registrant_filters?: Array<{ registrant: string; count: number }>;
    client_filters?: Array<{ client: string; count: number }>;
    lobbyist_filters?: Array<{ lobbyist: string; count: number }>;
    filing_type_filters?: Array<{ filingType: string; count: number }>;
    issue_code_filters?: Array<{ issueCode: string; count: number }>;
    state_filters?: Array<{ state: string; count: number }>;
  }>(savedState?.availableFilters || {});
  
  const [expandedFilters, setExpandedFilters] = useState<ExpandedFiltersState>(
    savedState?.expandedFilters || {
      registrants: false,
      clients: false,
      lobbyists: false,
      filingTypes: false,
      issueCodes: false,
      states: false,
    }
  );

  // General issues and government entities loaded from local CSV files
  const [generalIssues, setGeneralIssues] = useState<string[]>([]);
  const [governmentEntities, setGovernmentEntities] = useState<string[]>([]);
  
  const [selectedFilters, setSelectedFilters] = useState<{
    registrants: string[];
    clients: string[];
    lobbyists: string[];
    filingTypes: string[];
    issueCodes: string[];
    states: string[];
  }>({
    registrants: savedState?.selectedFilters?.registrants || [],
    clients: savedState?.selectedFilters?.clients || [],
    lobbyists: savedState?.selectedFilters?.lobbyists || [],
    filingTypes: savedState?.selectedFilters?.filingTypes || [],
    issueCodes: savedState?.selectedFilters?.issueCodes || [],
    states: savedState?.selectedFilters?.states || [],
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(savedState?.isFiltered || false);
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== undefined ? savedState.advancedSearchExpanded : false);
  const [searchSidebarVisible, setSearchSidebarVisible] = useState<boolean>(savedState?.searchSidebarVisible !== undefined ? savedState.searchSidebarVisible : true);

  // Helper function to clean double quotes from CSV values
  const cleanCSVValue = (value: string): string => {
    // Remove surrounding double quotes if present
    return value.trim().replace(/^"+|"+$/g, '');
  };

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
          console.log(`✅ Loaded ${lines.length} general issues from CSV`);
        } else {
          console.error('❌ Failed to load general_issues.csv');
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
          console.log(`✅ Loaded ${lines.length} government entities from CSV`);
        } else {
          console.error('❌ Failed to load government_entities.csv');
        }
      } catch (error) {
        console.error('❌ Error loading CSV data:', error);
      }
    };
    loadCSVData();
  }, []);

  // Log state restoration
  useEffect(() => {
    if (savedState) {
      console.log('🔄 Restored LDA search page state from sessionStorage:', {
        hasSearchParams: !!savedState.searchParams,
        allResultsCount: savedState.allSearchResults?.length || savedState.resultCount || 0,
        totalFound: savedState.totalFound || 0,
        hasFilters: !!savedState.selectedFilters,
        hasMore: savedState.hasMore,
      });
    } else {
      console.log('🆕 Starting fresh LDA search page session');
    }
  }, []);


  // Track if we're syncing from saved state to prevent loops
  const isSyncingFromSavedStateRef = useRef(false);

  // Rebuild generalSearchItems from searchParams.general_text_search_fields if it exists
  // This ensures consistency when searchParams is restored from sessionStorage
  useEffect(() => {
    if (searchParams.general_text_search_fields && generalSearchItems.length === 0) {
      isSyncingFromSavedStateRef.current = true;
      const newGeneralSearchItems: LDAAutocompleteItem[] = [];
      if (searchParams.general_text_search_fields.registrant && Array.isArray(searchParams.general_text_search_fields.registrant)) {
        searchParams.general_text_search_fields.registrant.forEach(value => {
          newGeneralSearchItems.push({ value, type: 'registrant', label: value });
        });
      }
      if (searchParams.general_text_search_fields.client && Array.isArray(searchParams.general_text_search_fields.client)) {
        searchParams.general_text_search_fields.client.forEach(value => {
          newGeneralSearchItems.push({ value, type: 'client', label: value });
        });
      }
      if (searchParams.general_text_search_fields.lobbyist && Array.isArray(searchParams.general_text_search_fields.lobbyist)) {
        searchParams.general_text_search_fields.lobbyist.forEach(value => {
          newGeneralSearchItems.push({ value, type: 'lobbyist', label: value });
        });
      }
      if (searchParams.general_text_search_fields.pac && Array.isArray(searchParams.general_text_search_fields.pac)) {
        searchParams.general_text_search_fields.pac.forEach(value => {
          newGeneralSearchItems.push({ value, type: 'pac', label: value });
        });
      }
      if (searchParams.general_text_search_fields.foreign && Array.isArray(searchParams.general_text_search_fields.foreign)) {
        searchParams.general_text_search_fields.foreign.forEach(value => {
          newGeneralSearchItems.push({ value, type: 'foreign', label: value });
        });
      }
      if (newGeneralSearchItems.length > 0) {
        console.log('🔄 Rebuilding generalSearchItems from searchParams:', newGeneralSearchItems.length, 'items');
        setGeneralSearchItems(newGeneralSearchItems);
      }
      isSyncingFromSavedStateRef.current = false;
    }
  }, [searchParams.general_text_search_fields]); // Only run when general_text_search_fields changes

  // Sync generalSearchItems to searchParams.general_text_search_fields
  // Skip this sync when we're syncing from saved state to avoid overwriting
  useEffect(() => {
    if (isSyncingFromSavedStateRef.current) {
      return; // Don't sync when syncing from saved state
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
      
      setSearchParams(prev => ({
        ...prev,
        general_text_search_fields: generalTextSearchFields
      }));
    } else {
      // Clear general_text_search_fields if generalSearchItems is empty
      setSearchParams(prev => {
        const newParams = { ...prev };
        if (newParams.general_text_search_fields) {
          newParams.general_text_search_fields = {
            registrant: false,
            client: false,
            lobbyist: false,
            pac: false,
            foreign: false,
          };
        }
        return newParams;
      });
    }
  }, [generalSearchItems]);

  // Save state to sessionStorage
  useEffect(() => {
    try {
      // Save allSearchResults since they contain minimal data (keys and top-level GSI data)
      // This enables client-side filtering and table display without re-fetching
      const stateToSave = {
        searchParams,
        generalSearchItems, // Include generalSearchItems in saved state
        allSearchResults, // Save results for caching (minimal data - keys and GSI fields)
        totalFound,
        isSearching,
        selectedFilters,
        availableFilters, // Save filters for quick restoration
        expandedFilters,
        isFiltered,
        currentPage,
        pageSize,
        lastEvaluatedKey,
        hasMore,
        advancedSearchExpanded,
        visibleColumns,
        searchSidebarVisible,
      };
      
      // Use compressed storage (automatically compresses if beneficial)
      compressedSessionStorage.setItem(SESSION_STORAGE_KEY, stateToSave);
    } catch (error: any) {
      // Handle quota exceeded errors gracefully
      if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
        console.warn('SessionStorage quota exceeded, saving minimal state only');
        try {
          // Save only essential state (compressed) - still include results for caching
          const minimalState = {
            searchParams,
            generalSearchItems,
            allSearchResults, // Keep results even in minimal state for caching
            totalFound,
            lastEvaluatedKey,
            hasMore,
            currentPage,
            pageSize,
            visibleColumns,
          };
          compressedSessionStorage.setItem(SESSION_STORAGE_KEY, minimalState);
        } catch (minimalError) {
          console.error('Failed to save even minimal state:', minimalError);
        }
      } else {
        console.error('Error saving state to sessionStorage:', error);
      }
    }
  }, [
    searchParams,
    generalSearchItems,
    allSearchResults, // Depend on full array to save cached results
    totalFound,
    isSearching,
    selectedFilters,
    availableFilters, // Save filters for quick restoration
    expandedFilters,
    isFiltered,
    currentPage,
    pageSize,
    lastEvaluatedKey,
    hasMore,
    advancedSearchExpanded,
    visibleColumns,
    searchSidebarVisible,
  ]);

  // Compute filters from search results
  const computeFiltersFromResults = useCallback((results: LDAFiling[]) => {
    if (!results || results.length === 0) {
      setAvailableFilters({});
      return;
    }

    // Count occurrences of each filter value
    const registrantCounts = new Map<string, number>();
    const clientCounts = new Map<string, number>();
    const lobbyistCounts = new Map<string, number>();
    const filingTypeCounts = new Map<string, number>();
    const issueCodeCounts = new Map<string, number>();
    const stateCounts = new Map<string, number>();

    results.forEach(filing => {
      // Registrants
      if (filing.registrant_name) {
        registrantCounts.set(filing.registrant_name, (registrantCounts.get(filing.registrant_name) || 0) + 1);
      }
      
      // Clients
      if (filing.client_name) {
        clientCounts.set(filing.client_name, (clientCounts.get(filing.client_name) || 0) + 1);
      }
      
      // Lobbyists - handle both FILING (all_lobbyist_names) and CONTRIBUTION (lobbyist_name) types
      if (filing.all_lobbyist_names && Array.isArray(filing.all_lobbyist_names)) {
        // FILING type: use all_lobbyist_names array
        filing.all_lobbyist_names.forEach((name: string) => {
          if (name) {
            lobbyistCounts.set(name, (lobbyistCounts.get(name) || 0) + 1);
          }
        });
      } else if (filing.lobbyist_name) {
        // CONTRIBUTION type: use lobbyist_name
        lobbyistCounts.set(filing.lobbyist_name, (lobbyistCounts.get(filing.lobbyist_name) || 0) + 1);
      }
      
      // Filing types
      if (filing.report_type) {
        filingTypeCounts.set(filing.report_type, (filingTypeCounts.get(filing.report_type) || 0) + 1);
      }
      
      // Issue codes
      if (filing.general_issue_code) {
        issueCodeCounts.set(filing.general_issue_code, (issueCodeCounts.get(filing.general_issue_code) || 0) + 1);
      }
      
      // States
      if (filing.state) {
        stateCounts.set(filing.state, (stateCounts.get(filing.state) || 0) + 1);
      }
    });

    // Convert maps to sorted arrays (by count descending, then alphabetically)
    const sortByCountThenName = <T extends { count: number }>(a: T, b: T, getName: (item: T) => string) => {
      if (b.count !== a.count) return b.count - a.count;
      return getName(a).localeCompare(getName(b));
    };

    setAvailableFilters({
      registrant_filters: Array.from(registrantCounts.entries())
        .map(([registrant, count]) => ({ registrant, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.registrant))
        .slice(0, 50), // Limit to top 50
      client_filters: Array.from(clientCounts.entries())
        .map(([client, count]) => ({ client, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.client))
        .slice(0, 50),
      lobbyist_filters: Array.from(lobbyistCounts.entries())
        .map(([lobbyist, count]) => ({ lobbyist, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.lobbyist))
        .slice(0, 50),
      filing_type_filters: Array.from(filingTypeCounts.entries())
        .map(([filingType, count]) => ({ filingType, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.filingType)),
      issue_code_filters: Array.from(issueCodeCounts.entries())
        .map(([issueCode, count]) => ({ issueCode, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.issueCode))
        .slice(0, 50),
      state_filters: Array.from(stateCounts.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => sortByCountThenName(a, b, (item) => item.state)),
    });
  }, []);

  // Client-side filtering function
  const applyFilters = useCallback(() => {
    let filtered = [...allSearchResults];
    
    // Filter by registrants
    if (selectedFilters.registrants.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.registrants.includes(filing.registrant_name || '')
      );
    }
    
    // Filter by clients
    if (selectedFilters.clients.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.clients.includes(filing.client_name || '')
      );
    }
    
    // Filter by lobbyists - handle both FILING (all_lobbyist_names) and CONTRIBUTION (lobbyist_name) types
    if (selectedFilters.lobbyists.length > 0) {
      filtered = filtered.filter(filing => {
        if (filing.all_lobbyist_names && Array.isArray(filing.all_lobbyist_names)) {
          // FILING type: check if any lobbyist name matches
          return filing.all_lobbyist_names.some((name: string) => 
            selectedFilters.lobbyists.includes(name)
          );
        } else if (filing.lobbyist_name) {
          // CONTRIBUTION type: check lobbyist_name
          return selectedFilters.lobbyists.includes(filing.lobbyist_name);
        }
        return false;
      });
    }
    
    // Filter by filing types
    if (selectedFilters.filingTypes.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.filingTypes.includes(filing.report_type || '')
      );
    }
    
    // Filter by issue codes
    if (selectedFilters.issueCodes.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.issueCodes.includes(filing.general_issue_code || '')
      );
    }
    
    // Filter by states
    if (selectedFilters.states.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.states.includes(filing.state || '')
      );
    }
    
    setCurrentResults(filtered);
    setIsFiltered(
      selectedFilters.registrants.length > 0 ||
      selectedFilters.clients.length > 0 ||
      selectedFilters.lobbyists.length > 0 ||
      selectedFilters.filingTypes.length > 0 ||
      selectedFilters.issueCodes.length > 0 ||
      selectedFilters.states.length > 0
    );
  }, [allSearchResults, selectedFilters]);

  // Compute available filters when search results change
  useEffect(() => {
    if (allSearchResults.length > 0) {
      computeFiltersFromResults(allSearchResults);
    } else {
      setAvailableFilters({});
    }
  }, [allSearchResults, computeFiltersFromResults]);

  // Apply filters when selectedFilters or allSearchResults change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Perform search
  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    setAllSearchResults([]);
    setCurrentResults([]);
    setLastEvaluatedKey(null);
    setHasMore(false);
    // Clear client-side filters when performing a new search
    setSelectedFilters({
      registrants: [],
      clients: [],
      lobbyists: [],
      filingTypes: [],
      issueCodes: [],
      states: [],
    });
    setIsFiltered(false);
    
    try {
      // Transform searchParams to new format with general_text_search_fields
      const filters: LDASearchFilters = { ...searchParams };
      
      // Build general_text_search_fields from selected items with types
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
      
      // Group selected items by type
      if (generalSearchItems.length > 0) {
        const itemsByType: Record<string, string[]> = {};
        generalSearchItems.forEach(item => {
          const type = item.type || 'unknown';
          if (!itemsByType[type]) {
            itemsByType[type] = [];
          }
          itemsByType[type].push(item.value);
        });
        
        // Set arrays for types that have items, false for others
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
      }
      
      filters.general_text_search_fields = generalTextSearchFields;
      delete filters.general_text_search; // Remove old format
      
      const response = await ldaSearchAPI.search({
        filters: filters,
      });
      
      if (response.success && response.results) {
        setAllSearchResults(response.results);
        setCurrentResults(response.results);
        setTotalFound(response.count || response.results.length);
        // Only set hasMore if we have a valid last_evaluated_key for pagination
        // If backend says has_more but provides no key, we can't actually load more
        const hasValidPaginationKey = response.last_evaluated_key !== null && response.last_evaluated_key !== undefined;
        setHasMore((response.has_more || false) && hasValidPaginationKey);
        setLastEvaluatedKey(response.last_evaluated_key || null);
      } else {
        setSearchError('No results found');
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

  // Restore cached results and filters on mount
  useEffect(() => {
    // If we have cached results, restore them and compute filters
    if (savedState?.allSearchResults && savedState.allSearchResults.length > 0) {
      console.log('🔄 LDA Search Page: Restoring cached results from sessionStorage:', savedState.allSearchResults.length, 'results');
      setAllSearchResults(savedState.allSearchResults);
      setCurrentResults(savedState.allSearchResults);
      setTotalFound(savedState.totalFound || savedState.allSearchResults.length);
      setHasMore(savedState.hasMore || false);
      setLastEvaluatedKey(savedState.lastEvaluatedKey || null);
      
      // Compute filters from cached results
      computeFiltersFromResults(savedState.allSearchResults);
    } else if (savedState?.availableFilters) {
      // Restore available filters if they were cached
      console.log('🔄 LDA Search Page: Restoring cached filters from sessionStorage');
      setAvailableFilters(savedState.availableFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load more results
  const handleLoadMore = async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
    try {
      // Transform searchParams to new format with general_text_search_fields (same as handleSearch)
      const filters: LDASearchFilters = { ...searchParams };
      
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
      
      if (generalSearchItems.length > 0) {
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
      }
      
      filters.general_text_search_fields = generalTextSearchFields;
      delete filters.general_text_search;
      
      const response = await ldaSearchAPI.search({
        filters: filters,
        limit: getSearchPageBatchSize('lda'),
        last_evaluated_key: lastEvaluatedKey,
      });
      
      if (response.success && response.results) {
        // Deduplicate results by filing ID (id or filing_uuid)
        const existingIds = new Set(
          allSearchResults.map(filing => filing.id || filing.filing_uuid || '')
        );
        const uniqueNewResults = response.results.filter(
          filing => {
            const id = filing.id || filing.filing_uuid || '';
            return id && !existingIds.has(id);
          }
        );
        const newResults = [...allSearchResults, ...uniqueNewResults];
        setAllSearchResults(newResults);
        setCurrentResults(newResults);
        // Only set hasMore if we have a valid last_evaluated_key for pagination
        const hasValidPaginationKey = response.last_evaluated_key !== null && response.last_evaluated_key !== undefined;
        setHasMore((response.has_more || false) && hasValidPaginationKey);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        setTotalFound(response.count ? allSearchResults.length + response.count : newResults.length);
      } else {
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

  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
    setContextMenuPosition(null);
  };

  // Handle filing click (single, Ctrl+click, Shift+click)
  const handleFilingClick = (e: React.MouseEvent, filingId: string, index: number) => {
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedFilings(prev => {
      const newSelected = new Set(prev);
      
      // Calculate pagination offset
      const startIndex = (currentPage - 1) * pageSize;
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection - map indices back to currentResults
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const filingsToSelect = currentResults.slice(startIndex + start, startIndex + end + 1);
        filingsToSelect.forEach(filing => {
          const id = filing.id || filing.filing_uuid || '';
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
      const id = filing.id || filing.filing_uuid || '';
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
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleAddToFiles = () => {
    if (selectedFilings.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedFilings.size === 0) return;
    
    try {
      const selectedFilingObjects = currentResults.filter(filing => 
        selectedFilings.has(filing.id || filing.filing_uuid || '')
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
      setSelectedFilings(new Set());
    } catch (error) {
      console.error('Error saving filings to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedFilingObjects = currentResults.filter(filing => 
      selectedFilings.has(filing.id || filing.filing_uuid || '')
    );

    if (selectedFilingObjects.length === 0) return;

    // Add to context using the context manager functions
    if (selectedFilingObjects.length === 1) {
      addLDAFilingToContext(selectedFilingObjects[0]);
    } else {
      addMultipleLDAFilingsToContext(selectedFilingObjects);
    }

    setSelectedFilings(new Set());
    handleContextMenuClose();
  };
  
  // Removed unused toggleFilingSelection - selection handled by handleFilingClick

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

  const formatCurrency = (amount: number | undefined) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Calculate pagination values
  const totalPages = Math.ceil(currentResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = currentResults.slice(startIndex, endIndex);

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 4, fontWeight: 600 }}>
          LDA Disclosures Search
        </Typography>

        {/* Main Layout: Search Filters (Left) | Results (Middle) | Client-side Filter Box (Right) */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Search Filters (Collapsible) */}
          {searchSidebarVisible ? (
            <GlassCard sx={{ 
            minWidth: 320,
            maxWidth: 380,
            width: 320,
            minHeight: 'fit-content',
            height: 'fit-content',
            position: 'sticky',
            top: 20,
            alignSelf: 'flex-start',
            transition: 'all 0.3s ease-in-out',
          }}>
              <Box sx={{ p: 3, position: 'relative' }}>
                <Box sx={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  mb: 2 
                }}>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    Search Filters
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
                  {/* General Text Search */}
                  <Box data-tutorial="general-search">
                    <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                      General Search
                    </Typography>
                    <MultiSelectField<LDAAutocompleteItem>
                      label="Search"
                      selectedItems={generalSearchItems}
                      onItemsChange={(items) => {
                        // Store full autocomplete items with types
                        const autocompleteItems = items.map(item => 
                          typeof item === 'string' 
                            ? { value: item, type: 'unknown', label: item }
                            : item
                        );
                        setGeneralSearchItems(autocompleteItems);
                        // Also update searchParams for backward compatibility
                        const values = autocompleteItems.map(item => item.value);
                        setSearchParams(prev => ({ ...prev, general_text_search: values }));
                      }}
                      suggestions={[]}
                      onSearch={async (query: string, offset?: number) => {
                        try {
                          const response = await ldaAutocompleteAPI.search({
                            query,
                            field_types: ['registrant', 'client', 'lobbyist', 'pac'],
                            limit: 20,
                            offset: offset || 0,
                          });
                          console.log('🔍 General search autocomplete response:', {
                            query,
                            offset,
                            resultsCount: (response.results || []).length,
                            has_more: response.has_more,
                            total_count: response.total_count
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
                        const typeColors: Record<string, { bg: string; text: string; border: string }> = {
                          registrant: { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: '#3b82f6' },
                          client: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: '#10b981' },
                          lobbyist: { bg: 'rgba(168, 85, 247, 0.15)', text: '#a78bfa', border: '#a855f7' },
                          pac: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: '#f59e0b' },
                          foreign: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: '#ef4444' },
                          general_issue: { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: '#ec4899' },
                        };
                        const typeColor = typeColors[item.type] || { bg: 'rgba(107, 114, 128, 0.15)', text: '#9ca3af', border: '#6b7280' };
                        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1).replace('_', ' ');
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                            <Chip
                              label={typeLabel}
                              size="small"
                              sx={{
                                backgroundColor: typeColor.bg,
                                color: typeColor.text,
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
                      placeholder="Type to search..."
                      allowCustomInput={false}
                    />
                  </Box>

                  {/* Date Range */}
                  <Box data-tutorial="date-range" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="Date From"
                      type="date"
                      value={searchParams.date_from || ''}
                      onChange={(e) => {
                        let dateValue = e.target.value || undefined;
                        // Validate: if date is before minimum, default to minimum
                        if (dateValue && dateValue < MIN_DATE) {
                          dateValue = MIN_DATE;
                        }
                        setSearchParams(prev => ({ ...prev, date_from: dateValue }));
                      }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{
                        min: MIN_DATE,
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
                    <TextField
                      label="Date To"
                      type="date"
                      value={searchParams.date_to || ''}
                      onChange={(e) => {
                        let dateValue = e.target.value || undefined;
                        // Validate: if date is before minimum, default to minimum
                        if (dateValue && dateValue < MIN_DATE) {
                          dateValue = MIN_DATE;
                        }
                        setSearchParams(prev => ({ ...prev, date_to: dateValue }));
                      }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{
                        min: MIN_DATE,
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
                  </Box>

                  {/* Amount Range - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="amount-range">
                    <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                      Amount Range
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <TextField
                        label="Min Amount"
                        type="number"
                        value={searchParams.amount_min || ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          setSearchParams(prev => ({ ...prev, amount_min: value }));
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
                      <TextField
                        label="Max Amount"
                        type="number"
                        value={searchParams.amount_max || ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          setSearchParams(prev => ({ ...prev, amount_max: value }));
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
                    </Box>
                  </Box>
                  )}

                  {/* Advanced Search - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="advanced-search" sx={{ mt: 2 }}>
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
                        {/* Registrant Name */}
                        <MultiSelectField<LDAAutocompleteItem>
                          label="Registrant Name"
                          selectedItems={(searchParams.registrant_name || []).map(value => ({ value, type: 'registrant', label: value }))}
                          onItemsChange={(items) => {
                            const values = items.map(item => typeof item === 'string' ? item : item.value);
                            setSearchParams(prev => ({ ...prev, registrant_name: values }));
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
                          renderOptionCustom={(item) => {
                            if (typeof item === 'string') {
                              return <Typography>{item}</Typography>;
                            }
                            return (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                                <Chip
                                  label="Registrant"
                                  size="small"
                                  sx={{
                                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                    color: '#60a5fa',
                                    border: '1px solid #3b82f6',
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
                          placeholder="Search registrants..."
                          allowCustomInput={false}
                        />

                        {/* Client Name */}
                        <MultiSelectField<LDAAutocompleteItem>
                          label="Client Name"
                          selectedItems={(searchParams.client_name || []).map(value => ({ value, type: 'client', label: value }))}
                          onItemsChange={(items) => {
                            const values = items.map(item => typeof item === 'string' ? item : item.value);
                            setSearchParams(prev => ({ ...prev, client_name: values }));
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
                          renderOptionCustom={(item) => {
                            if (typeof item === 'string') {
                              return <Typography>{item}</Typography>;
                            }
                            return (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                                <Chip
                                  label="Client"
                                  size="small"
                                  sx={{
                                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                    color: '#34d399',
                                    border: '1px solid #10b981',
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
                          placeholder="Search clients..."
                          allowCustomInput={false}
                        />

                        {/* Lobbyist Name */}
                        <MultiSelectField<LDAAutocompleteItem>
                          label="Lobbyist Name"
                          selectedItems={(searchParams.lobbyist_name || []).map(value => ({ value, type: 'lobbyist', label: value }))}
                          onItemsChange={(items) => {
                            const values = items.map(item => typeof item === 'string' ? item : item.value);
                            setSearchParams(prev => ({ ...prev, lobbyist_name: values }));
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
                          renderOptionCustom={(item) => {
                            if (typeof item === 'string') {
                              return <Typography>{item}</Typography>;
                            }
                            return (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                                <Chip
                                  label="Lobbyist"
                                  size="small"
                                  sx={{
                                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                                    color: '#a78bfa',
                                    border: '1px solid #a855f7',
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
                          placeholder="Search lobbyists..."
                          allowCustomInput={false}
                        />

                        {/* Foreign Entity Name */}
                        <MultiSelectField<LDAAutocompleteItem>
                          label="Foreign Entity Name"
                          selectedItems={(searchParams.foreign_entity_name || []).map(value => ({ value, type: 'foreign', label: value }))}
                          onItemsChange={(items) => {
                            const values = items.map(item => typeof item === 'string' ? item : item.value);
                            setSearchParams(prev => ({ ...prev, foreign_entity_name: values }));
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
                          renderOptionCustom={(item) => {
                            if (typeof item === 'string') {
                              return <Typography>{item}</Typography>;
                            }
                            return (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                <Typography sx={{ color: '#ffffff', flex: 1 }}>{item.value}</Typography>
                                <Chip
                                  label="Foreign"
                                  size="small"
                                  sx={{
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    color: '#f87171',
                                    border: '1px solid #ef4444',
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
                          placeholder="Search foreign entities..."
                          allowCustomInput={false}
                        />

                        {/* General Issue Code */}
                        <MultiSelectField<string>
                          label="General Issue Code"
                          selectedItems={searchParams.general_issue_code || []}
                          onItemsChange={(codes) => {
                            setSearchParams(prev => ({ ...prev, general_issue_code: codes }));
                          }}
                          suggestions={generalIssues}
                          onSearch={(query: string) => {
                            if (!query || query.trim() === '') {
                              return generalIssues;
                            }
                            const queryLower = query.toLowerCase().trim();
                            // Filter: starts with query, then contains query
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
                          selectedItems={searchParams.government_entity || []}
                          onItemsChange={(entities) => {
                            setSearchParams(prev => ({ ...prev, government_entity: entities }));
                          }}
                          suggestions={governmentEntities}
                          onSearch={(query: string) => {
                            // Show all results when dropdown is opened (empty query)
                            if (!query || query.trim() === '') {
                              return governmentEntities;
                            }
                            const queryLower = query.toLowerCase().trim();
                            // Filter with priority: starts with query, then contains query
                            const startsWith = governmentEntities.filter(entity => 
                              entity.toLowerCase().startsWith(queryLower)
                            );
                            const contains = governmentEntities.filter(entity => 
                              !entity.toLowerCase().startsWith(queryLower) && 
                              entity.toLowerCase().includes(queryLower)
                            );
                            // Return starts with matches first, then contains matches
                            return [...startsWith, ...contains];
                          }}
                          renderItem={(entity) => entity}
                          placeholder="Search or select government entities..."
                          allowCustomInput={false}
                        />

                        {/* Item Type - Checkbox Multiselect (FILING or CONTRIBUTION) */}
                        <Box>
                          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                            Item Type
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {['FILING', 'CONTRIBUTION'].map((type) => {
                              const isSelected = Array.isArray(searchParams.item_type) 
                                ? searchParams.item_type.includes(type)
                                : searchParams.item_type === type;
                              return (
                                <Box
                                  key={type}
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
                                      const currentTypes = Array.isArray(prev.item_type) ? prev.item_type : (prev.item_type ? [prev.item_type] : []);
                                      if (isSelected) {
                                        const newTypes = currentTypes.filter(t => t !== type);
                                        return { ...prev, item_type: newTypes.length > 0 ? newTypes : [] };
                                      } else {
                                        return { ...prev, item_type: [...currentTypes, type] };
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
                                    {type}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>

                        {/* State */}
                        <MultiSelectField<string>
                          label="State"
                          selectedItems={searchParams.state || []}
                          onItemsChange={(states) => {
                            setSearchParams(prev => ({ ...prev, state: states }));
                          }}
                          suggestions={[
                            'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
                            'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
                            'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                            'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
                            'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
                          ]}
                          onSearch={() => []}
                          renderItem={(state) => state}
                          placeholder="Select states..."
                          allowCustomInput={false}
                        />
                      </Box>
                    </Collapse>
                  </Box>
                  )}

                  {/* Search and Clear Buttons */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                    <Button
                      data-tutorial="search-button"
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
                          general_text_search: [],
                          date_from: '',
                          date_to: '',
                          item_type: [],
                          amount_min: undefined,
                          amount_max: undefined,
                        });
                        setGeneralSearchItems([]);
                        setSelectedFilters({
                          registrants: [],
                          clients: [],
                          lobbyists: [],
                          filingTypes: [],
                          issueCodes: [],
                          states: [],
                        });
                        setAllSearchResults([]);
                        setTotalFound(0);
                        setSelectedFilings(new Set());
                        setIsFiltered(false);
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
          <Box sx={{ flex: 1, minWidth: 0, transition: 'flex 0.3s ease-in-out' }}>
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
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title="Select columns to display">
                        <IconButton
                          size="small"
                          onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                          sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                        >
                          <ViewColumnIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      {/* Add to Context Button */}
                      {currentResults.length > 0 && (
                        <Tooltip title={`Add ${selectedFilings.size > 0 ? `${selectedFilings.size} filing(s)` : 'selected filings'} to context`}>
                          <span>
                            <IconButton
                              size="small"
                              onClick={handleContextMenuClick}
                              disabled={selectedFilings.size === 0}
                              sx={{ 
                                color: selectedFilings.size > 0 ? '#10b981' : '#9ca3af', 
                                '&:hover': { color: '#10b981' },
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
                          label={`${currentResults.length} filing${currentResults.length !== 1 ? 's' : ''} found`}
                          sx={{
                            backgroundColor: 'rgba(34, 197, 94, 0.2)',
                            color: '#86efac',
                            border: '1px solid #22c55e',
                            fontWeight: 600,
                          }}
                        />
                      ) : isFiltered && allSearchResults.length > 0 ? (
                        <Chip
                          label={`0 of ${allSearchResults.length} filings match filters`}
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : allSearchResults.length === 0 && !isSearching ? (
                        <Chip
                          label="No filings found"
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : null}
                      {currentResults.length > 0 && (
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
                                    '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                    '&.Mui-selected': { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
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

                  {/* Column Selection Menu */}
                  <Menu
                    anchorEl={columnMenuAnchor}
                    open={Boolean(columnMenuAnchor)}
                    onClose={() => setColumnMenuAnchor(null)}
                    PaperProps={{
                      sx: {
                        bgcolor: '#1f2937',
                        border: '1px solid #374151',
                        mt: 1,
                        minWidth: 200,
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
                      };
                      const isVisible = visibleColumns.includes(column);
                      return (
                        <MenuItem
                          key={column}
                          onClick={() => {
                            handleColumnToggle(column);
                          }}
                          sx={{
                            color: '#ffffff',
                            '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                            '&.Mui-selected': { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                          }}
                        >
                          <Checkbox
                            checked={isVisible}
                            size="small"
                            sx={{
                              color: '#9ca3af',
                              '&.Mui-checked': { color: '#3b82f6' },
                              mr: 1,
                            }}
                          />
                          {columnLabels[column] || column}
                        </MenuItem>
                      );
                    })}
                  </Menu>

                  {/* Results Table */}
                  {currentResults.length > 0 ? (
                    <>
                      <TableContainer data-tutorial="results-table" sx={{ 
                        backgroundColor: 'transparent',
                        borderRadius: 0,
                        boxShadow: 'none',
                        border: 'none',
                        overflow: 'auto',
                        width: '100%',
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
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell padding="none" sx={{ width: 40, padding: '8px 4px', color: '#9ca3af', fontWeight: 600 }}>
                                <Checkbox
                                  size="small"
                                  indeterminate={selectedFilings.size > 0 && selectedFilings.size < paginatedResults.length}
                                  checked={paginatedResults.length > 0 && selectedFilings.size === paginatedResults.length}
                                  onChange={() => {
                                    if (selectedFilings.size === paginatedResults.length) {
                                      const newSelected = new Set(selectedFilings);
                                      paginatedResults.forEach(filing => newSelected.delete(filing.id || filing.filing_uuid || ''));
                                      setSelectedFilings(newSelected);
                                    } else {
                                      const newSelected = new Set(selectedFilings);
                                      paginatedResults.forEach(filing => newSelected.add(filing.id || filing.filing_uuid || ''));
                                      setSelectedFilings(newSelected);
                                    }
                                  }}
                                  sx={{ 
                                    color: '#9ca3af', 
                                    '&.Mui-checked': { color: '#10b981' }, 
                                    '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                                  }}
                                />
                              </TableCell>
                              {visibleColumns.includes('filing_type') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Filing Type</TableCell>
                              )}
                              {visibleColumns.includes('filing_period') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Filing Period</TableCell>
                              )}
                              {visibleColumns.includes('filing_year') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Filing Year</TableCell>
                              )}
                              {visibleColumns.includes('registrant') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Registrant</TableCell>
                              )}
                              {visibleColumns.includes('client') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Client</TableCell>
                              )}
                              {visibleColumns.includes('amount') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Amount</TableCell>
                              )}
                              {visibleColumns.includes('date_posted') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Date Posted</TableCell>
                              )}
                              {visibleColumns.includes('state') && (
                                <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>State</TableCell>
                              )}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {paginatedResults.map((filing, index) => {
                              const filingId = filing.id || filing.filing_uuid || '';
                              return (
                              <TableRow
                                key={filingId}
                                onClick={(e) => handleFilingClick(e, filingId, index)}
                                onContextMenu={(e) => handleRowContextMenu(e, filingId)}
                                draggable={selectedFilings.has(filingId)}
                                onDragStart={(e) => handleDragStart(e, filingId)}
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
                                sx={{
                                  backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                  '&:hover': {
                                    backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                                  },
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                {/* Empty cell to maintain alignment */}
                                <TableCell sx={{ width: 40, padding: '8px 4px' }} />
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
                                {/* Actions column removed - use double-click to open details */}
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
                          mt: 2, 
                          pt: 2, 
                          borderTop: '1px solid rgba(55, 65, 81, 0.3)' 
                        }}>
                          <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                            Showing {startIndex + 1}-{Math.min(endIndex, currentResults.length)} of {currentResults.length} results
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
                            }}
                          />
                        </Box>
                      )}

                      {/* Load More Button */}
                      {!isFiltered && hasMore && lastEvaluatedKey && allSearchResults.length > 0 && (
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
                          ? 'No filings match the selected filters. Try adjusting your filters.'
                          : 'No filings found. Try adjusting your search parameters.'}
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
                Filing counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.registrants.length > 0 ||
                selectedFilters.clients.length > 0 ||
                selectedFilters.lobbyists.length > 0 ||
                selectedFilters.filingTypes.length > 0 ||
                selectedFilters.issueCodes.length > 0 ||
                selectedFilters.states.length > 0) && (
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
                    {selectedFilters.registrants.map((registrant, idx) => (
                      <Chip
                        key={`registrant-${idx}`}
                        label={registrant}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newRegistrants = prev.registrants.filter((_, i) => i !== idx);
                            setIsFiltered(
                              newRegistrants.length > 0 ||
                              prev.clients.length > 0 ||
                              prev.lobbyists.length > 0 ||
                              prev.filingTypes.length > 0 ||
                              prev.issueCodes.length > 0 ||
                              prev.states.length > 0
                            );
                            return {
                              ...prev,
                              registrants: newRegistrants,
                            };
                          });
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
                    {selectedFilters.clients.map((client, idx) => (
                      <Chip
                        key={`client-${idx}`}
                        label={client}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newClients = prev.clients.filter((_, i) => i !== idx);
                            setIsFiltered(
                              prev.registrants.length > 0 ||
                              newClients.length > 0 ||
                              prev.lobbyists.length > 0 ||
                              prev.filingTypes.length > 0 ||
                              prev.issueCodes.length > 0 ||
                              prev.states.length > 0
                            );
                            return {
                              ...prev,
                              clients: newClients,
                            };
                          });
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
                    {selectedFilters.lobbyists.map((lobbyist, idx) => (
                      <Chip
                        key={`lobbyist-${idx}`}
                        label={lobbyist}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newLobbyists = prev.lobbyists.filter((_, i) => i !== idx);
                            setIsFiltered(
                              prev.registrants.length > 0 ||
                              prev.clients.length > 0 ||
                              newLobbyists.length > 0 ||
                              prev.filingTypes.length > 0 ||
                              prev.issueCodes.length > 0 ||
                              prev.states.length > 0
                            );
                            return {
                              ...prev,
                              lobbyists: newLobbyists,
                            };
                          });
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
                    {selectedFilters.filingTypes.map((filingType, idx) => (
                      <Chip
                        key={`filingType-${idx}`}
                        label={filingType}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newFilingTypes = prev.filingTypes.filter((_, i) => i !== idx);
                            setIsFiltered(
                              prev.registrants.length > 0 ||
                              prev.clients.length > 0 ||
                              prev.lobbyists.length > 0 ||
                              newFilingTypes.length > 0 ||
                              prev.issueCodes.length > 0 ||
                              prev.states.length > 0
                            );
                            return {
                              ...prev,
                              filingTypes: newFilingTypes,
                            };
                          });
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
                    {selectedFilters.issueCodes.map((issueCode, idx) => (
                      <Chip
                        key={`issueCode-${idx}`}
                        label={issueCode}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newIssueCodes = prev.issueCodes.filter((_, i) => i !== idx);
                            setIsFiltered(
                              prev.registrants.length > 0 ||
                              prev.clients.length > 0 ||
                              prev.lobbyists.length > 0 ||
                              prev.filingTypes.length > 0 ||
                              newIssueCodes.length > 0 ||
                              prev.states.length > 0
                            );
                            return {
                              ...prev,
                              issueCodes: newIssueCodes,
                            };
                          });
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
                    {selectedFilters.states.map((state, idx) => (
                      <Chip
                        key={`state-${idx}`}
                        label={state}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newStates = prev.states.filter((_, i) => i !== idx);
                            setIsFiltered(
                              prev.registrants.length > 0 ||
                              prev.clients.length > 0 ||
                              prev.lobbyists.length > 0 ||
                              prev.filingTypes.length > 0 ||
                              prev.issueCodes.length > 0 ||
                              newStates.length > 0
                            );
                            return {
                              ...prev,
                              states: newStates,
                            };
                          });
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
                        registrants: [],
                        clients: [],
                        lobbyists: [],
                        filingTypes: [],
                        issueCodes: [],
                        states: [],
                      });
                      setIsFiltered(false);
                    }}
                    sx={{
                      color: '#93c5fd',
                      fontSize: '0.75rem',
                      textTransform: 'none',
                      mt: 1,
                    }}
                  >
                    Clear All Filters
                  </Button>
                </Box>
              )}

              {/* Filter sections - similar to NewsSearchPage */}
              {/* Registrants Filter */}
              {availableFilters.registrant_filters && availableFilters.registrant_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, registrants: !prev.registrants }))}
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
                      Registrants
                    </Typography>
                    {expandedFilters.registrants ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.registrants}>
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
                      {availableFilters.registrant_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.registrants.includes(filter.registrant);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.registrants.includes(filter.registrant);
                                if (exists) {
                                  return {
                                    ...prev,
                                    registrants: prev.registrants.filter(r => r !== filter.registrant),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    registrants: [...prev.registrants, filter.registrant],
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
                              {filter.registrant}
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

              {/* Clients Filter */}
              {availableFilters.client_filters && availableFilters.client_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, clients: !prev.clients }))}
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
                      Clients
                    </Typography>
                    {expandedFilters.clients ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.clients}>
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
                      {availableFilters.client_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.clients.includes(filter.client);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.clients.includes(filter.client);
                                if (exists) {
                                  return {
                                    ...prev,
                                    clients: prev.clients.filter(c => c !== filter.client),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    clients: [...prev.clients, filter.client],
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
                              {filter.client}
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

              {/* Lobbyists Filter */}
              {availableFilters.lobbyist_filters && availableFilters.lobbyist_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, lobbyists: !prev.lobbyists }))}
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
                      Lobbyists
                    </Typography>
                    {expandedFilters.lobbyists ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.lobbyists}>
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
                      {availableFilters.lobbyist_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.lobbyists.includes(filter.lobbyist);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.lobbyists.includes(filter.lobbyist);
                                if (exists) {
                                  return {
                                    ...prev,
                                    lobbyists: prev.lobbyists.filter(l => l !== filter.lobbyist),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    lobbyists: [...prev.lobbyists, filter.lobbyist],
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
                              {filter.lobbyist}
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

              {/* Filing Types Filter */}
              {availableFilters.filing_type_filters && availableFilters.filing_type_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, filingTypes: !prev.filingTypes }))}
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
                      Filing Types
                    </Typography>
                    {expandedFilters.filingTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.filingTypes}>
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
                      {availableFilters.filing_type_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.filingTypes.includes(filter.filingType);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.filingTypes.includes(filter.filingType);
                                if (exists) {
                                  return {
                                    ...prev,
                                    filingTypes: prev.filingTypes.filter(f => f !== filter.filingType),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    filingTypes: [...prev.filingTypes, filter.filingType],
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
                              {filter.filingType}
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

              {/* Issue Codes Filter */}
              {availableFilters.issue_code_filters && availableFilters.issue_code_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, issueCodes: !prev.issueCodes }))}
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
                      Issue Codes
                    </Typography>
                    {expandedFilters.issueCodes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.issueCodes}>
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
                      {availableFilters.issue_code_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.issueCodes.includes(filter.issueCode);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.issueCodes.includes(filter.issueCode);
                                if (exists) {
                                  return {
                                    ...prev,
                                    issueCodes: prev.issueCodes.filter(i => i !== filter.issueCode),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    issueCodes: [...prev.issueCodes, filter.issueCode],
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
                              {filter.issueCode}
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

              {/* States Filter */}
              {availableFilters.state_filters && availableFilters.state_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, states: !prev.states }))}
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
                      States
                    </Typography>
                    {expandedFilters.states ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.states}>
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
                      {availableFilters.state_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.states.includes(filter.state);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.states.includes(filter.state);
                                if (exists) {
                                  return {
                                    ...prev,
                                    states: prev.states.filter(s => s !== filter.state),
                                  };
                                } else {
                                  return {
                                    ...prev,
                                    states: [...prev.states, filter.state],
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
                              {filter.state}
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

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        anchorPosition={contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined}
        anchorReference={contextMenuPosition ? 'anchorPosition' : 'anchorEl'}
        open={Boolean(contextMenuAnchor || contextMenuPosition)}
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
          disabled={selectedFilings.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context {selectedFilings.size > 0 ? `(${selectedFilings.size} item${selectedFilings.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleAddToFiles}
          disabled={selectedFilings.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files {selectedFilings.size > 0 ? `(${selectedFilings.size} item${selectedFilings.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
      </Menu>
      
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />

    </Box>
  );
};

export default LDASearchPage;

