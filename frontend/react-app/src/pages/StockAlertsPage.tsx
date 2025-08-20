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
  Alert,
} from '@mui/material';
import { 
  Add as AddIcon, 
  Delete as DeleteIcon,
  NotificationsActive as AlertIcon 
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { stockAlertsAPI, StockAlertRequest } from '../services/api';

interface Alert {
  alertId: string;
  ticker: string;
  price_threshold: number;
  current_price: number;
  comparison_mode: string;
  status: 'active' | 'triggered' | 'cancelled';
  createdAt: string;
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
  const { user } = useAuth();
  const [ticker, setTicker] = useState('');
  const [priceThreshold, setPriceThreshold] = useState('');
  const [comparisonMode, setComparisonMode] = useState('Greater Than');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user's existing alerts on component mount
  React.useEffect(() => {
    if (user?.id) {
      loadUserAlerts();
    }
  }, [user]);

  const loadUserAlerts = async () => {
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      const response = await stockAlertsAPI.getUserAlerts(user.id);
      
      // Convert API response to local Alert interface
      const convertedAlerts: Alert[] = response.alerts.map(apiAlert => ({
        alertId: apiAlert.alertId,
        ticker: apiAlert.triggerConditions.ticker,
        price_threshold: apiAlert.triggerConditions.threshold,
        current_price: 0, // Will be fetched separately if needed
        comparison_mode: apiAlert.triggerConditions.alertType === 'price_above' ? 'Greater Than' : 'Less Than',
        status: apiAlert.status,
        createdAt: apiAlert.createdAt
      }));
      
      setAlerts(convertedAlerts);
    } catch (err: any) {
      console.error('Error loading alerts:', err);
      
      // Handle 404 errors gracefully - treat as no alerts
      if (err.response?.status === 404 || err.message?.includes('User not found')) {
        console.log('User not found or no alerts - treating as empty list');
        setAlerts([]);
        setError(null); // Clear any previous errors
      } else {
        setError('Failed to load your alerts. Please refresh the page.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const addAlert = async () => {
    if (!user || !ticker || !priceThreshold) {
      setError('Please fill in all required fields');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Convert comparison mode to API format
      const alertType = comparisonMode === 'Greater Than' ? 'price_above' : 'price_below';
      
      const alertRequest: StockAlertRequest = {
        ticker: ticker.toUpperCase(),
        alertType: alertType as 'price_above' | 'price_below',
        threshold: parseFloat(priceThreshold),
        userId: user.id,
      };
      
      const response = await stockAlertsAPI.createAlert(alertRequest);
      
      const newAlert: Alert = {
        alertId: response.alertId,
        ticker: ticker.toUpperCase(),
        price_threshold: parseFloat(priceThreshold),
        current_price: 0, // Will be fetched from API
        comparison_mode: comparisonMode,
        status: response.status,
        createdAt: response.createdAt
      };
      
      setAlerts([...alerts, newAlert]);
      
      // Reset form
      setTicker('');
      setPriceThreshold('');
      setComparisonMode('Greater Than');
      
      // Clear any previous errors
      setError(null);
    } catch (err) {
      setError('Failed to create alert. Please try again.');
      console.error('Error creating alert:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const removeAlert = async (alertId: string) => {
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      await stockAlertsAPI.deleteAlert(user.id, alertId);
      setAlerts(alerts.filter(alert => alert.alertId !== alertId));
      setError(null);
    } catch (err: any) {
      // Handle 404 errors gracefully - alert might already be deleted
      if (err.response?.status === 404 || err.message?.includes('Alert not found') || err.message?.includes('User not found')) {
        console.log('Alert or user not found - removing from local state');
        setAlerts(alerts.filter(alert => alert.alertId !== alertId));
        setError(null);
      } else {
        setError('Failed to remove alert. Please try again.');
        console.error('Error removing alert:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const clearAlerts = async () => {
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      // Delete only active alerts
      const deletePromises = activeAlerts.map(alert => 
        stockAlertsAPI.deleteAlert(user.id, alert.alertId)
      );
      await Promise.all(deletePromises);
      setAlerts(triggeredAlerts); // Keep only triggered alerts
      setError(null);
    } catch (err: any) {
      // Handle 404 errors gracefully - some alerts might already be deleted
      if (err.response?.status === 404 || err.message?.includes('not found')) {
        console.log('Some alerts not found - clearing from local state');
        setAlerts(triggeredAlerts); // Keep only triggered alerts
        setError(null);
      } else {
        setError('Failed to clear alerts. Please try again.');
        console.error('Error clearing alerts:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Filter out triggered alerts for display
  const activeAlerts = alerts.filter(alert => alert.status === 'active');
  const triggeredAlerts = alerts.filter(alert => alert.status === 'triggered');

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
            Set up price alerts for when stock prices reach your target thresholds. Alerts will be sent to your registered email address.
          </Typography>
        </Box>

        {/* Authentication Check */}
        {!user && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="warning" sx={{ 
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid #f59e0b',
              color: '#f59e0b'
            }}>
              Please log in to create and manage stock alerts.
            </Alert>
          </GlassCard>
        )}

        {/* Error Display */}
        {error && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="error" sx={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              color: '#ef4444'
            }}>
              {error}
            </Alert>
          </GlassCard>
        )}

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
              disabled={!user || !ticker || !priceThreshold || isLoading}
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
              disabled={activeAlerts.length === 0}
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

        {/* Active Alerts Table */}
        {activeAlerts.length > 0 && (
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
              Your Active Alerts
            </Typography>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Ticker</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Threshold</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Current Price</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Condition</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Created</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeAlerts.map((alert) => (
                    <TableRow key={alert.alertId} sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.02)' } }}>
                      <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>{alert.ticker}</TableCell>
                      <TableCell sx={{ color: '#ffffff' }}>${alert.price_threshold.toFixed(2)}</TableCell>
                      <TableCell sx={{ color: '#ffffff' }}>${alert.current_price.toFixed(2)}</TableCell>
                      <TableCell sx={{ color: '#9ca3af' }}>{alert.comparison_mode}</TableCell>
                      <TableCell sx={{ color: '#9ca3af' }}>
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <IconButton
                          onClick={() => removeAlert(alert.alertId)}
                          disabled={isLoading}
                          sx={{
                            color: '#dc2626',
                            '&:hover': {
                              backgroundColor: 'rgba(220, 38, 38, 0.1)',
                            },
                            '&:disabled': {
                              color: 'rgba(220, 38, 38, 0.3)',
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

        {/* Triggered Alerts Table */}
        {triggeredAlerts.length > 0 && (
          <GlassCard sx={{ p: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography 
                variant="h6" 
                sx={{ 
                  color: '#ffffff', 
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Recently Triggered Alerts ({triggeredAlerts.length})
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  // Remove all triggered alerts
                  triggeredAlerts.forEach(alert => removeAlert(alert.alertId));
                }}
                disabled={isLoading}
                sx={{
                  border: '1px solid #f59e0b',
                  color: '#f59e0b',
                  fontSize: '0.75rem',
                  '&:hover': {
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  },
                  '&:disabled': {
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: 'rgba(245, 158, 11, 0.3)',
                  }
                }}
              >
                Clear All
              </Button>
            </Box>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Ticker</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Threshold</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Triggered At</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Condition</TableCell>
                    <TableCell sx={{ color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {triggeredAlerts.map((alert) => (
                    <TableRow key={alert.alertId} sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.02)' } }}>
                      <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>{alert.ticker}</TableCell>
                      <TableCell sx={{ color: '#ffffff' }}>${alert.price_threshold.toFixed(2)}</TableCell>
                      <TableCell sx={{ color: '#9ca3af' }}>
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell sx={{ color: '#9ca3af' }}>{alert.comparison_mode}</TableCell>
                      <TableCell>
                        <IconButton
                          onClick={() => removeAlert(alert.alertId)}
                          disabled={isLoading}
                          sx={{
                            color: '#dc2626',
                            '&:hover': {
                              backgroundColor: 'rgba(220, 38, 38, 0.1)',
                            },
                            '&:disabled': {
                              color: 'rgba(220, 38, 38, 0.3)',
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

        {/* No Alerts Message */}
        {alerts.length === 0 && user && (
          <GlassCard sx={{ p: 4, textAlign: 'center' }}>
            <Typography 
              variant="h6" 
              sx={{ 
                color: '#9ca3af', 
                fontWeight: 500,
                mb: 2,
              }}
            >
              No alerts configured yet
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                color: '#6b7280',
              }}
            >
              Create your first stock alert using the form above to get notified when prices reach your target levels
            </Typography>
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default StockAlertsPage;
