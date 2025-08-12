"use client";

import { useState } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Grid,
  useTheme
} from '@mui/material';
import { Calculate as CalculateIcon } from '@mui/icons-material';
import { GlassCard } from '@/components/mui/GlassCard';
import { MetricCard } from '@/components/mui/MetricCard';

interface OptionPrices {
  call: number;
  put: number;
}

export default function OptionPricingMUI() {
  const theme = useTheme();
  const [S, setS] = useState('100');
  const [K, setK] = useState('110');
  const [T, setT] = useState('1');
  const [r, setR] = useState('0.05');
  const [sigma, setSigma] = useState('0.2');
  const [prices, setPrices] = useState<OptionPrices | null>(null);

  const calculatePrices = async () => {
    // TODO: Implement actual Black-Scholes calculation using an API
    const mockPrices: OptionPrices = {
      call: Math.random() * 10,
      put: Math.random() * 10
    };
    setPrices(mockPrices);
  };

  return (
    <GlassCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Option Pricing Calculator
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Calculate option prices using the Black-Scholes model
        </Typography>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={4}>
            <TextField
              fullWidth
              label="Current Stock Price (S)"
              type="number"
              value={S}
              onChange={(e) => setS(e.target.value)}
              placeholder="100"
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
            />
          </Grid>
        </Grid>

        <Button
          variant="contained"
          startIcon={<CalculateIcon />}
          onClick={calculatePrices}
          sx={{
            mb: 3,
            background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
          }}
        >
          Calculate Option Prices
        </Button>

        {prices && (
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
        )}
      </Box>
    </GlassCard>
  );
}
