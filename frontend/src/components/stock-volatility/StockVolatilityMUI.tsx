"use client";

import { useState } from "react";
import { TextField, Button, Autocomplete, Paper, Typography, Box } from "@mui/material";
import { useTimeFrame } from "@/contexts/TimeFrameContext";
import { GlassCard } from "@/components/mui/GlassCard";

const STOCK_TICKERS = [
  "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META",
  "NFLX", "NVDA", "SPY", "VTI", "MSCI", "BA", "GE",
  "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
];

export default function StockVolatilityMUI() {
  const [ticker, setTicker] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [volatility, setVolatility] = useState<number | null>(null);
  const { timeFrame } = useTimeFrame();

  const fetchVolatility = async () => {
    if (!ticker) return;

    setSelectedTicker(ticker);
    const mockVolatility = Math.random() * 0.5; // Simulated API call
    setVolatility(mockVolatility);
  };

  return (
    <GlassCard>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography variant="h5" component="h2" gutterBottom>
          Stock Volatility Analysis
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Autocomplete
            value={ticker}
            onChange={(_, newValue) => setTicker(newValue)}
            options={STOCK_TICKERS}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Stock Ticker Symbol"
                variant="outlined"
                fullWidth
              />
            )}
            sx={{ flexGrow: 1 }}
            freeSolo
            autoSelect
          />
          <Button 
            variant="contained" 
            onClick={fetchVolatility}
            disabled={!ticker}
            sx={{
              height: '56px',
              background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
              boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
            }}
          >
            Fetch Volatility
          </Button>
        </Box>

        {volatility !== null && selectedTicker && (
          <Paper 
            elevation={3}
            sx={{ 
              p: 3, 
              mt: 2,
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Typography variant="h6" gutterBottom>
              Analysis Results
            </Typography>
            <Typography variant="body1">
              Volatility for <strong>{selectedTicker}</strong> ({timeFrame}):
            </Typography>
            <Typography variant="h4" sx={{ mt: 1, color: 'primary.main' }}>
              {volatility.toFixed(4)}
            </Typography>
          </Paper>
        )}
      </Box>
    </GlassCard>
  );
}
