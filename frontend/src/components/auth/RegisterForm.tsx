"use client";

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  CircularProgress,
  LinearProgress
} from '@mui/material';
import { Close, Check, Clear } from '@mui/icons-material';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onClose?: () => void;
  onRegistrationSuccess?: () => void;
}

export default function RegisterForm({ onSwitchToLogin, onClose, onRegistrationSuccess }: RegisterFormProps) {
  const { register, loginWithProvider } = useAuth();
  const router = useRouter();
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { score: 0, level: '', color: '', requirements: [] };

    let score = 0;
    const requirements = [
      { text: 'At least 8 characters', met: password.length >= 8 },
      { text: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
      { text: 'Contains lowercase letter', met: /[a-z]/.test(password) },
      { text: 'Contains number', met: /\d/.test(password) },
      { text: 'Contains special character', met: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
    ];

    requirements.forEach(req => {
      if (req.met) score += 20;
    });

    let level = '';
    let color = '';
    
    if (score === 0) {
      level = '';
      color = '#9ca3af';
    } else if (score <= 40) {
      level = 'Weak';
      color = '#ef4444';
    } else if (score <= 60) {
      level = 'Fair';
      color = '#f59e0b';
    } else if (score <= 80) {
      level = 'Good';
      color = '#3b82f6';
    } else {
      level = 'Strong';
      color = '#10b981';
    }

    return { score, level, color, requirements };
  };

  const passwordStrength = getPasswordStrength();

  // Traditional registration
  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Basic validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (passwordStrength.score < 60) {
      setError('Password is too weak. Please choose a stronger password.');
      setLoading(false);
      return;
    }

    if (!agreeToTerms) {
      setError('Please agree to the terms and conditions');
      setLoading(false);
      return;
    }
    
    try {
      const result = await register({
        email,
        password,
        firstName,
        lastName,
        termsAccepted: agreeToTerms,
        marketingConsent: false // You can add this field to the form if needed
      });
      if (result.success) {
        if (result.verificationRequired) {
          // Show success message - user will get verification email
          setSuccessMessage('Account created! Please check your email to verify your account. You can then sign in.');
          onRegistrationSuccess?.();
        } else {
          // Registration complete, redirect to dashboard
          router.push('/');
        onClose?.();
        }
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (error: any) {
      setError(error.message || 'Registration failed');
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
      setError(error.message || `${provider} registration failed`);
      setLoading(false);
    }
  };

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
          Create Account
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem', // text-sm
            color: '#6b7280' // text-gray-600
          }}
        >
          Join Cosine and start trading smarter
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

      {successMessage && (
        <Alert 
          severity="success" 
          sx={{ 
            mb: 3,
            backgroundColor: '#f0fdf4', // bg-green-50
            border: '1px solid #bbf7d0', // border-green-200
            borderRadius: 2,
            '& .MuiAlert-message': {
              color: '#166534', // text-green-800
              fontSize: '0.875rem' // text-sm
            }
          }}
        >
          {successMessage}
        </Alert>
      )}

      {/* Third-Party Authentication Buttons */}
      <Box sx={{ mb: 3 }}>
        {/* Google Sign-Up */}
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
            Or create account with email
          </Typography>
        </Box>
      </Box>

      {/* Registration Form */}
      <Box component="form" onSubmit={handleEmailRegister} sx={{ mb: 3 }}>
        {/* Name Fields - Stacked */}
        <Box sx={{ mb: 3 }}>
          <Typography 
            component="label" 
            htmlFor="firstName" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#374151', // text-gray-700
              mb: 0.5
            }}
          >
            First Name
          </Typography>
          <TextField
                id="firstName"
            name="firstName"
                type="text"
                autoComplete="given-name"
                required
            fullWidth
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="John"
            sx={{
              mb: 2,
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

          <Typography 
            component="label" 
            htmlFor="lastName" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#374151', // text-gray-700
              mb: 0.5
            }}
          >
            Last Name
          </Typography>
          <TextField
              id="lastName"
            name="lastName"
              type="text"
              autoComplete="family-name"
              required
            fullWidth
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Doe"
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
              autoComplete="new-password"
              required
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
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

          {/* Password Strength Indicator */}
          {password && (
            <Box sx={{ mt: 1, mb: 2 }}>
              {/* Strength Bar */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={passwordStrength.score}
                  sx={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#e5e7eb',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: passwordStrength.color,
                      borderRadius: 3,
                    }
                  }}
                />
                {passwordStrength.level && (
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: passwordStrength.color,
                      minWidth: 'fit-content'
                    }}
                  >
                    {passwordStrength.level}
                  </Typography>
                )}
              </Box>

              {/* Requirements Checklist */}
              <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, 
                gap: 0.5,
                fontSize: '0.75rem'
              }}>
                {passwordStrength.requirements.map((req, index) => (
                  <Box 
                    key={index} 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 0.5,
                      color: req.met ? '#10b981' : '#6b7280'
                    }}
                  >
                    {req.met ? (
                      <Check sx={{ fontSize: 12 }} />
                    ) : (
                      <Clear sx={{ fontSize: 12 }} />
                    )}
                    <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                      {req.text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          <Typography 
            component="label" 
            htmlFor="confirmPassword" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem', // text-sm
              fontWeight: 500, // font-medium
              color: '#374151', // text-gray-700
              mb: 0.5
            }}
          >
            Confirm Password
          </Typography>
          <TextField
              id="confirmPassword"
            name="confirmPassword"
            type="password"
              autoComplete="new-password"
              required
            fullWidth
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
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
          <FormControlLabel
            control={
              <Checkbox
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
                sx={{
                  color: '#4f46e5', // text-indigo-600
                  '&.Mui-checked': {
                    color: '#4f46e5',
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
              I agree to the{' '}
                <Typography
                  component="span"
                  sx={{
                    color: '#4f46e5',
                    textDecoration: 'none',
                    '&:hover': {
                      color: '#4338ca',
                      textDecoration: 'underline'
                    }
                  }}
                >
                Terms of Service
                </Typography>
                {' '}and{' '}
                <Typography
                  component="span"
                  sx={{
                    color: '#4f46e5',
                    textDecoration: 'none',
                    '&:hover': {
                      color: '#4338ca',
                      textDecoration: 'underline'
                    }
                  }}
                >
                Privacy Policy
                </Typography>
              </Typography>
            }
          />
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
              Creating account...
            </Box>
          ) : (
            'Create Account'
          )}
        </Button>
      </Box>

      {/* Sign In Link */}
      <Box textAlign="center">
        <Typography 
          sx={{ 
            fontSize: '0.875rem', // text-sm
            color: '#6b7280' // text-gray-600
          }}
        >
          Already have an account?{' '}
          <Typography
            component="button"
            type="button"
            onClick={onSwitchToLogin}
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
            Sign in here
          </Typography>
        </Typography>
      </Box>
    </Card>
  );
}