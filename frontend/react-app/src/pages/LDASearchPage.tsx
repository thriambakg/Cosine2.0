import React, { useState, useEffect, useCallback } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  AddComment as NewChatIcon,
} from '@mui/icons-material';
import { ldaSearchAPI, ldaAutocompleteAPI, LDASearchFilters, LDAFiling } from '../services/api';
import MultiSelectField from '../components/MultiSelectField';

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

  // Initialize state from sessionStorage immediately
  const savedState = loadStateFromStorage();

  // Autocomplete debounce timer
  const autocompleteTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Search state
  const [searchParams, setSearchParams] = useState<LDASearchFilters>(
    savedState?.searchParams || {
      general_text_search: [],
      date_from: '',
      date_to: '',
      report_type: [],
      amount_min: undefined,
      amount_max: undefined,
    }
  );
  
  const [allSearchResults, setAllSearchResults] = useState<LDAFiling[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<LDAFiling[]>([]);
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 50);
  
  // Dialog state for filing details
  const [selectedFilingForDetails, setSelectedFilingForDetails] = useState<LDAFiling | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  
  // Selection state
  const [selectedFilings, setSelectedFilings] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
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
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== undefined ? savedState.searchFormExpanded : true);
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== undefined ? savedState.advancedSearchExpanded : false);

  // Log state restoration
  useEffect(() => {
    if (savedState) {
      console.log('🔄 Restored LDA search page state from sessionStorage:', {
        hasSearchParams: !!savedState.searchParams,
        allResultsCount: savedState.allSearchResults?.length || 0,
        totalFound: savedState.totalFound || 0,
        hasFilters: !!savedState.selectedFilters,
        hasMore: savedState.hasMore,
      });
    } else {
      console.log('🆕 Starting fresh LDA search page session');
    }
  }, []);

  // Save state to sessionStorage whenever relevant state changes
  useEffect(() => {
    try {
      const stateToSave = {
        searchParams,
        allSearchResults,
        totalFound,
        isSearching,
        selectedFilters,
        availableFilters,
        expandedFilters,
        isFiltered,
        currentPage,
        pageSize,
        lastEvaluatedKey,
        hasMore,
        searchFormExpanded,
        advancedSearchExpanded,
      };
      
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving LDA search page state:', error);
    }
  }, [
    searchParams,
    allSearchResults,
    totalFound,
    isSearching,
    selectedFilters,
    availableFilters,
    expandedFilters,
    isFiltered,
    currentPage,
    pageSize,
    lastEvaluatedKey,
    hasMore,
    searchFormExpanded,
    advancedSearchExpanded,
  ]);

  // Compute filters from search results (will be used when API is integrated)
  const computeFiltersFromResults = (results: LDAFiling[]) => {
    const registrantMap = new Map<string, number>();
    const clientMap = new Map<string, number>();
    const lobbyistMap = new Map<string, number>();
    const filingTypeMap = new Map<string, number>();
    const issueCodeMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    
    results.forEach(filing => {
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
      registrant_filters: Array.from(registrantMap.entries())
        .map(([registrant, count]) => ({ registrant, count }))
        .sort((a, b) => b.count - a.count),
      client_filters: Array.from(clientMap.entries())
        .map(([client, count]) => ({ client, count }))
        .sort((a, b) => b.count - a.count),
      lobbyist_filters: Array.from(lobbyistMap.entries())
        .map(([lobbyist, count]) => ({ lobbyist, count }))
        .sort((a, b) => b.count - a.count),
      filing_type_filters: Array.from(filingTypeMap.entries())
        .map(([filingType, count]) => ({ filingType, count }))
        .sort((a, b) => b.count - a.count),
      issue_code_filters: Array.from(issueCodeMap.entries())
        .map(([issueCode, count]) => ({ issueCode, count }))
        .sort((a, b) => b.count - a.count),
      state_filters: Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
    };
  };

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
    
    // Filter by lobbyists
    if (selectedFilters.lobbyists.length > 0) {
      filtered = filtered.filter(filing => 
        selectedFilters.lobbyists.includes(filing.lobbyist_name || '')
      );
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
    
    try {
      const response = await ldaSearchAPI.search({
        filters: searchParams as LDASearchFilters,
        limit: pageSize,
      });
      
      if (response.success && response.results) {
        setAllSearchResults(response.results);
        setCurrentResults(response.results);
        setTotalFound(response.count || response.results.length);
        setHasMore(response.has_more || false);
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

  // Load more results
  const handleLoadMore = async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
    try {
      const response = await ldaSearchAPI.search({
        filters: searchParams as LDASearchFilters,
        limit: pageSize,
        last_evaluated_key: lastEvaluatedKey,
      });
      
      if (response.success && response.results) {
        const newResults = [...allSearchResults, ...response.results];
        setAllSearchResults(newResults);
        setCurrentResults(newResults);
        setHasMore(response.has_more || false);
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
  };

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    const selectedFilingObjects = currentResults.filter(filing => 
      selectedFilings.has(filing.id || filing.filing_uuid || '')
    );

    if (selectedFilingObjects.length === 0) return;

    // TODO: Implement add to context when API integration is ready
    console.log(`Adding ${selectedFilingObjects.length} filing(s) to context (target: ${target})`);

    setSelectedFilings(new Set());
    handleContextMenuClose();
  };
  
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
                  {/* General Text Search */}
                  <Box>
                    <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                      General Search
                    </Typography>
                    <MultiSelectField<string>
                      label="Search"
                      selectedItems={searchParams.general_text_search || []}
                      onItemsChange={(items) => {
                        setSearchParams(prev => ({ ...prev, general_text_search: items }));
                      }}
                      suggestions={[]}
                      onSearch={async (query: string) => {
                        // Debounce autocomplete requests (250ms as requested)
                        return new Promise<string[]>((resolve) => {
                          if (autocompleteTimerRef.current) {
                            clearTimeout(autocompleteTimerRef.current);
                          }
                          
                          autocompleteTimerRef.current = setTimeout(async () => {
                            try {
                              const results = await ldaAutocompleteAPI.search({
                                query,
                                field_types: ['registrant', 'client', 'lobbyist', 'pac'],
                                limit: 20,
                              });
                              resolve(results);
                            } catch (error) {
                              console.error('Autocomplete error:', error);
                              resolve([]);
                            }
                          }, 250);
                        });
                      }}
                      renderItem={(item) => item}
                      placeholder="Type to search..."
                      allowCustomInput={false}
                    />
                  </Box>

                  {/* Date Range */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="Date From"
                      type="date"
                      value={searchParams.date_from || ''}
                      onChange={(e) => setSearchParams(prev => ({ ...prev, date_from: e.target.value || undefined }))}
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
                    <TextField
                      label="Date To"
                      type="date"
                      value={searchParams.date_to || ''}
                      onChange={(e) => setSearchParams(prev => ({ ...prev, date_to: e.target.value || undefined }))}
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

                  {/* Amount Range */}
                  <Box>
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

                  {/* Advanced Search */}
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
                        {/* Registrant Name */}
                        <MultiSelectField<string>
                          label="Registrant Name"
                          selectedItems={searchParams.registrant_name || []}
                          onItemsChange={(names) => {
                            setSearchParams(prev => ({ ...prev, registrant_name: names }));
                          }}
                          suggestions={[]}
                          onSearch={async (query: string) => {
                            return new Promise<string[]>((resolve) => {
                              if (autocompleteTimerRef.current) {
                                clearTimeout(autocompleteTimerRef.current);
                              }
                              autocompleteTimerRef.current = setTimeout(async () => {
                                try {
                                  const results = await ldaAutocompleteAPI.search({
                                    query,
                                    field_types: ['registrant'],
                                    limit: 20,
                                  });
                                  resolve(results);
                                } catch (error) {
                                  console.error('Autocomplete error:', error);
                                  resolve([]);
                                }
                              }, 250);
                            });
                          }}
                          renderItem={(name) => name}
                          placeholder="Search registrants..."
                          allowCustomInput={false}
                        />

                        {/* Client Name */}
                        <MultiSelectField<string>
                          label="Client Name"
                          selectedItems={searchParams.client_name || []}
                          onItemsChange={(names) => {
                            setSearchParams(prev => ({ ...prev, client_name: names }));
                          }}
                          suggestions={[]}
                          onSearch={async (query: string) => {
                            return new Promise<string[]>((resolve) => {
                              if (autocompleteTimerRef.current) {
                                clearTimeout(autocompleteTimerRef.current);
                              }
                              autocompleteTimerRef.current = setTimeout(async () => {
                                try {
                                  const results = await ldaAutocompleteAPI.search({
                                    query,
                                    field_types: ['client'],
                                    limit: 20,
                                  });
                                  resolve(results);
                                } catch (error) {
                                  console.error('Autocomplete error:', error);
                                  resolve([]);
                                }
                              }, 250);
                            });
                          }}
                          renderItem={(name) => name}
                          placeholder="Search clients..."
                          allowCustomInput={false}
                        />

                        {/* Lobbyist Name */}
                        <MultiSelectField<string>
                          label="Lobbyist Name"
                          selectedItems={searchParams.lobbyist_name || []}
                          onItemsChange={(names) => {
                            setSearchParams(prev => ({ ...prev, lobbyist_name: names }));
                          }}
                          suggestions={[]}
                          onSearch={async (query: string) => {
                            return new Promise<string[]>((resolve) => {
                              if (autocompleteTimerRef.current) {
                                clearTimeout(autocompleteTimerRef.current);
                              }
                              autocompleteTimerRef.current = setTimeout(async () => {
                                try {
                                  const results = await ldaAutocompleteAPI.search({
                                    query,
                                    field_types: ['lobbyist'],
                                    limit: 20,
                                  });
                                  resolve(results);
                                } catch (error) {
                                  console.error('Autocomplete error:', error);
                                  resolve([]);
                                }
                              }, 250);
                            });
                          }}
                          renderItem={(name) => name}
                          placeholder="Search lobbyists..."
                          allowCustomInput={false}
                        />

                        {/* Foreign Entity Name */}
                        <MultiSelectField<string>
                          label="Foreign Entity Name"
                          selectedItems={searchParams.foreign_entity_name || []}
                          onItemsChange={(names) => {
                            setSearchParams(prev => ({ ...prev, foreign_entity_name: names }));
                          }}
                          suggestions={[]}
                          onSearch={async (query: string) => {
                            return new Promise<string[]>((resolve) => {
                              if (autocompleteTimerRef.current) {
                                clearTimeout(autocompleteTimerRef.current);
                              }
                              autocompleteTimerRef.current = setTimeout(async () => {
                                try {
                                  const results = await ldaAutocompleteAPI.search({
                                    query,
                                    field_types: ['foreign'],
                                    limit: 20,
                                  });
                                  resolve(results);
                                } catch (error) {
                                  console.error('Autocomplete error:', error);
                                  resolve([]);
                                }
                              }, 250);
                            });
                          }}
                          renderItem={(name) => name}
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
                          suggestions={[]}
                          onSearch={() => []}
                          renderItem={(code) => code}
                          placeholder="Search issue codes..."
                          allowCustomInput={false}
                        />

                        {/* Filing Type - Multi-select */}
                        <MultiSelectField<string>
                          label="Filing Type"
                          selectedItems={searchParams.report_type || []}
                          onItemsChange={(types) => {
                            setSearchParams(prev => ({ ...prev, report_type: types }));
                          }}
                          suggestions={['LD-1', 'LD-2', 'LD-203']}
                          onSearch={() => ['LD-1', 'LD-2', 'LD-203']}
                          renderItem={(type) => type}
                          placeholder="Select filing types..."
                          allowCustomInput={false}
                        />

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
                          general_text_search: [],
                          date_from: '',
                          date_to: '',
                          report_type: [],
                          amount_min: undefined,
                          amount_max: undefined,
                        });
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
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {/* Left side can be used for other controls if needed */}
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

                  {/* Results Table */}
                  {currentResults.length > 0 ? (
                    <>
                      <TableContainer sx={{ 
                        backgroundColor: 'transparent',
                        borderRadius: 0,
                        boxShadow: 'none',
                        border: 'none',
                        overflow: 'auto',
                        width: '100%',
                      }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem', width: 50 }}>
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
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Filing Type</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Registrant</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Client</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Lobbyist</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Amount</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Date Posted</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>State</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>Issue Code</TableCell>
                              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, fontSize: '0.875rem' }}>More Info</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {paginatedResults.map((filing) => {
                              const filingId = filing.id || filing.filing_uuid || '';
                              return (
                              <TableRow
                                key={filingId}
                                sx={{
                                  backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                  '&:hover': {
                                    backgroundColor: selectedFilings.has(filingId) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                                  },
                                  cursor: 'pointer',
                                }}
                                onClick={() => toggleFilingSelection(filingId)}
                              >
                                <TableCell sx={{ padding: '8px 12px' }}>
                                  <Checkbox
                                    size="small"
                                    checked={selectedFilings.has(filingId)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleFilingSelection(filingId);
                                    }}
                                    sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                                  />
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.report_type || 'N/A'}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.registrant_name || 'N/A'}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.client_name || 'N/A'}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.lobbyist_name || 'N/A'}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {formatCurrency(filing.amount_reported)}
                                </TableCell>
                                <TableCell sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                                  {formatDate(filing.dt_posted)}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.state || 'N/A'}
                                </TableCell>
                                <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {filing.general_issue_code || 'N/A'}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedFilingForDetails(filing);
                                      setDetailsDialogOpen(true);
                                    }}
                                    sx={{
                                      color: '#3b82f6',
                                      borderColor: '#3b82f6',
                                      fontSize: '0.7rem',
                                      '&:hover': {
                                        borderColor: '#60a5fa',
                                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                      },
                                    }}
                                  >
                                    More Info
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
                        }}
                      />
                    ))}
                    {/* Similar chips for other filter types */}
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
                    <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto' }}>
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

              {/* Similar filter sections for clients, lobbyists, filing types, issue codes, states */}
            </GlassCard>
          )}
        </Box>
      </Container>

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
          <NewChatIcon sx={{ color: '#10b981', mr: 1, fontSize: 18 }} />
          Add to New Chat
        </MenuItem>
        <MenuItem onClick={() => handleAddToContext('sidebar')} sx={{ color: '#3b82f6', fontWeight: 600 }}>
          <SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} />
          Add to Current Sidebar Chat
        </MenuItem>
      </Menu>

      {/* Filing Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
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
            <DialogTitle sx={{ borderBottom: '1px solid #374151', pb: 2 }}>
              <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                Filing Details
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ pt: 3 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing UUID:</strong> {selectedFilingForDetails.filing_uuid}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Type:</strong> {selectedFilingForDetails.report_type || 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Registrant:</strong> {selectedFilingForDetails.registrant_name || 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Client:</strong> {selectedFilingForDetails.client_name || 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Lobbyist:</strong> {selectedFilingForDetails.lobbyist_name || 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Amount:</strong> {formatCurrency(selectedFilingForDetails.amount_reported)}
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Date Posted:</strong> {formatDate(selectedFilingForDetails.dt_posted)}
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid #374151', pt: 2, pb: 2, px: 3 }}>
              <Button
                onClick={() => setDetailsDialogOpen(false)}
                sx={{
                  color: '#9ca3af',
                  '&:hover': {
                    backgroundColor: 'rgba(148, 163, 184, 0.1)',
                  },
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
};

export default LDASearchPage;

