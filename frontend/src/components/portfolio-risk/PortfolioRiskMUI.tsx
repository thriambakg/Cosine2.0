"use client";

import { useState } from 'react';
import { 
  TextField, 
  Button, 
  Box, 
  Typography, 
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import CalculateIcon from '@mui/icons-material/Calculate';
import { useTimeFrame } from '@/contexts/TimeFrameContext';
import { GlassCard } from '@/components/mui/GlassCard';
import { MetricCard } from '@/components/mui/MetricCard';

interface PortfolioEntry {
  stock: string;
  shares: number;
}

interface PortfolioResults {
  total_portfolio_value: number;
  portfolio_expected_return: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  stock_details: {
    [key: string]: {
      weight: number;
      annual_return: number;
      annual_volatility: number;
      shares: number;
      current_price: number;
      total_value: number;
    }
  }
}

export default function PortfolioRiskMUI() {
  const [entries, setEntries] = useState<PortfolioEntry[]>([{ stock: '', shares: 0 }]);
  const [results, setResults] = useState<PortfolioResults | null>(null);
  const { timeFrame } = useTimeFrame();

  const addEntry = () => {
    setEntries([...entries, { stock: '', shares: 0 }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof PortfolioEntry, value: string | number) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntries(newEntries);
  };

  const calculateRisk = async () => {
    // TODO: Implement actual risk calculation using an API
    const mockResults: PortfolioResults = {
      total_portfolio_value: 100000,
      portfolio_expected_return: 8.5,
      portfolio_volatility: 15.2,
      sharpe_ratio: 0.56,
      stock_details: entries.reduce((acc, entry) => {
        acc[entry.stock] = {
          weight: Math.random(),
          annual_return: Math.random() * 20,
          annual_volatility: Math.random() * 30,
          shares: entry.shares,
          current_price: Math.random() * 1000,
          total_value: entry.shares * (Math.random() * 1000)
        };
        return acc;
      }, {} as PortfolioResults['stock_details'])
    };
    setResults(mockResults);
  };

  return (
    <GlassCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Portfolio Risk Analysis
        </Typography>

        <Box sx={{ mt: 3 }}>
          {entries.map((entry, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
              <TextField
                label="Stock Ticker"
                value={entry.stock}
                onChange={(e) => updateEntry(index, 'stock', e.target.value)}
                sx={{ flexGrow: 1 }}
              />
              <TextField
                type="number"
                label="Number of Shares"
                value={entry.shares}
                onChange={(e) => updateEntry(index, 'shares', parseFloat(e.target.value))}
                sx={{ flexGrow: 1 }}
              />
              <IconButton 
                color="error" 
                onClick={() => removeEntry(index)}
                disabled={entries.length === 1}
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          ))}

          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={addEntry}
            >
              Add Stock
            </Button>
            <Button
              variant="contained"
              startIcon={<CalculateIcon />}
              onClick={calculateRisk}
              sx={{
                background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
              }}
            >
              Calculate Risk
            </Button>
          </Box>
        </Box>

        {results && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              Portfolio Results ({timeFrame})
            </Typography>

            <Grid container spacing={3} sx={{ mb: 4 }}>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Total Portfolio Value"
                  value={`$${results.total_portfolio_value.toFixed(2)}`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Expected Annual Return"
                  value={`${results.portfolio_expected_return.toFixed(2)}%`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Portfolio Volatility"
                  value={`${results.portfolio_volatility.toFixed(2)}%`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Sharpe Ratio"
                  value={results.sharpe_ratio.toFixed(2)}
                />
              </Grid>
            </Grid>

            <Typography variant="h6" gutterBottom sx={{ mt: 4, mb: 2 }}>
              Individual Stock Details
            </Typography>

            <TableContainer component={Paper} sx={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(10px)'
            }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Stock</TableCell>
                    <TableCell align="right">Weight</TableCell>
                    <TableCell align="right">Annual Return</TableCell>
                    <TableCell align="right">Annual Volatility</TableCell>
                    <TableCell align="right">Shares</TableCell>
                    <TableCell align="right">Current Price</TableCell>
                    <TableCell align="right">Total Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(results.stock_details).map(([stock, details]) => (
                    <TableRow key={stock}>
                      <TableCell component="th" scope="row">{stock}</TableCell>
                      <TableCell align="right">{(details.weight * 100).toFixed(2)}%</TableCell>
                      <TableCell align="right">{details.annual_return.toFixed(2)}%</TableCell>
                      <TableCell align="right">{details.annual_volatility.toFixed(2)}%</TableCell>
                      <TableCell align="right">{details.shares}</TableCell>
                      <TableCell align="right">${details.current_price.toFixed(2)}</TableCell>
                      <TableCell align="right">${details.total_value.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>
    </GlassCard>
  );
}
