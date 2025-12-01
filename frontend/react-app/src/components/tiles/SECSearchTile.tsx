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
  Select,
  InputLabel,
  FormControlLabel,
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
  ListItemIcon,
  ListItemText,
  Pagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  Link,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Close as CloseIcon,
  Search as SearchIcon,
  Description as DocumentIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
  Dashboard as AddToContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { secSearchAPI, SECSearchParams, SECSearchResult, SECAutocompleteSuggestion } from '../../services/api';
import { useTilePinning, PinButton, confirmDialog, addFilingToContext, addMultipleFilingsToContext } from './common';
import MultiSelectField from '../MultiSelectField';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';

// SEC Form Categories (from SEC website) - simplified for tile
interface FormCategory {
  id: string;
  label: string;
  formTypes: string[];
}

const SEC_FORM_CATEGORIES: FormCategory[] = [
  {
    id: 'all',
    label: 'View all',
    formTypes: [], // Empty means all forms
  },
  {
    id: 'form-cat1',
    label: 'All annual, quarterly, and current reports',
    formTypes: ['1-K', '10-K', '10-Q', '8-K', '20-F', '6-K', '11-K', 'N-CSR', 'N-Q'],
  },
  {
    id: 'form-cat2',
    label: 'Insider transactions (Section 16)',
    formTypes: ['3', '4', '5'],
  },
  {
    id: 'form-cat3',
    label: 'Beneficial ownership reports',
    formTypes: ['SC 13D', 'SC 13G'],
  },
  {
    id: 'form-cat4',
    label: 'Registration statements',
    formTypes: ['S-1', 'S-3', 'S-4', 'F-1', 'F-3', '424B2', '424B3'],
  },
  {
    id: 'form-cat5',
    label: 'Proxy materials',
    formTypes: ['DEF 14A', 'DEFA14A', 'PRE 14A'],
  },
];

// Build form types list
interface FormType {
  id: string;
  label: string;
}

const buildFormTypes = (): FormType[] => {
  const formTypeMap = new Map<string, FormType>();
  
  SEC_FORM_CATEGORIES.forEach(category => {
    if (category.id !== 'all') {
      category.formTypes.forEach(formId => {
        if (!formTypeMap.has(formId)) {
          formTypeMap.set(formId, {
            id: formId,
            label: formId,
          });
        }
      });
    }
  });
  
  return Array.from(formTypeMap.values()).sort((a, b) => a.id.localeCompare(b.id));
};

const ALL_FORM_TYPES = buildFormTypes();

interface SECSearchTileProps {
  id: string;
  size?: { width: number; height: number };
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  onSelectionChange?: (isSelected: boolean) => void;
  isSelected?: boolean;
  searchParams?: Partial<SECSearchParams>;
  filterSettings?: {
    entities?: Array<{ entity: string; cik?: string }>;
    forms?: string[];
    locations?: string[];
    incorporationStates?: string[];
  };
  filers?: SECAutocompleteSuggestion[]; // Store full filer information for persistence
  displayOptions?: {
    showEntity?: boolean;
    showForm?: boolean;
    showFilingDate?: boolean;
    showLocation?: boolean;
    showIncorporation?: boolean;
    showCIK?: boolean;
    showResultsTable?: boolean;
    maxResults?: number;
    compactView?: boolean;
    results?: SECSearchResult[];
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
}

/**
 * SECSearchTile - Search and display SEC filings with session-based persistence
 * 
 * Persistence Strategy:
 * - Search parameters (query setup): Persisted to backend database across sessions
 * - Search results (data): Persisted in session memory during user login only
 * - Users can manually refresh for fresh data when needed
 */
const SECSearchTile: React.FC<SECSearchTileProps> = memo(({
  id,
  size,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isResizing = false,
  onSelectionChange,
  isSelected = false,
  searchParams: initialSearchParams = {},
  filterSettings: initialFilterSettings,
  filers: initialFilers = [],
  displayOptions: initialDisplayOptions = {
    showEntity: true,
    showForm: true,
    showFilingDate: true,
    showLocation: true,
    showIncorporation: true,
    showCIK: true,
    showResultsTable: true,
    maxResults: 50,
    compactView: false,
  },
  autoRefresh = false,
  isPinned = false,
}) => {
  const { user } = useAuth();
  const { activeSessionId } = useGlobalChat();
  
  // Debug authentication state
  useEffect(() => {
    console.log('🔐 SECSearchTile Auth State:', { 
      userId: user?.id, 
      activeSessionId,
      userExists: !!user 
    });
  }, [user?.id, activeSessionId]);
  
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [formTypesModalOpen, setFormTypesModalOpen] = useState(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Search state - matching SEC search page structure
  // Convert initialSearchParams to use arrays for entityName and keywords (like PoliticianTradesSearchTile)
  const normalizeEntityName = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // If it's a comma-separated string, split it
    return value.split(',').map(name => name.trim()).filter(Boolean);
  };
  
  const normalizeKeywords = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // If it's a space-separated string, split it
    return value.split(' ').map(k => k.trim()).filter(Boolean);
  };
  
  const [currentSearchParams, setCurrentSearchParams] = useState<SECSearchParams>({
    dateFrom: initialSearchParams.dateFrom || '2001-01-01',
    dateTo: initialSearchParams.dateTo || new Date().toISOString().split('T')[0],
    cik: initialSearchParams.cik,
    entityName: normalizeEntityName(initialSearchParams.entityName),
    keywords: normalizeKeywords(initialSearchParams.keywords),
    formTypes: initialSearchParams.formTypes,
    located: initialSearchParams.located,
  });
  // Store all results for client-side filtering
  const [allResults, setAllResults] = useState<SECSearchResult[]>([]);

  // Track if initial search has been performed
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<{ currentPage: number; totalPages: number | null } | null>(null);
  
  // Multi-select state - we'll read/write directly from currentSearchParams like PoliticianTradesSearchTile
  // Store full filer information for persistence (name, CIK, ticker)
  const [persistedFilers, setPersistedFilers] = useState<SECAutocompleteSuggestion[]>(initialFilers);
  const [companySuggestions, setCompanySuggestions] = useState<SECAutocompleteSuggestion[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  
  // Filter state matching SEC search page - restore from props if available
  // Must be declared before useEffect that uses it
  // Match the structure from SECSearchPage.tsx
  const [selectedFilters, setSelectedFilters] = useState<{
    entities: Array<{ entity: string; cik?: string }>;
    forms: string[];
    locations: string[];
    incorporationStates: string[];
  }>({
    entities: initialFilterSettings?.entities?.map(e => 
      typeof e === 'string' 
        ? { entity: e } // Convert string to object if needed
        : { entity: e.entity, cik: e.cik }
    ) || [],
    forms: initialFilterSettings?.forms || [],
    locations: initialFilterSettings?.locations || [],
    incorporationStates: initialFilterSettings?.incorporationStates || []
  });

  // Session-based persistence: Restore results from session data on mount
  // Results persist for the duration of user login, searchParams persist to backend
  useEffect(() => {
    if (initialDisplayOptions.results && initialDisplayOptions.results.length > 0 && allResults.length === 0) {
      console.log('🔄 SECSearchTile: Restoring session results from tile data:', initialDisplayOptions.results.length, 'results');
      setAllResults(initialDisplayOptions.results);
    }
  }, [initialDisplayOptions.results, allResults.length]);

  // Persist filter settings to backend when they change
  // Use a ref to track previous filters to avoid unnecessary updates
  const prevFiltersRef = useRef(selectedFilters);
  useEffect(() => {
    if (hasPerformedInitialSearch) {
      // Only persist if filters actually changed
      const filtersChanged = 
        JSON.stringify(prevFiltersRef.current) !== JSON.stringify(selectedFilters);
      
      if (filtersChanged) {
        prevFiltersRef.current = selectedFilters;
        onSettingsChange(id, { filterSettings: selectedFilters });
      }
    }
  }, [selectedFilters, id, onSettingsChange, hasPerformedInitialSearch]);
  
  // Compute available filters from all results
  const availableFilters = useMemo(() => {
    const formCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();
    const locationCounts = new Map<string, number>();
    const incorporationCounts = new Map<string, number>();
    
    allResults.forEach(result => {
      // Count forms
      if (result.form) {
        formCounts.set(result.form, (formCounts.get(result.form) || 0) + 1);
      }
      
      // Count entities (from filingEntity)
      if (result.filingEntity) {
        const entityKey = result.cik 
          ? `${result.filingEntity} (CIK ${result.cik.padStart(10, '0')})` 
          : result.filingEntity;
        entityCounts.set(entityKey, (entityCounts.get(entityKey) || 0) + 1);
      }
      
      // Count locations
      if (result.located) {
        locationCounts.set(result.located, (locationCounts.get(result.located) || 0) + 1);
      }
      
      // Count incorporation states
      if (result.incorporated) {
        incorporationCounts.set(result.incorporated, (incorporationCounts.get(result.incorporated) || 0) + 1);
      }
    });
    
    return {
      form_filters: Array.from(formCounts.entries())
        .map(([form, count]) => ({ form, count }))
        .sort((a, b) => b.count - a.count),
      entity_filters: Array.from(entityCounts.entries())
        .map(([entity, count]) => ({ entity, count }))
        .sort((a, b) => b.count - a.count),
      location_filters: Array.from(locationCounts.entries())
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count),
      incorporation_filters: Array.from(incorporationCounts.entries())
        .map(([incorporation, count]) => ({ incorporation, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);
  
  // Selection state
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [selectedFiling, setSelectedFiling] = useState<SECSearchResult | null>(null);
  
  // Display options state - memoize to prevent infinite re-renders
  const localDisplayOptions = useMemo(() => ({
    ...{
      showEntity: true,
      showForm: true,
      showFilingDate: true,
      showLocation: true,
      showIncorporation: true,
      showCIK: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    ...initialDisplayOptions
  }), [initialDisplayOptions]);

  // Column visibility state - separate state that can be toggled in filter dialog
  const [visibleColumns, setVisibleColumns] = useState({
    entity: localDisplayOptions.showEntity,
    form: localDisplayOptions.showForm,
    filingDate: localDisplayOptions.showFilingDate,
    location: localDisplayOptions.showLocation,
    incorporation: localDisplayOptions.showIncorporation,
    cik: localDisplayOptions.showCIK,
  });

  // Column width state for dynamic sizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`secSearch_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const isPageSizeManuallySet = localStorage.getItem(`secSearch_pageSize_${id}`) !== null;
  const tileRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number>(0);



  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Auto refresh functionality
  const autoRefreshRef = useRef<NodeJS.Timeout>();

      

  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('🏛️ SECSearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setFetchProgress({ currentPage: 0, totalPages: null }); // Initialize progress
    
    try {
      // Build search request - entityName and keywords are already arrays in currentSearchParams
      // Convert arrays to the format the API expects (strings for backward compatibility)
      const entityNameArray = Array.isArray(currentSearchParams.entityName) 
        ? currentSearchParams.entityName 
        : (currentSearchParams.entityName ? [currentSearchParams.entityName] : []);
      const keywordsArray = Array.isArray(currentSearchParams.keywords)
        ? currentSearchParams.keywords
        : (currentSearchParams.keywords ? [currentSearchParams.keywords] : []);
      
      const searchRequest = {
        ...currentSearchParams,
        // Convert arrays to comma/space-separated strings for API (maintains backward compatibility)
        entityName: entityNameArray.length > 0 ? entityNameArray.join(',') : undefined,
        keywords: keywordsArray.length > 0 ? keywordsArray.join(' ') : undefined,
        // Extract CIK if we have entity names (for single entity searches)
        cik: entityNameArray.length === 1 && currentSearchParams.cik 
          ? currentSearchParams.cik 
          : (Array.isArray(currentSearchParams.cik) && currentSearchParams.cik.length === 1
            ? currentSearchParams.cik[0]
            : currentSearchParams.cik),
        page: 1,
      };
      
      console.log('📤 SECSearchTile: Sending async search request:', searchRequest);
      
      // Start async search - returns job_id immediately
      const startResponse = await secSearchAPI.searchAsync(searchRequest);
      
      if (!startResponse.job_id) {
        throw new Error('No job_id returned from async search');
      }
      
      const jobId = startResponse.job_id;
      console.log(`✅ SECSearchTile: Async search started with job_id: ${jobId}`);
      
      // Check if this is a cached response with results
      // Handle cached results - check both direct results and S3
      if (startResponse.cached && startResponse.status === 'COMPLETED') {
        console.log(`✅ SECSearchTile: Cached search found`, startResponse);
        
        let results: any[] = [];
        
        // First check if results are directly in the response
        if (startResponse.results && startResponse.results.length > 0) {
          results = startResponse.results;
          console.log(`✅ SECSearchTile: Found ${results.length} cached results in startResponse.results`);
        } else if (startResponse.results_s3_key) {
          // Fetch from S3 as fallback
          try {
            console.log(`SECSearchTile: Fetching cached results from S3: ${startResponse.results_s3_key}`);
            const s3Results = await secSearchAPI.fetchResultsFromS3(jobId, startResponse.results_s3_key);
            if (s3Results.results) {
              results = s3Results.results;
              console.log(`✅ SECSearchTile: Found ${results.length} cached results from S3`);
            }
          } catch (error) {
            console.error(`❌ SECSearchTile: Error fetching cached results from S3:`, error);
            // Fall through to polling as backup
          }
        }
        
        if (results.length > 0) {
          // Store all results for filtering (don't limit here - filtering will handle display limits)
          const allResultsData = results;
          console.log('📊 SECSearchTile: Setting cached allResults:', allResultsData.length);
          setAllResults(allResultsData);
          // currentResults will be set by filter useEffect
          
            // Update tile data - persist results in session only (not database)
            onUpdate(id, {
              results: allResultsData, // Session persistence - full results for duration of login only
              lastUpdated: new Date().toISOString(),
            });
            
            // Persist search params to backend (database) - NOT results
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
            
            // Mark initial search as performed
            setHasPerformedInitialSearch(true);
            
            console.log(`✅ SECSearchTile: Displaying ${allResultsData.length} cached results - State updated`);
            setIsLoading(false);
            return; // Done - no need to poll
        }
      }
      
      // Poll for job completion
      const pollForResults = async () => {
        try {
          const jobStatus = await secSearchAPI.getJobStatus(jobId);
          
          if (!jobStatus) {
            console.warn(`⚠️ SECSearchTile: No status found for job ${jobId}`);
            return;
          }
          
          // Update progress from backend
          if (jobStatus.progress) {
            setFetchProgress({
              currentPage: jobStatus.progress.current_page || 0,
              totalPages: jobStatus.progress.total_pages || null,
            });
          }
          
          // Check if job is complete
          if (jobStatus.status === 'COMPLETED') {
            console.log('SECSearchTile: Job completed, jobStatus:', jobStatus);
            
            // Get results from job_status
            let results: any[] = [];
            if (jobStatus.results?.results) {
              results = jobStatus.results.results;
              console.log(`✅ SECSearchTile: Found ${results.length} results in jobStatus.results.results`);
            } else if (jobStatus.results_s3_key) {
              // Fetch from S3
              console.log(`SECSearchTile: Results stored in S3: ${jobStatus.results_s3_key} - fetching...`);
              try {
                const s3Results = await secSearchAPI.fetchResultsFromS3(jobId, jobStatus.results_s3_key);
                if (s3Results.results) {
                  results = s3Results.results;
                  console.log(`✅ SECSearchTile: Fetched ${results.length} results from S3`);
                } else {
                  console.warn(`⚠️ SECSearchTile: No results in S3 response`);
                }
              } catch (error) {
                console.error(`❌ SECSearchTile: Error fetching results from S3:`, error);
                // Continue with empty results - user can retry
              }
            } else {
              console.warn('⚠️ SECSearchTile: No results found in response structure');
              console.log('Full jobStatus structure:', JSON.stringify(jobStatus, null, 2));
            }
            
            // Store all results for filtering (don't limit here - filtering will handle display limits)
            console.log('📊 SECSearchTile: Setting allResults:', results.length);
            setAllResults(results);
            // currentResults will be set by filter useEffect
            
            // Update tile data - persist results in session only (not database)
            onUpdate(id, {
              results: results, // Session persistence - full results for duration of login only
              lastUpdated: new Date().toISOString(),
            });
            
            // Persist search params to backend (database) - NOT results
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
            
            // Mark initial search as performed
            setHasPerformedInitialSearch(true);
            
            console.log(`✅ SECSearchTile: Found ${results.length} results - State updated`);
            setIsLoading(false);
            setFetchProgress(null); // Clear progress when complete
          } else if (jobStatus.status === 'FAILED') {
            console.error('❌ SECSearchTile: Search job failed:', jobStatus.error);
            setError(jobStatus.error || 'Search failed');
            setAllResults([]);
            setHasPerformedInitialSearch(true);
            setIsLoading(false);
            setFetchProgress(null); // Clear progress on failure
          } else {
            // Still in progress, poll again
            setTimeout(pollForResults, 2000); // Poll every 2 seconds
          }
        } catch (err) {
          console.error('❌ SECSearchTile: Error polling job status:', err);
          setError('Search failed: ' + (err as Error).message);
          setAllResults([]);
          setHasPerformedInitialSearch(true);
          setIsLoading(false);
          setFetchProgress(null); // Clear progress on error
        }
      };
      
      // Start polling after a short delay
      setTimeout(pollForResults, 1000);
      
    } catch (err) {
      console.error('❌ SECSearchTile: Search error:', err);
      setError('Search failed: ' + (err as Error).message);
      setAllResults([]);
      setHasPerformedInitialSearch(true);
      setIsLoading(false);
      setFetchProgress(null); // Clear progress on error
    }
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate]);

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
      autoRefreshRef.current = setInterval(performSearch, 600000); // 10 minutes
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
        }
      };
    }
  }, [autoRefresh, performSearch, isDragging, isResizing]);

  // Client-side filtering function - operates on allResults, never triggers API calls
  // Logic: OR within each filter type, AND between filter types
  const filterResults = useCallback((results: SECSearchResult[]): SECSearchResult[] => {
    let filtered = [...results];
    
    // Filter by entities (OR logic - any selected entity matches)
    // A result matches if it matches ANY of the selected entities
    if (selectedFilters.entities.length > 0) {
      filtered = filtered.filter(result => {
        const reportingFor = (result.reportingFor || '').toLowerCase().trim();
        const filingEntity = (result.filingEntity || '').toLowerCase().trim();
        const resultCik = (result.cik || '').trim();
        
        return selectedFilters.entities.some(entity => {
          // Extract entity name from filter (might be "Name (CIK 0000000000)" or just "Name")
          const entityFilterName = entity.entity.toLowerCase().trim();
          const entityCik = (entity.cik || '').trim();
          
          // Extract just the name part if it's in "Name (CIK 0000000000)" format
          const nameMatch = entityFilterName.match(/^(.+?)\s*\(CIK\s+\d+\)$/);
          const entityNameOnly = nameMatch ? nameMatch[1].trim() : entityFilterName;
          
          // Match by CIK if available (most accurate)
          if (entityCik && resultCik) {
            // Normalize CIKs (remove leading zeros for comparison, or pad to 10 digits)
            const normalizedEntityCik = entityCik.padStart(10, '0');
            const normalizedResultCik = resultCik.padStart(10, '0');
            if (normalizedEntityCik === normalizedResultCik) {
              return true;
            }
          }
          
          // Match by entity name (exact match first, then contains)
          // Check if reportingFor or filingEntity exactly matches the entity name
          if (reportingFor === entityNameOnly || filingEntity === entityNameOnly) {
            return true;
          }
          
          // Also check if the entity name is contained in reportingFor or filingEntity
          // (for cases where entity name might be part of a longer string)
          if (reportingFor.includes(entityNameOnly) || filingEntity.includes(entityNameOnly)) {
            return true;
          }
          
          // Also check if the full filter string (with CIK) matches
          if (reportingFor.includes(entityFilterName) || filingEntity.includes(entityFilterName)) {
            return true;
          }
          
          return false;
        });
      });
    }
    
    // Filter by forms (OR logic - any selected form matches)
    if (selectedFilters.forms.length > 0) {
      filtered = filtered.filter(result => {
        const resultForm = result.form || '';
        return selectedFilters.forms.some(form => form === resultForm);
      });
    }
    
    // Filter by locations (OR logic - any selected location matches)
    if (selectedFilters.locations.length > 0) {
      filtered = filtered.filter(result => {
        const located = (result.located || '').toLowerCase();
        return selectedFilters.locations.some(loc => {
          const locLower = loc.toLowerCase();
          return located === locLower || located.includes(locLower);
        });
      });
    }
    
    // Filter by incorporation states (OR logic - any selected state matches)
    if (selectedFilters.incorporationStates.length > 0) {
      filtered = filtered.filter(result => {
        const incorporated = (result.incorporated || '').toLowerCase();
        return selectedFilters.incorporationStates.some(state => {
          const stateLower = state.toLowerCase();
          return incorporated === stateLower || incorporated.includes(stateLower);
        });
      });
    }
    
    return filtered;
  }, [selectedFilters]);

  // Apply filters to allResults - use useMemo instead of useEffect to avoid infinite loops
  const currentResults = useMemo(() => {
    if (allResults.length === 0) {
      return [];
    }
    
    const hasFilters = selectedFilters.entities.length > 0 ||
                       selectedFilters.forms.length > 0 ||
                       selectedFilters.locations.length > 0 ||
                       selectedFilters.incorporationStates.length > 0;
    
    if (hasFilters) {
      return filterResults(allResults);
    } else {
      // No filters - show all results
      return allResults;
    }
  }, [allResults, selectedFilters, filterResults]);

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading) {
      // Only auto-search if we have meaningful search params (not just defaults)
      const hasSearchCriteria = 
        currentSearchParams.cik ||
        currentSearchParams.entityName ||
        currentSearchParams.keywords ||
        (currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0) ||
        currentSearchParams.located;
      
      if (hasSearchCriteria) {
        console.log('🔄 SECSearchTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch]);

  // Format date helper
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

  // Calculate optimal column widths based on content
  const calculateColumnWidths = useCallback((results: SECSearchResult[]) => {
    const widths: Record<string, number> = {};
    
    // Sample of results to measure (use first 50 for performance)
    const sampleResults = results.slice(0, 50);
    
    if (sampleResults.length === 0) return widths;
    
    // Base minimum widths (in pixels)
    const minWidths = {
      checkbox: 50,
      entity: 150,
      form: 80,
      filingDate: 100,
      location: 120,
      incorporation: 100,
      cik: 100,
    };
    
    // Calculate content-based widths
    widths.checkbox = minWidths.checkbox;
    
    if (visibleColumns.entity) {
      const maxLength = Math.max(...sampleResults.map(r => (r.filingEntity || '').length));
      widths.entity = Math.max(minWidths.entity, Math.min(maxLength * 8 + 32, 250));
    }
    
    if (visibleColumns.form) {
      widths.form = minWidths.form; // Fixed size for form types
    }
    
    if (visibleColumns.filingDate) {
      widths.filingDate = minWidths.filingDate; // Fixed for date format
    }
    
    if (visibleColumns.location) {
      const maxLength = Math.max(...sampleResults.map(r => (r.located || '').length));
      widths.location = Math.max(minWidths.location, Math.min(maxLength * 8 + 32, 200));
    }
    
    if (visibleColumns.incorporation) {
      const maxLength = Math.max(...sampleResults.map(r => (r.incorporated || '').length));
      widths.incorporation = Math.max(minWidths.incorporation, Math.min(maxLength * 8 + 32, 150));
    }
    
    if (visibleColumns.cik) {
      widths.cik = minWidths.cik; // Fixed for CIK numbers
    }
    
    return widths;
  }, [visibleColumns]);

  // Calculate pagination values - limit to maxResults for display
  const displayResults = currentResults.slice(0, localDisplayOptions.maxResults || 50);
  const totalPages = Math.ceil(displayResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = displayResults.slice(startIndex, endIndex);

  // Update column widths when results or visible columns change
  useEffect(() => {
    if (currentResults.length > 0) {
      const newWidths = calculateColumnWidths(currentResults);
      setColumnWidths(newWidths);
    }
  }, [currentResults, calculateColumnWidths]);

  const toggleResultSelection = (accession: string) => {
    setSelectedResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(accession)) {
        newSet.delete(accession);
      } else {
        newSet.add(accession);
      }
      return newSet;
    });
  };

  const handleSettingsClick = (event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  };

  const handleSettingsClose = () => {
    setSettingsAnchor(null);
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove SEC Search Tile from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });

    if (confirmed) {
      onRemove(id);
    }
  };

  // Context menu handlers
  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    const selectedResultObjects = currentResults.filter(result => 
      selectedResults.has(result.accession)
    );

    if (selectedResultObjects.length === 0) return;

    // Use the same context manager functions as the parent page
    // For single filing, use the same format as parent page: "Form - Entity"
    // For multiple filings, each gets its own context item with proper formatting
    if (selectedResultObjects.length === 1) {
      addFilingToContext(selectedResultObjects[0], target);
    } else {
      addMultipleFilingsToContext(selectedResultObjects, target);
    }

    setSelectedResults(new Set());
    handleContextMenuClose();
  };

  // Filer search handler
  const handleFilerSearch = (query: string): string[] => {
    if (query.length < 2) return companySuggestions.map(s => s.name);
    
    // Trigger async autocomplete search
    const searchAsync = async () => {
      setAutocompleteLoading(true);
      try {
        const response = await secSearchAPI.getAutocomplete(query);
        if (response.suggestions) {
          setCompanySuggestions(response.suggestions.slice(0, 20));
        }
      } catch (error) {
        console.error('Failed to load company suggestions:', error);
      } finally {
        setAutocompleteLoading(false);
      }
    };
    
    searchAsync();
    return companySuggestions.map(s => s.name);
  };

  const renderSearchDialog = () => (
    <Dialog
      open={searchDialogOpen}
      onClose={() => setSearchDialogOpen(false)}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          border: '1px solid #374151',
        }
      }}
    >
      <DialogTitle sx={{ 
        color: '#ffffff', 
        borderBottom: '1px solid #374151',
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
        <DocumentIcon sx={{ color: '#3b82f6' }} />
        SEC Search Parameters
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
          Configure your SEC filing search parameters. These will be applied when you click Search.
        </Typography>
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* Row 1: Filers and Keywords */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <MultiSelectField<string>
              label="Filers (Companies/Individuals)"
              selectedItems={(() => {
                // Use persisted filers if available, otherwise fall back to entityName from searchParams
                if (persistedFilers.length > 0) {
                  return persistedFilers.map(f => f.name);
                }
                const entityNames = Array.isArray(currentSearchParams.entityName) 
                  ? currentSearchParams.entityName 
                  : (currentSearchParams.entityName ? [currentSearchParams.entityName] : []);
                return entityNames;
              })()}
              onItemsChange={(entityNames) => {
                // Find full filer information from suggestions or persisted filers
                const filers: SECAutocompleteSuggestion[] = [];
                const ciks: string[] = [];
                
                entityNames.forEach(name => {
                  // First try to find in current suggestions
                  let suggestion = companySuggestions.find(s => s.name === name);
                  // If not found, try persisted filers
                  if (!suggestion) {
                    suggestion = persistedFilers.find(f => f.name === name);
                  }
                  
                  if (suggestion) {
                    filers.push(suggestion);
                    if (suggestion.cik) {
                      ciks.push(suggestion.cik);
                    }
                  } else {
                    // Fallback: create a basic suggestion with just the name
                    filers.push({ name, cik: '', ticker: '' });
                  }
                });
                
                // Update persisted filers
                setPersistedFilers(filers);
                
                // Update search params
                setCurrentSearchParams(prev => ({ 
                  ...prev, 
                  entityName: entityNames.length > 0 ? entityNames : undefined,
                  cik: ciks.length === 1 ? ciks[0] : (ciks.length > 1 ? ciks : prev.cik),
                }));
                
                // Persist filers to backend
                onSettingsChange(id, { filers });
              }}
              suggestions={companySuggestions.map(s => s.name)}
              renderItem={(name) => {
                // Try to find in persisted filers first, then suggestions
                let suggestion = persistedFilers.find(f => f.name === name);
                if (!suggestion) {
                  suggestion = companySuggestions.find(s => s.name === name);
                }
                if (suggestion && suggestion.cik) {
                  return `${suggestion.name} (${suggestion.ticker || 'N/A'}) - CIK: ${suggestion.cik}`;
                }
                return name;
              }}
              getItemKey={(name) => name}
              placeholder="Add company, CIK, or individual name..."
              helperText="Select filers to search for"
              allowCustomInput={false}
              isLoading={autocompleteLoading}
              onSearch={handleFilerSearch}
            />

            <MultiSelectField<string>
              label="Keywords"
              selectedItems={(() => {
                const keywords = Array.isArray(currentSearchParams.keywords)
                  ? currentSearchParams.keywords
                  : (currentSearchParams.keywords ? [currentSearchParams.keywords] : []);
                return keywords;
              })()}
              onItemsChange={(keywords) => {
                setCurrentSearchParams(prev => ({ 
                  ...prev, 
                  keywords: keywords.length > 0 ? keywords : undefined,
                }));
              }}
              suggestions={[]}
              renderItem={(keyword) => keyword}
              getItemKey={(keyword) => keyword}
              placeholder="Type keyword and press Enter to add..."
              helperText="Add keywords for search"
              allowCustomInput={true}
              isLoading={false}
            />
          </Box>

          {/* Row 2: Date Range - Filed from and Filed to */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              label="Filed from"
              type="date"
              value={currentSearchParams.dateFrom || ''}
              onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />

            <TextField
              label="Filed to"
              type="date"
              value={currentSearchParams.dateTo || ''}
              onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />
          </Box>

          {/* Row 3: Form Types and Location */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            {/* Form Types - Button to open modal (like SEC page) */}
            <Box>
              <TextField
                label="Filing category"
                value={
                  currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0
                    ? `${currentSearchParams.formTypes.length} form${currentSearchParams.formTypes.length > 1 ? 's' : ''} selected`
                    : 'View all'
                }
                onClick={() => setFormTypesModalOpen(true)}
                InputProps={{
                  readOnly: true,
                  endAdornment: <ExpandMoreIcon sx={{ color: '#9ca3af' }} />,
                }}
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                }}
              />
              {currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {currentSearchParams.formTypes.slice(0, 3).map((formType) => (
                    <Chip
                      key={formType}
                      label={formType}
                      size="small"
                      onDelete={() => {
                        setCurrentSearchParams(prev => ({
                          ...prev,
                          formTypes: prev.formTypes?.filter(ft => ft !== formType)
                        }));
                      }}
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                        '& .MuiChip-deleteIcon': { color: '#93c5fd' },
                      }}
                    />
                  ))}
                  {currentSearchParams.formTypes.length > 3 && (
                    <Chip
                      label={`+${currentSearchParams.formTypes.length - 3} more`}
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                      }}
                    />
                  )}
                </Box>
              )}
            </Box>

            {/* Location */}
            <FormControl variant="outlined">
              <InputLabel sx={{ color: '#94a3b8' }}>Located</InputLabel>
              <Select
                value={currentSearchParams.located || 'all'}
                onChange={(e) => {
                  const value = e.target.value;
                  setCurrentSearchParams(prev => ({ 
                    ...prev, 
                    located: value === 'all' ? undefined : value 
                  }));
                }}
                label="Located"
                sx={{
                  backgroundColor: '#334155', 
                  color: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                }}
              >
                <MenuItem value="all">All locations</MenuItem>
                <MenuItem value="AL">Alabama</MenuItem>
                <MenuItem value="AK">Alaska</MenuItem>
                <MenuItem value="AZ">Arizona</MenuItem>
                <MenuItem value="AR">Arkansas</MenuItem>
                <MenuItem value="CA">California</MenuItem>
                <MenuItem value="CO">Colorado</MenuItem>
                <MenuItem value="CT">Connecticut</MenuItem>
                <MenuItem value="DE">Delaware</MenuItem>
                <MenuItem value="FL">Florida</MenuItem>
                <MenuItem value="GA">Georgia</MenuItem>
              </Select>
            </FormControl>
          </Box>
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
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
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

  const renderFilterDialog = () => (
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
            label={`${currentResults.length} of ${allResults.length} results`}
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

        {/* Column Visibility Filter */}
        <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
          <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
            Visible Columns:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {[
              { key: 'entity', label: 'Entity', value: visibleColumns.entity },
              { key: 'form', label: 'Form', value: visibleColumns.form },
              { key: 'filingDate', label: 'Filing Date', value: visibleColumns.filingDate },
              { key: 'location', label: 'Location', value: visibleColumns.location },
              { key: 'incorporation', label: 'Incorporation', value: visibleColumns.incorporation },
              { key: 'cik', label: 'CIK', value: visibleColumns.cik },
            ].map((column) => (
              <FormControlLabel
                key={column.key}
                control={
                  <Checkbox
                    checked={column.value}
                    onChange={(e) => {
                      setVisibleColumns((prev: typeof visibleColumns) => ({
                        ...prev,
                        [column.key]: e.target.checked
                      }));
                      // Update display options via onSettingsChange to persist
                      const displayOptionKey = `show${column.key.charAt(0).toUpperCase() + column.key.slice(1)}` as keyof typeof localDisplayOptions;
                      onSettingsChange(id, {
                        displayOptions: {
                          ...localDisplayOptions,
                          [displayOptionKey]: e.target.checked
                        }
                      });
                    }}
                    sx={{ 
                      color: '#64748b', 
                      '&.Mui-checked': { color: '#3b82f6' },
                      '& .MuiSvgIcon-root': { fontSize: 20 },
                    }}
                  />
                }
                label={
                  <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                    {column.label}
                  </Typography>
                }
                sx={{ 
                  margin: 0,
                  '& .MuiFormControlLabel-label': {
                    ml: 0.5,
                  },
                }}
              />
            ))}
          </Box>
        </Box>

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
                  localStorage.setItem(`secSearch_pageSize_${id}`, newSize.toString());
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
                {[5, 10, 25, 50, 100].map((size) => (
                  <MenuItem key={size} value={size}>
                    {size} results
                  </MenuItem>
                ))}
              </TextField>
            </FormControl>
          </Box>
        </Box>

        {/* Applied Filters Section */}
        {(selectedFilters.entities.length > 0 || 
          selectedFilters.forms.length > 0 || 
          selectedFilters.locations.length > 0 || 
          selectedFilters.incorporationStates.length > 0) && (
          <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
            <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
              Applied Filters:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {selectedFilters.entities.map((entity, idx) => {
                const entityLabel = entity.cik 
                  ? `${entity.entity} (CIK ${entity.cik.padStart(10, '0')})`
                  : entity.entity;
                return (
                  <Chip
                    key={`entity-${idx}`}
                    label={`Entity: ${entityLabel}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        entities: prev.entities.filter((_, i) => i !== idx)
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
                );
              })}
              {selectedFilters.forms.map(form => (
                <Chip
                  key={`form-${form}`}
                  label={`Form: ${form}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      forms: prev.forms.filter(f => f !== form)
                    }));
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
              {selectedFilters.locations.map(location => (
                <Chip
                  key={`location-${location}`}
                  label={`Location: ${location}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      locations: prev.locations.filter(l => l !== location)
                    }));
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
              {selectedFilters.incorporationStates.map(state => (
                <Chip
                  key={`state-${state}`}
                  label={`State: ${state}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      incorporationStates: prev.incorporationStates.filter(s => s !== state)
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
            </Box>
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setSelectedFilters({
                    entities: [],
                    forms: [],
                    locations: [],
                    incorporationStates: []
                  });
                }}
                sx={{
                  color: '#94a3b8',
                  borderColor: '#475569',
                  '&:hover': {
                    borderColor: '#64748b',
                    backgroundColor: 'rgba(71, 85, 105, 0.1)'
                  }
                }}
              >
                Clear All Filters
              </Button>
            </Box>
          </Box>
        )}

        {/* Filter Sections */}
        {availableFilters.entity_filters?.length === 0 && 
         availableFilters.form_filters?.length === 0 && 
         availableFilters.location_filters?.length === 0 && 
         availableFilters.incorporation_filters?.length === 0 ? (
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
            {/* Entities Filter */}
            {availableFilters.entity_filters && availableFilters.entity_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Entities ({availableFilters.entity_filters.length})
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
                    {availableFilters.entity_filters.map((filter, idx) => {
                      // Check if this entity is selected - match SECSearchPage logic
                      const match = filter.entity.match(/^(.+?)\s*\(CIK\s+(\d+)\)$/);
                      let entityObj: { entity: string; cik?: string };
                      if (match) {
                        const [, name, cik] = match;
                        entityObj = { entity: name.trim(), cik: cik };
                      } else {
                        entityObj = { entity: filter.entity.trim() };
                      }
                      
                      const isSelected = selectedFilters.entities.some(
                        e => e.entity === entityObj.entity && 
                             (entityObj.cik ? e.cik === entityObj.cik : !e.cik)
                      );
                      
                      return (
                        <Box
                          key={idx}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters((prev: typeof selectedFilters) => {
                              const exists = prev.entities.some(
                                e => e.entity === entityObj.entity && 
                                     (entityObj.cik ? e.cik === entityObj.cik : !e.cik)
                              );
                              if (exists) {
                                // Remove if already selected
                                return {
                                  ...prev,
                                  entities: prev.entities.filter(
                                    e => !(e.entity === entityObj.entity && 
                                          (entityObj.cik ? e.cik === entityObj.cik : !e.cik))
                                  ),
                                };
                              } else {
                                // Add if not selected
                                return {
                                  ...prev,
                                  entities: [...prev.entities, entityObj],
                                };
                              }
                            });
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.entity}
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
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Forms Filter */}
            {availableFilters.form_filters && availableFilters.form_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Form Types ({availableFilters.form_filters.length})
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
                    {availableFilters.form_filters.map((filter) => {
                      const isSelected = selectedFilters.forms.includes(filter.form);
                      return (
                        <Box
                          key={filter.form}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              forms: isSelected
                                ? prev.forms.filter(f => f !== filter.form)
                                : [...prev.forms, filter.form]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.form}
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
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Locations Filter */}
            {availableFilters.location_filters && availableFilters.location_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Locations ({availableFilters.location_filters.length})
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
                    {availableFilters.location_filters.map((filter) => {
                      const isSelected = selectedFilters.locations.includes(filter.location);
                      return (
                        <Box
                          key={filter.location}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              locations: isSelected
                                ? prev.locations.filter(l => l !== filter.location)
                                : [...prev.locations, filter.location]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.location}
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
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Incorporation States Filter */}
            {availableFilters.incorporation_filters && availableFilters.incorporation_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Incorporation States ({availableFilters.incorporation_filters.length})
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
                    {availableFilters.incorporation_filters.map((filter) => {
                      const isSelected = selectedFilters.incorporationStates.includes(filter.incorporation);
                      return (
                        <Box
                          key={filter.incorporation}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              incorporationStates: isSelected
                                ? prev.incorporationStates.filter(s => s !== filter.incorporation)
                                : [...prev.incorporationStates, filter.incorporation]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.incorporation}
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
                      );
                    })}
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
              entities: [],
              forms: [],
              locations: [],
              incorporationStates: []
            });
          }}
          disabled={
            selectedFilters.entities.length === 0 && 
            selectedFilters.forms.length === 0 && 
            selectedFilters.locations.length === 0 && 
            selectedFilters.incorporationStates.length === 0
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
          onClick={() => setFilterDialogOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Form type handlers
  const handleFormTypeToggle = (formType: string) => {
    setCurrentSearchParams(prev => {
      const currentFormTypes = prev.formTypes || [];
      const isSelected = currentFormTypes.includes(formType);
      
      if (isSelected) {
        return {
          ...prev,
          formTypes: currentFormTypes.filter(ft => ft !== formType)
        };
      } else {
        return {
          ...prev,
          formTypes: [...currentFormTypes, formType]
        };
      }
    });
  };

  const filteredFormTypes = selectedCategoryFilter === 'all' 
    ? ALL_FORM_TYPES 
    : ALL_FORM_TYPES.filter(formType => {
        const category = SEC_FORM_CATEGORIES.find(cat => cat.id === selectedCategoryFilter);
        return category?.formTypes.includes(formType.id) || false;
      });

  const areAllFilteredFormsSelected = filteredFormTypes.length > 0 && 
    filteredFormTypes.every(form => (currentSearchParams.formTypes || []).includes(form.id));

  const handleSelectAllForms = (checked: boolean) => {
    if (checked) {
      const allFilteredFormIds = filteredFormTypes.map(form => form.id);
      setCurrentSearchParams(prev => ({
        ...prev,
        formTypes: Array.from(new Set([...(prev.formTypes || []), ...allFilteredFormIds]))
      }));
    } else {
      const filteredFormIds = new Set(filteredFormTypes.map(form => form.id));
      setCurrentSearchParams(prev => ({
        ...prev,
        formTypes: (prev.formTypes || []).filter(ft => !filteredFormIds.has(ft))
      }));
    }
  };

  const renderFormTypesModal = () => (
    <Dialog
      open={formTypesModalOpen}
      onClose={() => setFormTypesModalOpen(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          color: '#ffffff',
          border: '1px solid #374151',
        },
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid #374151',
        pb: 2,
      }}>
        <Box>
          <Typography variant="h6" sx={{ color: '#ffffff', mb: 1 }}>
            Check forms that you want to search
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3b8' }}>
            Use the category select to narrow the choices.
          </Typography>
        </Box>
        <IconButton
          onClick={() => setFormTypesModalOpen(false)}
          sx={{ color: '#9ca3b8', '&:hover': { color: '#ffffff' } }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ mt: 2 }}>
        {/* Category Filter Dropdown */}
        <Box sx={{ mb: 3 }}>
          <FormControl 
            variant="outlined" 
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#374151' },
                '&:hover fieldset': { borderColor: '#3b82f6' },
                '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3b8' },
              '& .MuiSelect-select': { color: '#ffffff' },
            }}
          >
            <InputLabel>Category Filter</InputLabel>
            <Select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              label="Category Filter"
            >
              {SEC_FORM_CATEGORIES.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Check All/Uncheck All */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={areAllFilteredFormsSelected}
                indeterminate={
                  !areAllFilteredFormsSelected &&
                  filteredFormTypes.some(form => (currentSearchParams.formTypes || []).includes(form.id))
                }
                onChange={(e) => handleSelectAllForms(e.target.checked)}
                sx={{
                  color: '#9ca3b8',
                  '&.Mui-checked': { color: '#3b82f6' },
                }}
              />
            }
            label="Check/uncheck all forms"
            sx={{ color: '#9ca3b8' }}
          />
        </Box>

        {/* Form Types Checkboxes */}
        <Box
          sx={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid #374151',
            borderRadius: '4px',
            p: 2,
          }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1 }}>
            {filteredFormTypes.map((formType) => {
              const isSelected = (currentSearchParams.formTypes || []).includes(formType.id);
              return (
                <FormControlLabel
                  key={formType.id}
                  control={
                    <Checkbox
                      checked={isSelected}
                      onChange={() => handleFormTypeToggle(formType.id)}
                      sx={{
                        color: '#9ca3b8',
                        '&.Mui-checked': { color: '#3b82f6' },
                      }}
                    />
                  }
                  label={formType.label}
                  sx={{ 
                    color: '#9ca3b8',
                    '& .MuiFormControlLabel-label': { fontSize: '0.875rem' },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
        <Button
          onClick={() => setFormTypesModalOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Context Menu
  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid #374151',
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
          borderColor: '#3b82f6',
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : '0 8px 25px rgba(59, 130, 246, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: currentResults.length > 0 ? '#3b82f6' : '#dc2626',
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
              onClick={(e) => {
                e.stopPropagation();
                const currentTime = Date.now();
                if (currentTime - lastClickTimeRef.current < 300) {
                  // Double click detected, ignore
                  return;
                }
                lastClickTimeRef.current = currentTime;
                onSelectionChange(!isSelected);
              }}
              sx={{ color: '#9ca3b8', '&.Mui-checked': { color: '#3b82f6' }, p: 0.5 }}
              size="small"
            />
          )}
          
          <DocumentIcon sx={{ color: '#3b82f6', fontSize: '1.5rem' }} />
          <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '1.1rem' }}>
            SEC Search
          </Typography>
          
          {isLoading && (
            <>
              <CircularProgress size={16} sx={{ color: '#3b82f6', ml: 1 }} />
              {fetchProgress && (
                <Typography variant="caption" sx={{ color: '#3b82f6', ml: 1, fontWeight: 500 }}>
                  {fetchProgress.totalPages 
                    ? `Fetching page ${fetchProgress.currentPage} of ${fetchProgress.totalPages}...`
                    : `Fetching page ${fetchProgress.currentPage}...`}
                </Typography>
              )}
            </>
          )}
          
          {!isLoading && (
            <Typography variant="caption" sx={{ color: '#9ca3b8', ml: 1 }}>
              {allResults.length > 0 && currentResults.length !== allResults.length 
                ? `${currentResults.length} of ${allResults.length} results`
                : `${allResults.length} results`}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* Control buttons */}
          <Tooltip title={`Add ${selectedResults.size > 0 ? `${selectedResults.size} filing(s)` : 'selected filings'} to context`}>
            <span>
              <IconButton
                size="small"
                onClick={handleContextMenuClick}
                disabled={selectedResults.size === 0}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{ 
                  color: selectedResults.size > 0 ? '#10b981' : '#6b7280',
                  '&:hover': { color: selectedResults.size > 0 ? '#059669' : '#6b7280' },
                  '&.Mui-disabled': { color: '#6b7280' }
                }}
              >
                <AddToContextIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Filter Results" arrow>
            <IconButton
              onClick={() => setFilterDialogOpen(true)}
              sx={{
                color: '#9ca3b8',
                '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                padding: '6px',
              }}
              size="small"
            >
              <FilterIcon fontSize="small" />
            </IconButton>
          </Tooltip>



          <Tooltip title="Refresh" arrow>
            <IconButton
              onClick={performSearch}
              disabled={isLoading}
              sx={{
                color: '#9ca3b8',
                '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                padding: '6px',
              }}
              size="small"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <PinButton isPinned={pinnedState} onTogglePin={togglePin} />

          <Tooltip title="Settings" arrow>
            <IconButton
              onClick={handleSettingsClick}
              sx={{
                color: '#9ca3b8',
                '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                padding: '6px',
              }}
              size="small"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Remove tile">
            <IconButton
              size="small"
              onClick={handleRemove}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{ color: '#9ca3af', '&:hover': { color: '#dc2626' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Results Table */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
          {error}
        </Alert>
      )}

      <Box sx={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
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
          <Table 
            size="small" 
            sx={{
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
            }}
          >
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
                    indeterminate={selectedResults.size > 0 && selectedResults.size < currentPageResults.length}
                    checked={currentPageResults.length > 0 && selectedResults.size === currentPageResults.length}
                    onChange={() => {
                      if (selectedResults.size === currentPageResults.length) {
                        // Deselect all on current page
                        const newSelected = new Set(selectedResults);
                        currentPageResults.forEach(result => newSelected.delete(result.accession));
                        setSelectedResults(newSelected);
                      } else {
                        // Select all on current page
                        const newSelected = new Set(selectedResults);
                        currentPageResults.forEach(result => newSelected.add(result.accession));
                        setSelectedResults(newSelected);
                      }
                    }}
                    sx={{ 
                      color: '#9ca3af', 
                      '&.Mui-checked': { color: '#10b981' }, 
                      '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                    }}
                  />
                </TableCell>
                {visibleColumns.entity && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.entity,
                    minWidth: columnWidths.entity,
                  }}>Entity</TableCell>
                )}
                {visibleColumns.form && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.form,
                    minWidth: columnWidths.form,
                  }}>Form</TableCell>
                )}
                {visibleColumns.filingDate && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.filingDate,
                    minWidth: columnWidths.filingDate,
                  }}>Filing Date</TableCell>
                )}
                {visibleColumns.location && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.location,
                    minWidth: columnWidths.location,
                  }}>Location</TableCell>
                )}
                {visibleColumns.incorporation && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.incorporation,
                    minWidth: columnWidths.incorporation,
                  }}>Incorporation</TableCell>
                )}
                {visibleColumns.cik && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.cik,
                    minWidth: columnWidths.cik,
                  }}>CIK</TableCell>
                )}
                <TableCell sx={{ 
                  color: '#9ca3b8', 
                  fontWeight: 600, 
                  fontSize: '0.875rem',
                  width: 120,
                  minWidth: 120,
                }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentPageResults.map((result) => (
                <TableRow
                  key={result.accession}
                  sx={{
                    backgroundColor: selectedResults.has(result.accession) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: selectedResults.has(result.accession) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                    },
                  }}
                  onClick={() => toggleResultSelection(result.accession)}
                >
                  <TableCell sx={{ 
                    padding: '8px 12px',
                    width: columnWidths.checkbox || 50,
                    minWidth: columnWidths.checkbox || 50,
                    maxWidth: columnWidths.checkbox || 50,
                  }}>
                    <Checkbox
                      size="small"
                      checked={selectedResults.has(result.accession)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleResultSelection(result.accession);
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                    />
                  </TableCell>
                  {visibleColumns.entity && (
                    <TableCell sx={{ 
                      color: '#ffffff', 
                      fontSize: '0.875rem',
                      width: columnWidths.entity,
                      minWidth: columnWidths.entity,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.filingEntity}>
                        {result.filingEntity}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.form && (
                    <TableCell sx={{ 
                      fontSize: '0.875rem',
                      width: columnWidths.form,
                      minWidth: columnWidths.form,
                      padding: '8px 12px',
                    }}>
                      <Chip
                        label={result.form}
                        size="small"
                        sx={{
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          fontSize: '0.75rem',
                        }}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.filingDate && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.filingDate,
                      minWidth: columnWidths.filingDate,
                      padding: '8px 12px',
                    }}>
                      {formatDate(result.filingDate)}
                    </TableCell>
                  )}
                  {visibleColumns.location && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.location,
                      minWidth: columnWidths.location,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.located}>
                        {result.located || 'N/A'}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.incorporation && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.incorporation,
                      minWidth: columnWidths.incorporation,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.incorporated}>
                        {result.incorporated || 'N/A'}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.cik && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.cik,
                      minWidth: columnWidths.cik,
                      padding: '8px 12px',
                    }}>
                      {result.cik}
                    </TableCell>
                  )}
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontSize: '0.875rem',
                    width: 120,
                    minWidth: 120,
                    padding: '8px 12px',
                  }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFiling(result);
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
                      View Filing
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            mt: 2, 
            borderTop: '1px solid rgba(55, 65, 81, 0.3)', 
            pt: 2,
            flexShrink: 0
          }}>
            <Pagination
              count={totalPages}
              page={currentPage}
              onChange={(_, page) => setCurrentPage(page)}
              size="small"
              sx={{
                '& .MuiPaginationItem-root': {
                  color: '#9ca3b8',
                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                  '&.Mui-selected': {
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    '&:hover': { backgroundColor: '#2563eb' },
                  },
                },
              }}
            />
          </Box>
        )}
      </Box>

      {/* Settings Menu */}
      <Menu
        anchorEl={settingsAnchor}
        open={Boolean(settingsAnchor)}
        onClose={handleSettingsClose}
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            '& .MuiMenuItem-root': {
              color: '#ffffff',
              '&:hover': { backgroundColor: '#334155' },
            },
          }
        }}
      >
        <MenuItem onClick={() => {
          setSearchDialogOpen(true);
          handleSettingsClose();
        }}>
          <ListItemIcon><SearchIcon sx={{ color: '#9ca3b8' }} /></ListItemIcon>
          <ListItemText>Search Parameters</ListItemText>
        </MenuItem>
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
        <MenuItem onClick={() => handleAddToContext('new')} sx={{ color: '#10b981', fontWeight: 600 }}>
          <ListItemIcon><NewChatIcon sx={{ color: '#10b981', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to New Chat" />
        </MenuItem>
        <MenuItem onClick={() => handleAddToContext('sidebar')} sx={{ color: '#3b82f6', fontWeight: 600 }}>
          <ListItemIcon><SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Current Sidebar Chat" />
        </MenuItem>
      </Menu>

      {/* Dialogs */}
      {renderSearchDialog()}
      {renderFilterDialog()}
      {renderFormTypesModal()}

      {/* Filing Details Dialog */}
      <Dialog
        open={selectedFiling !== null}
        onClose={() => setSelectedFiling(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '8px',
            color: '#ffffff',
          },
        }}
      >
        {selectedFiling && (
          <>
            <DialogTitle sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              borderBottom: '1px solid #374151',
              pb: 2,
              color: '#ffffff',
              fontWeight: 600,
            }}>
              Filing Details: {selectedFiling.form} - {selectedFiling.filingEntity}
              <IconButton
                onClick={() => setSelectedFiling(null)}
                sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ 
              mt: 2,
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(55, 65, 81, 0.3)',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
              },
            }}>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Filing Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Form</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.form}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Filing Date</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.filingDate}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Reporting For</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.reportingFor || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Filing Entity</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.filingEntity || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>CIK</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.cik || 'N/A'}</Typography>
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                    Filing Page
                  </Typography>
                  {selectedFiling.filingPageUrl ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Link
                        href={selectedFiling.filingPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{
                          color: '#3b82f6',
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                        }}
                      >
                        <OpenInNewIcon sx={{ fontSize: 16 }} />
                        View on SEC.gov
                      </Link>
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>Not available</Typography>
                  )}
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                    Document Format Files ({selectedFiling.documentUrls?.length || 0})
                  </Typography>
                  {selectedFiling.documentUrls && selectedFiling.documentUrls.length > 0 ? (
                    <Box sx={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 1, 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '8px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: 'rgba(59, 130, 246, 0.5)',
                        borderRadius: '4px',
                      },
                      '&::-webkit-scrollbar-thumb:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                      },
                    }}>
                      {selectedFiling.documentUrls.map((url, index) => {
                        const filename = url.split('/').pop() || `Document ${index + 1}`;
                        return (
                          <Box
                            key={index}
                            sx={{
                              p: 1.5,
                              border: '1px solid #374151',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(31, 41, 55, 0.5)',
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <DocumentIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
                              <Link
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  color: '#3b82f6',
                                  textDecoration: 'none',
                                  fontSize: '0.875rem',
                                  flex: 1,
                                  '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                                }}
                              >
                                {filename}
                                <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />
                              </Link>
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>No document format files available</Typography>
                  )}
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
              <Button
                onClick={() => setSelectedFiling(null)}
                sx={{
                  color: '#9ca3af',
                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' },
                }}
              >
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
});

SECSearchTile.displayName = 'SECSearchTile';

export default SECSearchTile;
