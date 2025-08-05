"use client";

import { useEffect } from 'react';
import { Amplify } from 'aws-amplify';

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // --- Hardcoded Cognito credentials for Amplify v6+ ---
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: 'us-east-1_3VXhGxuIb',
          userPoolClientId: '6i4mrjk2keivkfouqj7e11s3gn',
          // region: 'us-east-1', // Uncomment if needed
          // loginWith: { ... } // Uncomment and fill if using OAuth/Hosted UI
        }
      }
    });
    console.log('✅ AWS Amplify configured with hardcoded Cognito credentials');

    // --- All dynamic/env-based logic below is commented out ---
    // try {
    //   const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    //   const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
    //   const identityPoolId = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID;
    //   const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
    //   const redirectSignIn = process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN;
    //   const redirectSignOut = process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT;
    //   // ...rest of dynamic config logic...
    // } catch (error) {
    //   // ...fallback logic...
    // }
  }, []);

  return <>{children}</>;
}
