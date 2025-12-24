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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
  Warning as WarningIcon,
  InfoOutlined as InfoIcon,
  Refresh as RefreshIcon,
  ArrowBack as ArrowBackIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { 
  govtContractsSearchAPI, 
  govtContractsAutocompleteAPI,
  govtContractsEnrichmentAPI,
  GovtContractsSearchFilters,
  GovtContractAward 
} from '../services/api';
import { filesystemAPI } from '../services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import MultiSelectField from '../components/MultiSelectField';
import { addAwardToContext, addMultipleAwardsToContext } from '../components/tiles/common';
import FileBrowserDialog from '../components/common/FileBrowserDialog';

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

interface ExpandedFiltersState {
  awardTypes: boolean;
  agencies: boolean;
  recipients: boolean;
  states: boolean;
  countries: boolean;
  codes: boolean;
}

const GovtContractsSearchPage: React.FC = () => {
  const { user } = useAuth();
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
      awarding_agency_name: Array.isArray(saved?.awarding_agency_name) ? saved.awarding_agency_name : [],
      funding_agency_name: Array.isArray(saved?.funding_agency_name) ? saved.funding_agency_name : [],
      recipient_id: Array.isArray(saved?.recipient_id) ? saved.recipient_id : [],
      recipient_name: Array.isArray(saved?.recipient_name) ? saved.recipient_name : [],
      recipient_location_state: Array.isArray(saved?.recipient_location_state) ? saved.recipient_location_state : [],
      recipient_location_country: Array.isArray(saved?.recipient_location_country) ? saved.recipient_location_country : [],
      naics_code: Array.isArray(saved?.naics_code) ? saved.naics_code : [],
      psc_code: Array.isArray(saved?.psc_code) ? saved.psc_code : [],
      cfda_number: Array.isArray(saved?.cfda_number) ? saved.cfda_number : [],
      date_from: saved?.date_from || '',
      date_to: saved?.date_to || '',
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
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [selectedAwardForDetails, setSelectedAwardForDetails] = useState<GovtContractAward | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  const [parentAwardForDetails, setParentAwardForDetails] = useState<GovtContractAward | null>(null);  // Store parent when viewing child
  const [enrichmentLoading, setEnrichmentLoading] = useState<boolean>(false);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [enrichmentSuccess, setEnrichmentSuccess] = useState<string | null>(null);
  
  // Column visibility state
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
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    savedState?.visibleColumns || DEFAULT_VISIBLE_COLUMNS
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const columnMenuOpen = Boolean(columnMenuAnchor);
  
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

  // Autocomplete state - use state for suggestions (like SECSearchPage)
  const [recipientSuggestions, setRecipientSuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const [awardingAgencySuggestions, setAwardingAgencySuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const [fundingAgencySuggestions, setFundingAgencySuggestions] = useState<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  
  // Loading state for autocomplete searches
  const [recipientLoading, setRecipientLoading] = useState<boolean>(false);
  const [awardingAgencyLoading, setAwardingAgencyLoading] = useState<boolean>(false);
  const [fundingAgencyLoading, setFundingAgencyLoading] = useState<boolean>(false);
  
  // Refs to track current suggestions for callbacks (avoid stale closures)
  const recipientSuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const awardingAgencySuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  const fundingAgencySuggestionsRef = useRef<Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }>>([]);
  
  // Track the most recent search timestamp for race condition handling (like SECSearchPage)
  const latestRecipientSearchRef = useRef<number>(0);
  const latestAwardingAgencySearchRef = useRef<number>(0);
  const latestFundingAgencySearchRef = useRef<number>(0);
  
  // Track last query to detect query changes and clear stale suggestions
  const lastRecipientQueryRef = useRef<string>('');
  const lastAwardingAgencyQueryRef = useRef<string>('');
  const lastFundingAgencyQueryRef = useRef<string>('');
  
  // Helper function to find option by name across all suggestion sources
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

  // Transform API response to match expected format
  const transformAutocompleteResults = useCallback((results: any[], type: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    return results.map((item: any) => {
      // Map recipient_name to name and text
      if (type === 'recipient' && item.recipient_name) {
        return {
          ...item,
          name: item.recipient_name,
          text: item.recipient_name,
          id: item.uei || item.duns || item.recipient_name,
        };
      }
      // For other types, preserve existing structure
      return item;
    });
  }, []);

  // Memoized search functions for each type with race condition protection (like SECSearchPage)
  const recipientSearch = useCallback((query: string): Array<{ id?: string; code?: string; name?: string; text?: string; [key: string]: any }> => {
    if (!query || query.length < 2) {
      setRecipientSuggestions([]);
      recipientSuggestionsRef.current = [];
      lastRecipientQueryRef.current = '';
      setRecipientLoading(false);
      return [];
    }

    // Clear suggestions immediately if query changed (prevents showing stale results)
    // This includes both continuations (xxx -> xxxy) and new words
    if (lastRecipientQueryRef.current !== query) {
      setRecipientSuggestions([]);
      recipientSuggestionsRef.current = [];
    }

    // Track the most recent search timestamp for race condition handling
    const searchTimestamp = Date.now();
    latestRecipientSearchRef.current = searchTimestamp;
    lastRecipientQueryRef.current = query;

    // Set loading state
    setRecipientLoading(true);

    // Trigger async search in background
    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'recipient',
          search_text: query,
          limit: 10,
        });

        // Only update suggestions if this is still the most recent search
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
        // Clear loading state only if this is still the most recent search
        if (latestRecipientSearchRef.current === searchTimestamp) {
          setRecipientLoading(false);
        }
      }
    })();

    // Return empty array to prevent showing stale results while new search is in progress
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

    // Clear suggestions immediately if query changed (prevents showing stale results)
    // This includes both continuations (xxx -> xxxy) and new words
    if (lastAwardingAgencyQueryRef.current !== query) {
      setAwardingAgencySuggestions([]);
      awardingAgencySuggestionsRef.current = [];
    }

    // Track the most recent search timestamp for race condition handling
    const searchTimestamp = Date.now();
    latestAwardingAgencySearchRef.current = searchTimestamp;
    lastAwardingAgencyQueryRef.current = query;

    // Set loading state
    setAwardingAgencyLoading(true);

    // Trigger async search in background
    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'awarding_agency',
          search_text: query,
          limit: 10,
        });

        // Only update suggestions if this is still the most recent search
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
        // Clear loading state only if this is still the most recent search
        if (latestAwardingAgencySearchRef.current === searchTimestamp) {
          setAwardingAgencyLoading(false);
        }
      }
    })();

    // Return empty array to prevent showing stale results while new search is in progress
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

    // Clear suggestions immediately if query changed (prevents showing stale results)
    // This includes both continuations (xxx -> xxxy) and new words
    if (lastFundingAgencyQueryRef.current !== query) {
      setFundingAgencySuggestions([]);
      fundingAgencySuggestionsRef.current = [];
    }

    // Track the most recent search timestamp for race condition handling
    const searchTimestamp = Date.now();
    latestFundingAgencySearchRef.current = searchTimestamp;
    lastFundingAgencyQueryRef.current = query;

    // Set loading state
    setFundingAgencyLoading(true);

    // Trigger async search in background
    (async () => {
      try {
        const response = await govtContractsAutocompleteAPI.autocomplete({
          autocomplete_type: 'funding_agency',
          search_text: query,
          limit: 10,
        });

        // Only update suggestions if this is still the most recent search
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
        // Clear loading state only if this is still the most recent search
        if (latestFundingAgencySearchRef.current === searchTimestamp) {
          setFundingAgencyLoading(false);
        }
      }
    })();

    // Return empty array to prevent showing stale results while new search is in progress
    return [];
  }, [transformAutocompleteResults]);

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
      const filters: any = {
        ...searchParams,
      };

      // Keep agency names as-is (backend handles both names and codes)
      // Remove any code fields if names are present to avoid confusion
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        delete filters.awarding_agency_code;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        delete filters.funding_agency_code;
      }

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: pageSize,
      });

      if (response.success) {
        const results = response.results || [];
        setAllSearchResults(results);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        computeFiltersFromResults(results);
        
        // Note: We don't auto-populate missing date fields to avoid interfering with pagination/load more
      } else {
        setSearchError('Search failed. Please try again.');
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred while searching.');
    } finally {
      setIsSearching(false);
    }
  }, [searchParams, computeFiltersFromResults, findOptionByName, pageSize]);

  // Handle award enrichment
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
              // Fetch just the single award by ID (doesn't affect search results)
              const awardResponse = await govtContractsSearchAPI.getAward({
                award_id: awardId,
              });
              
              if (awardResponse.success && awardResponse.result) {
                // Update just this one award in the search results (if it exists in results)
                setAllSearchResults((prevResults) => {
                  const awardExists = prevResults.some((award: GovtContractAward) => award.award_id === awardId);
                  if (awardExists) {
                    // Update existing award in results
                    return prevResults.map((award: GovtContractAward) =>
                      award.award_id === awardId ? awardResponse.result! : award
                    );
                  } else {
                    // Award not in current results, but that's okay - just update the dialog
                    return prevResults;
                  }
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
        setEnrichmentError(response.error || 'Failed to enrich award data');
      }
    } catch (error: any) {
      console.error('Error enriching award:', error);
      setEnrichmentError(error.message || 'Failed to enrich award data. Please try again.');
    } finally {
      setEnrichmentLoading(false);
    }
  }, [selectedAwardForDetails, enrichmentLoading, allSearchResults, searchParams, findOptionByName, pageSize, setAllSearchResults, setDetailsDialogOpen, setSelectedAwardForDetails]);

  // Handle load more
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;

    setIsLoadingMore(true);
    setSearchError(null);

    try {
      const filters: any = {
        ...searchParams,
      };

      // Keep agency names as-is (backend handles both names and codes)
      // Remove any code fields if names are present to avoid confusion
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        delete filters.awarding_agency_code;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        delete filters.funding_agency_code;
      }

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: pageSize,
        last_evaluated_key: lastEvaluatedKey,
      });

      if (response.success) {
        const newResults = response.results || [];
        const updatedResults = [...allSearchResults, ...newResults];
        setAllSearchResults(updatedResults);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        computeFiltersFromResults(updatedResults);
        
        // Note: We don't auto-populate missing date fields to avoid interfering with pagination/load more
      }
    } catch (error: any) {
      console.error('Load more error:', error);
      setSearchError(error.message || 'An error occurred while loading more results.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, searchParams, isLoadingMore, allSearchResults, computeFiltersFromResults, pageSize, findOptionByName]);

  // Pagination
  const totalPages = Math.ceil(currentResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = currentResults.slice(startIndex, endIndex);

  // Column toggle handler
  const handleColumnToggle = (column: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        return prev.filter((c) => c !== column);
      } else {
        return [...prev, column];
      }
    });
  };

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
      visibleColumns,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [searchParams, allSearchResults, lastEvaluatedKey, hasMore, currentPage, pageSize, searchFormExpanded, advancedSearchExpanded, visibleColumns]);

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

  // Format currency (not rounded)
  const formatCurrency = (amount?: number) => {
    if (amount === undefined || amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Format date (fix timezone issue by parsing date string directly)
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

  // Format last updated date
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

  // Context menu handlers (for future use)
  // const handleContextMenuClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
  //   event.preventDefault();
  //   setContextMenuAnchor({ mouseX: event.clientX, mouseY: event.clientY });
  // }, []);

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToFiles = () => {
    if (selectedAwards.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedAwards.size === 0) return;
    
    try {
      const selectedAwardObjects = currentResults.filter(award => 
        selectedAwards.has(award.award_id)
      );

      // Save each award to the filesystem with FULL data
      // Note: currentResults contains the full award objects from the search API
      // This ensures we save the complete award with all fields
      for (const award of selectedAwardObjects) {
        const title = award.recipient_name 
          ? `Government Contract - ${award.recipient_name}${award.awarding_agency_name ? ` / ${award.awarding_agency_name}` : ''}`
          : `Government Contract ${award.award_id || ''}`;
        
        // FULL DATA MODE for filesystem - send complete award object with ALL fields
        // Unlike chat agent context (which uses partial data), filesystem needs full data
        // because it doesn't have database access to fetch missing fields
        await filesystemAPI.addContextItem({
          user_id: user.id,
          folder_path: folderPath,
          context_data: award, // Full award object with all fields
          title: title,
          item_type: 'govt_contract',
        });
      }
      
      console.log(`✅ Saved ${selectedAwardObjects.length} award(s) to filesystem`);
      setSelectedAwards(new Set());
    } catch (error) {
      console.error('Error saving awards to filesystem:', error);
    }
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
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 4, fontWeight: 600 }}>
          Government Contracts Search
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
                  {/* Basic Search Section */}

                  {/* Basic Search Section */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', mb: 2, fontSize: '1rem' }}>
                      Basic Search
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Awarding Agency */}
                  <MultiSelectField<{ code?: string; name?: string; id?: string; text?: string; [key: string]: any }>
                    label="Awarding Agency"
                    selectedItems={(() => {
                      // Convert names back to objects for display
                      const names = searchParams.awarding_agency_name || [];
                      return names.map(name => {
                        const found = findOptionByName(name, 'awarding_agency');
                        if (found) return found;
                        // Fallback - create object with name
                        return { name: name || '', code: '', text: name || '' };
                      });
                    })()}
                    onItemsChange={(items) => {
                      setSearchParams((prev) => ({
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
                      // Convert names back to objects for display
                      const names = searchParams.funding_agency_name || [];
                      return names.map(name => {
                        const found = findOptionByName(name, 'funding_agency');
                        if (found) return found;
                        // Fallback - create object with name
                        return { name: name || '', code: '', text: name || '' };
                      });
                    })()}
                    onItemsChange={(items) => {
                      setSearchParams((prev) => ({
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
                        const found = findOptionByName(name, 'recipient');
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
                    suggestions={recipientSuggestions}
                    onSearch={recipientSearch}
                    isLoading={recipientLoading}
                    renderItem={(item) => {
                      if (typeof item === 'string') return item;
                      // Return name for display (chips will show name)
                      return item.name || item.text || '';
                    }}
                    getItemKey={(item) => {
                      if (typeof item === 'string') return item;
                      // Ensure we always return a unique, non-empty key
                      // Try id, then name, then text, then generate from object
                      const key = item.id || item.name || item.text || '';
                      if (key) return key;
                      // Generate a unique key from the item's content
                      const itemStr = JSON.stringify(item);
                      // Use a hash-like approach for uniqueness
                      return `recipient-${itemStr.slice(0, 100).replace(/[^a-zA-Z0-9]/g, '-')}`;
                    }}
                    placeholder="Search for recipients..."
                    allowCustomInput={false}
                  />
                </Box>

                    {/* Min/Max Obligation */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3, mb: 3 }}>
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
                      // Hide spinner buttons
                      '& input[type=number]': {
                        MozAppearance: 'textfield',
                      },
                      '& input[type=number]::-webkit-outer-spin-button': {
                        WebkitAppearance: 'none',
                        margin: 0,
                      },
                      '& input[type=number]::-webkit-inner-spin-button': {
                        WebkitAppearance: 'none',
                        margin: 0,
                      },
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
                      // Hide spinner buttons
                      '& input[type=number]': {
                        MozAppearance: 'textfield',
                      },
                      '& input[type=number]::-webkit-outer-spin-button': {
                        WebkitAppearance: 'none',
                        margin: 0,
                      },
                      '& input[type=number]::-webkit-inner-spin-button': {
                        WebkitAppearance: 'none',
                        margin: 0,
                      },
                    }}
                  />
                </Box>

                    {/* Date Range */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Date From */}
                  <TextField
                    label="Date From"
                    type="date"
                    value={searchParams.date_from || ''}
                    onChange={(e) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        date_from: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
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

                  {/* Date To */}
                  <TextField
                    label="Date To"
                    type="date"
                    value={searchParams.date_to || ''}
                    onChange={(e) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        date_to: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
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
                  <Box sx={{ mt: 2 }}>
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
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    {/* Add to Context Button */}
                    {currentResults.length > 0 && (
                      <Tooltip title={`Add ${selectedAwards.size > 0 ? `${selectedAwards.size} award(s)` : 'selected awards'} to context`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              if (selectedAwards.size === 0) {
                                alert('Please select at least one award to add to context');
                                return;
                              }
                              setContextMenuAnchor(e.currentTarget);
                            }}
                            disabled={selectedAwards.size === 0}
                            sx={{ 
                              color: selectedAwards.size > 0 ? '#10b981' : '#9ca3af', 
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
                      <>
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
                      </>
                    )}
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
                        // Note: 'actions' removed - always visible, not selectable
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
                        <Table size="small" sx={{ 
                          tableLayout: 'fixed',
                          width: 'max-content',
                          minWidth: '100%',
                          '& .MuiTableCell-root': {
                            borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                            padding: '12px',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            verticalAlign: 'top',
                          },
                          '& .MuiTableHead-root .MuiTableCell-root': {
                            borderBottom: '2px solid rgba(59, 130, 246, 0.5)',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                            padding: '8px 12px',
                          },
                          '& .MuiTableRow-root:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.05)',
                          },
                          '& .MuiTableRow-root': {
                            height: 'auto',
                            minHeight: '100px',
                          },
                        }}>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                                width: 50,
                                minWidth: 50,
                                maxWidth: 50,
                              }}>
                                <Checkbox
                                  size="small"
                                  indeterminate={selectedAwards.size > 0 && selectedAwards.size < paginatedResults.length}
                                  checked={paginatedResults.length > 0 && selectedAwards.size === paginatedResults.length}
                                  onChange={() => {
                                    if (selectedAwards.size === paginatedResults.length) {
                                      const newSelected = new Set(selectedAwards);
                                      paginatedResults.forEach(award => newSelected.delete(award.award_id));
                                      setSelectedAwards(newSelected);
                                    } else {
                                      const newSelected = new Set(selectedAwards);
                                      paginatedResults.forEach(award => newSelected.add(award.award_id));
                                      setSelectedAwards(newSelected);
                                    }
                                  }}
                                  sx={{ 
                                    color: '#9ca3af', 
                                    '&.Mui-checked': { color: '#10b981' }, 
                                    '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                                  }}
                                />
                              </TableCell>
                              {visibleColumns.includes('recipient') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Recipient</TableCell>
                              )}
                              {visibleColumns.includes('awarding_agency') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Awarding Agency</TableCell>
                              )}
                              {visibleColumns.includes('funding_agency') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Funding Agency</TableCell>
                              )}
                              {visibleColumns.includes('amount') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Amount</TableCell>
                              )}
                              {visibleColumns.includes('period_start_date') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Period Start Date</TableCell>
                              )}
                              {visibleColumns.includes('period_end_date') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Period End Date</TableCell>
                              )}
                              {visibleColumns.includes('naics_code') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>NAICS Code</TableCell>
                              )}
                              {visibleColumns.includes('psc_code') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>PSC Code</TableCell>
                              )}
                              {visibleColumns.includes('last_updated') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Last Updated</TableCell>
                              )}
                              {/* Actions column is always visible (not selectable) */}
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                              }}>Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {paginatedResults.map((award) => (
                              <TableRow
                                key={award.award_id}
                                sx={{
                                  backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                  '&:hover': {
                                    backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                                  },
                                  cursor: 'pointer',
                                }}
                              >
                                <TableCell sx={{ 
                                  padding: '8px 12px',
                                  width: 50,
                                  minWidth: 50,
                                  maxWidth: 50,
                                }}>
                                  <Checkbox
                                    size="small"
                                    checked={selectedAwards.has(award.award_id)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const newSet = new Set(selectedAwards);
                                      if (e.target.checked) {
                                        newSet.add(award.award_id);
                                      } else {
                                        newSet.delete(award.award_id);
                                      }
                                      setSelectedAwards(newSet);
                                    }}
                                    sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                                  />
                                </TableCell>
                                {visibleColumns.includes('recipient') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {award.recipient_name || (award.recipient_name_normalized ? award.recipient_name_normalized.toUpperCase() : 'N/A')}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('awarding_agency') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {award.awarding_agency_name || 'N/A'}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('funding_agency') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {award.funding_agency_name || 'N/A'}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('amount') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {formatCurrency(
                                      (award.is_idv_parent || award.award_or_idv_flag === 'IDV') && award.combined_obligated_amount
                                        ? award.combined_obligated_amount
                                        : award.total_obligated_amount || award.total_obligation
                                    )}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('period_start_date') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {formatDate(award.period_start_date)}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('period_end_date') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {formatDate(award.period_of_performance_current_end_date || award.period_end_date)}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('naics_code') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {award.naics_code || 'N/A'}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('psc_code') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {award.psc_code || 'N/A'}
                                  </TableCell>
                                )}
                                {visibleColumns.includes('last_updated') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {formatLastUpdated(award.last_updated)}
                                  </TableCell>
                                )}
                                {/* Actions column is always visible (not selectable) */}
                                <TableCell sx={{ 
                                  fontSize: '0.875rem',
                                  padding: '12px',
                                }}>
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
                                      borderColor: '#3b82f6',
                                      color: '#3b82f6',
                                      fontSize: '0.7rem',
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
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, pt: 2, borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
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
                              '& .MuiPaginationItem-root:hover': {
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
                              '&:disabled': {
                                borderColor: '#4b5563',
                                color: '#6b7280',
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
                          ? 'No awards match the selected filters. Try adjusting your filters.'
                          : 'No awards found. Try adjusting your search parameters.'}
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
          )}
        </Box>
      </Container>

      {/* Award Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
          setParentAwardForDetails(null);  // Clear parent when closing
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
                      } else if (selectedAwardForDetails?.parent_idv_id) {
                        // If parent not stored but we have parent_idv_id, search for it
                        (async () => {
                          try {
                            const searchResponse = await govtContractsSearchAPI.search({
                              filters: {} as any,
                              limit: 100,
                            });
                            const parent = searchResponse.results?.find(
                              (a: GovtContractAward) => a.award_id === selectedAwardForDetails.parent_idv_id
                            );
                            if (parent) {
                              setSelectedAwardForDetails(parent);
                              setParentAwardForDetails(null);
                            }
                          } catch (error) {
                            console.error('Error fetching parent IDV:', error);
                          }
                        })();
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
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      '&:hover': {
                        opacity: 0.8,
                      },
                    }}
                    onClick={async () => {
                      // Store current child award as parentAwardForDetails before switching
                      if (selectedAwardForDetails) {
                        setParentAwardForDetails(selectedAwardForDetails);
                      }
                      
                      // Try to find the parent IDV in search results first
                      let parentAward = allSearchResults.find((a: GovtContractAward) => a.award_id === selectedAwardForDetails.parent_idv_id);
                      
                      // If not found, search for it specifically
                      if (!parentAward) {
                        try {
                          const searchResponse = await govtContractsSearchAPI.search({
                            filters: {} as any,
                            limit: 100,
                          });
                          
                          parentAward = searchResponse.results?.find(
                            (a: GovtContractAward) => a.award_id === selectedAwardForDetails.parent_idv_id
                          );
                          
                          // If found, add it to search results for future reference
                          if (parentAward) {
                            setAllSearchResults([...allSearchResults, parentAward]);
                          }
                        } catch (error) {
                          console.error('Error searching for parent IDV:', error);
                        }
                      }
                      
                      // If found, navigate to parent
                      if (parentAward) {
                        setSelectedAwardForDetails(parentAward);
                        setParentAwardForDetails(selectedAwardForDetails);
                      } else {
                        console.warn('Parent IDV not found:', selectedAwardForDetails.parent_idv_id);
                      }
                    }}
                  >
                    <Typography variant="body2" sx={{ color: '#3b82f6', fontWeight: 600, fontFamily: 'monospace' }}>
                      Parent: {selectedAwardForDetails.parent_idv_id}
                    </Typography>
                  </Box>
                </Box>
              )}
              
              {(() => {
                const startDate = selectedAwardForDetails?.period_of_performance_start_date || selectedAwardForDetails?.period_start_date;
                // For IDVs, use ordering_period_end_date if period_of_performance_current_end_date is not available
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
            // For IDVs, use combined_obligated_amount if available (sum of child awards), otherwise use total_obligated_amount
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
                      // For IDVs, use ordering_period_end_date if period_of_performance_current_end_date is not available
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
                              {/* Base rectangle (light gray background) */}
                              <rect 
                                x="0" 
                                y="0" 
                                rx="5" 
                                ry="5" 
                                width="304" 
                                height="10" 
                                fill="#f1f1f1"
                              />
                              {/* Green filled portion (elapsed time up to today) */}
                              <rect 
                                x="0" 
                                y="0" 
                                rx="5" 
                                ry="5" 
                                width={`${progressPercent}%`} 
                                height="10" 
                                fill="#10b981"
                              />
                              {/* Green circle at start */}
                              <circle cx="5" cy="5" r="5" fill="#10b981" />
                              {/* Red circle at end */}
                              <circle cx="299" cy="5" r="5" fill="#ef4444" />
                              {/* Vertical line for today's position */}
                              <line 
                                x1={(progressPercent / 100) * 304} 
                                x2={(progressPercent / 100) * 304} 
                                y1="0" 
                                y2="10" 
                                stroke="#64748b" 
                                strokeWidth="2"
                              />
                              {/* Triangle indicator for today */}
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
                    
                    // Calculate widths based on obligated amount as the full bar
                    const obligatedWidth = chartWidth;
                    const outlayedWidth = obligatedAmount > 0 ? (outlayedAmount / obligatedAmount) * chartWidth : 0;
                    
                    return (
                      <Box sx={{ position: 'relative', width: '100%', height: `${chartHeight}px`, overflow: 'hidden' }}>
                        <svg width="100%" height={chartHeight} style={{ maxWidth: `${chartWidth}px` }}>
                          {/* Base rectangle (light gray background) */}
                          <rect x="0" y={barY} width={chartWidth} height={barHeight} fill="#dce4ee" rx="5" ry="5" />
                          
                          {/* Obligated amount bar (blue - full width) */}
                          <rect x="0" y={barY + 5} width={obligatedWidth} height={barHeight - 10} fill="#4773aa" rx="5" ry="5" />
                          
                          {/* Outlayed amount progress bar (darker blue/green overlay showing what's been paid) */}
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
                          
                          {/* Vertical line for obligated amount */}
                          <line 
                            x1={obligatedWidth} 
                            y1={90} 
                            x2={obligatedWidth} 
                            y2={barY + barHeight + 10} 
                            stroke="#4773aa" 
                            strokeWidth="4"
                          />
                          
                          {/* Vertical line for outlayed amount (if different from obligated) */}
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
                          
                          {/* Outlayed Amount Label (if outlayed > 0) */}
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
                          
                          {/* Obligated Amount Label */}
                          <foreignObject width={chartWidth} height="70" x="-8" y={90}>
                            <Box sx={{ float: 'right', textAlign: 'right', backgroundColor: 'rgba(15, 23, 42, 0.98)', padding: '4px 8px', borderRadius: '4px' }}>
                              <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '20px' }}>
                                {formatCurrency(obligatedAmount)}
                              </Typography>
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                            </Box>
                          </foreignObject>
                          
                          {/* Total Funding Label */}
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
                      {selectedAwardForDetails.award_or_idv_flag === 'IDV' && (
                        <Tooltip
                          title={selectedAwardForDetails.combined_obligated_amount 
                            ? "The combined obligated amount from all child awards (delivery orders) under this IDV."
                            : "For IDV (Indefinite Delivery Vehicle) awards, the obligated amount is typically $0 on the parent award. The actual obligations are on the child awards (delivery orders). Visit USAspending.gov to see the combined obligated amounts from all child awards."}
                          arrow
                          placement="top"
                        >
                          <InfoIcon sx={{ fontSize: '12px', color: '#64748b', cursor: 'help', ml: 0.5, verticalAlign: 'middle' }} />
                        </Tooltip>
                      )}
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
                      Period Start Date
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(selectedAwardForDetails.period_of_performance_start_date || selectedAwardForDetails.period_start_date)}
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
                    {selectedAwardForDetails.awarding_sub_agency_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Sub-Agency: {selectedAwardForDetails.awarding_sub_agency_name}
                        {selectedAwardForDetails.awarding_sub_agency_code && ` (${selectedAwardForDetails.awarding_sub_agency_code})`}
                      </Typography>
                    )}
                    {selectedAwardForDetails.awarding_office_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Office: {selectedAwardForDetails.awarding_office_name}
                        {selectedAwardForDetails.awarding_office_code && ` (${selectedAwardForDetails.awarding_office_code})`}
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
                    {selectedAwardForDetails.funding_sub_agency_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Sub-Agency: {selectedAwardForDetails.funding_sub_agency_name}
                        {selectedAwardForDetails.funding_sub_agency_code && ` (${selectedAwardForDetails.funding_sub_agency_code})`}
                      </Typography>
                    )}
                    {selectedAwardForDetails.funding_office_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Office: {selectedAwardForDetails.funding_office_name}
                        {selectedAwardForDetails.funding_office_code && ` (${selectedAwardForDetails.funding_office_code})`}
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
                  {selectedAwardForDetails.recipient_location_state && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        State
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.recipient_location_state}
                        {selectedAwardForDetails.recipient_state_name && ` (${selectedAwardForDetails.recipient_state_name})`}
                      </Typography>
                    </Box>
                  )}
                  {selectedAwardForDetails.recipient_location_country && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Country
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.recipient_location_country}
                        {selectedAwardForDetails.recipient_country_name && ` (${selectedAwardForDetails.recipient_country_name})`}
                      </Typography>
                    </Box>
                  )}
                  {selectedAwardForDetails.recipient_city_name && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        City
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.recipient_city_name}
                        {selectedAwardForDetails.recipient_county_name && `, ${selectedAwardForDetails.recipient_county_name}`}
                      </Typography>
                    </Box>
                  )}
                  {selectedAwardForDetails.recipient_address_line_1 && (
                    <Box sx={{ gridColumn: '1 / -1' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Address
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.recipient_address_line_1}
                        {selectedAwardForDetails.recipient_address_line_2 && `, ${selectedAwardForDetails.recipient_address_line_2}`}
                        {selectedAwardForDetails.recipient_zip_code && `, ${selectedAwardForDetails.recipient_zip_code}`}
                      </Typography>
                    </Box>
                  )}
                  {selectedAwardForDetails.recipient_parent_name && (
                    <Box sx={{ gridColumn: '1 / -1' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Parent Organization
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        {selectedAwardForDetails.recipient_parent_name}
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

              {/* Funding Information */}
              {(selectedAwardForDetails.federal_accounts_funding_this_award ||
                selectedAwardForDetails.treasury_accounts_funding_this_award ||
                selectedAwardForDetails.program_activities_funding_this_award ||
                selectedAwardForDetails.object_classes_funding_this_award ||
                selectedAwardForDetails.disaster_emergency_fund_codes_for_overall_award) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                    Funding Information
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                    {selectedAwardForDetails.federal_accounts_funding_this_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Federal Account
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                          {selectedAwardForDetails.federal_accounts_funding_this_award}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.treasury_accounts_funding_this_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Treasury Account
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                          {selectedAwardForDetails.treasury_accounts_funding_this_award}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.disaster_emergency_fund_codes_for_overall_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Disaster/Emergency Fund Code (DEFC)
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.disaster_emergency_fund_codes_for_overall_award}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.program_activities_funding_this_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Program Activity
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.program_activities_funding_this_award}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.object_classes_funding_this_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Object Class
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.object_classes_funding_this_award}
                        </Typography>
                      </Box>
                    )}
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
                        onClick={async () => {
                          // Store current award as parent before switching
                          if (selectedAwardForDetails) {
                            setParentAwardForDetails(selectedAwardForDetails);
                          }
                          
                          // Try to find the child award in search results first
                          let childAwardFull = allSearchResults.find((a: GovtContractAward) => a.award_id === childAward.award_id);
                          
                          // If not found, search for it specifically by searching with empty filters
                          if (!childAwardFull) {
                            try {
                              const searchResponse = await govtContractsSearchAPI.search({
                                filters: {} as any,
                                limit: 100,
                              });
                              
                              childAwardFull = searchResponse.results?.find(
                                (a: GovtContractAward) => a.award_id === childAward.award_id
                              );
                              
                              // If found, add it to search results for future reference
                              if (childAwardFull) {
                                setAllSearchResults([...allSearchResults, childAwardFull]);
                              }
                            } catch (error) {
                              console.error('Error searching for child award:', error);
                            }
                          }
                          
                          // If still not found, create a minimal award object from the child details
                          // This allows viewing basic info even if full award isn't in DynamoDB yet
                          if (!childAwardFull) {
                            childAwardFull = {
                              ...childAward,
                              transactions: [],
                              subawards: [],
                              transaction_count: childAward.transaction_count || 0,
                              subaward_count: childAward.subaward_count || 0,
                            } as GovtContractAward;
                          }
                          
                          // Update the dialog with child award
                          setSelectedAwardForDetails(childAwardFull);
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

              {/* Additional Financial Information */}
              {(selectedAwardForDetails.current_total_value_of_award || 
                selectedAwardForDetails.potential_total_value_of_award ||
                selectedAwardForDetails.base_and_exercised_options_value ||
                selectedAwardForDetails.base_and_all_options_value) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                    Additional Financial Information
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {selectedAwardForDetails.current_total_value_of_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Current Total Value
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatCurrency(parseFloat(String(selectedAwardForDetails.current_total_value_of_award)))}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.potential_total_value_of_award && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Potential Total Value
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatCurrency(parseFloat(String(selectedAwardForDetails.potential_total_value_of_award)))}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.base_and_exercised_options_value && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Base and Exercised Options
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatCurrency(parseFloat(String(selectedAwardForDetails.base_and_exercised_options_value)))}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.base_and_all_options_value && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Base and All Options
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatCurrency(parseFloat(String(selectedAwardForDetails.base_and_all_options_value)))}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}

              {/* Place of Performance */}
              {(selectedAwardForDetails.primary_place_of_performance_city_name ||
                selectedAwardForDetails.primary_place_of_performance_state_name ||
                selectedAwardForDetails.primary_place_of_performance_country_name) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                    Place of Performance
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {selectedAwardForDetails.primary_place_of_performance_city_name && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          City
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.primary_place_of_performance_city_name}
                          {selectedAwardForDetails.primary_place_of_performance_county_name && 
                            `, ${selectedAwardForDetails.primary_place_of_performance_county_name}`}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.primary_place_of_performance_state_name && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          State
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.primary_place_of_performance_state_name}
                          {selectedAwardForDetails.primary_place_of_performance_state_code && 
                            ` (${selectedAwardForDetails.primary_place_of_performance_state_code})`}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.primary_place_of_performance_country_name && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Country
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.primary_place_of_performance_country_name}
                          {selectedAwardForDetails.primary_place_of_performance_country_code && 
                            ` (${selectedAwardForDetails.primary_place_of_performance_country_code})`}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.primary_place_of_performance_zip_4 && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          ZIP Code
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {selectedAwardForDetails.primary_place_of_performance_zip_4}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}

              {/* Dates and Metadata */}
              {(selectedAwardForDetails.action_date || 
                selectedAwardForDetails.last_modified_date ||
                selectedAwardForDetails.last_updated ||
                selectedAwardForDetails.initial_report_date) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                    Dates and Metadata
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {selectedAwardForDetails.action_date && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Action Date
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatDate(selectedAwardForDetails.action_date)}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.last_modified_date && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Last Modified
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatDate(selectedAwardForDetails.last_modified_date)}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.last_updated && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Last Updated
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatLastUpdated(selectedAwardForDetails.last_updated)}
                        </Typography>
                      </Box>
                    )}
                    {selectedAwardForDetails.initial_report_date && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                          Initial Report Date
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                          {formatDate(selectedAwardForDetails.initial_report_date)}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => setDetailsDialogOpen(false)}
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
        <MenuItem
          onClick={handleAddToFiles}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files
        </MenuItem>
      </Menu>

      {/* File Browser Dialog */}
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

export default GovtContractsSearchPage;

