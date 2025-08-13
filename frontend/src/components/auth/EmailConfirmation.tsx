"use client";

import { useState, useRef, useEffect } from 'react';
import { 
  Card,
  Typography,
  Button,
  Box,
  TextField,
  Alert,
  CircularProgress,
  IconButton
} from '@mui/material';
import { 
  Email,
  Close,
  Refresh
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';

interface EmailConfirmationProps {
  email: string;
  onClose: () => void;
  onConfirmed: () => void;
}

export default function EmailConfirmation({ email, onClose, onConfirmed }: EmailConfirmationProps) {
  const [code, setCode] = useState(Array(6).fill(''));
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { confirmSignUp, resendConfirmationCode } = useAuth();

  useEffect(() => {
    // Focus the first input on mount
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    setError(''); // Clear error when user types

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    // Handle backspace
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    // Handle paste
    else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        const digits = text.replace(/\D/g, '').slice(0, 6);
        const newCode = Array(6).fill('');
        for (let i = 0; i < digits.length; i++) {
          newCode[i] = digits[i];
        }
        setCode(newCode);
        // Focus the next empty input or last input
        const nextIndex = Math.min(digits.length, 5);
        inputRefs.current[nextIndex]?.focus();
      });
    }
  };

  const handleConfirm = async () => {
    const verificationCode = code.join('');
    
    if (verificationCode.length !== 6) {
      setError('Please enter the complete 6-digit code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await confirmSignUp(email, verificationCode);
      
      if (result.success) {
        onConfirmed();
      } else {
        setError(result.error || 'Invalid verification code. Please try again.');
        // Clear the code on error
        setCode(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      }
    } catch (error) {
      setError('An unexpected error occurred. Please try again.');
      setCode(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    setError('');

    try {
      const result = await resendConfirmationCode(email);
      if (result.success) {
        // Show success message briefly
        setError(''); 
        // Could show success toast here
      } else {
        setError(result.error || 'Failed to resend code. Please try again.');
      }
    } catch (error) {
      setError('Failed to resend code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

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
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        zIndex: 1300,
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 480,
          p: 4,
          mx: 2,
          backgroundColor: 'white',
          borderRadius: 2,
          boxShadow: 3,
          position: 'relative',
          '&:hover': {
            backgroundColor: 'white', // Prevent transparency on hover
          },
        }}
      >
        {/* Close Button */}
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 16,
            top: 16,
            color: 'grey.500',
          }}
        >
          <Close />
        </IconButton>

        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2,
            }}
          >
            <Email sx={{ color: 'white', fontSize: 32 }} />
          </Box>
          <Typography variant="h5" fontWeight="bold" gutterBottom>
            Check Your Email
          </Typography>
          <Typography variant="body2" color="text.secondary">
            We sent a verification code to
          </Typography>
          <Typography variant="body2" fontWeight="medium" color="primary.main">
            {email}
          </Typography>
        </Box>

        {/* Code Input */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
            Enter the 6-digit code from your email
          </Typography>
          
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              justifyContent: 'center',
              mb: 2,
            }}
          >
            {code.map((digit, index) => (
              <TextField
                key={index}
                inputRef={(el) => (inputRefs.current[index] = el)}
                value={digit}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                inputProps={{
                  maxLength: 1,
                  style: {
                    textAlign: 'center',
                    fontSize: '24px',
                    fontWeight: 'bold',
                    padding: '16px 0',
                  },
                }}
                sx={{
                  width: 56,
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'white',
                    '& fieldset': {
                      borderColor: error ? 'error.main' : 'grey.300',
                      borderWidth: 2,
                    },
                    '&:hover fieldset': {
                      borderColor: error ? 'error.main' : 'primary.main',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: error ? 'error.main' : 'primary.main',
                    },
                  },
                }}
                disabled={isLoading}
              />
            ))}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>

        {/* Confirm Button */}
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleConfirm}
          disabled={code.join('').length !== 6 || isLoading}
          sx={{ mb: 2 }}
        >
          {isLoading ? (
            <>
              <CircularProgress size={20} sx={{ mr: 1 }} />
              Verifying...
            </>
          ) : (
            'Verify Email'
          )}
        </Button>

        {/* Resend Code */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Didn't receive the code?
          </Typography>
          <Button
            variant="text"
            onClick={handleResendCode}
            disabled={isResending}
            startIcon={isResending ? <CircularProgress size={16} /> : <Refresh />}
          >
            {isResending ? 'Sending...' : 'Resend Code'}
          </Button>
        </Box>
      </Card>
    </Box>
  );
}
