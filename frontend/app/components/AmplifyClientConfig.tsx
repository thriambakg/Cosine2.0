"use client";

import { Amplify } from 'aws-amplify';

// Configure Amplify immediately when module loads (before any React rendering)
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-east-1_3VXhGxuIb',
      userPoolClientId: '6i4mrjk2keivkfouqj7e11s3gn',
      loginWith: {
        oauth: {
          domain: 'cosine-production.auth.us-east-1.amazoncognito.com',
          scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
          redirectSignIn: ['https://investcosine.com'],
          redirectSignOut: ['https://investcosine.com'],
          responseType: 'code',
        },
        email: true,
      },
    }
  }
});
console.log('✅ AWS Amplify configured with hardcoded Cognito credentials');

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  // --- All dynamic/env-based logic below is commented out for future reference ---
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

  return <>{children}</>;
}
