import React, { useState, useEffect, useRef, forwardRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Chip,
  Autocomplete,
  Paper,
  TextField,
  IconButton,
} from '@mui/material';
import {
  Add as AddIcon,
  KeyboardArrowDown as ArrowDropDownIcon,
  KeyboardArrowUp as ArrowDropUpIcon,
} from '@mui/icons-material';

interface MultiSelectFieldProps<T> {
  label: string;
  selectedItems: T[];
  onItemsChange: (items: T[]) => void;
  suggestions?: T[];
  renderItem?: (item: T) => string;
  renderOptionCustom?: (item: T) => React.ReactNode; // Custom rich rendering for dropdown options
  getItemKey?: (item: T) => string;
  placeholder?: string;
  helperText?: string;
  maxChipsShown?: number;
  allowCustomInput?: boolean;
  isLoading?: boolean;
  onSearch?: (query: string, offset?: number) => T[] | Promise<T[]> | { results: T[]; has_more?: boolean } | Promise<{ results: T[]; has_more?: boolean }>; // Callback for dynamic search that returns results (sync or async) or paginated response
}

function MultiSelectField<T = string>({
  label,
  selectedItems,
  onItemsChange,
  suggestions = [],
  renderItem = (item: T) => String(item),
  renderOptionCustom,
  getItemKey = (item: T) => String(item),
  placeholder = `Add ${label.toLowerCase()}...`,
  helperText,
  maxChipsShown = 3,
  allowCustomInput = true,
  isLoading = false,
  onSearch,
}: MultiSelectFieldProps<T>) {
  const [inputValue, setInputValue] = useState('');
  const [dynamicSuggestions, setDynamicSuggestions] = useState<T[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');

  // Track last search query to prevent duplicate calls
  const lastSearchQueryRef = useRef<string>('');
  const listboxRef = useRef<HTMLUListElement | null>(null);

  // Helper function to extract results from search response
  const extractResults = (response: any): { results: T[]; hasMore: boolean } => {
    if (Array.isArray(response)) {
      return { results: response, hasMore: false };
    }
    if (response && typeof response === 'object' && 'results' in response) {
      return {
        results: response.results || [],
        hasMore: response.has_more || false
      };
    }
    return { results: [], hasMore: false };
  };

  // Load more results for current query
  const loadMore = useCallback(async () => {
    if (!onSearch || !currentQuery || isLoadingMore || !hasMore) {
      return;
    }
    
    setIsLoadingMore(true);
    try {
      const offset = dynamicSuggestions.length;
      const searchResults = onSearch(currentQuery, offset);
      
      let response: any;
      if (searchResults instanceof Promise) {
        response = await searchResults;
      } else {
        response = searchResults;
      }
      
      const { results, hasMore: moreAvailable } = extractResults(response);
      setDynamicSuggestions(prev => [...prev, ...results]);
      setHasMore(moreAvailable);
    } catch (error) {
      console.error('Error loading more results:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [onSearch, currentQuery, isLoadingMore, hasMore, dynamicSuggestions.length]);


  // Debounced search effect - prevent excessive API calls
  useEffect(() => {
    if (!onSearch) {
      setDynamicSuggestions([]);
      setHasMore(false);
      setCurrentQuery('');
      return;
    }

    // Show default suggestions when dropdown is opened but no search input
    if (isDropdownOpen && (!inputValue || inputValue.length === 0)) {
      if (lastSearchQueryRef.current !== '') {
        lastSearchQueryRef.current = '';
        setDynamicSuggestions([]);
        setHasMore(false);
        setCurrentQuery('');
      }
      return;
    }

    if (!inputValue || inputValue.length < 2) {
      if (lastSearchQueryRef.current !== '') {
        lastSearchQueryRef.current = '';
        setDynamicSuggestions([]);
        setHasMore(false);
        setCurrentQuery('');
      }
      return;
    }

    // Clear suggestions immediately if query changed significantly (not just a continuation)
    // This prevents showing stale results when user deletes and types a new word
    if (lastSearchQueryRef.current && 
        !inputValue.startsWith(lastSearchQueryRef.current) && 
        !lastSearchQueryRef.current.startsWith(inputValue)) {
      setDynamicSuggestions([]);
      setHasMore(false);
    }

    // Skip if we're already searching for this exact query
    if (lastSearchQueryRef.current === inputValue) {
      return;
    }

    // Debounce the search to avoid excessive API calls
    const timeoutId = setTimeout(async () => {
      // Only search if query hasn't changed during debounce
      if (lastSearchQueryRef.current !== inputValue) {
        lastSearchQueryRef.current = inputValue;
        setCurrentQuery(inputValue);
        setIsLoadingMore(true);
        
        try {
          const searchResults = onSearch(inputValue, 0);
          // Handle both sync and async results
          let response: any;
          if (searchResults instanceof Promise) {
            response = await searchResults;
          } else {
            response = searchResults;
          }
          
          const { results, hasMore: moreAvailable } = extractResults(response);
          setDynamicSuggestions(results);
          setHasMore(moreAvailable);
        } catch (error) {
          console.error('Search error:', error);
          setDynamicSuggestions([]);
          setHasMore(false);
        } finally {
          setIsLoadingMore(false);
        }
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [inputValue, onSearch, isDropdownOpen]);

  const handleAddItem = (newItem: T | string) => {
    if (!newItem) return;
    
    const itemToAdd = allowCustomInput && typeof newItem === 'string' 
      ? newItem as T 
      : newItem as T;
    
    const keyExists = selectedItems.some(item => getItemKey(item) === getItemKey(itemToAdd));
    
    if (!keyExists) {
      onItemsChange([...selectedItems, itemToAdd]);
    }
    setInputValue('');
  };

  const handleRemoveItem = (itemToRemove: T) => {
    onItemsChange(selectedItems.filter(item => getItemKey(item) !== getItemKey(itemToRemove)));
  };

  const availableOptions = dynamicSuggestions.length > 0 ? dynamicSuggestions : (suggestions || []);

  return (
    <Box>
      {/* Inline Autocomplete */}
      <Autocomplete
        value={null}
        inputValue={inputValue}
        onInputChange={(_, value) => {
          setInputValue(value);
        }}
        onChange={(_, value, reason) => {
          if (value && reason === 'selectOption') {
            handleAddItem(value);
            // Clear input after selection
            setInputValue('');
            // Close dropdown after selection
            setIsDropdownOpen(false);
          }
        }}
        options={availableOptions}
        getOptionLabel={(option) => renderItem(option as T)}
        isOptionEqualToValue={(option, value) => {
          const optionKey = getItemKey(option as T);
          const valueKey = getItemKey(value as T);
          // If keys are empty, compare the objects directly
          if (!optionKey || !valueKey) {
            return JSON.stringify(option) === JSON.stringify(value);
          }
          return optionKey === valueKey;
        }}
        filterOptions={(options) => {
          // Don't filter options - we handle this via the search
          return options;
        }}
        freeSolo={false}
        loading={isLoading || isLoadingMore}
        clearOnBlur={false}
        open={isDropdownOpen && (availableOptions.length > 0 || isLoading || isLoadingMore)}
        onOpen={() => setIsDropdownOpen(true)}
        onClose={() => setIsDropdownOpen(false)}
        PaperComponent={(props) => (
          <Paper 
            {...props} 
            sx={{
              backgroundColor: 'rgba(15, 23, 42, 0.98)',
              border: '2px solid #374151',
              borderRadius: '12px',
              color: '#ffffff',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
              maxHeight: '600px', // Increased to show 9 items comfortably
              // Blue scrollbar styling
              '& .MuiAutocomplete-listbox': {
                padding: 0,
                maxHeight: '560px', // Show approximately 9 items (each ~60px tall)
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
                  '&:hover': {
                    backgroundColor: '#2563eb',
                  },
                },
              },
            }}
          />
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
            variant="outlined"
            fullWidth
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {params.InputProps.endAdornment}
                  {/* Dropdown Toggle Button */}
                  <IconButton
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    size="small"
                    sx={{ 
                      color: '#9ca3af',
                      '&:hover': { 
                        color: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)'
                      },
                      transition: 'all 0.2s ease-in-out'
                    }}
                  >
                    {isDropdownOpen ? (
                      <ArrowDropUpIcon fontSize="small" />
                    ) : (
                      <ArrowDropDownIcon fontSize="small" />
                    )}
                  </IconButton>
                  {/* Add Item Button - only show when user has typed something */}
                  {allowCustomInput && inputValue.trim() && (
                    <IconButton
                      onClick={() => handleAddItem(inputValue)}
                      disabled={!inputValue.trim()}
                      size="small"
                      sx={{ 
                        color: inputValue.trim() ? '#3b82f6' : '#6b7280',
                        '&:hover': { color: '#2563eb' },
                        ml: 0.5
                      }}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  )}
                </>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { 
                  borderColor: isDropdownOpen ? '#3b82f6' : '#374151',
                  borderWidth: isDropdownOpen ? '2px' : '1px'
                },
                '&:hover fieldset': { borderColor: '#3b82f6' },
                '&.Mui-focused fieldset': { borderColor: '#3b82f6', borderWidth: '2px' },
              },
              '& .MuiInputLabel-root': { 
                color: isDropdownOpen ? '#3b82f6' : '#9ca3af'
              },
              '& .MuiInputBase-input': { color: '#ffffff' },
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                e.preventDefault();
                handleAddItem(inputValue.trim());
              }
            }}
          />
        )}
        renderOption={(props, option, state) => {
          const { key, ...otherProps } = props;
          // Ensure unique key - use getItemKey with fallback to index
          const optionKey = getItemKey(option as T);
          // Always include index to ensure uniqueness, even if optionKey exists
          // This prevents duplicate key warnings when multiple items have the same key
          const uniqueKey = optionKey ? `${optionKey}-${state.index}` : `option-${state.index}`;
          return (
            <Box
              key={uniqueKey}
              component="li"
              {...otherProps}
              sx={{
                backgroundColor: 'transparent',
                color: '#ffffff',
                py: 1.5,
                px: 2,
                borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                '&:hover': { 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  borderColor: 'rgba(59, 130, 246, 0.3)'
                },
                '&[aria-selected="true"]': {
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  borderColor: 'rgba(59, 130, 246, 0.5)',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                  },
                },
                '&:last-child': {
                  borderBottom: 'none'
                }
              }}
            >
              {renderOptionCustom ? renderOptionCustom(option) : renderItem(option)}
            </Box>
          );
        }}
        ListboxComponent={forwardRef<HTMLUListElement, any>((props, ref) => {
          const { children, ...other } = props;
          return (
            <ul 
              {...other} 
              ref={(node) => {
                // Forward ref to MUI
                if (typeof ref === 'function') {
                  ref(node);
                } else if (ref) {
                  (ref as React.MutableRefObject<HTMLUListElement | null>).current = node;
                }
                listboxRef.current = node;
              }}
            >
              {children}
              {hasMore && (
                <Box
                  component="li"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isLoadingMore) {
                      loadMore();
                    }
                  }}
                  sx={{
                    backgroundColor: 'transparent',
                    color: '#ffffff',
                    py: 1.5,
                    px: 2,
                    borderTop: '1px solid rgba(55, 65, 81, 0.3)',
                    borderBottom: 'none',
                    cursor: isLoadingMore ? 'wait' : 'pointer',
                    listStyle: 'none',
                    '&:hover': {
                      backgroundColor: isLoadingMore ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
                      borderColor: 'rgba(59, 130, 246, 0.3)'
                    },
                    '&:active': {
                      backgroundColor: isLoadingMore ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
                    }
                  }}
                >
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: isLoadingMore ? '#9ca3af' : '#60a5fa',
                      textAlign: 'center',
                      fontWeight: 500,
                    }}
                  >
                    {isLoadingMore ? 'Loading...' : 'Load More'}
                  </Typography>
                </Box>
              )}
            </ul>
          );
        })}
      />
      
      {/* Selected items chips */}
      {selectedItems.length > 0 && (
        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {selectedItems.slice(0, maxChipsShown).map((item) => (
            <Chip
              key={getItemKey(item)}
              label={renderItem(item)}
              size="small"
              onDelete={() => handleRemoveItem(item)}
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#93c5fd',
                border: '1px solid #3b82f6',
                '& .MuiChip-deleteIcon': { color: '#93c5fd' },
              }}
            />
          ))}
          {selectedItems.length > maxChipsShown && (
            <Chip
              label={`+${selectedItems.length - maxChipsShown} more`}
              size="small"
              sx={{
                backgroundColor: 'rgba(107, 114, 128, 0.2)',
                color: '#9ca3af',
                border: '1px solid #6b7280',
              }}
            />
          )}
        </Box>
      )}
      
      {helperText && (
        <Typography variant="body2" sx={{ color: '#9ca3af', mt: 0.5, fontSize: '0.75rem' }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );
}

export default MultiSelectField;
