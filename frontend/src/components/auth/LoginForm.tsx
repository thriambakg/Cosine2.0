"use client";

import { useState } from 'react';
import { Visibility, VisibilityOff, Email, Lock, Shield, Warning } from '@mui/icons-material';
import { 
  Card, 
  Button, 
  TextField, 
  Alert, 
  CircularProgress, 
  Box, 
  Typography, 
  InputAdornment, 
  IconButton,
  Checkbox,
  FormControlLabel,
  Link,
  Divider
} from '@mui/material';
import { useAuth } from '@/contexts/AuthContext';
import SocialAuthButtons from './SocialAuthButtonsMUI';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToReset: () => void;
  onClose?: () => void;
}

export default function LoginForm({ onSwitchToRegister, onSwitchToReset, onClose }: LoginFormProps) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    mfaCode: '',
    rememberMe: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);

  const { login } = useAuth();

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Email validation
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    // MFA validation if required
    if (requiresMfa && !formData.mfaCode) {
      newErrors.mfaCode = 'MFA code is required';
    } else if (requiresMfa && !/^\d{6}$/.test(formData.mfaCode)) {
      newErrors.mfaCode = 'Please enter a valid 6-digit code';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const result = await login(formData.email, formData.password, formData.mfaCode);
      
      if (result.success) {
        onClose?.();
      } else if (result.requiresMfa) {
        setRequiresMfa(true);
      } else {
        setErrors({ submit: result.error || 'Login failed' });
        setAttemptCount(prev => prev + 1);
      }
    } catch (error) {
      setErrors({ submit: 'An unexpected error occurred. Please try again.' });
      setAttemptCount(prev => prev + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAccountLocked = attemptCount >= 5;

  return (
    <Box sx={{ 
      width: '100%', 
      maxWidth: 400, 
      p: 4,
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      boxShadow: 'none'
    }}>
      {/* Header */}
      <Box textAlign="center" mb={3}>
        <Typography variant="h5" fontWeight="600" color="#111827" mb={1}>
          Welcome Back
        </Typography>
        <Typography variant="body2" color="#6b7280" mb={2}>
          Sign in to your Cosine account
        </Typography>
        {requiresMfa && (
          <Box sx={{ 
            p: 2, 
            backgroundColor: '#dbeafe', 
            border: '1px solid #93c5fd',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 2
          }}>
            <Shield sx={{ color: '#2563eb', fontSize: 16 }} />
            <Typography variant="body2" color="#1e40af">
              Two-factor authentication required
            </Typography>
          </Box>
        )}
      </Box>

      {/* Social Authentication - only show if not in MFA mode */}
      {!requiresMfa && (
        <Box mb={3}>
          <SocialAuthButtons 
            mode="login" 
            isDisabled={isSubmitting || isAccountLocked} 
          />
          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              or continue with email
            </Typography>
          </Divider>
        </Box>
      )}

      {/* Form */}
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Email Field */}
        <Box mb={2}>
          <Typography variant="body2" fontWeight="500" color="#374151" mb={1}>
            Email Address *
          </Typography>
          <TextField
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            error={!!errors.email}
            helperText={errors.email}
            placeholder="Enter your email"
            disabled={isSubmitting || isAccountLocked}
            autoComplete="email"
            required
            fullWidth
            variant="outlined"
            size="medium"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Email sx={{ color: errors.email ? '#ef4444' : '#9ca3af', fontSize: 16 }} />
                </InputAdornment>
              ),
              sx: {
                backgroundColor: '#ffffff',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.email ? '#ef4444' : '#d1d5db',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.email ? '#ef4444' : '#9ca3af',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.email ? '#ef4444' : '#3b82f6',
                  borderWidth: '2px',
                },
              }
            }}
          />
        </Box>

        {/* Password Field */}
        <Box mb={2}>
          <Typography variant="body2" fontWeight="500" color="#374151" mb={1}>
            Password *
          </Typography>
          <TextField
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            error={!!errors.password}
            helperText={errors.password}
            placeholder="Enter your password"
            disabled={isSubmitting || isAccountLocked}
            autoComplete="current-password"
            required
            fullWidth
            variant="outlined"
            size="medium"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Lock sx={{ color: errors.password ? '#ef4444' : '#9ca3af', fontSize: 16 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isSubmitting || isAccountLocked}
                    edge="end"
                    size="small"
                  >
                    {showPassword ? 
                      <VisibilityOff sx={{ color: '#9ca3af', fontSize: 16 }} /> : 
                      <Visibility sx={{ color: '#9ca3af', fontSize: 16 }} />
                    }
                  </IconButton>
                </InputAdornment>
              ),
              sx: {
                backgroundColor: '#ffffff',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.password ? '#ef4444' : '#d1d5db',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.password ? '#ef4444' : '#9ca3af',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: errors.password ? '#ef4444' : '#3b82f6',
                  borderWidth: '2px',
                },
              }
            }}
          />
        </Box>

        {/* MFA Field (if required) */}
        {requiresMfa && (
          <Box mb={2}>
            <Typography variant="body2" fontWeight="500" color="#374151" mb={1}>
              Authentication Code *
            </Typography>
            <TextField
              id="mfaCode"
              type="text"
              inputMode="numeric"
              value={formData.mfaCode}
              onChange={(e) => handleInputChange('mfaCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
              error={!!errors.mfaCode}
              helperText={errors.mfaCode || "Enter the 6-digit code from your authenticator app"}
              placeholder="000000"
              disabled={isSubmitting}
              autoComplete="one-time-code"
              required
              fullWidth
              variant="outlined"
              size="medium"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Shield sx={{ color: errors.mfaCode ? '#ef4444' : '#9ca3af', fontSize: 16 }} />
                  </InputAdornment>
                ),
                sx: {
                  backgroundColor: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: errors.mfaCode ? '#ef4444' : '#d1d5db',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: errors.mfaCode ? '#ef4444' : '#9ca3af',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: errors.mfaCode ? '#ef4444' : '#3b82f6',
                    borderWidth: '2px',
                  },
                }
              }}
              inputProps={{
                maxLength: 6,
                pattern: '[0-9]*',
              }}
            />
          </Box>
        )}

        {/* Remember Me */}
        {!requiresMfa && (
          <FormControlLabel
            control={
              <Checkbox
                checked={formData.rememberMe}
                onChange={(e) => handleInputChange('rememberMe', e.target.checked)}
                disabled={isSubmitting || isAccountLocked}
                color="primary"
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                Keep me signed in for 30 days
              </Typography>
            }
          />
        )}

        {/* Account Locked Warning */}
        {isAccountLocked && (
          <Box sx={{ 
            p: 2, 
            backgroundColor: '#fef2f2', 
            border: '1px solid #fecaca',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 2
          }}>
            <Warning sx={{ color: '#dc2626', fontSize: 16 }} />
            <Typography variant="body2" color="#dc2626">
              Account temporarily locked due to multiple failed attempts
            </Typography>
          </Box>
        )}

        {/* Submit Error */}
        {errors.submit && !isAccountLocked && (
          <Box sx={{ 
            p: 2, 
            backgroundColor: '#fef2f2', 
            border: '1px solid #fecaca',
            borderRadius: '6px',
            mb: 2
          }}>
            <Box display="flex" alignItems="center" gap={1}>
              <Warning sx={{ color: '#dc2626', fontSize: 16 }} />
              <Typography variant="body2" color="#dc2626">
                {errors.submit}
              </Typography>
            </Box>
            {attemptCount > 2 && (
              <Typography variant="caption" color="#dc2626" mt={0.5}>
                {5 - attemptCount} attempts remaining before account lock
              </Typography>
            )}
          </Box>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting || isAccountLocked}
          fullWidth
          sx={{ 
            py: 1.5,
            fontWeight: 600,
            textTransform: 'none',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#2563eb',
            },
            '&:disabled': {
              backgroundColor: '#9ca3af',
              color: '#ffffff',
            },
            borderRadius: '6px',
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            }
          }}
        >
          {isSubmitting ? (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={16} color="inherit" />
              {requiresMfa ? 'Verifying...' : 'Signing In...'}
            </Box>
          ) : (
            requiresMfa ? 'Verify Code' : 'Sign In'
          )}
        </Button>

        {/* Forgot Password Link */}
        {!requiresMfa && (
          <Box textAlign="center" mt={2}>
            <Typography 
              component="button"
              type="button"
              onClick={onSwitchToReset}
              variant="body2"
              disabled={isSubmitting}
              sx={{ 
                cursor: 'pointer',
                color: '#3b82f6',
                textDecoration: 'none',
                border: 'none',
                background: 'none',
                '&:hover': {
                  color: '#1d4ed8',
                  textDecoration: 'underline',
                }
              }}
            >
              Forgot your password?
            </Typography>
          </Box>
        )}

        {/* Back to Password (when in MFA mode) */}
        {requiresMfa && (
          <Box textAlign="center" mt={2}>
            <Typography
              component="button"
              type="button"
              onClick={() => {
                setRequiresMfa(false);
                setFormData(prev => ({ ...prev, mfaCode: '' }));
                setErrors({});
              }}
              variant="body2"
              disabled={isSubmitting}
              sx={{ 
                cursor: 'pointer',
                color: '#6b7280',
                textDecoration: 'none',
                border: 'none',
                background: 'none',
                '&:hover': {
                  color: '#374151',
                  textDecoration: 'underline',
                }
              }}
            >
              ← Back to password
            </Typography>
          </Box>
        )}
      </Box>

      {/* Switch to Register */}
      {!requiresMfa && (
        <Box textAlign="center" pt={3} borderTop="1px solid #e5e7eb">
          <Typography variant="body2" color="#6b7280">
            Don't have an account?{' '}
            <Typography
              component="button"
              onClick={onSwitchToRegister}
              variant="body2"
              fontWeight={600}
              disabled={isSubmitting}
              sx={{ 
                cursor: 'pointer',
                color: '#3b82f6',
                textDecoration: 'none',
                border: 'none',
                background: 'none',
                '&:hover': {
                  color: '#1d4ed8',
                  textDecoration: 'underline',
                }
              }}
            >
              Create account
            </Typography>
          </Typography>
        </Box>
      )}

      {/* Security Notice */}
      <Box textAlign="center" mt={2}>
        <Typography variant="caption" color="#9ca3af" display="flex" alignItems="center" justifyContent="center" gap={0.5}>
          <Shield sx={{ fontSize: 12 }} />
          Protected by enterprise-grade security
        </Typography>
      </Box>
    </Box>
  );
}
