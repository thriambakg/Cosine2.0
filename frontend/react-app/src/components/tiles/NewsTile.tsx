import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  TextField,
  Button,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  Autocomplete,
  List,
  ListItem,
  Avatar,
  Pagination,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Close as CloseIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  PushPin as PinIcon,
  AutoAwesome as AutoRefreshIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Article as ArticleIcon,
  OpenInNew as OpenInNewIcon,
  Image as ImageIcon,
  CalendarToday as CalendarIcon,
  Dashboard as ContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
} from '@mui/icons-material';
import { newsSearchAPI, NewsSearchRequest } from '../../services/api';
import { useTilePinning, PinButton, addArticleToContext, addMultipleArticlesToContext, confirmDialog } from './common';
import { newsCache } from '../../utils/newsCache';

interface NewsTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
  // News tile specific props
  filters?: NewsFilters;
  articles?: NewsArticle[];
  displayOptions?: {
    showImages: boolean;
    showSource: boolean;
    showDate: boolean;
    showKeywords: boolean;
    maxResults: number;
    compactView: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
}

interface NewsFilters {
  keywords: string[];
  sources: string[];
  categories: string[];
  dateRange: string;
  countries: string[];
  // Query operators
  categoryOperator: 'AND' | 'OR';
  sourceOperator: 'AND' | 'OR';
  countryOperator: 'AND' | 'OR';
}

interface NewsArticle {
  id: string;
  title: string;
  description: string;
  source_url: string;
  source_name: string;
  published_date: string;
  keywords: string;
  category: string;
  image_url?: string;
  sentiment?: string;
  ai_tag?: string;
  country?: string;
  language?: string;
}

const NewsTile: React.FC<NewsTileProps> = ({
  id,
  size,
  onRemove,
  onUpdate: _onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
  filters = {
    keywords: [],
    sources: [],
    categories: [],
    dateRange: '12h',
    countries: [],
    categoryOperator: 'OR',
    sourceOperator: 'OR',
    countryOperator: 'OR',
  },
  articles = [],
  displayOptions = {
    showImages: true,
    showSource: true,
    showDate: true,
    showKeywords: false,
    maxResults: 20,
    compactView: false,
  },
  autoRefresh = false,
  isPinned = false,
}) => {
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);

  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<NewsFilters>(filters);
  const [localDisplayOptions, setLocalDisplayOptions] = useState(displayOptions);
  const [currentPage, setCurrentPage] = useState(1);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>(articles);
  const [totalFound, setTotalFound] = useState<number>(0);
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false);
  const [fetchedPages, setFetchedPages] = useState<Map<number, NewsArticle[]>>(new Map());
  const [currentResults, setCurrentResults] = useState<NewsArticle[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [keywordInputValue, setKeywordInputValue] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  
  // State for other expression-based filters
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
  
  const tileRef = useRef<HTMLDivElement>(null);
  const localFiltersRef = useRef(localFilters);
  const initialLoadDone = useRef(false);
  // Cache is now handled by newsCache utility with tile ID

  // Helper function to ensure articles have a valid ID
  const ensureArticleId = (article: NewsArticle): NewsArticle => {
    if (article.id) {
      return article;
    }
    // Use source_url as fallback ID, or generate one from title + source_url
    return {
      ...article,
      id: article.source_url || `${article.title}-${article.source_name || 'unknown'}`,
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
  const buildApiPayload = (filters: any, limit?: number): NewsSearchRequest => {
    const payload: NewsSearchRequest = {
      query: {
        keywords: convertExpressionToQuery(filters.keywordExpression || []),
        sources: convertExpressionToQuery(filters.sourceExpression || []),
        categories: convertExpressionToQuery(filters.categoryExpression || []),
        countries: convertExpressionToQuery(filters.countryExpression || [])
      },
      dateRange: filters.dateRange || '12h',
      limit: limit || displayOptions.maxResults || 20,  // Use provided limit or maxResults from display options
      offset: 0
    };
    
    return payload;
  };

  // Update ref when localFilters changes
  useEffect(() => {
    localFiltersRef.current = localFilters;
  }, [localFilters]);

  // Load cached data on mount
  useEffect(() => {
    try {
      // Check cache using the new cache utility
      // For tiles, we fetch page 1 with a reasonable page size (using maxResults)
      const pageSize = displayOptions.maxResults || 20;
      const basePayload = buildApiPayload(localFilters, pageSize);
      
      // Check if we have cached data for page 1
      const cached = newsCache.getCachedPage(basePayload, 1, pageSize, id);
      if (cached && cached.articles.length > 0) {
        setNewsArticles(cached.articles);
        initialLoadDone.current = true;
        console.log(`📰 NewsTile ${id}: Loaded ${cached.articles.length} articles from cache`);
        return; // Don't do a fresh search
      }
    } catch (error) {
      console.error('Error loading cached news data:', error);
    }
  }, [id, localFilters, displayOptions.maxResults, buildApiPayload]); // Run when filters or maxResults change

  // Save articles to cache whenever articles change
  useEffect(() => {
    if (newsArticles.length > 0 && initialLoadDone.current) {
      try {
        // Cache is now handled by newsCache utility in runNewsSearch
      } catch (error) {
        console.error('Error caching news data:', error);
      }
    }
  }, [newsArticles, id]);

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
  const cleanupAllExpressions = (filters: any) => {
    return {
      ...filters,
      keywordExpression: cleanupTrailingOperators(filters.keywordExpression || []),
      sourceExpression: cleanupTrailingOperators(filters.sourceExpression || []),
      categoryExpression: cleanupTrailingOperators(filters.categoryExpression || []),
      countryExpression: cleanupTrailingOperators(filters.countryExpression || []),
    };
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
    const currentExpression = (localFilters as any)[expressionKey] || [];

    return (
      <FormControl fullWidth>
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
                
                setLocalFilters(prev => ({ 
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
                
                setLocalFilters(prev => ({ 
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
                setLocalFilters(prev => ({
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
                    setLocalFilters(prev => ({ 
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
                      setLocalFilters(prev => ({ 
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
                      setLocalFilters(prev => ({ 
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
                            
                            setLocalFilters(prev => ({ 
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
                            setLocalFilters(prev => ({ 
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
                      setLocalFilters(prev => ({ 
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
                
                setLocalFilters(prev => ({ 
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
                      setLocalFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }
                  } else if (selectedGroupIndex !== null) {
                    const newExpression = [...currentExpression];
                    newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'AND' });
                    setLocalFilters(prev => ({ 
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
                      setLocalFilters(prev => ({ 
                        ...prev, 
                        [expressionKey]: newExpression 
                      }));
                    }
                  } else if (selectedGroupIndex !== null) {
                    const newExpression = [...currentExpression];
                    newExpression.splice(selectedGroupIndex + 1, 0, { type: 'operator', value: 'OR' });
                    setLocalFilters(prev => ({ 
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
  const lastClickTimeRef = useRef<number>(0);

  // Mock loading and error states for now
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock news data for demonstration
  const mockNewsData: NewsArticle[] = [
    {
      id: '1',
      title: 'Will Big Tech be held liable in chatbot suicide cases?',
      description: 'Legal experts weigh in on the potential liability of tech companies for AI chatbot interactions that may contribute to self-harm incidents.',
      source_url: 'https://www.fastcompany.com/91407443/big-tech-liable-chatbot-suicide-cases',
      source_name: 'Fast Company',
      published_date: '2025-01-25T10:30:00Z',
      keywords: 'artificial intelligence,big tech,liability,chatbot,legal,suicide,ai safety',
      category: 'technology',
      image_url: 'https://images.fastcompany.com/image/upload/w_1280,q_auto,f_auto,fl_lossy/f_webp,q_auto,c_fit/wp-cms-2/2025/09/p-91407443-big-tech-and-chat-bot-suicides.jpg',
      sentiment: 'neutral',
      ai_tag: 'technology,legal',
      country: 'us',
      language: 'english',
    },
    {
      id: '2',
      title: 'Federal Reserve signals potential rate cuts amid economic uncertainty',
      description: 'The Federal Reserve hints at possible interest rate reductions as inflation shows signs of cooling and economic growth slows.',
      source_url: 'https://example.com/fed-rate-cuts',
      source_name: 'Financial Times',
      published_date: '2025-01-25T09:15:00Z',
      keywords: 'federal reserve,interest rates,inflation,monetary policy,economy',
      category: 'business',
      image_url: 'https://example.com/fed-image.jpg',
      sentiment: 'positive',
      ai_tag: 'finance,policy',
      country: 'us',
      language: 'english',
    },
    {
      id: '3',
      title: 'Tesla reports record Q4 deliveries despite production challenges',
      description: 'Tesla delivered a record number of vehicles in Q4 2024, overcoming supply chain disruptions and manufacturing bottlenecks.',
      source_url: 'https://example.com/tesla-q4-deliveries',
      source_name: 'Reuters',
      published_date: '2025-01-25T08:45:00Z',
      keywords: 'tesla,deliveries,production,automotive,electric vehicles,earnings',
      category: 'business',
      image_url: 'https://example.com/tesla-image.jpg',
      sentiment: 'positive',
      ai_tag: 'automotive,earnings',
      country: 'us',
      language: 'english',
    },
    {
      id: '4',
      title: 'Renewable energy investments surge to $1.8 trillion globally',
      description: 'Global investment in renewable energy reached a new high in 2024, driven by government incentives and falling technology costs.',
      source_url: 'https://example.com/renewable-energy-investment',
      source_name: 'Bloomberg',
      published_date: '2025-01-25T07:20:00Z',
      keywords: 'renewable energy,investment,green energy,solar,wind,climate',
      category: 'business',
      image_url: 'https://example.com/renewable-image.jpg',
      sentiment: 'positive',
      ai_tag: 'energy,investment',
      country: 'global',
      language: 'english',
    },
    {
      id: '5',
      title: 'Apple faces antitrust scrutiny over App Store policies in Europe',
      description: 'European regulators launch investigation into Apple\'s App Store practices, focusing on anti-competitive behavior and developer fees.',
      source_url: 'https://example.com/apple-antitrust-europe',
      source_name: 'TechCrunch',
      published_date: '2025-01-25T06:30:00Z',
      keywords: 'apple,antitrust,app store,europe,regulatory,competition',
      category: 'technology',
      image_url: 'https://example.com/apple-image.jpg',
      sentiment: 'negative',
      ai_tag: 'technology,regulatory',
      country: 'eu',
      language: 'english',
    },
  ];

  // Category options
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

  // Country options
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

  // Filter articles based on criteria
  const filterArticles = useCallback((articles: NewsArticle[], filters: NewsFilters): NewsArticle[] => {
    return articles.filter(article => {
      // Keywords filter with expression logic
      const keywordExpression = ((filters as any).keywordExpression || []).filter((item: any) => item && item.type);
      if (keywordExpression.length > 0) {
        const articleKeywords = article.keywords.toLowerCase();
        const articleText = `${article.title} ${article.description}`.toLowerCase();
        
        // Evaluate the keyword expression
        const evaluateExpression = (expression: any[]): boolean => {
          if (!expression || expression.length === 0) return true;
          if (expression.length === 1) {
            const item = expression[0];
            if (!item || !item.type) return false;
            if (item.type === 'keyword') {
              return articleKeywords.includes(item.value.toLowerCase()) ||
                     articleText.includes(item.value.toLowerCase());
            } else if (item.type === 'group') {
              return evaluateExpression(item.value);
            }
            return false;
          }
          
          // Process expression with operators
          let result = evaluateExpression([expression[0]]);
          let i = 1;
          
          while (i < expression.length) {
            const currentItem = expression[i];
            if (!currentItem || !currentItem.type) {
              i++;
              continue;
            }
            
            if (currentItem.type === 'operator') {
              const operator = currentItem.value;
              const nextItem = expression[i + 1];
              
              if (!nextItem || !nextItem.type) {
                i++;
                continue;
              }
              
              const nextResult = nextItem.type === 'group' ? 
                evaluateExpression(nextItem.value) :
                evaluateExpression([nextItem]);
              
              if (operator === 'AND') {
                result = result && nextResult;
              } else if (operator === 'OR') {
                result = result || nextResult;
              }
              i += 2;
            } else {
              i++;
            }
          }
          
          return result;
        };
        
        if (!evaluateExpression(keywordExpression)) return false;
      }

      // Source filter with expression logic
      const sourceExpression = ((filters as any).sourceExpression || []).filter((item: any) => item && item.type);
      if (sourceExpression.length > 0) {
        const evaluateSourceExpression = (expression: any[]): boolean => {
          if (!expression || expression.length === 0) return true;
          if (expression.length === 1) {
            const item = expression[0];
            if (!item || !item.type) return false;
            if (item.type === 'source') {
              return article.source_name === item.value;
            } else if (item.type === 'group') {
              return evaluateSourceExpression(item.value);
            }
            return false;
          }
          
          let result = evaluateSourceExpression([expression[0]]);
          let i = 1;
          
          while (i < expression.length) {
            const currentItem = expression[i];
            if (!currentItem || !currentItem.type) {
              i++;
              continue;
            }
            
            if (currentItem.type === 'operator') {
              const operator = currentItem.value;
              const nextItem = expression[i + 1];
              
              if (!nextItem || !nextItem.type) {
                i++;
                continue;
              }
              
              const nextResult = nextItem.type === 'group' ? 
                evaluateSourceExpression(nextItem.value) :
                evaluateSourceExpression([nextItem]);
              
              if (operator === 'AND') {
                result = result && nextResult;
              } else if (operator === 'OR') {
                result = result || nextResult;
              }
              i += 2;
            } else {
              i++;
            }
          }
          
          return result;
        };
        
        if (!evaluateSourceExpression(sourceExpression)) return false;
      }

      // Category filter with expression logic
      const categoryExpression = ((filters as any).categoryExpression || []).filter((item: any) => item && item.type);
      if (categoryExpression.length > 0) {
        const evaluateCategoryExpression = (expression: any[]): boolean => {
          if (!expression || expression.length === 0) return true;
          if (expression.length === 1) {
            const item = expression[0];
            if (!item || !item.type) return false;
            if (item.type === 'category') {
              return article.category === item.value;
            } else if (item.type === 'group') {
              return evaluateCategoryExpression(item.value);
            }
            return false;
          }
          
          let result = evaluateCategoryExpression([expression[0]]);
          let i = 1;
          
          while (i < expression.length) {
            const currentItem = expression[i];
            if (!currentItem || !currentItem.type) {
              i++;
              continue;
            }
            
            if (currentItem.type === 'operator') {
              const operator = currentItem.value;
              const nextItem = expression[i + 1];
              
              if (!nextItem || !nextItem.type) {
                i++;
                continue;
              }
              
              const nextResult = nextItem.type === 'group' ? 
                evaluateCategoryExpression(nextItem.value) :
                evaluateCategoryExpression([nextItem]);
              
              if (operator === 'AND') {
                result = result && nextResult;
              } else if (operator === 'OR') {
                result = result || nextResult;
              }
              i += 2;
            } else {
              i++;
            }
          }
          
          return result;
        };
        
        if (!evaluateCategoryExpression(categoryExpression)) return false;
      }

      // Country filter with expression logic
      const countryExpression = ((filters as any).countryExpression || []).filter((item: any) => item && item.type);
      if (countryExpression.length > 0) {
        const evaluateCountryExpression = (expression: any[]): boolean => {
          if (!expression || expression.length === 0) return true;
          if (expression.length === 1) {
            const item = expression[0];
            if (!item || !item.type) return false;
            if (item.type === 'country') {
              return (article.country || '') === item.value;
            } else if (item.type === 'group') {
              return evaluateCountryExpression(item.value);
            }
            return false;
          }
          
          let result = evaluateCountryExpression([expression[0]]);
          let i = 1;
          
          while (i < expression.length) {
            const currentItem = expression[i];
            if (!currentItem || !currentItem.type) {
              i++;
              continue;
            }
            
            if (currentItem.type === 'operator') {
              const operator = currentItem.value;
              const nextItem = expression[i + 1];
              
              if (!nextItem || !nextItem.type) {
                i++;
                continue;
              }
              
              const nextResult = nextItem.type === 'group' ? 
                evaluateCountryExpression(nextItem.value) :
                evaluateCountryExpression([nextItem]);
              
              if (operator === 'AND') {
                result = result && nextResult;
              } else if (operator === 'OR') {
                result = result || nextResult;
              }
              i += 2;
            } else {
              i++;
            }
          }
          
          return result;
        };
        
        if (!evaluateCountryExpression(countryExpression)) return false;
      }

      // Date range filter (simplified for demo)
      if (filters.dateRange !== 'all') {
        const articleDate = new Date(article.published_date);
        const now = new Date();
        const hoursDiff = (now.getTime() - articleDate.getTime()) / (1000 * 60 * 60);
        
        switch (filters.dateRange) {
          case '1h':
            if (hoursDiff > 1) return false;
            break;
          case '12h':
            if (hoursDiff > 12) return false;
            break;
          case '24h':
            if (hoursDiff > 24) return false;
            break;
          case '7d':
            if (hoursDiff > 168) return false;
            break;
          case '30d':
            if (hoursDiff > 720) return false;
            break;
        }
      }

      return true;
    });
  }, []);

  // Fetch a specific page of results
  const fetchPage = useCallback(async (page: number, size: number, basePayload: NewsSearchRequest) => {
    const offset = (page - 1) * size;
    const searchRequest: NewsSearchRequest = {
      ...basePayload,
      limit: size,
      offset: offset,
    };
    
    // Check cache first
    const cached = newsCache.getCachedPage(basePayload, page, size, id);
    if (cached) {
      // Ensure all cached articles have IDs
      const articlesWithIds = cached.articles.map(ensureArticleId);
      
      // Update local fetchedPages cache
      setFetchedPages(prev => {
        const newMap = new Map(prev);
        newMap.set(page, articlesWithIds);
        return newMap;
      });
      
      // Update total found from cached data
      if (page === 1) {
        setTotalFound(cached.total);
      }
      
      return articlesWithIds;
    }
    
    // Not in cache, fetch from API
    const response = await newsSearchAPI.searchNews(searchRequest);
    
    if (response.articles && response.articles.length > 0) {
      // Ensure all articles have IDs
      const articlesWithIds = response.articles.map(ensureArticleId);
      
      // Update total found from first page
      if (page === 1) {
        setTotalFound(response.total || 0);
      }
      
      // Store in cache
      newsCache.setCachedPage(basePayload, page, size, articlesWithIds, response.total || 0, id);
      
      // Cache this page in local state
      setFetchedPages(prev => {
        const newMap = new Map(prev);
        newMap.set(page, articlesWithIds);
        return newMap;
      });
      
      return articlesWithIds;
    }
    
    return [];
  }, [id]);

  // Run news search - fetch first page only
  const runNewsSearch = useCallback(async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    setError(null);
    setCurrentPage(1);
    setFetchedPages(new Map()); // Clear local cache on new search
    setCurrentResults([]);
    
    // Clear selected articles when running a new search
    setSelectedArticles(new Set());
    
    try {
      // Get current filters at the time of execution
      const currentFilters = localFiltersRef.current;
      
      // Build API payload from filters with the correct limit
      const pageSize = localDisplayOptions.maxResults || 20;
      const basePayload = buildApiPayload(currentFilters, pageSize);
      
      // Clear cache when forcing refresh
      if (forceRefresh) {
        newsCache.clearCache(basePayload, id);
      }
      
      // Try to load first page from cache if available
      const cached = newsCache.getCachedPage(basePayload, 1, pageSize, id);
      if (cached && cached.articles.length > 0 && !forceRefresh) {
        console.log(`📦 Found cached page 1, restoring to local cache`);
        setFetchedPages(new Map([[1, cached.articles.map(ensureArticleId)]]));
        setTotalFound(cached.total);
      }
      
      // Fetch first page (will use cache if available)
      const firstPageArticles = await fetchPage(1, pageSize, basePayload);
      
      if (firstPageArticles.length > 0) {
        setCurrentResults(firstPageArticles);
        setNewsArticles(firstPageArticles); // Keep for backward compatibility
      } else {
        setCurrentResults([]);
        setNewsArticles([]);
        setTotalFound(0);
      }
      
      initialLoadDone.current = true;
      
    } catch (err) {
      setError('Failed to fetch news articles');
      console.error('News search error:', err);
      setCurrentResults([]);
      setNewsArticles([]);
      setTotalFound(0);
    } finally {
      setIsLoading(false);
    }
  }, [id, buildApiPayload, fetchPage, localDisplayOptions.maxResults]);

  // Auto-refresh functionality - refresh every 8 minutes
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      console.log(`📰 NewsTile ${id}: Auto-refresh triggered`);
      runNewsSearch(true); // Force refresh on auto-refresh
    }, 8 * 60 * 1000); // 8 minutes

    return () => clearInterval(interval);
  }, [autoRefresh, runNewsSearch, id]);

  // Initial load - only if we don't have cached data
  useEffect(() => {
    if (!initialLoadDone.current && newsArticles.length === 0) {
      initialLoadDone.current = true;
      // Check if we have fresh cached data (this check happens in the cache loading effect above)
      // If no cache exists or cache is expired, run search
      const pageSize = displayOptions.maxResults || 20;
      const basePayload = buildApiPayload(localFilters, pageSize);
      const cached = newsCache.getCachedPage(basePayload, 1, pageSize, id);
      if (!cached || cached.articles.length === 0) {
        console.log(`📰 NewsTile ${id}: No cache found, running initial search`);
        runNewsSearch();
      }
    }
  }, [id, localFilters, displayOptions.maxResults, buildApiPayload, runNewsSearch]); // Run when dependencies change

  const handleSettingsOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  };

  const handleSettingsClose = () => {
    setSettingsAnchor(null);
  };

  // Fetch page if not cached, then compute current page results
  useEffect(() => {
    const loadCurrentPage = async () => {
      // Check if current page is already cached
      if (fetchedPages.has(currentPage)) {
        const cachedArticles = fetchedPages.get(currentPage) || [];
        setCurrentResults(cachedArticles);
        setNewsArticles(cachedArticles); // Keep for backward compatibility
        setIsLoadingPage(false);
        return;
      }
      
      // Only fetch if we have filters or totalFound indicates there are results
      if (totalFound > 0 || currentPage === 1) {
        // Use isLoadingPage for page navigation, isLoading only for initial search
        if (currentPage === 1) {
          setIsLoading(true);
        } else {
          setIsLoadingPage(true);
        }
        
        try {
          const currentFilters = localFiltersRef.current;
          const pageSize = localDisplayOptions.maxResults || 20;
          const basePayload = buildApiPayload(currentFilters, pageSize);
          const pageArticles = await fetchPage(currentPage, pageSize, basePayload);
          
          // Only update results once we have the new page data
          setCurrentResults(pageArticles);
          setNewsArticles(pageArticles); // Keep for backward compatibility
        } catch (err) {
          console.error('Error fetching page:', err);
          if (currentPage === 1) {
            setCurrentResults([]);
            setNewsArticles([]);
          }
          // For other pages, keep current results on error
        } finally {
          setIsLoading(false);
          setIsLoadingPage(false);
        }
      } else {
        // No results, clear display
        if (currentPage === 1) {
          setCurrentResults([]);
          setNewsArticles([]);
        }
      }
    };
    
    if (totalFound > 0 || currentPage === 1) {
      loadCurrentPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, localDisplayOptions.maxResults]);
  
  // Update current results when page is cached
  useEffect(() => {
    if (fetchedPages.has(currentPage)) {
      const cachedArticles = fetchedPages.get(currentPage) || [];
      setCurrentResults(cachedArticles);
      setNewsArticles(cachedArticles); // Keep for backward compatibility
    }
  }, [currentPage, fetchedPages]);

  // Handle page change
  const handlePageChange = async (newPage: number) => {
    const pageSize = localDisplayOptions.maxResults || 20;
    const maxPages = totalFound > 0 ? Math.ceil(totalFound / pageSize) : 0;
    
    if (newPage < 1 || (maxPages > 0 && newPage > maxPages)) {
      return;
    }
    
    // If page is cached, just switch to it immediately
    if (fetchedPages.has(newPage)) {
      setCurrentPage(newPage);
      return;
    }
    
    // Otherwise, set loading state and fetch
    setIsLoadingPage(true);
    setCurrentPage(newPage);
    
    // Fetch page if not cached
    if (!fetchedPages.has(newPage)) {
      try {
        const currentFilters = localFiltersRef.current;
        const basePayload = buildApiPayload(currentFilters, pageSize);
        await fetchPage(newPage, pageSize, basePayload);
      } catch (err) {
        console.error('Error fetching page:', err);
      } finally {
        setIsLoadingPage(false);
      }
    }
  };

  const handleDisplayOptionsChange = (option: keyof typeof displayOptions) => {
    const newOptions = {
      ...localDisplayOptions,
      [option]: !localDisplayOptions[option],
    };
    setLocalDisplayOptions(newOptions);
    // Debounce the settings change to prevent frequent updates
    setTimeout(() => {
      onSettingsChange(id, { displayOptions: newOptions });
    }, 100);
  };

  const handleAutoRefreshToggle = () => {
    // Debounce the settings change to prevent frequent updates
    setTimeout(() => {
      onSettingsChange(id, { autoRefresh: !autoRefresh });
    }, 100);
  };

  const handlePinToggle = () => {
    togglePin();
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove News Tile from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });
    if (confirmed) {
      onRemove(id);
    }
  };

  // Toggle article selection
  const handleArticleSelect = (articleId: string) => {
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

  const handleArticleClick = (article: NewsArticle) => {
    window.open(article.source_url, '_blank', 'noopener,noreferrer');
  };

  const handleAddToContextClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (selectedArticles.size === 0) {
      alert('Please select at least one article to add to context');
      return;
    }
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToContext = (target: 'new' | 'sidebar') => {
    if (selectedArticles.size === 0) return;
    
    // Get the selected article objects from newsArticles state
    const selectedArticleObjects = newsArticles.filter(article => {
      const articleWithId = ensureArticleId(article);
      return selectedArticles.has(articleWithId.id);
    });
    
    console.log(`📦 Adding ${selectedArticleObjects.length} article(s) to context (target: ${target})`);
    
    // Prepare article data for batch addition
    const articlesToAdd = selectedArticleObjects.map(article => ({
      articleId: article.source_url, // Use URL as unique ID
      title: article.title,
      source: article.source_name,
      articleData: {
        url: article.source_url,
        title: article.title,
        description: article.description,
        source: article.source_name,
        published_date: article.published_date,
        keywords: article.keywords,
        category: article.category,
        image_url: article.image_url,
      }
    }));
    
    // Use batch addition for multiple articles, single addition for one article
    if (articlesToAdd.length > 1) {
      addMultipleArticlesToContext(articlesToAdd, target);
      console.log(`✅ Added ${articlesToAdd.length} articles to context in batch`);
    } else if (articlesToAdd.length === 1) {
      const article = articlesToAdd[0];
      addArticleToContext(
        article.articleId,
        article.title,
        article.source,
        article.articleData,
        target
      );
      console.log(`✅ Added article to context: ${article.title}`);
    }
    
    // Clear selection and close menu
    setSelectedArticles(new Set());
    handleContextMenuClose();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      return `${Math.floor(diffInHours * 60)}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // Dynamic pagination based on tile height
  const calculateResultsPerPage = useCallback(() => {
    if (!tileRef.current) return 5; // Default fallback
    
    const tileHeight = tileRef.current.clientHeight;
    const headerHeight = 60; // Approximate header height
    const paginationHeight = 40; // Approximate pagination height
    const padding = 24; // Tile padding (12px * 2)
    
    // Calculate available height for articles
    const availableHeight = tileHeight - headerHeight - paginationHeight - padding;
    const articleHeight = localDisplayOptions.compactView ? 60 : 120; // Compact vs full view
    const maxArticles = Math.floor(availableHeight / articleHeight);
    
    // Ensure minimum of 10 articles and maximum of 20 articles
    return Math.max(10, Math.min(20, maxArticles));
  }, [localDisplayOptions.compactView]);

  const [resultsPerPage, setResultsPerPage] = useState(10);
  
  // Update results per page when tile size changes
  useEffect(() => {
    const newResultsPerPage = calculateResultsPerPage();
    setResultsPerPage(newResultsPerPage);
  }, [calculateResultsPerPage, size]);

  // Add ResizeObserver to recalculate when tile is resized (with debounce)
  useEffect(() => {
    if (!tileRef.current) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      // Debounce the resize calculation to prevent infinite loops
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const newResultsPerPage = calculateResultsPerPage();
        setResultsPerPage(newResultsPerPage);
      }, 100); // 100ms debounce
    });

    resizeObserver.observe(tileRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [calculateResultsPerPage]);

  // Use currentResults for display (page-based fetching)
  // Fallback to sliced newsArticles for backward compatibility
  const displayArticles = currentResults.length > 0 ? currentResults : newsArticles;
  const pageSize = localDisplayOptions.maxResults || 20;
  const totalPages = totalFound > 0 ? Math.ceil(totalFound / pageSize) : Math.ceil(displayArticles.length / resultsPerPage);
  const currentArticles = currentResults.length > 0 ? currentResults : displayArticles.slice((currentPage - 1) * resultsPerPage, currentPage * resultsPerPage);
  const startIndex = totalFound > 0 ? ((currentPage - 1) * pageSize) + 1 : ((currentPage - 1) * resultsPerPage) + 1;
  const endIndex = totalFound > 0 ? Math.min(currentPage * pageSize, totalFound) : Math.min(currentPage * resultsPerPage, displayArticles.length);

  // Scroll to top when page changes
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [currentPage]);

  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid #374151',
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        '&:hover': {
          borderColor: '#3b82f6',
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : '0 8px 25px rgba(59, 130, 246, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: newsArticles.length > 0 ? '#3b82f6' : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
          {/* Selection checkbox */}
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onClick={(e) => {
                const now = Date.now();
                if (now - lastClickTimeRef.current < 200) {
                  return;
                }
                lastClickTimeRef.current = now;
                
                e.stopPropagation();
                onSelectionChange(id, !isSelected);
              }}
              sx={{ 
                color: '#9ca3af',
                '&.Mui-checked': { color: '#3b82f6' },
                p: 0.5,
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
              }}
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            />
          )}
          
          <ArticleIcon sx={{ color: '#3b82f6', fontSize: '1.5rem', mr: 1, flexShrink: 0 }} />
          <Typography variant="h6" color="white" fontWeight={600} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            Financial News
          </Typography>
          
          <Chip
            label={`${newsArticles.length} articles`}
            size="small"
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
            }}
          />
          
          {selectedArticles.size > 0 && (
            <Chip
              label={`${selectedArticles.size} selected`}
              size="small"
              sx={{
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                color: '#22c55e',
                border: '1px solid #22c55e',
                fontSize: '0.75rem',
                height: '20px',
              }}
            />
          )}
          
          {autoRefresh && (
            <Tooltip title="Auto-refresh enabled">
              <AutoRefreshIcon sx={{ color: '#22c55e', fontSize: 16 }} />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <PinButton
            isPinned={pinnedState}
            onTogglePin={togglePin}
          />

          {selectedArticles.size > 0 && (
            <Tooltip title={`Add ${selectedArticles.size} article${selectedArticles.size > 1 ? 's' : ''} to Context`}>
              <IconButton
                size="small"
                onClick={handleAddToContextClick}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
              >
                <ContextIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Refresh News">
            <IconButton
              size="small"
              onClick={() => runNewsSearch(true)} // Force refresh when button is clicked
              disabled={isLoading}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
            >
              <SearchIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton
              size="small"
              onClick={handleSettingsOpen}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
            >
              <SettingsIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Remove tile">
            <IconButton
              size="small"
              onClick={handleRemove}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{ color: '#9ca3af', '&:hover': { color: '#dc2626' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Loading state */}
      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            Searching news...
          </Typography>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 1, backgroundColor: 'rgba(220, 38, 38, 0.1)', flexShrink: 0 }}>
          {error}
        </Alert>
      )}

      {/* Articles List */}
      {newsArticles.length > 0 && !isLoading && (
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0,
          mt: 1
        }}>
          <List 
            ref={listRef}
            sx={{ 
              flex: 1,
              backgroundColor: 'transparent',
              maxHeight: 'calc(100% - 60px)', // Leave space for pagination
              overflowY: 'auto',
              overflowX: 'hidden',
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
            {currentArticles.map((article, index) => {
              // Ensure article has an ID
              const articleWithId = ensureArticleId(article);
              const articleId = articleWithId.id;
              
              return (
              <ListItem
                key={articleId || `article-${index}`}
                sx={{
                  border: '1px solid rgba(55, 65, 81, 0.3)',
                  borderRadius: '8px',
                  mb: 1,
                  backgroundColor: selectedArticles.has(articleId) 
                    ? 'rgba(34, 197, 94, 0.1)' 
                    : 'rgba(15, 23, 42, 0.3)',
                  borderColor: selectedArticles.has(articleId) 
                    ? '#22c55e' 
                    : 'rgba(55, 65, 81, 0.3)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 60,
                  '&:hover': {
                    backgroundColor: selectedArticles.has(articleId)
                      ? 'rgba(34, 197, 94, 0.15)'
                      : 'rgba(59, 130, 246, 0.05)',
                  },
                }}
              >
                {/* Left side: Checkbox and content */}
                <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, mr: 2 }}>
                  <Checkbox
                    checked={selectedArticles.has(articleId)}
                    onChange={() => {
                      handleArticleSelect(articleId);
                    }}
                    sx={{ 
                      color: '#9ca3af',
                      '&.Mui-checked': { color: '#22c55e' },
                      mr: 1
                    }}
                    size="small"
                  />
                  <Box 
                    sx={{ flex: 1, cursor: 'pointer' }}
                    onClick={() => handleArticleClick(article)}
                  >
                    <Typography
                      variant="subtitle2"
                      color="white"
                      sx={{
                        fontWeight: 600,
                        fontSize: localDisplayOptions.compactView ? '0.875rem' : '1rem',
                        lineHeight: 1.3,
                        mb: 0.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {article.title}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                      {localDisplayOptions.showSource && (
                        <Typography
                          variant="caption"
                          color="#9ca3af"
                          sx={{ fontSize: '0.75rem' }}
                        >
                          {article.source_name}
                        </Typography>
                      )}
                      {localDisplayOptions.showDate && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <CalendarIcon sx={{ fontSize: 12, color: '#6b7280' }} />
                          <Typography variant="caption" color="#6b7280">
                            {formatDate(article.published_date)}
                          </Typography>
                        </Box>
                      )}
                      {localDisplayOptions.showKeywords && article.keywords && (
                        <Chip
                          label={article.keywords.split(',')[0]}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            color: '#3b82f6',
                            fontSize: '0.7rem',
                            height: '18px',
                          }}
                        />
                      )}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArticleClick(article);
                        }}
                        sx={{ 
                          color: '#6b7280',
                          '&:hover': { color: '#3b82f6' },
                          p: 0.5,
                          ml: 'auto'
                        }}
                      >
                        <OpenInNewIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>

                {/* Right side: Centered image */}
                {localDisplayOptions.showImages && article.image_url ? (
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
                ) : localDisplayOptions.showImages ? (
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
                ) : null}
              </ListItem>
              );
            })}
          </List>

          {/* Loading indicator for page loading */}
          {isLoadingPage && (
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
              <CircularProgress size={20} sx={{ color: '#3b82f6', mr: 2 }} />
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                Loading page {currentPage}...
              </Typography>
            </Box>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              mt: 1, 
              pt: 1, 
              borderTop: '1px solid rgba(55, 65, 81, 0.3)' 
            }}>
              <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                {totalFound > 0 ? (
                  <>Page {currentPage} of {totalPages} (Showing {startIndex}-{endIndex} of {totalFound} results)</>
                ) : (
                  <>Showing {startIndex}-{endIndex} of {displayArticles.length} articles</>
                )}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || isLoading || isLoadingPage}
                  startIcon={<ChevronLeftIcon />}
                  sx={{
                    color: '#9ca3af',
                    borderColor: '#374151',
                    fontSize: '0.75rem',
                    minWidth: 'auto',
                    padding: '4px 8px',
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
                  disabled={currentPage >= totalPages || isLoading || isLoadingPage}
                  endIcon={<ChevronRightIcon />}
                  sx={{
                    color: '#9ca3af',
                    borderColor: '#374151',
                    fontSize: '0.75rem',
                    minWidth: 'auto',
                    padding: '4px 8px',
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
      )}

      {/* No Results */}
      {!isLoading && newsArticles.length === 0 && !error && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No articles match your filters. Try adjusting your search criteria.
          </Typography>
        </Box>
      )}

      {/* Settings Menu */}
      <Menu
        anchorEl={settingsAnchor}
        open={Boolean(settingsAnchor)}
        onClose={handleSettingsClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <MenuItem onClick={() => { setFiltersDialogOpen(true); handleSettingsClose(); }}>
          <FilterIcon sx={{ mr: 1, fontSize: 18 }} />
          Edit Filters
        </MenuItem>
        <MenuItem onClick={() => { setDisplayDialogOpen(true); handleSettingsClose(); }}>
          <SettingsIcon sx={{ mr: 1, fontSize: 18 }} />
          Display Options
        </MenuItem>
        <MenuItem onClick={handleAutoRefreshToggle}>
          <AutoRefreshIcon sx={{ mr: 1, fontSize: 18 }} />
          {autoRefresh ? 'Disable' : 'Enable'} Auto-refresh
        </MenuItem>
        <MenuItem onClick={handlePinToggle}>
          <PinIcon sx={{ mr: 1, fontSize: 18 }} />
          {pinnedState ? 'Unpin' : 'Pin'} Tile
        </MenuItem>
      </Menu>

      {/* Context Target Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <MenuItem onClick={() => handleAddToContext('new')}>
          <NewChatIcon sx={{ mr: 1, fontSize: 18, color: '#10b981' }} />
          Add to New Chat
        </MenuItem>
        <MenuItem onClick={() => handleAddToContext('sidebar')}>
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Current Sidebar Chat
        </MenuItem>
      </Menu>

      {/* Filters Dialog */}
      <Dialog
        open={filtersDialogOpen}
        onClose={() => setFiltersDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DialogTitle>News Filters</DialogTitle>
        <DialogContent
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Box sx={{ mt: 2, display: 'grid', gap: 3 }}>
            {/* Keywords Search with Inline AND/OR Logic */}
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
                      const currentExpression = (localFilters as any).keywordExpression || [];
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
                      
                      setLocalFilters(prev => ({ 
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
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseUp={(e) => e.stopPropagation()}
                    />
                    {keywordError && (
                      <Typography variant="caption" sx={{ color: '#ef4444', mt: 0.5, display: 'block' }}>
                        {keywordError}
                      </Typography>
                    )}
                  </Box>
                )}
              />

              {/* Keywords Display with AND/OR Logic */}
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
                {((localFilters as any).keywordExpression || []).length > 0 && (
                  <IconButton
                    size="small"
                    onClick={() => {
                      setLocalFilters(prev => ({
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
                  {((localFilters as any).keywordExpression || []).map((item: any, index: number) => (
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
                              setSelectedGroupIndex(null); // Clear group selection when selecting keyword
                            }
                          }}
                          onDelete={() => {
                            const newExpression = [...(localFilters as any).keywordExpression];
                            newExpression.splice(index, 1);
                            setLocalFilters(prev => ({ 
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
                              const newExpression = [...(localFilters as any).keywordExpression];
                              newExpression[index] = { type: 'operator', value: item.value === 'AND' ? 'OR' : 'AND' };
                              setLocalFilters(prev => ({ 
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
                              const newExpression = [...(localFilters as any).keywordExpression];
                              newExpression.splice(index, 1);
                              setLocalFilters(prev => ({ 
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
                          setSelectedKeywords([]); // Clear keyword selection when selecting group
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
                                    const newExpression = [...(localFilters as any).keywordExpression];
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
                                    
                                    setLocalFilters(prev => ({ 
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
                                    const newExpression = [...(localFilters as any).keywordExpression];
                                    const newGroupValue = [...item.value];
                                    newGroupValue[groupIndex] = { type: 'operator', value: groupItem.value === 'AND' ? 'OR' : 'AND' };
                                    newExpression[index] = { type: 'group', value: newGroupValue };
                                    setLocalFilters(prev => ({ 
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
                              const newExpression = [...(localFilters as any).keywordExpression];
                              newExpression.splice(index, 1);
                              setLocalFilters(prev => ({ 
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
                
                {/* Create Group Button */}
                {selectedKeywords.length > 1 && (
                  <Box sx={{ mt: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        const newExpression = [...(localFilters as any).keywordExpression];
                        
                        // Find the indices of selected keywords
                        const selectedIndices = selectedKeywords.map(keyword => 
                          newExpression.findIndex(item => item.type === 'keyword' && item.value === keyword)
                        ).sort((a, b) => a - b);
                        
                        // Find the range of items to include in the group (including operators between keywords)
                        const minIndex = Math.min(...selectedIndices);
                        const maxIndex = Math.max(...selectedIndices);
                        
                        // Extract the items that should be in the group (keywords and operators between them)
                        const groupItems = newExpression.slice(minIndex, maxIndex + 1);
                        
                        // Create the new expression by replacing the range with the group
                        const newExpressionItems = [
                          ...newExpression.slice(0, minIndex), // Items before the group
                          { type: 'group', value: groupItems }, // The group containing keywords and operators
                          ...newExpression.slice(maxIndex + 1) // Items after the group
                        ];
                        
                        setLocalFilters(prev => ({ 
                          ...prev, 
                          keywordExpression: newExpressionItems 
                        }));
                        setSelectedKeywords([]);
                        setSelectedGroupIndex(null);
                      }}
                      sx={{ 
                        color: '#10b981', 
                        borderColor: '#10b981',
                        '&:hover': { borderColor: '#059669', backgroundColor: '#064e3b' }
                      }}
                    >
                      Create Group ({selectedKeywords.length} keywords)
                    </Button>
                  </Box>
                )}
                
                {/* Add Operator After Selected Item */}
                {(selectedKeywords.length === 1 || selectedGroupIndex !== null) && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" sx={{ color: '#9ca3af', mb: 1, display: 'block' }}>
                      Add operator after selected {selectedKeywords.length === 1 ? 'keyword' : 'group'}:
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const newExpression = [...(localFilters as any).keywordExpression];
                          let selectedIndex = -1;
                          
                          if (selectedKeywords.length === 1) {
                            // Find selected keyword
                            const selectedKeyword = selectedKeywords[0];
                            selectedIndex = newExpression.findIndex(item => 
                              item.type === 'keyword' && item.value === selectedKeyword
                            );
                          } else if (selectedGroupIndex !== null) {
                            // Use selected group index
                            selectedIndex = selectedGroupIndex;
                          }
                          
                          if (selectedIndex !== -1) {
                            newExpression.splice(selectedIndex + 1, 0, { type: 'operator', value: 'AND' });
                            setLocalFilters(prev => ({ 
                              ...prev, 
                              keywordExpression: newExpression 
                            }));
                          }
                        }}
                        sx={{ 
                          color: '#f59e0b', 
                          borderColor: '#f59e0b',
                          '&:hover': { borderColor: '#d97706', backgroundColor: '#78350f' }
                        }}
                      >
                        Add AND after
                      </Button>
                      
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const newExpression = [...(localFilters as any).keywordExpression];
                          let selectedIndex = -1;
                          
                          if (selectedKeywords.length === 1) {
                            // Find selected keyword
                            const selectedKeyword = selectedKeywords[0];
                            selectedIndex = newExpression.findIndex(item => 
                              item.type === 'keyword' && item.value === selectedKeyword
                            );
                          } else if (selectedGroupIndex !== null) {
                            // Use selected group index
                            selectedIndex = selectedGroupIndex;
                          }
                          
                          if (selectedIndex !== -1) {
                            newExpression.splice(selectedIndex + 1, 0, { type: 'operator', value: 'OR' });
                            setLocalFilters(prev => ({ 
                              ...prev, 
                              keywordExpression: newExpression 
                            }));
                          }
                        }}
                        sx={{ 
                          color: '#f59e0b', 
                          borderColor: '#f59e0b',
                          '&:hover': { borderColor: '#d97706', backgroundColor: '#78350f' }
                        }}
                      >
                        Add OR after
                      </Button>
                    </Box>
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
              <Select
                value={localFilters.dateRange}
                onChange={(e) => {
                  setLocalFilters(prev => ({ ...prev, dateRange: e.target.value }));
                }}
                sx={{ color: 'white' }}
              >
                <MenuItem value="1h">Last Hour</MenuItem>
                <MenuItem value="12h">12 Hours (Latest)</MenuItem>
                <MenuItem value="24h">Last 24 Hours</MenuItem>
                <MenuItem value="7d">Last 7 Days</MenuItem>
                <MenuItem value="30d">Last 30 Days</MenuItem>
                <MenuItem value="all">All Time</MenuItem>
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
          </Box>
        </DialogContent>
        <DialogActions sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, py: 2 }}>
          <Button onClick={() => {
            setFiltersDialogOpen(false);
            // Clean up trailing operators before resetting
            const cleanedFilters = cleanupAllExpressions(localFilters);
            setLocalFilters(cleanedFilters);
          }}>Cancel</Button>
          
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {/* Results Per Page */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
              <Select
                value={localDisplayOptions.maxResults || 20}
                label="Per Page"
                onChange={(e) => {
                  const newMaxResults = Number(e.target.value);
                  const newOptions = {
                    ...localDisplayOptions,
                    maxResults: newMaxResults,
                  };
                  setLocalDisplayOptions(newOptions);
                  // Update settings (search will be triggered when user clicks "Apply & Search")
                  setTimeout(() => {
                    onSettingsChange(id, { displayOptions: newOptions });
                  }, 100);
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
            
            <Button onClick={() => { 
              // Clean up trailing operators before applying
              const cleanedFilters = cleanupAllExpressions(localFilters);
              // Update local state without triggering onSettingsChange immediately
              setLocalFilters(cleanedFilters);
              setFiltersDialogOpen(false); 
              runNewsSearch();
              // Update settings after search to avoid race condition
              setTimeout(() => {
                onSettingsChange(id, { filters: cleanedFilters });
              }, 200);
            }} 
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
            }}>
              Apply & Search
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Display Options Dialog */}
      <Dialog
        open={displayDialogOpen}
        onClose={() => setDisplayDialogOpen(false)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
          },
        }}
      >
        <DialogTitle>Display Options</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showImages}
                  onChange={() => handleDisplayOptionsChange('showImages')}
                />
              }
              label="Show Article Images"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showSource}
                  onChange={() => handleDisplayOptionsChange('showSource')}
                />
              }
              label="Show Source Name"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showDate}
                  onChange={() => handleDisplayOptionsChange('showDate')}
                />
              }
              label="Show Publication Date"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showKeywords}
                  onChange={() => handleDisplayOptionsChange('showKeywords')}
                />
              }
              label="Show Keywords"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.compactView}
                  onChange={() => handleDisplayOptionsChange('compactView')}
                />
              }
              label="Compact View"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisplayDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Memo comparison - check essential props
const NewsTileMemo = memo(NewsTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.id !== nextProps.id) {
    return false; // Re-render
  }
  
  // Check if display options changed
  const prevDisplay = prevProps.displayOptions;
  const nextDisplay = nextProps.displayOptions;
  if (prevDisplay && nextDisplay) {
    if (prevDisplay.showImages !== nextDisplay.showImages ||
        prevDisplay.showSource !== nextDisplay.showSource ||
        prevDisplay.showDate !== nextDisplay.showDate ||
        prevDisplay.showKeywords !== nextDisplay.showKeywords ||
        prevDisplay.maxResults !== nextDisplay.maxResults ||
        prevDisplay.compactView !== nextDisplay.compactView) {
      return false; // Re-render
    }
  }
  
  // Check if other important props changed
  if (prevProps.autoRefresh !== nextProps.autoRefresh ||
      prevProps.isPinned !== nextProps.isPinned ||
      prevProps.isDragging !== nextProps.isDragging ||
      prevProps.isResizing !== nextProps.isResizing ||
      prevProps.isSelected !== nextProps.isSelected) {
    return false; // Re-render
  }
  
  // If size changed significantly, re-render
  if (prevProps.size && nextProps.size) {
    const sizeThreshold = 10; // 10px threshold
    if (Math.abs(prevProps.size.width - nextProps.size.width) > sizeThreshold ||
        Math.abs(prevProps.size.height - nextProps.size.height) > sizeThreshold) {
      return false; // Re-render
    }
  }
  
  return true; // Don't re-render
});

export default NewsTileMemo;
