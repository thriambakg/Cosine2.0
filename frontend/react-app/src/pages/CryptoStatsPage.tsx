import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Container,
  Alert,
} from '@mui/material';
import { CurrencyBitcoin as CryptoIcon } from '@mui/icons-material';
import { useCryptoStats } from '../hooks/useAPI';
import { logApiConfig } from '../config/api';
import { loadConfig, validateConfig, getConfig } from '../config/configLoader';
import RefreshButton from '../components/common/RefreshButton';

const CRYPTO_SYMBOLS = ["BTC", "ETH", "BNB", "ADA", "SOL", "DOT", "AVAX", "MATIC", "LINK", "UNI"];

interface CryptoStats {
  current_price: number;
  price_change_24h: number;
  annual_return: number;
  volatility: number;
}

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

const MetricCard = ({ title, value, trend }: any) => (
  <Box
    sx={{
      p: 3,
      background: 'rgba(15, 23, 42, 0.8)',
      border: '1px solid #374151',
      borderRadius: '0px',
      position: 'relative',
      overflow: 'hidden',
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: trend === 'up' ? '#22c55e' : trend === 'down' ? '#dc2626' : '#3b82f6',
      }
    }}
  >
    <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 600, mb: 1 }}>
      {title}
    </Typography>
    <Typography variant="h4" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
      {value}
    </Typography>
  </Box>
);

const CryptoStatsPage: React.FC = () => {
  const [selectedCrypto, setSelectedCrypto] = useState<string>("BTC");
  const [timeframe, setTimeframe] = useState<string>('1d');
  const [configValid, setConfigValid] = useState<boolean>(false);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  
  const { data: cryptoData, loading: isLoading, error, execute: fetchCryptoStats, executeForceRefresh: fetchCryptoStatsForce } = useCryptoStats();

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

  const handleFetchCryptoStats = async (forceRefresh = false) => {
    if (!configValid) {
      console.error('❌ Configuration is invalid:', configErrors);
      return;
    }
    
    console.log(`🔍 Attempting to fetch crypto stats for ${selectedCrypto} with timeframe ${timeframe}${forceRefresh ? ' (force refresh)' : ''}`);
    console.log(`🌐 Using API URL: ${getConfig('apiGatewayUrl')}`);
    
    try {
      const result = forceRefresh 
        ? await fetchCryptoStatsForce({ symbols: [selectedCrypto], timeframe })
        : await fetchCryptoStats({ symbols: [selectedCrypto], timeframe });
      
      console.log('📊 Raw crypto data received:', result);
    } catch (error) {
      console.error('❌ Error fetching crypto stats:', error);
    }
  };

  const handleForceRefresh = () => {
    handleFetchCryptoStats(true);
  };

  const handleCryptoChange = (value: string) => {
    setSelectedCrypto(value);
    handleFetchCryptoStats(true); // Force refresh when crypto changes
  };

  const handleTimeframeChange = (value: string) => {
    setTimeframe(value);
    handleFetchCryptoStats(true); // Force refresh when timeframe changes
  };

  useEffect(() => {
    if (configValid) {
      handleFetchCryptoStats();
    }
  }, [configValid]);

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
            Cryptocurrency Analysis
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Real-time cryptocurrency statistics and market analysis
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

                 {/* Crypto Selection */}
         <GlassCard sx={{ p: 4, mb: 4 }}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
             <Box
               sx={{
                 width: 48,
                 height: 48,
                 borderRadius: '0px',
                 background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                 display: 'flex',
                 alignItems: 'center',
                 justifyContent: 'center',
                 border: '2px solid #d97706',
               }}
             >
               <CryptoIcon sx={{ color: 'white', fontSize: 24 }} />
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
               Cryptocurrency Statistics
             </Typography>
           </Box>

                       <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl sx={{ minWidth: 200 }}>
                <InputLabel sx={{ color: '#9ca3af' }}>Cryptocurrency</InputLabel>
                <Select
                  value={selectedCrypto}
                  label="Cryptocurrency"
                  onChange={(e) => handleCryptoChange(e.target.value)}
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
                    '& .MuiSelect-icon': {
                      color: '#9ca3af',
                    },
                  }}
                >
                  {CRYPTO_SYMBOLS.map((symbol) => (
                    <MenuItem key={symbol} value={symbol} sx={{ color: '#1e293b' }}>
                      {symbol}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              
              <FormControl sx={{ minWidth: 120 }}>
                <InputLabel sx={{ color: '#9ca3af' }}>Timeframe</InputLabel>
                <Select
                  value={timeframe}
                  label="Timeframe"
                  onChange={(e) => handleTimeframeChange(e.target.value)}
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
                  <MenuItem value="1d">1 Day</MenuItem>
                  <MenuItem value="7d">7 Days</MenuItem>
                  <MenuItem value="30d">30 Days</MenuItem>
                  <MenuItem value="1y">1 Year</MenuItem>
                </Select>
              </FormControl>

              <RefreshButton
                onRefresh={handleForceRefresh}
                loading={isLoading}
                color="primary"
                tooltip="Refresh crypto data"
                sx={{
                  color: '#f59e0b',
                  '&:hover': {
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  },
                }}
              />
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

         {/* Loading State */}
         {isLoading && (
           <GlassCard sx={{ p: 4, mb: 4, textAlign: 'center' }}>
             <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
               Loading {selectedCrypto} data for {timeframe} timeframe...
             </Typography>
           </GlassCard>
         )}

         {/* Stats Display */}
         {cryptoData && (
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
               {selectedCrypto} Statistics
             </Typography>
             
             {/* Debug info */}
             <Box sx={{ mb: 3, p: 2, background: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
               <Typography variant="body2" color="#9ca3af" sx={{ fontFamily: 'monospace' }}>
                 Debug - Raw data: {JSON.stringify(cryptoData, null, 2)}
               </Typography>
             </Box>
             
                           {/* Individual Crypto Stats */}
              <Typography variant="h6" sx={{ color: '#f59e0b', mb: 2, fontWeight: 600 }}>
                Cryptocurrency Metrics
              </Typography>
              <Grid container spacing={3}>
                {cryptoData.data.map((crypto) => (
                  <Grid item xs={12} sm={6} md={4} key={crypto.symbol}>
                    <Box
                      sx={{
                        p: 3,
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid #374151',
                        borderRadius: '0px',
                        position: 'relative',
                        overflow: 'hidden',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '3px',
                          background: crypto.return24h > 0 ? '#22c55e' : '#dc2626',
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" color="white" fontWeight={600}>
                          {crypto.symbol}
                        </Typography>
                        <Typography variant="body2" color="#9ca3af">
                          {crypto.name}
                        </Typography>
                      </Box>
                      
                      <Typography variant="h5" color="white" fontWeight={700} sx={{ mb: 1 }}>
                        ${crypto.currentPrice.toFixed(2)}
                      </Typography>
                      
                                             <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                         <Typography variant="body2" color="#9ca3af">
                           {timeframe === '1d' ? '24h Return (%)' : 
                            timeframe === '7d' ? '7-Day Return (%)' :
                            timeframe === '30d' ? '30-Day Return (%)' : '1-Year Return (%)'}:
                         </Typography>
                         <Typography 
                           variant="body2" 
                           color={crypto.return24h > 0 ? '#22c55e' : '#dc2626'}
                           fontWeight={600}
                         >
                           {crypto.return24h > 0 ? '+' : ''}{crypto.return24h.toFixed(2)}%
                         </Typography>
                       </Box>
                      
                                             <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                         <Typography variant="body2" color="#9ca3af">
                           Annualized Return (%):
                         </Typography>
                         <Typography 
                           variant="body2" 
                           color={crypto.annualReturn > 0 ? '#22c55e' : '#dc2626'}
                           fontWeight={600}
                         >
                           {crypto.annualReturn > 0 ? '+' : ''}{crypto.annualReturn.toFixed(2)}%
                         </Typography>
                       </Box>
                      
                                             <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                         <Typography variant="body2" color="#9ca3af">
                           {timeframe === '1d' ? 'Daily Volatility (%)' : 'Annualized Volatility (%)'}:
                         </Typography>
                         <Typography variant="body2" color="white" fontWeight={600}>
                           {crypto.annualizedVolatility.toFixed(2)}%
                         </Typography>
                       </Box>
                    </Box>
                  </Grid>
                ))}
              </Grid>
           </GlassCard>
         )}
      </Container>
    </Box>
  );
};

export default CryptoStatsPage;
