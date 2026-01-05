import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Box,
  Button,
  Card,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  Divider
} from '@mui/material';
import { Close, ArrowBack, CheckCircle } from '@mui/icons-material';

interface PasswordResetFormProps {
  onSwitchToLogin: () => void;
  onClose: () => void;
}

export default function PasswordResetForm({ onSwitchToLogin, onClose }: PasswordResetFormProps) {
  const { resetPassword, confirmResetPassword } = useAuth();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await resetPassword(email);
      if (result.success) {
        setStep('confirm');
        setSuccess(true);
      } else {
        setError(result.error || 'Failed to send reset email. Please try again.');
      }
    } catch (error: any) {
      setError(error.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please try again.');
      setLoading(false);
      return;
    }

    // Validate password strength
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      setLoading(false);
      return;
    }

    try {
      const result = await confirmResetPassword(email, confirmationCode, newPassword);
      if (result.success) {
        setSuccess(true);
        // Auto-switch to login after 2 seconds
        setTimeout(() => {
          onSwitchToLogin();
        }, 2000);
      } else {
        setError(result.error || 'Failed to reset password. Please check your code and try again.');
      }
    } catch (error: any) {
      setError(error.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToRequest = () => {
    setStep('request');
    setError('');
    setSuccess(false);
    setConfirmationCode('');
    setNewPassword('');
    setConfirmPassword('');
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
          {step === 'request' ? 'Reset Password' : 'Enter New Password'}
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem',
            color: '#e2e8f0'
          }}
        >
          {step === 'request' 
            ? 'Enter your email address and we\'ll send you a reset code' 
            : 'Enter the code from your email and your new password'
          }
        </Typography>
      </Box>

      {/* Success Message */}
      {success && (
        <Alert 
          severity="success" 
          icon={<CheckCircle />}
          sx={{ 
            mb: 3,
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '2px solid #22c55e',
            borderRadius: '0px',
            '& .MuiAlert-message': {
              color: '#dcfce7',
              fontSize: '0.875rem',
              fontWeight: 600
            },
            '& .MuiAlert-icon': {
              color: '#22c55e'
            }
          }}
        >
          {step === 'request' 
            ? 'Reset code sent! Check your email for instructions.'
            : 'Password reset successful! Redirecting to login...'
          }
        </Alert>
      )}

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
          <strong>Error:</strong> {error}
        </Alert>
      )}

      {step === 'request' ? (
        <Box component="form" onSubmit={handleRequestReset}>
          {/* Email Input */}
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

          {/* Submit Button */}
          <Button
            type="submit"
            fullWidth
            disabled={loading || !email.trim()}
            sx={{
              mb: 3,
              py: 1.5,
              backgroundColor: '#dc2626',
              borderRadius: '0px',
              fontSize: '0.875rem',
              fontWeight: 700,
              color: '#ffffff',
              textTransform: 'uppercase',
              '&:hover': {
                backgroundColor: '#b91c1c',
              },
              '&:disabled': {
                opacity: 0.5
              }
            }}
          >
            {loading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} sx={{ color: '#ffffff' }} />
                Sending Reset Code...
              </Box>
            ) : (
              'Send Reset Code'
            )}
          </Button>
        </Box>
      ) : (
        <Box component="form" onSubmit={handleConfirmReset}>
          {/* Back Button */}
          <Button
            startIcon={<ArrowBack />}
            onClick={handleBackToRequest}
            sx={{
              mb: 2,
              color: '#e2e8f0',
              textTransform: 'none',
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#3b82f6'
              }
            }}
          >
            Back to email entry
          </Button>

          {/* Confirmation Code Input */}
          <Box sx={{ mb: 3 }}>
            <Typography 
              component="label" 
              htmlFor="confirmationCode" 
              sx={{ 
                display: 'block', 
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#e2e8f0',
                mb: 0.5
              }}
            >
              Confirmation Code
            </Typography>
            <TextField
              id="confirmationCode"
              name="confirmationCode"
              type="text"
              required
              fullWidth
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
              placeholder="Enter the code from your email"
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

          {/* New Password Input */}
          <Box sx={{ mb: 3 }}>
            <Typography 
              component="label" 
              htmlFor="newPassword" 
              sx={{ 
                display: 'block', 
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#e2e8f0',
                mb: 0.5
              }}
            >
              New Password
            </Typography>
            <TextField
              id="newPassword"
              name="newPassword"
              type="password"
              required
              fullWidth
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter your new password"
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

          {/* Confirm Password Input */}
          <Box sx={{ mb: 3 }}>
            <Typography 
              component="label" 
              htmlFor="confirmPassword" 
              sx={{ 
                display: 'block', 
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#e2e8f0',
                mb: 0.5
              }}
            >
              Confirm New Password
            </Typography>
            <TextField
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              fullWidth
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your new password"
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

          {/* Submit Button */}
          <Button
            type="submit"
            fullWidth
            disabled={loading || !confirmationCode.trim() || !newPassword.trim() || !confirmPassword.trim()}
            sx={{
              mb: 3,
              py: 1.5,
              backgroundColor: '#dc2626',
              borderRadius: '0px',
              fontSize: '0.875rem',
              fontWeight: 700,
              color: '#ffffff',
              textTransform: 'uppercase',
              '&:hover': {
                backgroundColor: '#b91c1c',
              },
              '&:disabled': {
                opacity: 0.5
              }
            }}
          >
            {loading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} sx={{ color: '#ffffff' }} />
                Resetting Password...
              </Box>
            ) : (
              'Reset Password'
            )}
          </Button>
        </Box>
      )}

      {/* Divider and Back to Login */}
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
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              px: 2,
              fontSize: '0.75rem',
              color: '#9ca3af',
              textTransform: 'uppercase'
            }}
          >
            or
          </Typography>
        </Box>
      </Box>

      {/* Back to Login Link */}
      <Box textAlign="center">
        <Typography 
          sx={{ 
            fontSize: '0.875rem',
            color: '#e2e8f0'
          }}
        >
          Remember your password?{' '}
          <Typography
            component="button"
            type="button"
            onClick={onSwitchToLogin}
            sx={{
              fontWeight: 600,
              color: '#dc2626',
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