import React, { useState } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Grid,
  Card,
  CardContent,

  Container,
} from '@mui/material';
import { Calculate as CalculateIcon } from '@mui/icons-material';

interface OptionPrices {
  call: number;
  put: number;
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
        background: trend === 'up' ? '#22c55e' : '#dc2626',
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

const OptionPricingPage: React.FC = () => {
  const [S, setS] = useState('100');
  const [K, setK] = useState('110');
  const [T, setT] = useState('1');
  const [r, setR] = useState('0.05');
  const [sigma, setSigma] = useState('0.2');
  const [prices, setPrices] = useState<OptionPrices | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const calculatePrices = async () => {
    setIsCalculating(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // TODO: Implement actual Black-Scholes calculation using an API
    const mockPrices: OptionPrices = {
      call: Math.random() * 10 + 2,
      put: Math.random() * 8 + 1
    };
    setPrices(mockPrices);
    setIsCalculating(false);
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
            Option Pricing Calculator
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Calculate option prices using the Black-Scholes model with real-time market data
          </Typography>
        </Box>

        {/* Input Section */}
        <GlassCard sx={{ p: 4, mb: 4 }}>
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
            Option Parameters
          </Typography>

          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Current Stock Price (S)"
                type="number"
                value={S}
                onChange={(e) => setS(e.target.value)}
                placeholder="100"
                sx={{
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
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Strike Price (K)"
                type="number"
                value={K}
                onChange={(e) => setK(e.target.value)}
                placeholder="110"
                sx={{
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
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Time to Maturity (T) in years"
                type="number"
                value={T}
                onChange={(e) => setT(e.target.value)}
                placeholder="1"
                sx={{
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
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Risk-Free Interest Rate (r)"
                type="number"
                value={r}
                onChange={(e) => setR(e.target.value)}
                placeholder="0.05"
                sx={{
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
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Volatility (σ)"
                type="number"
                value={sigma}
                onChange={(e) => setSigma(e.target.value)}
                placeholder="0.2"
                sx={{
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
            </Grid>
          </Grid>

          <Button
            variant="contained"
            startIcon={<CalculateIcon />}
            onClick={calculatePrices}
            disabled={isCalculating}
            sx={{
              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              color: '#ffffff',
              borderRadius: '0px',
              textTransform: 'uppercase',
              fontWeight: 700,
              border: '2px solid #dc2626',
              px: 4,
              py: 1.5,
              '&:hover': {
                background: 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)',
                border: '2px solid #b91c1c',
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)',
              },
              '&:disabled': {
                background: 'rgba(220, 38, 38, 0.3)',
                border: '2px solid rgba(220, 38, 38, 0.3)',
              }
            }}
          >
            {isCalculating ? 'Calculating...' : 'Calculate Option Prices'}
          </Button>
        </GlassCard>

        {/* Results Section */}
        {prices && (
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
              Option Prices
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <MetricCard
                  title="Call Option Price"
                  value={`$${prices.call.toFixed(2)}`}
                  trend="up"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <MetricCard
                  title="Put Option Price"
                  value={`$${prices.put.toFixed(2)}`}
                  trend="down"
                />
              </Grid>
            </Grid>
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default OptionPricingPage;
