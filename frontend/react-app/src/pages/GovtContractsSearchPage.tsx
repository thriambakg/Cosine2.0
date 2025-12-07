import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Link,
  Autocomplete,
  Pagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  AddComment as NewChatIcon,
  Launch as LaunchIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { 
  govtContractsSearchAPI, 
  govtContractsAutocompleteAPI,
  GovtContractsSearchFilters,
  GovtContractAward 
} from '../services/api';
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

// Fiscal years (last 10 years)
const FISCAL_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i + 1);

const GovtContractsSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { activeSessionId } = useGlobalChat();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'govt-contracts-search-page-state';

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
  
  // Search state - ensure all array fields are initialized
  const [searchParams, setSearchParams] = useState<GovtContractsSearchFilters>(() => {
    const saved = savedState?.searchParams;
    return {
      keywords: Array.isArray(saved?.keywords) ? saved.keywords : [],
      award_type: Array.isArray(saved?.award_type) ? saved.award_type : [],
      awarding_agency_code: Array.isArray(saved?.awarding_agency_code) ? saved.awarding_agency_code : [],
      funding_agency_code: Array.isArray(saved?.funding_agency_code) ? saved.funding_agency_code : [],
      recipient_id: Array.isArray(saved?.recipient_id) ? saved.recipient_id : [],
      recipient_name: Array.isArray(saved?.recipient_name) ? saved.recipient_name : [],
      recipient_location_state: Array.isArray(saved?.recipient_location_state) ? saved.recipient_location_state : [],
      recipient_location_country: Array.isArray(saved?.recipient_location_country) ? saved.recipient_location_country : [],
      naics_code: Array.isArray(saved?.naics_code) ? saved.naics_code : [],
      psc_code: Array.isArray(saved?.psc_code) ? saved.psc_code : [],
      cfda_number: Array.isArray(saved?.cfda_number) ? saved.cfda_number : [],
      fiscal_year: Array.isArray(saved?.fiscal_year) ? saved.fiscal_year : [],
    };
  });
  
  const [allSearchResults, setAllSearchResults] = useState<GovtContractAward[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<GovtContractAward[]>([]);
  const [totalFound, setTotalFound] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<{ mouseX: number; mouseY: number } | null>(null);
  
  // Filter state
  const [availableFilters, setAvailableFilters] = useState<{
    award_types: Set<string>;
    agencies: Set<string>;
    recipients: Set<string>;
    states: Set<string>;
    countries: Set<string>;
    naics: Set<string>;
    psc: Set<string>;
    cfda: Set<string>;
  }>({
    award_types: new Set(),
    agencies: new Set(),
    recipients: new Set(),
    states: new Set(),
    countries: new Set(),
    naics: new Set(),
    psc: new Set(),
    cfda: new Set(),
  });
  
  const [expandedFilters, setExpandedFilters] = useState({
    award_types: true,
    agencies: true,
    recipients: true,
    locations: true,
    codes: true,
  });
  
  const [selectedFilters, setSelectedFilters] = useState<{
    award_types: Set<string>;
    agencies: Set<string>;
    recipients: Set<string>;
    states: Set<string>;
    countries: Set<string>;
    naics: Set<string>;
    psc: Set<string>;
    cfda: Set<string>;
  }>({
    award_types: new Set(),
    agencies: new Set(),
    recipients: new Set(),
    states: new Set(),
    countries: new Set(),
    naics: new Set(),
    psc: new Set(),
    cfda: new Set(),
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize] = useState<number>(savedState?.pageSize || 25);
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== false);

  // Autocomplete state
  const [autocompleteOptions, setAutocompleteOptions] = useState<{
    [key: string]: Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>;
  }>({});

  // Compute available filters from results
  const computeFiltersFromResults = useCallback((results: GovtContractAward[]) => {
    const filters = {
      award_types: new Set<string>(),
      agencies: new Set<string>(),
      recipients: new Set<string>(),
      states: new Set<string>(),
      countries: new Set<string>(),
      naics: new Set<string>(),
      psc: new Set<string>(),
      cfda: new Set<string>(),
    };

    results.forEach((award) => {
      if (award.award_type) filters.award_types.add(award.award_type);
      if (award.awarding_agency_name) filters.agencies.add(award.awarding_agency_name);
      if (award.funding_agency_name) filters.agencies.add(award.funding_agency_name);
      if (award.recipient_name) filters.recipients.add(award.recipient_name);
      if (award.recipient_location_state) filters.states.add(award.recipient_location_state);
      if (award.recipient_location_country) filters.countries.add(award.recipient_location_country);
      if (award.naics_code) filters.naics.add(award.naics_code);
      if (award.psc_code) filters.psc.add(award.psc_code);
      if (award.cfda_number) filters.cfda.add(award.cfda_number);
    });

    setAvailableFilters(filters);
  }, []);

  // Apply client-side filters
  const applyFilters = useCallback(() => {
    let filtered = [...allSearchResults];

    // Apply selected filters
    if (selectedFilters.award_types.size > 0) {
      filtered = filtered.filter((award) => 
        award.award_type && selectedFilters.award_types.has(award.award_type)
      );
    }

    if (selectedFilters.agencies.size > 0) {
      filtered = filtered.filter((award) =>
        (award.awarding_agency_name && selectedFilters.agencies.has(award.awarding_agency_name)) ||
        (award.funding_agency_name && selectedFilters.agencies.has(award.funding_agency_name))
      );
    }

    if (selectedFilters.recipients.size > 0) {
      filtered = filtered.filter((award) =>
        award.recipient_name && selectedFilters.recipients.has(award.recipient_name)
      );
    }

    if (selectedFilters.states.size > 0) {
      filtered = filtered.filter((award) =>
        award.recipient_location_state && selectedFilters.states.has(award.recipient_location_state)
      );
    }

    if (selectedFilters.countries.size > 0) {
      filtered = filtered.filter((award) =>
        award.recipient_location_country && selectedFilters.countries.has(award.recipient_location_country)
      );
    }

    if (selectedFilters.naics.size > 0) {
      filtered = filtered.filter((award) =>
        award.naics_code && selectedFilters.naics.has(award.naics_code)
      );
    }

    if (selectedFilters.psc.size > 0) {
      filtered = filtered.filter((award) =>
        award.psc_code && selectedFilters.psc.has(award.psc_code)
      );
    }

    if (selectedFilters.cfda.size > 0) {
      filtered = filtered.filter((award) =>
        award.cfda_number && selectedFilters.cfda.has(award.cfda_number)
      );
    }

    setCurrentResults(filtered);
    setIsFiltered(
      selectedFilters.award_types.size > 0 ||
      selectedFilters.agencies.size > 0 ||
      selectedFilters.recipients.size > 0 ||
      selectedFilters.states.size > 0 ||
      selectedFilters.countries.size > 0 ||
      selectedFilters.naics.size > 0 ||
      selectedFilters.psc.size > 0 ||
      selectedFilters.cfda.size > 0
    );
    setCurrentPage(1);
  }, [allSearchResults, selectedFilters]);

  // Load autocomplete options
  const loadAutocompleteOptions = useCallback(async (
    type: string,
    searchText: string
  ) => {
    if (!searchText || searchText.length < 2) {
      setAutocompleteOptions((prev) => ({ ...prev, [type]: [] }));
      return;
    }

    try {
      const response = await govtContractsAutocompleteAPI.autocomplete({
        autocomplete_type: type,
        search_text: searchText,
        limit: 20,
      });

      if (response.success && response.results) {
        setAutocompleteOptions((prev) => ({
          ...prev,
          [type]: response.results || [],
        }));
      }
    } catch (error) {
      console.error(`Error loading autocomplete for ${type}:`, error);
    }
  }, []);

  // Handle search
  const handleSearch = useCallback(async () => {
    setIsSearching(true);
    setSearchError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setAllSearchResults([]);
    setCurrentResults([]);
    setSelectedAwards(new Set());

    try {
      const filters: GovtContractsSearchFilters = {
        ...searchParams,
      };

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key as keyof GovtContractsSearchFilters];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key as keyof GovtContractsSearchFilters];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: 50,
      });

      if (response.success) {
        setAllSearchResults(response.results || []);
        setTotalFound(response.results?.length || 0);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        computeFiltersFromResults(response.results || []);
      } else {
        setSearchError('Search failed. Please try again.');
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred while searching.');
    } finally {
      setIsSearching(false);
    }
  }, [searchParams, computeFiltersFromResults]);

  // Handle load more
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;

    setIsLoadingMore(true);
    setSearchError(null);

    try {
      const filters: GovtContractsSearchFilters = {
        ...searchParams,
      };

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key as keyof GovtContractsSearchFilters];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key as keyof GovtContractsSearchFilters];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: 50,
        last_evaluated_key: lastEvaluatedKey,
      });

      if (response.success) {
        setAllSearchResults((prev) => [...prev, ...(response.results || [])]);
        setTotalFound((prev) => prev + (response.results?.length || 0));
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        computeFiltersFromResults([...allSearchResults, ...(response.results || [])]);
      }
    } catch (error: any) {
      console.error('Load more error:', error);
      setSearchError(error.message || 'An error occurred while loading more results.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, searchParams, isLoadingMore, allSearchResults, computeFiltersFromResults]);

  // Pagination
  const totalPages = Math.ceil(currentResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = currentResults.slice(startIndex, endIndex);

  // Save state to sessionStorage
  useEffect(() => {
    const stateToSave = {
      searchParams,
      allSearchResults,
      lastEvaluatedKey,
      hasMore,
      currentPage,
      pageSize,
      searchFormExpanded,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [searchParams, allSearchResults, lastEvaluatedKey, hasMore, currentPage, pageSize, searchFormExpanded]);

  // Apply filters when they change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Compute filters when results change
  useEffect(() => {
    if (allSearchResults.length > 0) {
      computeFiltersFromResults(allSearchResults);
    }
  }, [allSearchResults, computeFiltersFromResults]);

  // Format currency
  const formatCurrency = (amount?: number) => {
    if (amount === undefined || amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        py: 4,
      }}
    >
      <Container maxWidth="xl">
        <GlassCard sx={{ mb: 3 }}>
          <Box sx={{ p: 3, borderBottom: '1px solid #374151' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h4" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                Government Contracts Search
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {allSearchResults.length > 0 && (
                  <Chip
                    label={
                      isLoadingMore
                        ? 'Loading...'
                        : !isFiltered && hasMore && lastEvaluatedKey
                        ? `Load More (${allSearchResults.length} loaded)`
                        : `${allSearchResults.length} ${allSearchResults.length === 1 ? 'award' : 'awards'} found`
                    }
                    sx={{
                      backgroundColor: !isFiltered && hasMore && lastEvaluatedKey ? '#3b82f6' : '#475569',
                      color: '#fff',
                      cursor: !isFiltered && hasMore && lastEvaluatedKey ? 'pointer' : 'default',
                      '&:hover': !isFiltered && hasMore && lastEvaluatedKey
                        ? { backgroundColor: '#2563eb' }
                        : {},
                    }}
                    onClick={() => {
                      if (!isFiltered && hasMore && lastEvaluatedKey && !isLoadingMore) {
                        handleLoadMore();
                      }
                    }}
                  />
                )}
              </Box>
            </Box>
          </Box>

          {/* Search Form */}
          <Collapse in={searchFormExpanded}>
            <Box sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ color: '#e2e8f0' }}>
                  Search Filters
                </Typography>
                <IconButton
                  onClick={() => setSearchFormExpanded(!searchFormExpanded)}
                  sx={{ color: '#94a3b8' }}
                >
                  {searchFormExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                </IconButton>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 2 }}>
                {/* Keywords */}
                <MultiSelectField<string>
                  label="Keywords"
                  selectedItems={searchParams.keywords || []}
                  onItemsChange={(keywords) => {
                    setSearchParams((prev) => ({ ...prev, keywords }));
                  }}
                  suggestions={[]}
                  onSearch={() => []}
                  renderItem={(keyword) => keyword}
                  placeholder="Enter keywords to search..."
                />

                {/* Award Type */}
                <MultiSelectField<string>
                  label="Award Type"
                  selectedItems={searchParams.award_type || []}
                  onItemsChange={(awardTypes) => {
                    setSearchParams((prev) => ({ ...prev, award_type: awardTypes }));
                  }}
                  suggestions={AWARD_TYPES}
                  renderItem={(type) => type}
                  placeholder="Select award types..."
                />

                {/* Awarding Agency */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.awarding_agency || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.name || option.text || option.code || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('awarding_agency', value);
                    }
                  }}
                  value={searchParams.awarding_agency_code || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      awarding_agency_code: newValue.map((v) =>
                        typeof v === 'string' ? v : v.code || v.id || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Awarding Agency"
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
                  )}
                />

                {/* Funding Agency */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.funding_agency || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.name || option.text || option.code || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('funding_agency', value);
                    }
                  }}
                  value={searchParams.funding_agency_code || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      funding_agency_code: newValue.map((v) =>
                        typeof v === 'string' ? v : v.code || v.id || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Funding Agency"
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
                  )}
                />

                {/* Recipient */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.recipient || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.name || option.text || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('recipient', value);
                    }
                  }}
                  value={searchParams.recipient_name || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      recipient_name: newValue.map((v) =>
                        typeof v === 'string' ? v : v.name || v.text || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Recipient"
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
                  )}
                />

                {/* State */}
                <MultiSelectField<string>
                  label="Recipient State"
                  selectedItems={searchParams.recipient_location_state || []}
                  onItemsChange={(states) => {
                    setSearchParams((prev) => ({ ...prev, recipient_location_state: states }));
                  }}
                  suggestions={US_STATES}
                  renderItem={(state) => state}
                  placeholder="Select states..."
                />

                {/* NAICS Code */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.naics || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.code || option.name || option.text || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('naics', value);
                    }
                  }}
                  value={searchParams.naics_code || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      naics_code: newValue.map((v) =>
                        typeof v === 'string' ? v : v.code || v.id || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="NAICS Code"
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
                  )}
                />

                {/* PSC Code */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.psc || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.code || option.name || option.text || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('psc', value);
                    }
                  }}
                  value={searchParams.psc_code || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      psc_code: newValue.map((v) =>
                        typeof v === 'string' ? v : v.code || v.id || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="PSC Code"
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
                  )}
                />

                {/* CFDA Number */}
                <Autocomplete
                  multiple
                  freeSolo
                  options={autocompleteOptions.cfda || []}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    return option.code || option.name || option.text || '';
                  }}
                  onInputChange={(_, value) => {
                    if (value.length >= 2) {
                      loadAutocompleteOptions('cfda', value);
                    }
                  }}
                  value={searchParams.cfda_number || []}
                  onChange={(_, newValue) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      cfda_number: newValue.map((v) =>
                        typeof v === 'string' ? v : v.code || v.id || ''
                      ),
                    }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="CFDA Number"
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
                  )}
                />

                {/* Fiscal Year */}
                <MultiSelectField<string>
                  label="Fiscal Year"
                  selectedItems={(searchParams.fiscal_year || []).map(String)}
                  onItemsChange={(fiscalYears) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      fiscal_year: fiscalYears.map(Number),
                    }));
                  }}
                  suggestions={FISCAL_YEARS.map(String)}
                  renderItem={(year) => year}
                  placeholder="Select fiscal years..."
                />

                {/* Min Obligation */}
                <TextField
                  label="Min Obligation ($)"
                  type="number"
                  value={searchParams.min_obligation || ''}
                  onChange={(e) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      min_obligation: e.target.value ? Number(e.target.value) : undefined,
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
                />

                {/* Max Obligation */}
                <TextField
                  label="Max Obligation ($)"
                  type="number"
                  value={searchParams.max_obligation || ''}
                  onChange={(e) => {
                    setSearchParams((prev) => ({
                      ...prev,
                      max_obligation: e.target.value ? Number(e.target.value) : undefined,
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
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, gap: 2 }}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setSearchParams({
                      keywords: [],
                      award_type: [],
                      awarding_agency_code: [],
                      funding_agency_code: [],
                      recipient_id: [],
                      recipient_name: [],
                      recipient_location_state: [],
                      recipient_location_country: [],
                      naics_code: [],
                      psc_code: [],
                      cfda_number: [],
                      fiscal_year: [],
                    });
                  }}
                  sx={{
                    borderColor: '#475569',
                    color: '#94a3b8',
                    '&:hover': { borderColor: '#64748b', backgroundColor: 'rgba(71, 85, 105, 0.1)' },
                  }}
                >
                  Clear
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  disabled={isSearching}
                  startIcon={isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
                  sx={{
                    backgroundColor: '#3b82f6',
                    '&:hover': { backgroundColor: '#2563eb' },
                    '&:disabled': { backgroundColor: '#475569' },
                  }}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </Button>
              </Box>
            </Box>
          </Collapse>

          {!searchFormExpanded && (
            <Box sx={{ p: 2, borderTop: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                Search form collapsed
              </Typography>
              <IconButton
                onClick={() => setSearchFormExpanded(true)}
                sx={{ color: '#94a3b8' }}
              >
                <KeyboardArrowDownIcon />
              </IconButton>
            </Box>
          )}

          {searchError && (
            <Box sx={{ p: 2 }}>
              <Alert severity="error" onClose={() => setSearchError(null)}>
                {searchError}
              </Alert>
            </Box>
          )}

          {/* Results Table */}
          {allSearchResults.length > 0 && (
            <Box sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', gap: 3 }}>
                {/* Filters Sidebar */}
                <Box sx={{ width: 250, flexShrink: 0 }}>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', mb: 2 }}>
                    Filters
                  </Typography>

                  {/* Award Types Filter */}
                  {availableFilters.award_types.size > 0 && (
                    <Accordion
                      expanded={expandedFilters.award_types}
                      onChange={() =>
                        setExpandedFilters((prev) => ({
                          ...prev,
                          award_types: !prev.award_types,
                        }))
                      }
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        mb: 1,
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#94a3b8' }} />}>
                        <Typography sx={{ color: '#e2e8f0' }}>Award Types</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 300, overflowY: 'auto' }}>
                          {Array.from(availableFilters.award_types).map((type) => {
                            const count = allSearchResults.filter((a) => a.award_type === type).length;
                            return (
                              <Box
                                key={type}
                                onClick={() => {
                                  setSelectedFilters((prev) => {
                                    const newSet = new Set(prev.award_types);
                                    if (newSet.has(type)) {
                                      newSet.delete(type);
                                    } else {
                                      newSet.add(type);
                                    }
                                    return { ...prev, award_types: newSet };
                                  });
                                }}
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  p: 1,
                                  cursor: 'pointer',
                                  borderRadius: 1,
                                  backgroundColor: selectedFilters.award_types.has(type)
                                    ? 'rgba(59, 130, 246, 0.2)'
                                    : 'transparent',
                                  '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                }}
                              >
                                <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                  {type}
                                </Typography>
                                <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                              </Box>
                            );
                          })}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Agencies Filter */}
                  {availableFilters.agencies.size > 0 && (
                    <Accordion
                      expanded={expandedFilters.agencies}
                      onChange={() =>
                        setExpandedFilters((prev) => ({
                          ...prev,
                          agencies: !prev.agencies,
                        }))
                      }
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        mb: 1,
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#94a3b8' }} />}>
                        <Typography sx={{ color: '#e2e8f0' }}>Agencies</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 300, overflowY: 'auto' }}>
                          {Array.from(availableFilters.agencies).slice(0, 50).map((agency) => {
                            const count = allSearchResults.filter(
                              (a) => a.awarding_agency_name === agency || a.funding_agency_name === agency
                            ).length;
                            return (
                              <Box
                                key={agency}
                                onClick={() => {
                                  setSelectedFilters((prev) => {
                                    const newSet = new Set(prev.agencies);
                                    if (newSet.has(agency)) {
                                      newSet.delete(agency);
                                    } else {
                                      newSet.add(agency);
                                    }
                                    return { ...prev, agencies: newSet };
                                  });
                                }}
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  p: 1,
                                  cursor: 'pointer',
                                  borderRadius: 1,
                                  backgroundColor: selectedFilters.agencies.has(agency)
                                    ? 'rgba(59, 130, 246, 0.2)'
                                    : 'transparent',
                                  '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                }}
                              >
                                <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                  {agency}
                                </Typography>
                                <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                              </Box>
                            );
                          })}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Recipients Filter */}
                  {availableFilters.recipients.size > 0 && (
                    <Accordion
                      expanded={expandedFilters.recipients}
                      onChange={() =>
                        setExpandedFilters((prev) => ({
                          ...prev,
                          recipients: !prev.recipients,
                        }))
                      }
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        mb: 1,
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#94a3b8' }} />}>
                        <Typography sx={{ color: '#e2e8f0' }}>Recipients</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 300, overflowY: 'auto' }}>
                          {Array.from(availableFilters.recipients).slice(0, 50).map((recipient) => {
                            const count = allSearchResults.filter((a) => a.recipient_name === recipient).length;
                            return (
                              <Box
                                key={recipient}
                                onClick={() => {
                                  setSelectedFilters((prev) => {
                                    const newSet = new Set(prev.recipients);
                                    if (newSet.has(recipient)) {
                                      newSet.delete(recipient);
                                    } else {
                                      newSet.add(recipient);
                                    }
                                    return { ...prev, recipients: newSet };
                                  });
                                }}
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  p: 1,
                                  cursor: 'pointer',
                                  borderRadius: 1,
                                  backgroundColor: selectedFilters.recipients.has(recipient)
                                    ? 'rgba(59, 130, 246, 0.2)'
                                    : 'transparent',
                                  '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                }}
                              >
                                <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                  {recipient}
                                </Typography>
                                <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                              </Box>
                            );
                          })}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Locations Filter */}
                  {(availableFilters.states.size > 0 || availableFilters.countries.size > 0) && (
                    <Accordion
                      expanded={expandedFilters.locations}
                      onChange={() =>
                        setExpandedFilters((prev) => ({
                          ...prev,
                          locations: !prev.locations,
                        }))
                      }
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        mb: 1,
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#94a3b8' }} />}>
                        <Typography sx={{ color: '#e2e8f0' }}>Locations</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {availableFilters.states.size > 0 && (
                            <Box>
                              <Typography sx={{ color: '#94a3b8', fontSize: '0.875rem', mb: 1 }}>
                                States
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
                                {Array.from(availableFilters.states).map((state) => {
                                  const count = allSearchResults.filter((a) => a.recipient_location_state === state).length;
                                  return (
                                    <Box
                                      key={state}
                                      onClick={() => {
                                        setSelectedFilters((prev) => {
                                          const newSet = new Set(prev.states);
                                          if (newSet.has(state)) {
                                            newSet.delete(state);
                                          } else {
                                            newSet.add(state);
                                          }
                                          return { ...prev, states: newSet };
                                        });
                                      }}
                                      sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        p: 1,
                                        cursor: 'pointer',
                                        borderRadius: 1,
                                        backgroundColor: selectedFilters.states.has(state)
                                          ? 'rgba(59, 130, 246, 0.2)'
                                          : 'transparent',
                                        '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                      }}
                                    >
                                      <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                        {state}
                                      </Typography>
                                      <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Codes Filter */}
                  {(availableFilters.naics.size > 0 || availableFilters.psc.size > 0 || availableFilters.cfda.size > 0) && (
                    <Accordion
                      expanded={expandedFilters.codes}
                      onChange={() =>
                        setExpandedFilters((prev) => ({
                          ...prev,
                          codes: !prev.codes,
                        }))
                      }
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        mb: 1,
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#94a3b8' }} />}>
                        <Typography sx={{ color: '#e2e8f0' }}>Codes</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {availableFilters.naics.size > 0 && (
                            <Box>
                              <Typography sx={{ color: '#94a3b8', fontSize: '0.875rem', mb: 1 }}>
                                NAICS
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
                                {Array.from(availableFilters.naics).slice(0, 30).map((code) => {
                                  const count = allSearchResults.filter((a) => a.naics_code === code).length;
                                  return (
                                    <Box
                                      key={code}
                                      onClick={() => {
                                        setSelectedFilters((prev) => {
                                          const newSet = new Set(prev.naics);
                                          if (newSet.has(code)) {
                                            newSet.delete(code);
                                          } else {
                                            newSet.add(code);
                                          }
                                          return { ...prev, naics: newSet };
                                        });
                                      }}
                                      sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        p: 1,
                                        cursor: 'pointer',
                                        borderRadius: 1,
                                        backgroundColor: selectedFilters.naics.has(code)
                                          ? 'rgba(59, 130, 246, 0.2)'
                                          : 'transparent',
                                        '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                      }}
                                    >
                                      <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                        {code}
                                      </Typography>
                                      <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                          )}
                          {availableFilters.psc.size > 0 && (
                            <Box>
                              <Typography sx={{ color: '#94a3b8', fontSize: '0.875rem', mb: 1 }}>
                                PSC
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
                                {Array.from(availableFilters.psc).slice(0, 30).map((code) => {
                                  const count = allSearchResults.filter((a) => a.psc_code === code).length;
                                  return (
                                    <Box
                                      key={code}
                                      onClick={() => {
                                        setSelectedFilters((prev) => {
                                          const newSet = new Set(prev.psc);
                                          if (newSet.has(code)) {
                                            newSet.delete(code);
                                          } else {
                                            newSet.add(code);
                                          }
                                          return { ...prev, psc: newSet };
                                        });
                                      }}
                                      sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        p: 1,
                                        cursor: 'pointer',
                                        borderRadius: 1,
                                        backgroundColor: selectedFilters.psc.has(code)
                                          ? 'rgba(59, 130, 246, 0.2)'
                                          : 'transparent',
                                        '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                      }}
                                    >
                                      <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                        {code}
                                      </Typography>
                                      <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                          )}
                          {availableFilters.cfda.size > 0 && (
                            <Box>
                              <Typography sx={{ color: '#94a3b8', fontSize: '0.875rem', mb: 1 }}>
                                CFDA
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
                                {Array.from(availableFilters.cfda).slice(0, 30).map((code) => {
                                  const count = allSearchResults.filter((a) => a.cfda_number === code).length;
                                  return (
                                    <Box
                                      key={code}
                                      onClick={() => {
                                        setSelectedFilters((prev) => {
                                          const newSet = new Set(prev.cfda);
                                          if (newSet.has(code)) {
                                            newSet.delete(code);
                                          } else {
                                            newSet.add(code);
                                          }
                                          return { ...prev, cfda: newSet };
                                        });
                                      }}
                                      sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        p: 1,
                                        cursor: 'pointer',
                                        borderRadius: 1,
                                        backgroundColor: selectedFilters.cfda.has(code)
                                          ? 'rgba(59, 130, 246, 0.2)'
                                          : 'transparent',
                                        '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.3)' },
                                      }}
                                    >
                                      <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                                        {code}
                                      </Typography>
                                      <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.75rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Box>

                {/* Results Table */}
                <Box sx={{ flex: 1 }}>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>
                            <Checkbox
                              checked={selectedAwards.size === paginatedResults.length && paginatedResults.length > 0}
                              indeterminate={
                                selectedAwards.size > 0 && selectedAwards.size < paginatedResults.length
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedAwards(new Set(paginatedResults.map((a) => a.award_id)));
                                } else {
                                  setSelectedAwards(new Set());
                                }
                              }}
                              sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                            />
                          </TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Award ID</TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Type</TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Recipient</TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Agency</TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Amount</TableCell>
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Date</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paginatedResults.map((award) => (
                          <TableRow key={award.award_id} sx={{ '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.05)' } }}>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              <Checkbox
                                checked={selectedAwards.has(award.award_id)}
                                onChange={(e) => {
                                  const newSet = new Set(selectedAwards);
                                  if (e.target.checked) {
                                    newSet.add(award.award_id);
                                  } else {
                                    newSet.delete(award.award_id);
                                  }
                                  setSelectedAwards(newSet);
                                }}
                                sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                              />
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {award.award_id}
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {award.award_type || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {award.recipient_name || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {award.awarding_agency_name || award.funding_agency_name || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {formatCurrency(award.total_obligation)}
                            </TableCell>
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              {formatDate(award.period_start_date)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                      <Typography sx={{ color: '#94a3b8' }}>
                        Showing {startIndex + 1}-{Math.min(endIndex, currentResults.length)} of {currentResults.length} results
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

                  {/* Load More Button */}
                  {!isFiltered && hasMore && lastEvaluatedKey && allSearchResults.length > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                      <Button
                        variant="contained"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        sx={{
                          backgroundColor: '#3b82f6',
                          '&:hover': { backgroundColor: '#2563eb' },
                          '&:disabled': { backgroundColor: '#475569' },
                        }}
                      >
                        {isLoadingMore ? (
                          <>
                            <CircularProgress size={20} sx={{ mr: 1 }} />
                            Loading...
                          </>
                        ) : (
                          `Load More (${allSearchResults.length} loaded)`
                        )}
                      </Button>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}
        </GlassCard>
      </Container>
    </Box>
  );
};

export default GovtContractsSearchPage;

