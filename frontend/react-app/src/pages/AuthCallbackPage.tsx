import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Box, Typography, CircularProgress, Container } from '@mui/material';


const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading, authError } = useAuth();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    // Handle OAuth callback
    const handleCallback = async () => {
      try {
        console.log('🔄 AuthCallbackPage: Processing callback...');
        console.log('📊 AuthCallbackPage: user:', user, 'isLoading:', isLoading, 'attempts:', attempts);
        
        // Wait for auth to process the callback
        if (!isLoading) {
          if (user) {
            console.log('✅ AuthCallbackPage: User authenticated, redirecting to dashboard');
            // Successful authentication - redirect to dashboard (home page)
            navigate('/', { replace: true });
          } else if (attempts < 5) {
            console.log(`🔄 AuthCallbackPage: No user yet, attempt ${attempts + 1}/5`);
            // Try again after a delay
            setAttempts(prev => prev + 1);
            setTimeout(() => {
              // Force a re-check of auth state
              window.location.reload();
            }, 2000);
          } else {
            console.log('❌ AuthCallbackPage: Authentication failed after multiple attempts');
            // Authentication failed after multiple attempts - redirect to home with error
            navigate('/?error=authentication_failed', { replace: true });
          }
        }
             } catch (error) {
         console.error('❌ AuthCallbackPage: Callback error:', error);
         navigate('/?error=callback_error', { replace: true });
       }
    };

    handleCallback();
  }, [user, isLoading, navigate, attempts]);

  // Show error if authentication failed
  if (authError) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: 2,
          p: 3,
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid #dc2626',
          borderRadius: '0px'
        }}>
          <Typography variant="h6" sx={{ color: '#dc2626', fontWeight: 600 }}>
            Authentication Error
          </Typography>
          <Typography variant="body2" sx={{ color: '#fca5a5', textAlign: 'center' }}>
            {authError}
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af', textAlign: 'center' }}>
            Redirecting to login page...
          </Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        gap: 2,
        p: 3,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '0px'
      }}>
        <CircularProgress sx={{ color: '#dc2626' }} />
        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
          Completing Authentication
        </Typography>
        <Typography variant="body2" sx={{ color: '#e2e8f0', textAlign: 'center' }}>
          Please wait while we process your login
        </Typography>
        {attempts > 0 && (
          <Typography variant="caption" sx={{ color: '#9ca3af', textAlign: 'center' }}>
            Attempt {attempts}/5 - Processing...
          </Typography>
        )}
      </Box>
    </Container>
  );
};

export default AuthCallbackPage;
