"use client";

import { useState } from 'react';
import { Eye, EyeOff, Mail, Lock, Shield, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

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
      newErrors.mfaCode = 'MFA code must be 6 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    // Rate limiting - prevent too many attempts
    if (attemptCount >= 5) {
      setErrors({ submit: 'Too many login attempts. Please try again in 15 minutes.' });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const result = await login(formData.email, formData.password, formData.mfaCode);
      
      if (result.success) {
        // Reset attempt count on success
        setAttemptCount(0);
        onClose?.();
      } else if (result.requiresMfa) {
        setRequiresMfa(true);
        setErrors({});
        // Don't increment attempt count for MFA requirement
      } else {
        setAttemptCount(prev => prev + 1);
        setErrors({ submit: result.error || 'Login failed' });
        
        // Clear MFA requirement if login fails
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
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
    // Clear submit error when user makes changes
    if (errors.submit) {
      setErrors(prev => ({ ...prev, submit: '' }));
    }
  };

  const isAccountLocked = attemptCount >= 5;

  return (
    <Card className="w-full max-w-md p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Welcome Back</h2>
        <p className="text-gray-600">Sign in to your Cosine account</p>
        {requiresMfa && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <p className="text-blue-700 text-sm">Two-factor authentication required</p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email Field */}
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email Address *
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className={`w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.email ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter your email"
              disabled={isSubmitting || isAccountLocked}
              autoComplete="email"
              required
            />
          </div>
          {errors.email && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.email}</p>
            </div>
          )}
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">
            Password *
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              className={`w-full pl-10 pr-12 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.password ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter your password"
              disabled={isSubmitting || isAccountLocked}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isSubmitting || isAccountLocked}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.password}</p>
            </div>
          )}
        </div>

        {/* MFA Field (if required) */}
        {requiresMfa && (
          <div className="space-y-2">
            <label htmlFor="mfaCode" className="text-sm font-medium text-gray-700">
              Authentication Code *
            </label>
            <div className="relative">
              <Shield className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                id="mfaCode"
                type="text"
                value={formData.mfaCode}
                onChange={(e) => handleInputChange('mfaCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                  errors.mfaCode ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="000000"
                disabled={isSubmitting}
                maxLength={6}
                pattern="[0-9]{6}"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            {errors.mfaCode && (
              <div className="flex items-center space-x-1">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <p className="text-red-500 text-sm">{errors.mfaCode}</p>
              </div>
            )}
            <p className="text-xs text-gray-500">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>
        )}

        {/* Remember Me */}
        {!requiresMfa && (
          <div className="flex items-center">
            <input
              id="rememberMe"
              type="checkbox"
              checked={formData.rememberMe}
              onChange={(e) => handleInputChange('rememberMe', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              disabled={isSubmitting || isAccountLocked}
            />
            <label htmlFor="rememberMe" className="ml-2 text-sm text-gray-700">
              Keep me signed in for 30 days
            </label>
          </div>
        )}

        {/* Account Locked Warning */}
        {isAccountLocked && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-red-700 text-sm">
                Account temporarily locked due to multiple failed attempts
              </p>
            </div>
          </div>
        )}

        {/* Submit Error */}
        {errors.submit && !isAccountLocked && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-red-700 text-sm">{errors.submit}</p>
            </div>
            {attemptCount > 2 && (
              <p className="text-red-600 text-xs mt-1">
                {5 - attemptCount} attempts remaining before account lock
              </p>
            )}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting || isAccountLocked}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {requiresMfa ? 'Verifying...' : 'Signing In...'}
            </>
          ) : (
            requiresMfa ? 'Verify & Sign In' : 'Sign In'
          )}
        </Button>

        {/* Forgot Password Link */}
        {!requiresMfa && (
          <div className="text-center">
            <button
              type="button"
              onClick={onSwitchToReset}
              className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
              disabled={isSubmitting}
            >
              Forgot your password?
            </button>
          </div>
        )}

        {/* Back to Password (when in MFA mode) */}
        {requiresMfa && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setRequiresMfa(false);
                setFormData(prev => ({ ...prev, mfaCode: '' }));
                setErrors({});
              }}
              className="text-sm text-gray-600 hover:text-gray-800 hover:underline transition-colors"
              disabled={isSubmitting}
            >
              ← Back to password
            </button>
          </div>
        )}
      </form>

      {/* Switch to Register */}
      {!requiresMfa && (
        <div className="text-center pt-4 border-t">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <button
              onClick={onSwitchToRegister}
              className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
              disabled={isSubmitting}
            >
              Create account
            </button>
          </p>
        </div>
      )}

      {/* Security Notice */}
      <div className="text-center">
        <p className="text-xs text-gray-500 flex items-center justify-center space-x-1">
          <Shield className="w-3 h-3" />
          <span>Protected by enterprise-grade security</span>
        </p>
      </div>
    </Card>
  );
}
