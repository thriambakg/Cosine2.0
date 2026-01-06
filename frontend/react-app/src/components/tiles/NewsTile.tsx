import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  TextField,
  Button,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Pagination,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Link,
} from '@mui/material';
import {
  Close as CloseIcon,
  AutoAwesome as AutoRefreshIcon,
  Search as SearchIcon,
  Article as ArticleIcon,
  Launch as LaunchIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ViewColumn as ViewColumnIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { newsSearchAPI, NewsSearchRequest, NewsArticle } from '../../services/api';
import { filesystemAPI } from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, addArticleToContext, addMultipleArticlesToContext, confirmDialog, getIconByName, getDefaultIconForTileType } from './common';
import MultiSelectField from '../MultiSelectField';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';

interface NewsTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResize?: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
  // News specific props
  searchParams?: {
    keywords?: string[];
    sources?: string[];
    categories?: string[];
    countries?: string[];
  };
  filterSettings?: {
    sources?: string[];
    categories?: string[];
    countries?: string[];
  };
  articles?: NewsArticle[];
  displayOptions?: {
    showTitle: boolean;
    showDescription: boolean;
    showSource: boolean;
    showCategory: boolean;
    showDate: boolean;
    showImage: boolean;
    showResultsTable: boolean;
    maxResults: number;
    compactView: boolean;
  };
  paginationState?: {
    totalResultsLoaded: number;
    lastEvaluatedKeys: any[];
    hasMore: boolean;
  };
  autoRefresh?: boolean;
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const NewsTile: React.FC<NewsTileProps> = ({
  id,
  size,
  dashboardContext,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isResizing = false,
  isSelected = false,
  onSelectionChange,
  searchParams = {
    keywords: [],
    sources: [],
    categories: [],
    countries: [],
  },
  filterSettings: initialFilterSettings,
  paginationState: initialPaginationState = {
    totalResultsLoaded: 0,
    lastEvaluatedKeys: [],
    hasMore: false,
  },
  articles = [],
  displayOptions = {
    showTitle: true,
    showDescription: false,
    showSource: true,
    showCategory: true,
    showDate: true,
    showImage: true,
    showResultsTable: true,
    maxResults: 200,
    compactView: false,
  },
  autoRefresh = false,
  isPinned = false,
  customTitle,
  customColor,
  customIcon,
}) => {
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const { user } = useAuth();
  const { isEasyMode } = useEasyMode();
  const { openItemDetails } = useDialogManagerHelpers();
  
  // Filter state for client-side filtering - restore from props if available
  const [allResults, setAllResults] = useState<NewsArticle[]>(() => {
    // Initialize from articles prop if available
    if (articles && articles.length > 0) {
      return articles.map((article, index) => ({
        ...article,
        id: article.id || `article_${index}_${Date.now()}`,
      }));
    }
    return [];
  });
  const [filteredResults, setFilteredResults] = useState<NewsArticle[]>(() => {
    // Initialize from articles prop if available
    if (articles && articles.length > 0) {
      return articles.map((article, index) => ({
        ...article,
        id: article.id || `article_${index}_${Date.now()}`,
      }));
    }
    return [];
  });
  const [selectedFilters, setSelectedFilters] = useState<{
    sources: string[];
    categories: string[];
    countries: string[];
  }>({
    sources: initialFilterSettings?.sources || [],
    categories: initialFilterSettings?.categories || [],
    countries: initialFilterSettings?.countries || [],
  });

  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchParams, setCurrentSearchParams] = useState<{
    keywords?: string[];
    sources?: string[];
    categories?: string[];
    countries?: string[];
  }>({
    ...searchParams,
  });
  const [currentResults, setCurrentResults] = useState<NewsArticle[]>(articles);
  
  // Ensure defaults are set for display options first (before useCallback)
  const defaultDisplayOptions = {
    showTitle: true,
    showDescription: false,
    showSource: true,
    showCategory: true,
    showDate: true,
    showImage: true,
    showResultsTable: true,
    maxResults: 200,
    compactView: false,
  };
  
  const [localDisplayOptions, setLocalDisplayOptions] = useState(() => {
    const merged = {
      ...defaultDisplayOptions,
      ...displayOptions
    };
    // Always force showImage to true - images should always be visible
    merged.showImage = true;
    return merged;
  });
  
  const paginationState = initialPaginationState;
  
  // Restore pagination state from prop (session/database persistence)
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<{ published_date?: string; SK?: string } | null>(() => {
    // First try to get from paginationState prop
    if (initialPaginationState?.lastEvaluatedKeys && initialPaginationState.lastEvaluatedKeys.length > 0) {
      // Use the last key in the array (most recent)
      return initialPaginationState.lastEvaluatedKeys[initialPaginationState.lastEvaluatedKeys.length - 1];
    }
    // Fallback to localStorage for backward compatibility
    try {
      const saved = localStorage.getItem(`newsTile_lastEvaluatedKey_${id}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>(() => {
    // Restore from paginationState prop if available
    if (initialPaginationState?.lastEvaluatedKeys && initialPaginationState.lastEvaluatedKeys.length > 0) {
      return initialPaginationState.lastEvaluatedKeys;
    }
    return [];
  });
  const [isRestoringPagination, setIsRestoringPagination] = useState<boolean>(false);
  
  // Restore pagination state by reloading results from saved pagination keys
  const restorePaginationState = useCallback(async () => {
    if (!paginationState || !paginationState.lastEvaluatedKeys || paginationState.lastEvaluatedKeys.length === 0) {
      return;
    }

    if (paginationState.totalResultsLoaded <= (currentResults?.length || 0)) {
      // Already have all results, no need to restore
      return;
    }

    console.log('🔄 NewsTile: Restoring pagination state', {
      totalResultsLoaded: paginationState.totalResultsLoaded,
      currentResults: currentResults?.length || 0,
      keysToLoad: paginationState.lastEvaluatedKeys.length,
    });

    setIsRestoringPagination(true);
    setIsLoading(true);
    setError(null);

    try {
      let restoredResults: NewsArticle[] = [...(currentResults || [])];
      let keysToLoad = [...paginationState.lastEvaluatedKeys];
      
      // If we don't have the initial page (currentResults is empty), 
      // we need to load it first before loading continuation pages
      if (restoredResults.length === 0 && currentSearchParams) {
        const searchRequest: NewsSearchRequest = {
          query: {
            keywords: currentSearchParams.keywords && currentSearchParams.keywords.length > 0
              ? currentSearchParams.keywords
              : undefined,
          },
          limit: 200,
        };

        const initialResponse = await newsSearchAPI.searchNews(searchRequest);

        if (initialResponse.articles) {
          const processedResults = initialResponse.articles.map((article, index) => ({
            ...article,
            id: article.id || `article_${index}_${Date.now()}`,
          }));
          restoredResults = [...processedResults];
        }
      }

      // Load each continuation page sequentially until we reach totalResultsLoaded
      while (restoredResults.length < paginationState.totalResultsLoaded && keysToLoad.length > 0) {
        const nextKey = keysToLoad[0];

        const searchRequest: NewsSearchRequest = {
          query: {
            keywords: currentSearchParams?.keywords && currentSearchParams.keywords.length > 0
              ? currentSearchParams.keywords
              : undefined,
          },
          limit: 200,
          lastEvaluatedKey: nextKey,
        };

        const response = await newsSearchAPI.searchNews(searchRequest);

        if (response.articles && response.articles.length > 0) {
          const processedResults = response.articles.map((article, index) => ({
            ...article,
            id: article.id || `article_${index}_${Date.now()}`,
          }));
          restoredResults = [...restoredResults, ...processedResults];
          keysToLoad = keysToLoad.slice(1);
        } else {
          // No more results or error, stop loading
          break;
        }
      }

      // Update state with restored results
      setAllResults(restoredResults);
      setFilteredResults(restoredResults);
      setCurrentResults(restoredResults);
      setLastEvaluatedKeys(paginationState.lastEvaluatedKeys);
      setLastEvaluatedKey(paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1] || null);
      setHasMore(paginationState.hasMore);
      setHasPerformedInitialSearch(true);

      // Update tile with restored results - include pagination state
      onUpdate(id, {
        articles: restoredResults,
        paginationState: {
          totalResultsLoaded: restoredResults.length,
          lastEvaluatedKeys: paginationState.lastEvaluatedKeys,
          hasMore: paginationState.hasMore,
        },
        lastUpdated: Date.now(),
      });

      console.log('✅ NewsTile: Pagination state restored', {
        restoredCount: restoredResults.length,
        targetCount: paginationState.totalResultsLoaded,
      });
    } catch (err) {
      console.error('❌ NewsTile: Error restoring pagination state', err);
      setError('Failed to restore previous results. Please refresh.');
    } finally {
      setIsRestoringPagination(false);
      setIsLoading(false);
    }
  }, [paginationState, currentResults, currentSearchParams, id, onUpdate]);
  const [hasMore, setHasMore] = useState<boolean>(() => {
    // First try to get from paginationState prop
    if (initialPaginationState?.hasMore !== undefined) {
      return initialPaginationState.hasMore;
    }
    // Fallback to localStorage for backward compatibility
    try {
      const saved = localStorage.getItem(`newsTile_hasMore_${id}`);
      return saved === 'true';
    } catch {
      return false;
    }
  });
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<{
    title: boolean;
    source: boolean;
    category: boolean;
    date: boolean;
  }>({
    title: localDisplayOptions.showTitle,
    source: localDisplayOptions.showSource,
    category: localDisplayOptions.showCategory,
    date: localDisplayOptions.showDate,
  });

  // Handle column toggle
  const handleColumnToggle = useCallback((columnKey: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => {
      const newColumns = {
        ...prev,
        [columnKey]: !prev[columnKey],
      };
      
      // Update display options via onSettingsChange to persist
      const displayOptionKey = `show${columnKey.charAt(0).toUpperCase() + columnKey.slice(1)}` as keyof typeof localDisplayOptions;
      onSettingsChange(id, {
        displayOptions: {
          ...localDisplayOptions,
          [displayOptionKey]: newColumns[columnKey],
        },
      });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);
  // Persist searchParams when they change
  useEffect(() => {
    onSettingsChange(id, { searchParams: currentSearchParams });
  }, [currentSearchParams, id, onSettingsChange]);

  // Restore pagination state on mount if needed
  useEffect(() => {
    if (paginationState && paginationState.totalResultsLoaded > (currentResults?.length || 0) && !isRestoringPagination && !isLoading) {
      restorePaginationState();
    }
  }, [paginationState, currentResults?.length, isRestoringPagination, isLoading, restorePaginationState]);

  // Column width state for dynamic sizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`newsTile_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const [isPageSizeManuallySet, setIsPageSizeManuallySet] = useState(() => {
    return localStorage.getItem(`newsTile_pageSize_${id}`) !== null;
  });
  const tileRef = useRef<HTMLDivElement>(null);
  
  // Ref to track pending onUpdate calls (to avoid calling during render)
  const pendingUpdateRef = useRef<{ 
    articles: NewsArticle[];
    paginationState?: {
      totalResultsLoaded: number;
      lastEvaluatedKeys: any[];
      hasMore: boolean;
    };
  } | null>(null);

  // Category and country options (from NewsSearchPage)
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

  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Auto refresh functionality
  const autoRefreshRef = useRef<NodeJS.Timeout>();
  
  // Track if initial search has been performed
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState(false);

  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    console.log('📰 NewsTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setLastEvaluatedKeys([]); // Clear keys on new search
    
    try {
      // Build simplified search request - only keywords are sent to API
      // Sources, categories, and countries are used for client-side filtering
      const searchRequest: NewsSearchRequest = {
        query: {
          keywords: currentSearchParams.keywords && currentSearchParams.keywords.length > 0
            ? currentSearchParams.keywords
            : undefined,
        },
        limit: localDisplayOptions.maxResults || 200,
      };
      
      console.log('📤 NewsTile: Sending search request with keywords:', currentSearchParams.keywords);
      
      console.log('📤 NewsTile: Sending search request:', searchRequest);
      
      const response = await newsSearchAPI.searchNews(searchRequest);
      
      if (response.articles) {
        console.log('📰 NewsTile: Retrieved', response.articles.length, 'articles');
        
        // Debug: Check first article's image_url
        if (response.articles.length > 0) {
          console.log('📰 NewsTile: First article data:', {
            title: response.articles[0].title,
            image_url: response.articles[0].image_url,
            hasImageUrl: !!response.articles[0].image_url,
            allKeys: Object.keys(response.articles[0]),
          });
        }
        
        // Ensure each article has an id for table rendering
        const processedResults = response.articles.map((article, index) => ({
          ...article,
          id: article.id || `article_${index}_${Date.now()}`,
        }));
        
        // Store all results for filtering
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        setAllResults(processedResults);
        setFilteredResults(processedResults);
        setCurrentResults(processedResults);
        setHasPerformedInitialSearch(true);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(newLastEvaluatedKey);
        
        // Store pagination state (only first page key for initial search)
        const newLastEvaluatedKeys = newLastEvaluatedKey ? [newLastEvaluatedKey] : [];
        setLastEvaluatedKeys(newLastEvaluatedKeys);
        
        // Persist pagination state
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            totalResultsLoaded: processedResults.length,
            lastEvaluatedKeys: newLastEvaluatedKeys,
            hasMore: response.has_more || false,
          },
        });
        
        // Update parent component - persist results in session only (not database)
        // Set flag to prevent articles prop sync from overriding our fresh results
        articlesUpdateRef.current = true;
        onUpdate(id, {
          articles: processedResults,
          lastUpdated: Date.now(),
        });
      } else {
        console.error('📰 NewsTile: Search failed - no articles returned');
        setError('Search failed - no articles returned');
        setCurrentResults([]);
        setHasMore(false);
        setHasPerformedInitialSearch(true);
        setLastEvaluatedKeys([]);
        // Clear pagination state
        onSettingsChange(id, {
          searchParams: currentSearchParams,
          paginationState: {
            totalResultsLoaded: 0,
            lastEvaluatedKeys: [],
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('📰 NewsTile: Search error:', err);
      setError(err.message || 'An error occurred during search');
      setCurrentResults([]);
      setHasPerformedInitialSearch(true);
      setHasMore(false);
      setLastEvaluatedKeys([]);
      // Clear pagination state on error
      onSettingsChange(id, {
        searchParams: currentSearchParams,
        paginationState: {
          totalResultsLoaded: 0,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, onSettingsChange]);
  
  // Load more results using cursor-based pagination
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore || !currentSearchParams) return;
    
    setIsLoadingMore(true);
    setError(null);
    
    try {
      // Build search request - only keywords are sent to API
      // Sources, categories, and countries are used for client-side filtering
      const searchRequest: NewsSearchRequest = {
        query: {
          keywords: currentSearchParams.keywords && currentSearchParams.keywords.length > 0
            ? currentSearchParams.keywords
            : undefined,
        },
        limit: localDisplayOptions.maxResults || 200,
        lastEvaluatedKey: lastEvaluatedKey, // Cursor for pagination
      };
      
      console.log('📥 NewsTile: Load More Request with keywords:', currentSearchParams.keywords);
      
      console.log('📥 NewsTile: Load More Request:', {
        searchParams: currentSearchParams,
        lastEvaluatedKey,
      });
      
      const response = await newsSearchAPI.searchNews(searchRequest);
      
      if (response.articles && response.articles.length > 0) {
        // Ensure each article has an id
        const processedResults = response.articles.map((article, index) => ({
          ...article,
          id: article.id || `article_${index}_${Date.now()}`,
        }));
        
        // Append new results to existing results
        const newLastEvaluatedKey = response.last_evaluated_key || null;
        
        // Update lastEvaluatedKeys array (add new key if exists, limit to 100 pages)
        let updatedKeys: any[] = [];
        setLastEvaluatedKeys(prev => {
          updatedKeys = newLastEvaluatedKey 
            ? [...prev, newLastEvaluatedKey].slice(-100) // Keep last 100 keys
            : prev;
          
          // Persist pagination state
          onSettingsChange(id, {
            paginationState: {
              totalResultsLoaded: allResults.length + processedResults.length,
              lastEvaluatedKeys: updatedKeys,
              hasMore: response.has_more || false,
            },
          });
          
          return updatedKeys;
        });
        
        setAllResults(prev => {
          const updated = [...prev, ...processedResults];
          // Store for useEffect to call onUpdate (avoid calling during render)
          // Include pagination state in the pending update
          pendingUpdateRef.current = { 
            articles: updated,
            paginationState: {
              totalResultsLoaded: updated.length,
              lastEvaluatedKeys: updatedKeys,
              hasMore: response.has_more || false,
            }
          };
          return updated;
        });
        setFilteredResults(prev => [...prev, ...processedResults]);
        setCurrentResults(prev => [...prev, ...processedResults]);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(newLastEvaluatedKey);
      } else {
        console.error('📰 NewsTile: Load more failed - no articles returned');
        setError('Load more failed - no articles returned');
        setHasMore(false);
        // Update pagination state to reflect no more results
        onSettingsChange(id, {
          paginationState: {
            totalResultsLoaded: allResults.length,
            lastEvaluatedKeys: lastEvaluatedKeys,
            hasMore: false,
          },
        });
      }
    } catch (err: any) {
      console.error('📰 NewsTile: Load more error:', err);
      setError(err.message || 'An error occurred while loading more results');
      setHasMore(false);
      // Preserve current pagination state on error
      onSettingsChange(id, {
        paginationState: {
          totalResultsLoaded: allResults.length,
          lastEvaluatedKeys: lastEvaluatedKeys,
          hasMore: false,
        },
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, allResults, lastEvaluatedKeys, onSettingsChange]);

  // Dynamic pagination based on tile height
  const calculateResultsPerPage = useCallback(() => {
    if (!tileRef.current) return 5; // Default fallback
    
    const tileHeight = tileRef.current.clientHeight;
    const headerHeight = 60; // Approximate header height
    const paginationHeight = 40; // Approximate pagination height
    const tableHeaderHeight = 40; // Table header height
    const rowHeight = 32; // Approximate row height
    const padding = 24; // Tile padding (12px * 2)
    
    // Calculate available height for table rows
    const availableHeight = tileHeight - headerHeight - paginationHeight - tableHeaderHeight - padding;
    const maxRows = Math.floor(availableHeight / rowHeight);
    
    // Ensure minimum of 3 rows and maximum of 20 rows
    return Math.max(3, Math.min(20, maxRows));
  }, []);

  // Update results per page when tile size changes (only if not manually set)
  useEffect(() => {
    if (!isPageSizeManuallySet) {
      const newResultsPerPage = calculateResultsPerPage();
      setResultsPerPage(newResultsPerPage);
    }
  }, [calculateResultsPerPage, size, isPageSizeManuallySet]);

  // Add ResizeObserver to recalculate when tile is resized (only if not manually set)
  useEffect(() => {
    if (!tileRef.current || isPageSizeManuallySet) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!isPageSizeManuallySet) {
        const newResultsPerPage = calculateResultsPerPage();
        setResultsPerPage(newResultsPerPage);
      }
    });

    resizeObserver.observe(tileRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateResultsPerPage, isPageSizeManuallySet]);

  // Sync props to state when they change (for state persistence)
  // Only sync articles - filtering will be handled by applyFilters useEffect
  // Use ref to prevent syncing when we just updated articles ourselves
  const articlesUpdateRef = useRef<boolean>(false);
  useEffect(() => {
    // Skip sync if we just updated articles ourselves (to avoid overriding fresh search results)
    if (articlesUpdateRef.current) {
      articlesUpdateRef.current = false;
      return;
    }
    
    // Only update if articles prop actually changed
    if (articles) {
      if (articles.length > 0) {
        // Restore articles from props (persisted state)
        const processedArticles = articles.map((article, index) => ({
          ...article,
          id: article.id || `article_${index}_${Date.now()}`,
        }));
        // Only update allResults - applyFilters will handle filtering
        setAllResults(prev => {
          // Check if articles actually changed to avoid unnecessary updates
          // Compare by length and IDs to avoid infinite loops
          if (prev.length === processedArticles.length) {
            const prevIds = new Set(prev.map(a => a.id));
            const newIds = new Set(processedArticles.map(a => a.id));
            if (prevIds.size === newIds.size && 
                Array.from(prevIds).every(id => newIds.has(id))) {
              return prev; // No change
            }
          }
          return processedArticles;
        });
        setHasPerformedInitialSearch(true);
      } else if (articles.length === 0) {
        // Only clear if we don't have any current results (to avoid clearing fresh search results)
        setAllResults(prev => {
          if (prev.length === 0) return prev; // Already empty
          // Don't clear if we have results - might be a stale prop update
          return prev.length > 0 ? prev : [];
        });
      }
    }
  }, [articles]);

  // Restore pagination state from prop when it changes (e.g., on mount or when navigating back)
  useEffect(() => {
    if (paginationState) {
      // Restore lastEvaluatedKeys
      if (paginationState.lastEvaluatedKeys && paginationState.lastEvaluatedKeys.length > 0) {
        setLastEvaluatedKeys(paginationState.lastEvaluatedKeys);
        // Set lastEvaluatedKey to the most recent key
        setLastEvaluatedKey(paginationState.lastEvaluatedKeys[paginationState.lastEvaluatedKeys.length - 1]);
      }
      // Restore hasMore
      if (paginationState.hasMore !== undefined) {
        setHasMore(paginationState.hasMore);
      }
    }
  }, [paginationState]);

  // Handle pending onUpdate calls (to avoid calling during render)
  useEffect(() => {
    if (pendingUpdateRef.current) {
      const { articles, paginationState: pendingPaginationState } = pendingUpdateRef.current;
      pendingUpdateRef.current = null;
      // Set flag to prevent articles prop sync from overriding our fresh results
      articlesUpdateRef.current = true;
      onUpdate(id, {
        articles,
        paginationState: pendingPaginationState || {
          totalResultsLoaded: articles.length,
          lastEvaluatedKeys: lastEvaluatedKeys,
          hasMore: hasMore,
        },
        lastUpdated: Date.now(),
      });
    }
  }, [allResults, id, onUpdate, lastEvaluatedKeys, hasMore]);

  // Sync searchParams prop to state when it changes (e.g., on refresh when parent loads saved state)
  // Use deep comparison to avoid unnecessary updates
  const prevSearchParamsRef = useRef<string>('');
  useEffect(() => {
    if (searchParams) {
      const searchParamsStr = JSON.stringify(searchParams);
      // Only update if the prop actually changed
      if (prevSearchParamsRef.current !== searchParamsStr) {
        prevSearchParamsRef.current = searchParamsStr;
        setCurrentSearchParams(searchParams);
        // Reset hasPerformedInitialSearch if searchParams changed (e.g., after dashboard load)
        // This ensures a fresh search is performed with the new params
        setHasPerformedInitialSearch(false);
      }
    }
  }, [searchParams]);

  // Sync filterSettings prop to state (only if actually different)
  useEffect(() => {
    if (initialFilterSettings) {
      setSelectedFilters(prev => {
        const newFilters = {
          sources: initialFilterSettings.sources || [],
          categories: initialFilterSettings.categories || [],
          countries: initialFilterSettings.countries || [],
        };
        // Check if filters actually changed
        if (JSON.stringify(prev) === JSON.stringify(newFilters)) {
          return prev;
        }
        return newFilters;
      });
    }
  }, [initialFilterSettings]);

  // Sync displayOptions prop to state (only if actually different)
  useEffect(() => {
    if (displayOptions) {
      setLocalDisplayOptions(prev => {
        const merged = {
          ...prev,
          ...displayOptions
        };
        // Always force showImage to true - images should always be visible
        merged.showImage = true;
        // Check if displayOptions actually changed
        const prevStr = JSON.stringify(prev);
        const newStr = JSON.stringify(merged);
        if (prevStr === newStr) return prev;
        console.log('📰 NewsTile: Syncing displayOptions from prop (forcing showImage=true):', {
          prop: displayOptions.showImage,
          merged: merged.showImage,
        });
        return merged;
      });
    }
  }, [displayOptions]);

  // Auto refresh effect
  useEffect(() => {
    if (autoRefresh && !isDragging && !isResizing) {
      autoRefreshRef.current = setInterval(performSearch, 600000); // 10 minutes
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
        }
      };
    }
  }, [autoRefresh, performSearch, isDragging, isResizing]);

  // Preview mode: Always run fresh query when opened in preview
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      const hasSearchCriteria = 
        (currentSearchParams.keywords && currentSearchParams.keywords.length > 0) ||
        (currentSearchParams.sources && currentSearchParams.sources.length > 0) ||
        (currentSearchParams.categories && currentSearchParams.categories.length > 0) ||
        (currentSearchParams.countries && currentSearchParams.countries.length > 0);
      
      if (hasSearchCriteria) {
        console.log('🔄 NewsTile: Preview mode - running fresh query');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading && !isRestoringPagination) {
      // Only auto-search if we have meaningful search params (not just defaults)
      const hasSearchCriteria = 
        (currentSearchParams.keywords && currentSearchParams.keywords.length > 0) ||
        (currentSearchParams.sources && currentSearchParams.sources.length > 0) ||
        (currentSearchParams.categories && currentSearchParams.categories.length > 0) ||
        (currentSearchParams.countries && currentSearchParams.countries.length > 0);
      
      if (hasSearchCriteria) {
        console.log('🔄 NewsTile: Initial load - performing search with existing params');
        performSearch();
      }
    }
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch]);

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

  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
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

      // Save all articles to the filesystem with FULL data using bulk operation
      // Note: currentResults contains the full article objects from the search API
      // This ensures we save the complete article with all fields
      const items = selectedArticleObjects.map(article => {
        const title = article.title || `News Article ${article.id || ''}`;
        return {
          context_data: article, // Full article object with all fields
          title: title,
          item_type: 'news_article' as const,
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
        console.log(`✅ Saved ${result?.succeeded || selectedArticleObjects.length} of ${selectedArticleObjects.length} article(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} article(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save articles');
      }
      setSelectedArticles(new Set());
    } catch (error) {
      console.error('Error saving articles to filesystem:', error);
    }
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

  const handleDisplayOptionsChange = (option: keyof typeof displayOptions) => {
    const newOptions = {
      ...localDisplayOptions,
      [option]: !localDisplayOptions[option],
    };
    setLocalDisplayOptions(newOptions);
    onSettingsChange(id, { displayOptions: newOptions });
  };

  const handleRefresh = () => {
    performSearch();
  };

  // Client-side filtering function - operates on existing results, never triggers API calls
  const applyFilters = useCallback(() => {
    let filtered = [...allResults];
    
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
    
    setFilteredResults(filtered);
    setCurrentResults(filtered);
  }, [allResults, selectedFilters]);

  // Apply filters when selectedFilters change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Sync visible columns with display options when display options change
  useEffect(() => {
    setVisibleColumns({
      title: localDisplayOptions.showTitle,
      source: localDisplayOptions.showSource,
      category: localDisplayOptions.showCategory,
      date: localDisplayOptions.showDate,
    });
  }, [localDisplayOptions]);

  // Generate available filters from all results
  const availableFilters = useMemo(() => {
    const sourceMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    
    allResults.forEach(article => {
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
      sources: Array.from(sourceMap.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      categories: Array.from(categoryMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      countries: Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);

  // Handle article selection with single click, Ctrl+click, and Shift+click
  const handleArticleClick = (e: React.MouseEvent, articleId: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedArticles(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const articlesToSelect = currentPageResults.slice(start, end + 1);
        articlesToSelect.forEach(article => newSelected.add(article.id));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(articleId)) {
          newSelected.delete(articleId);
        } else {
          newSelected.add(articleId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(articleId)) {
          newSelected.delete(articleId);
        } else {
          newSelected.clear();
          newSelected.add(articleId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, articleId: string) => {
    e.stopPropagation();
    
    // Determine which articles to drag
    const articlesToDrag = selectedArticles.has(articleId) ? selectedArticles : new Set([articleId]);
    
    // Set drag data
    const selectedArticleObjects = currentResults.filter(article => 
      articlesToDrag.has(article.id)
    );
    
    if (selectedArticleObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'news_articles',
        articles: selectedArticleObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedArticleObjects.length} article${selectedArticleObjects.length > 1 ? 's' : ''}`;
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
  const handleRowContextMenu = (e: React.MouseEvent, articleId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this article is not selected, select only it
    if (!selectedArticles.has(articleId)) {
      setSelectedArticles(new Set([articleId]));
    }
    
    setContextMenuAnchor(e.currentTarget as HTMLElement);
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

  // Calculate optimal column widths based on content
  const calculateColumnWidths = useCallback((results: NewsArticle[]) => {
    const widths: Record<string, number> = {};
    
    // Sample of results to measure (use first 50 for performance)
    const sampleResults = results.slice(0, 50);
    
    if (sampleResults.length === 0) return widths;
    
    // Base minimum widths (in pixels)
    const minWidths = {
      checkbox: 50,
      title: 200,
      description: 300,
      source: 120,
      category: 100,
      date: 120,
      image: 100,
    };
    
    // Calculate content-based widths
    widths.checkbox = minWidths.checkbox;
    
    if (visibleColumns.title) {
      const maxLength = Math.max(...sampleResults.map(a => (a.title || '').length));
      // Add extra width for image (120px) + gap (12px)
      widths.title = Math.max(minWidths.title, Math.min(maxLength * 8 + 32 + 132, 500));
    }
    
    if (visibleColumns.source) {
      const maxLength = Math.max(...sampleResults.map(a => (a.source_name || '').length));
      widths.source = Math.max(minWidths.source, Math.min(maxLength * 8 + 32, 200));
    }
    
    if (visibleColumns.category) {
      widths.category = minWidths.category; // Fixed size for chips
    }
    
    if (visibleColumns.date) {
      widths.date = minWidths.date; // Fixed for date format
    }
    
    return widths;
  }, [visibleColumns]);

  // Calculate pagination values
  const totalPages = Math.ceil(currentResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = currentResults.slice(startIndex, endIndex);

  // Update column widths when results or visible columns change
  useEffect(() => {
    if (currentResults.length > 0) {
      const newWidths = calculateColumnWidths(currentResults);
      setColumnWidths(newWidths);
    }
  }, [currentResults, calculateColumnWidths]);

  const renderSearchDialog = () => (
    <Dialog
      open={searchDialogOpen}
      onClose={() => setSearchDialogOpen(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          color: '#ffffff',
          border: '1px solid #334155',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
        <Box display="flex" alignItems="center" gap={1}>
          <ArticleIcon />
          <Typography variant="h6">Search News Articles</Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Box display="flex" flexDirection="column" gap={3} mt={2}>
          {/* Keywords Search Field */}
          <MultiSelectField<string>
            label="Keywords (Search Parameter)"
            selectedItems={currentSearchParams.keywords || []}
            onItemsChange={(keywords) => {
              setCurrentSearchParams(prev => ({ ...prev, keywords }));
            }}
            suggestions={[]}
            onSearch={() => {
              // Simple keyword search - no suggestions for now
              return [];
            }}
            renderItem={(keyword) => keyword}
            placeholder="Enter keywords to search..."
            helperText="Search by keywords in article titles (e.g., AI, technology, politics)"
            disableAutocomplete={true}
          />

          {/* Sources Search Field - Hidden in easy mode */}
          {!isEasyMode && (
          <MultiSelectField<string>
            label="Sources (Search Parameter)"
            selectedItems={currentSearchParams.sources || []}
            onItemsChange={(sources) => {
              setCurrentSearchParams(prev => ({ ...prev, sources }));
            }}
            suggestions={[]}
            onSearch={() => {
              // Simple source search - could add suggestions later
              return [];
            }}
            renderItem={(source) => source}
            placeholder="Enter source names..."
            helperText="Search by news source (e.g., Reuters, BBC, CNN)"
          />
          )}

          {/* Categories Search Field - Hidden in easy mode */}
          {!isEasyMode && (
          <FormControl size="small">
            <Autocomplete
              multiple
              options={categoryOptions}
              value={currentSearchParams.categories || []}
              onChange={(_, newValue) => {
                setCurrentSearchParams(prev => ({ ...prev, categories: newValue }));
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Categories (Search Parameter)"
                  sx={{
                    '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                    '& .MuiInputLabel-root': { color: '#94a3b8' },
                  }}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ backgroundColor: '#475569', color: '#ffffff' }}
                  />
                ))
              }
            />
          </FormControl>
          )}

          {/* Countries Search Field - Hidden in easy mode */}
          {!isEasyMode && (
          <FormControl size="small">
            <Autocomplete
              multiple
              options={countryOptions}
              value={currentSearchParams.countries || []}
              onChange={(_, newValue) => {
                setCurrentSearchParams(prev => ({ ...prev, countries: newValue }));
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Countries (Search Parameter)"
                  sx={{
                    '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                    '& .MuiInputLabel-root': { color: '#94a3b8' },
                  }}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ backgroundColor: '#475569', color: '#ffffff' }}
                  />
                ))
              }
            />
          </FormControl>
          )}
          
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
        <Button
          onClick={() => setSearchDialogOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            // Persist search params before performing search
            onSettingsChange(id, { searchParams: currentSearchParams });
            performSearch();
            setSearchDialogOpen(false);
          }}
          variant="contained"
          startIcon={<SearchIcon />}
          sx={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
          }}
        >
          Search
        </Button>
      </DialogActions>
    </Dialog>
  );

  const tileColor = customColor || '#3b82f6';
  
  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: `1px solid ${tileColor}40`,
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          borderColor: tileColor,
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : `0 8px 25px ${tileColor}25`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: currentResults.length > 0 ? tileColor : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
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
          
          {(() => {
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('news'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'News Articles';
            return (
              <>
                <TileIcon sx={{ color: iconColor, fontSize: '1.5rem', mr: 1 }} />
                <Typography variant="h6" color="white" fontWeight={600}>
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
          
          <Chip
            label={
              isLoadingMore 
                ? 'Loading...' 
                : hasMore && allResults.length > 0 && filteredResults.length === allResults.length
                  ? `Load More (${allResults.length} loaded)`
                  : allResults.length > 0 && currentResults.length !== allResults.length 
                    ? `${currentResults.length} of ${allResults.length} results`
                    : `${currentResults.length} results`
            }
            size="small"
            onClick={
              hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? handleLoadMore
                : undefined
            }
            disabled={isLoadingMore || isLoading || !hasMore || filteredResults.length !== allResults.length}
            sx={{
              backgroundColor: hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? 'rgba(59, 130, 246, 0.3)'
                : 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
              cursor: hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? 'pointer'
                : 'default',
              '&:hover': hasMore && allResults.length > 0 && filteredResults.length === allResults.length && !isLoadingMore && !isLoading
                ? {
                    backgroundColor: 'rgba(59, 130, 246, 0.4)',
                    transform: 'scale(1.05)',
                  }
                : {},
              '&.Mui-disabled': {
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#6b7280',
                borderColor: '#4b5563',
                cursor: 'not-allowed',
              },
            }}
          />
          
          {autoRefresh && (
            <AutoRefreshIcon sx={{ color: '#10b981', fontSize: '1rem', ml: 0.5 }} />
          )}
        </Box>

        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          contextButton={{
            onClick: handleContextMenuClick,
            disabled: selectedArticles.size === 0,
            tooltip: `Add ${selectedArticles.size > 0 ? `${selectedArticles.size} article(s)` : 'selected articles'} to context`,
            icon: <AddToContextIcon fontSize="small" />,
          }}
          customizeButton={{
            onClick: (e) => {
              e.stopPropagation();
              setCustomizeDialogOpen(true);
            },
          }}
          refreshButton={{
            onClick: (e) => {
              e.stopPropagation();
              handleRefresh();
            },
            disabled: isLoading,
            isLoading: isLoading,
            icon: isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />,
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          collapsibleActions={
            <>
              {/* Refresh Button - shown when expanded */}
              <Tooltip title="Refresh" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefresh();
                    }}
                    disabled={isLoading}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{
                      color: isLoading ? '#6b7280' : '#9ca3af',
                      '&:hover': { color: isLoading ? '#6b7280' : '#3b82f6' },
                      '&.Mui-disabled': { color: '#6b7280' },
                      padding: '6px',
                    }}
                  >
                    {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Select columns to display">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColumnMenuAnchor(e.currentTarget);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <ViewColumnIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title={
                (selectedFilters.sources.length > 0 || 
                 selectedFilters.categories.length > 0 || 
                 selectedFilters.countries.length > 0) 
                  ? `Filter Results (${Object.values(selectedFilters).flat().length} active)`
                  : "Filter Results"
              }>
                <Box sx={{ position: 'relative' }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterDialogOpen(true);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{ 
                      color: (selectedFilters.sources.length > 0 || 
                              selectedFilters.categories.length > 0 || 
                              selectedFilters.countries.length > 0) 
                        ? '#3b82f6' 
                        : '#9ca3af', 
                      '&:hover': { color: '#3b82f6' } 
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {(selectedFilters.sources.length > 0 || 
                    selectedFilters.categories.length > 0 || 
                    selectedFilters.countries.length > 0) && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 8,
                        height: 8,
                        backgroundColor: '#3b82f6',
                        borderRadius: '50%',
                        border: '1px solid #1e293b',
                      }}
                    />
                  )}
                </Box>
              </Tooltip>

              <Tooltip title="Edit Search Criteria">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchDialogOpen(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <SearchIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
      </Box>

      {/* Loading state */}
      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">
            Searching articles...
          </Typography>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 1, backgroundColor: 'rgba(220, 38, 38, 0.1)', flexShrink: 0 }}>
          {error}
        </Alert>
      )}

      {/* Results Table */}
      {localDisplayOptions.showResultsTable && currentResults.length > 0 && !isLoading && !isRestoringPagination && (
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0,
          mt: 1
        }}>
          <TableContainer sx={{ 
            flex: 1,
            backgroundColor: 'transparent',
            borderRadius: 0,
            boxShadow: 'none',
            border: 'none',
            overflow: 'auto',
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
            '&::-webkit-scrollbar-corner': {
              backgroundColor: 'rgba(55, 65, 81, 0.3)',
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
                verticalAlign: 'top', // Align content to top
              },
              '& .MuiTableHead-root .MuiTableCell-root': {
                borderBottom: '2px solid rgba(59, 130, 246, 0.5)',
                backgroundColor: 'rgba(15, 23, 42, 0.5)',
                padding: '8px 12px', // Smaller padding for header
              },
              '& .MuiTableRow-root:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
              },
              '& .MuiTableRow-root': {
                height: 'auto', // Allow rows to expand for images
                minHeight: '100px', // Minimum height to fit images
              },
            }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ 
                    color: '#9ca3af', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.checkbox || 50,
                    minWidth: columnWidths.checkbox || 50,
                    maxWidth: columnWidths.checkbox || 50,
                  }}>
                    <Checkbox
                      size="small"
                      indeterminate={selectedArticles.size > 0 && selectedArticles.size < currentPageResults.length}
                      checked={currentPageResults.length > 0 && selectedArticles.size === currentPageResults.length}
                      onChange={() => {
                        if (selectedArticles.size === currentPageResults.length) {
                          const newSelected = new Set(selectedArticles);
                          currentPageResults.forEach(article => newSelected.delete(article.id));
                          setSelectedArticles(newSelected);
                        } else {
                          const newSelected = new Set(selectedArticles);
                          currentPageResults.forEach(article => newSelected.add(article.id));
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
                  {visibleColumns.title && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.title,
                      minWidth: columnWidths.title,
                    }}>Title</TableCell>
                  )}
                  {visibleColumns.source && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.source,
                      minWidth: columnWidths.source,
                    }}>Source</TableCell>
                  )}
                  {visibleColumns.category && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.category,
                      minWidth: columnWidths.category,
                    }}>Category</TableCell>
                  )}
                  {visibleColumns.date && (
                    <TableCell sx={{ 
                      color: '#9ca3af', 
                      fontWeight: 600, 
                      fontSize: '0.875rem',
                      width: columnWidths.date,
                      minWidth: columnWidths.date,
                    }}>Date</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPageResults.map((article, index) => (
                  <TableRow
                    key={article.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, article.id)}
                    onClick={(e) => handleArticleClick(e, article.id, index)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (user?.id) {
                        openItemDetails(
                          'news_article',
                          article,
                          article.title,
                          { user_id: user.id }
                        );
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, article.id)}
                    sx={{
                      backgroundColor: selectedArticles.has(article.id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': {
                        backgroundColor: selectedArticles.has(article.id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                  >
                    {/* Empty cell to maintain row height and alignment with header checkbox */}
                    <TableCell 
                      padding="none"
                      sx={{ 
                        width: '40px',
                        minWidth: '40px',
                        maxWidth: '40px',
                        padding: '8px 4px',
                      }}
                    />
                    {visibleColumns.title && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.title,
                        minWidth: columnWidths.title,
                        padding: '12px',
                      }}>
                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                          {/* Image on the left - match ContextItemRow pattern */}
                          {(() => {
                            const hasImage = !!(article.image_url && article.image_url.trim());
                            const showImage = localDisplayOptions.showImage;
                            
                            return hasImage && showImage ? (
                              <Box
                                component="img"
                                src={article.image_url}
                                alt={article.title || 'Article image'}
                                onError={() => {
                                  console.error('📰 NewsTile: Image failed to load:', article.image_url);
                                }}
                                onLoad={() => {
                                  if (article.id === currentPageResults[0]?.id) {
                                    console.log('📰 NewsTile: Image loaded successfully:', article.image_url);
                                  }
                                }}
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
                                  {hasImage && !showImage ? 'Image Hidden' : 'No Image'}
                                </Typography>
                              </Box>
                            );
                          })()}
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
                    )}
                    {visibleColumns.source && (
                      <TableCell sx={{ 
                        color: '#ffffff', 
                        fontSize: '0.875rem',
                        width: columnWidths.source,
                        minWidth: columnWidths.source,
                        padding: '8px 12px',
                      }}>
                        <Typography variant="body2" noWrap title={article.source_name || 'N/A'}>
                          {article.source_name || 'N/A'}
                        </Typography>
                      </TableCell>
                    )}
                    {visibleColumns.category && (
                      <TableCell sx={{ 
                        fontSize: '0.875rem',
                        width: columnWidths.category,
                        minWidth: columnWidths.category,
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
                    )}
                    {visibleColumns.date && (
                      <TableCell sx={{ 
                        color: '#9ca3af', 
                        fontSize: '0.875rem',
                        width: columnWidths.date,
                        minWidth: columnWidths.date,
                        padding: '8px 12px',
                      }}>
                        {formatDate(article.published_date)}
                      </TableCell>
                    )}
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
              mt: 1, 
              pt: 1, 
              borderTop: '1px solid rgba(55, 65, 81, 0.3)' 
            }}>
              <Typography variant="caption" color="#6b7280" sx={{ fontSize: '0.75rem' }}>
                Showing {startIndex + 1}-{Math.min(endIndex, currentResults.length)} of {currentResults.length} results
              </Typography>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_, page) => setCurrentPage(page)}
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
        </Box>
      )}

      {/* No Results */}
      {!isLoading && !isRestoringPagination && currentResults.length === 0 && !error && (
        <Box sx={{ textAlign: 'center', py: 4, flexShrink: 0 }}>
          <Typography variant="body2" color="#9ca3af">
            No articles match your criteria. Try adjusting your search parameters.
          </Typography>
        </Box>
      )}

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
          <ListItemIcon><SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Context" />
        </MenuItem>
        <MenuItem onClick={handleAddToFiles} sx={{ fontWeight: 600 }}>
          <ListItemIcon><FolderIcon sx={{ color: '#fbbf24', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Files" />
        </MenuItem>
      </Menu>

      {/* File Browser Dialog */}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
      />

      {/* Column Selection Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
          },
        }}
      >
        {[
          { key: 'title', label: 'Title' },
          { key: 'source', label: 'Source' },
          { key: 'category', label: 'Category' },
          { key: 'date', label: 'Date' },
        ].map((column) => (
          <MenuItem
            key={column.key}
            onClick={() => handleColumnToggle(column.key as keyof typeof visibleColumns)}
            sx={{
              color: visibleColumns[column.key as keyof typeof visibleColumns] ? '#3b82f6' : '#94a3b8',
            }}
          >
            <Checkbox
              checked={visibleColumns[column.key as keyof typeof visibleColumns]}
              sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
            />
            {column.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'News Articles'}
        currentColor={customColor}
        currentIcon={customIcon}
      />

      {/* Search Dialog */}
      {renderSearchDialog()}

      {/* Filter Dialog */}
      <Dialog
        open={filterDialogOpen}
        onClose={() => setFilterDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            color: '#ffffff',
            border: '1px solid #334155',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
          <Box display="flex" alignItems="center" gap={1}>
            <FilterIcon />
            <Typography variant="h6">Filter Results</Typography>
            <Chip
              label={`${filteredResults.length} of ${allResults.length} results`}
              size="small"
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#3b82f6',
                border: '1px solid #3b82f6',
                ml: 1
              }}
            />
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
            Refine search results by: Click headings to show top filters. Document counts shown in <span style={{ color: '#3b82f6' }}>#</span>
          </Typography>

          {/* Applied Filters Section */}
          {(selectedFilters.sources.length > 0 || 
            selectedFilters.categories.length > 0 || 
            selectedFilters.countries.length > 0) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
              <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
                Applied Filters:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {selectedFilters.sources.map(source => (
                  <Chip
                    key={`source-${source}`}
                    label={`Source: ${source}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        sources: prev.sources.filter(s => s !== source)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#3b82f6',
                      border: '1px solid #3b82f6',
                      '& .MuiChip-deleteIcon': { color: '#3b82f6' }
                    }}
                  />
                ))}
                {selectedFilters.categories.map(category => (
                  <Chip
                    key={`category-${category}`}
                    label={`Category: ${category}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        categories: prev.categories.filter(c => c !== category)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      border: '1px solid #10b981',
                      '& .MuiChip-deleteIcon': { color: '#10b981' }
                    }}
                  />
                ))}
                {selectedFilters.countries.map(country => (
                  <Chip
                    key={`country-${country}`}
                    label={`Country: ${country}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        countries: prev.countries.filter(c => c !== country)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      '& .MuiChip-deleteIcon': { color: '#f59e0b' }
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}


          {/* Page Size Selection */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
            <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
              Results Per Page:
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl sx={{ minWidth: 120 }}>
                <TextField
                  select
                  value={resultsPerPage}
                  onChange={(e) => {
                    const newSize = parseInt(e.target.value);
                    setResultsPerPage(newSize);
                    setCurrentPage(1);
                    setIsPageSizeManuallySet(true);
                    localStorage.setItem(`newsTile_pageSize_${id}`, newSize.toString());
                  }}
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#475569',
                      color: '#ffffff',
                      '& fieldset': {
                        borderColor: '#64748b',
                      },
                      '&:hover fieldset': {
                        borderColor: '#3b82f6',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#3b82f6',
                      },
                    },
                    '& .MuiSelect-select': {
                      color: '#ffffff',
                    },
                    '& .MuiSelect-icon': {
                      color: '#94a3b8',
                    },
                    '& .MuiInputLabel-root': {
                      color: '#94a3b8',
                    },
                  }}
                  SelectProps={{
                    MenuProps: {
                      PaperProps: {
                        sx: {
                          backgroundColor: '#334155',
                          '& .MuiMenuItem-root': {
                            color: '#ffffff',
                            '&:hover': {
                              backgroundColor: '#475569',
                            },
                            '&.Mui-selected': {
                              backgroundColor: '#3b82f6',
                              '&:hover': {
                                backgroundColor: '#2563eb',
                              },
                            },
                          },
                        },
                      },
                    },
                  }}
                >
                  {[10, 25, 50, 100].map((size) => (
                    <MenuItem key={size} value={size}>
                      {size} results
                    </MenuItem>
                  ))}
                </TextField>
              </FormControl>
              
              {isPageSizeManuallySet && (
                <Button
                  onClick={() => {
                    setIsPageSizeManuallySet(false);
                    const newResultsPerPage = calculateResultsPerPage();
                    setResultsPerPage(newResultsPerPage);
                    setCurrentPage(1);
                    localStorage.removeItem(`newsTile_pageSize_${id}`);
                  }}
                  size="small"
                  sx={{
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    textTransform: 'none',
                    minWidth: 'auto',
                    px: 1.5,
                    '&:hover': {
                      color: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Auto
                </Button>
              )}
            </Box>
            {!isPageSizeManuallySet && (
              <Typography variant="caption" sx={{ color: '#94a3b8', mt: 1, display: 'block' }}>
                Automatically adjusts based on tile size
              </Typography>
            )}
          </Box>

          {/* No Results Message */}
          {availableFilters.sources.length === 0 && 
           availableFilters.categories.length === 0 && 
           availableFilters.countries.length === 0 ? (
            <Box 
              sx={{ 
                textAlign: 'center', 
                py: 6, 
                backgroundColor: '#334155', 
                borderRadius: '4px',
                border: '1px solid #475569'
              }}
            >
              <Typography variant="h6" sx={{ color: '#cbd5e1', mb: 2, fontWeight: 500 }}>
                No Filters Available
              </Typography>
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                {allResults.length === 0 
                  ? 'No search results found. Try adjusting your search criteria.'
                  : 'All results are identical - no additional filters can be applied.'
                }
              </Typography>
            </Box>
          ) : (
            <Box 
              display="flex" 
              flexDirection="column" 
              gap={2}
              sx={{
                '& .MuiAccordion-root': {
                  backgroundColor: '#334155',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  boxShadow: 'none',
                  '&:before': {
                    display: 'none',
                  },
                  '&.Mui-expanded': {
                    margin: '8px 0',
                  },
                  '&:not(:last-child)': {
                    marginBottom: '8px',
                  },
                },
                '& .MuiAccordionSummary-root': {
                  backgroundColor: '#475569',
                  borderRadius: '4px 4px 0 0',
                  minHeight: '56px',
                  '&.Mui-expanded': {
                    minHeight: '56px',
                    borderRadius: '4px 4px 0 0',
                  },
                  '&:hover': {
                    backgroundColor: '#64748b',
                  },
                },
                '& .MuiAccordionDetails-root': {
                  padding: '16px',
                  backgroundColor: '#334155',
                  borderRadius: '0 0 4px 4px',
                  borderTop: '1px solid #475569',
                },
                '& .MuiAccordionSummary-content': {
                  margin: '12px 0',
                },
                '& .MuiAccordionSummary-expandIconWrapper': {
                  color: '#e2e8f0',
                  '&.Mui-expanded': {
                    transform: 'rotate(180deg)',
                  },
                },
              }}
            >
            {/* Sources Filter */}
            {availableFilters.sources.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Sources ({availableFilters.sources.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.sources.map((filter) => (
                      <Box
                        key={filter.source}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1.5,
                          cursor: 'pointer',
                          borderRadius: '4px',
                          backgroundColor: selectedFilters.sources.includes(filter.source)
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                          transition: 'background-color 0.15s ease',
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.sources.includes(filter.source);
                          setSelectedFilters(prev => ({
                            ...prev,
                            sources: isSelected
                              ? prev.sources.filter(s => s !== filter.source)
                              : [...prev.sources, filter.source]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                          {filter.source}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: '#ffffff',
                            minWidth: '28px',
                            height: '22px',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            '& .MuiChip-label': {
                              px: 0.75,
                            },
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Categories Filter */}
            {availableFilters.categories.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Categories ({availableFilters.categories.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.categories.map((filter) => (
                      <Box
                        key={filter.category}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          cursor: 'pointer',
                          borderRadius: 1,
                          backgroundColor: selectedFilters.categories.includes(filter.category)
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.categories.includes(filter.category);
                          setSelectedFilters(prev => ({
                            ...prev,
                            categories: isSelected
                              ? prev.categories.filter(c => c !== filter.category)
                              : [...prev.categories, filter.category]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#ffffff', flex: 1 }}>
                          {filter.category}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            minWidth: '32px',
                            height: '20px',
                            fontSize: '0.7rem',
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Countries Filter */}
            {availableFilters.countries.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Countries ({availableFilters.countries.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '8px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#1e293b',
                        borderRadius: '4px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '4px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.countries.map((filter) => (
                      <Box
                        key={filter.country}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          cursor: 'pointer',
                          borderRadius: 1,
                          backgroundColor: selectedFilters.countries.includes(filter.country)
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'transparent',
                          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                        }}
                        onClick={() => {
                          const isSelected = selectedFilters.countries.includes(filter.country);
                          setSelectedFilters(prev => ({
                            ...prev,
                            countries: isSelected
                              ? prev.countries.filter(c => c !== filter.country)
                              : [...prev.countries, filter.country]
                          }));
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#ffffff', flex: 1 }}>
                          {filter.country}
                        </Typography>
                        <Chip
                          label={filter.count}
                          size="small"
                          sx={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            minWidth: '32px',
                            height: '20px',
                            fontSize: '0.7rem',
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
          </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155', p: 3, gap: 1 }}>
          <Button
            onClick={() => {
              setSelectedFilters({
                sources: [],
                categories: [],
                countries: [],
              });
            }}
            disabled={
              selectedFilters.sources.length === 0 && 
              selectedFilters.categories.length === 0 && 
              selectedFilters.countries.length === 0
            }
            sx={{ 
              color: '#94a3b8',
              '&:hover': {
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
              },
              '&.Mui-disabled': {
                color: '#64748b',
              },
            }}
          >
            Clear All
          </Button>
          <Button
            onClick={() => {
              onSettingsChange(id, { 
                displayOptions: localDisplayOptions,
                filterSettings: selectedFilters 
              });
              setFilterDialogOpen(false);
            }}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            Apply Filters
          </Button>
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showTitle}
                  onChange={() => handleDisplayOptionsChange('showTitle')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Title"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showSource}
                  onChange={() => handleDisplayOptionsChange('showSource')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Source"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showCategory}
                  onChange={() => handleDisplayOptionsChange('showCategory')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Category"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showDate}
                  onChange={() => handleDisplayOptionsChange('showDate')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Date"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={localDisplayOptions.showResultsTable}
                  onChange={() => handleDisplayOptionsChange('showResultsTable')}
                  sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                />
              }
              label="Show Results Table"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDisplayDialogOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Custom comparison function for memo - matches SEC tile pattern but with optimization
const NewsTileMemo = memo(NewsTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.id !== nextProps.id ||
      prevProps.dashboardContext !== nextProps.dashboardContext) {
    return false; // Re-render
  }
  
  // Check customization props FIRST - these should always trigger re-render
  if (prevProps.customTitle !== nextProps.customTitle ||
      prevProps.customColor !== nextProps.customColor ||
      prevProps.customIcon !== nextProps.customIcon) {
    return false; // Re-render
  }
  
  // Check if display options changed
  const prevDisplay = prevProps.displayOptions;
  const nextDisplay = nextProps.displayOptions;
  if (prevDisplay && nextDisplay) {
    if (prevDisplay.showTitle !== nextDisplay.showTitle ||
        prevDisplay.showDescription !== nextDisplay.showDescription ||
        prevDisplay.showSource !== nextDisplay.showSource ||
        prevDisplay.showCategory !== nextDisplay.showCategory ||
        prevDisplay.showDate !== nextDisplay.showDate ||
        prevDisplay.showResultsTable !== nextDisplay.showResultsTable ||
        prevDisplay.maxResults !== nextDisplay.maxResults) {
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
  
  return true; // Don't re-render
});

NewsTileMemo.displayName = 'NewsTile';

export default NewsTileMemo;

