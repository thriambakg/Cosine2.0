import React, { useState, useEffect } from 'react';
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
  Chip,
  Tooltip,
  Link,
  Autocomplete,
  Collapse,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Search as SearchIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  OpenInNew as OpenInNewIcon,
  Article as ArticleIcon,
  CalendarToday as CalendarIcon,
  Visibility as VisibilityIcon,
  Close as CloseIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { newsSearchAPI, NewsSearchRequest, NewsArticle } from '../services/api';
import { addArticleToContext, addMultipleArticlesToContext } from '../components/tiles/common';

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

const DEFAULT_COLUMNS = [
  'Title',
  'Source',
  'Published Date',
  'Category',
  'Description',
];

// Date range options
const DATE_RANGES = [
  { value: '12h', label: 'Last 12 Hours' },
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'all', label: 'All Time' },
];

// News Filters interface with expression arrays
interface NewsFilters {
  keywordExpression?: any[];
  sourceExpression?: any[];
  categoryExpression?: any[];
  countryExpression?: any[];
  dateRange: '12h' | '24h' | '7d' | '30d' | 'all';
}

const NewsSearchPage: React.FC = () => {
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

  // Initialize state from sessionStorage immediately (using function initializer)
  const savedState = loadStateFromStorage();
  
  // Filter state with expressions
  const [filters, setFilters] = useState<NewsFilters>(
    savedState?.filters || {
      keywordExpression: [],
      sourceExpression: [],
      categoryExpression: [],
      countryExpression: [],
      dateRange: '12h',
    }
  );
  
  // Input values for expression filters
  const [keywordInputValue, setKeywordInputValue] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  
  const [sourceInputValue, setSourceInputValue] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedSourceGroupIndex, setSelectedSourceGroupIndex] = useState<number | null>(null);
  
  const [categoryInputValue, setCategoryInputValue] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCategoryGroupIndex, setSelectedCategoryGroupIndex] = useState<number | null>(null);
  
  const [countryInputValue, setCountryInputValue] = useState('');
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedCountryGroupIndex, setSelectedCountryGroupIndex] = useState<number | null>(null);

  // Validation error states
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [countryError, setCountryError] = useState<string | null>(null);
  
  // Category and country options
  const categoryOptions = [
    'business',
    'technology',
    'politics',
    'science',
    'health',
    'finance',
    'energy',
    'automotive',
    'pharmaceuticals',
    'retail',
  ];
  
  const countryOptions = [
    'us',
    'uk',
    'eu',
    'china',
    'japan',
    'canada',
    'australia',
    'global',
  ];
  
  const [allSearchResults, setAllSearchResults] = useState<NewsArticle[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<NewsArticle[]>([]);
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [isSearching, setIsSearching] = useState<boolean>(savedState?.isSearching || false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 50);
  
  // Selection state
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Column visibility
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    savedState?.selectedColumns || DEFAULT_COLUMNS
  );
  
  // Search section collapse state
  const [searchExpanded, setSearchExpanded] = useState<boolean>(
    savedState?.searchExpanded !== undefined ? savedState.searchExpanded : true
  );
  
  // Description dialog state
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState<boolean>(false);
  const [selectedArticleForDescription, setSelectedArticleForDescription] = useState<NewsArticle | null>(null);
  
  // Helper function to clean up trailing operators from expressions
  const cleanupTrailingOperators = (expression: any[]) => {
    if (!expression || expression.length === 0) return expression;
    
    // Remove trailing operators
    let cleaned = [...expression];
    while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.type === 'operator') {
      cleaned.pop();
    }
    
    return cleaned;
  };

  // Helper function to clean up all filter expressions
  const cleanupAllExpressions = (filters: NewsFilters): NewsFilters => {
    return {
      ...filters,
      keywordExpression: cleanupTrailingOperators(filters.keywordExpression || []),
      sourceExpression: cleanupTrailingOperators(filters.sourceExpression || []),
      categoryExpression: cleanupTrailingOperators(filters.categoryExpression || []),
      countryExpression: cleanupTrailingOperators(filters.countryExpression || []),
    };
  };

  // Helper function to convert frontend expression to backend query format
  const convertExpressionToQuery = (expression: any[]): any => {
    if (!expression || expression.length === 0) return null;
    
    if (expression.length === 1) {
      const item = expression[0];
      if (item.type === 'keyword' || item.type === 'source' || item.type === 'category' || item.type === 'country') {
        return {
          type: 'term',
          field: item.type === 'keyword' ? 'keywords' : 
                 item.type === 'source' ? 'source_name' :
                 item.type === 'category' ? 'category' : 'country',
          value: item.value
        };
      } else if (item.type === 'group') {
        return {
          type: 'group',
          children: convertExpressionToQuery(item.value)
        };
      }
    }
    
    // Handle multiple items with operators
    const result: any = {
      type: 'expression',
      children: []
    };
    
    let i = 0;
    while (i < expression.length) {
      const currentItem = expression[i];
      if (!currentItem || !currentItem.type) {
        i++;
        continue;
      }
      
      if (currentItem.type === 'operator') {
        // Add operator to the last child
        if (result.children.length > 0) {
          result.children[result.children.length - 1].operator = currentItem.value;
        }
      } else if (currentItem.type === 'group') {
        result.children.push({
          type: 'group',
          children: convertExpressionToQuery(currentItem.value)
        });
      } else {
        result.children.push({
          type: 'term',
          field: currentItem.type === 'keyword' ? 'keywords' : 
                 currentItem.type === 'source' ? 'source_name' :
                 currentItem.type === 'category' ? 'category' : 'country',
          value: currentItem.value
        });
      }
      i++;
    }
    
    return result;
  };

  // Helper function to build API payload from filters
  const buildApiPayload = (filters: NewsFilters): NewsSearchRequest => {
    const payload: NewsSearchRequest = {
      query: {
        keywords: convertExpressionToQuery(filters.keywordExpression || []),
        sources: convertExpressionToQuery(filters.sourceExpression || []),
        categories: convertExpressionToQuery(filters.categoryExpression || []),
        countries: convertExpressionToQuery(filters.countryExpression || [])
      },
      dateRange: filters.dateRange || '12h',
      limit: 10000,  // Large limit to get all results
      offset: 0
    };
    
    return payload;
  };

  // Helper function to clean up group after deletion
  const cleanupGroup = (groupItems: any[]): any[] | any | null => {
    if (groupItems.length === 0) {
      return null; // Remove empty group
    }
    
    if (groupItems.length === 1) {
      // Single item group - dissolve and return the item
      return groupItems[0];
    }
    
    // Clean up adjacent operators
    const cleanedItems: any[] = [];
    for (let i = 0; i < groupItems.length; i++) {
      const currentItem = groupItems[i];
      const nextItem = groupItems[i + 1];
      
      // Skip if current item is an operator and next item is also an operator
      if (currentItem.type === 'operator' && nextItem && nextItem.type === 'operator') {
        continue; // Skip this operator
      }
      
      cleanedItems.push(currentItem);
    }
    
    // If we have 2 items (bubble + operator), dissolve the group
    if (cleanedItems.length === 2) {
      return cleanedItems; // Return as array of individual items
    }
    
    // For 3+ items, keep as group
    return cleanedItems.length > 2 ? { type: 'group', value: cleanedItems } : cleanedItems[0];
  };
  
  // Log state restoration
  useEffect(() => {
    if (savedState) {
      console.log('🔄 Restored news search page state from sessionStorage:', {
        hasFilters: !!savedState.filters,
        allResultsCount: savedState.allSearchResults?.length || 0,
        totalFound: savedState.totalFound || 0,
        currentPage: savedState.currentPage || 1,
      });
    } else {
      console.log('🆕 Starting fresh news search page session');
    }
  }, []); // Only log once on mount

  // Save state to sessionStorage whenever relevant state changes
  useEffect(() => {
    try {
      const stateToSave = {
        filters,
        allSearchResults,
        totalFound,
        currentPage,
        pageSize,
        isSearching,
        selectedColumns,
        searchExpanded,
      };
      
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving news search page state:', error);
    }
  }, [
    filters,
    allSearchResults,
    totalFound,
    currentPage,
    pageSize,
    isSearching,
    selectedColumns,
    searchExpanded,
  ]);
  
  // Perform search - fetch all results using expression-based filters
  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    setAllSearchResults([]);
    setCurrentResults([]);
    
    try {
      // Clean up filters before building payload
      const cleanedFilters = cleanupAllExpressions(filters);
      
      // Build API payload from expression filters
      const basePayload = buildApiPayload(cleanedFilters);
      
      // Fetch all results by making requests for all pages
      let allResults: NewsArticle[] = [];
      let currentOffset = 0;
      let hasMore = true;
      const fetchLimit = 10000; // Large limit to get all results in one request
      
      while (hasMore) {
        const searchRequest: NewsSearchRequest = {
          ...basePayload,
          limit: fetchLimit,
          offset: currentOffset,
        };
        
        console.log('🔍 News Search Request:', searchRequest);
        
        const response = await newsSearchAPI.searchNews(searchRequest);
        
        if (response.articles && response.articles.length > 0) {
          allResults = [...allResults, ...response.articles];
          
          // Check if there are more pages
          const totalFromAPI = response.total || 0;
          const fetchedSoFar = allResults.length;
          hasMore = fetchedSoFar < totalFromAPI && response.articles.length === fetchLimit;
          
          if (currentOffset === 0) {
            // Set total found from first response
            setTotalFound(totalFromAPI);
          }
          
          currentOffset += fetchLimit;
        } else {
          hasMore = false;
          if (currentOffset === 0) {
            setAllSearchResults([]);
            setTotalFound(0);
          }
        }
      }
      
      if (allResults.length > 0) {
        setAllSearchResults(allResults);
      } else {
        setAllSearchResults([]);
        setTotalFound(0);
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred during search');
      setAllSearchResults([]);
      setTotalFound(0);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Paginate results (no client-side filtering, API handles it)
  useEffect(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    setCurrentResults(allSearchResults.slice(startIndex, endIndex));
  }, [allSearchResults, currentPage, pageSize]);
  
  // Handle page change
  const handlePageChange = (newPage: number) => {
    const maxPages = Math.ceil(allSearchResults.length / pageSize);
    if (newPage < 1 || newPage > maxPages) return;
    setCurrentPage(newPage);
  };
  
  // Toggle article selection
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
  
  // Select all articles on current page
  const selectAllArticles = () => {
    const allIds = new Set(currentResults.map(article => article.id));
    setSelectedArticles(allIds);
  };
  
  // Deselect all articles
  const deselectAllArticles = () => {
    setSelectedArticles(new Set());
  };
  
  // Handle context menu close
  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };
  
  // Handle column menu close
  const handleColumnMenuClose = () => {
    setColumnMenuAnchor(null);
  };

  // Handle add to context
  const handleAddToContext = (target: 'new' | 'sidebar') => {
    if (selectedArticles.size === 0) return;
    
    // Get the selected article objects from currentResults
    const selectedArticleObjects = currentResults.filter(article => selectedArticles.has(article.id));
    
    console.log(`📰 Adding ${selectedArticleObjects.length} article(s) to context (target: ${target})`);
    
    // Add to context using the context manager functions
    if (selectedArticleObjects.length > 1) {
      const articlesForContext = selectedArticleObjects.map(article => ({
        articleId: article.id,
        title: article.title,
        source: article.source_name,
        articleData: article,
      }));
      addMultipleArticlesToContext(articlesForContext, target);
    } else if (selectedArticleObjects.length === 1) {
      const article = selectedArticleObjects[0];
      addArticleToContext(article.id, article.title, article.source_name, article, target);
    }
    
    // Clear selection and close menu
    setSelectedArticles(new Set());
    handleContextMenuClose();
  };
  
  // Format date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };
  
  // Handle view description
  const handleViewDescription = (article: NewsArticle, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedArticleForDescription(article);
    setDescriptionDialogOpen(true);
  };
  
  // Handle close description dialog
  const handleCloseDescriptionDialog = () => {
    setDescriptionDialogOpen(false);
    setSelectedArticleForDescription(null);
  };
  
  // Helper function to render expression-based filter UI
  const renderExpressionFilter = (
    filterType: 'source' | 'category' | 'country',
    inputValue: string,
    setInputValue: (value: string) => void,
    selectedItems: string[],
    setSelectedItems: (items: string[]) => void,
    selectedGroupIndex: number | null,
    setSelectedGroupIndex: (index: number | null) => void,
    options: string[],
    label: string,
    placeholder: string,
    useDropdown: boolean = false
  ) => {
    const expressionKey = `${filterType}Expression` as keyof NewsFilters;
    const currentExpression = (filters as any)[expressionKey] || [];

    return (
      <FormControl fullWidth sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ color: 'white', mb: 1 }}>
          {label} ({useDropdown ? 'Select from dropdown to add, select multiple to group' : 'Press Enter to add, select multiple to group'})
        </Typography>
        <Autocomplete
          freeSolo={!useDropdown}
          options={options}
          value={useDropdown ? null : inputValue}
          inputValue={inputValue}
          onInputChange={(_, newInputValue) => {
            setInputValue(newInputValue);
            // Clear error when user starts typing
            if (filterType === 'source') setSourceError(null);
            if (filterType === 'category') setCategoryError(null);
            if (filterType === 'country') setCountryError(null);
          }}
          onChange={(_, newValue) => {
            if (useDropdown && newValue) {
              const value = typeof newValue === 'string' ? newValue : newValue;
              if (value) {
                const newExpression = [...currentExpression];
                
                // Check if we need an operator before adding a new item
                if (newExpression.length > 0) {
                  const lastItem = newExpression[newExpression.length - 1];
                  if (lastItem.type === filterType || lastItem.type === 'group') {
                    const errorMsg = `Please add an AND or OR operator before adding another ${filterType}`;
                    if (filterType === 'source') setSourceError(errorMsg);
                    if (filterType === 'category') setCategoryError(errorMsg);
                    if (filterType === 'country') setCountryError(errorMsg);
                    return;
                  }
                }
                
                // Add the new item
                newExpression.push({ type: filterType, value });
                // Clear error on successful add
                if (filterType === 'source') setSourceError(null);
                if (filterType === 'category') setCategoryError(null);
                if (filterType === 'country') setCountryError(null);
                
                setFilters(prev => ({ 
                  ...prev, 
                  [expressionKey]: newExpression 
                }));
                setInputValue('');
              }
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !useDropdown) {
              e.preventDefault();
              const value = inputValue.trim();
              if (value) {
                const newExpression = [...currentExpression];
                
                // Check if we need an operator before adding a new item
                if (newExpression.length > 0) {
                  const lastItem = newExpression[newExpression.length - 1];
                  if (lastItem.type === filterType || lastItem.type === 'group') {
                    const errorMsg = `Please add an AND or OR operator before adding another ${filterType}`;
                    if (filterType === 'source') setSourceError(errorMsg);
                    if (filterType === 'category') setCategoryError(errorMsg);
                    if (filterType === 'country') setCountryError(errorMsg);
                    return;
                  }
                }
                
                // Add the new item
                newExpression.push({ type: filterType, value });
                
                setFilters(prev => ({ 
                  ...prev, 
                  [expressionKey]: newExpression 
                }));
                setInputValue('');
                // Clear error on successful add
                if (filterType === 'source') setSourceError(null);
                if (filterType === 'category') setCategoryError(null);
                if (filterType === 'country') setCountryError(null);
              }
            }
          }}
          renderInput={(params) => {
            const errorState = filterType === 'source' ? sourceError : filterType === 'category' ? categoryError : countryError;
            return (
              <Box>
                <TextField
                  {...params}
                  placeholder={placeholder}
                  error={!!errorState}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#334155',
                      color: 'white',
                      ...(errorState && {
                        '& fieldset': {
                          borderColor: '#ef4444',
                        },
                        '&:hover fieldset': {
                          borderColor: '#ef4444',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#ef4444',
                        },
                      }),
                    },
                  }}
                />
                {errorState && (
                  <Typography variant="caption" sx={{ color: '#ef4444', mt: 0.5, display: 'block' }}>
                    {errorState}
                  </Typography>
                )}
              </Box>
            );
          }}
        />
        
        {/* Expression Display */}
        <Box sx={{ 
          mt: 2, 
          minHeight: 60, 
          p: 2, 
          border: '1px solid #374151', 
          borderRadius: 1, 
          backgroundColor: '#1f2937',
          position: 'relative'
        }}>
          {/* Clear button */}
          {currentExpression.length > 0 && (
            <IconButton
              size="small"
              onClick={() => {
                setFilters(prev => ({
                  ...prev,
                  [expressionKey]: []
                }));
                setSelectedItems([]);
                setSelectedGroupIndex(null);
              }}
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                color: '#9ca3af',
                '&:hover': { color: '#ef4444' }
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
          
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {currentExpression.map((item: any, index: number) => (
            <React.Fragment key={index}>
              {item.type === filterType ? (
                <Chip
                  label={item.value}
                  size="small"
                  sx={{ 
                    backgroundColor: selectedItems.includes(item.value) ? '#f59e0b' : '#3b82f6', 
                    color: 'white',
                    cursor: 'pointer'
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (selectedItems.includes(item.value)) {
                      setSelectedItems(selectedItems.filter((s: string) => s !== item.value));
                    } else {
                      setSelectedItems([...selectedItems, item.value]);
                      setSelectedGroupIndex(null);
                    }
                  }}
                  onDelete={() => {
                    const newExpression = [...currentExpression];
                    newExpression.splice(index, 1);
                    setFilters(prev => ({ 
                      ...prev, 
                      [expressionKey]: newExpression 
                    }));
                  }}
                />
              ) : item.type === 'operator' ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: '#f59e0b', 
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      px: 1,
                      py: 0.5,
                      border: '1px solid #f59e0b',
                      borderRadius: 0.5
                    }}
                    onClick={() => {
                      const newExpression = [...currentExpression];
                      newExpression[index] = { type: 'operator', value: item.value === 'AND' ? 'OR' : 'AND' };
                      setFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }}
                  >
                    {item.value}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const newExpression = [...currentExpression];
                      newExpression.splice(index, 1);
                      setFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }}
                    sx={{ color: '#ef4444' }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : item.type === 'group' ? (
                <Box sx={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 0.5,
                  p: 1,
                  border: selectedGroupIndex === index ? '2px solid #f59e0b' : '1px solid #10b981',
                  borderRadius: 1,
                  backgroundColor: selectedGroupIndex === index ? '#78350f' : '#064e3b',
                  cursor: 'pointer'
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedGroupIndex(selectedGroupIndex === index ? null : index);
                  setSelectedItems([]);
                }}>
                  <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 'bold' }}>
                    (
                  </Typography>
                  {Array.isArray(item.value) && item.value.map((groupItem: any, groupIndex: number) => (
                    <React.Fragment key={groupIndex}>
                      {groupItem.type === filterType ? (
                        <Chip
                          label={groupItem.value}
                          size="small"
                          sx={{ 
                            backgroundColor: selectedItems.includes(groupItem.value) ? '#f59e0b' : '#10b981', 
                            color: 'white',
                            cursor: 'pointer'
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (selectedItems.includes(groupItem.value)) {
                              setSelectedItems(selectedItems.filter((s: string) => s !== groupItem.value));
                            } else {
                              setSelectedItems([...selectedItems, groupItem.value]);
                            }
                          }}
                          onDelete={() => {
                            const newExpression = [...currentExpression];
                            const newGroupValue = [...item.value];
                            newGroupValue.splice(groupIndex, 1);
                            
                            const cleanedResult = cleanupGroup(newGroupValue);
                            if (cleanedResult === null) {
                              // Remove the entire group
                              newExpression.splice(index, 1);
                            } else if (Array.isArray(cleanedResult)) {
                              // Dissolve group and replace with individual items
                              newExpression.splice(index, 1, ...cleanedResult);
                            } else if (cleanedResult.type === 'group') {
                              // Keep as group
                              newExpression[index] = cleanedResult;
                            } else {
                              // Dissolve group and replace with single item
                              newExpression[index] = cleanedResult;
                            }
                            
                            setFilters(prev => ({ 
                              ...prev, 
                              [expressionKey]: newExpression 
                            }));
                          }}
                        />
                      ) : groupItem.type === 'operator' ? (
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            color: '#f59e0b', 
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            px: 0.5
                          }}
                          onClick={() => {
                            const newExpression = [...currentExpression];
                            const newGroupValue = [...item.value];
                            newGroupValue[groupIndex] = { type: 'operator', value: groupItem.value === 'AND' ? 'OR' : 'AND' };
                            newExpression[index] = { type: 'group', value: newGroupValue };
                            setFilters(prev => ({ 
                              ...prev, 
                              [expressionKey]: newExpression 
                            }));
                          }}
                        >
                          {groupItem.value}
                        </Typography>
                      ) : null}
                    </React.Fragment>
                  ))}
                  <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 'bold' }}>
                    )
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const newExpression = [...currentExpression];
                      newExpression.splice(index, 1);
                      setFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }}
                    sx={{ color: '#ef4444', ml: 0.5 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : null}
            </React.Fragment>
          ))}
        </Box>
        
        {/* Action Buttons */}
        <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {selectedItems.length > 1 && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                const newExpression = [...currentExpression];
                
                // Find the indices of selected items
                const selectedIndices = selectedItems.map(item => 
                  newExpression.findIndex(exprItem => exprItem.type === filterType && exprItem.value === item)
                ).sort((a, b) => a - b);
                
                // Find the range of items to include in the group
                const minIndex = Math.min(...selectedIndices);
                const maxIndex = Math.max(...selectedIndices);
                
                // Extract the items that should be in the group
                const groupItems = newExpression.slice(minIndex, maxIndex + 1);
                
                // Create the new expression by replacing the range with the group
                const newExpressionItems: any[] = [
                  ...newExpression.slice(0, minIndex),
                  { type: 'group', value: groupItems },
                  ...newExpression.slice(maxIndex + 1)
                ];
                
                setFilters(prev => ({ 
                  ...prev, 
                  [expressionKey]: newExpressionItems 
                }));
                setSelectedItems([]);
                setSelectedGroupIndex(null);
              }}
              sx={{ color: '#10b981', borderColor: '#10b981' }}
            >
              Create Group ({selectedItems.length} {filterType}s)
            </Button>
          )}
          
          {(selectedItems.length === 1 || selectedGroupIndex !== null) && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af', alignSelf: 'center' }}>
                Add operator after selected {selectedItems.length === 1 ? filterType : 'group'}:
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  if (selectedItems.length === 1) {
                    const selectedItem = selectedItems[0];
                    const newExpression = [...currentExpression];
                    const itemIndex = newExpression.findIndex(exprItem => exprItem.type === filterType && exprItem.value === selectedItem);
                    if (itemIndex !== -1) {
                      newExpression.splice(itemIndex + 1, 0, { type: 'operator', value: 'AND' });
                      setFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }
                  } else if (selectedGroupIndex !== null) {
                    const newExpression = [...currentExpression];
                    newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'AND' });
                    setFilters(prev => ({ 
                      ...prev, 
                      [expressionKey]: newExpression 
                    }));
                  }
                  setSelectedItems([]);
                  setSelectedGroupIndex(null);
                }}
                sx={{ color: '#f59e0b', borderColor: '#f59e0b' }}
              >
                Add AND
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  if (selectedItems.length === 1) {
                    const selectedItem = selectedItems[0];
                    const newExpression = [...currentExpression];
                    const itemIndex = newExpression.findIndex(exprItem => exprItem.type === filterType && exprItem.value === selectedItem);
                    if (itemIndex !== -1) {
                      newExpression.splice(itemIndex + 1, 0, { type: 'operator', value: 'OR' });
                      setFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }
                  } else if (selectedGroupIndex !== null) {
                    const newExpression = [...currentExpression];
                    newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'OR' });
                    setFilters(prev => ({ 
                      ...prev, 
                      [expressionKey]: newExpression 
                    }));
                  }
                  setSelectedItems([]);
                  setSelectedGroupIndex(null);
                }}
                sx={{ color: '#f59e0b', borderColor: '#f59e0b' }}
              >
                Add OR
              </Button>
            </Box>
          )}
          </Box>
        </Box>
      </FormControl>
    );
  };
  
  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.9) 100%)', py: 4 }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Main Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Header */}
            <GlassCard sx={{ mb: 3 }}>
              <Box sx={{ p: 3, borderBottom: searchExpanded ? '1px solid #374151' : 'none' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ArticleIcon sx={{ fontSize: '2rem', color: '#3b82f6' }} />
                    <Box>
                      <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 700, mb: 0.5 }}>
                        News Search
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                        Search and filter news articles from multiple sources
                      </Typography>
                    </Box>
                  </Box>
                  <IconButton
                    onClick={() => setSearchExpanded(!searchExpanded)}
                    sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                  >
                    {searchExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                  </IconButton>
                </Box>
              </Box>
              
              {/* Search Form with Expression-Based Filters */}
              <Collapse in={searchExpanded}>
                <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Keywords Search with Expression Logic */}
                <FormControl fullWidth>
                  <Typography variant="subtitle2" sx={{ color: 'white', mb: 1 }}>
                    Keywords (Press Enter to add, select multiple to group)
                  </Typography>
                  
                  {/* Add Keywords Input */}
                  <Autocomplete
                    freeSolo
                    options={[]}
                    value={keywordInputValue}
                    inputValue={keywordInputValue}
                    onInputChange={(_, newInputValue) => {
                      setKeywordInputValue(newInputValue);
                      // Clear error when user starts typing
                      setKeywordError(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const value = keywordInputValue.trim();
                        if (value) {
                          const currentExpression = filters.keywordExpression || [];
                          const newExpression = [...currentExpression];
                          
                          // Check if we need an operator before adding a new keyword
                          if (newExpression.length > 0) {
                            const lastItem = newExpression[newExpression.length - 1];
                            if (lastItem.type === 'keyword' || lastItem.type === 'group') {
                              setKeywordError('Please add an AND or OR operator before adding another keyword');
                              return;
                            }
                          }
                          
                          // Add the new keyword
                          newExpression.push({ type: 'keyword', value });
                          
                          setFilters(prev => ({ 
                            ...prev, 
                            keywordExpression: newExpression 
                          }));
                          setKeywordInputValue('');
                          // Clear error on successful add
                          setKeywordError(null);
                        }
                      }
                    }}
                    renderInput={(params) => (
                      <Box>
                        <TextField
                          {...params}
                          placeholder="Type keyword and press Enter"
                          variant="outlined"
                          error={!!keywordError}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: '#334155',
                              color: 'white',
                              ...(keywordError && {
                                '& fieldset': {
                                  borderColor: '#ef4444',
                                },
                                '&:hover fieldset': {
                                  borderColor: '#ef4444',
                                },
                                '&.Mui-focused fieldset': {
                                  borderColor: '#ef4444',
                                },
                              }),
                            },
                          }}
                        />
                        {keywordError && (
                          <Typography variant="caption" sx={{ color: '#ef4444', mt: 0.5, display: 'block' }}>
                            {keywordError}
                          </Typography>
                        )}
                      </Box>
                    )}
                  />

                  {/* Keywords Display with Expression Logic */}
                  <Box sx={{ 
                    minHeight: 60, 
                    p: 2, 
                    border: '1px solid #374151', 
                    borderRadius: 1, 
                    backgroundColor: '#1f2937',
                    mt: 2,
                    position: 'relative'
                  }}>
                    {/* Clear button */}
                    {(filters.keywordExpression || []).length > 0 && (
                      <IconButton
                        size="small"
                        onClick={() => {
                          setFilters(prev => ({
                            ...prev,
                            keywordExpression: []
                          }));
                          setSelectedKeywords([]);
                          setSelectedGroupIndex(null);
                        }}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          color: '#9ca3af',
                          '&:hover': { color: '#ef4444' }
                        }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    )}
                    
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(filters.keywordExpression || []).map((item: any, index: number) => (
                        <React.Fragment key={index}>
                          {item.type === 'keyword' ? (
                            <Chip
                              label={item.value}
                              size="small"
                              sx={{ 
                                backgroundColor: selectedKeywords.includes(item.value) ? '#f59e0b' : '#3b82f6', 
                                color: 'white',
                                cursor: 'pointer'
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (selectedKeywords.includes(item.value)) {
                                  setSelectedKeywords(prev => prev.filter(k => k !== item.value));
                                } else {
                                  setSelectedKeywords(prev => [...prev, item.value]);
                                  setSelectedGroupIndex(null);
                                }
                              }}
                              onDelete={() => {
                                const newExpression = [...(filters.keywordExpression || [])];
                                newExpression.splice(index, 1);
                                setFilters(prev => ({ 
                                  ...prev, 
                                  keywordExpression: newExpression 
                                }));
                              }}
                            />
                          ) : item.type === 'operator' ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  color: '#f59e0b', 
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  px: 1,
                                  py: 0.5,
                                  border: '1px solid #f59e0b',
                                  borderRadius: 0.5
                                }}
                                onClick={() => {
                                  const newExpression = [...(filters.keywordExpression || [])];
                                  newExpression[index] = { type: 'operator', value: item.value === 'AND' ? 'OR' : 'AND' };
                                  setFilters(prev => ({ 
                                    ...prev, 
                                    keywordExpression: newExpression 
                                  }));
                                }}
                              >
                                {item.value}
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const newExpression = [...(filters.keywordExpression || [])];
                                  newExpression.splice(index, 1);
                                  setFilters(prev => ({ 
                                    ...prev, 
                                    keywordExpression: newExpression 
                                  }));
                                }}
                                sx={{ color: '#ef4444' }}
                              >
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : item.type === 'group' ? (
                            <Box sx={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: 0.5,
                              p: 1,
                              border: selectedGroupIndex === index ? '2px solid #f59e0b' : '1px solid #10b981',
                              borderRadius: 1,
                              backgroundColor: selectedGroupIndex === index ? '#78350f' : '#064e3b',
                              cursor: 'pointer'
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setSelectedGroupIndex(selectedGroupIndex === index ? null : index);
                              setSelectedKeywords([]);
                            }}>
                              <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 'bold' }}>
                                (
                              </Typography>
                              {Array.isArray(item.value) && item.value.map((groupItem: any, groupIndex: number) => (
                                <React.Fragment key={groupIndex}>
                                  {groupItem.type === 'keyword' ? (
                                    <Chip
                                      label={groupItem.value}
                                      size="small"
                                      sx={{ 
                                        backgroundColor: selectedKeywords.includes(groupItem.value) ? '#f59e0b' : '#10b981', 
                                        color: 'white',
                                        cursor: 'pointer'
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        if (selectedKeywords.includes(groupItem.value)) {
                                          setSelectedKeywords(prev => prev.filter(k => k !== groupItem.value));
                                        } else {
                                          setSelectedKeywords(prev => [...prev, groupItem.value]);
                                        }
                                      }}
                                      onDelete={() => {
                                        const newExpression = [...(filters.keywordExpression || [])];
                                        const newGroupValue = [...item.value];
                                        newGroupValue.splice(groupIndex, 1);
                                        
                                        const cleanedResult = cleanupGroup(newGroupValue);
                                        if (cleanedResult === null) {
                                          newExpression.splice(index, 1);
                                        } else if (Array.isArray(cleanedResult)) {
                                          newExpression.splice(index, 1, ...cleanedResult);
                                        } else if (cleanedResult.type === 'group') {
                                          newExpression[index] = cleanedResult;
                                        } else {
                                          newExpression[index] = cleanedResult;
                                        }
                                        
                                        setFilters(prev => ({ 
                                          ...prev, 
                                          keywordExpression: newExpression 
                                        }));
                                      }}
                                    />
                                  ) : groupItem.type === 'operator' ? (
                                    <Typography 
                                      variant="body2" 
                                      sx={{ 
                                        color: '#f59e0b', 
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        px: 0.5
                                      }}
                                      onClick={() => {
                                        const newExpression = [...(filters.keywordExpression || [])];
                                        const newGroupValue = [...item.value];
                                        newGroupValue[groupIndex] = { type: 'operator', value: groupItem.value === 'AND' ? 'OR' : 'AND' };
                                        newExpression[index] = { type: 'group', value: newGroupValue };
                                        setFilters(prev => ({ 
                                          ...prev, 
                                          keywordExpression: newExpression 
                                        }));
                                      }}
                                    >
                                      {groupItem.value}
                                    </Typography>
                                  ) : null}
                                </React.Fragment>
                              ))}
                              <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 'bold' }}>
                                )
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const newExpression = [...(filters.keywordExpression || [])];
                                  newExpression.splice(index, 1);
                                  setFilters(prev => ({ 
                                    ...prev, 
                                    keywordExpression: newExpression 
                                  }));
                                }}
                                sx={{ color: '#ef4444', ml: 0.5 }}
                              >
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : null}
                        </React.Fragment>
                      ))}
                    </Box>
                    
                    {/* Create Group and Add Operator Buttons */}
                    {selectedKeywords.length > 1 && (
                      <Box sx={{ mt: 2 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            const newExpression = [...(filters.keywordExpression || [])];
                            
                            const selectedIndices = selectedKeywords.map(keyword => 
                              newExpression.findIndex(item => item.type === 'keyword' && item.value === keyword)
                            ).sort((a, b) => a - b);
                            
                            const minIndex = Math.min(...selectedIndices);
                            const maxIndex = Math.max(...selectedIndices);
                            const groupItems = newExpression.slice(minIndex, maxIndex + 1);
                            
                            const newExpressionItems: any[] = [
                              ...newExpression.slice(0, minIndex),
                              { type: 'group', value: groupItems },
                              ...newExpression.slice(maxIndex + 1)
                            ];
                            
                            setFilters(prev => ({ 
                              ...prev, 
                              keywordExpression: newExpressionItems 
                            }));
                            setSelectedKeywords([]);
                            setSelectedGroupIndex(null);
                          }}
                          sx={{ color: '#10b981', borderColor: '#10b981', mr: 1 }}
                        >
                          Create Group ({selectedKeywords.length} keywords)
                        </Button>
                      </Box>
                    )}
                    
                    {(selectedKeywords.length === 1 || selectedGroupIndex !== null) && (
                      <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                          Add operator after:
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            if (selectedKeywords.length === 1) {
                              const selectedKeyword = selectedKeywords[0];
                              const newExpression = [...(filters.keywordExpression || [])];
                              const itemIndex = newExpression.findIndex(item => item.type === 'keyword' && item.value === selectedKeyword);
                              if (itemIndex !== -1) {
                                newExpression.splice(itemIndex + 1, 0, { type: 'operator', value: 'AND' });
                                setFilters(prev => ({ 
                                  ...prev, 
                                  keywordExpression: newExpression 
                                }));
                              }
                            } else if (selectedGroupIndex !== null) {
                              const newExpression = [...(filters.keywordExpression || [])];
                              newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'AND' });
                              setFilters(prev => ({ 
                                ...prev, 
                                keywordExpression: newExpression 
                              }));
                            }
                            setSelectedKeywords([]);
                            setSelectedGroupIndex(null);
                          }}
                          sx={{ color: '#f59e0b', borderColor: '#f59e0b', mr: 1 }}
                        >
                          Add AND
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            if (selectedKeywords.length === 1) {
                              const selectedKeyword = selectedKeywords[0];
                              const newExpression = [...(filters.keywordExpression || [])];
                              const itemIndex = newExpression.findIndex(item => item.type === 'keyword' && item.value === selectedKeyword);
                              if (itemIndex !== -1) {
                                newExpression.splice(itemIndex + 1, 0, { type: 'operator', value: 'OR' });
                                setFilters(prev => ({ 
                                  ...prev, 
                                  keywordExpression: newExpression 
                                }));
                              }
                            } else if (selectedGroupIndex !== null) {
                              const newExpression = [...(filters.keywordExpression || [])];
                              newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'OR' });
                              setFilters(prev => ({ 
                                ...prev, 
                                keywordExpression: newExpression 
                              }));
                            }
                            setSelectedKeywords([]);
                            setSelectedGroupIndex(null);
                          }}
                          sx={{ color: '#f59e0b', borderColor: '#f59e0b' }}
                        >
                          Add OR
                        </Button>
                      </Box>
                    )}
                  </Box>
                </FormControl>

                {/* Source Selection with Expression Logic */}
                {renderExpressionFilter(
                  'source',
                  sourceInputValue,
                  setSourceInputValue,
                  selectedSources,
                  setSelectedSources,
                  selectedSourceGroupIndex,
                  setSelectedSourceGroupIndex,
                  [],  // No predefined options - freeform text
                  'Sources',
                  'Type source name (e.g., Bloomberg, Reuters) and press Enter',
                  false // Freeform text input mode
                )}

                {/* Category Selection with Expression Logic */}
                {renderExpressionFilter(
                  'category',
                  categoryInputValue,
                  setCategoryInputValue,
                  selectedCategories,
                  setSelectedCategories,
                  selectedCategoryGroupIndex,
                  setSelectedCategoryGroupIndex,
                  categoryOptions,
                  'Categories',
                  'Select category from dropdown',
                  true // Use dropdown mode
                )}

                {/* Date Range */}
                <FormControl fullWidth>
                  <InputLabel sx={{ color: '#94a3b8' }}>Date Range</InputLabel>
                  <Select
                    value={filters.dateRange}
                    label="Date Range"
                    onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value as NewsFilters['dateRange'] }))}
                    sx={{
                      color: '#ffffff',
                      '& .MuiOutlinedInput-root': { backgroundColor: '#334155' },
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                      '& .MuiSvgIcon-root': { color: '#94a3b8' },
                    }}
                  >
                    {DATE_RANGES.map(range => (
                      <MenuItem key={range.value} value={range.value}>
                        {range.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {/* Country Selection with Expression Logic */}
                {renderExpressionFilter(
                  'country',
                  countryInputValue,
                  setCountryInputValue,
                  selectedCountries,
                  setSelectedCountries,
                  selectedCountryGroupIndex,
                  setSelectedCountryGroupIndex,
                  countryOptions,
                  'Countries',
                  'Select country from dropdown',
                  true // Use dropdown mode
                )}
                
                {/* Search Button */}
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  disabled={isSearching}
                  startIcon={isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
                  sx={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                    alignSelf: 'flex-start',
                  }}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </Button>
                </Box>
              </Collapse>
            </GlassCard>
            
            {/* Results */}
            {isSearching && allSearchResults.length === 0 && (
              <GlassCard sx={{ p: 6, textAlign: 'center' }}>
                <CircularProgress sx={{ color: '#3b82f6', mb: 2 }} />
                <Typography variant="body1" sx={{ color: '#9ca3af' }}>
                  Searching news articles...
                </Typography>
              </GlassCard>
            )}
            
            {searchError && (
              <GlassCard sx={{ p: 3, mb: 3 }}>
                <Alert severity="error" sx={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                  {searchError}
                </Alert>
              </GlassCard>
            )}
            
            {!isSearching && allSearchResults.length > 0 && (
              <GlassCard>
                {/* Results Header */}
                <Box sx={{ p: 3, borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                    {allSearchResults.length} Results
                    {totalFound > allSearchResults.length && ` (${totalFound} total found)`}
                  </Typography>
                  
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    {/* Results Per Page */}
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
                      <Select
                        value={pageSize}
                        label="Per Page"
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        sx={{
                          color: '#ffffff',
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                        }}
                      >
                        <MenuItem value={10}>10</MenuItem>
                        <MenuItem value={25}>25</MenuItem>
                        <MenuItem value={50}>50</MenuItem>
                        <MenuItem value={100}>100</MenuItem>
                      </Select>
                    </FormControl>
                    
                    {/* Column Visibility Button */}
                    <Tooltip title="Column Visibility">
                      <IconButton
                        onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                        sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                      >
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    
                    {/* Context Menu Button */}
                    <Tooltip title="Add to Context">
                      <span>
                        <IconButton
                          onClick={(e) => setContextMenuAnchor(e.currentTarget)}
                          disabled={selectedArticles.size === 0}
                          sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' }, '&:disabled': { color: '#475569' } }}
                        >
                          <AddToContextIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    
                    {/* Column Visibility Menu */}
                    <Menu
                      anchorEl={columnMenuAnchor}
                      open={Boolean(columnMenuAnchor)}
                      onClose={handleColumnMenuClose}
                      PaperProps={{
                        sx: {
                          backgroundColor: '#1e293b',
                          border: '1px solid #374151',
                        },
                      }}
                    >
                      <MenuItem disabled>
                        <Typography variant="subtitle2" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                          Show Columns
                        </Typography>
                      </MenuItem>
                      {DEFAULT_COLUMNS.map(column => (
                        <MenuItem key={column} onClick={() => {
                          setSelectedColumns(prev => 
                            prev.includes(column)
                              ? prev.filter(c => c !== column)
                              : [...prev, column]
                          );
                        }}>
                          <Checkbox
                            checked={selectedColumns.includes(column)}
                            sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                            size="small"
                          />
                          <Typography sx={{ color: '#ffffff', ml: 1 }}>
                            {column}
                          </Typography>
                        </MenuItem>
                      ))}
                    </Menu>
                    
                    {/* Context Menu */}
                    <Menu
                      anchorEl={contextMenuAnchor}
                      open={Boolean(contextMenuAnchor)}
                      onClose={handleContextMenuClose}
                      PaperProps={{
                        sx: {
                          backgroundColor: '#1e293b',
                          border: '1px solid #374151',
                        },
                      }}
                    >
                      <MenuItem onClick={() => handleAddToContext('new')} disabled={selectedArticles.size === 0}>
                        <AddToContextIcon sx={{ mr: 1, fontSize: 18, color: '#10b981' }} />
                        <Typography sx={{ color: '#ffffff' }}>
                          Add to New Chat ({selectedArticles.size})
                        </Typography>
                      </MenuItem>
                      <MenuItem onClick={() => handleAddToContext('sidebar')} disabled={selectedArticles.size === 0}>
                        <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
                        <Typography sx={{ color: '#ffffff' }}>
                          Add to Sidebar Chat ({selectedArticles.size})
                        </Typography>
                      </MenuItem>
                    </Menu>
                  </Box>
                </Box>
                
                {/* Results Table */}
                <Box sx={{ p: 2 }}>
                    {currentResults.length > 0 ? (
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
                            <TableRow sx={{ backgroundColor: 'rgba(31, 41, 55, 0.5)' }}>
                              <TableCell padding="checkbox" sx={{ py: 1 }}>
                                <Checkbox
                                  checked={selectedArticles.size === currentResults.length && currentResults.length > 0}
                                  indeterminate={selectedArticles.size > 0 && selectedArticles.size < currentResults.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      selectAllArticles();
                                    } else {
                                      deselectAllArticles();
                                    }
                                  }}
                                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                                  size="small"
                                />
                              </TableCell>
                              {selectedColumns.includes('Title') && (
                                <TableCell key="title-header" sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem', minWidth: '400px' }}>Title</TableCell>
                              )}
                              {selectedColumns.includes('Source') && (
                                <TableCell key="source-header" sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Source</TableCell>
                              )}
                              {selectedColumns.includes('Published Date') && (
                                <TableCell key="published-date-header" sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Published Date</TableCell>
                              )}
                              {selectedColumns.includes('Category') && (
                                <TableCell key="category-header" sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Category</TableCell>
                              )}
                              {selectedColumns.includes('Description') && (
                                <TableCell key="description-header" sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem', width: '150px' }}>Description</TableCell>
                              )}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {currentResults.map((article) => (
                              <TableRow
                                key={article.id}
                                sx={{
                                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                  cursor: 'pointer',
                                }}
                                onClick={() => toggleArticleSelection(article.id)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setContextMenuAnchor(e.currentTarget);
                                }}
                              >
                                <TableCell padding="checkbox" sx={{ py: 1 }}>
                                  <Checkbox
                                    checked={selectedArticles.has(article.id)}
                                    onChange={() => toggleArticleSelection(article.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                                    size="small"
                                  />
                                </TableCell>
                                {selectedColumns.includes('Title') && (
                                  <TableCell key={`title-${article.id}`} sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem', minWidth: '400px' }}>
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                                      {/* Image */}
                                      {article.image_url ? (
                                        <Box sx={{ 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'center',
                                          width: 80,
                                          height: 50,
                                          flexShrink: 0
                                        }}>
                                          <Avatar
                                            src={article.image_url}
                                            variant="rounded"
                                            sx={{ 
                                              width: 80, 
                                              height: 50,
                                              borderRadius: '6px',
                                              objectFit: 'cover'
                                            }}
                                          >
                                            <ImageIcon />
                                          </Avatar>
                                        </Box>
                                      ) : (
                                        <Box sx={{ 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'center',
                                          width: 80,
                                          height: 50,
                                          flexShrink: 0
                                        }}>
                                          <Avatar sx={{ 
                                            width: 80, 
                                            height: 50, 
                                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                            borderRadius: '6px'
                                          }}>
                                            <ArticleIcon />
                                          </Avatar>
                                        </Box>
                                      )}
                                      
                                      {/* Title with link */}
                                      <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Link
                                          href={article.source_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          sx={{
                                            color: '#3b82f6',
                                            textDecoration: 'none',
                                            '&:hover': {
                                              textDecoration: 'underline',
                                              color: '#60a5fa',
                                            },
                                          }}
                                        >
                                          <Typography
                                            sx={{
                                              fontWeight: 500,
                                              wordBreak: 'break-word',
                                              color: '#3b82f6',
                                            }}
                                          >
                                            {article.title}
                                          </Typography>
                                        </Link>
                                      </Box>
                                    </Box>
                                  </TableCell>
                                )}
                                {selectedColumns.includes('Source') && (
                                  <TableCell key={`source-${article.id}`} sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                                    {article.source_name || 'N/A'}
                                  </TableCell>
                                )}
                                {selectedColumns.includes('Published Date') && (
                                  <TableCell key={`published-date-${article.id}`} sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <CalendarIcon sx={{ fontSize: '0.875rem', color: '#9ca3af' }} />
                                      {formatDate(article.published_date)}
                                    </Box>
                                  </TableCell>
                                )}
                                {selectedColumns.includes('Category') && (
                                  <TableCell key={`category-${article.id}`} sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                                    {article.category || 'N/A'}
                                  </TableCell>
                                )}
                                {selectedColumns.includes('Description') && (
                                  <TableCell key={`description-${article.id}`} sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem', width: '150px' }}>
                                    {article.description ? (
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={(e) => handleViewDescription(article, e)}
                                        sx={{
                                          color: '#3b82f6',
                                          borderColor: '#3b82f6',
                                          fontSize: '0.75rem',
                                          textTransform: 'none',
                                          '&:hover': {
                                            borderColor: '#2563eb',
                                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                          },
                                        }}
                                      >
                                        View Description
                                      </Button>
                                    ) : (
                                      <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.75rem' }}>
                                        No description
                                      </Typography>
                                    )}
                                  </TableCell>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : null}
                    
                    {/* Pagination */}
                    {allSearchResults.length > pageSize && (
                      <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #374151' }}>
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                          Page {currentPage} of {Math.ceil(allSearchResults.length / pageSize)}
                          {' '}(Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, allSearchResults.length)} of {allSearchResults.length} results)
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            variant="outlined"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1 || isSearching}
                            startIcon={<ChevronLeftIcon />}
                            sx={{
                              color: '#9ca3af',
                              borderColor: '#374151',
                              '&:hover': {
                                borderColor: '#3b82f6',
                                color: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                              '&:disabled': {
                                borderColor: '#374151',
                                color: '#6b7280',
                              },
                            }}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage >= Math.ceil(allSearchResults.length / pageSize) || isSearching}
                            endIcon={<ChevronRightIcon />}
                            sx={{
                              color: '#9ca3af',
                              borderColor: '#374151',
                              '&:hover': {
                                borderColor: '#3b82f6',
                                color: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                              '&:disabled': {
                                borderColor: '#374151',
                                color: '#6b7280',
                              },
                            }}
                          >
                            Next
                          </Button>
                        </Box>
                      </Box>
                    )}
                  </Box>
              </GlassCard>
            )}
          
            {/* Empty State */}
            {!isSearching && allSearchResults.length === 0 && totalFound === 0 && !searchError && (
              <GlassCard>
                <Box sx={{ p: 6, textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: '#9ca3af', mb: 2, fontWeight: 600 }}>
                    No results found
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#6b7280', mb: 3 }}>
                    Try adjusting your search criteria or date range to find news articles.
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#6b7280' }}>
                    Enter keywords and click "Search" to find news articles
                  </Typography>
                </Box>
              </GlassCard>
            )}
          </Box>
        </Box>
      </Container>
      
      {/* Description Dialog */}
      <Dialog
        open={descriptionDialogOpen}
        onClose={handleCloseDescriptionDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '0px',
            color: 'white',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #374151', pb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              {selectedArticleForDescription?.title || 'Article Description'}
            </Typography>
            <IconButton
              onClick={handleCloseDescriptionDialog}
              sx={{ color: '#9ca3af', '&:hover': { color: '#ef4444' } }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent 
          sx={{ 
            pt: 3,
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
          {selectedArticleForDescription && (
            <Box>
              {selectedArticleForDescription.image_url && (
                <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
                  <Avatar
                    src={selectedArticleForDescription.image_url}
                    variant="rounded"
                    sx={{
                      width: '100%',
                      maxWidth: '600px',
                      height: 'auto',
                      borderRadius: '6px',
                      objectFit: 'cover',
                    }}
                  />
                </Box>
              )}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Source: {selectedArticleForDescription.source_name || 'N/A'}
                </Typography>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Published: {formatDate(selectedArticleForDescription.published_date)}
                </Typography>
                {selectedArticleForDescription.category && (
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Category: {selectedArticleForDescription.category}
                  </Typography>
                )}
              </Box>
              <Typography
                variant="body1"
                sx={{
                  color: '#e2e8f0',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {selectedArticleForDescription.description || 'No description available.'}
              </Typography>
              {selectedArticleForDescription.keywords && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Keywords:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selectedArticleForDescription.keywords.split(',').map((keyword, idx) => (
                      <Chip
                        key={idx}
                        label={keyword.trim()}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          fontSize: '0.75rem',
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={handleCloseDescriptionDialog}
            sx={{
              color: '#9ca3af',
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
              },
            }}
          >
            Close
          </Button>
          {selectedArticleForDescription?.source_url && (
            <Button
              onClick={() => {
                if (selectedArticleForDescription?.source_url) {
                  window.open(selectedArticleForDescription.source_url, '_blank', 'noopener,noreferrer');
                }
              }}
              variant="contained"
              startIcon={<OpenInNewIcon />}
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
              }}
            >
              Open Article
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NewsSearchPage;

