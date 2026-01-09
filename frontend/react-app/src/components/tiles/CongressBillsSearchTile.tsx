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
  Chat as SidebarChatIcon,
  AutoAwesome as AutoRefreshIcon,
  Gavel as GavelIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { useAuth } from '../../contexts/AuthContext';
import { useEasyMode } from '../../contexts/EasyModeContext';
import { filesystemAPI } from '../../services/api';
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

// US States - removed unused constant

// Parties
const PARTIES = ['R', 'D', 'I'];

// Minimum date for introduced date (January 3, 2025)
const MIN_INTRODUCED_DATE = '2025-01-03';

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
    bill_title: [] as string[],
    bill_type: [] as string[],
    politician_name: [] as string[],
    politician_role: [] as ('sponsor' | 'cosponsor')[],
    introduced_date_from: '',
    introduced_date_to: '',
    congress: [] as number[],
    policy_area: [] as string[],
    sponsor_party: [] as string[],
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
  const { user } = useAuth();
  const { isEasyMode } = useEasyMode();
  const { openItemDetails } = useDialogManagerHelpers();
  // const { activeSessionId } = useGlobalChat();
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  
  // Search state - initialize with default values if searchParams is not provided
  const [currentSearchParams, setCurrentSearchParams] = useState<CongressBillsSearchFilters>(() => {
    if (searchParams) {
      // Migrate legacy sponsor_name to politician_name for backward compatibility
      const migratedParams = { ...searchParams };
      if (migratedParams.sponsor_name && !migratedParams.politician_name) {
        migratedParams.politician_name = migratedParams.sponsor_name;
        delete migratedParams.sponsor_name;
      }
      
      return {
        ...migratedParams,
        politician_role: migratedParams.politician_role || [],
        introduced_date_from: migratedParams.introduced_date_from,
        introduced_date_to: migratedParams.introduced_date_to,
      };
    }
    return {
      bill_title: [] as string[],
      bill_type: [] as string[],
      politician_name: [] as string[],
      politician_role: [] as ('sponsor' | 'cosponsor')[],
      introduced_date_from: '',
      introduced_date_to: '',
      congress: [] as number[],
      policy_area: [] as string[],
      sponsor_party: [] as string[],
      sponsor_state: [] as string[],
      latest_action_date_from: '',
      latest_action_date_to: '',
      bipartisan: undefined,
      bill_number: undefined,
    };
  });
  
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
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
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
      
      // Clean up legacy sponsor_name field - ensure only politician_name is sent
      if (filters.sponsor_name) {
        if (!filters.politician_name) {
          filters.politician_name = filters.sponsor_name;
        }
        delete filters.sponsor_name;
      }
      
      // Handle politician_role: normalize to array format
      // - undefined or null -> [] (empty array means 'both' - lambda will handle)
      // - string 'both' -> [] (empty array means 'both')
      // - string 'sponsor' -> ['sponsor']
      // - string 'cosponsor' -> ['cosponsor']
      // - array -> keep as-is ([] = both, ['sponsor'] = sponsor only, ['cosponsor'] = cosponsor only, ['sponsor', 'cosponsor'] = both)
      if (filters.politician_role === undefined || filters.politician_role === null) {
        filters.politician_role = [];
      } else if (typeof filters.politician_role === 'string') {
        if (filters.politician_role === 'both') {
          filters.politician_role = [];
        } else if (filters.politician_role === 'sponsor' || filters.politician_role === 'cosponsor') {
          filters.politician_role = [filters.politician_role];
        } else {
          // Unknown string value, default to empty array (both)
          filters.politician_role = [];
        }
      }
      // If it's already an array, keep it as-is - lambda will handle empty array as 'both'
      
      console.log('🟢 [Tile] Final politician_role (array format):', filters.politician_role);
      
      const searchRequest = {
        filters,
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
        
        // Update parent component with pagination metadata only (avoid persisting full results)
        onUpdate(id, {
          paginationState: {
            totalResultsLoaded: response.results.length,
            lastEvaluatedKeys: response.last_evaluated_key ? [response.last_evaluated_key] : [],
            hasMore: response.has_more || false,
          },
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
      
      // Clean up legacy sponsor_name field - ensure only politician_name is sent
      if (filters.sponsor_name) {
        if (!filters.politician_name) {
          filters.politician_name = filters.sponsor_name;
        }
        delete filters.sponsor_name;
      }
      
      const searchRequest = {
        filters,
        last_evaluated_key: lastEvaluatedKey,
        limit: 100, // Explicit limit for load more requests
        is_restoration: false, // Explicitly mark as continuation, not restoration
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
          paginationState: {
            totalResultsLoaded: updatedResults.length,
            lastEvaluatedKeys: updatedKeys,
            hasMore: response.has_more || false,
          },
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
      
      // If we don't have the initial page (currentResults is empty), 
      // we need to load it first before loading continuation pages
      if (currentResults.length === 0 && currentSearchParams) {
        const filters: any = { ...currentSearchParams };
        
        Object.keys(filters).forEach((key) => {
          const value = filters[key];
          if (Array.isArray(value) && value.length === 0) {
            delete filters[key];
          }
          if (value === '' || value === null || value === undefined) {
            delete filters[key];
          }
        });
        
        // Clean up legacy sponsor_name field
        if (filters.sponsor_name) {
          if (!filters.politician_name) {
            filters.politician_name = filters.sponsor_name;
          }
          delete filters.sponsor_name;
        }
        
        // Load the initial page (no pagination key)
        const initialSearchRequest = {
          filters,
        };
        
        const initialResponse = await congressBillsSearchAPI.search(initialSearchRequest);
        
        if (initialResponse.success && initialResponse.results) {
          currentResults = [...initialResponse.results];
        }
      }

      // Load each continuation page sequentially until we reach totalResultsLoaded
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
        
        // Clean up legacy sponsor_name field - ensure only politician_name is sent
        if (filters.sponsor_name) {
          if (!filters.politician_name) {
            filters.politician_name = filters.sponsor_name;
          }
          delete filters.sponsor_name;
        }
        
        const searchRequest = {
          filters,
          last_evaluated_key: nextKey,
          is_restoration: true,  // Flag to indicate this is restoring pagination, not continuing
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
      setLastEvaluatedKey(paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] || null);
      setHasMore(paginationState.hasMore);
      setHasPerformedInitialSearch(true);
      
      // Update tile with restored pagination state only (avoid storing raw results)
      onUpdate(id, {
        paginationState: {
          totalResultsLoaded: currentResults.length,
          lastEvaluatedKeys: paginationState.lastEvaluatedKeys,
          hasMore: paginationState.hasMore,
        },
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

  // Preview mode: Run fresh query when opened in preview ONLY if no pagination state exists
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      // Skip fresh query if tile already has pagination state (preserve "load more +X" state)
      if (paginationState && paginationState.totalResultsLoaded > 0) {
        console.log('🔄 CongressBillsSearchTile: Preview mode - preserving existing pagination state (totalResultsLoaded:', paginationState.totalResultsLoaded, ')');
        return;
      }
      
      const hasSearchCriteria = 
        (currentSearchParams.bill_title && currentSearchParams.bill_title.length > 0) ||
        (currentSearchParams.bill_type && currentSearchParams.bill_type.length > 0) ||
        (currentSearchParams.sponsor_name && currentSearchParams.sponsor_name.length > 0) ||
        (currentSearchParams.policy_area && currentSearchParams.policy_area.length > 0) ||
        (currentSearchParams.sponsor_party && currentSearchParams.sponsor_party.length > 0) ||
        (currentSearchParams.congress && currentSearchParams.congress.length > 0) ||
        currentSearchParams.introduced_date_from ||
        currentSearchParams.introduced_date_to ||
        currentSearchParams.latest_action_date_from ||
        currentSearchParams.latest_action_date_to ||
        currentSearchParams.bipartisan !== undefined ||
        currentSearchParams.bill_number !== undefined;
      
      if (hasSearchCriteria) {
        console.log('🔄 CongressBillsSearchTile: Preview mode - running fresh query (no pagination state)');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && filteredResults.length === 0 && !isLoading && !isRestoringPagination) {
      const hasSearchCriteria = 
        (currentSearchParams.bill_title && currentSearchParams.bill_title.length > 0) ||
        (currentSearchParams.bill_type && currentSearchParams.bill_type.length > 0) ||
        (currentSearchParams.sponsor_name && currentSearchParams.sponsor_name.length > 0) ||
        (currentSearchParams.policy_area && currentSearchParams.policy_area.length > 0) ||
        (currentSearchParams.sponsor_party && currentSearchParams.sponsor_party.length > 0) ||
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
  
  // Legacy context menu handler (kept for backward compatibility)
  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };
  
  const handleAddToFiles = () => {
    if (selectedBills.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedBills.size === 0) return;
    
    try {
      const selectedBillObjects = filteredResults.filter(bill => 
        selectedBills.has(bill.bill_id)
      );

      // Save all bills to the filesystem with FULL data using bulk operation
      // Note: filteredResults contains the full bill objects from the search API
      // The search API already enriches bills with full data (including oversized bills from S3)
      // This ensures we save the complete bill with all fields: actions_json, cosponsors_json, amendments_json, etc.
      const items = selectedBillObjects.map(bill => {
        const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''} - ${bill.bill_title || 'Untitled Bill'}`.trim();
        return {
          context_data: bill, // Full bill object: includes actions_json, cosponsors_json, amendments_json, etc.
          title: title,
          item_type: 'congress_bill' as const,
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
        console.log(`✅ Saved ${result?.succeeded || selectedBillObjects.length} of ${selectedBillObjects.length} bill(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} bill(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save bills');
      }
      setSelectedBills(new Set());
    } catch (error) {
      console.error('Error saving bills to filesystem:', error);
    }
  };

  const handleAddToContext = (billIds?: Set<string>) => {
    const billsToAdd = billIds || selectedBills;
    const selectedBillObjects = filteredResults.filter(bill => 
      billsToAdd.has(bill.bill_id)
    );
    
    if (selectedBillObjects.length === 0) return;

    if (selectedBillObjects.length === 1) {
      addBillToContext(selectedBillObjects[0]);
    } else {
      addMultipleBillsToContext(selectedBillObjects);
    }
    
    setSelectedBills(new Set());
    handleContextMenuClose();
  };
  
  // Handle drag start
  const handleDragStart = (e: React.DragEvent, billId: string) => {
    e.stopPropagation();
    
    // Determine which bills to drag
    const billsToDrag = selectedBills.has(billId) ? selectedBills : new Set([billId]);
    
    // Set drag data
    const selectedBillObjects = filteredResults.filter(bill => 
      billsToDrag.has(bill.bill_id)
    );
    
    if (selectedBillObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'congress_bills',
        bills: selectedBillObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedBillObjects.length} bill${selectedBillObjects.length > 1 ? 's' : ''}`;
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
  
  // Drag end is handled automatically by the browser
  
  // Handle context menu for selected items
  const handleRowContextMenu = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this bill is not selected, select only it
    if (!selectedBills.has(billId)) {
      setSelectedBills(new Set([billId]));
    }
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };
  
  const handleContextMenuClose = () => {
    setContextMenuPosition(null);
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
    if (localDisplayOptions.showIntroducedDate) cols.push('introduced_date');
    if (localDisplayOptions.showLatestActionDate) cols.push('latest_action_date');
    if (localDisplayOptions.showCongress) cols.push('congress');
    if (localDisplayOptions.showBipartisan) cols.push('bipartisan');
    if (localDisplayOptions.showPolicyArea) cols.push('policy_area');
    if (cols.length > 0) {
      setVisibleColumns(cols);
    }
  }, [localDisplayOptions]);

  // Persist filterSettings when selectedFilters change
  useEffect(() => {
    const filterSettings = {
      billTypes: Array.from(selectedFilters.billTypes),
      sponsorParties: Array.from(selectedFilters.sponsorParties),
      sponsorStates: Array.from(selectedFilters.sponsorStates),
      policyAreas: Array.from(selectedFilters.policyAreas),
      congresses: Array.from(selectedFilters.congresses),
      bipartisan: Array.from(selectedFilters.bipartisan),
    };
    onSettingsChange(id, { filterSettings });
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
  
  // Handle bill selection with single click, Ctrl+click, and Shift+click
  const handleBillClick = (e: React.MouseEvent, billId: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedBills(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const billsToSelect = currentPageResults.slice(start, end + 1);
        billsToSelect.forEach(bill => newSelected.add(bill.bill_id));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(billId)) {
          newSelected.delete(billId);
        } else {
          newSelected.add(billId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(billId)) {
          newSelected.delete(billId);
        } else {
          newSelected.clear();
          newSelected.add(billId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };
  
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      // Parse date string directly to avoid timezone conversion issues
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
                  <TableCell 
                    padding="none" 
                    sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600,
                      width: '40px',
                      minWidth: '40px',
                      maxWidth: '40px',
                      padding: '8px 4px',
                    }}
                  >
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
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((bill, index) => (
                  <TableRow
                    key={bill.bill_id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, bill.bill_id)}
                    onClick={(e) => handleBillClick(e, bill.bill_id, index)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (user?.id) {
                        openItemDetails(
                          'congress_bill',
                          bill,
                          bill.bill_title,
                          { user_id: user.id }
                        );
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, bill.bill_id)}
                    sx={{
                      backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': {
                        backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
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
            {/* Politician Name - Multi-select with autocomplete */}
            <MultiSelectField<string>
              label="Politician Name"
              selectedItems={(() => {
                const names = Array.isArray(currentSearchParams?.politician_name) ? currentSearchParams.politician_name : (currentSearchParams?.politician_name ? [currentSearchParams.politician_name] : []);
                if (!isPoliticianDataLoaded) return names;
                return names.map(name => {
                  const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                  return politician ? politician.displayText : name;
                });
              })()}
              onItemsChange={(politicians) => {
                const actualNames = politicians.map(politicianDisplay => {
                  const nameMatch = politicianDisplay.match(/^([^(]+)/);
                  return nameMatch ? nameMatch[1].trim() : politicianDisplay;
                });
                setCurrentSearchParams((prev) => ({ ...prev, politician_name: actualNames }));
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

            {/* Sponsor State - Multi-select */}
            <MultiSelectField<string>
              label="Sponsor State"
              selectedItems={currentSearchParams?.sponsor_state || []}
              onItemsChange={(states) => {
                setCurrentSearchParams((prev) => ({ ...prev, sponsor_state: states }));
              }}
              suggestions={['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC']}
              renderItem={(state) => state}
              placeholder="Select states..."
            />

            {/* Bill Type - Multi-select - Hidden in easy mode */}
            {!isEasyMode && (
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
            )}

            {/* Introduced Date From */}
            <>
            <TextField
              label="Introduced Date From"
              type="date"
              value={currentSearchParams?.introduced_date_from || ''}
              onChange={(e) => {
                let dateValue = e.target.value || undefined;
                // Validate: if date is before minimum, default to minimum
                if (dateValue && dateValue < MIN_INTRODUCED_DATE) {
                  dateValue = MIN_INTRODUCED_DATE;
                }
                setCurrentSearchParams((prev) => ({
                  ...prev,
                  introduced_date_from: dateValue,
                }));
              }}
              InputLabelProps={{ shrink: true }}
              inputProps={{
                min: MIN_INTRODUCED_DATE,
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
            </>
            

            {/* Policy Area - Multi-select with autocomplete - Hidden in easy mode */}
            {!isEasyMode && (
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
            )}

            {/* Advanced Search Section - Hidden in easy mode */}
            {!isEasyMode && (
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
                <Typography variant="subtitle2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  Advanced Search
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={2}>
                  {/* Politician Role - Checkbox Multiselect */}
                  <Box>
                    <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                      Politician Role
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {['Sponsor', 'Cosponsor'].map((role) => {
                        const roleKey = role.toLowerCase() as 'sponsor' | 'cosponsor';
                        const currentRoles = Array.isArray(currentSearchParams?.politician_role) 
                          ? currentSearchParams.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
                          : [];
                        const isSelected = currentRoles.includes(roleKey);
                        return (
                          <Box
                            key={role}
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
                              console.log('🔵 [Tile] Politician Role Checkbox Clicked:', {
                                role: roleKey,
                                isSelected,
                                currentPoliticianRole: currentSearchParams?.politician_role,
                                currentPoliticianRoleType: typeof currentSearchParams?.politician_role,
                                currentPoliticianRoleIsArray: Array.isArray(currentSearchParams?.politician_role)
                              });
                              setCurrentSearchParams(prev => {
                                if (!prev) return prev;
                                const currentRoles = Array.isArray(prev.politician_role) 
                                  ? prev.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
                                  : [];
                                console.log('🔵 [Tile] Before update - currentRoles:', currentRoles);
                                if (isSelected) {
                                  const newRoles = currentRoles.filter(r => r !== roleKey);
                                  console.log('🔵 [Tile] Unselecting - newRoles:', newRoles);
                                  const result = { ...prev, politician_role: newRoles };
                                  console.log('🔵 [Tile] After unselect - result.politician_role:', result.politician_role);
                                  return result;
                                } else {
                                  const newRoles = [...currentRoles, roleKey];
                                  console.log('🔵 [Tile] Selecting - newRoles:', newRoles);
                                  const result = { ...prev, politician_role: newRoles };
                                  console.log('🔵 [Tile] After select - result.politician_role:', result.politician_role);
                                  return result;
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
                              {role}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>

                  {/* Exact Bill Title - Multi-select with autocomplete */}
                  <MultiSelectField<string>
                    label="Exact Bill Title"
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
            )}
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


      {/* Legacy Context Menu (for tile-level actions) */}
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
          onClick={() => handleAddToContext()}
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
      
      {/* Row Context Menu (right-click on bills) */}
      <Menu
        open={contextMenuPosition !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          }
        }}
      >
        <MenuItem
          onClick={() => {
            handleAddToContext();
            handleContextMenuClose();
          }}
          disabled={selectedBills.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' }, '&.Mui-disabled': { color: '#6b7280' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add {selectedBills.size > 1 ? `${selectedBills.size} bills` : 'bill'} to Context
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleAddToFiles();
            handleContextMenuClose();
          }}
          disabled={selectedBills.size === 0 || !user}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' }, '&.Mui-disabled': { color: '#6b7280' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add {selectedBills.size > 1 ? `${selectedBills.size} bills` : 'bill'} to Files
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

