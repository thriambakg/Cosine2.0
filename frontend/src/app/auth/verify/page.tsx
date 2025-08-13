"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { CheckCircle, Error } from '@mui/icons-material';

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Check if verification was successful
    // Cognito redirect includes success/error parameters
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setStatus('error');
      setMessage(errorDescription || 'Email verification failed. Please try again.');
    } else if (code) {
      setStatus('success');
      setMessage('Your email has been verified successfully! You can now sign in to your account.');
    } else {
      // Check for other success indicators
      setStatus('success');
      setMessage('Your email has been verified successfully! You can now sign in to your account.');
    }
  }, [searchParams]);

  const handleContinue = () => {
    router.push('/');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #581c87 50%, #3730a3 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
      }}
    >
      <Box
        sx={{
          maxWidth: 480,
          width: '100%',
          backgroundColor: 'white',
          borderRadius: 3,
          padding: 6,
          textAlign: 'center',
          boxShadow: 3,
        }}
      >
        {status === 'loading' && (
          <>
            <CircularProgress size={60} sx={{ color: 'primary.main', mb: 3 }} />
            <Typography variant="h5" fontWeight="bold" gutterBottom>
              Verifying your email...
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Please wait while we confirm your email address.
            </Typography>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle sx={{ fontSize: 60, color: 'success.main', mb: 3 }} />
            <Typography variant="h5" fontWeight="bold" gutterBottom>
              Email Verified!
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              {message}
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handleContinue}
              sx={{
                background: 'linear-gradient(135deg, #1e3a8a, #3730a3)',
                px: 4,
                py: 1.5,
              }}
            >
              Continue to Sign In
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <Error sx={{ fontSize: 60, color: 'error.main', mb: 3 }} />
            <Typography variant="h5" fontWeight="bold" gutterBottom>
              Verification Failed
            </Typography>
            <Alert severity="error" sx={{ mb: 4, textAlign: 'left' }}>
              {message}
            </Alert>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button
                variant="outlined"
                onClick={handleContinue}
              >
                Back to Home
              </Button>
              <Button
                variant="contained"
                onClick={() => window.location.reload()}
                sx={{
                  background: 'linear-gradient(135deg, #1e3a8a, #3730a3)',
                }}
              >
                Try Again
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
