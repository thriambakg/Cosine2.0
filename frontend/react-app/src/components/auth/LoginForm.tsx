
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import { Close } from '@mui/icons-material';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToReset: () => void;
  onClose: () => void;
}

export default function LoginForm({ onSwitchToRegister, onSwitchToReset, onClose }: LoginFormProps) {
  const { user, isAuthenticated, login, loginWithProvider } = useAuth();
  const navigate = useNavigate();
  const hasReadStorageRef = useRef(false);
  const [email, setEmail] = useState(() => {
    // Auto-fill email from registration if available
    if (typeof window !== 'undefined' && !hasReadStorageRef.current) {
      const pendingEmail = localStorage.getItem('pendingLoginEmail');
      if (pendingEmail) {
        hasReadStorageRef.current = true;
        return pendingEmail;
      }
    }
    return '';
  });
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Clear localStorage after reading email
  useEffect(() => {
    if (email && hasReadStorageRef.current) {
      localStorage.removeItem('pendingLoginEmail');
    }
  }, [email]);

  // Only redirect if already authenticated and not in the middle of a login attempt
  // Add additional check to prevent premature navigation
  useEffect(() => {
    if (isAuthenticated && user && !loading && !error) {
      // Add a small delay to ensure the authentication process is complete
      const timeoutId = setTimeout(() => {
        navigate('/');
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [isAuthenticated, user, navigate, loading, error]);

  // Check for authentication errors from callback
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const errorParam = urlParams.get('error');
      if (errorParam === 'authentication_failed') {
        setError('Authentication failed. Please try again.');
      } else if (errorParam === 'callback_error') {
        setError('There was an error completing authentication. Please try again.');
      }
    }
  }, []);

  // Traditional email/password login
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const result = await login(email, password);
      if (result.success) {
        // Clear any previous errors and close modal
        setError('');
        // Add small delay to ensure state is stable before navigation
        setTimeout(() => {
          navigate('/');
          onClose();
        }, 100);
      } else {
        // Display error message - keep modal open and preserve form values
        setError(result.error || 'Login failed. Please check your credentials and try again.');
        // Ensure we don't navigate or close modal on failure
        return;
      }
    } catch (error: any) {
      // Catch any unexpected errors - preserve form state
      console.error('Unexpected login error:', error);
      setError(error.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Federated identity provider login
  const handleFederatedLogin = async (provider: 'Google') => {
    try {
      setLoading(true);
      setError('');
      await loginWithProvider(provider);
      // The callback will handle the success/error
    } catch (error: any) {
      setError(error.message || `${provider} login failed`);
      setLoading(false);
    }
  };

  return (
    <Card sx={{
      maxWidth: 448,
      width: '100%',
      p: 4,
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderRadius: '0px',
      boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.5)',
      border: '2px solid #374151',
      position: 'relative',
      backdropFilter: 'blur(16px)',
      '&:hover': {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.5)',
      }
    }}>
      {/* Close Button */}
      <IconButton
        onClick={onClose}
        sx={{
          position: 'absolute',
          right: 8,
          top: 8,
          color: '#e2e8f0',
          '&:hover': { backgroundColor: 'rgba(220, 38, 38, 0.2)' }
        }}
      >
        <Close sx={{ fontSize: 18 }} />
      </IconButton>

      {/* Header */}
      <Box textAlign="center" sx={{ mb: 4 }}>
        <Typography 
          variant="h4" 
          sx={{ 
            mt: 3, 
            fontSize: '1.875rem',
            fontWeight: 800,
            color: '#ffffff',
            mb: 1,
            textTransform: 'uppercase'
          }}
        >
          Sign in to FinGov
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem',
            color: '#e2e8f0'
          }}
        >
          Choose your preferred sign-in method
        </Typography>
      </Box>

      {/* Error Message */}
      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 3,
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '2px solid #dc2626',
            borderRadius: '0px',
            animation: 'pulse 2s ease-in-out',
            boxShadow: '0 0 20px rgba(220, 38, 38, 0.3)',
            '& .MuiAlert-message': {
              color: '#fef2f2',
              fontSize: '0.875rem',
              fontWeight: 600
            },
            '& .MuiAlert-icon': {
              color: '#dc2626'
            }
          }}
        >
          <strong>Login Failed:</strong> {error}
        </Alert>
      )}

      {/* Third-Party Authentication Buttons */}
      <Box sx={{ mb: 3 }}>
        {/* Google Sign-In */}
        <Button
          fullWidth
          variant="outlined"
          onClick={() => handleFederatedLogin('Google')}
          disabled={loading}
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            px: 2,
            py: 1.5,
            border: '2px solid #374151',
            borderRadius: '0px',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#e2e8f0',
            textTransform: 'uppercase',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            '&:hover': {
              backgroundColor: 'rgba(220, 38, 38, 0.2)',
              borderColor: '#dc2626',
              color: '#dc2626',
            },
            '&:focus': {
              outline: 'none',
              ringWidth: '2px',
              ringColor: '#dc2626',
              ringOffset: '2px',
            },
            '&:disabled': {
              opacity: 0.5
            }
          }}
        >
          <Box sx={{ mr: 1.5 }}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          </Box>
          Continue with Google
        </Button>
      </Box>

      {/* Divider */}
      <Box sx={{ position: 'relative', mb: 3 }}>
        <Box sx={{ 
          position: 'absolute', 
          inset: 0, 
          display: 'flex', 
          alignItems: 'center' 
        }}>
          <Divider sx={{ width: '100%', borderColor: '#374151' }} />
        </Box>
        <Box sx={{ 
          position: 'relative', 
          display: 'flex', 
          justifyContent: 'center' 
        }}>
          <Typography 
            variant="body2" 
            sx={{ 
              px: 1, 
              backgroundColor: 'rgba(15, 23, 42, 0.95)', 
              color: '#e2e8f0',
              fontSize: '0.875rem'
            }}
          >
            Or continue with email
          </Typography>
        </Box>
      </Box>

      {/* Traditional Email/Password Form */}
      <Box component="form" onSubmit={handleEmailLogin} sx={{ mb: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography 
            component="label" 
            htmlFor="email" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#e2e8f0',
              mb: 0.5
            }}
          >
            Email address
          </Typography>
          <TextField
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            fullWidth
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            inputRef={emailInputRef}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '0px',
                fontSize: '0.875rem',
                color: '#ffffff',
                backgroundColor: 'rgba(31, 41, 55, 0.8)',
                '& fieldset': {
                  borderColor: '#374151',
                },
                '&:hover fieldset': {
                  borderColor: '#dc2626',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#dc2626',
                  borderWidth: '2px',
                },
                '&.Mui-focused': {
                  outline: 'none',
                  ringWidth: '2px',
                  ringColor: '#dc2626',
                }
              },
              '& .MuiOutlinedInput-input': {
                px: 1.5,
                py: 1,
                '&::placeholder': {
                  color: '#9ca3af',
                  opacity: 1
                }
              }
            }}
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography 
            component="label" 
            htmlFor="password" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#e2e8f0',
              mb: 0.5
            }}
          >
            Password
          </Typography>
          <TextField
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '0px',
                fontSize: '0.875rem',
                color: '#ffffff',
                backgroundColor: 'rgba(31, 41, 55, 0.8)',
                '& fieldset': {
                  borderColor: '#374151',
                },
                '&:hover fieldset': {
                  borderColor: '#dc2626',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#dc2626',
                  borderWidth: '2px',
                },
                '&.Mui-focused': {
                  outline: 'none',
                  ringWidth: '2px',
                  ringColor: '#dc2626',
                }
              },
              '& .MuiOutlinedInput-input': {
                px: 1.5,
                py: 1,
                '&::placeholder': {
                  color: '#9ca3af',
                  opacity: 1
                }
              }
            }}
          />
        </Box>

        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          mb: 3
        }}>
          <FormControlLabel
            control={
              <Checkbox
                id="remember-me"
                name="remember-me"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                sx={{
                  color: '#dc2626',
                  '&.Mui-checked': {
                    color: '#dc2626',
                  },
                  '&:focus': {
                    ringWidth: '2px',
                    ringColor: '#dc2626',
                  }
                }}
              />
            }
            label={
              <Typography 
                sx={{ 
                  fontSize: '0.875rem',
                  color: '#e2e8f0'
                }}
              >
                Remember me
              </Typography>
            }
          />

          <Typography
            component="button"
            type="button"
            onClick={onSwitchToReset}
            sx={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#dc2626',
              textDecoration: 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textTransform: 'uppercase',
              '&:hover': {
                color: '#fca5a5',
                textDecoration: 'underline'
              }
            }}
          >
            Forgot your password?
          </Typography>
        </Box>

        <Button
          type="submit"
          fullWidth
          disabled={loading}
          sx={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            py: 1,
            px: 2,
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: 600,
            borderRadius: '0px',
            color: '#ffffff',
            backgroundColor: '#dc2626',
            textTransform: 'uppercase',
            '&:hover': {
              backgroundColor: '#b91c1c',
            },
            '&:focus': {
              outline: 'none',
              ringWidth: '2px',
              ringColor: '#dc2626',
              ringOffset: '2px',
            },
            '&:disabled': {
              opacity: 0.5
            }
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#ffffff' }} />
              Signing in...
            </Box>
          ) : (
            'Sign in with Email'
          )}
        </Button>
      </Box>

      {/* Sign Up Link */}
      <Box textAlign="center">
        <Typography 
          sx={{ 
            fontSize: '0.875rem',
            color: '#e2e8f0'
          }}
        >
          Don't have an account?{' '}
          <Typography
            component="button"
            type="button"
            onClick={onSwitchToRegister}
            sx={{
              fontWeight: 600,
              color: '#dc2626',
              textDecoration: 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'inline',
              textTransform: 'uppercase',
              '&:hover': {
                color: '#fca5a5',
                textDecoration: 'underline'
              }
            }}
          >
            Sign up here
          </Typography>
        </Typography>
      </Box>

      {/* CSS Animation for error alerts */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.9;
              transform: scale(1.01);
            }
          }
        `}
      </style>
    </Card>
  );
}
