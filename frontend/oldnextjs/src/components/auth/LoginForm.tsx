"use client";

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  TextField,
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import { Close } from '@mui/icons-material';

interface LoginFormProps {
  onClose?: () => void;
  onSwitchToRegister?: () => void;
  onSwitchToReset?: () => void;
}

export default function LoginForm({ onClose, onSwitchToRegister, onSwitchToReset }: LoginFormProps) {
  const { user, isLoading, isAuthenticated, login, loginWithProvider } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      router.push('/');
    }
    
    // Check for authentication errors from callback
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const errorParam = urlParams.get('error');
      if (errorParam === 'authentication_failed') {
        setError('Authentication failed. Please try again.');
      } else if (errorParam === 'callback_error') {
        setError('There was an error completing authentication. Please try again.');
      }
    }
  }, [isAuthenticated, user, router]);

  // Traditional email/password login
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const result = await login(email, password);
      if (result.success) {
        router.push('/');
        onClose?.();
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (error: any) {
      setError(error.message || 'Login failed');
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

  if (isLoading) {
    return (
      <Box sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%)'
      }}>
        <Box textAlign="center">
          <CircularProgress sx={{ color: '#4f46e5' }} />
          <Typography sx={{ mt: 1, color: '#6b7280' }}>Loading...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Card sx={{
      maxWidth: 448, // max-w-md
      width: '100%',
      p: 4, // space-y-8 p-8
      backgroundColor: '#ffffff',
      borderRadius: '12px', // rounded-xl
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', // shadow-lg
      position: 'relative',
      '&:hover': {
        backgroundColor: '#ffffff', // Prevent any hover color changes
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', // Keep same shadow
      }
    }}>
      {/* Close Button */}
      {onClose && (
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: '#6b7280',
            '&:hover': { backgroundColor: '#f3f4f6' }
          }}
        >
          <Close sx={{ fontSize: 18 }} />
        </IconButton>
      )}

      {/* Header */}
      <Box textAlign="center" sx={{ mb: 4 }}>
        <Typography 
          variant="h4" 
          sx={{ 
            mt: 3, 
            fontSize: '1.875rem', // text-3xl
            fontWeight: 800, // font-extrabold
            color: '#111827', // text-gray-900
            mb: 1
          }}
        >
          Sign in to Cosine
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem', // text-sm
            color: '#6b7280' // text-gray-600
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
            backgroundColor: '#fef2f2', // bg-red-50
            border: '1px solid #fecaca', // border-red-200
            borderRadius: '8px',
            '& .MuiAlert-message': {
              color: '#991b1b', // text-red-800
              fontSize: '0.875rem' // text-sm
            }
          }}
        >
          {error}
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
            border: '1px solid #d1d5db', // border-gray-300
            borderRadius: '8px', // rounded-lg
            backgroundColor: '#ffffff', // bg-white
            fontSize: '0.875rem', // text-sm
            fontWeight: 500, // font-medium
            color: '#374151', // text-gray-700
            textTransform: 'none',
            boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', // shadow-sm
            '&:hover': {
              backgroundColor: '#f9fafb', // hover:bg-gray-50
              borderColor: '#d1d5db',
            },
            '&:focus': {
              outline: 'none',
              ringWidth: '2px',
              ringColor: '#4f46e5', // focus:ring-indigo-500
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
          <Divider sx={{ width: '100%', borderColor: '#d1d5db' }} />
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
              backgroundColor: '#ffffff', 
              color: '#6b7280', // text-gray-500
              fontSize: '0.875rem' // text-sm
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
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#374151', // text-gray-700
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
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px', // rounded-lg
                fontSize: '0.875rem', // text-sm
                color: '#111827', // text-gray-900
                '& fieldset': {
                  borderColor: '#d1d5db', // border-gray-300
                },
                '&:hover fieldset': {
                  borderColor: '#d1d5db',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#4f46e5', // focus:border-indigo-500
                  borderWidth: '1px',
                },
                '&.Mui-focused': {
                  outline: 'none',
                  ringWidth: '2px',
                  ringColor: '#4f46e5', // focus:ring-indigo-500
                }
              },
              '& .MuiOutlinedInput-input': {
                px: 1.5,
                py: 1,
                '&::placeholder': {
                  color: '#6b7280', // placeholder-gray-500
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
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#374151', // text-gray-700
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
                borderRadius: '8px', // rounded-lg
                fontSize: '0.875rem', // text-sm
                color: '#111827', // text-gray-900
                '& fieldset': {
                  borderColor: '#d1d5db', // border-gray-300
                },
                '&:hover fieldset': {
                  borderColor: '#d1d5db',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#4f46e5', // focus:border-indigo-500
                  borderWidth: '1px',
                },
                '&.Mui-focused': {
                  outline: 'none',
                  ringWidth: '2px',
                  ringColor: '#4f46e5', // focus:ring-indigo-500
                }
              },
              '& .MuiOutlinedInput-input': {
                px: 1.5,
                py: 1,
                '&::placeholder': {
                  color: '#6b7280', // placeholder-gray-500
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
                  color: '#4f46e5', // text-indigo-600
                  '&.Mui-checked': {
                    color: '#4f46e5',
                  },
                  '&:focus': {
                    ringWidth: '2px',
                    ringColor: '#4f46e5', // focus:ring-indigo-500
                  }
                }}
              />
            }
            label={
              <Typography 
                sx={{ 
                  fontSize: '0.875rem', // text-sm
                  color: '#111827' // text-gray-900
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
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#4f46e5', // text-indigo-600
              textDecoration: 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              '&:hover': {
                color: '#4338ca', // hover:text-indigo-500
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
            fontSize: '0.875rem', // text-sm
            fontWeight: 500, // font-medium
            borderRadius: '8px', // rounded-lg
            color: '#ffffff', // text-white
            backgroundColor: '#4f46e5', // bg-indigo-600
            textTransform: 'none',
            '&:hover': {
              backgroundColor: '#4338ca', // hover:bg-indigo-700
            },
            '&:focus': {
              outline: 'none',
              ringWidth: '2px',
              ringColor: '#4f46e5', // focus:ring-indigo-500
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
            fontSize: '0.875rem', // text-sm
            color: '#6b7280' // text-gray-600
          }}
        >
          Don't have an account?{' '}
          <Typography
            component="button"
            type="button"
            onClick={onSwitchToRegister}
            sx={{
              fontWeight: 500, // font-medium
              color: '#4f46e5', // text-indigo-600
              textDecoration: 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'inline',
              '&:hover': {
                color: '#4338ca', // hover:text-indigo-500
                textDecoration: 'underline'
              }
            }}
          >
            Sign up here
          </Typography>
        </Typography>
      </Box>
    </Card>
  );
}