"use client";

import { useState, useEffect } from 'react';
import { Close as X } from '@mui/icons-material';
import { Dialog, DialogContent, IconButton, Box } from '@mui/material';
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

  return (
    <Dialog 
      open={isOpen} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflow: 'hidden'
        }
      }}
    >
      <DialogContent sx={{ p: 0, position: 'relative' }}>
        {/* Close Button */}
        {!(showMFASetup && requireMFA && user && !user.mfaEnabled) && (
          <IconButton
            onClick={handleClose}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              zIndex: 10,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 1)',
              }
            }}
          >
            <X />
          </IconButton>
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
          <Box sx={{ p: 3, textAlign: 'center' }}>
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
      </DialogContent>
    </Dialog>
  );
}
