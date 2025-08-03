"use client";

import { useEffect } from 'react';
import { Amplify } from 'aws-amplify';

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Configure Amplify with error handling
    try {
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
      const identityPoolId = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID;
      const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
      
      if (!userPoolId || userPoolId.includes('TEMP') || !userPoolClientId || userPoolClientId.includes('TEMP')) {
        console.warn('⚠️  AWS Cognito not configured with real values. Using temporary configuration for development.');
        
        // Use minimal configuration for development
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId: 'us-east-1_TEMP12345',
              userPoolClientId: 'TEMPTEMPTEMPTEMP123456',
            }
          }
        });
        return;
      }

      // Create configuration based on available credentials
      if (identityPoolId && !identityPoolId.includes('TEMP')) {
        // Full configuration with Identity Pool (for AWS service access)
        console.log('🔧 Configuring Amplify with User Pool + Identity Pool');
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId: userPoolId,
              userPoolClientId: userPoolClientId,
              identityPoolId: identityPoolId,
              loginWith: {
                oauth: {
                  domain: cognitoDomain || 'temp-domain.auth.us-east-1.amazoncognito.com',
                  scopes: ['email', 'openid', 'profile'],
                  redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN || 'https://cosine-alb-v2-staging-1054813572.us-east-1.elb.amazonaws.com/auth/callback'],
                  redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT || 'https://cosine-alb-v2-staging-1054813572.us-east-1.elb.amazonaws.com/'],
                  responseType: 'code' as const,
                },
                email: true,
              },
            }
          }
        });
      } else {
        // User Pool only configuration (for authentication only)
        console.log('🔧 Configuring Amplify with User Pool only (OAuth authentication)');
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId: userPoolId,
              userPoolClientId: userPoolClientId,
              loginWith: {
                oauth: {
                  domain: cognitoDomain || 'temp-domain.auth.us-east-1.amazoncognito.com',
                  scopes: ['email', 'openid', 'profile'],
                  redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN || 'https://cosine-alb-v2-staging-1054813572.us-east-1.elb.amazonaws.com/auth/callback'],
                  redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT || 'https://cosine-alb-v2-staging-1054813572.us-east-1.elb.amazonaws.com/'],
                  responseType: 'code' as const,
                },
                email: true,
              },
            }
          }
        });
      }
      
      console.log('✅ AWS Amplify configured successfully for OAuth authentication');
    } catch (error) {
      console.error('❌ Failed to configure AWS Amplify:', error);
      console.warn('🔄 Continuing with basic configuration...');
      
      // Minimal configuration to prevent crashes
      try {
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId: 'us-east-1_TEMP12345',
              userPoolClientId: 'TEMPTEMPTEMPTEMP123456',
            }
          }
        });
      } catch (fallbackError) {
        console.error('❌ Even fallback configuration failed:', fallbackError);
      }
    }
  }, []);

  return <>{children}</>;
}
