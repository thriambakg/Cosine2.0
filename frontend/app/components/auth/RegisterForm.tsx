"use client";

import { useState } from 'react';
import { Eye, EyeOff, Mail, Lock, User, Phone, Shield, Loader2, AlertCircle, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import SocialAuthButtons from './SocialAuthButtons';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onClose?: () => void;
}

export default function RegisterForm({ onSwitchToLogin, onClose }: RegisterFormProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
    agreeToMarketing: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);

  const { register } = useAuth();

  // Password strength validation
  const passwordRequirements = [
    { label: 'At least 8 characters', test: (pwd: string) => pwd.length >= 8 },
    { label: 'Contains uppercase letter', test: (pwd: string) => /[A-Z]/.test(pwd) },
    { label: 'Contains lowercase letter', test: (pwd: string) => /[a-z]/.test(pwd) },
    { label: 'Contains number', test: (pwd: string) => /\d/.test(pwd) },
    { label: 'Contains special character', test: (pwd: string) => /[!@#$%^&*(),.?":{}|<>]/.test(pwd) },
  ];

  const getPasswordStrength = () => {
    const passedRequirements = passwordRequirements.filter(req => req.test(formData.password)).length;
    if (passedRequirements < 2) return { strength: 'weak', color: 'bg-red-500', text: 'Weak' };
    if (passedRequirements < 4) return { strength: 'medium', color: 'bg-yellow-500', text: 'Medium' };
    return { strength: 'strong', color: 'bg-green-500', text: 'Strong' };
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // First name validation
    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (formData.firstName.trim().length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    } else if (!/^[a-zA-Z\s-']+$/.test(formData.firstName.trim())) {
      newErrors.firstName = 'First name contains invalid characters';
    }

    // Last name validation
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (formData.lastName.trim().length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    } else if (!/^[a-zA-Z\s-']+$/.test(formData.lastName.trim())) {
      newErrors.lastName = 'Last name contains invalid characters';
    }

    // Email validation
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Phone number validation (optional but must be valid if provided)
    if (formData.phoneNumber && !/^\+?[\d\s-()]{10,}$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else {
      const failedRequirements = passwordRequirements.filter(req => !req.test(formData.password));
      if (failedRequirements.length > 0) {
        newErrors.password = 'Password does not meet security requirements';
      }
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    // Terms validation
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must agree to the Terms of Service';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setIsSubmitting(true);
    
    try {
      // Only send email and password to Cognito
      const result = await register({
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
        termsAccepted: formData.agreeToTerms,
        marketingConsent: formData.agreeToMarketing,
        // The following fields are for backend storage only
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phoneNumber: formData.phoneNumber || undefined,
      });
      if (result.success) {
        // TODO: Send firstName, lastName, phoneNumber to backend/DynamoDB here
        onClose?.();
      } else {
        setErrors({ submit: result.error || 'Registration failed' });
      }
    } catch (error) {
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

  const passwordStrength = getPasswordStrength();

  return (
    <Card className="w-full max-w-md p-6 space-y-6 max-h-[90vh] overflow-y-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
        <p className="text-gray-600">Join Cosine and start trading smarter</p>
      </div>

      {/* Social Authentication */}
      <SocialAuthButtons 
        mode="register" 
        isDisabled={isSubmitting} 
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm font-medium text-gray-700">
              First Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                id="firstName"
                type="text"
                value={formData.firstName}
                onChange={(e) => handleInputChange('firstName', e.target.value)}
                className={`w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                  errors.firstName ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="John"
                disabled={isSubmitting}
                autoComplete="given-name"
                required
              />
            </div>
            {errors.firstName && (
              <p className="text-red-500 text-xs">{errors.firstName}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium text-gray-700">
              Last Name *
            </label>
            <input
              id="lastName"
              type="text"
              value={formData.lastName}
              onChange={(e) => handleInputChange('lastName', e.target.value)}
              className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.lastName ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Doe"
              disabled={isSubmitting}
              autoComplete="family-name"
              required
            />
            {errors.lastName && (
              <p className="text-red-500 text-xs">{errors.lastName}</p>
            )}
          </div>
        </div>

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
              placeholder="john@example.com"
              disabled={isSubmitting}
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

        {/* Phone Number Field (Optional) */}
        <div className="space-y-2">
          <label htmlFor="phoneNumber" className="text-sm font-medium text-gray-700">
            Phone Number <span className="text-gray-500">(Optional)</span>
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              id="phoneNumber"
              type="tel"
              value={formData.phoneNumber}
              onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
              className={`w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.phoneNumber ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="+1 (555) 123-4567"
              disabled={isSubmitting}
              autoComplete="tel"
            />
          </div>
          {errors.phoneNumber && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.phoneNumber}</p>
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
              onFocus={() => setPasswordFocus(true)}
              onBlur={() => setPasswordFocus(false)}
              className={`w-full pl-10 pr-12 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.password ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Create a strong password"
              disabled={isSubmitting}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isSubmitting}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Password Strength Indicator */}
          {formData.password && (passwordFocus || errors.password) && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full transition-all duration-300 ${passwordStrength.color}`}
                    style={{ width: `${(passwordRequirements.filter(req => req.test(formData.password)).length / passwordRequirements.length) * 100}%` }}
                  />
                </div>
                <span className={`text-xs font-medium ${
                  passwordStrength.strength === 'weak' ? 'text-red-600' :
                  passwordStrength.strength === 'medium' ? 'text-yellow-600' : 'text-green-600'
                }`}>
                  {passwordStrength.text}
                </span>
              </div>
              <div className="space-y-1">
                {passwordRequirements.map((req, index) => {
                  const passed = req.test(formData.password);
                  return (
                    <div key={index} className="flex items-center space-x-2">
                      {passed ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <X className="w-3 h-3 text-gray-300" />
                      )}
                      <span className={`text-xs ${passed ? 'text-green-600' : 'text-gray-500'}`}>
                        {req.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {errors.password && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.password}</p>
            </div>
          )}
        </div>

        {/* Confirm Password Field */}
        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
            Confirm Password *
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
              className={`w-full pl-10 pr-12 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                errors.confirmPassword ? 'border-red-500' : 
                formData.confirmPassword && formData.password === formData.confirmPassword ? 'border-green-500' : 'border-gray-300'
              }`}
              placeholder="Confirm your password"
              disabled={isSubmitting}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isSubmitting}
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {formData.confirmPassword && formData.password === formData.confirmPassword && !errors.confirmPassword && (
            <div className="flex items-center space-x-1">
              <Check className="w-4 h-4 text-green-500" />
              <p className="text-green-500 text-sm">Passwords match</p>
            </div>
          )}
          {errors.confirmPassword && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.confirmPassword}</p>
            </div>
          )}
        </div>

        {/* Terms and Conditions */}
        <div className="space-y-3">
          <div className="flex items-start space-x-2">
            <input
              id="agreeToTerms"
              type="checkbox"
              checked={formData.agreeToTerms}
              onChange={(e) => handleInputChange('agreeToTerms', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5"
              disabled={isSubmitting}
              required
            />
            <label htmlFor="agreeToTerms" className="text-sm text-gray-700">
              I agree to the{' '}
              <a href="/terms" className="text-blue-600 hover:text-blue-800 hover:underline" target="_blank">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-blue-600 hover:text-blue-800 hover:underline" target="_blank">
                Privacy Policy
              </a>
              *
            </label>
          </div>
          {errors.agreeToTerms && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.agreeToTerms}</p>
            </div>
          )}

          <div className="flex items-start space-x-2">
            <input
              id="agreeToMarketing"
              type="checkbox"
              checked={formData.agreeToMarketing}
              onChange={(e) => handleInputChange('agreeToMarketing', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5"
              disabled={isSubmitting}
            />
            <label htmlFor="agreeToMarketing" className="text-sm text-gray-700">
              I would like to receive product updates and trading insights via email
            </label>
          </div>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-red-700 text-sm">{errors.submit}</p>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Account...
            </>
          ) : (
            'Create Account'
          )}
        </Button>
      </form>

      {/* Switch to Login */}
      <div className="text-center pt-4 border-t">
        <p className="text-sm text-gray-600">
          Already have an account?{' '}
          <button
            onClick={onSwitchToLogin}
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
            disabled={isSubmitting}
          >
            Sign in
          </button>
        </p>
      </div>

      {/* Security Notice */}
      <div className="text-center">
        <p className="text-xs text-gray-500 flex items-center justify-center space-x-1">
          <Shield className="w-3 h-3" />
          <span>Your data is encrypted and secure</span>
        </p>
      </div>
    </Card>
  );
}
