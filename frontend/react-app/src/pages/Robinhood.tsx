import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Button,
  Alert,
  Paper,
  CircularProgress,
  Chip,
  Avatar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance as BankIcon,
  Security as ShieldIcon,
  CheckCircle,
  Link as LinkIcon,
  Refresh,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

interface RobinhoodData {
  accountValue: number;
  dayChange: number;
  dayChangePercent: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    currentPrice: number;
    totalValue: number;
    dayChange: number;
    dayChangePercent: number;
  }>;
  isConnected: boolean;
  lastUpdated: string;
}

export default function Robinhood() {
  const { user } = useAuth();
  const [rhData, setRhData] = useState<RobinhoodData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock successful connection
      setConnectionStatus('connected');
      setRhData({
        accountValue: 25680.45,
        dayChange: 320.15,
        dayChangePercent: 1.26,
        positions: [
          {
            symbol: 'AAPL',
            quantity: 10,
            currentPrice: 175.50,
            totalValue: 1755.00,
            dayChange: 2.30,
            dayChangePercent: 1.33
          },
          {
            symbol: 'TSLA',
            quantity: 5,
            currentPrice: 240.80,
            totalValue: 1204.00,
            dayChange: -8.20,
            dayChangePercent: -3.29
          },
          {
            symbol: 'MSFT',
            quantity: 8,
            currentPrice: 380.25,
            totalValue: 3042.00,
            dayChange: 5.75,
            dayChangePercent: 1.54
          },
          {
            symbol: 'GOOGL',
            quantity: 3,
            currentPrice: 142.80,
            totalValue: 428.40,
            dayChange: -1.20,
            dayChangePercent: -0.83
          }
        ],
        isConnected: true,
        lastUpdated: new Date().toISOString()
      });
    } catch (err) {
      setError('Failed to connect to Robinhood. Please try again.');
      setConnectionStatus('error');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      // Simulate refresh
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (rhData) {
        setRhData({
          ...rhData,
          lastUpdated: new Date().toISOString(),
          dayChange: rhData.dayChange + (Math.random() - 0.5) * 100,
          dayChangePercent: rhData.dayChangePercent + (Math.random() - 0.5) * 2,
        });
      }
    } catch (err) {
      setError('Failed to refresh data.');
    } finally {
      setIsLoading(false);
    }
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
          Robinhood Integration
        </Typography>
        <Typography 
          variant="body1" 
          sx={{ 
            color: '#9ca3af',
            fontSize: '1rem',
          }}
        >
          Connect your Robinhood account to get real-time portfolio insights and AI-powered analysis
        </Typography>
      </Box>

      {connectionStatus === 'disconnected' && (
        <Paper
          sx={{
            p: 4,
            textAlign: 'center',
            mb: 4,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid #374151',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          <Avatar
            sx={{
              width: 80,
              height: 80,
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              mx: 'auto',
              mb: 3,
              border: '2px solid #374151',
            }}
          >
            <BankIcon sx={{ fontSize: 40, color: '#ffffff' }} />
          </Avatar>
          
          <Typography 
            variant="h5" 
            sx={{ 
              color: '#ffffff', 
              fontWeight: 600, 
              mb: 2,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Connect Your Robinhood Account
          </Typography>
          
          <Typography 
            variant="body1" 
            sx={{ 
              color: '#9ca3af', 
              mb: 3, 
              maxWidth: 600, 
              mx: 'auto',
              fontSize: '1rem',
            }}
          >
            Securely link your Robinhood account to access real-time portfolio data, 
            get AI-powered insights, and make more informed trading decisions.
          </Typography>

          <Box display="flex" justifyContent="center" gap={3} mb={4}>
            <Box display="flex" alignItems="center" gap={1}>
              <ShieldIcon sx={{ color: '#22c55e', fontSize: 20 }} />
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Bank-level security
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <CheckCircle sx={{ color: '#22c55e', fontSize: 20 }} />
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Real-time data
              </Typography>
            </Box>
          </Box>

          <Button
            variant="contained"
            size="large"
            onClick={handleConnect}
            disabled={isConnecting}
            startIcon={isConnecting ? <CircularProgress size={16} /> : <LinkIcon />}
            sx={{
              px: 4,
              py: 1.5,
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
            {isConnecting ? 'Connecting...' : 'Connect Robinhood'}
          </Button>

          {error && (
            <Alert 
              severity="error" 
              sx={{ 
                mt: 3, 
                maxWidth: 400, 
                mx: 'auto',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
              }}
            >
              {error}
            </Alert>
          )}
        </Paper>
      )}

      {connectionStatus === 'connected' && rhData && (
        <>
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
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
              <Typography 
                variant="h6" 
                sx={{ 
                  color: '#ffffff', 
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Portfolio Overview
              </Typography>
              <Box display="flex" alignItems="center" gap={2}>
                <Chip
                  icon={<CheckCircle />}
                  label="Connected"
                  sx={{
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                    color: '#22c55e',
                    fontWeight: 600,
                  }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleRefresh}
                  disabled={isLoading}
                  startIcon={isLoading ? <CircularProgress size={16} /> : <Refresh />}
                  sx={{
                    borderColor: '#3b82f6',
                    color: '#3b82f6',
                    '&:hover': {
                      borderColor: '#2563eb',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Refresh
                </Button>
              </Box>
            </Box>

            <Grid container spacing={3} mb={3}>
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
                    Total Value
                  </Typography>
                  <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 700 }}>
                    ${rhData.accountValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Typography>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  sx={{
                    p: 3,
                    backgroundColor: rhData.dayChange >= 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${rhData.dayChange >= 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                    borderRadius: '8px',
                    textAlign: 'center',
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Day Change
                  </Typography>
                  <Typography variant="h5" sx={{ color: rhData.dayChange >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                    ${rhData.dayChange >= 0 ? '+' : ''}${rhData.dayChange.toFixed(2)}
                  </Typography>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  sx={{
                    p: 3,
                    backgroundColor: rhData.dayChangePercent >= 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${rhData.dayChangePercent >= 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                    borderRadius: '8px',
                    textAlign: 'center',
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Day Change %
                  </Typography>
                  <Typography variant="h5" sx={{ color: rhData.dayChangePercent >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                    {rhData.dayChangePercent >= 0 ? '+' : ''}{rhData.dayChangePercent.toFixed(2)}%
                  </Typography>
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
                    Positions
                  </Typography>
                  <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 700 }}>
                    {rhData.positions.length}
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              Last updated: {new Date(rhData.lastUpdated).toLocaleString()}
            </Typography>
          </Paper>

          {/* Positions Table */}
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
              Current Positions
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
                    <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Symbol</TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Quantity</TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Current Price</TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Total Value</TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Day Change</TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Day Change %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rhData.positions.map((position) => (
                    <TableRow 
                      key={position.symbol}
                      sx={{
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        },
                      }}
                    >
                      <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>
                        {position.symbol}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#9ca3af' }}>
                        {position.quantity.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#9ca3af' }}>
                        ${position.currentPrice.toFixed(2)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>
                        ${position.totalValue.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: position.dayChange >= 0 ? '#22c55e' : '#ef4444' }}>
                        {position.dayChange >= 0 ? '+' : ''}${position.dayChange.toFixed(2)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: position.dayChangePercent >= 0 ? '#22c55e' : '#ef4444' }}>
                        {position.dayChangePercent >= 0 ? '+' : ''}{position.dayChangePercent.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}

      {error && connectionStatus === 'error' && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 4,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
          }}
          action={
            <Button 
              color="inherit" 
              size="small" 
              onClick={handleConnect}
              sx={{ color: '#ef4444' }}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </Box>
  );
}
