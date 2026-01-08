
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
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
import VerificationSuccessModal from './VerificationSuccessModal';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onClose: () => void;
}

export default function RegisterForm({ onSwitchToLogin, onClose }: RegisterFormProps) {
  const { register, loginWithProvider } = useAuth();
  const navigate = useNavigate();
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

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
      console.log('📝 RegisterForm: Starting registration for:', email);
      const result = await register({
        email,
        password,
        firstName,
        lastName,
        termsAccepted: agreeToTerms,
        marketingConsent: false
      });
      
      console.log('📝 RegisterForm: Registration result:', {
        success: result.success,
        verificationRequired: result.verificationRequired,
        email: result.email
      });
      
      if (result.success) {
        if (result.verificationRequired) {
          console.log('✅ RegisterForm: Verification required - showing success modal');
          setVerificationEmail(result.email || email);
          setShowVerificationSuccess(true);
        } else {
          console.log('✅ RegisterForm: Registration complete - redirecting to dashboard');
          navigate('/');
          onClose();
        }
      } else {
        console.error('❌ RegisterForm: Registration failed:', result.error);
        setError(result.error || 'Registration failed');
      }
    } catch (error: any) {
      console.error('❌ RegisterForm: Registration exception:', error);
      setError(error.message || 'Registration failed');
    } finally {
      setLoading(false);
      console.log('📝 RegisterForm: Registration flow complete, loading=false');
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
    <>
      {/* Success Modal - shown after registration */}
      {showVerificationSuccess && (
        <VerificationSuccessModal
          email={verificationEmail}
          onLoginClick={() => {
            console.log('📝 RegisterForm: User clicked "Ready to Log In" from success modal');
            // Store the email for the login form to auto-fill
            if (typeof window !== 'undefined') {
              localStorage.setItem('pendingLoginEmail', verificationEmail);
            }
            // Switch to login mode and close the success modal
            setShowVerificationSuccess(false);
            onSwitchToLogin();
          }}
        />
      )}
    
      {/* Registration Form - hidden when success modal is shown */}
      {!showVerificationSuccess && (
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
          Create Account
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem',
            color: '#e2e8f0'
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
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #dc2626',
            borderRadius: '0px',
            '& .MuiAlert-message': {
              color: '#fca5a5',
              fontSize: '0.875rem'
            }
          }}
        >
          {error}
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
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#e2e8f0',
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

          <Typography 
            component="label" 
            htmlFor="lastName" 
            sx={{ 
              display: 'block', 
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#e2e8f0',
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
            autoComplete="new-password"
            required
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
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

          {/* Password Strength Indicator */}
          {password && (
            <Box sx={{ mt: 1, mb: 3 }}>
              {/* Strength Bar */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={passwordStrength.score}
                  sx={{
                    flex: 1,
                    height: 6,
                    borderRadius: 0,
                    backgroundColor: '#374151',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: passwordStrength.color,
                      borderRadius: 0,
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
                      color: req.met ? '#22c55e' : '#9ca3af'
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
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#e2e8f0',
              mb: 0.5,
              mt: 2
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
          <FormControlLabel
            control={
              <Checkbox
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
                sx={{
                  color: '#dc2626',
                  '&.Mui-checked': {
                    color: '#dc2626',
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
                I agree to the{' '}
                <Typography
                  component="span"
                  sx={{
                    color: '#dc2626',
                    textDecoration: 'none',
                    '&:hover': {
                      color: '#fca5a5',
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
                    color: '#dc2626',
                    textDecoration: 'none',
                    '&:hover': {
                      color: '#fca5a5',
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
            fontSize: '0.875rem',
            color: '#e2e8f0'
          }}
        >
          Already have an account?{' '}
          <Typography
            component="button"
            type="button"
            onClick={onSwitchToLogin}
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
            Sign in here
          </Typography>
        </Typography>
      </Box>
    </Card>
      )}
    </>
  );
}
