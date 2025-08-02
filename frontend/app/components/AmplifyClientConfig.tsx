"use client";

import { useEffect } from 'react';
import { Amplify } from 'aws-amplify';

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Inline Amplify configuration to avoid import issues during Docker build
    const amplifyConfig = {
      Auth: {
        Cognito: {
          // Required: Amazon Cognito User Pool ID
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || 'us-east-1_TEMP12345',
          
          // Required: Amazon Cognito Web Client ID (App client ID)
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || 'TEMPTEMPTEMPTEMP123456',
          
          // Required: Amazon Cognito Identity Pool ID for AWS credentials
          identityPoolId: process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID || 'us-east-1:12345678-1234-1234-1234-123456789012',
          
          // Optional: Domain for Hosted UI
          loginWith: {
            oauth: {
              domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || 'temp-domain.auth.us-east-1.amazoncognito.com',
              scopes: ['email', 'openid', 'profile'],
              redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN || 'http://localhost:3000/'],
              redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT || 'http://localhost:3000/'],
              responseType: 'code' as const,
            },
            email: true,
          },
        }
      }
    };

    // Configure Amplify with error handling
    try {
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
      
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
      
      Amplify.configure(amplifyConfig);
      console.log('✅ AWS Amplify configured successfully');
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
