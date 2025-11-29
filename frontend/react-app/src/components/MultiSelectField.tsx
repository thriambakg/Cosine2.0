import { useState, useEffect } from 'react';
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
} from '@mui/icons-material';

interface MultiSelectFieldProps<T> {
  label: string;
  selectedItems: T[];
  onItemsChange: (items: T[]) => void;
  suggestions?: T[];
  renderItem?: (item: T) => string;
  getItemKey?: (item: T) => string;
  placeholder?: string;
  helperText?: string;
  maxChipsShown?: number;
  allowCustomInput?: boolean;
  isLoading?: boolean;
  onSearch?: (query: string) => T[]; // Callback for dynamic search that returns results
}

function MultiSelectField<T = string>({
  label,
  selectedItems,
  onItemsChange,
  suggestions = [],
  renderItem = (item: T) => String(item),
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

  // Debounced search effect - prevent excessive API calls
  useEffect(() => {
    if (!onSearch || !inputValue || inputValue.length < 2) {
      setDynamicSuggestions([]);
      return;
    }

    // Debounce the search to avoid excessive API calls
    const timeoutId = setTimeout(() => {
      const searchResults = onSearch(inputValue);
      setDynamicSuggestions(searchResults);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [inputValue, onSearch]);

  const handleAddItem = (newItem: T | string) => {
    if (!newItem) return;
    
    const itemToAdd = allowCustomInput && typeof newItem === 'string' 
      ? newItem as T 
      : newItem as T;
    
    console.log('MultiSelectField - Adding item:', itemToAdd);
    
    const keyExists = selectedItems.some(item => getItemKey(item) === getItemKey(itemToAdd));
    
    if (!keyExists) {
      console.log('MultiSelectField - Item added successfully');
      onItemsChange([...selectedItems, itemToAdd]);
    } else {
      console.log('MultiSelectField - Item already exists, not adding');
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
          console.log('MultiSelectField - Autocomplete onChange called with value:', value, 'reason:', reason);
          if (value && reason === 'selectOption') {
            handleAddItem(value);
            // Clear input after selection
            setInputValue('');
          }
        }}
        options={availableOptions}
        getOptionLabel={(option) => renderItem(option as T)}
        isOptionEqualToValue={(option, value) => getItemKey(option as T) === getItemKey(value as T)}
        filterOptions={(options) => {
          // Don't filter options - we handle this via the search
          return options;
        }}
        freeSolo={false}
        loading={isLoading}
        clearOnBlur={false}
        open={inputValue.length > 0 && availableOptions.length > 0}
        PaperComponent={(props) => (
          <Paper 
            {...props} 
            sx={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              color: '#ffffff',
              // Blue scrollbar styling
              '& .MuiAutocomplete-listbox': {
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
                  <IconButton
                    onClick={() => handleAddItem(inputValue)}
                    disabled={!inputValue.trim()}
                    size="small"
                    sx={{ 
                      color: inputValue.trim() ? '#3b82f6' : '#6b7280',
                      '&:hover': { color: '#2563eb' }
                    }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#374151' },
                '&:hover fieldset': { borderColor: '#3b82f6' },
                '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3af' },
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
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box
              key={key}
              component="li"
              {...otherProps}
              sx={{
                backgroundColor: 'transparent',
                color: '#ffffff',
                '&:hover': { 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)' 
                },
                '&[aria-selected="true"]': {
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                  },
                },
              }}
            >
              {renderItem(option)}
            </Box>
          );
        }}
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
