import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Container,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Snackbar,
} from '@mui/material';
import { AttachMoney as MoneyIcon, TrendingUp as TrendingUpIcon, Refresh as RefreshIcon, Download as DownloadIcon } from '@mui/icons-material';
import { api } from '../services/api';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Initialize Stripe (you'll need to add your Stripe publishable key to environment)
// Vite uses VITE_ prefix for environment variables
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

interface MonthlySpending {
  month: string;
  start_date: string;
  end_date: string;
  blended_cost: string;
  unblended_cost: string;
  usage_quantity: string;
  total_earnings?: string;
  payment_count?: string;
  currency: string;
  updated_at: string;
}

interface MonthlyEarnings {
  month: string;
  total_earnings: string;
  payment_count: string;
  currency: string;
  updated_at: string;
}

// Payment Form Component
const PaymentForm: React.FC<{ amount: number; onSuccess: () => void; onError: (error: string) => void }> = ({ amount, onSuccess, onError }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);

    try {
      // Create payment intent
      const response = await api.billing.createPaymentIntent(amount);
      
      if (!response.success || !response.payment_intent) {
        throw new Error('Failed to create payment intent');
      }

      // Confirm payment with Stripe
      const { error, paymentIntent } = await stripe.confirmCardPayment(
        response.payment_intent.client_secret,
        {
          payment_method: {
            card: elements.getElement(CardElement)!,
          },
        }
      );

      if (error) {
        onError(error.message || 'Payment failed');
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess();
      }
    } catch (error: any) {
      onError(error.message || 'Payment processing failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Box sx={{ mb: 2 }}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#e5e7eb',
                '::placeholder': {
                  color: '#9ca3af',
                },
              },
              invalid: {
                color: '#ef4444',
              },
            },
          }}
        />
      </Box>
      <Button
        type="submit"
        fullWidth
        variant="outlined"
        disabled={!stripe || processing}
        sx={{
          borderColor: '#374151',
          color: '#e5e7eb',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          '&:hover': {
            borderColor: '#4b5563',
            backgroundColor: 'rgba(15, 23, 42, 1)',
          },
          '&:disabled': {
            borderColor: '#374151',
            color: '#6b7280',
          },
        }}
      >
        {processing ? <CircularProgress size={24} sx={{ color: '#9ca3af' }} /> : `Donate $${amount.toFixed(2)}`}
      </Button>
    </form>
  );
};

const SupportMePage: React.FC = () => {
  const [currentSpending, setCurrentSpending] = useState<number>(0);
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpending[]>([]);
  const [totalRaised, setTotalRaised] = useState<number>(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState<MonthlyEarnings[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<Array<{ month: string; year: string; month_num: string; s3_key: string; filename: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [donationAmount, setDonationAmount] = useState<string>('10');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    // Prevent duplicate calls in React Strict Mode
    if (hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    loadData();
  }, []);

  const loadData = async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      
      // Fetch spending data
      const spendingResponse = await api.billing.getSpendingSummary();
      if (spendingResponse.success) {
        setCurrentSpending(spendingResponse.current_month_total);
        setMonthlySpending(spendingResponse.monthly_data || []);
      }

      // Fetch earnings data (current month)
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
      const earningsResponse = await api.billing.getEarningsSummary(currentMonth);
      if (earningsResponse.success) {
        setTotalRaised(earningsResponse.current_month_total);
        setMonthlyEarnings(earningsResponse.monthly_earnings || []);
      }

      // Fetch monthly reports list
      const reportsResponse = await api.billing.listMonthlyReports();
      if (reportsResponse.success) {
        setMonthlyReports(reportsResponse.reports || []);
      }
    } catch (error: any) {
      console.error('Error loading billing data:', error);
      setSnackbar({
        open: true,
        message: 'Failed to load billing data',
        severity: 'error',
      });
    } finally {
      if (!isRefresh) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  const handleDonateClick = () => {
    const amount = parseFloat(donationAmount);
    if (isNaN(amount) || amount <= 0) {
      setSnackbar({
        open: true,
        message: 'Please enter a valid donation amount',
        severity: 'error',
      });
      return;
    }
    setShowPaymentForm(true);
  };

  const handlePaymentSuccess = () => {
    setSnackbar({
      open: true,
      message: 'Thank you for your donation!',
      severity: 'success',
    });
    setShowPaymentForm(false);
    setDonationAmount('10');
    // Reload earnings data
    loadData();
  };

  const handlePaymentError = (error: string) => {
    setSnackbar({
      open: true,
      message: error,
      severity: 'error',
    });
  };

  const handleDownloadReport = async (month: string) => {
    try {
      const response = await api.billing.getMonthlyReportDownloadUrl(month);
      if (response.success && response.presigned_url) {
        // Open download URL in new window/tab
        window.open(response.presigned_url, '_blank');
        setSnackbar({
          open: true,
          message: `Downloading report for ${month}`,
          severity: 'success',
        });
      } else {
        throw new Error('Failed to generate download URL');
      }
    } catch (error: any) {
      console.error('Error downloading report:', error);
      setSnackbar({
        open: true,
        message: error.message || 'Failed to download report',
        severity: 'error',
      });
    }
  };

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(num);
  };

  if (loading) {
    return (
      <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <CircularProgress sx={{ color: '#3b82f6' }} />
          </Box>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Current Month Spending - Big Number */}
      <Card
        sx={{
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          borderRadius: '0px',
          mb: 4,
          p: 4,
        }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ color: '#9ca3af' }}>
              Current Month Spending
            </Typography>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => loadData(true)}
              disabled={refreshing}
              sx={{
                borderColor: '#374151',
                color: '#9ca3af',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderColor: '#475569',
                },
              }}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Box>
          <Typography
            variant="h2"
            sx={{
              color: '#3b82f6',
              textAlign: 'center',
              fontWeight: 'bold',
              fontSize: { xs: '3rem', md: '4rem' },
            }}
          >
            {formatCurrency(currentSpending)}
          </Typography>
        </CardContent>
      </Card>

      {/* Monthly Spending Table */}
      <Card
        sx={{
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          borderRadius: '0px',
          mb: 4,
        }}
      >
        <CardContent>
          <Typography variant="h6" sx={{ color: '#e5e7eb', mb: 2 }}>
            Monthly Spending History
          </Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', borderColor: '#374151' }}>Month</TableCell>
                  <TableCell align="right" sx={{ color: '#9ca3af', borderColor: '#374151' }}>Blended Cost</TableCell>
                  <TableCell align="right" sx={{ color: '#9ca3af', borderColor: '#374151' }}>Unblended Cost</TableCell>
                  <TableCell align="right" sx={{ color: '#9ca3af', borderColor: '#374151' }}>Usage Quantity</TableCell>
                  <TableCell align="right" sx={{ color: '#9ca3af', borderColor: '#374151' }}>Earnings</TableCell>
                  <TableCell align="center" sx={{ color: '#9ca3af', borderColor: '#374151' }}>Report</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthlySpending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ color: '#9ca3af', borderColor: '#374151' }}>
                      No spending data available
                    </TableCell>
                  </TableRow>
                ) : (
                  monthlySpending
                    .sort((a, b) => b.month.localeCompare(a.month))
                    .map((row) => {
                      const reportExists = monthlyReports.some(r => r.month === row.month);
                      const earnings = row.total_earnings ? parseFloat(row.total_earnings) : 0;
                      return (
                        <TableRow key={row.month}>
                          <TableCell sx={{ color: '#e5e7eb', borderColor: '#374151' }}>{row.month}</TableCell>
                          <TableCell align="right" sx={{ color: '#e5e7eb', borderColor: '#374151' }}>
                            {formatCurrency(row.blended_cost)}
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#e5e7eb', borderColor: '#374151' }}>
                            {formatCurrency(row.unblended_cost)}
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#e5e7eb', borderColor: '#374151' }}>
                            {parseFloat(row.usage_quantity).toFixed(2)}
                          </TableCell>
                          <TableCell align="right" sx={{ color: earnings > 0 ? '#10b981' : '#6b7280', borderColor: '#374151' }}>
                            {formatCurrency(earnings)}
                          </TableCell>
                          <TableCell align="center" sx={{ color: '#e5e7eb', borderColor: '#374151' }}>
                            {reportExists ? (
                              <Button
                                size="small"
                                startIcon={<DownloadIcon />}
                                onClick={() => handleDownloadReport(row.month)}
                                sx={{
                                  color: '#3b82f6',
                                  borderColor: '#3b82f6',
                                  '&:hover': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                    borderColor: '#2563eb',
                                  },
                                }}
                                variant="outlined"
                              >
                                Download
                              </Button>
                            ) : (
                              <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                Not available
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Donation Section */}
      <Card
        sx={{
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          borderRadius: '0px',
        }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <MoneyIcon sx={{ color: '#10b981', mr: 1, fontSize: '2rem' }} />
              <Typography variant="h5" sx={{ color: '#e5e7eb' }}>
                Total Raised This Month: {formatCurrency(totalRaised)}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => loadData(true)}
              disabled={refreshing}
              sx={{
                borderColor: '#374151',
                color: '#9ca3af',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                '&:hover': {
                  borderColor: '#4b5563',
                  backgroundColor: 'rgba(15, 23, 42, 1)',
                },
                '&:disabled': {
                  borderColor: '#374151',
                  color: '#6b7280',
                },
              }}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Box>

          {!showPaymentForm ? (
            <Box>
              <TextField
                fullWidth
                label="Donation Amount"
                type="number"
                value={donationAmount}
                onChange={(e) => setDonationAmount(e.target.value)}
                InputProps={{
                  startAdornment: <Typography sx={{ color: '#9ca3af', mr: 1 }}>$</Typography>,
                }}
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    color: '#e5e7eb',
                    '& fieldset': {
                      borderColor: '#374151',
                    },
                    '&:hover fieldset': {
                      borderColor: '#4b5563',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#3b82f6',
                    },
                  },
                  '& .MuiInputLabel-root': {
                    color: '#9ca3af',
                  },
                }}
              />
              <Button
                fullWidth
                variant="outlined"
                onClick={handleDonateClick}
                sx={{
                  borderColor: '#374151',
                  color: '#e5e7eb',
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  '&:hover': {
                    borderColor: '#4b5563',
                    backgroundColor: 'rgba(15, 23, 42, 1)',
                  },
                }}
              >
                Donate
              </Button>
            </Box>
          ) : stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                appearance: {
                  theme: 'dark',
                  variables: {
                    colorPrimary: '#3b82f6',
                    colorBackground: '#0f172a',
                    colorText: '#e5e7eb',
                    colorDanger: '#ef4444',
                    fontFamily: 'system-ui, sans-serif',
                    spacingUnit: '4px',
                    borderRadius: '0px',
                  },
                },
              } as StripeElementsOptions}
            >
              <PaymentForm
                amount={parseFloat(donationAmount)}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
              <Button
                fullWidth
                variant="text"
                onClick={() => setShowPaymentForm(false)}
                sx={{
                  mt: 2,
                  color: '#9ca3af',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                Cancel
              </Button>
            </Elements>
          ) : (
            <Alert severity="warning" sx={{ backgroundColor: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', borderColor: '#fbbf24' }}>
              Stripe payment processing is not configured. Please set REACT_APP_STRIPE_PUBLISHABLE_KEY in your environment.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{
            backgroundColor: snackbar.severity === 'success' ? '#10b981' : '#ef4444',
            color: '#ffffff',
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      </Container>
    </Box>
  );
};

export default SupportMePage;

