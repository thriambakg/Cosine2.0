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
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  ViewColumn as ViewColumnIcon,
  Visibility as VisibilityIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  AddComment as NewChatIcon,
} from '@mui/icons-material';
import { 
  congressBillsSearchAPI, 
  CongressBillsSearchFilters,
  CongressBill 
} from '../services/api';
import { politicianSuggestionsService } from '../services/politicianSuggestions';
import { policyAreaSuggestionsService } from '../services/policyAreaSuggestions';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import MultiSelectField from '../components/MultiSelectField';
import { addToContext } from '../components/tiles/common/contextManager';

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

// Minimum date for introduced date (January 3, 2025)
const MIN_INTRODUCED_DATE = '2025-01-03';

// Bipartisan options
const BIPARTISAN_OPTIONS = [
  { value: 1, label: 'Bipartisan' },
  { value: 0, label: 'Not Bipartisan' }
];

const CongressBillsSearchPage: React.FC = () => {
  const {} = useAuth();
  const {} = useGlobalChat();
  
  // Context menu state
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
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
    // Support both old sponsor_name and new politician_name for backward compatibility
    const politicianNames = saved?.politician_name || saved?.sponsor_name || [];
    return {
      bill_title: Array.isArray(saved?.bill_title) ? saved.bill_title : [],
      bill_type: Array.isArray(saved?.bill_type) ? saved.bill_type : [],
      politician_name: Array.isArray(politicianNames) ? politicianNames : [],
      politician_role: saved?.politician_role ? (Array.isArray(saved.politician_role) ? saved.politician_role.filter((r: string) => r !== 'both' && (r === 'sponsor' || r === 'cosponsor')) : (saved.politician_role !== 'both' && (saved.politician_role === 'sponsor' || saved.politician_role === 'cosponsor') ? [saved.politician_role] : [])) : [],
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
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<CongressBill | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState<boolean>(false);

  // Client-side filter state
  const [selectedFilters, setSelectedFilters] = useState<{
    bill_types: Set<string>;
    sponsor_parties: Set<string>;
    sponsor_states: Set<string>;
    policy_areas: Set<string>;
    congresses: Set<number>;
    bipartisan: Set<number>;
    politician_roles: Set<string>; // 'sponsor', 'cosponsor', 'both'
  }>(() => {
    const saved = savedState?.selectedFilters;
    if (saved) {
      return {
        bill_types: new Set(saved.bill_types || []),
        sponsor_parties: new Set(saved.sponsor_parties || []),
        sponsor_states: new Set(saved.sponsor_states || []),
        policy_areas: new Set(saved.policy_areas || []),
        congresses: new Set(saved.congresses || []),
        bipartisan: new Set(saved.bipartisan || []),
        politician_roles: new Set(saved.politician_roles || []),
      };
    }
    return {
      bill_types: new Set(),
      sponsor_parties: new Set(),
      sponsor_states: new Set(),
      policy_areas: new Set(),
      congresses: new Set(),
      bipartisan: new Set(),
      politician_roles: new Set(),
    };
  });

  const [availableFilters, setAvailableFilters] = useState<{
    bill_type_filters: Array<{ billType: string; count: number }>;
    sponsor_party_filters: Array<{ party: string; count: number }>;
    sponsor_state_filters: Array<{ state: string; count: number }>;
    policy_area_filters: Array<{ area: string; count: number }>;
    congress_filters: Array<{ congress: number; count: number }>;
    bipartisan_filters: Array<{ bipartisan: number; count: number }>;
  }>(savedState?.availableFilters || {
    bill_type_filters: [],
    sponsor_party_filters: [],
    sponsor_state_filters: [],
    policy_area_filters: [],
    congress_filters: [],
    bipartisan_filters: [],
  });

  const [expandedFilters, setExpandedFilters] = useState<{
    billTypes: boolean;
    sponsorParties: boolean;
    sponsorStates: boolean;
    policyAreas: boolean;
    congresses: boolean;
    bipartisan: boolean;
  }>(savedState?.expandedFilters || {
    billTypes: false,
    sponsorParties: false,
    sponsorStates: false,
    policyAreas: false,
    congresses: false,
    bipartisan: false,
  });

  const [isFiltered, setIsFiltered] = useState<boolean>(() => {
    const saved = savedState?.selectedFilters;
    if (saved) {
      return (
        (saved.bill_types && saved.bill_types.length > 0) ||
        (saved.sponsor_parties && saved.sponsor_parties.length > 0) ||
        (saved.sponsor_states && saved.sponsor_states.length > 0) ||
        (saved.policy_areas && saved.policy_areas.length > 0) ||
        (saved.congresses && saved.congresses.length > 0) ||
        (saved.bipartisan && saved.bipartisan.length > 0)
      );
    }
    return false;
  });

  // Compute available filters from results
  const computeFiltersFromResults = useCallback((results: CongressBill[]) => {
    const billTypeMap = new Map<string, number>();
    const sponsorPartyMap = new Map<string, number>();
    const sponsorStateMap = new Map<string, number>();
    const policyAreaMap = new Map<string, number>();
    const congressMap = new Map<number, number>();
    const bipartisanMap = new Map<number, number>();

    results.forEach((bill) => {
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

    setAvailableFilters({
      bill_type_filters: Array.from(billTypeMap.entries())
        .map(([billType, count]) => ({ billType, count }))
        .sort((a, b) => b.count - a.count),
      sponsor_party_filters: Array.from(sponsorPartyMap.entries())
        .map(([party, count]) => ({ party, count }))
        .sort((a, b) => b.count - a.count),
      sponsor_state_filters: Array.from(sponsorStateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      policy_area_filters: Array.from(policyAreaMap.entries())
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
      congress_filters: Array.from(congressMap.entries())
        .map(([congress, count]) => ({ congress, count }))
        .sort((a, b) => b.congress - a.congress), // Sort by congress number ascending
      bipartisan_filters: Array.from(bipartisanMap.entries())
        .map(([bipartisan, count]) => ({ bipartisan, count }))
        .sort((a, b) => a.bipartisan - b.bipartisan), // 0 (No) first, then 1 (Yes)
    });
  }, []);

  // Apply client-side filters
  const applyFilters = useCallback(() => {
    let filtered = [...allSearchResults];

    // Apply selected filters
    if (selectedFilters.bill_types.size > 0) {
      filtered = filtered.filter((bill) => 
        bill.bill_type && selectedFilters.bill_types.has(bill.bill_type)
      );
    }

    if (selectedFilters.sponsor_parties.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.sponsor_party && selectedFilters.sponsor_parties.has(bill.sponsor_party)
      );
    }

    if (selectedFilters.sponsor_states.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.sponsor_state && selectedFilters.sponsor_states.has(bill.sponsor_state)
      );
    }

    if (selectedFilters.policy_areas.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.policy_area && selectedFilters.policy_areas.has(bill.policy_area)
      );
    }

    if (selectedFilters.congresses.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.congress !== undefined && bill.congress !== null && selectedFilters.congresses.has(bill.congress)
      );
    }

    if (selectedFilters.bipartisan.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.bipartisan !== undefined && bill.bipartisan !== null && selectedFilters.bipartisan.has(bill.bipartisan)
      );
    }

    // Note: politician_roles filter is handled server-side via politician_role parameter
    // This client-side filter is for display purposes only if needed in the future

    setCurrentResults(filtered);
    setIsFiltered(
      selectedFilters.bill_types.size > 0 ||
      selectedFilters.sponsor_parties.size > 0 ||
      selectedFilters.sponsor_states.size > 0 ||
      selectedFilters.policy_areas.size > 0 ||
      selectedFilters.congresses.size > 0 ||
      selectedFilters.bipartisan.size > 0 ||
      selectedFilters.politician_roles.size > 0
    );
    setCurrentPage(1);
  }, [allSearchResults, selectedFilters]);
  
  // Column visibility state
  // Note: 'details' is always visible and not selectable (like SEC tile actions)
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
  
  // Policy area data loading state (for policy area autocomplete)
  const [isPolicyAreaDataLoaded, setIsPolicyAreaDataLoaded] = useState<boolean>(false);

  // Autocomplete state for Sponsor Name and Bill Title
  const [, setSponsorNameSuggestions] = useState<string[]>([]);
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

  // Load policy area data on component mount (for policy area autocomplete)
  useEffect(() => {
    const loadPolicyAreaData = async () => {
      try {
        console.log('📋 Loading policy area suggestions data for congress bills...');
        await policyAreaSuggestionsService.loadPolicyAreas();
        setIsPolicyAreaDataLoaded(true);
        console.log('✅ Policy area suggestions data loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load policy area suggestions:', error);
      }
    };
    loadPolicyAreaData();
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

  // Policy area search callback - mimic security autocomplete pattern
  const policyAreaSearch = useCallback((query: string): string[] => {
    if (!isPolicyAreaDataLoaded) {
      return [];
    }
    
    // If empty query or short query, return all policy areas (scrollable)
    if (!query || query.length < 1) {
      return policyAreaSuggestionsService.getAllPolicyAreas();
    }
    
    return policyAreaSuggestionsService.getSuggestions(query, 20);
  }, [isPolicyAreaDataLoaded]);

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
      
      console.log('🟢 [Search] Final politician_role (array format):', filters.politician_role);

      // Use default batch size for initial fetch
      const fetchPageSize = 10;
      
      const response = await congressBillsSearchAPI.search({
        filters,
        limit: fetchPageSize,
      });

      if (response.success) {
        const results = response.results || [];
        setAllSearchResults(results);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        // Compute available filters from results
        computeFiltersFromResults(results);
        // Only reset client-side filters when new search is performed (not when restoring from sessionStorage)
        // This allows filters to persist when navigating away and back
        if (!savedState?.selectedFilters) {
          setSelectedFilters({
            bill_types: new Set(),
            sponsor_parties: new Set(),
            sponsor_states: new Set(),
            policy_areas: new Set(),
            congresses: new Set(),
            bipartisan: new Set(),
            politician_roles: new Set(),
          });
          setIsFiltered(false);
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
  }, [searchParams, pageSize, computeFiltersFromResults]);

  // Load more results using cursor-based pagination
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
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

      // Use default batch size for load more
      const fetchPageSize = 10;
      
      const response = await congressBillsSearchAPI.search({
        filters,
        limit: fetchPageSize,
        last_evaluated_key: lastEvaluatedKey,
      });

      if (response.success) {
        const newResults = response.results || [];
        const updatedResults = [...allSearchResults, ...newResults];
        setAllSearchResults(updatedResults);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        
        // Update filters with new results
        computeFiltersFromResults(updatedResults);
      } else {
        setSearchError('Load more failed. Please try again.');
        setHasMore(false);
      }
    } catch (error: any) {
      console.error('Load more error:', error);
      setSearchError(error.message || 'An error occurred while loading more results.');
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, searchParams, allSearchResults, computeFiltersFromResults]);

  // Context menu handlers
  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    const selectedBillObjects = currentResults.filter(bill => 
      selectedBills.has(bill.bill_id)
    );

    if (selectedBillObjects.length === 0) return;

    // Format date helper
    const formatDate = (dateString?: string): string => {
      if (!dateString) return '';
      try {
        return new Date(dateString).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      } catch {
        return dateString;
      }
    };

    // Add bills to context
    selectedBillObjects.forEach((bill) => {
      const billId = bill.bill_id || `bill_${Date.now()}`;
      const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''} - ${bill.bill_title || 'Untitled Bill'}`.trim();
      const subtitle = bill.introduced_date 
        ? `${formatDate(bill.introduced_date)}${bill.sponsor_name ? ` • ${bill.sponsor_name}` : ''}${bill.congress ? ` • ${bill.congress}th Congress` : ''}`
        : bill.sponsor_name ? bill.sponsor_name : 'Congress Bill';
      
      const contextItem = {
        id: `congress_bill_${billId}_${Date.now()}`,
        type: 'congress_bill' as const,
        title,
        subtitle,
        data: bill,
        timestamp: Date.now(),
      };

      if (target === 'sidebar') {
        // Add to current sidebar session's context
        const event = new CustomEvent('add-to-sidebar-context', {
          detail: contextItem
        });
        window.dispatchEvent(event);
      } else {
        // Add to new chat
        addToContext(contextItem);
      }
    });

    setSelectedBills(new Set());
    handleContextMenuClose();
  };

  // Compute available filters when results are restored from sessionStorage
  useEffect(() => {
    if (allSearchResults.length > 0 && availableFilters.bill_type_filters.length === 0) {
      // If we have results but no available filters, compute them
      computeFiltersFromResults(allSearchResults);
    }
  }, [allSearchResults, availableFilters, computeFiltersFromResults]);

  // Apply filters when selectedFilters or allSearchResults change
  useEffect(() => {
    if (allSearchResults.length > 0) {
      applyFilters();
    } else {
      setCurrentResults([]);
    }
  }, [allSearchResults, selectedFilters, applyFilters]);

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
        // Convert Sets to arrays for JSON serialization
        selectedFilters: {
          bill_types: Array.from(selectedFilters.bill_types),
          sponsor_parties: Array.from(selectedFilters.sponsor_parties),
          sponsor_states: Array.from(selectedFilters.sponsor_states),
          policy_areas: Array.from(selectedFilters.policy_areas),
          congresses: Array.from(selectedFilters.congresses),
          bipartisan: Array.from(selectedFilters.bipartisan),
        },
        expandedFilters,
        availableFilters,
        isFiltered,
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
    selectedFilters,
    expandedFilters,
    availableFilters,
    isFiltered,
  ]);

  // Pagination - use filtered results if filters are applied, otherwise use all results
  const resultsToDisplay = isFiltered ? currentResults : allSearchResults;
  const totalPages = Math.ceil(resultsToDisplay.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = resultsToDisplay.slice(startIndex, endIndex);

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
                  {/* Politician Name - Free text multi-select with autocomplete */}
                  <MultiSelectField<string>
                    label="Politician Name"
                    selectedItems={(() => {
                      const names = Array.isArray(searchParams.politician_name) ? searchParams.politician_name : (searchParams.politician_name ? [searchParams.politician_name] : []);
                      if (!isPoliticianDataLoaded) return names;
                      
                      // Convert actual names to display format
                      return names.map(name => {
                        const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                        return politician ? politician.displayText : name;
                      });
                    })()}
                    onItemsChange={(politicians) => {
                      // Extract actual names from display text
                      const actualNames = politicians.map(politicianDisplay => {
                        const nameMatch = politicianDisplay.match(/^([^(]+)/);
                        return nameMatch ? nameMatch[1].trim() : politicianDisplay;
                      });
                      setSearchParams((prev) => ({ ...prev, politician_name: actualNames }));
                    }}
                    suggestions={isPoliticianDataLoaded ? 
                      politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : 
                      []
                    }
                    onSearch={sponsorNameSearch}
                    renderItem={(politicianDisplay) => politicianDisplay}
                    renderOptionCustom={(politicianDisplay) => {
                      // Extract the name part for display while keeping full display text
                      const nameMatch = politicianDisplay.match(/^([^(]+)/);
                      const name = nameMatch ? nameMatch[1].trim() : politicianDisplay;
                      const details = politicianDisplay.replace(name, '').trim();
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
                    getItemKey={(politician) => politician}
                    placeholder="Search politician names (sponsor or cosponsor)..."
                    allowCustomInput={false}
                    isLoading={!isPoliticianDataLoaded || sponsorNameLoading}
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
                      let dateValue = e.target.value || undefined;
                      // Validate: if date is before minimum, default to minimum
                      if (dateValue && dateValue < MIN_INTRODUCED_DATE) {
                        dateValue = MIN_INTRODUCED_DATE;
                      }
                      setSearchParams((prev) => ({
                        ...prev,
                        introduced_date_from: dateValue,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
                    }}
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

                  {/* Policy Area - Dropdown multi-select with autocomplete */}
                  <MultiSelectField<string>
                    label="Policy Area"
                    selectedItems={searchParams.policy_area || []}
                    onItemsChange={(areas) => {
                      setSearchParams((prev) => ({ ...prev, policy_area: areas }));
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
                        {/* Politician Role - Checkbox Multiselect */}
                        <Box>
                          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                            Politician Role
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {['Sponsor', 'Cosponsor'].map((role) => {
                              const roleKey = role.toLowerCase() as 'sponsor' | 'cosponsor';
                              const currentRoles = Array.isArray(searchParams.politician_role) 
                                ? searchParams.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
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
                                    console.log('🔵 Politician Role Checkbox Clicked:', {
                                      role: roleKey,
                                      isSelected,
                                      currentPoliticianRole: searchParams.politician_role,
                                      currentPoliticianRoleType: typeof searchParams.politician_role,
                                      currentPoliticianRoleIsArray: Array.isArray(searchParams.politician_role)
                                    });
                                    setSearchParams(prev => {
                                      const currentRoles = Array.isArray(prev.politician_role) 
                                        ? prev.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
                                        : [];
                                      console.log('🔵 Before update - currentRoles:', currentRoles);
                                      if (isSelected) {
                                        const newRoles = currentRoles.filter(r => r !== roleKey);
                                        console.log('🔵 Unselecting - newRoles:', newRoles);
                                        const result = { ...prev, politician_role: newRoles };
                                        console.log('🔵 After unselect - result.politician_role:', result.politician_role);
                                        return result;
                                      } else {
                                        const newRoles = [...currentRoles, roleKey];
                                        console.log('🔵 Selecting - newRoles:', newRoles);
                                        const result = { ...prev, politician_role: newRoles };
                                        console.log('🔵 After select - result.politician_role:', result.politician_role);
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

                        {/* Exact Bill Title - Free text multi-select with autocomplete */}
                        <MultiSelectField<string>
                          label="Exact Bill Title"
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
                          bill_title: [] as string[],
                          bill_type: [] as string[],
                          politician_name: [] as string[],
                          politician_role: [] as ('sponsor' | 'cosponsor')[],
                          introduced_date_from: '',
                          introduced_date_to: '',
                          policy_area: [] as string[],
                          sponsor_party: [] as string[],
                          sponsor_state: [] as string[],
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
                      <Tooltip title={`Add ${selectedBills.size > 0 ? `${selectedBills.size} bill(s)` : 'selected bills'} to context`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              if (selectedBills.size === 0) {
                                alert('Please select at least one bill to add to context');
                                return;
                              }
                              setContextMenuAnchor(e.currentTarget);
                            }}
                            disabled={selectedBills.size === 0}
                            sx={{ 
                              color: selectedBills.size > 0 ? '#10b981' : '#9ca3af', 
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
                        label={`${currentResults.length} bill${currentResults.length !== 1 ? 's' : ''} found`}
                        sx={{
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          border: '1px solid #22c55e',
                          fontWeight: 600,
                        }}
                      />
                    ) : isFiltered && allSearchResults.length > 0 ? (
                      <Chip
                        label={`0 of ${allSearchResults.length} bills match filters`}
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : allSearchResults.length === 0 && !isSearching ? (
                      <Chip
                        label="No bills found"
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
                    {/* Details column is always visible (not selectable) */}
                    <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Details</TableCell>
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
                      {/* Details column is always visible (not selectable) */}
                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                        <Tooltip title="View full bill details">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setSelectedBillForDetails(bill);
                              setDetailsDialogOpen(true);
                            }}
                            sx={{
                              color: '#3b82f6',
                              '&:hover': {
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                  </Table>
                </TableContainer>

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

                {/* Pagination */}
                {totalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                    <Typography sx={{ color: '#94a3b8' }}>
                      Showing {startIndex + 1}-{Math.min(endIndex, resultsToDisplay.length)} of {resultsToDisplay.length} results
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
            ) : (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography variant="h6" sx={{ color: '#9ca3af', mb: 2 }}>
                  No results found
                </Typography>
                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                  Try adjusting your search filters
                </Typography>
              </Box>
            )}
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
                Bill counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.bill_types.size > 0 ||
                selectedFilters.sponsor_parties.size > 0 ||
                selectedFilters.sponsor_states.size > 0 ||
                selectedFilters.policy_areas.size > 0 ||
                selectedFilters.congresses.size > 0 ||
                selectedFilters.bipartisan.size > 0) && (
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
                    {Array.from(selectedFilters.bill_types).map((type, idx) => (
                      <Chip
                        key={`bill-type-${idx}`}
                        label={type}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.bill_types);
                            newSet.delete(type);
                            const hasAnyFilters = 
                              newSet.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, bill_types: newSet };
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
                    {Array.from(selectedFilters.sponsor_parties).map((party, idx) => (
                      <Chip
                        key={`sponsor-party-${idx}`}
                        label={party}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.sponsor_parties);
                            newSet.delete(party);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              newSet.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, sponsor_parties: newSet };
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
                    {Array.from(selectedFilters.sponsor_states).map((state, idx) => (
                      <Chip
                        key={`sponsor-state-${idx}`}
                        label={state}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.sponsor_states);
                            newSet.delete(state);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              newSet.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, sponsor_states: newSet };
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
                    {Array.from(selectedFilters.policy_areas).map((area, idx) => (
                      <Chip
                        key={`policy-area-${idx}`}
                        label={area}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.policy_areas);
                            newSet.delete(area);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              newSet.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, policy_areas: newSet };
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
                    {Array.from(selectedFilters.congresses).map((congress, idx) => (
                      <Chip
                        key={`congress-${idx}`}
                        label={`Congress ${congress}`}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.congresses);
                            newSet.delete(congress);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              newSet.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, congresses: newSet };
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
                    {Array.from(selectedFilters.bipartisan).map((bipartisan, idx) => (
                      <Chip
                        key={`bipartisan-${idx}`}
                        label={bipartisan === 1 ? 'Bipartisan' : 'Not Bipartisan'}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.bipartisan);
                            newSet.delete(bipartisan);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              newSet.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, bipartisan: newSet };
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
                        bill_types: new Set(),
                        sponsor_parties: new Set(),
                        sponsor_states: new Set(),
                        policy_areas: new Set(),
                        congresses: new Set(),
                        bipartisan: new Set(),
                        politician_roles: new Set(),
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

              {/* Bill Types Filter */}
              {availableFilters.bill_type_filters && availableFilters.bill_type_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, billTypes: !prev.billTypes }))}
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
                      Bill Types
                    </Typography>
                    {expandedFilters.billTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.billTypes}>
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
                      {availableFilters.bill_type_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.bill_types.has(filter.billType);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.bill_types.has(filter.billType);
                                if (exists) {
                                  const newSet = new Set(prev.bill_types);
                                  newSet.delete(filter.billType);
                                  return { ...prev, bill_types: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    bill_types: new Set([...prev.bill_types, filter.billType]),
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
                              {filter.billType}
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

              {/* Sponsor Parties Filter */}
              {availableFilters.sponsor_party_filters && availableFilters.sponsor_party_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, sponsorParties: !prev.sponsorParties }))}
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
                      Sponsor Parties
                    </Typography>
                    {expandedFilters.sponsorParties ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.sponsorParties}>
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
                      {availableFilters.sponsor_party_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.sponsor_parties.has(filter.party);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.sponsor_parties.has(filter.party);
                                if (exists) {
                                  const newSet = new Set(prev.sponsor_parties);
                                  newSet.delete(filter.party);
                                  return { ...prev, sponsor_parties: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    sponsor_parties: new Set([...prev.sponsor_parties, filter.party]),
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
                              {filter.party}
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

              {/* Sponsor States Filter */}
              {availableFilters.sponsor_state_filters && availableFilters.sponsor_state_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, sponsorStates: !prev.sponsorStates }))}
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
                      Sponsor States
                    </Typography>
                    {expandedFilters.sponsorStates ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.sponsorStates}>
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
                      {availableFilters.sponsor_state_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.sponsor_states.has(filter.state);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.sponsor_states.has(filter.state);
                                if (exists) {
                                  const newSet = new Set(prev.sponsor_states);
                                  newSet.delete(filter.state);
                                  return { ...prev, sponsor_states: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    sponsor_states: new Set([...prev.sponsor_states, filter.state]),
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

              {/* Policy Areas Filter */}
              {availableFilters.policy_area_filters && availableFilters.policy_area_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, policyAreas: !prev.policyAreas }))}
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
                      Policy Areas
                    </Typography>
                    {expandedFilters.policyAreas ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.policyAreas}>
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
                      {availableFilters.policy_area_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.policy_areas.has(filter.area);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.policy_areas.has(filter.area);
                                if (exists) {
                                  const newSet = new Set(prev.policy_areas);
                                  newSet.delete(filter.area);
                                  return { ...prev, policy_areas: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    policy_areas: new Set([...prev.policy_areas, filter.area]),
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
                              {filter.area}
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

              {/* Congress Filter */}
              {availableFilters.congress_filters && availableFilters.congress_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, congresses: !prev.congresses }))}
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
                      Congress
                    </Typography>
                    {expandedFilters.congresses ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.congresses}>
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
                      {availableFilters.congress_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.congresses.has(filter.congress);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.congresses.has(filter.congress);
                                if (exists) {
                                  const newSet = new Set(prev.congresses);
                                  newSet.delete(filter.congress);
                                  return { ...prev, congresses: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    congresses: new Set([...prev.congresses, filter.congress]),
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
                              Congress {filter.congress}
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

              {/* Bipartisan Filter */}
              {availableFilters.bipartisan_filters && availableFilters.bipartisan_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, bipartisan: !prev.bipartisan }))}
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
                      Bipartisan
                    </Typography>
                    {expandedFilters.bipartisan ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.bipartisan}>
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
                      {availableFilters.bipartisan_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.bipartisan.has(filter.bipartisan);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.bipartisan.has(filter.bipartisan);
                                if (exists) {
                                  const newSet = new Set(prev.bipartisan);
                                  newSet.delete(filter.bipartisan);
                                  return { ...prev, bipartisan: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    bipartisan: new Set([...prev.bipartisan, filter.bipartisan]),
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
                              {filter.bipartisan === 1 ? 'Bipartisan' : 'Not Bipartisan'}
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

      {/* Bill Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => {
          setDetailsDialogOpen(false);
          setSelectedBillForDetails(null);
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
              <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600, mb: 1 }}>
                {selectedBillForDetails?.bill_title || 'Bill Details'}
              </Typography>
              {selectedBillForDetails?.bill_id && (
                <Typography variant="body2" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                  {selectedBillForDetails.bill_id}
                </Typography>
              )}
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
          {selectedBillForDetails && (
            <Box>
              {/* Bill Overview Section */}
              <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {/* Left Column: Sponsor & Bill Info */}
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Sponsor
                      </Typography>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {selectedBillForDetails.sponsor_full_name || 'N/A'}
                      </Typography>
                      {selectedBillForDetails.sponsor_party && selectedBillForDetails.sponsor_state && (
                        <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                          {selectedBillForDetails.sponsor_party} - {selectedBillForDetails.sponsor_state}
                        </Typography>
                      )}
                    </Box>
                    
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Bill Information
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {selectedBillForDetails.bill_type && selectedBillForDetails.bill_number && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Type:</strong> {selectedBillForDetails.bill_type}.{selectedBillForDetails.bill_number}
                          </Typography>
                        )}
                        {selectedBillForDetails.congress && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Congress:</strong> {selectedBillForDetails.congress}
                          </Typography>
                        )}
                        {selectedBillForDetails.policy_area && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Policy Area:</strong> {selectedBillForDetails.policy_area}
                          </Typography>
                        )}
                        {selectedBillForDetails.bipartisan !== undefined && selectedBillForDetails.bipartisan !== null && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Bipartisan:</strong> {selectedBillForDetails.bipartisan === 1 ? 'Yes' : 'No'}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                  
                  {/* Right Column: Dates & Actions */}
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                        Dates
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {selectedBillForDetails.introduced_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Introduced:</strong> {formatDate(selectedBillForDetails.introduced_date)}
                          </Typography>
                        )}
                        {selectedBillForDetails.latest_action_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Latest Action:</strong> {formatDate(selectedBillForDetails.latest_action_date)}
                          </Typography>
                        )}
                        {(selectedBillForDetails as any).update_date && (
                          <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                            <strong>Last Updated:</strong> {formatDate((selectedBillForDetails as any).update_date)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    
                    {(selectedBillForDetails as any).action_count !== undefined && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                          Actions
                        </Typography>
                        <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                          {(selectedBillForDetails as any).action_count || 0} action(s)
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Summary Section */}
              {(selectedBillForDetails as any).summary_text && (
                <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Summary
                  </Typography>
                  <Typography 
                    variant="body1" 
                    sx={{ 
                      color: '#e2e8f0', 
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                    dangerouslySetInnerHTML={{ 
                      __html: (selectedBillForDetails as any).summary_text?.replace(/\n/g, '<br />') || '' 
                    }}
                  />
                </Box>
              )}

              {/* Cosponsors Section */}
              {(selectedBillForDetails as any).cosponsor_count > 0 && (
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Cosponsors ({(selectedBillForDetails as any).cosponsor_count})
                  </Typography>
                  {(selectedBillForDetails as any).cosponsors_json && (() => {
                    try {
                      const cosponsors = JSON.parse((selectedBillForDetails as any).cosponsors_json);
                      return (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {Array.isArray(cosponsors) && cosponsors.map((cosponsor: any, idx: number) => (
                            <Chip
                              key={idx}
                              label={`${cosponsor.fullName || cosponsor.name || 'Unknown'} (${cosponsor.party || ''}-${cosponsor.state || ''})`}
                              sx={{
                                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                color: '#93c5fd',
                                border: '1px solid #3b82f6',
                              }}
                            />
                          ))}
                        </Box>
                      );
                    } catch (e) {
                      const cosponsorsStr = (selectedBillForDetails as any).cosponsors;
                      if (cosponsorsStr) {
                        return (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {cosponsorsStr.split('|').map((name: string, idx: number) => (
                              <Chip
                                key={idx}
                                label={name}
                                sx={{
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                  color: '#93c5fd',
                                  border: '1px solid #3b82f6',
                                }}
                              />
                            ))}
                          </Box>
                        );
                      }
                      return null;
                    }
                  })()}
                </Box>
              )}

              {/* Actions Section */}
              {(selectedBillForDetails as any).actions_json && (() => {
                try {
                  const actions = JSON.parse((selectedBillForDetails as any).actions_json);
                  if (Array.isArray(actions) && actions.length > 0) {
                    return (
                      <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                          Actions ({(selectedBillForDetails as any).action_count || actions.length})
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {actions.map((action: any, idx: number) => (
                            <Box
                              key={idx}
                              sx={{
                                p: 2,
                                backgroundColor: 'rgba(30, 41, 59, 0.5)',
                                borderRadius: '4px',
                                border: '1px solid #374151',
                              }}
                            >
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                <Typography variant="body2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                                  {action.actionDate && formatDate(action.actionDate)}
                                </Typography>
                                {action.type && (
                                  <Chip
                                    label={action.type}
                                    size="small"
                                    sx={{
                                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                      color: '#93c5fd',
                                      border: '1px solid #3b82f6',
                                    }}
                                  />
                                )}
                              </Box>
                              {action.text && (
                                <Typography variant="body1" sx={{ color: '#e2e8f0', mt: 1 }}>
                                  {action.text}
                                </Typography>
                              )}
                              {action.committees && Array.isArray(action.committees) && action.committees.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                    Committees:
                                  </Typography>
                                  {action.committees.map((committee: any, cIdx: number) => (
                                    <Typography key={cIdx} variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                                      • {committee.name || committee.systemCode}
                                    </Typography>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    );
                  }
                } catch (e) {
                  // If parsing fails, show the summary text
                  if ((selectedBillForDetails as any).actions_summary) {
                    return (
                      <Box sx={{ mb: 4 }}>
                        <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                          Actions Summary
                        </Typography>
                        <Typography variant="body1" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                          {(selectedBillForDetails as any).actions_summary}
                        </Typography>
                      </Box>
                    );
                  }
                }
                return null;
              })()}

              {/* Additional Details */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                  Additional Information
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  {(selectedBillForDetails as any).origin_chamber && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Origin Chamber
                      </Typography>
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        {(selectedBillForDetails as any).origin_chamber}
                      </Typography>
                    </Box>
                  )}
                  {(selectedBillForDetails as any).amendment_count !== undefined && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Amendments
                      </Typography>
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        {(selectedBillForDetails as any).amendment_count || 0}
                      </Typography>
                    </Box>
                  )}
                  {(selectedBillForDetails as any).bill_url && (
                    <Box sx={{ gridColumn: 'span 2' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                        Bill URL
                      </Typography>
                      <Typography
                        variant="body2"
                        component="a"
                        href={(selectedBillForDetails as any).bill_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{
                          color: '#3b82f6',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {(selectedBillForDetails as any).bill_url}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => {
              setDetailsDialogOpen(false);
              setSelectedBillForDetails(null);
            }}
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

export default CongressBillsSearchPage;

