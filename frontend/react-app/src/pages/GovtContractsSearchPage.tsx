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
  ViewColumn as ViewColumnIcon,
  Dashboard as AddToContextIcon,
  Folder as FolderIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { 
  govtContractsSearchAPI, 
  govtContractsAutocompleteAPI,
  GovtContractsSearchFilters,
  GovtContractAward 
} from '../services/api';
import { filesystemAPI } from '../services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import MultiSelectField from '../components/MultiSelectField';
import { addAwardToContext, addMultipleAwardsToContext } from '../components/tiles/common';
import { compressedSessionStorage } from '../utils/compressedStorage';
import FileBrowserDialog from '../components/common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../hooks/useDialogManagerHelpers';
import { getSearchPageBatchSize } from './config/searchPageConfig';

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
  months: boolean;
}

const GovtContractsSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { openItemDetails } = useDialogManagerHelpers();
  const {} = useGlobalChat();
  const { isEasyMode } = useEasyMode();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'govt-contracts-search-page-state';

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

  // Initialize state from sessionStorage immediately
  const savedState = loadStateFromStorage();
  
  // Search state - ensure all array fields are initialized
  const [searchParams, setSearchParams] = useState<GovtContractsSearchFilters>(() => {
    const saved = savedState?.searchParams;
    return {
      keywords: Array.isArray(saved?.keywords) ? saved.keywords : [],
      award_type: Array.isArray(saved?.award_type) ? saved.award_type : [],
      award_id: Array.isArray(saved?.award_id) ? saved.award_id : [],
      awarding_agency_name: Array.isArray(saved?.awarding_agency_name) ? saved.awarding_agency_name : [],
      funding_agency_name: Array.isArray(saved?.funding_agency_name) ? saved.funding_agency_name : [],
      recipient_id: Array.isArray(saved?.recipient_id) ? saved.recipient_id : [],
      recipient_name: Array.isArray(saved?.recipient_name) ? saved.recipient_name : [],
      recipient_location_state: Array.isArray(saved?.recipient_location_state) ? saved.recipient_location_state : [],
      recipient_zip_code: Array.isArray(saved?.recipient_zip_code) ? saved.recipient_zip_code : [],
      recipient_location_country: Array.isArray(saved?.recipient_location_country) ? saved.recipient_location_country : [],
      naics_code: Array.isArray(saved?.naics_code) ? saved.naics_code : [],
      psc_code: Array.isArray(saved?.psc_code) ? saved.psc_code : [],
      cfda_number: Array.isArray(saved?.cfda_number) ? saved.cfda_number : [],
      date_year: saved?.date_year || undefined,
      // Don't restore legacy date_from/date_to - they're no longer used
    };
  });
  
  // Don't restore allSearchResults from saved state to avoid quota issues
  // Results will be re-fetched if needed based on searchParams and lastEvaluatedKey
  const [allSearchResults, setAllSearchResults] = useState<GovtContractAward[]>(() => {
    return savedState?.allSearchResults || [];
  });
  const [currentResults, setCurrentResults] = useState<GovtContractAward[]>(() => {
    return savedState?.currentResults || [];
  });
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  // Column visibility state
  // Note: 'actions' is always visible and not selectable (like SEC tile)
  const AVAILABLE_COLUMNS = [
    'recipient',
    'awarding_agency',
    'funding_agency',
    'recipient_location',
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
    month_filters?: Array<{ month: number; count: number }>;
  }>({});
  
  const [expandedFilters, setExpandedFilters] = useState<ExpandedFiltersState>(
    savedState?.expandedFilters || {
      awardTypes: false,
      agencies: false,
      recipients: false,
      states: false,
      countries: false,
      codes: false,
      months: false,
    }
  );
  
  // Helper to convert Sets to arrays for serialization
  const convertSetsToArrays = (filters: {
    award_types: Set<string>;
    agencies: Set<string>;
    recipients: Set<string>;
    states: Set<string>;
    countries: Set<string>;
    naics: Set<string>;
    psc: Set<string>;
    cfda: Set<string>;
    months: Set<number>;
  }) => ({
    award_types: Array.from(filters.award_types),
    agencies: Array.from(filters.agencies),
    recipients: Array.from(filters.recipients),
    states: Array.from(filters.states),
    countries: Array.from(filters.countries),
    naics: Array.from(filters.naics),
    psc: Array.from(filters.psc),
    cfda: Array.from(filters.cfda),
    months: Array.from(filters.months),
  });

  // Helper to convert arrays back to Sets for deserialization
  const convertArraysToSets = (filters: {
    award_types?: string[];
    agencies?: string[];
    recipients?: string[];
    states?: string[];
    countries?: string[];
    naics?: string[];
    psc?: string[];
    cfda?: string[];
    months?: number[];
  }) => ({
    award_types: new Set(filters.award_types || []),
    agencies: new Set(filters.agencies || []),
    recipients: new Set(filters.recipients || []),
    states: new Set(filters.states || []),
    countries: new Set(filters.countries || []),
    naics: new Set(filters.naics || []),
    psc: new Set(filters.psc || []),
    cfda: new Set(filters.cfda || []),
    months: new Set(filters.months || []),
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
    months: Set<number>;
  }>(() => {
    const saved = savedState?.selectedFilters;
    if (saved) {
      return convertArraysToSets(saved);
    }
    return {
      award_types: new Set(),
      agencies: new Set(),
      recipients: new Set(),
      states: new Set(),
      countries: new Set(),
      naics: new Set(),
      psc: new Set(),
      cfda: new Set(),
      months: new Set(),
    };
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 25);
  const [searchSidebarVisible, setSearchSidebarVisible] = useState<boolean>(savedState?.searchSidebarVisible !== undefined ? savedState.searchSidebarVisible : true);
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
    const monthMap = new Map<number, number>();

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
      // Extract month from period_of_performance_start_date or period_of_performance_current_end_date
      const dateStr = award.period_of_performance_start_date || award.period_of_performance_current_end_date;
      if (dateStr) {
        try {
          const date = new Date(dateStr);
          const month = date.getMonth() + 1; // getMonth() returns 0-11, we want 1-12
          if (month >= 1 && month <= 12) {
            monthMap.set(month, (monthMap.get(month) || 0) + 1);
          }
        } catch {
          // Ignore invalid dates
        }
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
      month_filters: Array.from(monthMap.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month - b.month), // Sort by month number (1-12)
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

    // Filter by month (extract month from period_of_performance_start_date or period_of_performance_current_end_date)
    if (selectedFilters.months.size > 0) {
      filtered = filtered.filter((award) => {
        const dateStr = award.period_of_performance_start_date || award.period_of_performance_current_end_date;
        if (!dateStr) return false;
        
        try {
          // Parse date string (format: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss")
          const date = new Date(dateStr);
          const month = date.getMonth() + 1; // getMonth() returns 0-11, we want 1-12
          return selectedFilters.months.has(month);
        } catch {
          return false;
        }
      });
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
      selectedFilters.cfda.size > 0 ||
      selectedFilters.months.size > 0
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

      // Remove legacy date fields (date_from, date_to) - use date_year instead
      delete filters.date_from;
      delete filters.date_to;

      // Keep agency names as-is (backend handles both names and codes)
      // Remove any code fields if names are present to avoid confusion
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        delete filters.awarding_agency_code;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        delete filters.funding_agency_code;
      }

      // Remove empty arrays, empty strings, null, and undefined
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        } else if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
        // Also explicitly remove legacy date fields if they somehow got through
        if (key === 'date_from' || key === 'date_to') {
          delete filters[key];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: getSearchPageBatchSize('govt_contracts'),
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


  // Handle load more
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;

    setIsLoadingMore(true);
    setSearchError(null);

    try {
      const filters: any = {
        ...searchParams,
      };

      // Remove legacy date fields (date_from, date_to) - use date_year instead
      delete filters.date_from;
      delete filters.date_to;

      // Keep agency names as-is (backend handles both names and codes)
      // Remove any code fields if names are present to avoid confusion
      if (filters.awarding_agency_name && filters.awarding_agency_name.length > 0) {
        delete filters.awarding_agency_code;
      }
      
      if (filters.funding_agency_name && filters.funding_agency_name.length > 0) {
        delete filters.funding_agency_code;
      }

      // Remove empty arrays, empty strings, null, and undefined
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        } else if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
        // Also explicitly remove legacy date fields if they somehow got through
        if (key === 'date_from' || key === 'date_to') {
          delete filters[key];
        }
      });

      const response = await govtContractsSearchAPI.search({
        filters,
        limit: getSearchPageBatchSize('govt_contracts'),
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
    try {
      // Save all state including results (compressed storage handles memory efficiently)
      const stateToSave = {
        searchParams,
        allSearchResults, // Save actual results
        currentResults, // Save filtered results
        resultCount: allSearchResults.length, // Keep count for compatibility
        lastEvaluatedKey,
        hasMore,
        currentPage,
        pageSize,
        advancedSearchExpanded,
        visibleColumns,
        expandedFilters,
        searchSidebarVisible,
        selectedFilters: convertSetsToArrays(selectedFilters), // Convert Sets to arrays for serialization
      };
      
      // Use compressed storage (automatically compresses if beneficial)
      compressedSessionStorage.setItem(SESSION_STORAGE_KEY, stateToSave);
    } catch (error: any) {
      // Handle quota exceeded errors gracefully
      if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
        console.warn('SessionStorage quota exceeded, saving minimal state only');
        try {
          // Save only essential state (compressed) - still try to save results if possible
          const minimalState = {
            searchParams,
            allSearchResults, // Still try to save results even in minimal state
            currentResults, // Still try to save filtered results
            resultCount: allSearchResults.length,
            lastEvaluatedKey,
            hasMore,
            currentPage,
            pageSize,
            visibleColumns,
            selectedFilters: convertSetsToArrays(selectedFilters),
          };
          compressedSessionStorage.setItem(SESSION_STORAGE_KEY, minimalState);
        } catch (minimalError) {
          console.error('Failed to save even minimal state:', minimalError);
          // Last resort: save only search params and pagination (no results)
          try {
            const fallbackState = {
              searchParams,
              lastEvaluatedKey,
              hasMore,
              currentPage,
              pageSize,
              visibleColumns,
            };
            compressedSessionStorage.setItem(SESSION_STORAGE_KEY, fallbackState);
          } catch (fallbackError) {
            console.error('Failed to save fallback state:', fallbackError);
          }
        }
      } else {
        console.error('Error saving state to sessionStorage:', error);
      }
    }
  }, [searchParams, allSearchResults, currentResults, lastEvaluatedKey, hasMore, currentPage, pageSize, advancedSearchExpanded, visibleColumns, expandedFilters, searchSidebarVisible, selectedFilters]);

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

  // Clear state on logout
  useEffect(() => {
    const handleLogout = () => {
      try {
        compressedSessionStorage.removeItem(SESSION_STORAGE_KEY);
        // Also try uncompressed fallback
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (error) {
        console.error('Error clearing state on logout:', error);
      }
    };

    // Listen for logout event from AuthContext
    window.addEventListener('user-logout', handleLogout);

    return () => {
      window.removeEventListener('user-logout', handleLogout);
    };
  }, []);

  // Clear state on tab close (beforeunload)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Note: We don't clear state on tab close - we want state to persist across tab refreshes
      // State is only cleared on logout or when explicitly cleared by the user
      // If you want to clear on tab close, uncomment the line below:
      // compressedSessionStorage.removeItem(SESSION_STORAGE_KEY);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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
    setContextMenuPosition(null);
  };

  // Handle award click (single, Ctrl+click, Shift+click)
  const handleAwardClick = (e: React.MouseEvent, awardId: string, index: number) => {
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedAwards(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const awardsToSelect = paginatedResults.slice(start, end + 1);
        awardsToSelect.forEach(award => newSelected.add(award.award_id));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(awardId)) {
          newSelected.delete(awardId);
        } else {
          newSelected.add(awardId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(awardId)) {
          newSelected.delete(awardId);
        } else {
          newSelected.clear();
          newSelected.add(awardId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, awardId: string) => {
    e.stopPropagation();
    
    // Determine which awards to drag
    const awardsToDrag = selectedAwards.has(awardId) ? selectedAwards : new Set([awardId]);
    
    // Set drag data
    const selectedAwardObjects = currentResults.filter(award => 
      awardsToDrag.has(award.award_id)
    );
    
    if (selectedAwardObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'govt_contracts',
        awards: selectedAwardObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedAwardObjects.length} award${selectedAwardObjects.length > 1 ? 's' : ''}`;
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
  const handleRowContextMenu = (e: React.MouseEvent, awardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this award is not selected, select only it
    if (!selectedAwards.has(awardId)) {
      setSelectedAwards(new Set([awardId]));
    }
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
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

      // Deduplicate by award_id so we only add each contract once (currentResults can
      // contain the same award multiple times from search/load-more/filtering)
      const seenIds = new Set<string>();
      const uniqueAwardObjects = selectedAwardObjects.filter(award => {
        const id = award.award_id;
        if (id && seenIds.has(id)) return false;
        if (id) seenIds.add(id);
        return true;
      });

      // Save all awards to the filesystem with FULL data using bulk operation
      // Note: currentResults contains the full award objects from the search API
      // This ensures we save the complete award with all fields
      const items = uniqueAwardObjects.map(award => {
        const title = award.recipient_name 
          ? `Government Contract - ${award.recipient_name}${award.awarding_agency_name ? ` / ${award.awarding_agency_name}` : ''}`
          : `Government Contract ${award.award_id || ''}`;
        return {
          context_data: award, // Full award object with all fields
          title: title,
          item_type: 'govt_contract' as const,
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
        console.log(`✅ Saved ${result?.succeeded || uniqueAwardObjects.length} of ${uniqueAwardObjects.length} award(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} award(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save awards');
      }
      setSelectedAwards(new Set());
    } catch (error) {
      console.error('Error saving awards to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedAwardObjects = currentResults.filter(award => 
      selectedAwards.has(award.award_id)
    );

    // Deduplicate by award_id (currentResults can contain the same award multiple times)
    const seenIds = new Set<string>();
    const uniqueAwardObjects = selectedAwardObjects.filter(award => {
      const id = award.award_id;
      if (id && seenIds.has(id)) return false;
      if (id) seenIds.add(id);
      return true;
    });

    if (uniqueAwardObjects.length === 0) return;

    if (uniqueAwardObjects.length === 1) {
      addAwardToContext(uniqueAwardObjects[0]);
    } else {
      addMultipleAwardsToContext(uniqueAwardObjects);
    }

    setSelectedAwards(new Set());
    handleContextMenuClose();
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
          Government Contracts Search
        </Typography>

        {/* Disclaimer Alert */}
        <Alert 
          severity="info" 
          icon={<InfoIcon />}
          sx={{ 
            mb: 3,
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            color: '#93c5fd',
            '& .MuiAlert-icon': {
              color: '#3b82f6',
            },
            '& .MuiAlert-message': {
              color: '#93c5fd',
            },
            '& a': {
              color: '#60a5fa',
              textDecoration: 'underline',
              '&:hover': {
                color: '#93c5fd',
              },
            },
          }}
        >
          <Typography variant="body2" component="span">
            <strong>Note:</strong> This search includes contracts which have been updated after 2025-01-01. 
            For older contract records, please visit{' '}
            <a 
              href="https://www.usaspending.gov/" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              USAspending.gov
            </a>
            {' '}to search historical data.
          </Typography>
        </Alert>

        {/* Main Layout: Search Filters (Left) | Results (Middle) | Client-side Filter Box (Right) */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Search Filters (Collapsible) */}
          {searchSidebarVisible ? (
            <GlassCard sx={{ 
              minWidth: 320, 
              maxWidth: 380,
              width: 320,
              height: 'fit-content',
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
              transition: 'all 0.3s ease-in-out',
            }}>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
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
                  {/* Basic Search Section */}

                  {/* Basic Search Section */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', mb: 2, fontSize: '1rem' }}>
                      Basic Search
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Awarding Agency */}
                  <Box data-tutorial="awarding-agency">
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
                  </Box>

                  {/* Award ID - Exact match, multi-select, no autocomplete */}
                  <Box data-tutorial="award-id">
                  <MultiSelectField<string>
                    label="Award ID"
                    selectedItems={searchParams.award_id || []}
                    onItemsChange={(awardIds) => {
                      setSearchParams((prev) => ({ ...prev, award_id: awardIds }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(awardId) => awardId}
                    placeholder="Enter award IDs (exact match)..."
                    disableAutocomplete={true}
                  />
                  </Box>

                  {/* Recipient - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="recipient">
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
                  )}

                  {/* Recipient Location (State & Zip) */}
                  <Box data-tutorial="recipient-location" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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

                  <MultiSelectField<string>
                    label="Recipient Zip Code"
                    selectedItems={searchParams.recipient_zip_code || []}
                    onItemsChange={(zipCodes) => {
                      setSearchParams((prev) => ({ ...prev, recipient_zip_code: zipCodes }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(zipCode) => zipCode}
                    placeholder="Enter zip codes..."
                    disableAutocomplete={true}
                  />
                  </Box>
                    </Box>
                  </Box>

                    {/* Date Range */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                  {/* Date Year */}
                  <Box data-tutorial="fiscal-year">
                  <TextField
                    label="Fiscal Year"
                    type="number"
                    value={searchParams.date_year || ''}
                    onChange={(e) => {
                      const year = e.target.value ? parseInt(e.target.value) : undefined;
                      setSearchParams((prev) => ({
                        ...prev,
                        date_year: year,
                      }));
                    }}
                    inputProps={{
                      min: 2000,
                      max: 2100,
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

                  {/* Advanced Search Section - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="advanced-search" sx={{ mt: 2 }}>
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

                  {/* Min/Max Obligation */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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

                  {/* NAICS Code - Hidden (no GSI available, may implement later) */}
                  {/* <MultiSelectField<string>
                    label="NAICS Code"
                    selectedItems={searchParams.naics_code || []}
                    onItemsChange={(codes) => {
                      setSearchParams((prev) => ({ ...prev, naics_code: codes }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(code) => code}
                    placeholder="Enter NAICS codes..."
                    disableAutocomplete={true}
                  /> */}

                  {/* PSC Code - Hidden (no GSI available, may implement later) */}
                  {/* <MultiSelectField<string>
                    label="PSC Code"
                    selectedItems={searchParams.psc_code || []}
                    onItemsChange={(codes) => {
                      setSearchParams((prev) => ({ ...prev, psc_code: codes }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(code) => code}
                    placeholder="Enter PSC codes..."
                    disableAutocomplete={true}
                  /> */}

                  {/* CFDA Number - Hidden (no GSI available, may implement later) */}
                  {/* <MultiSelectField<string>
                    label="CFDA Number"
                    selectedItems={searchParams.cfda_number || []}
                    onItemsChange={(numbers) => {
                      setSearchParams((prev) => ({ ...prev, cfda_number: numbers }));
                    }}
                    suggestions={[]}
                    onSearch={() => []}
                    renderItem={(number) => number}
                    placeholder="Enter CFDA numbers..."
                    disableAutocomplete={true}
                  /> */}

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
                            date_year: undefined,
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
                        recipient_location: 'Recipient Location',
                        amount: 'Amount',
                        period_start_date: 'Period Start Date',
                        period_end_date: 'Period End Date',
                        naics_code: 'NAICS Code',
                        psc_code: 'PSC Code',
                        last_updated: 'Last Modified',
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
                  <TableContainer data-tutorial="results-table" sx={{ 
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
                              <TableCell padding="none" sx={{ width: 40, padding: '8px 4px', color: '#9ca3af', fontWeight: 600 }}>
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
                              {visibleColumns.includes('recipient_location') && (
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontWeight: 600, 
                                  fontSize: '0.875rem',
                                }}>Recipient Location</TableCell>
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
                                }}>Last Modified</TableCell>
                              )}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {paginatedResults.map((award, index) => (
                              <TableRow
                                key={award.award_id}
                                onClick={(e) => handleAwardClick(e, award.award_id, index)}
                                onContextMenu={(e) => handleRowContextMenu(e, award.award_id)}
                                draggable={selectedAwards.has(award.award_id)}
                                onDragStart={(e) => handleDragStart(e, award.award_id)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  if (user?.id) {
                                    openItemDetails(
                                      'govt_contract',
                                      award,
                                      award.recipient_name 
                                        ? `Government Contract - ${award.recipient_name}${award.awarding_agency_name ? ` / ${award.awarding_agency_name}` : ''}`
                                        : `Government Contract ${award.award_id || ''}`,
                                      { user_id: user.id }
                                    );
                                  }
                                }}
                                sx={{
                                  backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                  '&:hover': {
                                    backgroundColor: selectedAwards.has(award.award_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                                  },
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                {/* Empty cell to maintain alignment */}
                                <TableCell sx={{ width: 40, padding: '8px 4px' }} />
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
                                {visibleColumns.includes('recipient_location') && (
                                  <TableCell sx={{ 
                                    color: '#ffffff', 
                                    fontSize: '0.875rem',
                                    padding: '12px',
                                  }}>
                                    {(() => {
                                      const state = award.recipient_location_state || award.recipient_state_name;
                                      const zip = award.recipient_zip_code;
                                      if (zip) {
                                        return state ? `${state}, ${zip}` : zip;
                                      }
                                      return state || 'N/A';
                                    })()}
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
                                    {formatDate(award.period_of_performance_start_date)}
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
                                    {formatLastUpdated(award.last_modified_date)}
                                  </TableCell>
                                )}
                                {/* Actions column removed - use double-click to open details */}
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
                selectedFilters.cfda.size > 0 ||
                selectedFilters.months.size > 0) && (
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                              prev.cfda.size > 0 ||
                              prev.months.size > 0;
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
                    {Array.from(selectedFilters.months).map((month, idx) => {
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      return (
                        <Chip
                          key={`month-${idx}`}
                          label={monthNames[month - 1]}
                          onDelete={() => {
                            setSelectedFilters(prev => {
                              const newSet = new Set(prev.months);
                              newSet.delete(month);
                              const hasAnyFilters = 
                                prev.award_types.size > 0 ||
                                prev.agencies.size > 0 ||
                                prev.recipients.size > 0 ||
                                prev.states.size > 0 ||
                                prev.countries.size > 0 ||
                                prev.naics.size > 0 ||
                              prev.psc.size > 0 ||
                              prev.cfda.size > 0 ||
                              prev.months.size > 0 ||
                              newSet.size > 0;
                              setIsFiltered(hasAnyFilters);
                              return { ...prev, months: newSet };
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
                      );
                    })}
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
                        months: new Set(),
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

                  {/* Month Filter */}
                  {availableFilters.month_filters && availableFilters.month_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, months: !prev.months }))}
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
                          Month ({availableFilters.month_filters.length})
                        </Typography>
                        {expandedFilters.months ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.months}>
                        <Box sx={{ 
                          mt: 1, 
                          maxHeight: 300, 
                          overflowY: 'auto',
                          '&::-webkit-scrollbar': {
                            width: '8px',
                          },
                          '&::-webkit-scrollbar-track': {
                            backgroundColor: 'rgba(55, 65, 81, 0.3)',
                          },
                          '&::-webkit-scrollbar-thumb': {
                            backgroundColor: 'rgba(107, 114, 128, 0.5)',
                            borderRadius: '4px',
                            '&:hover': {
                              backgroundColor: 'rgba(107, 114, 128, 0.7)',
                            },
                          },
                        }}>
                          {availableFilters.month_filters.map((filter) => {
                            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                            const isSelected = selectedFilters.months.has(filter.month);
                            return (
                              <Box
                                key={`month-${filter.month}`}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const newSet = new Set(prev.months);
                                    if (newSet.has(filter.month)) {
                                      newSet.delete(filter.month);
                                    } else {
                                      newSet.add(filter.month);
                                    }
                                    return {
                                      ...prev,
                                      months: newSet,
                                    };
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
                                  {monthNames[filter.month - 1]}
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
          disabled={selectedAwards.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context {selectedAwards.size > 0 ? `(${selectedAwards.size} item${selectedAwards.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleAddToFiles}
          disabled={selectedAwards.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files {selectedAwards.size > 0 ? `(${selectedAwards.size} item${selectedAwards.size > 1 ? 's' : ''})` : ''}
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