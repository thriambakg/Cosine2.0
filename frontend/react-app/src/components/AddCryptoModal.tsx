import React, { useState } from 'react';
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
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';

interface AddCryptoModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (cryptoData: {
    symbol: string;
    timeframe: string;
    displayOptions: {
      showPrice: boolean;
      show24hChange: boolean;
      showAnnualReturn: boolean;
      showVolatility: boolean;
      showChart: boolean;
    };
    autoRefresh: boolean;
  }) => void;
  existingSymbols: string[];
}

const CRYPTO_SYMBOLS = [
  "BTC", "ETH", "BNB", "ADA", "SOL", "DOT", "AVAX", "MATIC", "LINK", "UNI",
  "XRP", "DOGE", "SHIB", "LTC", "BCH", "XLM", "VET", "TRX", "FIL", "ATOM",
  "NEAR", "FTM", "ALGO", "ICP", "HBAR", "THETA", "XTZ", "EOS", "AAVE", "COMP"
];

const TIMEFRAMES = [
  { value: "1d", label: "1 Day" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "1y", label: "1 Year" },
];

const AddCryptoModal: React.FC<AddCryptoModalProps> = ({
  open,
  onClose,
  onAdd,
  existingSymbols,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1d');
  const [displayOptions, setDisplayOptions] = useState({
    showPrice: true,
    show24hChange: true,
    showAnnualReturn: true,
    showVolatility: true,
    showChart: true,
  });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const availableSymbols = CRYPTO_SYMBOLS.filter(symbol => !existingSymbols.includes(symbol));

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
    setSelectedTimeframe('1d');
    setDisplayOptions({
      showPrice: true,
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
    setSelectedTimeframe('1d');
    onClose();
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
          <AddIcon sx={{ color: '#f59e0b' }} />
          <Typography variant="h6">Add Cryptocurrency Tile</Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Cryptocurrency Selection */}
          <FormControl fullWidth>
            <InputLabel sx={{ color: '#9ca3af' }}>Cryptocurrency</InputLabel>
            <Select
              value={selectedSymbol}
              label="Cryptocurrency"
              onChange={(e) => setSelectedSymbol(e.target.value)}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#374151',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#f59e0b',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#f59e0b',
                },
              }}
            >
              {availableSymbols.map((symbol) => (
                <MenuItem key={symbol} value={symbol} sx={{ color: '#1e293b' }}>
                  {symbol}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

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
                  borderColor: '#f59e0b',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#f59e0b',
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
            <Typography variant="subtitle1" sx={{ mb: 2, color: '#f59e0b' }}>
              Display Options
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(displayOptions).map(([key, value]) => (
                <Chip
                  key={key}
                  label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  onClick={() => setDisplayOptions(prev => ({ ...prev, [key]: !value }))}
                  sx={{
                    backgroundColor: value ? 'rgba(34, 197, 94, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                    color: value ? '#22c55e' : '#9ca3af',
                    border: `1px solid ${value ? '#22c55e' : '#6b7280'}`,
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: value ? 'rgba(34, 197, 94, 0.3)' : 'rgba(107, 114, 128, 0.3)',
                    },
                  }}
                />
              ))}
            </Box>
          </Box>

          {/* Auto-refresh Option */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, color: '#f59e0b' }}>
              Auto-refresh
            </Typography>
            <Chip
              label={autoRefresh ? 'Enabled (5 min intervals)' : 'Disabled'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              sx={{
                backgroundColor: autoRefresh ? 'rgba(34, 197, 94, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                color: autoRefresh ? '#22c55e' : '#9ca3af',
                border: `1px solid ${autoRefresh ? '#22c55e' : '#6b7280'}`,
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: autoRefresh ? 'rgba(34, 197, 94, 0.3)' : 'rgba(107, 114, 128, 0.3)',
                },
              }}
            />
          </Box>

          {/* Preview */}
          {selectedSymbol && (
            <Box sx={{ p: 2, border: '1px solid #374151', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, color: '#f59e0b' }}>
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
            backgroundColor: '#f59e0b',
            color: 'white',
            '&:hover': {
              backgroundColor: '#d97706',
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

export default AddCryptoModal;
