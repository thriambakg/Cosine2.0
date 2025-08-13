"use client";

import { useState, useEffect } from 'react';
import { Close as X } from '@mui/icons-material';
import { Box, Typography, Button } from '@mui/material';
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
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        zIndex: 1300,
      }}
    >
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
        <Box sx={{ p: 3, textAlign: 'center', backgroundColor: 'white', borderRadius: 2, boxShadow: 3 }}>
          <Typography variant="h5" fontWeight={600} color="text.primary" mb={2}>
            Reset Password
          </Typography>
          <Typography variant="body1" color="text.secondary" mb={3}>
            Password reset functionality will be implemented in the next phase.
          </Typography>
          <Button 
            variant="contained" 
            onClick={handleSwitchToLogin} 
            fullWidth
            sx={{ mt: 2 }}
          >
            Back to Login
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
