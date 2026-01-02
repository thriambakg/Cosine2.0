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
  Link,
  Pagination,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  Launch as LaunchIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { newsSearchAPI, NewsSearchRequest, NewsArticle } from '../services/api';
import { filesystemAPI } from '../services/api';
import { useAuth } from '@/contexts/AuthContext';
// import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { addArticleToContext, addMultipleArticlesToContext } from '../components/tiles/common';
import MultiSelectField from '../components/MultiSelectField';
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

// Filter expand state interface
interface ExpandedFiltersState {
  sources: boolean;
  categories: boolean;
  countries: boolean;
}

const NewsSearchPage: React.FC = () => {
  // Auth context available for future use
  const { user } = useAuth();
  // const { activeSessionId } = useGlobalChat();
  
  // Session persistence key
  const SESSION_STORAGE_KEY = 'news-search-page-state';

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
  
  // Search state - only keywords are sent to API, others are for client-side filtering
  const [searchParams, setSearchParams] = useState<{
    keywords?: string[];
    sources?: string[];
    categories?: string[];
    countries?: string[];
    dateRange?: '12h' | '24h' | '7d' | '30d' | 'all';
    dateFrom?: string;
    dateTo?: string;
  }>(
    savedState?.searchParams || {
      keywords: [],
      sources: [],
      categories: [],
      countries: [],
      dateRange: 'all',
      dateFrom: '',
      dateTo: '',
    }
  );
  
  const [allSearchResults, setAllSearchResults] = useState<NewsArticle[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<NewsArticle[]>([]);
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [isSearching, setIsSearching] = useState<boolean>(savedState?.isSearching || false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<{ published_date?: string; SK?: string } | null>(
    savedState?.lastEvaluatedKey || null
  );
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 50);
  
  // Dialog state for article details
  // const { openItemDetails } = useDialogManagerHelpers(); // Unused for now
  
  // Selection state
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  
  // Filter state (client-side filtering)
  const [availableFilters, setAvailableFilters] = useState<{
    source_filters?: Array<{ source: string; count: number }>;
    category_filters?: Array<{ category: string; count: number }>;
    country_filters?: Array<{ country: string; count: number }>;
  }>(savedState?.availableFilters || {});
  
  const [expandedFilters, setExpandedFilters] = useState<ExpandedFiltersState>(
    savedState?.expandedFilters || {
      sources: false,
      categories: false,
      countries: false,
    }
  );
  
  const [selectedFilters, setSelectedFilters] = useState<{
    sources: string[];
    categories: string[];
    countries: string[];
  }>({
    sources: savedState?.selectedFilters?.sources || [],
    categories: savedState?.selectedFilters?.categories || [],
    countries: savedState?.selectedFilters?.countries || [],
  });
  
  const [isFiltered, setIsFiltered] = useState<boolean>(savedState?.isFiltered || false);
  const [searchFormExpanded, setSearchFormExpanded] = useState<boolean>(savedState?.searchFormExpanded !== undefined ? savedState.searchFormExpanded : true);
  
  // Log state restoration
  useEffect(() => {
    if (savedState) {
      console.log('🔄 Restored news search page state from sessionStorage:', {
        hasSearchParams: !!savedState.searchParams,
        allResultsCount: savedState.allSearchResults?.length || 0,
        totalFound: savedState.totalFound || 0,
        hasFilters: !!savedState.selectedFilters,
        hasMore: savedState.hasMore,
        hasLastEvaluatedKey: !!savedState.lastEvaluatedKey,
      });
    } else {
      console.log('🆕 Starting fresh news search page session');
    }
  }, []); // Only log once on mount
  
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
      };
      
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving news search page state:', error);
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
  ]);
  
  // Compute filters from search results
  const computeFiltersFromResults = (results: NewsArticle[]) => {
    const sourceMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    
    results.forEach(article => {
      if (article.source_name) {
        sourceMap.set(article.source_name, (sourceMap.get(article.source_name) || 0) + 1);
      }
      if (article.category) {
        categoryMap.set(article.category, (categoryMap.get(article.category) || 0) + 1);
      }
      if (article.country) {
        countryMap.set(article.country, (countryMap.get(article.country) || 0) + 1);
      }
    });
    
    return {
      source_filters: Array.from(sourceMap.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      category_filters: Array.from(categoryMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      country_filters: Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count),
    };
  };
  
  // Client-side filtering function
  const applyFilters = useCallback(() => {
    let filtered = [...allSearchResults];
    
    // Filter by sources
    if (selectedFilters.sources.length > 0) {
      filtered = filtered.filter(article => 
        selectedFilters.sources.includes(article.source_name || '')
      );
    }
    
    // Filter by categories
    if (selectedFilters.categories.length > 0) {
      filtered = filtered.filter(article => 
        selectedFilters.categories.includes(article.category || '')
      );
    }
    
    // Filter by countries
    if (selectedFilters.countries.length > 0) {
      filtered = filtered.filter(article => 
        selectedFilters.countries.includes(article.country || '')
      );
    }
    
    setCurrentResults(filtered);
    setIsFiltered(selectedFilters.sources.length > 0 || 
                  selectedFilters.categories.length > 0 || 
                  selectedFilters.countries.length > 0);
  }, [allSearchResults, selectedFilters]);
  
  // Apply filters when selectedFilters or allSearchResults change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);
  
  // Perform search - fetch first batch of results (load more available)
  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    setAllSearchResults([]);
    setCurrentResults([]);
    setLastEvaluatedKey(null);
    setHasMore(false);
    
    try {
      const fetchPageSize = 50; // Use smaller page size for better pagination
      
      // Build search request - only keywords are sent to API (same logic as NewsTile)
      const searchRequest: NewsSearchRequest = {
        query: {
          keywords: searchParams.keywords && searchParams.keywords.length > 0
            ? searchParams.keywords
            : undefined,
        },
        dateRange: searchParams.dateRange || 'all',
        dateFrom: searchParams.dateFrom || undefined,
        dateTo: searchParams.dateTo || undefined,
        limit: fetchPageSize,
      };
      
      console.log('🔍 News Search Request:', {
        searchParams,
        note: 'Only keywords sent to API - sources/categories/countries used for client-side filtering',
        finalRequest: searchRequest
      });
      
      const response = await newsSearchAPI.searchNews(searchRequest);
      
      if (response.articles) {
        // Ensure each article has an id
        const processedResults = response.articles.map((article, index) => ({
          ...article,
          id: article.id || `article_${index}_${Date.now()}`,
        }));
        
        setAllSearchResults(processedResults);
        setTotalFound(response.total || processedResults.length);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        
        // Compute filters from results
        const computedFilters = computeFiltersFromResults(processedResults);
        setAvailableFilters(computedFilters);
        setIsFiltered(false);
      } else {
        setSearchError('Search failed - no articles returned');
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
  
  // Load more results using cursor-based pagination
  const handleLoadMore = async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
    try {
      const fetchPageSize = 50; // Use same page size as initial search
      
      // Build search request - only keywords are sent to API (same logic as NewsTile)
      const searchRequest: NewsSearchRequest = {
        query: {
          keywords: searchParams.keywords && searchParams.keywords.length > 0
            ? searchParams.keywords
            : undefined,
        },
        dateRange: searchParams.dateRange || 'all',
        dateFrom: searchParams.dateFrom || undefined,
        dateTo: searchParams.dateTo || undefined,
        limit: fetchPageSize,
        lastEvaluatedKey: lastEvaluatedKey, // Cursor for pagination
      };
      
      console.log('📥 Load More Request:', {
        searchParams,
        lastEvaluatedKey,
        note: 'Loading next batch using cursor'
      });
      
      const response = await newsSearchAPI.searchNews(searchRequest);
      
      if (response.articles && response.articles.length > 0) {
        // Ensure each article has an id
        const processedResults = response.articles.map((article, index) => ({
          ...article,
          id: article.id || `article_${index}_${Date.now()}`,
        }));
        
        // Append new results to existing results
        setAllSearchResults(prev => {
          const updated = [...prev, ...processedResults];
          // Recompute filters from all results
          const computedFilters = computeFiltersFromResults(updated);
          setAvailableFilters(computedFilters);
          
          // Update totalFound if API provides total count, otherwise use loaded count
          if (response.total !== undefined) {
            setTotalFound(response.total);
          } else {
            // If no total provided, update to reflect total loaded
            setTotalFound(updated.length);
          }
          
          return updated;
        });
        
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
      } else {
        setSearchError('Load more failed - no articles returned');
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

  const handleAddToContext = () => {
    const selectedArticleObjects = currentResults.filter(article => 
      selectedArticles.has(article.id)
    );

    if (selectedArticleObjects.length === 0) return;

    // Use the article context manager functions
    if (selectedArticleObjects.length === 1) {
      const article = selectedArticleObjects[0];
      addArticleToContext(
        article.id,
        article.title,
        article.source_name || article.source_url || 'Unknown',
        article
      );
    } else {
      addMultipleArticlesToContext(
        selectedArticleObjects.map(article => ({
          articleId: article.id,
          title: article.title,
          source: article.source_name || article.source_url || 'Unknown',
          articleData: article,
        }))
      );
    }

    setSelectedArticles(new Set());
    handleContextMenuClose();
  };

  const handleAddToFiles = () => {
    if (selectedArticles.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedArticles.size === 0) return;
    
    try {
      const selectedArticleObjects = currentResults.filter(article => 
        selectedArticles.has(article.id)
      );

      // Save each article to the filesystem with FULL data
      // Note: currentResults contains the full article objects from the search API
      // This ensures we save the complete article with all fields
      for (const article of selectedArticleObjects) {
        const title = article.title || `News Article ${article.id || ''}`;
        
        // FULL DATA MODE for filesystem - send complete article object with ALL fields
        // Unlike chat agent context (which uses partial data), filesystem needs full data
        // because it doesn't have database access to fetch missing fields
        await filesystemAPI.addContextItem({
          user_id: user.id,
          folder_path: folderPath,
          context_data: article, // Full article object with all fields
          title: title,
          item_type: 'news_article',
        });
      }
      
      console.log(`✅ Saved ${selectedArticleObjects.length} article(s) to filesystem`);
      setSelectedArticles(new Set());
    } catch (error) {
      console.error('Error saving articles to filesystem:', error);
    }
  };
  
  const toggleArticleSelection = (articleId: string) => {
    setSelectedArticles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(articleId)) {
        newSet.delete(articleId);
      } else {
        newSet.add(articleId);
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

  // Calculate pagination values
  const totalPages = Math.ceil(currentResults.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = currentResults.slice(startIndex, endIndex);

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 4, fontWeight: 600 }}>
          News Articles Search
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
                  {/* Keywords Search Parameter */}
                  <MultiSelectField<string>
                    label="Keywords"
                    selectedItems={searchParams.keywords || []}
                    onItemsChange={(keywords) => {
                      setSearchParams(prev => ({ ...prev, keywords }));
                    }}
                    suggestions={[]}
                    onSearch={() => {
                      return [];
                    }}
                    renderItem={(keyword) => keyword}
                    placeholder="Enter keywords to search..."
                    allowCustomInput={true}
                  />

                  {/* Date Range Preset */}
                  <FormControl fullWidth>
                    <InputLabel sx={{ color: '#94a3b8' }}>Date Range (Preset)</InputLabel>
                    <Select
                      value={searchParams.dateRange || 'all'}
                      onChange={(e) => {
                        setSearchParams(prev => ({ 
                          ...prev, 
                          dateRange: e.target.value as '12h' | '24h' | '7d' | '30d' | 'all',
                          // Clear custom dates when using preset
                          dateFrom: '',
                          dateTo: '',
                        }));
                      }}
                      label="Date Range (Preset)"
                      sx={{
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#64748b' },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                        '& .MuiSelect-icon': { color: '#94a3b8' },
                      }}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            backgroundColor: '#1e293b',
                            '& .MuiMenuItem-root': {
                              color: '#ffffff',
                              '&:hover': { backgroundColor: '#334155' },
                              '&.Mui-selected': { backgroundColor: '#3b82f6' },
                            },
                          },
                        },
                      }}
                    >
                      <MenuItem value="12h">Last 12 Hours</MenuItem>
                      <MenuItem value="24h">Last 24 Hours</MenuItem>
                      <MenuItem value="7d">Last 7 Days</MenuItem>
                      <MenuItem value="30d">Last 30 Days</MenuItem>
                      <MenuItem value="all">All Time</MenuItem>
                    </Select>
                  </FormControl>

                  {/* Custom Date Range */}
                  <Typography variant="body2" sx={{ color: '#9ca3af', mt: 1, mb: 1 }}>
                    Or specify custom date range:
                  </Typography>
                  
                  <TextField
                    label="Date From"
                    type="date"
                    value={searchParams.dateFrom || ''}
                    onChange={(e) => {
                      setSearchParams(prev => ({ 
                        ...prev, 
                        dateFrom: e.target.value,
                        // Clear preset when using custom dates
                        dateRange: e.target.value ? undefined : (prev.dateRange || 'all'),
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

                  <TextField
                    label="Date To"
                    type="date"
                    value={searchParams.dateTo || ''}
                    onChange={(e) => {
                      setSearchParams(prev => ({ 
                        ...prev, 
                        dateTo: e.target.value,
                        // Clear preset when using custom dates
                        dateRange: e.target.value ? undefined : (prev.dateRange || 'all'),
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
                          sources: [],
                          categories: [],
                          countries: [],
                          dateRange: 'all',
                          dateFrom: '',
                          dateTo: '',
                        });
                        setSelectedFilters({
                          sources: [],
                          categories: [],
                          countries: [],
                        });
                        setAllSearchResults([]);
                        setTotalFound(0);
                        setSelectedArticles(new Set());
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
                      <Tooltip title={`Add ${selectedArticles.size > 0 ? `${selectedArticles.size} article(s)` : 'selected articles'} to context`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleContextMenuClick}
                            disabled={selectedArticles.size === 0}
                            sx={{ 
                              color: selectedArticles.size > 0 ? '#10b981' : '#9ca3af', 
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
                        label={`${currentResults.length} article${currentResults.length !== 1 ? 's' : ''} found`}
                        sx={{
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          border: '1px solid #22c55e',
                          fontWeight: 600,
                        }}
                      />
                    ) : isFiltered && allSearchResults.length > 0 ? (
                      <Chip
                        label={`0 of ${allSearchResults.length} articles match filters`}
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : allSearchResults.length === 0 && !isSearching ? (
                      <Chip
                        label="No articles found"
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
                                  indeterminate={selectedArticles.size > 0 && selectedArticles.size < paginatedResults.length}
                                  checked={paginatedResults.length > 0 && selectedArticles.size === paginatedResults.length}
                                  onChange={() => {
                                    if (selectedArticles.size === paginatedResults.length) {
                                      const newSelected = new Set(selectedArticles);
                                      paginatedResults.forEach(article => newSelected.delete(article.id));
                                      setSelectedArticles(newSelected);
                                    } else {
                                      const newSelected = new Set(selectedArticles);
                                      paginatedResults.forEach(article => newSelected.add(article.id));
                                      setSelectedArticles(newSelected);
                                    }
                                  }}
                                  sx={{ 
                                    color: '#9ca3af', 
                                    '&.Mui-checked': { color: '#10b981' }, 
                                    '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                                  }}
                                />
                              </TableCell>
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                                width: 400,
                                minWidth: 400,
                              }}>Title</TableCell>
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                                width: 150,
                                minWidth: 150,
                              }}>Source</TableCell>
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                                width: 120,
                                minWidth: 120,
                              }}>Category</TableCell>
                              <TableCell sx={{ 
                                color: '#9ca3af', 
                                fontWeight: 600, 
                                fontSize: '0.875rem',
                                width: 120,
                                minWidth: 120,
                              }}>Date</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {paginatedResults.map((article) => (
                              <TableRow
                                key={article.id}
                                sx={{
                                  backgroundColor: selectedArticles.has(article.id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                  '&:hover': {
                                    backgroundColor: selectedArticles.has(article.id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                                  },
                                  cursor: 'pointer',
                                }}
                                onClick={() => toggleArticleSelection(article.id)}
                              >
                                <TableCell sx={{ 
                                  padding: '8px 12px',
                                  width: 50,
                                  minWidth: 50,
                                  maxWidth: 50,
                                }}>
                                  <Checkbox
                                    size="small"
                                    checked={selectedArticles.has(article.id)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleArticleSelection(article.id);
                                    }}
                                    sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                                  />
                                </TableCell>
                                <TableCell sx={{ 
                                  color: '#ffffff', 
                                  fontSize: '0.875rem',
                                  width: 400,
                                  minWidth: 400,
                                  padding: '12px',
                                }}>
                                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                                    {/* Image on the left */}
                                    {article.image_url ? (
                                      <Box
                                        component="img"
                                        src={article.image_url}
                                        alt={article.title || 'Article image'}
                                        sx={{
                                          width: 120,
                                          height: 80,
                                          objectFit: 'cover',
                                          borderRadius: '4px',
                                          flexShrink: 0,
                                          cursor: 'pointer',
                                          '&:hover': {
                                            opacity: 0.8,
                                          },
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(article.image_url, '_blank', 'noopener,noreferrer');
                                        }}
                                      />
                                    ) : (
                                      <Box
                                        sx={{
                                          width: 120,
                                          height: 80,
                                          backgroundColor: 'rgba(55, 65, 81, 0.5)',
                                          borderRadius: '4px',
                                          flexShrink: 0,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.7rem' }}>
                                          No Image
                                        </Typography>
                                      </Box>
                                    )}
                                    {/* Title on the right */}
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                      {article.source_url ? (
                                        <Tooltip title="Click to open article" arrow>
                                          <Link
                                            href={article.source_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            sx={{
                                              color: '#3b82f6',
                                              textDecoration: 'none',
                                              fontWeight: 500,
                                              fontSize: '0.875rem',
                                              display: 'flex',
                                              alignItems: 'flex-start',
                                              gap: 0.5,
                                              '&:hover': {
                                                color: '#60a5fa',
                                                textDecoration: 'underline',
                                              },
                                              cursor: 'pointer',
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Typography 
                                              variant="body2" 
                                              sx={{ 
                                                flex: 1,
                                                display: '-webkit-box',
                                                WebkitLineClamp: 3,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                                lineHeight: 1.4,
                                              }}
                                            >
                                              {article.title}
                                            </Typography>
                                            <LaunchIcon sx={{ fontSize: '0.75rem', flexShrink: 0, mt: 0.5 }} />
                                          </Link>
                                        </Tooltip>
                                      ) : (
                                        <Typography 
                                          variant="body2" 
                                          title={article.title} 
                                          sx={{ 
                                            color: '#ffffff',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 3,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                            lineHeight: 1.4,
                                          }}
                                        >
                                          {article.title}
                                        </Typography>
                                      )}
                                    </Box>
                                  </Box>
                                </TableCell>
                                <TableCell sx={{ 
                                  color: '#ffffff', 
                                  fontSize: '0.875rem',
                                  width: 150,
                                  minWidth: 150,
                                  padding: '8px 12px',
                                }}>
                                  <Typography variant="body2" noWrap title={article.source_name || 'N/A'}>
                                    {article.source_name || 'N/A'}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ 
                                  fontSize: '0.875rem',
                                  width: 120,
                                  minWidth: 120,
                                  padding: '8px 12px',
                                }}>
                                  {article.category ? (
                                    <Chip
                                      label={article.category}
                                      size="small"
                                      sx={{
                                        backgroundColor: '#3b82f6',
                                        color: '#ffffff',
                                        fontSize: '0.75rem',
                                      }}
                                    />
                                  ) : (
                                    <Typography sx={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                      N/A
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell sx={{ 
                                  color: '#9ca3af', 
                                  fontSize: '0.875rem',
                                  width: 120,
                                  minWidth: 120,
                                  padding: '8px 12px',
                                }}>
                                  {formatDate(article.published_date)}
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
                          ? 'No articles match the selected filters. Try adjusting your filters.'
                          : 'No articles found. Try adjusting your search parameters.'}
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
                    Article counts shown in <Chip label="#" size="small" sx={{ 
                      height: 18, 
                      fontSize: '0.7rem',
                      backgroundColor: 'rgba(107, 114, 128, 0.3)',
                      color: '#9ca3af',
                      border: '1px solid #6b7280',
                    }} />
                  </Typography>

                  {/* Selected Filters Box */}
                  {(selectedFilters.sources.length > 0 ||
                    selectedFilters.categories.length > 0 ||
                    selectedFilters.countries.length > 0) && (
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
                        {selectedFilters.sources.map((source, idx) => (
                          <Chip
                            key={`source-${idx}`}
                            label={source}
                            onDelete={() => {
                              setSelectedFilters(prev => {
                                const newSources = prev.sources.filter((_, i) => i !== idx);
                                const hasAnyFilters = 
                                  newSources.length > 0 ||
                                  prev.categories.length > 0 ||
                                  prev.countries.length > 0;
                                setIsFiltered(hasAnyFilters);
                                return {
                                  ...prev,
                                  sources: newSources,
                                };
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
                        {selectedFilters.categories.map((category, idx) => (
                          <Chip
                            key={`category-${idx}`}
                            label={category}
                            onDelete={() => {
                              setSelectedFilters(prev => {
                                const newCategories = prev.categories.filter((_, i) => i !== idx);
                                const hasAnyFilters = 
                                  prev.sources.length > 0 ||
                                  newCategories.length > 0 ||
                                  prev.countries.length > 0;
                                setIsFiltered(hasAnyFilters);
                                return {
                                  ...prev,
                                  categories: newCategories,
                                };
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
                        {selectedFilters.countries.map((country, idx) => (
                          <Chip
                            key={`country-${idx}`}
                            label={country}
                            onDelete={() => {
                              setSelectedFilters(prev => {
                                const newCountries = prev.countries.filter((_, i) => i !== idx);
                                const hasAnyFilters = 
                                  prev.sources.length > 0 ||
                                  prev.categories.length > 0 ||
                                  newCountries.length > 0;
                                setIsFiltered(hasAnyFilters);
                                return {
                                  ...prev,
                                  countries: newCountries,
                                };
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
                            sources: [],
                            categories: [],
                            countries: [],
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

                  {/* Sources Filter */}
                  {availableFilters.source_filters && availableFilters.source_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, sources: !prev.sources }))}
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
                          Sources
                        </Typography>
                        {expandedFilters.sources ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.sources}>
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
                          {availableFilters.source_filters.map((filter, idx) => {
                            const isSelected = selectedFilters.sources.includes(filter.source);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.sources.includes(filter.source);
                                    if (exists) {
                                      return {
                                        ...prev,
                                        sources: prev.sources.filter(s => s !== filter.source),
                                      };
                                    } else {
                                      return {
                                        ...prev,
                                        sources: [...prev.sources, filter.source],
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
                                  {filter.source}
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

                  {/* Categories Filter */}
                  {availableFilters.category_filters && availableFilters.category_filters.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Box
                        onClick={() => setExpandedFilters(prev => ({ ...prev, categories: !prev.categories }))}
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
                          Categories
                        </Typography>
                        {expandedFilters.categories ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                      </Box>
                      <Collapse in={expandedFilters.categories}>
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
                          {availableFilters.category_filters.map((filter, idx) => {
                            const isSelected = selectedFilters.categories.includes(filter.category);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.categories.includes(filter.category);
                                    if (exists) {
                                      return {
                                        ...prev,
                                        categories: prev.categories.filter(c => c !== filter.category),
                                      };
                                    } else {
                                      return {
                                        ...prev,
                                        categories: [...prev.categories, filter.category],
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
                                  {filter.category}
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
                          {availableFilters.country_filters.map((filter, idx) => {
                            const isSelected = selectedFilters.countries.includes(filter.country);
                            return (
                              <Box
                                key={idx}
                                onClick={() => {
                                  setSelectedFilters(prev => {
                                    const exists = prev.countries.includes(filter.country);
                                    if (exists) {
                                      return {
                                        ...prev,
                                        countries: prev.countries.filter(c => c !== filter.country),
                                      };
                                    } else {
                                      return {
                                        ...prev,
                                        countries: [...prev.countries, filter.country],
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
        <MenuItem onClick={handleAddToContext} sx={{ color: '#3b82f6', fontWeight: 600 }}>
          <SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} />
          Add to Context
        </MenuItem>
        <MenuItem onClick={handleAddToFiles} sx={{ fontWeight: 600 }}>
          <FolderIcon sx={{ color: '#fbbf24', mr: 1, fontSize: 18 }} />
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

export default NewsSearchPage;

