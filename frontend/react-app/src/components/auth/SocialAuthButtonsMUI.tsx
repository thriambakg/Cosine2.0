
import { useState } from 'react';
import { 
  Button, 
  Box, 
  Typography, 
  CircularProgress, 
  Alert,
  AlertTitle,
  Divider,
  SvgIcon
} from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';

interface SocialAuthButtonsProps {
  mode?: 'login' | 'register';
  isDisabled?: boolean;
}

// Google Logo Component
const GoogleIcon = () => (
  <SvgIcon viewBox="0 0 24 24">
    <path 
      fill="#4285f4" 
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path 
      fill="#34a853" 
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path 
      fill="#fbbc05" 
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path 
      fill="#ea4335" 
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </SvgIcon>
);

export function SocialAuthButtonsMUI({ mode = 'login', isDisabled = false }: SocialAuthButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<'Google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loginWithProvider } = useAuth();

  const handleSocialLogin = async (provider: 'Google') => {
    if (isDisabled) return;
    
    try {
      setIsLoading(true);
      setLoadingProvider(provider);
      setError(null);
      await loginWithProvider(provider);
    } catch (error: any) {
      console.error(`${provider} login error:`, error);
      setError(error.message || `Failed to login with ${provider}`);
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const buttonText = mode === 'register' ? 'Sign up with' : 'Continue with';

  return (
    <Box>
      <Button
        fullWidth
        variant="outlined"
        onClick={() => handleSocialLogin('Google')}
        disabled={isDisabled || isLoading}
        startIcon={
          loadingProvider === 'Google' ? (
            <CircularProgress size={20} />
          ) : (
            <GoogleIcon />
          )
        }
        sx={{
          py: 1.5,
          textTransform: 'uppercase',
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          border: '2px solid #374151',
          color: '#e2e8f0',
          fontWeight: 600,
          borderRadius: '0px',
          '&:hover': {
            backgroundColor: 'rgba(220, 38, 38, 0.2)',
            borderColor: '#dc2626',
            color: '#dc2626',
          },
          '&:disabled': {
            opacity: 0.5,
          },
        }}
      >
        {buttonText} Google
      </Button>

      {error && (
        <Alert 
          severity="error" 
          icon={<ErrorIcon />}
          sx={{ 
            mt: 2,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #dc2626',
            borderRadius: '0px',
            '& .MuiAlert-message': {
              color: '#fca5a5',
              fontSize: '0.875rem'
            }
          }}
        >
          <AlertTitle sx={{ color: '#fca5a5', fontWeight: 600 }}>
            OAuth Authentication Error
          </AlertTitle>
          {error}
          {error.includes('HTTPS') && (
            <Typography variant="body2" sx={{ mt: 1, color: '#fca5a5' }}>
              <strong>For development:</strong> Use <code>http://localhost:3000</code><br/>
              <strong>For production:</strong> Configure SSL certificate on your load balancer.
            </Typography>
          )}
        </Alert>
      )}

      <Box sx={{ position: 'relative', my: 3 }}>
        <Divider sx={{ borderColor: '#374151' }} />
        <Typography
          variant="body2"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            px: 2,
            color: '#e2e8f0',
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'uppercase'
          }}
        >
          Or {mode === 'register' ? 'sign up' : 'continue'} with email
        </Typography>
      </Box>
    </Box>
  );
}

export default SocialAuthButtonsMUI;
