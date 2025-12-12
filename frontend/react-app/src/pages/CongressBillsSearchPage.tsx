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
  Pagination,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Chat as SidebarChatIcon,
  AddComment as NewChatIcon,
  ViewColumn as ViewColumnIcon,
  Dashboard as AddToContextIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import { 
  congressBillsSearchAPI, 
  CongressBillsSearchFilters,
  CongressBill 
} from '../services/api';
import { politicianSuggestionsService } from '../services/politicianSuggestions';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
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

// Bill Type options (HR, S, HRES, etc.)
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

// Congress numbers (recent congresses)
const CONGRESS_NUMBERS = Array.from({ length: 10 }, (_, i) => 118 - i); // 118 down to 109


const CongressBillsSearchPage: React.FC = () => {
  const {} = useAuth();
  const {} = useGlobalChat();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'congress-bills-search-page-state';

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
  
  // Search state
  const [searchParams, setSearchParams] = useState<CongressBillsSearchFilters>(() => {
    const saved = savedState?.searchParams;
    return {
      bill_title: Array.isArray(saved?.bill_title) ? saved.bill_title : [],
      bill_type: Array.isArray(saved?.bill_type) ? saved.bill_type : [],
      sponsor_name: Array.isArray(saved?.sponsor_name) ? saved.sponsor_name : [],
      introduced_date_from: saved?.introduced_date_from || '',
      introduced_date_to: saved?.introduced_date_to || '',
      congress: Array.isArray(saved?.congress) ? saved.congress : [],
      policy_area: Array.isArray(saved?.policy_area) ? saved.policy_area : [],
      sponsor_party: Array.isArray(saved?.sponsor_party) ? saved.sponsor_party : [],
      sponsor_state: Array.isArray(saved?.sponsor_state) ? saved.sponsor_state : [],
      latest_action_date_from: saved?.latest_action_date_from || '',
      latest_action_date_to: saved?.latest_action_date_to || '',
      bipartisan: saved?.bipartisan,
      bill_number: saved?.bill_number,
    };
  });
  
  const [allSearchResults, setAllSearchResults] = useState<CongressBill[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<CongressBill[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Column visibility state
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
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    savedState?.visibleColumns || DEFAULT_VISIBLE_COLUMNS
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const columnMenuOpen = Boolean(columnMenuAnchor);
  
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 25);
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== false);
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== false);

  // Politician data loading state (for sponsor name autocomplete)
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState<boolean>(false);

  // Autocomplete state for Sponsor Name and Bill Title
  const [sponsorNameSuggestions, setSponsorNameSuggestions] = useState<string[]>([]);
  const [billTitleSuggestions, setBillTitleSuggestions] = useState<string[]>([]);
  const [sponsorNameLoading, setSponsorNameLoading] = useState<boolean>(false);
  const [billTitleLoading, setBillTitleLoading] = useState<boolean>(false);

  // Load politician data on component mount (for sponsor name autocomplete)
  useEffect(() => {
    const loadPoliticianData = async () => {
      try {
        console.log('🏛️ Loading politician suggestions data for congress bills...');
        await politicianSuggestionsService.loadPoliticians();
        setIsPoliticianDataLoaded(true);
        console.log('✅ Politician suggestions data loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load politician suggestions:', error);
      }
    };

    loadPoliticianData();
  }, []);

  // Autocomplete search functions - mirror politician trades approach using CSV
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

    // If empty query, return top politicians
    if (!query || query.length === 0) {
      const results = politicianSuggestionsService.getAllPoliticians().slice(0, 20).map(p => p.displayText);
      setSponsorNameSuggestions(results);
      setSponsorNameLoading(false);
      return results;
    }

    if (query.length < 2) {
      setSponsorNameSuggestions([]);
      setSponsorNameLoading(false);
      return [];
    }

    // Get suggestions from CSV-based service
    const suggestions = politicianSuggestionsService.getSuggestions(query, 20);
    const results = suggestions.map(p => p.displayText);
    setSponsorNameSuggestions(results);
    setSponsorNameLoading(false);
    return results;
  }, [isPoliticianDataLoaded]);

  const billTitleSearch = useCallback((query: string): string[] => {
    // Bill title autocomplete not implemented yet - return empty
    if (!query || query.length < 2) {
      setBillTitleSuggestions([]);
      setBillTitleLoading(false);
      return [];
    }

    setBillTitleLoading(false);
    setBillTitleSuggestions([]);
    return [];
  }, []);

  // Handle search
  const handleSearch = useCallback(async () => {
    setIsSearching(true);
    setSearchError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setAllSearchResults([]);
    setCurrentResults([]);
    setSelectedBills(new Set());

    try {
      const filters: any = {
        ...searchParams,
      };

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
        if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
      });

      const response = await congressBillsSearchAPI.search({
        filters,
        limit: pageSize,
      });

      if (response.success) {
        const results = response.results || [];
        setAllSearchResults(results);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
      } else {
        setSearchError('Search failed. Please try again.');
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred while searching.');
    } finally {
      setIsSearching(false);
    }
  }, [searchParams, pageSize]);

  // Save state to sessionStorage
  useEffect(() => {
    try {
      const stateToSave = {
        searchParams,
        allSearchResults,
        currentPage,
        pageSize,
        isSearching,
        lastEvaluatedKey,
        hasMore,
        visibleColumns,
        searchFormExpanded,
        advancedSearchExpanded,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving congress bills search page state:', error);
    }
  }, [
    searchParams,
    allSearchResults,
    currentPage,
    pageSize,
    isSearching,
    lastEvaluatedKey,
    hasMore,
    visibleColumns,
    searchFormExpanded,
    advancedSearchExpanded,
  ]);

  // Pagination
  const totalPages = Math.ceil(allSearchResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = allSearchResults.slice(startIndex, endIndex);

  // Format date helper
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 4, fontWeight: 600 }}>
          Congress Bills Search
        </Typography>

        {/* Main Layout: Filters on Left when no results, Top Right when results exist */}
        {allSearchResults.length === 0 ? (
          /* No Results: Filters on Left */
          <Box sx={{ display: 'flex', gap: 3 }}>
            {/* Left Sidebar - Search Filters */}
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
                  {/* Sponsor Name - Free text multi-select with autocomplete */}
                  <MultiSelectField<string>
                    label="Sponsor Name"
                    selectedItems={(() => {
                      const names = Array.isArray(searchParams.sponsor_name) ? searchParams.sponsor_name : (searchParams.sponsor_name ? [searchParams.sponsor_name] : []);
                      if (!isPoliticianDataLoaded) return names;
                      
                      // Convert actual names to display format
                      return names.map(name => {
                        const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                        return politician ? politician.displayText : name;
                      });
                    })()}
                    onItemsChange={(sponsors) => {
                      // Extract actual names from display text
                      const actualNames = sponsors.map(sponsorDisplay => {
                        const nameMatch = sponsorDisplay.match(/^([^(]+)/);
                        return nameMatch ? nameMatch[1].trim() : sponsorDisplay;
                      });
                      setSearchParams((prev) => ({ ...prev, sponsor_name: actualNames }));
                    }}
                    suggestions={isPoliticianDataLoaded ? 
                      politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : 
                      []
                    }
                    onSearch={sponsorNameSearch}
                    renderItem={(sponsorDisplay) => sponsorDisplay}
                    renderOptionCustom={(sponsorDisplay) => {
                      // Extract the name part for display while keeping full display text
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

                  {/* Bill Title - Free text multi-select with autocomplete */}
                  <MultiSelectField<string>
                    label="Bill Title"
                    selectedItems={searchParams.bill_title || []}
                    onItemsChange={(titles) => {
                      setSearchParams((prev) => ({ ...prev, bill_title: titles }));
                    }}
                    suggestions={billTitleSuggestions}
                    onSearch={billTitleSearch}
                    renderItem={(title) => title}
                    placeholder="Search bill titles..."
                    allowCustomInput={true}
                    isLoading={billTitleLoading}
                  />

                  {/* Bill Type - Dropdown multi-select */}
                  <MultiSelectField<string>
                    label="Bill Type"
                    selectedItems={searchParams.bill_type || []}
                    onItemsChange={(types) => {
                      setSearchParams((prev) => ({ ...prev, bill_type: types }));
                    }}
                    suggestions={BILL_TYPES}
                    renderItem={(type) => type}
                    placeholder="Select bill types..."
                  />

                  {/* Introduced Date From */}
                  <TextField
                    label="Introduced Date From"
                    type="date"
                    value={searchParams.introduced_date_from || ''}
                    onChange={(e) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        introduced_date_from: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
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
                    value={searchParams.introduced_date_to || ''}
                    onChange={(e) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        introduced_date_to: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
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

                  {/* Advanced Search Section */}
                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #374151' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontSize: '1rem' }}>
                        Advanced Search
                      </Typography>
                      <IconButton
                        onClick={() => setAdvancedSearchExpanded(!advancedSearchExpanded)}
                        sx={{ color: '#94a3b8' }}
                        size="small"
                      >
                        {advancedSearchExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                      </IconButton>
                    </Box>
                    <Collapse in={advancedSearchExpanded}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {/* Policy Area - Free text multi-select */}
                        <MultiSelectField<string>
                          label="Policy Area"
                          selectedItems={searchParams.policy_area || []}
                          onItemsChange={(areas) => {
                            setSearchParams((prev) => ({ ...prev, policy_area: areas }));
                          }}
                          suggestions={[]}
                          onSearch={() => []}
                          renderItem={(area) => area}
                          placeholder="Enter policy areas..."
                        />

                        {/* Sponsor Party - Dropdown multi-select */}
                        <MultiSelectField<string>
                          label="Sponsor Party"
                          selectedItems={searchParams.sponsor_party || []}
                          onItemsChange={(parties) => {
                            setSearchParams((prev) => ({ ...prev, sponsor_party: parties }));
                          }}
                          suggestions={PARTIES}
                          renderItem={(party) => party}
                          placeholder="Select parties..."
                        />

                        {/* Sponsor State - Dropdown multi-select */}
                        <MultiSelectField<string>
                          label="Sponsor State"
                          selectedItems={searchParams.sponsor_state || []}
                          onItemsChange={(states) => {
                            setSearchParams((prev) => ({ ...prev, sponsor_state: states }));
                          }}
                          suggestions={US_STATES}
                          renderItem={(state) => state}
                          placeholder="Select states..."
                        />

                        {/* Bipartisan - Dropdown single-select */}
                        <FormControl fullWidth>
                          <InputLabel sx={{ color: '#94a3b8' }}>Bipartisan</InputLabel>
                          <Select
                            value={searchParams.bipartisan !== undefined ? searchParams.bipartisan : ''}
                            onChange={(e) => {
                              setSearchParams((prev) => ({
                                ...prev,
                                bipartisan: e.target.value === '' ? undefined : Number(e.target.value),
                              }));
                            }}
                            label="Bipartisan"
                            sx={{
                              backgroundColor: 'rgba(30, 41, 59, 0.5)',
                              color: '#e2e8f0',
                              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#64748b' },
                              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                            }}
                          >
                            <MenuItem value="">All</MenuItem>
                            {BIPARTISAN_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {option.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        {/* Bill Number - Number input */}
                        <TextField
                          label="Bill Number"
                          type="number"
                          value={searchParams.bill_number || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
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
                          value={searchParams.latest_action_date_from || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
                              ...prev,
                              latest_action_date_from: e.target.value || undefined,
                            }));
                          }}
                          InputLabelProps={{
                            shrink: true,
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

                        {/* Latest Action Date To */}
                        <TextField
                          label="Latest Action Date To"
                          type="date"
                          value={searchParams.latest_action_date_to || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
                              ...prev,
                              latest_action_date_to: e.target.value || undefined,
                            }));
                          }}
                          InputLabelProps={{
                            shrink: true,
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
                        });
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

          {/* Main Content Area - Empty State */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Error Alert */}
            {searchError && (
              <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {searchError}
              </Alert>
            )}
          </Box>
        </Box>
        ) : (
          /* Results Exist: Filters on Top Right */
          <Box>
            {/* Error Alert */}
            {searchError && (
              <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {searchError}
              </Alert>
            )}

            {/* Results Header with Filters on Top Right */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, gap: 3 }}>
              {/* Results Title */}
              <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
                Results ({allSearchResults.length})
              </Typography>

              {/* Filter Box on Top Right */}
              <GlassCard sx={{ 
                minWidth: 280, 
                maxWidth: 320,
                height: 'fit-content',
              }}>
                <Box sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.9rem' }}>
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
                      {/* Sponsor Name */}
                      <MultiSelectField<string>
                        label="Sponsor Name"
                        selectedItems={(() => {
                          const names = Array.isArray(searchParams.sponsor_name) ? searchParams.sponsor_name : (searchParams.sponsor_name ? [searchParams.sponsor_name] : []);
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
                          setSearchParams((prev) => ({ ...prev, sponsor_name: actualNames }));
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

                      {/* Bill Title */}
                      <MultiSelectField<string>
                        label="Bill Title"
                        selectedItems={searchParams.bill_title || []}
                        onItemsChange={(titles) => {
                          setSearchParams((prev) => ({ ...prev, bill_title: titles }));
                        }}
                        suggestions={billTitleSuggestions}
                        onSearch={billTitleSearch}
                        renderItem={(title) => title}
                        placeholder="Search bill titles..."
                        allowCustomInput={true}
                        isLoading={billTitleLoading}
                      />

                      {/* Bill Type */}
                      <MultiSelectField<string>
                        label="Bill Type"
                        selectedItems={searchParams.bill_type || []}
                        onItemsChange={(types) => {
                          setSearchParams((prev) => ({ ...prev, bill_type: types }));
                        }}
                        suggestions={BILL_TYPES}
                        renderItem={(type) => type}
                        placeholder="Select bill types..."
                      />

                      {/* Introduced Date From */}
                      <TextField
                        label="Introduced Date From"
                        type="date"
                        value={searchParams.introduced_date_from || ''}
                        onChange={(e) => {
                          setSearchParams((prev) => ({
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
                        value={searchParams.introduced_date_to || ''}
                        onChange={(e) => {
                          setSearchParams((prev) => ({
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

                      {/* Advanced Search Section */}
                      <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #374151' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Typography variant="h6" sx={{ color: '#e2e8f0', fontSize: '0.9rem' }}>
                            Advanced Search
                          </Typography>
                          <IconButton
                            onClick={() => setAdvancedSearchExpanded(!advancedSearchExpanded)}
                            sx={{ color: '#94a3b8' }}
                            size="small"
                          >
                            {advancedSearchExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                          </IconButton>
                        </Box>
                        <Collapse in={advancedSearchExpanded}>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {/* Policy Area */}
                            <MultiSelectField<string>
                              label="Policy Area"
                              selectedItems={searchParams.policy_area || []}
                              onItemsChange={(areas) => {
                                setSearchParams((prev) => ({ ...prev, policy_area: areas }));
                              }}
                              suggestions={[]}
                              onSearch={() => []}
                              renderItem={(area) => area}
                              placeholder="Enter policy areas..."
                            />

                            {/* Sponsor Party */}
                            <MultiSelectField<string>
                              label="Sponsor Party"
                              selectedItems={searchParams.sponsor_party || []}
                              onItemsChange={(parties) => {
                                setSearchParams((prev) => ({ ...prev, sponsor_party: parties }));
                              }}
                              suggestions={PARTIES}
                              renderItem={(party) => party}
                              placeholder="Select parties..."
                            />

                            {/* Sponsor State */}
                            <MultiSelectField<string>
                              label="Sponsor State"
                              selectedItems={searchParams.sponsor_state || []}
                              onItemsChange={(states) => {
                                setSearchParams((prev) => ({ ...prev, sponsor_state: states }));
                              }}
                              suggestions={US_STATES}
                              renderItem={(state) => state}
                              placeholder="Select states..."
                            />

                            {/* Bipartisan */}
                            <FormControl fullWidth>
                              <InputLabel sx={{ color: '#94a3b8' }}>Bipartisan</InputLabel>
                              <Select
                                value={searchParams.bipartisan !== undefined ? searchParams.bipartisan : ''}
                                onChange={(e) => {
                                  setSearchParams((prev) => ({
                                    ...prev,
                                    bipartisan: e.target.value === '' ? undefined : Number(e.target.value),
                                  }));
                                }}
                                label="Bipartisan"
                                sx={{
                                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                                  color: '#e2e8f0',
                                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#64748b' },
                                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                                }}
                              >
                                <MenuItem value="">All</MenuItem>
                                {BIPARTISAN_OPTIONS.map((option) => (
                                  <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            {/* Bill Number */}
                            <TextField
                              label="Bill Number"
                              type="number"
                              value={searchParams.bill_number || ''}
                              onChange={(e) => {
                                setSearchParams((prev) => ({
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
                              value={searchParams.latest_action_date_from || ''}
                              onChange={(e) => {
                                setSearchParams((prev) => ({
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
                              value={searchParams.latest_action_date_to || ''}
                              onChange={(e) => {
                                setSearchParams((prev) => ({
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
                            });
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
            </Box>

            {/* Results Table */}
            <GlassCard>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Select columns to display">
                      <IconButton
                        onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                        sx={{ color: '#94a3b8' }}
                        size="small"
                      >
                        <ViewColumnIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                  {/* Column Menu */}
                  <Menu
                    anchorEl={columnMenuAnchor}
                    open={columnMenuOpen}
                    onClose={() => setColumnMenuAnchor(null)}
                    PaperProps={{
                      sx: {
                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                        border: '2px solid #374151',
                        color: '#ffffff',
                      },
                    }}
                  >
                    {AVAILABLE_COLUMNS.map((column) => (
                      <MenuItem
                        key={column}
                        onClick={() => {
                          setVisibleColumns((prev) =>
                            prev.includes(column)
                              ? prev.filter((c) => c !== column)
                              : [...prev, column]
                          );
                        }}
                        sx={{
                          color: visibleColumns.includes(column) ? '#3b82f6' : '#94a3b8',
                        }}
                      >
                        <Checkbox
                          checked={visibleColumns.includes(column)}
                          sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                        />
                        {column.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </MenuItem>
                    ))}
                  </Menu>

                  <TableContainer
              sx={{
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
              }}
            >
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>
                      <Checkbox
                        checked={selectedBills.size === paginatedResults.length && paginatedResults.length > 0}
                        indeterminate={
                          selectedBills.size > 0 && selectedBills.size < paginatedResults.length
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBills(new Set(paginatedResults.map((b) => b.bill_id)));
                          } else {
                            setSelectedBills(new Set());
                          }
                        }}
                        sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                      />
                    </TableCell>
                    {visibleColumns.includes('bill_title') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Title</TableCell>
                    )}
                    {visibleColumns.includes('bill_type') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Type</TableCell>
                    )}
                    {visibleColumns.includes('bill_number') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Number</TableCell>
                    )}
                    {visibleColumns.includes('sponsor_name') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Sponsor</TableCell>
                    )}
                    {visibleColumns.includes('sponsor_party') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Party</TableCell>
                    )}
                    {visibleColumns.includes('sponsor_state') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>State</TableCell>
                    )}
                    {visibleColumns.includes('introduced_date') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Introduced Date</TableCell>
                    )}
                    {visibleColumns.includes('latest_action_date') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Latest Action</TableCell>
                    )}
                    {visibleColumns.includes('congress') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Congress</TableCell>
                    )}
                    {visibleColumns.includes('bipartisan') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bipartisan</TableCell>
                    )}
                    {visibleColumns.includes('policy_area') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Policy Area</TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedResults.map((bill) => (
                    <TableRow key={bill.bill_id} sx={{ '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.05)' } }}>
                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                        <Checkbox
                          checked={selectedBills.has(bill.bill_id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedBills);
                            if (e.target.checked) {
                              newSet.add(bill.bill_id);
                            } else {
                              newSet.delete(bill.bill_id);
                            }
                            setSelectedBills(newSet);
                          }}
                          sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                        />
                      </TableCell>
                      {visibleColumns.includes('bill_title') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_title || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bill_type') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_type || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bill_number') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_number || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('sponsor_name') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.sponsor_full_name || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('sponsor_party') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.sponsor_party || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('sponsor_state') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.sponsor_state || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('introduced_date') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {formatDate(bill.introduced_date)}
                        </TableCell>
                      )}
                      {visibleColumns.includes('latest_action_date') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {formatDate(bill.latest_action_date)}
                        </TableCell>
                      )}
                      {visibleColumns.includes('congress') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.congress || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bipartisan') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bipartisan === 1 ? 'Yes' : bill.bipartisan === 0 ? 'No' : 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('policy_area') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
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
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                    <Typography sx={{ color: '#94a3b8' }}>
                      Showing {startIndex + 1}-{Math.min(endIndex, allSearchResults.length)} of {allSearchResults.length} results
                    </Typography>
                    <Pagination
                      count={totalPages}
                      page={currentPage}
                      onChange={(_, page) => setCurrentPage(page)}
                      sx={{
                        '& .MuiPaginationItem-root': {
                          color: '#94a3b8',
                          '&.Mui-selected': {
                            backgroundColor: '#3b82f6',
                            color: '#fff',
                          },
                        },
                      }}
                    />
                  </Box>
                )}
              </Box>
            </GlassCard>
          </Box>
        )}
      </Container>
    </Box>
  );
};

export default CongressBillsSearchPage;

