"use client";

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import MFASetup from './MFASetup';
import { useAuth } from '@/contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'register';
  requireMFA?: boolean;
}

type AuthModalMode = 'login' | 'register' | 'reset' | 'mfa-setup';

export default function AuthModal({ 
  isOpen, 
  onClose, 
  defaultMode = 'login',
  requireMFA = false 
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(defaultMode);
  const [showMFASetup, setShowMFASetup] = useState(false);
  
  const { user, isAuthenticated } = useAuth();

  // Close modal if user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && !showMFASetup) {
      onClose();
    }
  }, [isAuthenticated, showMFASetup, onClose]);

  // Reset mode when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setShowMFASetup(false);
    }
  }, [isOpen, defaultMode]);

  // Show MFA setup after successful registration if required
  useEffect(() => {
    if (isAuthenticated && requireMFA && user && !user.mfaEnabled) {
      setShowMFASetup(true);
    }
  }, [isAuthenticated, requireMFA, user]);

  const handleClose = () => {
    if (showMFASetup && requireMFA && user && !user.mfaEnabled) {
      // Don't allow closing if MFA setup is required
      return;
    }
    onClose();
  };

  const handleMFAComplete = () => {
    setShowMFASetup(false);
    onClose();
  };

  const handleMFASkip = () => {
    if (!requireMFA) {
      setShowMFASetup(false);
      onClose();
    }
  };

  const handleSwitchToRegister = () => {
    setMode('register');
  };

  const handleSwitchToLogin = () => {
    setMode('login');
  };

  const handleSwitchToReset = () => {
    setMode('reset');
  };

  const handleAuthSuccess = () => {
    if (requireMFA && user && !user.mfaEnabled) {
      setShowMFASetup(true);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal Content */}
      <div className="relative w-full max-w-md">
        {/* Close Button */}
        {!(showMFASetup && requireMFA && user && !user.mfaEnabled) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="absolute -top-12 right-0 text-white hover:text-gray-300 hover:bg-white/10 z-10"
          >
            <X className="w-5 h-5" />
            <span className="sr-only">Close</span>
          </Button>
        )}

        {/* Content */}
        {showMFASetup ? (
          <MFASetup
            onComplete={handleMFAComplete}
            onSkip={requireMFA ? undefined : handleMFASkip}
            isOptional={!requireMFA}
          />
        ) : mode === 'login' ? (
          <LoginForm
            onSwitchToRegister={handleSwitchToRegister}
            onSwitchToReset={handleSwitchToReset}
            onClose={handleAuthSuccess}
          />
        ) : mode === 'register' ? (
          <RegisterForm
            onSwitchToLogin={handleSwitchToLogin}
            onClose={handleAuthSuccess}
          />
        ) : mode === 'reset' ? (
          <div className="bg-white rounded-lg p-6 space-y-4">
            <h2 className="text-2xl font-bold text-gray-900">Reset Password</h2>
            <p className="text-gray-600">
              Password reset functionality will be implemented in the next phase.
            </p>
            <Button onClick={handleSwitchToLogin} className="w-full">
              Back to Login
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
