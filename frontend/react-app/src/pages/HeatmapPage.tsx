import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  ShowChart as ChartIcon,
  Analytics as AnalyticsIcon,
} from '@mui/icons-material';

interface HeatmapAxisData {
  z: number[][];
  x: number[];
  y: number[];
}

interface HeatmapData {
  call: HeatmapAxisData;
  put: HeatmapAxisData;
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

const GradientButton = ({ children, sx = {}, ...props }: any) => (
  <Button
    sx={{
      background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
      color: 'white',
      borderRadius: '0px',
      textTransform: 'uppercase',
      fontWeight: 700,
      border: '2px solid #22c55e',
      '&:hover': {
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        border: '2px solid #16a34a',
        transform: 'translateY(-1px)',
        boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
      },
      ...sx
    }}
    {...props}
  >
    {children}
  </Button>
);

export default function HeatmapPage() {
  const [minS, setMinS] = useState('50');
  const [maxS, setMaxS] = useState('150');
  const [minSigma, setMinSigma] = useState('0.1');
  const [maxSigma, setMaxSigma] = useState('0.5');
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateHeatmaps = async () => {
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      const mockHeatmapData: HeatmapData = {
        call: {
          z: Array(20)
            .fill(0)
            .map(() =>
              Array(20)
                .fill(0)
                .map(() => Math.random() * 50),
            ),
          x: Array(20)
            .fill(0)
            .map((_, i) => Number.parseFloat(minS) + ((Number.parseFloat(maxS) - Number.parseFloat(minS)) * i) / 19),
          y: Array(20)
            .fill(0)
            .map(
              (_, i) =>
                Number.parseFloat(minSigma) + ((Number.parseFloat(maxSigma) - Number.parseFloat(minSigma)) * i) / 19,
            ),
        },
        put: {
          z: Array(20)
            .fill(0)
            .map(() =>
              Array(20)
                .fill(0)
                .map(() => Math.random() * 50),
            ),
          x: Array(20)
            .fill(0)
            .map((_, i) => Number.parseFloat(minS) + ((Number.parseFloat(maxS) - Number.parseFloat(minS)) * i) / 19),
          y: Array(20)
            .fill(0)
            .map(
              (_, i) =>
                Number.parseFloat(minSigma) + ((Number.parseFloat(maxSigma) - Number.parseFloat(minSigma)) * i) / 19,
            ),
        },
      };
      setHeatmapData(mockHeatmapData);
      setIsLoading(false);
    }, 2000);
  };

  return (
    <Box sx={{ p: 3, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh' }}>
      {/* Header */}
      <GlassCard sx={{ p: 4, mb: 4 }}>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: '0px',
              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChartIcon sx={{ color: 'white', fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h4" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
              Options Heatmap Analysis
            </Typography>
            <Typography variant="body1" color="#22c55e" sx={{ textTransform: 'uppercase' }}>
              Visualize option pricing across different stock prices and volatility levels
            </Typography>
          </Box>
        </Box>
      </GlassCard>

      {/* Input Controls */}
      <GlassCard sx={{ p: 4, mb: 4 }}>
        <Typography variant="h6" fontWeight={600} color="white" mb={3} sx={{ textTransform: 'uppercase' }}>
          Parameters
        </Typography>
        <Grid container spacing={3} mb={3}>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              type="number"
              label="Minimum Stock Price (S)"
              value={minS}
              onChange={(e) => setMinS(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: 'white',
                  borderRadius: '0px',
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#22c55e',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#22c55e',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                  '&.Mui-focused': {
                    color: '#22c55e',
                  },
                },
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              type="number"
              label="Maximum Stock Price (S)"
              value={maxS}
              onChange={(e) => setMaxS(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: 'white',
                  borderRadius: '0px',
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#22c55e',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#22c55e',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                  '&.Mui-focused': {
                    color: '#22c55e',
                  },
                },
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              type="number"
              label="Minimum Volatility (σ)"
              value={minSigma}
              onChange={(e) => setMinSigma(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: 'white',
                  borderRadius: '0px',
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#22c55e',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#22c55e',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                  '&.Mui-focused': {
                    color: '#22c55e',
                  },
                },
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              type="number"
              label="Maximum Volatility (σ)"
              value={maxSigma}
              onChange={(e) => setMaxSigma(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: 'white',
                  borderRadius: '0px',
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#22c55e',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#22c55e',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                  '&.Mui-focused': {
                    color: '#22c55e',
                  },
                },
              }}
            />
          </Grid>
        </Grid>
        <GradientButton
          onClick={generateHeatmaps}
          disabled={isLoading}
          startIcon={isLoading ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <AnalyticsIcon />}
          sx={{ px: 4, py: 1.5 }}
        >
          {isLoading ? 'Generating...' : 'Generate Heatmaps'}
        </GradientButton>
      </GlassCard>

      {/* Heatmap Results */}
      {heatmapData && (
        <Grid container spacing={4}>
          <Grid item xs={12} md={6}>
            <GlassCard sx={{ p: 4 }}>
              <Box display="flex" alignItems="center" gap={2} mb={3}>
                <TrendingUpIcon sx={{ color: '#22c55e', fontSize: 24 }} />
                <Typography variant="h6" fontWeight={600} color="white" sx={{ textTransform: 'uppercase' }}>
                  Call Option Price Heatmap
                </Typography>
              </Box>
              <Box
                sx={{
                  width: '100%',
                  height: 400,
                  background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(22, 163, 74, 0.1) 100%)',
                  border: '1px solid #22c55e',
                  borderRadius: '0px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body1" color="#22c55e" sx={{ textTransform: 'uppercase' }}>
                  Call Option Heatmap Visualization
                </Typography>
              </Box>
            </GlassCard>
          </Grid>
          <Grid item xs={12} md={6}>
            <GlassCard sx={{ p: 4 }}>
              <Box display="flex" alignItems="center" gap={2} mb={3}>
                <TrendingUpIcon sx={{ color: '#3b82f6', fontSize: 24 }} />
                <Typography variant="h6" fontWeight={600} color="white" sx={{ textTransform: 'uppercase' }}>
                  Put Option Price Heatmap
                </Typography>
              </Box>
              <Box
                sx={{
                  width: '100%',
                  height: 400,
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(29, 78, 216, 0.1) 100%)',
                  border: '1px solid #3b82f6',
                  borderRadius: '0px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body1" color="#3b82f6" sx={{ textTransform: 'uppercase' }}>
                  Put Option Heatmap Visualization
                </Typography>
              </Box>
            </GlassCard>
          </Grid>
        </Grid>
      )}

      {/* Info Section */}
      <GlassCard sx={{ p: 4, mt: 4 }}>
        <Typography variant="h6" fontWeight={600} color="white" mb={2} sx={{ textTransform: 'uppercase' }}>
          About Options Heatmaps
        </Typography>
        <Typography variant="body1" color="#9ca3af" sx={{ lineHeight: 1.6 }}>
          Options heatmaps provide a visual representation of how option prices change across different stock prices and volatility levels. 
          This tool helps traders and investors understand the sensitivity of option prices to underlying asset movements and market volatility.
        </Typography>
      </GlassCard>
    </Box>
  );
}
