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
} from '@mui/material';
import { CurrencyBitcoin as CryptoIcon } from '@mui/icons-material';

const CRYPTO_SYMBOLS = ["BTC", "ETH", "XRP", "LTC", "DOGE", "ADA", "SOL"];

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
  const [stats, setStats] = useState<CryptoStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCryptoStats = async () => {
    setIsLoading(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // TODO: Implement actual API call
    const mockStats: CryptoStats = {
      current_price: Math.random() * 50000 + 20000,
      price_change_24h: (Math.random() - 0.5) * 10,
      annual_return: (Math.random() - 0.5) * 100,
      volatility: Math.random() * 50 + 20,
    };
    setStats(mockStats);
    setIsLoading(false);
  };

  const handleCryptoChange = (value: string) => {
    setSelectedCrypto(value);
    fetchCryptoStats();
  };

  useEffect(() => {
    fetchCryptoStats();
  }, []);

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
              Select Cryptocurrency
            </Typography>
          </Box>

          <FormControl sx={{ minWidth: 300 }}>
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
        </GlassCard>

        {/* Stats Display */}
        {stats && (
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
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Current Price (USD)"
                  value={`$${stats.current_price.toFixed(2)}`}
                  trend={stats.price_change_24h > 0 ? "up" : "down"}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="24h Return (%)"
                  value={`${stats.price_change_24h.toFixed(2)}%`}
                  trend={stats.price_change_24h > 0 ? "up" : "down"}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Annual Return (%)"
                  value={`${stats.annual_return.toFixed(2)}%`}
                  trend={stats.annual_return > 0 ? "up" : "down"}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Annualized Volatility (%)"
                  value={`${stats.volatility.toFixed(2)}%`}
                  trend="neutral"
                />
              </Grid>
            </Grid>
          </GlassCard>
        )}

        {/* Loading State */}
        {isLoading && (
          <GlassCard sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              Loading {selectedCrypto} data...
            </Typography>
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default CryptoStatsPage;
