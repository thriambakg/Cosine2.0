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
  FormControlLabel,
  FormGroup,
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
  const [selectedAwardForDetails, setSelectedAwardForDetails] = useState<GovtContractAward | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);
  
  // Column visibility state
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

      // Convert agency names to codes for API call
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        const codes = filters.awarding_agency_name.map((name: string) => {
          const found = findOptionByName(name, 'awarding_agency');
          return found?.code || found?.id || name;
        }).filter(Boolean);
        filters.awarding_agency_code = codes;
        delete filters.awarding_agency_name;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        const codes = filters.funding_agency_name.map((name: string) => {
          const found = findOptionByName(name, 'funding_agency');
          return found?.code || found?.id || name;
        }).filter(Boolean);
        filters.funding_agency_code = codes;
        delete filters.funding_agency_name;
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
        
        // Set default date ranges from results only if one date is set but not the other
        if (results.length > 0) {
          const dates = results
            .map(award => award.period_start_date)
            .filter((date): date is string => !!date)
            .map(date => {
              // Extract just the date part (YYYY-MM-DD) if it includes time
              return date.split('T')[0];
            })
            .sort();
          
          if (dates.length > 0) {
            const minDate = dates[0];
            const maxDate = dates[dates.length - 1];
            
            setSearchParams((prev) => {
              // Only set defaults if one date is set but not the other
              const hasDateFrom = !!prev.date_from;
              const hasDateTo = !!prev.date_to;
              
              // If date_from is set but date_to is not, set date_to to max
              // If date_to is set but date_from is not, set date_from to min
              // If both are empty, don't set either
              if (hasDateFrom && !hasDateTo) {
                return { ...prev, date_to: maxDate };
              } else if (hasDateTo && !hasDateFrom) {
                return { ...prev, date_from: minDate };
              }
              return prev;
            });
          }
        }
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

  // Handle load more
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;

    setIsLoadingMore(true);
    setSearchError(null);

    try {
      const filters: any = {
        ...searchParams,
      };

      // Convert agency names to codes for API call
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        const codes = filters.awarding_agency_name.map((name: string) => {
          const found = findOptionByName(name, 'awarding_agency');
          return found?.code || found?.id || name;
        }).filter(Boolean);
        filters.awarding_agency_code = codes;
        delete filters.awarding_agency_name;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        const codes = filters.funding_agency_name.map((name: string) => {
          const found = findOptionByName(name, 'funding_agency');
          return found?.code || found?.id || name;
        }).filter(Boolean);
        filters.funding_agency_code = codes;
        delete filters.funding_agency_name;
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
        
        // Update date ranges from all results only if one date is set but not the other
        if (updatedResults.length > 0) {
          const dates = updatedResults
            .map(award => award.period_start_date)
            .filter((date): date is string => !!date)
            .map(date => {
              // Extract just the date part (YYYY-MM-DD) if it includes time
              return date.split('T')[0];
            })
            .sort();
          
          if (dates.length > 0) {
            const minDate = dates[0];
            const maxDate = dates[dates.length - 1];
            
            setSearchParams((prev) => {
              // Only set defaults if one date is set but not the other
              const hasDateFrom = !!prev.date_from;
              const hasDateTo = !!prev.date_to;
              
              // If date_from is set but date_to is not, set date_to to max
              // If date_to is set but date_from is not, set date_from to min
              // If both are empty, don't set either
              if (hasDateFrom && !hasDateTo) {
                return { ...prev, date_to: maxDate };
              } else if (hasDateTo && !hasDateFrom) {
                return { ...prev, date_from: minDate };
              }
              return prev;
            });
          }
        }
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
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
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

                {/* Min/Max Obligation Row */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, mt: 2 }}>
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

                {/* Date Range Row */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, mt: 2 }}>
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
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                    '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Results
                    </Typography>
                    {currentResults.length > 0 && (
                      <IconButton
                        onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                        size="small"
                        sx={{
                          color: '#9ca3af',
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            color: '#3b82f6',
                          },
                        }}
                        title="Select columns to display"
                      >
                        <ViewColumnIcon fontSize="small" />
                      </IconButton>
                    )}
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
                        <Menu
                          anchorEl={columnMenuAnchor}
                          open={columnMenuOpen}
                          onClose={() => setColumnMenuAnchor(null)}
                          PaperProps={{
                            sx: {
                              bgcolor: '#1f2937',
                              border: '1px solid #374151',
                              mt: 1,
                            },
                          }}
                        >
                          <Box sx={{ p: 1, minWidth: 200 }}>
                            <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, px: 1 }}>
                              Select Columns
                            </Typography>
                            <FormGroup>
                              {AVAILABLE_COLUMNS.map((col) => {
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
                                };
                                return (
                                  <FormControlLabel
                                    key={col}
                                    control={
                                      <Checkbox
                                        checked={visibleColumns.includes(col)}
                                        onChange={() => handleColumnToggle(col)}
                                        sx={{
                                          color: '#9ca3af',
                                          '&.Mui-checked': { color: '#3b82f6' },
                                        }}
                                      />
                                    }
                                    label={columnLabels[col] || col}
                                    sx={{
                                      color: '#e2e8f0',
                                      '& .MuiFormControlLabel-label': { fontSize: '0.875rem' },
                                    }}
                                  />
                                );
                              })}
                            </FormGroup>
                          </Box>
                        </Menu>
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
                        {visibleColumns.includes('recipient') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Recipient</TableCell>
                        )}
                        {visibleColumns.includes('awarding_agency') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Awarding Agency</TableCell>
                        )}
                        {visibleColumns.includes('funding_agency') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Funding Agency</TableCell>
                        )}
                        {visibleColumns.includes('amount') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Amount</TableCell>
                        )}
                        {visibleColumns.includes('period_start_date') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Period Start Date</TableCell>
                        )}
                        {visibleColumns.includes('period_end_date') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Period End Date</TableCell>
                        )}
                        {visibleColumns.includes('naics_code') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>NAICS Code</TableCell>
                        )}
                        {visibleColumns.includes('psc_code') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>PSC Code</TableCell>
                        )}
                        {visibleColumns.includes('last_updated') && (
                          <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Last Updated</TableCell>
                        )}
                        <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Actions</TableCell>
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
                            {visibleColumns.includes('recipient') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {award.recipient_name || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('awarding_agency') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {award.awarding_agency_name || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('funding_agency') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {award.funding_agency_name || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('amount') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {formatCurrency(award.total_obligation)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('period_start_date') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {formatDate(award.period_start_date)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('period_end_date') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {formatDate(award.period_end_date)}
                              </TableCell>
                            )}
                            {visibleColumns.includes('naics_code') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {award.naics_code || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('psc_code') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {award.psc_code || 'N/A'}
                              </TableCell>
                            )}
                            {visibleColumns.includes('last_updated') && (
                              <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                {formatLastUpdated(award.last_updated)}
                              </TableCell>
                            )}
                            <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                              <Button
                                variant="outlined"
                                size="small"
                                onClick={() => {
                                  setSelectedAwardForDetails(award);
                                  setDetailsDialogOpen(true);
                                }}
                                sx={{
                                  borderColor: '#3b82f6',
                                  color: '#3b82f6',
                                  '&:hover': {
                                    borderColor: '#2563eb',
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
                      variant="outlined"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      sx={{
                        color: '#3b82f6',
                        borderColor: '#3b82f6',
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

      {/* Award Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff', borderBottom: '1px solid #374151' }}>
          {selectedAwardForDetails?.recipient_name || 'Award Details'}
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
          {selectedAwardForDetails && (
            <Box>
              {/* Description */}
              {selectedAwardForDetails.description && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                    Description
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {selectedAwardForDetails.description}
                  </Typography>
                </Box>
              )}

              {/* PSC Description */}
              {selectedAwardForDetails.psc_description && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                    PSC Description
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {selectedAwardForDetails.psc_description}
                  </Typography>
                </Box>
              )}

              {/* Transactions */}
              {selectedAwardForDetails.transactions && selectedAwardForDetails.transactions.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                    Transactions ({selectedAwardForDetails.transactions.length})
                  </Typography>
                  <Box sx={{ maxHeight: '300px', overflowY: 'auto' }}>
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

              {/* Subawards */}
              {selectedAwardForDetails.subawards && selectedAwardForDetails.subawards.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                    Subawards ({selectedAwardForDetails.subawards.length})
                  </Typography>
                  <Box sx={{ maxHeight: '300px', overflowY: 'auto' }}>
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

              {(!selectedAwardForDetails.transactions || selectedAwardForDetails.transactions.length === 0) &&
                (!selectedAwardForDetails.subawards || selectedAwardForDetails.subawards.length === 0) &&
                !selectedAwardForDetails.description &&
                !selectedAwardForDetails.psc_description && (
                  <Typography variant="body2" sx={{ color: '#94a3b8', textAlign: 'center', py: 3 }}>
                    No additional details available
                  </Typography>
                )}
            </Box>
          )}
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
      </Menu>
    </Box>
  );
};

export default GovtContractsSearchPage;

