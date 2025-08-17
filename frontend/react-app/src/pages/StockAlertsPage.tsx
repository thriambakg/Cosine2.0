import React, { useState } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,

  Card,
  CardContent,
  Container,
  IconButton,
} from '@mui/material';
import { 
  Add as AddIcon, 
  Delete as DeleteIcon,
  NotificationsActive as AlertIcon 
} from '@mui/icons-material';

interface Alert {
  email: string;
  ticker: string;
  price_threshold: number;
  current_price: number;
  comparison_mode: string;
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

const StockAlertsPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [ticker, setTicker] = useState('');
  const [priceThreshold, setPriceThreshold] = useState('');
  const [comparisonMode, setComparisonMode] = useState('Greater Than');
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const addAlert = async () => {
    if (!email || !ticker || !priceThreshold) return;
    
    // TODO: Implement actual alert setting using an API
    const newAlert: Alert = {
      email,
      ticker,
      price_threshold: parseFloat(priceThreshold),
      current_price: Math.random() * 1000 + 100,
      comparison_mode: comparisonMode
    };
    setAlerts([...alerts, newAlert]);
    
    // Reset form
    setEmail('');
    setTicker('');
    setPriceThreshold('');
    setComparisonMode('Greater Than');
  };

  const removeAlert = (index: number) => {
    setAlerts(alerts.filter((_, i) => i !== index));
  };

  const clearAlerts = () => {
    setAlerts([]);
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
            Stock Price Alerts
          </Typography>
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Set up email alerts for when stock prices reach your target thresholds
          </Typography>
        </Box>

        {/* Alert Creation Form */}
        <GlassCard sx={{ p: 4, mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #b91c1c',
              }}
            >
              <AlertIcon sx={{ color: 'white', fontSize: 24 }} />
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
              Create New Alert
            </Typography>
          </Box>

          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Stock Ticker Symbol"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Price Threshold"
                type="number"
                value={priceThreshold}
                onChange={(e) => setPriceThreshold(e.target.value)}
                placeholder="150.00"
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
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel sx={{ color: '#9ca3af' }}>Comparison Mode</InputLabel>
                <Select
                  value={comparisonMode}
                  label="Comparison Mode"
                  onChange={(e) => setComparisonMode(e.target.value)}
                  sx={{
                    color: 'white',
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: '#374151',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: '#3b82f6',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: '#3b82f6',
                    },
                    '& .MuiSelect-icon': {
                      color: '#9ca3af',
                    },
                  }}
                >
                  <MenuItem value="Greater Than" sx={{ color: '#1e293b' }}>Greater Than</MenuItem>
                  <MenuItem value="Less Than" sx={{ color: '#1e293b' }}>Less Than</MenuItem>
                  <MenuItem value="Equals" sx={{ color: '#1e293b' }}>Equals</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={addAlert}
              disabled={!email || !ticker || !priceThreshold}
              sx={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#ffffff',
                borderRadius: '0px',
                textTransform: 'uppercase',
                fontWeight: 700,
                border: '2px solid #22c55e',
                px: 4,
                py: 1.5,
                '&:hover': {
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  border: '2px solid #16a34a',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                },
                '&:disabled': {
                  background: 'rgba(34, 197, 94, 0.3)',
                  border: '2px solid rgba(34, 197, 94, 0.3)',
                }
              }}
            >
              Add Alert
            </Button>
            <Button
              variant="outlined"
              onClick={clearAlerts}
              disabled={alerts.length === 0}
              sx={{
                border: '2px solid #dc2626',
                color: '#dc2626',
                borderRadius: '0px',
                textTransform: 'uppercase',
                fontWeight: 700,
                px: 4,
                py: 1.5,
                '&:hover': {
                  border: '2px solid #b91c1c',
                  color: '#b91c1c',
                  backgroundColor: 'rgba(220, 38, 38, 0.1)',
                },
                '&:disabled': {
                  border: '2px solid rgba(220, 38, 38, 0.3)',
                  color: 'rgba(220, 38, 38, 0.3)',
                }
              }}
            >
              Clear All
            </Button>
          </Box>
        </GlassCard>

        {/* Alerts Table */}
        {alerts.length > 0 && (
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
              Active Alerts ({alerts.length})
            </Typography>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Email</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Ticker</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Threshold</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Current Price</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Condition</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {alerts.map((alert, index) => (
                    <TableRow key={index} sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.02)' } }}>
                      <TableCell sx={{ color: '#ffffff' }}>{alert.email}</TableCell>
                      <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>{alert.ticker}</TableCell>
                      <TableCell sx={{ color: '#ffffff' }}>${alert.price_threshold.toFixed(2)}</TableCell>
                      <TableCell sx={{ color: '#ffffff' }}>${alert.current_price.toFixed(2)}</TableCell>
                      <TableCell sx={{ color: '#9ca3af' }}>{alert.comparison_mode}</TableCell>
                      <TableCell>
                        <IconButton
                          onClick={() => removeAlert(index)}
                          sx={{
                            color: '#dc2626',
                            '&:hover': {
                              backgroundColor: 'rgba(220, 38, 38, 0.1)',
                            }
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default StockAlertsPage;
