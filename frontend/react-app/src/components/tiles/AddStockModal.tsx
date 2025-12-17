import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
  Autocomplete,
  TextField,
  CircularProgress,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { securitySuggestionsServiceV2, Security } from '../../services/securitySuggestionsV2';

interface AddStockModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (stockData: {
    symbol: string;
    timeframe: string;
    displayOptions: {
      showPrice: boolean;
      showPriceMarker: boolean;
      show24hChange: boolean;
      showAnnualReturn: boolean;
      showVolatility: boolean;
      showChart: boolean;
    };
    autoRefresh: boolean;
  }) => void;
  existingSymbols: string[];
}

const TIMEFRAMES = [
  { value: "1d", label: "1 Day" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "1y", label: "1 Year" },
];

const AddStockModal: React.FC<AddStockModalProps> = ({
  open,
  onClose,
  onAdd,
  existingSymbols,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedSecurity, setSelectedSecurity] = useState<Security | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1d');
  const [displayOptions, setDisplayOptions] = useState({
    showPrice: true,
    showPriceMarker: false,
    show24hChange: true,
    showAnnualReturn: true,
    showVolatility: true,
    showChart: true,
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isSecurityDataLoaded, setIsSecurityDataLoaded] = useState(false);
  const [securitySuggestions, setSecuritySuggestions] = useState<Security[]>([]);
  const [autocompleteInput, setAutocompleteInput] = useState<string>('');

  // Load security data on mount
  useEffect(() => {
    const loadSecurityData = async () => {
      try {
        await securitySuggestionsServiceV2.loadSecurities();
        setIsSecurityDataLoaded(true);
        // Deduplicate securities by symbol (keep first occurrence)
        const allSecurities = securitySuggestionsServiceV2.getAllSecurities();
        const seen = new Set<string>();
        const uniqueSecurities = allSecurities.filter(security => {
          if (seen.has(security.symbol)) {
            return false;
          }
          seen.add(security.symbol);
          return true;
        });
        setSecuritySuggestions(uniqueSecurities.slice(0, 50));
      } catch (error) {
        console.error('Failed to load security suggestions:', error);
      }
    };

    if (open) {
      loadSecurityData();
    }
  }, [open]);

  // Filter out existing symbols from suggestions
  const availableSecurities = securitySuggestions.filter(
    security => !existingSymbols.includes(security.symbol)
  );

  const handleAdd = () => {
    if (!selectedSymbol) return;

    onAdd({
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      displayOptions,
      autoRefresh,
    });

    // Reset form
    setSelectedSymbol('');
    setSelectedSecurity(null);
    setAutocompleteInput('');
    setSelectedTimeframe('1d');
    setDisplayOptions({
      showPrice: true,
      showPriceMarker: false,
      show24hChange: true,
      showAnnualReturn: true,
      showVolatility: true,
      showChart: true,
    });
    setAutoRefresh(false);
    onClose();
  };

  const handleClose = () => {
    // Reset form on close
    setSelectedSymbol('');
    setSelectedSecurity(null);
    setAutocompleteInput('');
    setSelectedTimeframe('1d');
    onClose();
  };

  const handleSecurityChange = (_event: any, newValue: Security | string | null) => {
    if (typeof newValue === 'string') {
      setSelectedSecurity(null);
      setSelectedSymbol(newValue.toUpperCase());
    } else {
      setSelectedSecurity(newValue);
      if (newValue) {
        setSelectedSymbol(newValue.symbol);
      } else {
        setSelectedSymbol('');
      }
    }
  };

  const handleInputChange = (_event: any, newInputValue: string) => {
    setAutocompleteInput(newInputValue);
    if (isSecurityDataLoaded && newInputValue) {
      const suggestions = securitySuggestionsServiceV2.getSuggestions(newInputValue, 50);
      // Deduplicate by symbol and filter existing
      const seen = new Set<string>();
      const uniqueSuggestions = suggestions.filter(s => {
        if (seen.has(s.symbol) || existingSymbols.includes(s.symbol)) {
          return false;
        }
        seen.add(s.symbol);
        return true;
      });
      setSecuritySuggestions(uniqueSuggestions);
    } else if (isSecurityDataLoaded) {
      const allSecurities = securitySuggestionsServiceV2.getAllSecurities();
      const seen = new Set<string>();
      const uniqueSecurities = allSecurities.filter(s => {
        if (seen.has(s.symbol) || existingSymbols.includes(s.symbol)) {
          return false;
        }
        seen.add(s.symbol);
        return true;
      });
      setSecuritySuggestions(uniqueSecurities.slice(0, 50));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      disableEnforceFocus={false}
      disableAutoFocus={false}
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #374151',
          color: 'white',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #374151' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AddIcon sx={{ color: '#10b981' }} />
          <Typography variant="h6">Add Stock Analysis Tile</Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Stock Selection - Autocomplete */}
          <Autocomplete
            value={selectedSecurity ?? null}
            onChange={handleSecurityChange}
            inputValue={autocompleteInput}
            onInputChange={handleInputChange}
            options={availableSecurities}
            getOptionLabel={(option) => typeof option === 'string' ? option : option.displayText}
            isOptionEqualToValue={(option, value) => {
              if (typeof option === 'string' || typeof value === 'string') {
                return option === value;
              }
              return option.symbol === value.symbol;
            }}
            loading={!isSecurityDataLoaded}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Stock Symbol"
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    '& fieldset': {
                      borderColor: '#374151',
                    },
                    '&:hover fieldset': {
                      borderColor: '#10b981',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#10b981',
                    },
                  },
                  '& .MuiInputLabel-root': {
                    color: '#9ca3af',
                  },
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {!isSecurityDataLoaded ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const capColor = option.marketCap === 'high' ? '#10b981' : option.marketCap === 'mid' ? '#f59e0b' : '#ef4444';
              const capLabel = option.marketCap === 'high' ? 'High Cap' : option.marketCap === 'mid' ? 'Mid Cap' : 'Low Cap';
              const uniqueKey = `${option.symbol}-${option.marketCap}-${option.name}`;
              return (
                <Box component="li" {...props} key={uniqueKey} sx={{ py: 1 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                        {option.symbol}
                      </Typography>
                      <Chip 
                        label={capLabel} 
                        size="small" 
                        sx={{ 
                          height: '18px', 
                          fontSize: '0.65rem',
                          backgroundColor: capColor,
                          color: 'white'
                        }} 
                      />
                    </Box>
                    <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                      {option.name}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
            sx={{
              '& .MuiAutocomplete-popper': {
                '& .MuiPaper-root': {
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid #374151',
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
                  '& .MuiAutocomplete-listbox': {
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
                  },
                },
              },
            }}
            freeSolo
            autoSelect
          />

          {/* Timeframe Selection */}
          <FormControl fullWidth>
            <InputLabel sx={{ color: '#9ca3af' }}>Timeframe</InputLabel>
            <Select
              value={selectedTimeframe}
              label="Timeframe"
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#374151',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#10b981',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#10b981',
                },
              }}
            >
              {TIMEFRAMES.map((tf) => (
                <MenuItem key={tf.value} value={tf.value} sx={{ color: '#1e293b' }}>
                  {tf.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Display Options */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 2, color: '#10b981' }}>
              Display Options
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(displayOptions).map(([key, value]) => (
                <Chip
                  key={key}
                  label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  onClick={() => setDisplayOptions(prev => ({ ...prev, [key]: !value }))}
                  sx={{
                    backgroundColor: value ? 'rgba(16, 185, 129, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                    color: value ? '#10b981' : '#9ca3af',
                    border: `1px solid ${value ? '#10b981' : '#6b7280'}`,
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: value ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)',
                    },
                  }}
                />
              ))}
            </Box>
          </Box>

          {/* Auto-refresh Option */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, color: '#10b981' }}>
              Auto-refresh
            </Typography>
            <Chip
              label={autoRefresh ? 'Enabled (5 min intervals)' : 'Disabled'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              sx={{
                backgroundColor: autoRefresh ? 'rgba(16, 185, 129, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                color: autoRefresh ? '#10b981' : '#9ca3af',
                border: `1px solid ${autoRefresh ? '#10b981' : '#6b7280'}`,
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: autoRefresh ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)',
                },
              }}
            />
          </Box>

          {/* Preview */}
          {selectedSymbol && (
            <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, color: '#10b981' }}>
                Preview
              </Typography>
              <Typography variant="body2" color="#9ca3af">
                {selectedSymbol} tile with {TIMEFRAMES.find(tf => tf.value === selectedTimeframe)?.label} timeframe
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
        <Button
          onClick={handleClose}
          sx={{
            color: '#9ca3af',
            '&:hover': {
              backgroundColor: 'rgba(156, 163, 175, 0.1)',
            },
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleAdd}
          disabled={!selectedSymbol}
          sx={{
            backgroundColor: '#10b981',
            color: 'white',
            '&:hover': {
              backgroundColor: '#059669',
            },
            '&:disabled': {
              backgroundColor: '#374151',
              color: '#6b7280',
            },
          }}
        >
          Add Tile
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddStockModal;
