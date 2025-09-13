import { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Paper,
  Chip,
  Alert,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Calculate as CalculateIcon,
} from '@mui/icons-material';
import { usePortfolioAnalysis } from '../hooks/useAPI';

// Force refresh - updated at 2025-01-10T00:00:00.000Z

interface PortfolioEntry {
  stock: string;
  shares: number;
}

interface PortfolioResults {
  total_portfolio_value: number;
  portfolio_expected_return: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  stock_details: {
    [key: string]: {
      weight: number;
      annual_return: number;
      annual_volatility: number;
      shares: number;
      current_price: number;
      total_value: number;
    }
  }
}

export default function PortfolioRisk() {
  const [entries, setEntries] = useState<PortfolioEntry[]>([{ stock: '', shares: 0 }]);
  const [results, setResults] = useState<PortfolioResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Use the portfolio analysis hook - updated to use real API
  const { execute: analyzePortfolio, loading: isLoading, error: apiError } = usePortfolioAnalysis();

  const addEntry = () => {
    setEntries([...entries, { stock: '', shares: 0 }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof PortfolioEntry, value: string | number) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntries(newEntries);
  };

  const calculateRisk = async () => {
    setError(null);
    
    try {
      // Prepare portfolio data for API call
      const portfolioData = entries
        .filter(entry => entry.stock && entry.shares > 0)
        .map(entry => [entry.stock, entry.shares, 0] as [string, number, number]); // Price will be fetched by API
      
      if (portfolioData.length === 0) {
        setError('Please add at least one stock with shares > 0');
        return;
      }
      
      // Call the portfolio analysis API
      const response = await analyzePortfolio({
        portfolio_data: portfolioData,
        period: '1y',
        analysis_type: 'standalone'
      });
      
      console.log('Portfolio analysis response:', response);
      
      if (response && response.success) {
        setResults(response.portfolio_metrics);
      } else {
        setError('Failed to analyze portfolio. Please check your stock tickers.');
      }
    } catch (err) {
      console.error('Portfolio analysis error:', err);
      setError(apiError || 'An error occurred while analyzing your portfolio. Please try again.');
    }
  };

  const getRiskLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Low', color: '#22c55e' };
    if (volatility < 20) return { level: 'Medium', color: '#f59e0b' };
    return { level: 'High', color: '#ef4444' };
  };

  return (
    <Box sx={{ p: 3, maxWidth: '1400px', mx: 'auto', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography 
          variant="h4" 
          sx={{ 
            color: '#ffffff', 
            fontWeight: 700, 
            mb: 1,
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          Portfolio Risk Analysis
        </Typography>
        <Typography 
          variant="body1" 
          sx={{ 
            color: '#9ca3af',
            fontSize: '1rem',
          }}
        >
          Analyze your portfolio's risk metrics and optimize your investment strategy
        </Typography>
      </Box>

      {/* Input Section */}
      <Paper
        sx={{
          p: 3,
          mb: 4,
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid #374151',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <Typography 
          variant="h6" 
          sx={{ 
            color: '#ffffff', 
            fontWeight: 600, 
            mb: 3,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Portfolio Holdings
        </Typography>

        {entries.map((entry, index) => (
          <Box 
            key={index} 
            sx={{ 
              display: 'flex', 
              gap: 2, 
              mb: 2, 
              alignItems: 'center',
              p: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
            }}
          >
            <TextField
              label="Stock Ticker"
              value={entry.stock}
              onChange={(e) => updateEntry(index, 'stock', e.target.value.toUpperCase())}
              sx={{ 
                flexGrow: 1,
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#3b82f6',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#3b82f6',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                },
                '& .MuiInputBase-input': {
                  color: '#ffffff',
                },
              }}
            />
                         <TextField
               type="number"
               label="Number of Shares"
               value={entry.shares}
               onChange={(e) => updateEntry(index, 'shares', parseFloat(e.target.value) || 0)}
               inputProps={{
                 inputMode: 'numeric',
                 pattern: '[0-9]*',
               }}
               sx={{ 
                 flexGrow: 1,
                 '& .MuiOutlinedInput-root': {
                   '& fieldset': {
                     borderColor: '#374151',
                   },
                   '&:hover fieldset': {
                     borderColor: '#3b82f6',
                   },
                   '&.Mui-focused fieldset': {
                     borderColor: '#3b82f6',
                   },
                 },
                 '& .MuiInputLabel-root': {
                   color: '#9ca3af',
                 },
                 '& .MuiInputBase-input': {
                   color: '#ffffff',
                 },
                 '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
                   WebkitAppearance: 'none',
                   margin: 0,
                 },
                 '& input[type=number]': {
                   MozAppearance: 'textfield',
                 },
               }}
             />
            <IconButton 
              onClick={() => removeEntry(index)}
              disabled={entries.length === 1}
              sx={{
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                '&:hover': {
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                },
                '&.Mui-disabled': {
                  color: '#6b7280',
                  backgroundColor: 'rgba(107, 114, 128, 0.1)',
                },
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        ))}

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={addEntry}
            sx={{
              borderColor: '#3b82f6',
              color: '#3b82f6',
              '&:hover': {
                borderColor: '#2563eb',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
              },
            }}
          >
            Add Stock
          </Button>
          <Button
            variant="contained"
            startIcon={<CalculateIcon />}
            onClick={calculateRisk}
            disabled={isLoading || entries.some(e => !e.stock || e.shares <= 0)}
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: '#ffffff',
              fontWeight: 600,
              '&:hover': {
                background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
              },
              '&.Mui-disabled': {
                background: 'rgba(107, 114, 128, 0.3)',
                color: '#6b7280',
              },
            }}
          >
            {isLoading ? 'Calculating...' : 'Calculate Risk'}
          </Button>
        </Box>
      </Paper>

      {/* Error Display */}
      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 3,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            '& .MuiAlert-message': {
              color: '#ef4444',
            },
          }}
        >
          {error}
        </Alert>
      )}

      {/* Results Section */}
      {results && (
        <Paper
          sx={{
            p: 3,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid #374151',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          <Typography 
            variant="h6" 
            sx={{ 
              color: '#ffffff', 
              fontWeight: 600, 
              mb: 3,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Portfolio Analysis Results
          </Typography>

          {/* Key Metrics */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Total Portfolio Value
                </Typography>
                <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 700 }}>
                  ${results.total_portfolio_value.toLocaleString()}
                </Typography>
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Expected Annual Return
                </Typography>
                <Typography variant="h5" sx={{ color: '#22c55e', fontWeight: 700 }}>
                  {results.portfolio_expected_return >= 0 ? '+' : ''}{results.portfolio_expected_return.toFixed(2)}%
                </Typography>
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Portfolio Volatility
                </Typography>
                <Typography variant="h5" sx={{ color: '#ef4444', fontWeight: 700 }}>
                  {results.portfolio_volatility.toFixed(2)}%
                </Typography>
                <Chip
                  label={getRiskLevel(results.portfolio_volatility).level}
                  size="small"
                  sx={{
                    backgroundColor: getRiskLevel(results.portfolio_volatility).color,
                    color: '#ffffff',
                    fontWeight: 600,
                    mt: 1,
                  }}
                />
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Sharpe Ratio
                </Typography>
                <Typography variant="h5" sx={{ color: '#a855f7', fontWeight: 700 }}>
                  {results.sharpe_ratio.toFixed(2)}
                </Typography>
              </Box>
            </Grid>
          </Grid>

          {/* Stock Details Table */}
          <Typography 
            variant="h6" 
            sx={{ 
              color: '#ffffff', 
              fontWeight: 600, 
              mb: 2,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Individual Stock Details
          </Typography>

          <TableContainer
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid #374151',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                  <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Stock</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Weight</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Annual Return</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Volatility</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Shares</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Current Price</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Total Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(results.stock_details).map(([stock, details]) => (
                  <TableRow 
                    key={stock}
                    sx={{
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      },
                    }}
                  >
                    <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>{stock}</TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {(details.weight * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: details.annual_return >= 0 ? '#22c55e' : '#ef4444' }}>
                      {details.annual_return >= 0 ? '+' : ''}{details.annual_return.toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.annual_volatility.toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.shares.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      ${details.current_price.toFixed(2)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      ${details.total_value.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
