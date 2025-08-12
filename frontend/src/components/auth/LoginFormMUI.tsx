"use client";

import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  InputAdornment,
  Checkbox,
  FormControlLabel,
  Alert,
  AlertTitle,
  CircularProgress,
  Paper,
  Divider,
  useTheme,
  alpha
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  Security as SecurityIcon,
  Warning as WarningIcon,
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import { SocialAuthButtonsMUI } from './SocialAuthButtonsMUI';
import { GlassCard } from '@/components/mui/GlassCard';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToReset: () => void;
  onClose?: () => void;
}

export default function LoginFormMUI({ onSwitchToRegister, onSwitchToReset, onClose }: LoginFormProps) {
  const theme = useTheme();
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

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (requiresMfa && !formData.mfaCode) {
      newErrors.mfaCode = 'MFA code is required';
    } else if (requiresMfa && !/^\d{6}$/.test(formData.mfaCode)) {
      newErrors.mfaCode = 'MFA code must be 6 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (attemptCount >= 5) {
      setErrors({ submit: 'Too many login attempts. Please try again in 15 minutes.' });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const result = await login(formData.email, formData.password, formData.mfaCode);
      
      if (result.success) {
        setAttemptCount(0);
        onClose?.();
      } else if (result.requiresMfa) {
        setRequiresMfa(true);
        setErrors({});
      } else {
        setAttemptCount(prev => prev + 1);
        setErrors({ submit: result.error || 'Login failed' });
        
        if (requiresMfa) {
          setRequiresMfa(false);
          setFormData(prev => ({ ...prev, mfaCode: '' }));
        }
      }
    } catch (error) {
      setAttemptCount(prev => prev + 1);
      setErrors({ submit: 'An unexpected error occurred' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
    if (errors.submit) {
      setErrors(prev => ({ ...prev, submit: '' }));
    }
  };

  const isAccountLocked = attemptCount >= 5;

  return (
    <GlassCard>
      <Box sx={{ p: 4, width: '100%', maxWidth: 'md' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" gutterBottom>
            Welcome Back
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Sign in to your Cosine account
          </Typography>
          {requiresMfa && (
            <Alert 
              severity="info" 
              icon={<SecurityIcon />}
              sx={{ mt: 2, backgroundColor: alpha(theme.palette.info.main, 0.1) }}
            >
              Two-factor authentication required
            </Alert>
          )}
        </Box>

        {!requiresMfa && (
          <Box sx={{ mb: 3 }}>
            <SocialAuthButtonsMUI 
              mode="login" 
              isDisabled={isSubmitting || isAccountLocked} 
            />
          </Box>
        )}

        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              id="email"
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              error={!!errors.email}
              helperText={errors.email}
              disabled={isSubmitting || isAccountLocked}
              required
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <EmailIcon />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              error={!!errors.password}
              helperText={errors.password}
              disabled={isSubmitting || isAccountLocked}
              required
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LockIcon />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isSubmitting || isAccountLocked}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {requiresMfa && (
              <TextField
                fullWidth
                id="mfaCode"
                label="Authentication Code"
                type="text"
                value={formData.mfaCode}
                onChange={(e) => handleInputChange('mfaCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                error={!!errors.mfaCode}
                helperText={errors.mfaCode || 'Enter the 6-digit code from your authenticator app'}
                disabled={isSubmitting}
                required
                inputProps={{
                  maxLength: 6,
                  pattern: '[0-9]{6}',
                  inputMode: 'numeric',
                  autoComplete: 'one-time-code',
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SecurityIcon />
                    </InputAdornment>
                  ),
                }}
              />
            )}

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
                label="Keep me signed in for 30 days"
              />
            )}

            {isAccountLocked && (
              <Alert 
                severity="error"
                icon={<WarningIcon />}
              >
                <AlertTitle>Account Locked</AlertTitle>
                Account temporarily locked due to multiple failed attempts
              </Alert>
            )}

            {errors.submit && !isAccountLocked && (
              <Alert severity="error">
                {errors.submit}
                {attemptCount > 2 && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                    {5 - attemptCount} attempts remaining before account lock
                  </Typography>
                )}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={isSubmitting || isAccountLocked}
              sx={{
                mt: 2,
                py: 1.5,
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              }}
            >
              {isSubmitting ? (
                <>
                  <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />
                  {requiresMfa ? 'Verifying...' : 'Signing In...'}
                </>
              ) : (
                requiresMfa ? 'Verify & Sign In' : 'Sign In'
              )}
            </Button>

            {!requiresMfa && (
              <Button
                onClick={onSwitchToReset}
                disabled={isSubmitting}
                sx={{ mt: 1 }}
              >
                Forgot your password?
              </Button>
            )}

            {requiresMfa && (
              <Button
                startIcon={<ArrowBackIcon />}
                onClick={() => {
                  setRequiresMfa(false);
                  setFormData(prev => ({ ...prev, mfaCode: '' }));
                  setErrors({});
                }}
                disabled={isSubmitting}
                sx={{ mt: 1 }}
              >
                Back to password
              </Button>
            )}
          </Box>
        </form>

        {!requiresMfa && (
          <>
            <Divider sx={{ my: 3 }} />
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Don't have an account?{' '}
                <Button
                  onClick={onSwitchToRegister}
                  disabled={isSubmitting}
                  sx={{ textTransform: 'none' }}
                >
                  Create account
                </Button>
              </Typography>
            </Box>
          </>
        )}

        <Box sx={{ 
          mt: 3, 
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5
        }}>
          <SecurityIcon fontSize="small" color="action" />
          <Typography variant="caption" color="text.secondary">
            Protected by enterprise-grade security
          </Typography>
        </Box>
      </Box>
    </GlassCard>
  );
}
