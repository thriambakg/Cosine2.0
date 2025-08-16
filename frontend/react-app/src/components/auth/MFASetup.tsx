
import { useState, useEffect } from 'react';
import { Shield, Smartphone, ContentCopy, Check, Warning, QrCode } from '@mui/icons-material';
import { Card, Button, Alert, CircularProgress, Box, Typography, TextField } from '@mui/material';
import { useAuth } from '@/contexts/AuthContext';

interface MFASetupProps {
  onComplete: () => void;
  onSkip?: () => void;
  isOptional?: boolean;
}

export default function MFASetup({ onComplete, onSkip, isOptional = false }: MFASetupProps) {
  const [step, setStep] = useState<'intro' | 'setup' | 'verify'>('intro');
  const [qrCodeData, setQrCodeData] = useState<{
    qrCodeUrl: string;
    secret: string;
    accountName: string;
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesCopied, setBackupCodesCopied] = useState(false);

  const { enableMfa, confirmMfa } = useAuth();

  // Start MFA setup when component mounts or when setup step is reached
  useEffect(() => {
    if (step === 'setup' && !qrCodeData) {
      initializeMFASetup();
    }
  }, [step]);

  const initializeMFASetup = async () => {
    setIsLoading(true);
    try {
      const result = await enableMfa();
      if (result.success && result.qrCode && result.secret) {
        setQrCodeData({
          qrCodeUrl: result.qrCode,
          secret: result.secret,
          accountName: 'Cosine Trading Account',
        });
        setErrors({});
      } else {
        setErrors({ setup: result.error || 'Failed to initialize MFA setup' });
      }
    } catch (error) {
      setErrors({ setup: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySetup = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setErrors({ verification: 'Please enter a valid 6-digit code' });
      return;
    }

    if (!qrCodeData?.secret) {
      setErrors({ verification: 'MFA setup not initialized' });
      return;
    }

    setIsLoading(true);
    try {
      const result = await confirmMfa(verificationCode, qrCodeData.secret);
      if (result.success) {
        setErrors({});
        onComplete();
      } else {
        setErrors({ verification: result.error || 'Invalid verification code' });
      }
    } catch (error) {
      setErrors({ verification: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'secret' | 'backup') => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      
      if (type === 'secret') {
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
      } else {
        setBackupCodesCopied(true);
        setTimeout(() => setBackupCodesCopied(false), 2000);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const renderIntroStep = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{
          width: 64,
          height: 64,
          background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
          borderRadius: '0px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          border: '2px solid #b91c1c'
        }}>
          <Shield sx={{ fontSize: 32, color: '#ffffff' }} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 800, textTransform: 'uppercase' }}>
            Enhanced Security
          </Typography>
          <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1 }}>
            {isOptional 
              ? 'Secure your account with two-factor authentication (recommended)'
              : 'Two-factor authentication is required for your account security'
            }
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          gap: 2, 
          p: 2, 
          backgroundColor: 'rgba(220, 38, 38, 0.1)', 
          borderRadius: '0px',
          border: '1px solid #dc2626'
        }}>
          <Shield sx={{ fontSize: 20, color: '#dc2626', mt: 0.5 }} />
          <Box>
            <Typography variant="subtitle2" sx={{ color: '#dc2626', fontWeight: 600 }}>
              What is 2FA?
            </Typography>
            <Typography variant="body2" sx={{ color: '#fca5a5', mt: 0.5 }}>
              Two-factor authentication adds an extra layer of security by requiring a code from your phone in addition to your password.
            </Typography>
          </Box>
        </Box>

        <Box sx={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          gap: 2, 
          p: 2, 
          backgroundColor: 'rgba(34, 197, 94, 0.1)', 
          borderRadius: '0px',
          border: '1px solid #22c55e'
        }}>
          <Smartphone sx={{ fontSize: 20, color: '#22c55e', mt: 0.5 }} />
          <Box>
            <Typography variant="subtitle2" sx={{ color: '#22c55e', fontWeight: 600 }}>
              Authenticator App Required
            </Typography>
            <Typography variant="body2" sx={{ color: '#86efac', mt: 0.5 }}>
              You'll need an authenticator app like Google Authenticator or Authy installed on your phone.
            </Typography>
          </Box>
        </Box>

        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            This process takes about 2 minutes to complete
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Button 
          onClick={() => setStep('setup')}
          fullWidth
          sx={{
            backgroundColor: '#dc2626',
            color: '#ffffff',
            borderRadius: '0px',
            textTransform: 'uppercase',
            fontWeight: 600,
            '&:hover': {
              backgroundColor: '#b91c1c',
            }
          }}
        >
          Set Up 2FA
        </Button>
        {isOptional && onSkip && (
          <Button 
            variant="outlined" 
            onClick={onSkip}
            fullWidth
            sx={{
              borderColor: '#374151',
              color: '#e2e8f0',
              borderRadius: '0px',
              textTransform: 'uppercase',
              fontWeight: 600,
              '&:hover': {
                borderColor: '#dc2626',
                color: '#dc2626',
              }
            }}
          >
            Skip for Now
          </Button>
        )}
      </Box>
    </Box>
  );

  const renderSetupStep = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 800, textTransform: 'uppercase' }}>
          Set Up Your Authenticator
        </Typography>
        <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1 }}>
          Scan the QR code or enter the setup key manually
        </Typography>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <CircularProgress sx={{ color: '#dc2626' }} />
          <Typography sx={{ ml: 2, color: '#e2e8f0' }}>Generating setup code...</Typography>
        </Box>
      ) : qrCodeData ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* QR Code */}
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ 
              p: 2, 
              backgroundColor: 'rgba(31, 41, 55, 0.8)', 
              border: '2px solid #374151', 
              borderRadius: '0px' 
            }}>
              <Box sx={{ 
                width: 192, 
                height: 192, 
                backgroundColor: 'rgba(15, 23, 42, 0.8)', 
                borderRadius: '0px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                border: '1px solid #374151'
              }}>
                {/* In a real implementation, you would render the actual QR code here */}
                <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <QrCode sx={{ fontSize: 48, color: '#9ca3af', mx: 'auto' }} />
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>QR Code</Typography>
                  <Typography variant="caption" sx={{ color: '#6b7280' }}>
                    Scan with your authenticator app
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Manual Setup */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
              Can't scan? Enter this code manually:
            </Typography>
            <Box sx={{ 
              p: 2, 
              backgroundColor: 'rgba(31, 41, 55, 0.8)', 
              border: '1px solid #374151', 
              borderRadius: '0px' 
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    Account:
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block' }}>
                    {qrCodeData.accountName}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    Secret Key:
                  </Typography>
                  <Typography variant="caption" sx={{ 
                    fontFamily: 'monospace', 
                    color: '#9ca3af', 
                    wordBreak: 'break-all',
                    display: 'block'
                  }}>
                    {qrCodeData.secret}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => copyToClipboard(qrCodeData.secret, 'secret')}
                  sx={{
                    ml: 1,
                    flexShrink: 0,
                    borderColor: '#374151',
                    color: '#e2e8f0',
                    borderRadius: '0px',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    '&:hover': {
                      borderColor: '#dc2626',
                      color: '#dc2626',
                    }
                  }}
                >
                  {secretCopied ? (
                    <>
                      <Check sx={{ fontSize: 16, mr: 0.5 }} />
                      Copied
                    </>
                  ) : (
                    <>
                      <ContentCopy sx={{ fontSize: 16, mr: 0.5 }} />
                      Copy
                    </>
                  )}
                </Button>
              </Box>
            </Box>
          </Box>

          {/* Instructions */}
          <Box sx={{ 
            p: 2, 
            backgroundColor: 'rgba(220, 38, 38, 0.1)', 
            border: '1px solid #dc2626', 
            borderRadius: '0px' 
          }}>
            <Typography variant="subtitle2" sx={{ color: '#dc2626', fontWeight: 600, mb: 1 }}>
              Instructions:
            </Typography>
            <Box component="ol" sx={{ color: '#fca5a5', fontSize: '0.875rem', pl: 2, m: 0 }}>
              <li>Open your authenticator app</li>
              <li>Tap "Add account" or "+" button</li>
              <li>Scan the QR code or enter the secret key</li>
              <li>Enter the 6-digit code shown in your app below</li>
            </Box>
          </Box>

          <Button 
            onClick={() => setStep('verify')}
            fullWidth
            sx={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              borderRadius: '0px',
              textTransform: 'uppercase',
              fontWeight: 600,
              '&:hover': {
                backgroundColor: '#b91c1c',
              }
            }}
          >
            I've Added the Account
          </Button>
        </Box>
      ) : null}

      {errors.setup && (
        <Alert 
          severity="error" 
          sx={{ 
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #dc2626',
            borderRadius: '0px',
            '& .MuiAlert-message': {
              color: '#fca5a5',
              fontSize: '0.875rem'
            }
          }}
        >
          {errors.setup}
        </Alert>
      )}

      <Box sx={{ textAlign: 'center' }}>
        <Button 
          variant="outlined" 
          onClick={() => setStep('intro')}
          disabled={isLoading}
          sx={{
            borderColor: '#374151',
            color: '#e2e8f0',
            borderRadius: '0px',
            textTransform: 'uppercase',
            fontWeight: 600,
            '&:hover': {
              borderColor: '#dc2626',
              color: '#dc2626',
            }
          }}
        >
          ← Back
        </Button>
      </Box>
    </Box>
  );

  const renderVerifyStep = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 800, textTransform: 'uppercase' }}>
          Verify Setup
        </Typography>
        <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1 }}>
          Enter the 6-digit code from your authenticator app
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
            Verification Code *
          </Typography>
          <Box sx={{ position: 'relative' }}>
            <Shield sx={{ 
              position: 'absolute', 
              left: 12, 
              top: '50%', 
              transform: 'translateY(-50%)', 
              color: '#9ca3af', 
              fontSize: 20 
            }} />
            <TextField
              type="text"
              value={verificationCode}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setVerificationCode(value);
                if (errors.verification) {
                  setErrors({});
                }
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  pl: 4,
                  borderRadius: '0px',
                  fontSize: '1.125rem',
                  color: '#ffffff',
                  backgroundColor: 'rgba(31, 41, 55, 0.8)',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  letterSpacing: '0.2em',
                  '& fieldset': {
                    borderColor: errors.verification ? '#dc2626' : '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#dc2626',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#dc2626',
                    borderWidth: '2px',
                  }
                },
                '& .MuiOutlinedInput-input': {
                  px: 2,
                  py: 1.5,
                  '&::placeholder': {
                    color: '#6b7280',
                    opacity: 1
                  }
                }
              }}
              placeholder="000000"
              disabled={isLoading}
              inputProps={{
                maxLength: 6,
                pattern: '[0-9]{6}',
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                autoFocus: true,
                required: true
              }}
            />
          </Box>
          {errors.verification && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Warning sx={{ fontSize: 16, color: '#dc2626' }} />
              <Typography variant="caption" sx={{ color: '#dc2626' }}>
                {errors.verification}
              </Typography>
            </Box>
          )}
          <Typography variant="caption" sx={{ color: '#9ca3af', textAlign: 'center' }}>
            Enter the 6-digit code currently displayed in your authenticator app
          </Typography>
        </Box>

        <Button
          onClick={handleVerifySetup}
          disabled={verificationCode.length !== 6 || isLoading}
          fullWidth
          sx={{
            backgroundColor: '#dc2626',
            color: '#ffffff',
            borderRadius: '0px',
            textTransform: 'uppercase',
            fontWeight: 600,
            '&:hover': {
              backgroundColor: '#b91c1c',
            },
            '&:disabled': {
              opacity: 0.5
            }
          }}
        >
          {isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#ffffff' }} />
              Verifying...
            </Box>
          ) : (
            'Verify & Complete Setup'
          )}
        </Button>
      </Box>

      {/* Backup Codes Display (if available) */}
      {backupCodes.length > 0 && (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 2, 
          p: 2, 
          backgroundColor: 'rgba(245, 158, 11, 0.1)', 
          border: '1px solid #f59e0b', 
          borderRadius: '0px' 
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Shield sx={{ fontSize: 20, color: '#f59e0b' }} />
            <Typography variant="subtitle2" sx={{ color: '#f59e0b', fontWeight: 600 }}>
              Backup Codes
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#fbbf24' }}>
            Save these backup codes in a safe place. You can use them to access your account if you lose your phone.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            {backupCodes.map((code, index) => (
              <Box key={index} sx={{ 
                fontFamily: 'monospace', 
                fontSize: '0.875rem', 
                backgroundColor: 'rgba(31, 41, 55, 0.8)', 
                p: 1, 
                borderRadius: '0px', 
                border: '1px solid #374151',
                color: '#e2e8f0'
              }}>
                {code}
              </Box>
            ))}
          </Box>
          <Button
            variant="outlined"
            size="small"
            onClick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}
            fullWidth
            sx={{
              borderColor: '#f59e0b',
              color: '#f59e0b',
              borderRadius: '0px',
              textTransform: 'uppercase',
              fontWeight: 600,
              '&:hover': {
                borderColor: '#fbbf24',
                color: '#fbbf24',
              }
            }}
          >
            {backupCodesCopied ? (
              <>
                <Check sx={{ fontSize: 16, mr: 0.5 }} />
                Copied
              </>
            ) : (
              <>
                <ContentCopy sx={{ fontSize: 16, mr: 0.5 }} />
                Copy All Codes
              </>
            )}
          </Button>
        </Box>
      )}

      <Box sx={{ textAlign: 'center' }}>
        <Button 
          variant="outlined" 
          onClick={() => setStep('setup')}
          disabled={isLoading}
          sx={{
            borderColor: '#374151',
            color: '#e2e8f0',
            borderRadius: '0px',
            textTransform: 'uppercase',
            fontWeight: 600,
            '&:hover': {
              borderColor: '#dc2626',
              color: '#dc2626',
            }
          }}
        >
          ← Back to Setup
        </Button>
      </Box>
    </Box>
  );

  return (
    <Card sx={{
      width: '100%',
      maxWidth: 448,
      p: 3,
      maxHeight: '90vh',
      overflow: 'auto',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderRadius: '0px',
      boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.5)',
      border: '2px solid #374151',
      backdropFilter: 'blur(16px)'
    }}>
      {step === 'intro' && renderIntroStep()}
      {step === 'setup' && renderSetupStep()}
      {step === 'verify' && renderVerifyStep()}

      {/* Security Notice */}
      <Box sx={{ textAlign: 'center', pt: 2, borderTop: '1px solid #374151', mt: 2 }}>
        <Typography variant="caption" sx={{ 
          color: '#9ca3af', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: 0.5 
        }}>
          <Shield sx={{ fontSize: 12 }} />
          <span>Your security is our top priority</span>
        </Typography>
      </Box>
    </Card>
  );
}
