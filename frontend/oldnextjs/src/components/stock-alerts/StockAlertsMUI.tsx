"use client";

import { useState } from 'react';
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
  Paper,
  useTheme
} from '@mui/material';
import { 
  Add as AddIcon, 
  Delete as DeleteIcon,
  NotificationsActive as AlertIcon 
} from '@mui/icons-material';
import GlassCard from '@/components/mui/GlassCard';

interface Alert {
  email: string;
  ticker: string;
  price_threshold: number;
  current_price: number;
  comparison_mode: string;
}

export default function StockAlertsMUI() {
  const theme = useTheme();
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
      current_price: Math.random() * 1000,
      comparison_mode: comparisonMode
    };
    setAlerts([...alerts, newAlert]);
    
    // Reset form
    setEmail('');
    setTicker('');
    setPriceThreshold('');
    setComparisonMode('Greater Than');
  };

  const clearAlerts = () => {
    setAlerts([]);
  };

  return (
    <GlassCard>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <AlertIcon color="primary" />
          <Typography variant="h5">
            Stock Price Alerts
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Set up email alerts for when stock prices reach your target thresholds
        </Typography>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@example.com"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Stock Ticker Symbol"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Price Condition</InputLabel>
              <Select
                value={comparisonMode}
                label="Price Condition"
                onChange={(e) => setComparisonMode(e.target.value)}
              >
                <MenuItem value="Greater Than">Greater Than</MenuItem>
                <MenuItem value="Less Than">Less Than</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Price Threshold ($)"
              type="number"
              value={priceThreshold}
              onChange={(e) => setPriceThreshold(e.target.value)}
              placeholder="150.00"
            />
          </Grid>
        </Grid>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={addAlert}
          disabled={!email || !ticker || !priceThreshold}
          sx={{
            mb: 3,
            background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
          }}
        >
          Add Alert
        </Button>

        {alerts.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              Your Active Alerts ({alerts.length})
            </Typography>
            
            <TableContainer 
              component={Paper} 
              sx={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(10px)',
                mb: 2
              }}
            >
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Email</strong></TableCell>
                    <TableCell><strong>Stock</strong></TableCell>
                    <TableCell align="right"><strong>Alert Price</strong></TableCell>
                    <TableCell align="right"><strong>Current Price</strong></TableCell>
                    <TableCell><strong>Condition</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {alerts.map((alert, index) => (
                    <TableRow key={index}>
                      <TableCell>{alert.email}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="bold">
                          {alert.ticker}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        ${alert.price_threshold.toFixed(2)}
                      </TableCell>
                      <TableCell align="right">
                        ${alert.current_price.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Typography 
                          variant="body2" 
                          color={alert.comparison_mode === 'Greater Than' ? 'success.main' : 'error.main'}
                        >
                          {alert.comparison_mode}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={clearAlerts}
            >
              Clear All Alerts
            </Button>
          </Box>
        )}
      </Box>
    </GlassCard>
  );
}
