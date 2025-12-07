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
  Pagination,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Chat as SidebarChatIcon,
  AddComment as NewChatIcon,
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
import { addAwardToContext, addMultipleAwardsToContext } from '../components/tiles/common';

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

interface ExpandedFiltersState {
  awardTypes: boolean;
  agencies: boolean;
  recipients: boolean;
  states: boolean;
  countries: boolean;
  codes: boolean;
}

const GovtContractsSearchPage: React.FC = () => {
  const {} = useAuth();
  const {} = useGlobalChat();
  
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
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<{ mouseX: number; mouseY: number } | null>(null);
  
  // Filter state
  const [availableFilters, setAvailableFilters] = useState<{
    award_type_filters?: Array<{ awardType: string; count: number }>;
    agency_filters?: Array<{ agency: string; count: number }>;
    recipient_filters?: Array<{ recipient: string; count: number }>;
    state_filters?: Array<{ state: string; count: number }>;
    country_filters?: Array<{ country: string; count: number }>;
    naics_filters?: Array<{ naics: string; count: number }>;
    psc_filters?: Array<{ psc: string; count: number }>;
    cfda_filters?: Array<{ cfda: string; count: number }>;
  }>({});
  
  const [expandedFilters, setExpandedFilters] = useState<ExpandedFiltersState>(
    savedState?.expandedFilters || {
      awardTypes: false,
      agencies: false,
      recipients: false,
      states: false,
      countries: false,
      codes: false,
    }
  );
  
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
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 25);
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== false);
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== false);

  // Autocomplete state
  const [autocompleteOptions, setAutocompleteOptions] = useState<{
    [key: string]: Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>;
  }>({});

  // Compute available filters from results
  const computeFiltersFromResults = useCallback((results: GovtContractAward[]) => {
    const awardTypeMap = new Map<string, number>();
    const agencyMap = new Map<string, number>();
    const recipientMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    const naicsMap = new Map<string, number>();
    const pscMap = new Map<string, number>();
    const cfdaMap = new Map<string, number>();

    results.forEach((award) => {
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

    setAvailableFilters({
      award_type_filters: Array.from(awardTypeMap.entries())
        .map(([awardType, count]) => ({ awardType, count }))
        .sort((a, b) => b.count - a.count),
      agency_filters: Array.from(agencyMap.entries())
        .map(([agency, count]) => ({ agency, count }))
        .sort((a, b) => b.count - a.count),
      recipient_filters: Array.from(recipientMap.entries())
        .map(([recipient, count]) => ({ recipient, count }))
        .sort((a, b) => b.count - a.count),
      state_filters: Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      country_filters: Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count),
      naics_filters: Array.from(naicsMap.entries())
        .map(([naics, count]) => ({ naics, count }))
        .sort((a, b) => b.count - a.count),
      psc_filters: Array.from(pscMap.entries())
        .map(([psc, count]) => ({ psc, count }))
        .sort((a, b) => b.count - a.count),
      cfda_filters: Array.from(cfdaMap.entries())
        .map(([cfda, count]) => ({ cfda, count }))
        .sort((a, b) => b.count - a.count),
    });
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

  // Load autocomplete options for MultiSelectField (synchronous wrapper)
  const createAutocompleteSearch = useCallback((type: string) => {
    return (query: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
      if (!query || query.length < 2) {
        return [];
      }

      // Trigger async fetch and update state
      (async () => {
        try {
          const response = await govtContractsAutocompleteAPI.autocomplete({
            autocomplete_type: type,
            search_text: query,
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
      })();

      // Return cached results immediately (will update on next render)
      return autocompleteOptions[type] || [];
    };
  }, [autocompleteOptions]);

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
      advancedSearchExpanded,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [searchParams, allSearchResults, lastEvaluatedKey, hasMore, currentPage, pageSize, searchFormExpanded, advancedSearchExpanded]);

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

  // Context menu handlers (for future use)
  // const handleContextMenuClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
  //   event.preventDefault();
  //   setContextMenuAnchor({ mouseX: event.clientX, mouseY: event.clientY });
  // }, []);

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

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Main Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
              <Typography
                variant="h4"
                sx={{
                  color: '#ffffff',
                  fontWeight: 700,
                  mb: 1,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Government Contracts Search
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: '#9ca3af',
                  fontSize: '1rem',
                }}
              >
                Search government contracts with advanced filters
              </Typography>
            </Box>

        {/* Search Form */}
        <GlassCard sx={{ mb: 4 }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: searchFormExpanded ? '1px solid rgba(55, 65, 81, 0.5)' : 'none' }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 'bold' }}>
              Search Parameters
            </Typography>
            <IconButton
              onClick={() => setSearchFormExpanded(!searchFormExpanded)}
              sx={{ color: '#9ca3af' }}
              size="small"
            >
              {searchFormExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </Box>
          <Collapse in={searchFormExpanded}>
            <Box sx={{ p: 4 }}>

              {/* Basic Search Section */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ color: '#e2e8f0', mb: 2 }}>
                  Basic Search
                </Typography>
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

                  {/* Awarding Agency */}
                  <MultiSelectField<{ code?: string; name?: string; id?: string; text?: string; [key: string]: any }>
                    label="Awarding Agency"
                    selectedItems={(() => {
                      // Convert codes back to objects for display
                      const codes = searchParams.awarding_agency_code || [];
                      return codes.map(code => {
                        // Try to find in autocomplete options first
                        const found = autocompleteOptions.awarding_agency?.find(opt => 
                          opt.code === code || opt.id === code
                        );
                        return found || { code: code || '', name: code || '' };
                      });
                    })()}
                    onItemsChange={(items) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        awarding_agency_code: items.map(item => 
                          typeof item === 'string' ? item : item.code || item.id || ''
                        ),
                      }));
                    }}
                    suggestions={[]}
                    onSearch={createAutocompleteSearch('awarding_agency')}
                    renderItem={(item) => {
                      if (typeof item === 'string') return item;
                      // Return name for display (chips will show name)
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
                      const codes = searchParams.funding_agency_code || [];
                      return codes.map(code => {
                        const found = autocompleteOptions.funding_agency?.find(opt => 
                          opt.code === code || opt.id === code
                        );
                        return found || { code: code || '', name: code || '' };
                      });
                    })()}
                    onItemsChange={(items) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        funding_agency_code: items.map(item => 
                          typeof item === 'string' ? item : item.code || item.id || ''
                        ),
                      }));
                    }}
                    suggestions={[]}
                    onSearch={createAutocompleteSearch('funding_agency')}
                    renderItem={(item) => {
                      if (typeof item === 'string') return item;
                      // Return name for display (chips will show name)
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
                      const names = searchParams.recipient_name || [];
                      return names.map(name => {
                        const found = autocompleteOptions.recipient?.find(opt => 
                          opt.name === name || opt.text === name
                        );
                        if (found) return found;
                        const nameStr = typeof name === 'string' ? name : (name as any)?.name || (name as any)?.text || '';
                        return { name: nameStr, text: nameStr };
                      });
                    })()}
                    onItemsChange={(items) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        recipient_name: items.map(item => 
                          typeof item === 'string' ? item : item.name || item.text || ''
                        ),
                      }));
                    }}
                    suggestions={[]}
                    onSearch={createAutocompleteSearch('recipient')}
                    renderItem={(item) => {
                      if (typeof item === 'string') return item;
                      // Return name for display (chips will show name)
                      return item.name || item.text || '';
                    }}
                    getItemKey={(item) => {
                      if (typeof item === 'string') return item;
                      return item.id || item.name || item.text || '';
                    }}
                    placeholder="Search for recipients..."
                    allowCustomInput={false}
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
              </Box>

              {/* Advanced Search Section */}
              <Box sx={{ mt: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ color: '#e2e8f0' }}>
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
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 2 }}>
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

                  {/* NAICS Code - Direct search, no autocomplete */}
                  <MultiSelectField<string>
                    label="NAICS Code"
                    selectedItems={searchParams.naics_code || []}
                    onItemsChange={(codes) => {
                      setSearchParams((prev) => ({ ...prev, naics_code: codes }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(code) => code}
                    placeholder="Enter NAICS codes..."
                  />

                  {/* PSC Code - Direct search, no autocomplete */}
                  <MultiSelectField<string>
                    label="PSC Code"
                    selectedItems={searchParams.psc_code || []}
                    onItemsChange={(codes) => {
                      setSearchParams((prev) => ({ ...prev, psc_code: codes }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(code) => code}
                    placeholder="Enter PSC codes..."
                  />

                  {/* CFDA Number - Direct search, no autocomplete */}
                  <MultiSelectField<string>
                    label="CFDA Number"
                    selectedItems={searchParams.cfda_number || []}
                    onItemsChange={(numbers) => {
                      setSearchParams((prev) => ({ ...prev, cfda_number: numbers }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(number) => number}
                    placeholder="Enter CFDA numbers..."
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
                  </Box>
                </Collapse>
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
        </GlassCard>
      
        {/* Error Alert */}
        {searchError && (
          <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
            {searchError}
          </Alert>
        )}
        
        {/* Results */}
        {allSearchResults.length > 0 && (
          <Box sx={{ display: 'flex', gap: 3 }}>
            {/* Sidebar Filters */}
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
                Award counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.award_types.size > 0 ||
                selectedFilters.agencies.size > 0 ||
                selectedFilters.recipients.size > 0 ||
                selectedFilters.states.size > 0 ||
                selectedFilters.countries.size > 0 ||
                selectedFilters.naics.size > 0 ||
                selectedFilters.psc.size > 0 ||
                selectedFilters.cfda.size > 0) && (
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
                    {Array.from(selectedFilters.award_types).map((type, idx) => (
                      <Chip
                        key={`award-type-${idx}`}
                        label={type}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.award_types);
                            newSet.delete(type);
                            const hasAnyFilters = 
                              newSet.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, award_types: newSet };
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
                    {Array.from(selectedFilters.agencies).map((agency, idx) => (
                      <Chip
                        key={`agency-${idx}`}
                        label={agency}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.agencies);
                            newSet.delete(agency);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              newSet.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, agencies: newSet };
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
                    {Array.from(selectedFilters.recipients).map((recipient, idx) => (
                      <Chip
                        key={`recipient-${idx}`}
                        label={recipient}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.recipients);
                            newSet.delete(recipient);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              newSet.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, recipients: newSet };
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
                    {Array.from(selectedFilters.states).map((state, idx) => (
                      <Chip
                        key={`state-${idx}`}
                        label={state}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.states);
                            newSet.delete(state);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              newSet.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, states: newSet };
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
                    {Array.from(selectedFilters.countries).map((country, idx) => (
                      <Chip
                        key={`country-${idx}`}
                        label={country}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.countries);
                            newSet.delete(country);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              newSet.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, countries: newSet };
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
                    {Array.from(selectedFilters.naics).map((code, idx) => (
                      <Chip
                        key={`naics-${idx}`}
                        label={code}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.naics);
                            newSet.delete(code);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              newSet.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, naics: newSet };
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
                    {Array.from(selectedFilters.psc).map((code, idx) => (
                      <Chip
                        key={`psc-${idx}`}
                        label={code}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.psc);
                            newSet.delete(code);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              newSet.size > 0 ||
                              prev.cfda.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, psc: newSet };
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
                    {Array.from(selectedFilters.cfda).map((code, idx) => (
                      <Chip
                        key={`cfda-${idx}`}
                        label={code}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.cfda);
                            newSet.delete(code);
                            const hasAnyFilters = 
                              prev.award_types.size > 0 ||
                              prev.agencies.size > 0 ||
                              prev.recipients.size > 0 ||
                              prev.states.size > 0 ||
                              prev.countries.size > 0 ||
                              prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              newSet.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, cfda: newSet };
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
                        award_types: new Set(),
                        agencies: new Set(),
                        recipients: new Set(),
                        states: new Set(),
                        countries: new Set(),
                        naics: new Set(),
                        psc: new Set(),
                        cfda: new Set(),
                      });
                      setIsFiltered(false);
                    }}
                    sx={{
                      color: '#93c5fd',
                      fontSize: '0.75rem',
                      textTransform: 'none',
                      mt: 1,
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    Clear All Filters
                  </Button>
                </Box>
              )}

                  {/* Award Types Filter */}
                  {availableFilters.award_type_filters && availableFilters.award_type_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, awardTypes: !prev.awardTypes }))}
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
                          Award Types
                        </Typography>
                        {expandedFilters.awardTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.awardTypes}>
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
                          {availableFilters.award_type_filters.map((filter: { awardType: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.award_types.has(filter.awardType);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.award_types.has(filter.awardType);
                                    if (exists) {
                                      const newSet = new Set(prev.award_types);
                                      newSet.delete(filter.awardType);
                                      return { ...prev, award_types: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        award_types: new Set([...prev.award_types, filter.awardType]),
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
                                  {filter.awardType}
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

                  {/* Agencies Filter */}
                  {availableFilters.agency_filters && availableFilters.agency_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, agencies: !prev.agencies }))}
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
                          Agencies
                        </Typography>
                        {expandedFilters.agencies ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.agencies}>
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
                          {availableFilters.agency_filters?.slice(0, 50).map((filter: { agency: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.agencies.has(filter.agency);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.agencies.has(filter.agency);
                                    if (exists) {
                                      const newSet = new Set(prev.agencies);
                                      newSet.delete(filter.agency);
                                      return { ...prev, agencies: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        agencies: new Set([...prev.agencies, filter.agency]),
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
                                  {filter.agency}
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

                  {/* Recipients Filter */}
                  {availableFilters.recipient_filters && availableFilters.recipient_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, recipients: !prev.recipients }))}
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
                          Recipients
                        </Typography>
                        {expandedFilters.recipients ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.recipients}>
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
                          {availableFilters.recipient_filters?.slice(0, 50).map((filter: { recipient: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.recipients.has(filter.recipient);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.recipients.has(filter.recipient);
                                    if (exists) {
                                      const newSet = new Set(prev.recipients);
                                      newSet.delete(filter.recipient);
                                      return { ...prev, recipients: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        recipients: new Set([...prev.recipients, filter.recipient]),
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
                                  {filter.recipient}
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
                          {availableFilters.state_filters?.map((filter: { state: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.states.has(filter.state);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.states.has(filter.state);
                                    if (exists) {
                                      const newSet = new Set(prev.states);
                                      newSet.delete(filter.state);
                                      return { ...prev, states: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        states: new Set([...prev.states, filter.state]),
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

                  {/* Countries Filter */}
                  {availableFilters.country_filters && availableFilters.country_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, countries: !prev.countries }))}
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
                          Countries
                        </Typography>
                        {expandedFilters.countries ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.countries}>
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
                          {availableFilters.country_filters?.map((filter: { country: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.countries.has(filter.country);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.countries.has(filter.country);
                                    if (exists) {
                                      const newSet = new Set(prev.countries);
                                      newSet.delete(filter.country);
                                      return { ...prev, countries: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        countries: new Set([...prev.countries, filter.country]),
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
                                  {filter.country}
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

                  {/* NAICS Filter */}
                  {availableFilters.naics_filters && availableFilters.naics_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, codes: !prev.codes }))}
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
                          NAICS Codes
                        </Typography>
                        {expandedFilters.codes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.codes}>
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
                          {availableFilters.naics_filters?.slice(0, 30).map((filter: { naics: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.naics.has(filter.naics);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.naics.has(filter.naics);
                                    if (exists) {
                                      const newSet = new Set(prev.naics);
                                      newSet.delete(filter.naics);
                                      return { ...prev, naics: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        naics: new Set([...prev.naics, filter.naics]),
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
                                  {filter.naics}
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

                  {/* PSC Filter */}
                  {availableFilters.psc_filters && availableFilters.psc_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, codes: !prev.codes }))}
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
                          PSC Codes
                        </Typography>
                        {expandedFilters.codes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.codes}>
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
                          {availableFilters.psc_filters?.slice(0, 30).map((filter: { psc: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.psc.has(filter.psc);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.psc.has(filter.psc);
                                    if (exists) {
                                      const newSet = new Set(prev.psc);
                                      newSet.delete(filter.psc);
                                      return { ...prev, psc: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        psc: new Set([...prev.psc, filter.psc]),
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
                                  {filter.psc}
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

                  {/* CFDA Filter */}
                  {availableFilters.cfda_filters && availableFilters.cfda_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, codes: !prev.codes }))}
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
                          CFDA Numbers
                        </Typography>
                        {expandedFilters.codes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.codes}>
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
                          {availableFilters.cfda_filters?.slice(0, 30).map((filter: { cfda: string; count: number }, idx: number) => {
                            const isSelected = selectedFilters.cfda.has(filter.cfda);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.cfda.has(filter.cfda);
                                    if (exists) {
                                      const newSet = new Set(prev.cfda);
                                      newSet.delete(filter.cfda);
                                      return { ...prev, cfda: newSet };
                                    } else {
                                      return {
                                        ...prev,
                                        cfda: new Set([...prev.cfda, filter.cfda]),
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
                                  {filter.cfda}
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

            {/* Results Table */}
            <GlassCard sx={{ flex: 1 }}>
              <Box sx={{ p: 3 }}>
                {/* Results Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                    Results
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    {currentResults.length > 0 ? (
                      <Chip
                        label={`${currentResults.length} award${currentResults.length !== 1 ? 's' : ''} found`}
                        sx={{
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          border: '1px solid #22c55e',
                          fontWeight: 600,
                        }}
                      />
                    ) : isFiltered && allSearchResults.length > 0 ? (
                      <Chip
                        label={`0 of ${allSearchResults.length} awards match filters`}
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : allSearchResults.length === 0 && !isSearching ? (
                      <Chip
                        label="No awards found"
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : null}
                    {currentResults.length > 0 && (
                      <FormControl size="small" sx={{ minWidth: 120 }}>
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
                                  '&:hover': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                  },
                                  '&.Mui-selected': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    '&:hover': {
                                      backgroundColor: 'rgba(59, 130, 246, 0.3)',
                                    },
                                  },
                                },
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
            </GlassCard>
          </Box>
        )}
          </Box>
        </Box>
      </Container>

      {/* Context Menu */}
      <Menu
        open={contextMenuAnchor !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenuAnchor !== null
            ? { top: contextMenuAnchor.mouseY, left: contextMenuAnchor.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={() => handleAddToContext('new')}>
          <NewChatIcon sx={{ mr: 1 }} />
          Add to New Chat
        </MenuItem>
        <MenuItem onClick={() => handleAddToContext('sidebar')}>
          <SidebarChatIcon sx={{ mr: 1 }} />
          Add to Current Chat
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default GovtContractsSearchPage;

