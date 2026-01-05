import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import PasswordResetForm from './PasswordResetForm';
import MFASetup from './MFASetup';
import { useAuth } from '@/contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'register';
  requireMFA?: boolean;
  onRegistrationSuccess?: () => void;
}

type AuthModalMode = 'login' | 'register' | 'reset' | 'mfa-setup';

export default function AuthModal({ 
  isOpen, 
  onClose, 
  defaultMode = 'login',
  requireMFA = false,
  onRegistrationSuccess
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(defaultMode);
  const [showMFASetup, setShowMFASetup] = useState(false);
  
  const { user, isAuthenticated } = useAuth();

  // Close modal if user becomes authenticated (but only if they're actually logged in)
  // Add a small delay to ensure the authentication is stable
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isAuthenticated && user && !showMFASetup) {
      timeoutId = setTimeout(() => {
        onClose();
      }, 100); // Small delay to ensure authentication is stable
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isAuthenticated, user, showMFASetup, onClose]);

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
      {/* Backdrop Blur Overlay */}
            <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          zIndex: -1,
        }}
      />

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
          onRegistrationSuccess={onRegistrationSuccess}
        />
      ) : mode === 'reset' ? (
        <PasswordResetForm
          onSwitchToLogin={handleSwitchToLogin}
          onClose={onClose}
        />
      ) : null}
    </Box>
  );
}
