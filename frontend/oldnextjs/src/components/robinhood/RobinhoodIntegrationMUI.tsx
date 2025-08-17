"use client";

import React, { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Button,
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Chip,
  Avatar,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance as BankIcon,
  Security as ShieldIcon,
  CheckCircle,
  Link as LinkIcon,
  Refresh,
} from '@mui/icons-material';

import { useAuth } from '@/contexts/AuthContext';

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

export default function RobinhoodIntegrationMUI() {
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

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box mb={4}>
        <Typography variant="h4" fontWeight={600} color="text.primary" mb={2}>
          Robinhood Integration
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Connect your Robinhood account to get real-time portfolio insights and AI-powered analysis.
        </Typography>
      </Box>

      {connectionStatus === 'disconnected' && (
        <Card sx={{ p: 4, textAlign: 'center', mb: 4 }}>
          <Avatar
            sx={{
              width: 80,
              height: 80,
              bgcolor: 'primary.main',
              mx: 'auto',
              mb: 3
            }}
          >
            <BankIcon sx={{ fontSize: 40 }} />
          </Avatar>
          
          <Typography variant="h5" fontWeight={600} color="text.primary" mb={2}>
            Connect Your Robinhood Account
          </Typography>
          
          <Typography variant="body1" color="text.secondary" mb={3} maxWidth={600} mx="auto">
            Securely link your Robinhood account to access real-time portfolio data, 
            get AI-powered insights, and make more informed trading decisions.
          </Typography>

          <Box display="flex" justifyContent="center" gap={3} mb={4}>
            <Box display="flex" alignItems="center" gap={1}>
              <ShieldIcon sx={{ color: 'success.main', fontSize: 20 }} />
              <Typography variant="body2" color="text.secondary">
                Bank-level security
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} />
              <Typography variant="body2" color="text.secondary">
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
              background: 'linear-gradient(135deg, #00C851 0%, #007E33 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, #00A845 0%, #006B2C 100%)',
              }
            }}
          >
            {isConnecting ? 'Connecting...' : 'Connect Robinhood'}
          </Button>

          {error && (
            <Alert severity="error" sx={{ mt: 3, maxWidth: 400, mx: 'auto' }}>
              {error}
            </Alert>
          )}
        </Card>
      )}

      {connectionStatus === 'connected' && rhData && (
        <Card sx={{ p: 4 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h5" fontWeight={600} color="text.primary">
              Portfolio Overview
            </Typography>
            <Chip
              icon={<CheckCircle />}
              label="Connected"
              color="success"
              variant="outlined"
            />
          </Box>

          <Grid container spacing={3} mb={4}>
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, bgcolor: 'rgba(59, 130, 246, 0.1)' }}>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Total Value
                </Typography>
                <Typography variant="h5" fontWeight={600} color="text.primary">
                  ${rhData.accountValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Typography>
              </Card>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, bgcolor: rhData.dayChange >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Day Change
                </Typography>
                <Typography variant="h5" fontWeight={600} color={rhData.dayChange >= 0 ? 'success.main' : 'error.main'}>
                  ${rhData.dayChange >= 0 ? '+' : ''}${rhData.dayChange.toFixed(2)}
                </Typography>
              </Card>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, bgcolor: rhData.dayChangePercent >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Day Change %
                </Typography>
                <Typography variant="h5" fontWeight={600} color={rhData.dayChangePercent >= 0 ? 'success.main' : 'error.main'}>
                  {rhData.dayChangePercent >= 0 ? '+' : ''}{rhData.dayChangePercent.toFixed(2)}%
                </Typography>
              </Card>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, bgcolor: 'rgba(139, 92, 246, 0.1)' }}>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Positions
                </Typography>
                <Typography variant="h5" fontWeight={600} color="text.primary">
                  {rhData.positions.length}
                </Typography>
              </Card>
            </Grid>
          </Grid>

          <Typography variant="body2" color="text.secondary">
            Last updated: {new Date(rhData.lastUpdated).toLocaleString()}
          </Typography>
        </Card>
      )}

      {error && connectionStatus === 'error' && (
        <Alert 
          severity="error" 
          sx={{ mb: 4 }}
          action={
            <Button color="inherit" size="small" onClick={handleConnect}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </Container>
  );
}
