import { useState } from 'react';
import {
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Box,
  Typography,
  Chip,
  Autocomplete,
  Paper,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Close as CloseIcon,
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
}: MultiSelectFieldProps<T>) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleAddItem = (newItem: T | string) => {
    if (!newItem) return;
    
    const itemToAdd = allowCustomInput && typeof newItem === 'string' 
      ? newItem as T 
      : newItem as T;
    
    if (!selectedItems.some(item => getItemKey(item) === getItemKey(itemToAdd))) {
      onItemsChange([...selectedItems, itemToAdd]);
    }
    setInputValue('');
  };

  const handleRemoveItem = (itemToRemove: T) => {
    onItemsChange(selectedItems.filter(item => getItemKey(item) !== getItemKey(itemToRemove)));
  };

  const handleClearAll = () => {
    onItemsChange([]);
  };

  const displayValue = selectedItems.length > 0
    ? `${selectedItems.length} ${label.toLowerCase()}${selectedItems.length > 1 ? 's' : ''} selected`
    : `Select ${label.toLowerCase()}...`;

  return (
    <>
      {/* Main Field */}
      <Box>
        <TextField
          label={label}
          value={displayValue}
          onClick={() => setIsModalOpen(true)}
          InputProps={{
            readOnly: true,
            endAdornment: <ExpandMoreIcon sx={{ color: '#9ca3af' }} />,
          }}
          variant="outlined"
          fullWidth
          sx={{
            cursor: 'pointer',
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: '#374151' },
              '&:hover fieldset': { borderColor: '#3b82f6' },
              '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
            },
            '& .MuiInputLabel-root': { color: '#9ca3af' },
            '& .MuiInputBase-input': { color: '#ffffff', cursor: 'pointer' },
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

      {/* Selection Modal */}
      <Dialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '0px',
            color: '#ffffff',
          },
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid #374151',
          pb: 2,
        }}>
          <Box>
            <Typography variant="h6" sx={{ color: '#ffffff', mb: 1 }}>
              Select {label}
            </Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              {helperText || `Choose multiple ${label.toLowerCase()} to search with OR logic`}
            </Typography>
          </Box>
          <IconButton
            onClick={() => setIsModalOpen(false)}
            sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ mt: 2 }}>
          {/* Add new item */}
          <Box sx={{ mb: 3 }}>
            <Autocomplete
              value={null}
              inputValue={inputValue}
              onInputChange={(_, value) => setInputValue(value)}
              onChange={(_, value) => {
                if (value) {
                  handleAddItem(value);
                }
              }}
              options={suggestions}
              getOptionLabel={(option) => renderItem(option as T)}
              freeSolo={allowCustomInput}
              loading={isLoading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={placeholder}
                  variant="outlined"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {params.InputProps.endAdornment}
                        <IconButton
                          onClick={() => handleAddItem(inputValue)}
                          disabled={!inputValue.trim()}
                          sx={{ color: '#3b82f6' }}
                        >
                          <AddIcon />
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
                    '& .MuiInputBase-input': { color: '#ffffff' },
                  }}
                />
              )}
              renderOption={(props, option) => (
                <Paper
                  component="li"
                  {...props}
                  sx={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    color: '#ffffff',
                    '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  }}
                >
                  {renderItem(option)}
                </Paper>
              )}
            />
          </Box>

          {/* Selected items */}
          {selectedItems.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ color: '#ffffff' }}>
                  Selected {label} ({selectedItems.length})
                </Typography>
                <Button
                  onClick={handleClearAll}
                  size="small"
                  sx={{ color: '#ef4444' }}
                >
                  Clear All
                </Button>
              </Box>
              
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {selectedItems.map((item) => (
                  <Chip
                    key={getItemKey(item)}
                    label={renderItem(item)}
                    onDelete={() => handleRemoveItem(item)}
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#93c5fd',
                      border: '1px solid #3b82f6',
                      '& .MuiChip-deleteIcon': { color: '#93c5fd' },
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        
        <DialogActions sx={{ borderTop: '1px solid #374151', pt: 2 }}>
          <Button
            onClick={() => setIsModalOpen(false)}
            variant="outlined"
            sx={{
              borderColor: '#374151',
              color: '#9ca3af',
              '&:hover': { borderColor: '#3b82f6', color: '#ffffff' },
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => setIsModalOpen(false)}
            variant="contained"
            sx={{
              backgroundColor: '#3b82f6',
              '&:hover': { backgroundColor: '#2563eb' },
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default MultiSelectField;
