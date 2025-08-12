"use client";

import { useState } from "react";
import { 
  Box, 
  Typography, 
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from "@mui/material";
import GlassCard from "@/components/mui/GlassCard";
import MetricCard from "@/components/mui/MetricCard";

const CRYPTO_SYMBOLS = ["BTC", "ETH", "XRP", "LTC", "DOGE", "ADA", "SOL"];

interface CryptoStats {
  current_price: number;
  price_change_24h: number;
  annual_return: number;
  volatility: number;
}

export default function CryptoStatsMUI() {
  const [selectedCrypto, setSelectedCrypto] = useState<string>("BTC");
  const [stats, setStats] = useState<CryptoStats | null>(null);

  const fetchCryptoStats = async () => {
    // TODO: Implement actual API call
    const mockStats: CryptoStats = {
      current_price: Math.random() * 50000,
      price_change_24h: (Math.random() - 0.5) * 10,
      annual_return: (Math.random() - 0.5) * 100,
      volatility: Math.random() * 50,
    };
    setStats(mockStats);
  };

  const handleCryptoChange = (value: string) => {
    setSelectedCrypto(value);
    fetchCryptoStats();
  };

  return (
    <GlassCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Cryptocurrency Analysis
        </Typography>

        <FormControl sx={{ mt: 2, minWidth: 200 }}>
          <InputLabel id="crypto-select-label">Select Cryptocurrency</InputLabel>
          <Select
            labelId="crypto-select-label"
            value={selectedCrypto}
            label="Select Cryptocurrency"
            onChange={(e) => handleCryptoChange(e.target.value)}
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(10px)'
            }}
          >
            {CRYPTO_SYMBOLS.map((symbol) => (
              <MenuItem key={symbol} value={symbol}>
                {symbol}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {stats && (
          <Grid container spacing={3} sx={{ mt: 2 }}>
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
        )}
      </Box>
    </GlassCard>
  );
}
