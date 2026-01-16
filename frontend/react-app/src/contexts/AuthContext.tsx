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
import { dashboardAPI } from '../services/api';

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
  authError: string | null;
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

  // Listen for auth state changes (e.g., after email verification) and auto-login
  useEffect(() => {
    // Poll for auth state changes every 2 seconds when user is not authenticated
    // This allows auto-login after email verification if the tab is still open
    if (!user && typeof window !== 'undefined') {
      console.log('🔄 AuthContext: Starting auth polling (checking every 2s for verified user)');
      const checkAuthInterval = setInterval(async () => {
        try {
          const cognitoUser = await getCurrentUser();
          if (cognitoUser) {
            // Check if the user is verified before auto-logging in
            const attributes = await fetchUserAttributes();
            const isVerified = attributes.email_verified === 'true';
            
            console.log('🔄 AuthContext: Polling detected user:', {
              userId: cognitoUser.userId,
              email: attributes.email,
              email_verified: attributes.email_verified,
              isVerified
            });
            
            if (isVerified) {
              console.log('✅ AuthContext: User is verified! Auto-logging in...');
              const userData = await convertCognitoUser(cognitoUser);
              setUser(userData);
              setAuthError(null);
              console.log('✅ AuthContext: Auto-login complete, user:', userData.email);
              clearInterval(checkAuthInterval);
            } else {
              console.log('⏳ AuthContext: User exists but email_verified=false, continuing to poll...');
            }
          } else {
            // Only log every 10th poll to avoid spam
            if (Math.random() < 0.1) {
              console.log('🔄 AuthContext: Polling - no authenticated user yet');
            }
          }
        } catch (error) {
          // User still not authenticated or not verified, continue polling
          // Only log every 10th poll to avoid spam
          if (Math.random() < 0.1) {
            console.log('🔄 AuthContext: Polling error:', error instanceof Error ? error.message : error);
          }
        }
      }, 2000);
      
      return () => {
        console.log('🔄 AuthContext: Stopping auth polling');
        clearInterval(checkAuthInterval);
      };
    }
  }, [user]);

  // Listen for auth expiration events from API calls (401/403 errors)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleAuthExpired = async () => {
      console.warn('🔒 Auth expiration detected - clearing session and redirecting to login');
      
      try {
        // Clear user state
        setUser(null);
        setAuthError('Your session has expired. Please log in again.');
        
        // Sign out from Cognito
        try {
          await signOut();
        } catch (signOutError) {
          console.warn('Failed to sign out from Cognito:', signOutError);
        }
        
        // Clear any cached data
        try {
          localStorage.removeItem('user');
          sessionStorage.clear();
        } catch (clearError) {
          console.warn('Failed to clear storage:', clearError);
        }
      } catch (error) {
        console.error('Error handling auth expiration:', error);
      }
    };
    
    window.addEventListener('auth-expired', handleAuthExpired);
    
    return () => {
      window.removeEventListener('auth-expired', handleAuthExpired);
    };
  }, []);

  // After authentication, ensure a default dashboard exists for the user
  useEffect(() => {
    const ensureDefaultDashboard = async () => {
      if (!user || isLoading) return;
      try {
        const initKey = `dashboard_initialized_${user.id}`;
        const alreadyInitialized = typeof window !== 'undefined' ? localStorage.getItem(initKey) : null;
        if (alreadyInitialized) return;

        // Call backend to fetch (and create if missing) the dashboard
        await dashboardAPI.getDashboard(user.id);
        if (typeof window !== 'undefined') {
          localStorage.setItem(initKey, 'true');
        }
      } catch (e) {
        console.warn('Failed to ensure default dashboard on login:', e);
      }
    };

    ensureDefaultDashboard();
  }, [user, isLoading]);

  // Handle OAuth callbacks
  useEffect(() => {
    const handleOAuthCallback = async () => {
      // Only run on client side
      if (typeof window === 'undefined') return;
      
      // Check if we're on the callback page
      if (window.location.pathname === '/auth/callback') {
        try {
          console.log('🔄 Processing OAuth callback...');
          
          // Check if there are OAuth parameters in the URL
          const urlParams = new URLSearchParams(window.location.search);
          const hasOAuthParams = urlParams.has('code') || urlParams.has('state') || urlParams.has('error');
          
          if (hasOAuthParams) {
            console.log('📋 OAuth parameters detected, processing...');
            
            // Wait a bit for Amplify to process the callback
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try to get the current user
            const cognitoUser = await getCurrentUser();
            if (cognitoUser) {
              console.log('✅ OAuth callback successful, user authenticated');
              const userData = await convertCognitoUser(cognitoUser);
              setUser(userData);
              setAuthError(null);
            } else {
              console.log('❌ No user found after OAuth callback');
              setAuthError('Authentication failed. Please try again.');
            }
          } else {
            console.log('ℹ️ No OAuth parameters found, checking existing session...');
            // No OAuth parameters, just check if user is already authenticated
            const cognitoUser = await getCurrentUser();
            if (cognitoUser) {
              const userData = await convertCognitoUser(cognitoUser);
              setUser(userData);
              setAuthError(null);
            }
          }
        } catch (error) {
          console.error('❌ OAuth callback handling failed:', error);
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

      // Check if user is authenticated with Cognito
      const cognitoUser = await getCurrentUser();

      if (cognitoUser) {
        // Verify session is still valid by checking token expiration
        try {
          const { fetchAuthSession } = await import('aws-amplify/auth');
          const session = await fetchAuthSession();
          const idToken = session.tokens?.idToken;
          const accessToken = session.tokens?.accessToken;
          
          // Check if tokens are expired
          if (idToken || accessToken) {
            const token = idToken || accessToken;
            
            // Check if token has expiration
            if (token && token.payload && 'exp' in token.payload) {
              const expirationTime = token.payload.exp as number;
              const currentTime = Math.floor(Date.now() / 1000);
              
              // If token is expired, clear session and redirect to login
              if (expirationTime <= currentTime) {
                console.warn('🔒 Session expired during initialization - clearing and redirecting to login');
                setUser(null);
                setAuthError('Your session has expired. Please log in again.');
                
                // Sign out from Cognito
                try {
                  await signOut();
                } catch (signOutError) {
                  console.warn('Failed to sign out from Cognito:', signOutError);
                }
                
                // Clear storage and redirect
                if (typeof window !== 'undefined') {
                  try {
                    localStorage.removeItem('user');
                    sessionStorage.clear();
                  } catch (clearError) {
                    console.warn('Failed to clear storage:', clearError);
                  }
                  
                  // Redirect to login after a short delay
                  setTimeout(() => {
                    window.location.href = '/';
                  }, 500);
                }
                
                return;
              }
            }
          }
        } catch (sessionError) {
          console.warn('Failed to verify session expiration:', sessionError);
          // Continue with user initialization if session check fails
        }
        
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
        setAuthError(null); // Don't show error if user is just not signed in
      } else {
        setAuthError(error?.message || 'Authentication error.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string, mfaCode?: string) => {
    try {
      // Don't set global loading for login attempts as it interferes with modal UX
      // setIsLoading(true);
      
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
      if (!cognitoUser) {
        throw new Error('Failed to get user data after successful sign-in');
      }
      
      const userData = await convertCognitoUser(cognitoUser);
      if (!userData) {
        throw new Error('Failed to convert user data');
      }
      
      // Only set user if we have valid user data
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
      
      // Explicitly clear user state on login failure to ensure clean state
      setUser(null);
      
      // Log failed login attempt
      await logSecurityEvent('login_failed', { 
        email, 
        error: error.message, 
        timestamp: new Date().toISOString() 
      });
      
      // Translate AWS Cognito errors to user-friendly messages
      let errorMessage = 'Login failed. Please try again.';
      
      if (error.name === 'NotAuthorizedException') {
        errorMessage = 'Incorrect username or password. Please check your credentials and try again.';
      } else if (error.name === 'UserNotConfirmedException') {
        errorMessage = 'Your account has not been verified. Please check your email for a verification link.';
      } else if (error.name === 'UserNotFoundException') {
        errorMessage = 'No account found with this email address. Please check your email or sign up for a new account.';
      } else if (error.name === 'TooManyRequestsException') {
        errorMessage = 'Too many login attempts. Please wait a few minutes and try again.';
      } else if (error.name === 'InvalidParameterException') {
        errorMessage = 'Invalid email or password format. Please check your input and try again.';
      } else if (error.name === 'PasswordResetRequiredException') {
        errorMessage = 'Password reset is required. Please reset your password and try again.';
      } else if (error.name === 'UserLambdaValidationException') {
        errorMessage = 'Account validation failed. Please contact support if this issue persists.';
      } else if (error.message) {
        // Use the error message if available, but make it more user-friendly
        errorMessage = error.message;
      }
      
      return { 
        success: false, 
        error: errorMessage
      };
    } finally {
      // Don't reset global loading since we're not setting it for login attempts
      // setIsLoading(false);
    }
  };

  const loginWithProvider = async (provider: 'Google') => {
    try {
      setIsLoading(true);
      
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
      console.log('🔐 AuthContext: Starting registration for:', userData.email);
      // Don't set global isLoading during registration to avoid showing LoadingPage
      // Registration has local loading state in RegisterForm
      
      // Generate a unique username since User Pool has email alias enabled
      // Cognito will handle email separately as an alias
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const uniqueUsername = `user_${timestamp}_${randomSuffix}`;
      
      console.log('🔐 AuthContext: Calling Cognito signUp with username:', uniqueUsername);
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

      console.log('🔐 AuthContext: Cognito signUp result:', {
        userId: result.userId,
        isSignUpComplete: result.isSignUpComplete,
        nextStep: result.nextStep
      });
      
      // Check current user state immediately after registration
      try {
        const currentUser = await getCurrentUser();
        console.log('🔐 AuthContext: Current user after registration:', currentUser ? 'EXISTS' : 'NULL');
        if (currentUser) {
          const attrs = await fetchUserAttributes();
          console.log('🔐 AuthContext: User attributes after registration:', {
            email: attrs.email,
            email_verified: attrs.email_verified,
            sub: attrs.sub
          });
        }
      } catch (e) {
        console.log('🔐 AuthContext: No current user session after registration (expected)');
      }

      // Log successful registration
      await logSecurityEvent('registration_success', { 
        email: userData.email, 
        userId: result.userId, 
        timestamp: new Date().toISOString() 
      });
      
      const returnValue = { 
        success: true, 
        verificationRequired: !result.isSignUpComplete,
        email: userData.email.toLowerCase().trim()
      };
      
      console.log('🔐 AuthContext: Returning registration result:', returnValue);
      return returnValue;
    } catch (error: any) {
      console.error('❌ AuthContext: Registration error:', error);
      
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
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      
      const currentUser = user;
      
      // Force clear all dialogs and their cached data from sessionStorage
      try {
        // Clear dialog manager data
        sessionStorage.removeItem('dialog-manager-dialogs');
        
        // Clear ALL dialog-related entries (they follow patterns like dialog-cache-{id}, dialog-data-{id})
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && (key.startsWith('dialog-cache-') || key.startsWith('dialog-data-') || key.startsWith('dialog-manager-'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => {
          try {
            sessionStorage.removeItem(key);
          } catch (e) {
            // Ignore individual removal errors
          }
        });
        
        // Dispatch event to notify DialogManagerProvider to clear state
        window.dispatchEvent(new CustomEvent('user-logout', { detail: { clearDialogs: true } }));
      } catch (e) {
        console.warn('Failed to clear dialogs on logout:', e);
      }
      
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
      
      let errorMessage = 'Failed to send reset email. Please try again.';
      
      if (error.name === 'UserNotFoundException') {
        errorMessage = 'No account found with this email address. Please check your email or sign up for a new account.';
      } else if (error.name === 'InvalidParameterException') {
        errorMessage = 'Invalid email address. Please enter a valid email.';
      } else if (error.name === 'LimitExceededException') {
        errorMessage = 'Too many requests. Please wait a few minutes before trying again.';
      } else if (error.name === 'TooManyRequestsException') {
        errorMessage = 'Too many reset attempts. Please wait before trying again.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return { 
        success: false, 
        error: errorMessage
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
      
      let errorMessage = 'Failed to reset password. Please try again.';
      
      if (error.name === 'CodeMismatchException') {
        errorMessage = 'Invalid confirmation code. Please check the code from your email and try again.';
      } else if (error.name === 'ExpiredCodeException') {
        errorMessage = 'Confirmation code has expired. Please request a new password reset.';
      } else if (error.name === 'InvalidPasswordException') {
        errorMessage = 'Password does not meet requirements. Password must be at least 8 characters with uppercase, lowercase, numbers, and special characters.';
      } else if (error.name === 'InvalidParameterException') {
        errorMessage = 'Invalid input. Please check all fields and try again.';
      } else if (error.name === 'LimitExceededException') {
        errorMessage = 'Too many attempts. Please wait before trying again.';
      } else if (error.name === 'UserNotFoundException') {
        errorMessage = 'Account not found. Please ensure you\'re using the correct email address.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return { 
        success: false, 
        error: errorMessage
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

  const value: AuthContextType = {
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