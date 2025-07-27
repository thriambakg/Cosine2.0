"use client";

import { useState, useEffect } from 'react';
import { Shield, Smartphone, Copy, Check, AlertCircle, Loader2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'secret') {
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
      } else {
        setBackupCodesCopied(true);
        setTimeout(() => setBackupCodesCopied(false), 2000);
      }
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (type === 'secret') {
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
      } else {
        setBackupCodesCopied(true);
        setTimeout(() => setBackupCodesCopied(false), 2000);
      }
    }
  };

  const renderIntroStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
          <Shield className="w-8 h-8 text-blue-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Enhanced Security</h2>
          <p className="text-gray-600 mt-2">
            {isOptional 
              ? 'Secure your account with two-factor authentication (recommended)'
              : 'Two-factor authentication is required for your account security'
            }
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg">
          <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="font-medium text-blue-900">What is 2FA?</h3>
            <p className="text-blue-700 text-sm mt-1">
              Two-factor authentication adds an extra layer of security by requiring a code from your phone in addition to your password.
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3 p-4 bg-green-50 rounded-lg">
          <Smartphone className="w-5 h-5 text-green-600 mt-0.5" />
          <div>
            <h3 className="font-medium text-green-900">Authenticator App Required</h3>
            <p className="text-green-700 text-sm mt-1">
              You'll need an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator installed on your phone.
            </p>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500">
          <p>This process takes about 2 minutes to complete</p>
        </div>
      </div>

      <div className="flex flex-col space-y-3">
        <Button 
          onClick={() => setStep('setup')}
          className="w-full"
        >
          Set Up 2FA
        </Button>
        {isOptional && onSkip && (
          <Button 
            variant="outline" 
            onClick={onSkip}
            className="w-full"
          >
            Skip for Now
          </Button>
        )}
      </div>
    </div>
  );

  const renderSetupStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Set Up Your Authenticator</h2>
        <p className="text-gray-600 mt-2">
          Scan the QR code or enter the setup key manually
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">Generating setup code...</span>
        </div>
      ) : qrCodeData ? (
        <div className="space-y-6">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="p-4 bg-white border-2 border-gray-200 rounded-lg">
              <div className="w-48 h-48 bg-gray-100 rounded flex items-center justify-center">
                {/* In a real implementation, you would render the actual QR code here */}
                <div className="text-center space-y-2">
                  <QrCode className="w-12 h-12 text-gray-400 mx-auto" />
                  <p className="text-xs text-gray-500">QR Code</p>
                  <p className="text-xs text-gray-400">
                    Scan with your authenticator app
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Manual Setup */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-900">Can't scan? Enter this code manually:</h3>
            <div className="p-3 bg-gray-50 border rounded-md">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">Account:</p>
                  <p className="text-sm text-gray-600">{qrCodeData.accountName}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">Secret Key:</p>
                  <p className="font-mono text-sm text-gray-600 break-all">{qrCodeData.secret}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(qrCodeData.secret, 'secret')}
                  className="ml-2 flex-shrink-0"
                >
                  {secretCopied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="font-medium text-blue-900 mb-2">Instructions:</h4>
            <ol className="text-blue-700 text-sm space-y-1 list-decimal list-inside">
              <li>Open your authenticator app</li>
              <li>Tap "Add account" or "+" button</li>
              <li>Scan the QR code or enter the secret key</li>
              <li>Enter the 6-digit code shown in your app below</li>
            </ol>
          </div>

          <Button 
            onClick={() => setStep('verify')}
            className="w-full"
          >
            I've Added the Account
          </Button>
        </div>
      ) : null}

      {errors.setup && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <p className="text-red-700 text-sm">{errors.setup}</p>
          </div>
        </div>
      )}

      <div className="text-center">
        <Button 
          variant="outline" 
          onClick={() => setStep('intro')}
          disabled={isLoading}
        >
          ← Back
        </Button>
      </div>
    </div>
  );

  const renderVerifyStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Verify Setup</h2>
        <p className="text-gray-600 mt-2">
          Enter the 6-digit code from your authenticator app
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="verificationCode" className="text-sm font-medium text-gray-700">
            Verification Code *
          </label>
          <div className="relative">
            <Shield className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              id="verificationCode"
              type="text"
              value={verificationCode}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setVerificationCode(value);
                if (errors.verification) {
                  setErrors({});
                }
              }}
              className={`w-full pl-10 pr-4 py-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-center text-lg font-mono tracking-wider ${
                errors.verification ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="000000"
              disabled={isLoading}
              maxLength={6}
              pattern="[0-9]{6}"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          {errors.verification && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-red-500 text-sm">{errors.verification}</p>
            </div>
          )}
          <p className="text-xs text-gray-500 text-center">
            Enter the 6-digit code currently displayed in your authenticator app
          </p>
        </div>

        <Button
          onClick={handleVerifySetup}
          disabled={verificationCode.length !== 6 || isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify & Complete Setup'
          )}
        </Button>
      </div>

      {/* Backup Codes Display (if available) */}
      {backupCodes.length > 0 && (
        <div className="space-y-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-yellow-600" />
            <h3 className="font-medium text-yellow-900">Backup Codes</h3>
          </div>
          <p className="text-yellow-700 text-sm">
            Save these backup codes in a safe place. You can use them to access your account if you lose your phone.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, index) => (
              <div key={index} className="font-mono text-sm bg-white p-2 rounded border">
                {code}
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}
            className="w-full"
          >
            {backupCodesCopied ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                Copy All Codes
              </>
            )}
          </Button>
        </div>
      )}

      <div className="text-center">
        <Button 
          variant="outline" 
          onClick={() => setStep('setup')}
          disabled={isLoading}
        >
          ← Back to Setup
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
      {step === 'intro' && renderIntroStep()}
      {step === 'setup' && renderSetupStep()}
      {step === 'verify' && renderVerifyStep()}

      {/* Security Notice */}
      <div className="text-center pt-4 border-t">
        <p className="text-xs text-gray-500 flex items-center justify-center space-x-1">
          <Shield className="w-3 h-3" />
          <span>Your security is our top priority</span>
        </p>
      </div>
    </Card>
  );
}
