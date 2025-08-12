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
    <Card sx={{ 
      width: '100%', 
      maxWidth: 448, 
      p: 3,
      boxShadow: 3,
      borderRadius: 2
    }}>
      {/* Header */}
      <Box textAlign="center" mb={3}>
        <Typography variant="h4" fontWeight="bold" color="text.primary" mb={1}>
          Welcome Back
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Sign in to your Cosine account
        </Typography>
        {requiresMfa && (
          <Alert severity="info" icon={<Shield />} sx={{ textAlign: 'left' }}>
            Two-factor authentication required
          </Alert>
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
        <TextField
          id="email"
          label="Email Address"
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
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Email color={errors.email ? 'error' : 'action'} />
              </InputAdornment>
            ),
          }}
        />

        {/* Password Field */}
        <TextField
          id="password"
          label="Password"
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
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Lock color={errors.password ? 'error' : 'action'} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isSubmitting || isAccountLocked}
                  edge="end"
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {/* MFA Field (if required) */}
        {requiresMfa && (
          <Box>
            <TextField
              id="mfaCode"
              label="Authentication Code"
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
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Shield color={errors.mfaCode ? 'error' : 'action'} />
                  </InputAdornment>
                ),
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
          <Alert severity="error" icon={<Warning />}>
            Account temporarily locked due to multiple failed attempts
          </Alert>
        )}

        {/* Submit Error */}
        {errors.submit && !isAccountLocked && (
          <Alert severity="error" icon={<Warning />}>
            <Box>
              <Typography variant="body2">{errors.submit}</Typography>
              {attemptCount > 2 && (
                <Typography variant="caption" color="error.main" mt={0.5}>
                  {5 - attemptCount} attempts remaining before account lock
                </Typography>
              )}
            </Box>
          </Alert>
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
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%)',
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
          <Box textAlign="center" mt={1}>
            <Link
              component="button"
              type="button"
              onClick={onSwitchToReset}
              variant="body2"
              color="primary"
              underline="hover"
              disabled={isSubmitting}
              sx={{ cursor: 'pointer' }}
            >
              Forgot your password?
            </Link>
          </Box>
        )}

        {/* Back to Password (when in MFA mode) */}
        {requiresMfa && (
          <Box textAlign="center" mt={1}>
            <Link
              component="button"
              type="button"
              onClick={() => {
                setRequiresMfa(false);
                setFormData(prev => ({ ...prev, mfaCode: '' }));
                setErrors({});
              }}
              variant="body2"
              color="text.secondary"
              underline="hover"
              disabled={isSubmitting}
              sx={{ cursor: 'pointer' }}
            >
              ← Back to password
            </Link>
          </Box>
        )}
      </Box>

      {/* Switch to Register */}
      {!requiresMfa && (
        <Box textAlign="center" pt={3} borderTop="1px solid" borderColor="divider">
          <Typography variant="body2" color="text.secondary">
            Don't have an account?{' '}
            <Link
              component="button"
              onClick={onSwitchToRegister}
              variant="body2"
              color="primary"
              underline="hover"
              fontWeight={600}
              disabled={isSubmitting}
              sx={{ cursor: 'pointer' }}
            >
              Create account
            </Link>
          </Typography>
        </Box>
      )}

      {/* Security Notice */}
      <Box textAlign="center" mt={2}>
        <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" justifyContent="center" gap={0.5}>
          <Shield sx={{ fontSize: 12 }} />
          Protected by enterprise-grade security
        </Typography>
      </Box>
    </Card>
  );
}
