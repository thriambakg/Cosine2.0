"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin' | 'premium';
  verified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  lastLogin?: string;
  subscription?: {
    plan: 'free' | 'premium' | 'enterprise';
    status: 'active' | 'inactive' | 'trial';
    expiresAt?: string;
  };
  // Cognito specific fields
  cognitoSub: string;
  emailVerified: boolean;
  phoneNumber?: string;
  phoneVerified?: boolean;
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<{ success: boolean; error?: string; requiresMfa?: boolean }>;
  register: (userData: RegisterData) => Promise<{ success: boolean; error?: string; verificationRequired?: boolean }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  confirmResetPassword: (email: string, code: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  verifyEmail: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  resendVerificationCode: (email: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (userData: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  enableMfa: () => Promise<{ success: boolean; qrCode?: string; secret?: string; error?: string }>;
  confirmMfa: (code: string, secret: string) => Promise<{ success: boolean; error?: string }>;
  disableMfa: (mfaCode: string) => Promise<{ success: boolean; error?: string }>;
  refreshToken: () => Promise<boolean>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  termsAccepted: boolean;
  marketingConsent?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user;

  // Initialize auth state on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  // Auto-refresh token every 30 minutes
  useEffect(() => {
    if (isAuthenticated) {
      const interval = setInterval(() => {
        refreshToken();
      }, 30 * 60 * 1000); // 30 minutes

      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const initializeAuth = async () => {
    try {
      setIsLoading(true);
      
      // TODO: Replace with AWS Cognito getCurrentUser
      // import { getCurrentUser } from 'aws-amplify/auth';
      // const cognitoUser = await getCurrentUser();
      
      const token = localStorage.getItem('cosine_auth_token');
      const refreshToken = localStorage.getItem('cosine_refresh_token');
      
      if (token && refreshToken) {
        // TODO: Integrate with AWS Cognito token validation
        const response = await fetch('/api/auth/verify', {
          headers: { 
            Authorization: `Bearer ${token}`,
            'X-Refresh-Token': refreshToken
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        } else {
          // Token invalid, clear storage
          await clearAuthStorage();
        }
      }
    } catch (error) {
      console.error('Auth initialization failed:', error);
      await clearAuthStorage();
    } finally {
      setIsLoading(false);
    }
  };

  const clearAuthStorage = async () => {
    localStorage.removeItem('cosine_auth_token');
    localStorage.removeItem('cosine_refresh_token');
    localStorage.removeItem('cosine_user_data');
    setUser(null);
  };

  const login = async (email: string, password: string, mfaCode?: string) => {
    try {
      setIsLoading(true);
      
      // TODO: Replace with AWS Cognito signIn
      // import { signIn, confirmSignIn } from 'aws-amplify/auth';
      // const result = await signIn({ username: email, password });
      // if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      //   if (!mfaCode) return { success: false, requiresMfa: true };
      //   const confirmResult = await confirmSignIn({ challengeResponse: mfaCode });
      // }
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: email.toLowerCase().trim(), 
          password, 
          mfaCode,
          deviceInfo: {
            userAgent: navigator.userAgent,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp: new Date().toISOString()
          }
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Store tokens securely
        localStorage.setItem('cosine_auth_token', data.accessToken);
        localStorage.setItem('cosine_refresh_token', data.refreshToken);
        localStorage.setItem('cosine_user_data', JSON.stringify(data.user));
        setUser(data.user);
        
        // Log successful login for security auditing
        await logSecurityEvent('login_success', { email, timestamp: new Date().toISOString() });
        
        return { success: true };
      } else {
        // Log failed login attempt
        await logSecurityEvent('login_failed', { email, error: data.error, timestamp: new Date().toISOString() });
        
        return { 
          success: false, 
          error: data.error || 'Login failed',
          requiresMfa: data.requiresMfa 
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      await logSecurityEvent('login_error', { 
        email, 
        error: error instanceof Error ? error.message : 'Unknown error', 
        timestamp: new Date().toISOString() 
      });
      return { success: false, error: 'Network error occurred' };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: RegisterData) => {
    try {
      setIsLoading(true);
      
      // TODO: Replace with AWS Cognito signUp
      // import { signUp } from 'aws-amplify/auth';
      // const result = await signUp({
      //   username: userData.email,
      //   password: userData.password,
      //   options: {
      //     userAttributes: {
      //       email: userData.email,
      //       given_name: userData.firstName,
      //       family_name: userData.lastName,
      //       phone_number: userData.phoneNumber
      //     }
      //   }
      // });
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userData,
          email: userData.email.toLowerCase().trim(),
          registrationSource: 'web',
          deviceInfo: {
            userAgent: navigator.userAgent,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp: new Date().toISOString()
          }
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        await logSecurityEvent('registration_success', { 
          email: userData.email, 
          timestamp: new Date().toISOString() 
        });
        return { success: true, verificationRequired: data.verificationRequired };
      } else {
        await logSecurityEvent('registration_failed', { 
          email: userData.email, 
          error: data.error, 
          timestamp: new Date().toISOString() 
        });
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: 'Network error occurred' };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      const email = user?.email;
      
      // TODO: Replace with AWS Cognito signOut
      // import { signOut } from 'aws-amplify/auth';
      // await signOut({ global: true }); // Global sign out from all devices
      
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
      });
      
      if (email) {
        await logSecurityEvent('logout', { email, timestamp: new Date().toISOString() });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      await clearAuthStorage();
    }
  };

  const resetPassword = async (email: string) => {
    try {
      // TODO: Replace with AWS Cognito resetPassword
      // import { resetPassword } from 'aws-amplify/auth';
      // await resetPassword({ username: email });
      
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const data = await response.json();
      
      if (data.success) {
        await logSecurityEvent('password_reset_requested', { 
          email, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const confirmResetPassword = async (email: string, code: string, newPassword: string) => {
    try {
      // TODO: Replace with AWS Cognito confirmResetPassword
      // import { confirmResetPassword } from 'aws-amplify/auth';
      // await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      
      const response = await fetch('/api/auth/confirm-reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), code, newPassword }),
      });

      const data = await response.json();
      
      if (data.success) {
        await logSecurityEvent('password_reset_completed', { 
          email, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Password reset confirmation error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const verifyEmail = async (email: string, code: string) => {
    try {
      // TODO: Replace with AWS Cognito confirmSignUp
      // import { confirmSignUp } from 'aws-amplify/auth';
      // await confirmSignUp({ username: email, confirmationCode: code });
      
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), code }),
      });

      const data = await response.json();
      
      if (data.success && user) {
        setUser({ ...user, verified: true, emailVerified: true });
        await logSecurityEvent('email_verified', { 
          email, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Email verification error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const resendVerificationCode = async (email: string) => {
    try {
      // TODO: Replace with AWS Cognito resendSignUpCode
      // import { resendSignUpCode } from 'aws-amplify/auth';
      // await resendSignUpCode({ username: email });
      
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const data = await response.json();
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Resend verification error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const updateProfile = async (userData: Partial<User>) => {
    try {
      // TODO: Replace with AWS Cognito updateUserAttributes
      // import { updateUserAttributes } from 'aws-amplify/auth';
      // await updateUserAttributes({
      //   userAttributes: {
      //     given_name: userData.firstName,
      //     family_name: userData.lastName,
      //   }
      // });
      
      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      
      if (data.success && user) {
        const updatedUser = { ...user, ...userData };
        setUser(updatedUser);
        localStorage.setItem('cosine_user_data', JSON.stringify(updatedUser));
        
        await logSecurityEvent('profile_updated', { 
          userId: user.id, 
          changes: Object.keys(userData),
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Profile update error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      // TODO: Replace with AWS Cognito updatePassword
      // import { updatePassword } from 'aws-amplify/auth';
      // await updatePassword({ oldPassword, newPassword });
      
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await response.json();
      
      if (data.success && user) {
        await logSecurityEvent('password_changed', { 
          userId: user.id, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Password change error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const enableMfa = async () => {
    try {
      // TODO: Replace with AWS Cognito associateSoftwareToken
      // import { associateSoftwareToken } from 'aws-amplify/auth';
      // const result = await associateSoftwareToken();
      // return { success: true, secret: result.secretCode };
      
      const response = await fetch('/api/auth/mfa/enable', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
      });

      const data = await response.json();
      return { 
        success: data.success, 
        qrCode: data.qrCode, 
        secret: data.secret, 
        error: data.error 
      };
    } catch (error) {
      console.error('MFA enable error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const confirmMfa = async (code: string, secret: string) => {
    try {
      // TODO: Replace with AWS Cognito verifySoftwareToken
      // import { verifySoftwareToken } from 'aws-amplify/auth';
      // await verifySoftwareToken({ challengeAnswer: code });
      
      const response = await fetch('/api/auth/mfa/confirm', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
        body: JSON.stringify({ code, secret }),
      });

      const data = await response.json();
      
      if (data.success && user) {
        setUser({ ...user, mfaEnabled: true });
        await logSecurityEvent('mfa_enabled', { 
          userId: user.id, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('MFA confirmation error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const disableMfa = async (mfaCode: string) => {
    try {
      // TODO: Replace with AWS Cognito setUserMFAPreference
      // import { setUserMFAPreference } from 'aws-amplify/auth';
      // await setUserMFAPreference({ totp: 'DISABLED' });
      
      const response = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
        body: JSON.stringify({ mfaCode }),
      });

      const data = await response.json();
      
      if (data.success && user) {
        setUser({ ...user, mfaEnabled: false });
        await logSecurityEvent('mfa_disabled', { 
          userId: user.id, 
          timestamp: new Date().toISOString() 
        });
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('MFA disable error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    try {
      const refreshToken = localStorage.getItem('cosine_refresh_token');
      if (!refreshToken) return false;

      // TODO: Replace with AWS Cognito automatic token refresh
      // Cognito SDK handles this automatically
      
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Refresh-Token': refreshToken
        },
      });

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('cosine_auth_token', data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem('cosine_refresh_token', data.refreshToken);
        }
        return true;
      } else {
        await logout();
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      await logout();
      return false;
    }
  };

  const deleteAccount = async () => {
    try {
      if (!user) return { success: false, error: 'No user logged in' };
      
      // TODO: Replace with AWS Cognito deleteUser
      // import { deleteUser } from 'aws-amplify/auth';
      // await deleteUser();
      
      const response = await fetch('/api/auth/delete-account', {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cosine_auth_token')}`
        },
      });

      const data = await response.json();
      
      if (data.success) {
        await logSecurityEvent('account_deleted', { 
          userId: user.id, 
          email: user.email,
          timestamp: new Date().toISOString() 
        });
        await clearAuthStorage();
      }
      
      return { success: data.success, error: data.error };
    } catch (error) {
      console.error('Account deletion error:', error);
      return { success: false, error: 'Network error occurred' };
    }
  };

  // Security event logging
  const logSecurityEvent = async (event: string, data: any) => {
    try {
      // TODO: Integrate with AWS CloudTrail or CloudWatch Logs
      await fetch('/api/auth/security-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          data,
          userAgent: navigator.userAgent,
          ip: 'client-side', // Will be determined on server
          timestamp: new Date().toISOString()
        }),
      });
    } catch (error) {
      console.error('Security logging error:', error);
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout,
    resetPassword,
    confirmResetPassword,
    verifyEmail,
    resendVerificationCode,
    updateProfile,
    changePassword,
    enableMfa,
    confirmMfa,
    disableMfa,
    refreshToken,
    deleteAccount,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
