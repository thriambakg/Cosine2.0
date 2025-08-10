"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  getCurrentUser, 
  signIn, 
  signUp, 
  signOut, 
  confirmSignUp, 
  resendSignUpCode,
  resetPassword as cognitoResetPassword,
  confirmResetPassword as cognitoConfirmResetPassword,
  updatePassword,
  fetchUserAttributes,
  updateUserAttributes,
  deleteUser,
  signInWithRedirect,
  AuthUser
} from 'aws-amplify/auth';

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
  loginWithProvider: (provider: 'Google' | 'Microsoft') => Promise<void>;
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

// Security event logging function (simplified for now)
const logSecurityEvent = async (event: string, data: any) => {
  try {
    console.log('Security Event:', event, data);
    // TODO: Implement proper security logging to CloudWatch or your backend
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const isAuthenticated = !!user;

  // Initialize auth state on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  // Helper function to convert Cognito user to our User interface
  const convertCognitoUser = async (cognitoUser: AuthUser): Promise<User> => {
    try {
      const attributes = await fetchUserAttributes();
      
      return {
        id: cognitoUser.userId,
        cognitoSub: cognitoUser.userId,
        email: attributes.email || '',
        firstName: attributes.given_name || '',
        lastName: attributes.family_name || '',
        phoneNumber: attributes.phone_number,
        emailVerified: attributes.email_verified === 'true',
        phoneVerified: attributes.phone_number_verified === 'true',
        role: (attributes['custom:role'] as 'user' | 'admin' | 'premium') || 'user',
        verified: attributes.email_verified === 'true',
        mfaEnabled: false, // TODO: Implement MFA status check
        createdAt: new Date().toISOString(), // TODO: Get actual creation date
        lastLogin: new Date().toISOString(),
        subscription: {
          plan: (attributes['custom:subscription_plan'] as 'free' | 'premium' | 'enterprise') || 'free',
          status: (attributes['custom:subscription_status'] as 'active' | 'inactive' | 'trial') || 'active',
          expiresAt: attributes['custom:subscription_expires_at']
        }
      };
    } catch (error) {
      console.error('Error converting Cognito user:', error);
      throw error;
    }
  };

  const initializeAuth = async () => {
    try {
      setIsLoading(true);

      // Check if we have valid Cognito configuration
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      if (!userPoolId || userPoolId.includes('TEMP')) {
        console.warn('⚠️ Cognito not configured - running in demo mode');
        setUser(null);
        setIsLoading(false);
        return;
      }



      // Check if user is authenticated with Cognito
      const cognitoUser = await getCurrentUser();

      if (cognitoUser) {
        const userData = await convertCognitoUser(cognitoUser);
        setUser(userData);

        // Log successful auth initialization
        await logSecurityEvent('auth_initialized', {
          userId: userData.id,
          timestamp: new Date().toISOString()
        });
        setAuthError(null);
      }
    } catch (error: any) {
      console.error('Auth initialization failed:', error);
      // User is not authenticated, which is fine
      setUser(null);
      if (error?.name === 'UserUnAuthenticatedException') {
        setAuthError('You are not signed in. Please log in to access your account.');
      } else {
        setAuthError(error?.message || 'Authentication error.');
      }
    } finally {
      setIsLoading(false);
    }
  };



  const login = async (email: string, password: string, mfaCode?: string) => {
    try {
      setIsLoading(true);
      
      // Check if we have valid Cognito configuration
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      if (!userPoolId || userPoolId.includes('TEMP')) {
        console.warn('⚠️ Demo mode: Cognito not configured');
        return { 
          success: false, 
          error: 'Authentication requires AWS Cognito configuration. Please deploy to AWS or configure Cognito credentials.' 
        };
      }
      
      const result = await signIn({ 
        username: email.toLowerCase().trim(), 
        password 
      });
      
      // Handle MFA challenge
      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
        if (!mfaCode) {
          return { success: false, requiresMfa: true };
        }
        // TODO: Implement MFA confirmation
        // await confirmSignIn({ challengeResponse: mfaCode });
      }
      
      // Get user data after successful sign in
      const cognitoUser = await getCurrentUser();
      const userData = await convertCognitoUser(cognitoUser);
      setUser(userData);
      
      // Log successful login
      await logSecurityEvent('login_success', { 
        email, 
        userId: userData.id, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Login error:', error);
      
      // Log failed login attempt
      await logSecurityEvent('login_failed', { 
        email, 
        error: error.message, 
        timestamp: new Date().toISOString() 
      });
      
      return { 
        success: false, 
        error: error.message || 'Login failed'
      };
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithProvider = async (provider: 'Google' | 'Microsoft') => {
    try {
      setIsLoading(true);
      
      // Check if we have valid Cognito configuration
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      if (!userPoolId || userPoolId.includes('TEMP')) {
        throw new Error('Federated authentication requires AWS Cognito configuration. Please deploy to AWS or configure Cognito credentials.');
      }
      
      // Check environment variables for HTTPS enforcement
      const forceHttps = process.env.FORCE_HTTPS === 'true';
      const trustProxy = process.env.TRUST_PROXY === 'true';
      const nextAuthUrl = process.env.NEXTAUTH_URL;
      
      // If we're behind a proxy (ALB) and trust proxy is enabled, use NEXTAUTH_URL
      const isProduction = typeof window !== 'undefined' && 
        window.location.hostname !== 'localhost' && 
        !window.location.hostname.includes('127.0.0.1');
      
      // Only enforce HTTPS checking if not using trusted proxy setup
      if (isProduction && !trustProxy && window.location.protocol === 'http:') {
        throw new Error(`OAuth authentication requires HTTPS in production. Current URL: ${window.location.href}. Please configure SSL certificate on your load balancer or use HTTPS.`);
      }
      
      // Use direct OAuth URLs to bypass Cognito hosted UI and go straight to provider
      const redirectUri = `${window.location.origin}/auth/callback`;
      const cognitoDomain = 'cosine-production.auth.us-east-1.amazoncognito.com';
      const clientId = '57opgf3bjct1v7vos2anppjepp';
      
      // Construct the direct OAuth URL
      const authUrl = new URL(`https://${cognitoDomain}/oauth2/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'email openid profile');
      authUrl.searchParams.set('identity_provider', provider === 'Google' ? 'Google' : 'Microsoft');
      
      console.log(`Redirecting directly to ${provider} OAuth:`, authUrl.toString());

      // Redirect directly to the provider (bypassing Cognito hosted UI)
      window.location.href = authUrl.toString();
      
    } catch (error: any) {
      console.error(`${provider} login error:`, error);
      throw new Error(`Failed to login with ${provider}: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: RegisterData) => {
    try {
      setIsLoading(true);
      
      // Only send email to Cognito. Store other fields in backend after registration.
      const result = await signUp({
        username: userData.email.toLowerCase().trim(),
        password: userData.password,
        options: {
          userAttributes: {
            email: userData.email.toLowerCase().trim(),
            'custom_termsaccept': userData.termsAccepted.toString(),
            'custom_markconsent': (userData.marketingConsent || false).toString(),
            'custom_role': 'user',
            'custom_subplan': 'free',
            'custom_substatus': 'active'
          }
        }
      });

      // TODO: After Cognito registration, send firstName, lastName, phoneNumber to backend/DynamoDB
      
      // Log successful registration
      await logSecurityEvent('registration_success', { 
        email: userData.email, 
        userId: result.userId, 
        timestamp: new Date().toISOString() 
      });
      
      return { 
        success: true, 
        verificationRequired: !result.isSignUpComplete 
      };
    } catch (error: any) {
      console.error('Registration error:', error);
      
      // Log failed registration
      await logSecurityEvent('registration_failed', { 
        email: userData.email, 
        error: error.message, 
        timestamp: new Date().toISOString() 
      });
      
      return { 
        success: false, 
        error: error.message || 'Registration failed' 
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      
      const currentUser = user;
      await signOut();
      setUser(null);
      
      // Log successful logout
      if (currentUser) {
        await logSecurityEvent('logout_success', { 
          userId: currentUser.id, 
          timestamp: new Date().toISOString() 
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      await cognitoResetPassword({ username: email.toLowerCase().trim() });
      
      await logSecurityEvent('password_reset_requested', { 
        email, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Reset password error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to reset password' 
      };
    }
  };

  const confirmResetPassword = async (email: string, code: string, newPassword: string) => {
    try {
      await cognitoConfirmResetPassword({
        username: email.toLowerCase().trim(),
        confirmationCode: code,
        newPassword
      });
      
      await logSecurityEvent('password_reset_confirmed', { 
        email, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Confirm reset password error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to confirm password reset' 
      };
    }
  };

  const verifyEmail = async (email: string, code: string) => {
    try {
      await confirmSignUp({
        username: email.toLowerCase().trim(),
        confirmationCode: code
      });
      
      if (user) {
        setUser({ ...user, verified: true, emailVerified: true });
      }
      
      await logSecurityEvent('email_verified', { 
        email, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Email verification error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to verify email' 
      };
    }
  };

  const resendVerificationCode = async (email: string) => {
    try {
      await resendSignUpCode({ username: email.toLowerCase().trim() });
      
      await logSecurityEvent('verification_code_resent', { 
        email, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Resend verification error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to resend verification code' 
      };
    }
  };

  const updateProfile = async (profileData: Partial<User>) => {
    try {
      if (!user) {
        return { success: false, error: 'User not authenticated' };
      }
      
      const attributes: any = {};
      if (profileData.firstName) attributes.given_name = profileData.firstName;
      if (profileData.lastName) attributes.family_name = profileData.lastName;
      if (profileData.phoneNumber) attributes.phone_number = profileData.phoneNumber;
      if (profileData.role) attributes['custom:role'] = profileData.role;
      
      await updateUserAttributes({ userAttributes: attributes });
      
      const updatedUser = { ...user, ...profileData };
      setUser(updatedUser);
      
      await logSecurityEvent('profile_updated', { 
        userId: user.id, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Update profile error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to update profile' 
      };
    }
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      if (!user) {
        return { success: false, error: 'User not authenticated' };
      }
      
      await updatePassword({ oldPassword, newPassword });
      
      await logSecurityEvent('password_changed', { 
        userId: user.id, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Change password error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to change password' 
      };
    }
  };

  const enableMfa = async () => {
    // TODO: Implement MFA setup with Cognito
    console.log('MFA setup not yet implemented');
    return { 
      success: false, 
      error: 'MFA setup not yet implemented' 
    };
  };

  const confirmMfa = async (code: string, secret: string) => {
    // TODO: Implement MFA confirmation
    console.log('MFA confirmation not yet implemented');
    return { 
      success: false, 
      error: 'MFA confirmation not yet implemented' 
    };
  };

  const disableMfa = async (mfaCode: string) => {
    // TODO: Implement MFA disable
    console.log('MFA disable not yet implemented');
    return { 
      success: false, 
      error: 'MFA disable not yet implemented' 
    };
  };

  const refreshToken = async () => {
    try {
      // Cognito handles token refresh automatically
      // Just verify the current user is still valid
      const cognitoUser = await getCurrentUser();
      return !!cognitoUser;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  };

  const deleteAccount = async () => {
    try {
      if (!user) {
        return { success: false, error: 'User not authenticated' };
      }
      
      await deleteUser();
      setUser(null);
      
      await logSecurityEvent('account_deleted', { 
        userId: user.id, 
        timestamp: new Date().toISOString() 
      });
      
      return { success: true };
    } catch (error: any) {
      console.error('Delete account error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to delete account' 
      };
    }
  };

  const value: AuthContextType & { authError: string | null } = {
    user,
    isLoading,
    isAuthenticated,
    login,
    loginWithProvider,
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
    authError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
