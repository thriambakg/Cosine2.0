import React, { useState, useEffect } from 'react';
import { 
  TextField, 
  Button, 
  Autocomplete, 
  Typography, 
  Box,
  Card,
  CardContent,
  Container,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { TrendingUp as VolatilityIcon } from '@mui/icons-material';
import { useStockVolatility } from '../hooks/useAPI';
import { logApiConfig } from '../config/api';
import { loadConfig, validateConfig, getConfig } from '../config/configLoader';

const STOCK_TICKERS = [
  "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META",
  "NFLX", "NVDA", "SPY", "VTI", "MSCI", "BA", "GE",
  "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
];

// Custom styled components for Wall Street chic
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Card
    sx={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #374151',
      borderRadius: '0px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      ...sx
    }}
    {...props}
  >
    <CardContent sx={{ p: 0 }}>
      {children}
    </CardContent>
  </Card>
);

const StockVolatilityPage: React.FC = () => {
  const [ticker, setTicker] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>('1y');
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  
  const { data: volatilityData, loading: isLoading, error, execute: fetchVolatility } = useStockVolatility();

  // Load configuration and validate on component mount
  useEffect(() => {
    const initializeConfig = async () => {
      try {
        await loadConfig();
        const validation = validateConfig();
        setConfigValid(validation.isValid);
        setConfigErrors(validation.errors);
        
        // Log API configuration for debugging
        logApiConfig();
        
        console.log('🔧 Configuration Status:', {
          isValid: validation.isValid,
          errors: validation.errors,
          apiUrl: getConfig('apiGatewayUrl')
        });
      } catch (error) {
        console.error('❌ Failed to load configuration:', error);
        setConfigValid(false);
        setConfigErrors(['Failed to load configuration']);
      }
    };

    initializeConfig();
  }, []);

  const handleFetchVolatility = async () => {
    if (!ticker) return;
    
    if (!configValid) {
      console.error('❌ Configuration is invalid:', configErrors);
      return;
    }
    
    console.log(`🔍 Attempting to fetch volatility for ${ticker} with period ${period}`);
    console.log(`🌐 Using API URL: ${getConfig('apiGatewayUrl')}`);
    
    await fetchVolatility({ ticker, period });
  };

  const getVolatilityLevel = (vol: number) => {
    if (vol < 0.2) return { level: 'Low', color: '#22c55e' };
    if (vol < 0.4) return { level: 'Medium', color: '#f59e0b' };
    return { level: 'High', color: '#dc2626' };
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth="xl">
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
            Stock Volatility Analysis
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Analyze stock volatility patterns and risk metrics for informed trading decisions
          </Typography>
        </Box>

        {/* Configuration Status */}
        {!configValid && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="warning" sx={{ 
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid #f59e0b',
              color: '#fbbf24',
              '& .MuiAlert-icon': {
                color: '#fbbf24',
              }
            }}>
              <Typography variant="h6" sx={{ color: '#fbbf24', mb: 1 }}>
                Configuration Issue
              </Typography>
              <Typography variant="body2" sx={{ color: '#fbbf24', mb: 2 }}>
                The API configuration is not properly set up. Please check the following:
              </Typography>
              <Box component="ul" sx={{ color: '#fbbf24', pl: 2 }}>
                {configErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </Box>
              <Typography variant="body2" sx={{ color: '#fbbf24', mt: 2 }}>
                Current API URL: {getConfig('apiGatewayUrl') || 'Not configured'}
              </Typography>
            </Alert>
          </GlassCard>
        )}

        {/* Input Section */}
        <GlassCard sx={{ p: 4, mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #1d4ed8',
              }}
            >
              <VolatilityIcon sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography 
              variant="h6" 
              sx={{ 
                color: '#ffffff', 
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Select Stock
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Autocomplete
              value={ticker}
              onChange={(_, newValue) => setTicker(newValue)}
              options={STOCK_TICKERS}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Stock Ticker Symbol"
                  variant="outlined"
                  sx={{
                    minWidth: 300,
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
              )}
              sx={{ flexGrow: 1 }}
              freeSolo
              autoSelect
            />
            
            <FormControl sx={{ minWidth: 120 }}>
              <InputLabel sx={{ color: '#9ca3af' }}>Period</InputLabel>
              <Select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                sx={{
                  color: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#374151',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#3b82f6',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#3b82f6',
                  },
                }}
              >
                <MenuItem value="1d">1 Day</MenuItem>
                <MenuItem value="5d">5 Days</MenuItem>
                <MenuItem value="1mo">1 Month</MenuItem>
                <MenuItem value="3mo">3 Months</MenuItem>
                <MenuItem value="6mo">6 Months</MenuItem>
                <MenuItem value="1y">1 Year</MenuItem>
                <MenuItem value="2y">2 Years</MenuItem>
                <MenuItem value="5y">5 Years</MenuItem>
                <MenuItem value="10y">10 Years</MenuItem>
                <MenuItem value="max">Max</MenuItem>
              </Select>
            </FormControl>
            
            <Button 
              variant="contained" 
              onClick={handleFetchVolatility}
              disabled={!ticker || isLoading}
              sx={{
                height: '56px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                borderRadius: '0px',
                textTransform: 'uppercase',
                fontWeight: 700,
                border: '2px solid #1d4ed8',
                px: 4,
                '&:hover': {
                  background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
                  border: '2px solid #1e40af',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                },
                '&:disabled': {
                  background: 'rgba(59, 130, 246, 0.3)',
                  border: '2px solid rgba(59, 130, 246, 0.3)',
                }
              }}
            >
              {isLoading ? 'Analyzing...' : 'Fetch Volatility'}
            </Button>
          </Box>
        </GlassCard>

        {/* Error Display */}
        {error && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="error" sx={{ 
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid #dc2626',
              color: '#fca5a5',
              '& .MuiAlert-icon': {
                color: '#fca5a5',
              }
            }}>
              {error}
            </Alert>
          </GlassCard>
        )}

        {/* Results Section */}
        {volatilityData && (
          <GlassCard sx={{ p: 4 }}>
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
              Analysis Results
            </Typography>
            
            <Box sx={{ 
              p: 4, 
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid #374151',
              borderRadius: '0px',
            }}>
              <Typography variant="body1" sx={{ color: '#9ca3af', mb: 2 }}>
                Volatility for <strong style={{ color: '#ffffff' }}>{volatilityData.ticker}</strong> ({volatilityData.period}):
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 2 }}>
                <Typography variant="h3" sx={{ 
                  color: getVolatilityLevel(volatilityData.volatility).color, 
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}>
                  {volatilityData.volatility.toFixed(4)}
                </Typography>
                <Typography variant="h6" sx={{ 
                  color: getVolatilityLevel(volatilityData.volatility).color,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  ({getVolatilityLevel(volatilityData.volatility).level} Volatility)
                </Typography>
              </Box>
              
              <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.875rem', mb: 2 }}>
                This represents the {volatilityData.period} historical volatility of {volatilityData.ticker}. 
                {getVolatilityLevel(volatilityData.volatility).level === 'Low' && ' Low volatility indicates stable price movements.'}
                {getVolatilityLevel(volatilityData.volatility).level === 'Medium' && ' Medium volatility suggests moderate price fluctuations.'}
                {getVolatilityLevel(volatilityData.volatility).level === 'High' && ' High volatility indicates significant price swings and increased risk.'}
              </Typography>
              
              {volatilityData.note && (
                <Alert severity="info" sx={{ 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid #3b82f6',
                  color: '#93c5fd',
                  '& .MuiAlert-icon': {
                    color: '#93c5fd',
                  }
                }}>
                  {volatilityData.note}
                </Alert>
              )}
            </Box>
          </GlassCard>
        )}

        {/* Loading State */}
        {isLoading && (
          <GlassCard sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              Analyzing {ticker} volatility data...
            </Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af', mt: 1 }}>
              Fetching {period} historical data from the API
            </Typography>
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default StockVolatilityPage;
