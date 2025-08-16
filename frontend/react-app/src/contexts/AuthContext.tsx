import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  loginWithProvider: (provider: 'Google') => Promise<void>;
  register: (userData: RegisterData) => Promise<{ success: boolean; error?: string; verificationRequired?: boolean; email?: string }>;
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

  // Handle OAuth callbacks
  useEffect(() => {
    const handleOAuthCallback = async () => {
      // Only run on client side
      if (typeof window === 'undefined') return;
      
      // Check if we're on the callback page
      if (window.location.pathname === '/auth/callback') {
        try {
          // Wait a bit for Amplify to process the callback
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Try to get the current user
          const cognitoUser = await getCurrentUser();
          if (cognitoUser) {
            const userData = await convertCognitoUser(cognitoUser);
            setUser(userData);
            setAuthError(null);
          }
        } catch (error) {
          console.error('OAuth callback handling failed:', error);
          setAuthError('Authentication failed. Please try again.');
        }
      }
    };

    handleOAuthCallback();
  }, []);

  // Helper function to convert Cognito user to our User interface
  const convertCognitoUser = async (cognitoUser: AuthUser): Promise<User> => {
    try {
      console.log('Converting Cognito user:', cognitoUser.userId);
      
      const attributes = await fetchUserAttributes();
      console.log('Fetched user attributes:', attributes);
      
      return {
        id: cognitoUser.userId,
        cognitoSub: cognitoUser.userId,
        email: attributes.email || '',
        firstName: attributes.given_name || '',
        lastName: attributes.family_name || '',
        phoneNumber: attributes.phone_number,
        emailVerified: attributes.email_verified === 'true',
        phoneVerified: attributes.phone_number_verified === 'true',
        role: (attributes['custom:custom_role'] as 'user' | 'admin' | 'premium') || 'user',
        verified: attributes.email_verified === 'true',
        mfaEnabled: false, // TODO: Implement MFA status check
        createdAt: new Date().toISOString(), // TODO: Get actual creation date
        lastLogin: new Date().toISOString(),
        subscription: {
          plan: (attributes['custom:custom_subplan'] as 'free' | 'premium' | 'enterprise') || 'free',
          status: (attributes['custom:custom_substatus'] as 'active' | 'inactive' | 'trial') || 'active',
          expiresAt: attributes['custom:subscription_expires_at']
        }
      };
    } catch (error: any) {
      console.error('Error converting Cognito user:', error);
      
      // If it's specifically a UserUnAuthenticatedException, provide a more helpful error
      if (error?.name === 'UserUnAuthenticatedException') {
        throw new Error('User session not fully established. Please try logging in again.');
      }
      
      throw error;
    }
  };

  const initializeAuth = async () => {
    try {
      setIsLoading(true);

      // Check if we have valid Cognito configuration
      const userPoolId = import.meta.env?.VITE_COGNITO_USER_POOL_ID;
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
      const userPoolId = import.meta.env?.VITE_COGNITO_USER_POOL_ID;
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
      
      console.log('Sign-in result:', result);
      
      // Handle different sign-in steps
      if (result.nextStep) {
        console.log('Next step required:', result.nextStep);
        
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
          if (!mfaCode) {
            return { success: false, requiresMfa: true };
          }
          // TODO: Implement MFA confirmation
          // await confirmSignIn({ challengeResponse: mfaCode });
        } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
          return { 
            success: false, 
            error: 'Please verify your email address before signing in. Check your email for a verification link.' 
          };
        } else if (result.nextStep.signInStep === 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP') {
          return { 
            success: false, 
            error: 'MFA setup is required. This feature is not yet implemented. Please contact support or disable MFA in the User Pool configuration.' 
          };
        }
      }
      
      // Check if sign-in is complete
      if (!result.isSignedIn) {
        return { 
          success: false, 
          error: 'Sign-in not completed. Please check your email for verification instructions.' 
        };
      }
      
      // Get user data after successful sign in
      // Add a small delay to ensure the session is fully established
      await new Promise(resolve => setTimeout(resolve, 500));
      
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

  const loginWithProvider = async (provider: 'Google') => {
    try {
      setIsLoading(true);
      
      // Check if we have valid Cognito configuration
      const userPoolId = import.meta.env?.VITE_COGNITO_USER_POOL_ID;
      if (!userPoolId || userPoolId.includes('TEMP')) {
        throw new Error('Federated authentication requires AWS Cognito configuration. Please deploy to AWS or configure Cognito credentials.');
      }
      
      // Map provider names to AWS Amplify provider constants
      const providerMap = {
        'Google': 'Google'
      };
      
      await signInWithRedirect({ 
        provider: providerMap[provider] as any
      });
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
      
      // Generate a unique username since User Pool has email alias enabled
      // Cognito will handle email separately as an alias
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const uniqueUsername = `user_${timestamp}_${randomSuffix}`;
      
      const result = await signUp({
        username: uniqueUsername,
        password: userData.password,
        options: {
          userAttributes: {
            email: userData.email.toLowerCase().trim(),
            given_name: userData.firstName.trim(),
            family_name: userData.lastName.trim(),
            'custom:custom_termsaccept': userData.termsAccepted.toString(),
            'custom:custom_markconsent': (userData.marketingConsent || false).toString(),
            'custom:custom_role': 'user',
            'custom:custom_subplan': 'free',
            'custom:custom_substatus': 'active'
          }
        }
      });

      // TODO: After Cognito registration, send firstName, lastName, phoneNumber to backend/DynamoDB
      
      // No need to store registration data - user will click email link to verify

      // Log successful registration
      await logSecurityEvent('registration_success', { 
        email: userData.email, 
        userId: result.userId, 
        timestamp: new Date().toISOString() 
      });
      
      return { 
        success: true, 
        verificationRequired: !result.isSignUpComplete,
        email: userData.email.toLowerCase().trim()
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

  // Email link verification is handled automatically by Cognito
  // No manual confirmation functions needed

  const confirmMfa = async (_code: string, _secret: string) => {
    // TODO: Implement MFA confirmation
    console.log('MFA confirmation not yet implemented');
    return { 
      success: false, 
      error: 'MFA confirmation not yet implemented' 
    };
  };

  const disableMfa = async (_mfaCode: string) => {
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
