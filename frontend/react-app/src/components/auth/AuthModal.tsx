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

  // Close modal if user becomes authenticated AND verified
  // Don't close if user is registered but not yet verified (emailVerified = false)
  useEffect(() => {
    console.log('🚪 AuthModal: Checking if should close:', {
      isAuthenticated,
      hasUser: !!user,
      emailVerified: user?.emailVerified,
      showMFASetup,
      mode
    });
    
    let timeoutId: NodeJS.Timeout;
    // Only close if user is authenticated, has user data, is verified, and not in MFA setup
    if (isAuthenticated && user && user.emailVerified && !showMFASetup) {
      console.log('🚪 AuthModal: User is authenticated and verified - closing modal in 100ms');
      timeoutId = setTimeout(() => {
        console.log('🚪 AuthModal: Executing onClose()');
        onClose();
      }, 100);
    } else if (isAuthenticated && user && !user.emailVerified) {
      console.log('🚪 AuthModal: User is authenticated but NOT verified - keeping modal open');
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isAuthenticated, user, showMFASetup, onClose, mode]);

  // Reset mode when modal opens/closes
  useEffect(() => {
    console.log('🔄 AuthModal: isOpen or defaultMode changed:', { isOpen, defaultMode, currentMode: mode });
    if (isOpen) {
      console.log('🔄 AuthModal: Resetting mode to:', defaultMode);
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
    console.log('🔄 AuthModal: handleSwitchToRegister called');
    setMode('register');
  };

  const handleSwitchToLogin = () => {
    console.log('🔄 AuthModal: handleSwitchToLogin called');
    setMode('login');
  };

  const handleSwitchToReset = () => {
    setMode('reset');
  };

  const handleAuthSuccess = () => {
    console.log('✅ AuthModal: handleAuthSuccess called', { requireMFA, hasUser: !!user, mfaEnabled: user?.mfaEnabled });
    if (requireMFA && user && !user.mfaEnabled) {
      console.log('✅ AuthModal: Showing MFA setup');
      setShowMFASetup(true);
    } else {
      console.log('✅ AuthModal: Calling onClose from handleAuthSuccess');
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
