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

const STOCK_SYMBOLS = [
  "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "META", "NVDA", "NFLX", "AMD", "INTC",
  "CRM", "ADBE", "PYPL", "UBER", "SPOT", "SQ", "ZM", "DOCU", "SNOW", "PLTR",
  "ROKU", "PINS", "TWLO", "OKTA", "CRWD", "NET", "DDOG", "ZS", "ESTC", "MDB",
  "SPY", "QQQ", "IWM", "VTI", "VOO", "ARKK", "TQQQ", "SOXL", "TMF", "UPRO"
];

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

  const availableSymbols = STOCK_SYMBOLS.filter(symbol => !existingSymbols.includes(symbol));

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
    setSelectedTimeframe('1d');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
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
          {/* Stock Selection */}
          <FormControl fullWidth>
            <InputLabel sx={{ color: '#9ca3af' }}>Stock Symbol</InputLabel>
            <Select
              value={selectedSymbol}
              label="Stock Symbol"
              onChange={(e) => setSelectedSymbol(e.target.value)}
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
