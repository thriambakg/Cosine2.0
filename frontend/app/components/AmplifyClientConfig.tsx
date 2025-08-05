"use client";

import { useEffect } from 'react';
import { Amplify } from 'aws-amplify';

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
  //   // Configure Amplify with error handling and detailed logging
  //   try {
  //     const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  //     const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
  //     const identityPoolId = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID;
  //     const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  //     const redirectSignIn = process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN;
  //     const redirectSignOut = process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT;
      
  //     // Log all environment variables for debugging
  //     console.log('🔍 Amplify Configuration Debug Info:');
  //     console.log('  - User Pool ID:', userPoolId);
  //     console.log('  - Client ID:', userPoolClientId);
  //     console.log('  - Identity Pool ID:', identityPoolId);
  //     console.log('  - Cognito Domain:', cognitoDomain);
  //     console.log('  - Redirect Sign In:', redirectSignIn);
  //     console.log('  - Redirect Sign Out:', redirectSignOut);
  //     console.log('  - Current URL:', typeof window !== 'undefined' ? window.location.href : 'Server-side');
      
  //     if (!userPoolId || userPoolId.includes('TEMP') || !userPoolClientId || userPoolClientId.includes('TEMP')) {
  //       console.warn('⚠️  AWS Cognito not configured with real values. Using temporary configuration for development.');
  //       console.warn('   This will cause authentication failures in production!');
        
  //       // Use minimal configuration for development
  //       Amplify.configure({
  //         Auth: {
  //           Cognito: {
  //             userPoolId: 'us-east-1_3VXhGxuIb',
  //             userPoolClientId: '6i4mrjk2keivkfouqj7e11s3gn',
  //           }
  //         }
  //       });
  //       return;
  //     }

  //     // Validate required values
  //     if (!cognitoDomain || cognitoDomain.includes('temp-domain')) {
  //       console.error('❌ Missing or invalid NEXT_PUBLIC_COGNITO_DOMAIN environment variable');
  //       throw new Error('Cognito domain not configured');
  //     }

  //     if (!redirectSignIn || !redirectSignOut) {
  //       console.error('❌ Missing redirect URLs');
  //       console.error('   NEXT_PUBLIC_REDIRECT_SIGN_IN:', redirectSignIn);
  //       console.error('   NEXT_PUBLIC_REDIRECT_SIGN_OUT:', redirectSignOut);
  //       throw new Error('Redirect URLs not configured');
  //     }

  //     // Create configuration based on available credentials
  //     let amplifyConfig;
      
  //     if (identityPoolId && !identityPoolId.includes('TEMP')) {
  //       // Full configuration with Identity Pool (for AWS service access)
  //       console.log('🔧 Configuring with User Pool + Identity Pool');
  //       amplifyConfig = {
  //         Auth: {
  //           Cognito: {
  //             userPoolId: userPoolId,
  //             userPoolClientId: userPoolClientId,
  //             identityPoolId: identityPoolId,
  //             loginWith: {
  //               oauth: {
  //                 domain: cognitoDomain,
  //                 scopes: ['email', 'openid', 'profile'],
  //                 redirectSignIn: [redirectSignIn],
  //                 redirectSignOut: [redirectSignOut],
  //                 responseType: 'code' as const,
  //               },
  //               email: true,
  //             },
  //           }
  //         }
  //       };
  //     } else {
  //       // User Pool only configuration (for authentication only)
  //       console.log('🔧 Configuring with User Pool only');
  //       amplifyConfig = {
  //         Auth: {
  //           Cognito: {
  //             userPoolId: userPoolId,
  //             userPoolClientId: userPoolClientId,
  //             loginWith: {
  //               oauth: {
  //                 domain: cognitoDomain,
  //                 scopes: ['email', 'openid', 'profile'],
  //                 redirectSignIn: [redirectSignIn],
  //                 redirectSignOut: [redirectSignOut],
  //                 responseType: 'code' as const,
  //               },
  //               email: true,
  //             },
  //           }
  //         }
  //       };
  //     }

  //     console.log('🔧 Final Amplify Configuration:');
  //     console.log(JSON.stringify(amplifyConfig, null, 2));
      
  //     Amplify.configure(amplifyConfig);
      
  //     const configType = identityPoolId && !identityPoolId.includes('TEMP') ? 'User Pool + Identity Pool' : 'User Pool only';
  //     console.log(`✅ AWS Amplify configured successfully (${configType})`);
  //     console.log('🔐 OAuth authentication should now work properly');
      
  //   } catch (error) {
  //     console.error('❌ Failed to configure AWS Amplify:', error);
  //     console.error('   This will cause authentication failures!');
  //     console.warn('🔄 Attempting fallback configuration...');
      
  //     // Minimal configuration to prevent crashes
  //     try {
  //       Amplify.configure({
  //         Auth: {
  //           Cognito: {
  //             userPoolId: 'us-east-1_3VXhGxuIb',
  //             userPoolClientId: '6i4mrjk2keivkfouqj7e11s3gn',
  //           }
  //         }
  //       });
  //       console.warn('⚠️  Using fallback configuration - authentication will not work');
  //     } catch (fallbackError) {
  //       console.error('❌ Even fallback configuration failed:', fallbackError);
  //     }
  //   }
        // --- Hardcoded Cognito credentials ---
    const userPoolId = 'us-east-1_3VXhGxuIb';
    const userPoolClientId = '6i4mrjk2keivkfouqj7e11s3gn';

    // --- Dynamic/env-based logic commented out ---
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

    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
        },
      },
    });
    console.log('✅ AWS Amplify configured with hardcoded Cognito credentials');
  }, []);

  return <>{children}</>;
}
