import { Amplify } from 'aws-amplify';

// Configure Amplify with Cognito credentials
const configureAmplify = () => {
  try {
    // Get environment variables
    const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
    const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID;
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
    const redirectSignIn = import.meta.env.VITE_REDIRECT_SIGN_IN;
    const redirectSignOut = import.meta.env.VITE_REDIRECT_SIGN_OUT;


    // Check if we have the required configuration
    if (!userPoolId || !userPoolClientId || !cognitoDomain) {
      console.warn('⚠️ Cognito configuration incomplete - using fallback credentials');
      
      // Fallback to hardcoded credentials (for development/testing)
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: 'us-east-1_dACC5MBr3',
            userPoolClientId: '57opgf3bjct1v7vos2anppjepp',
            loginWith: {
              oauth: {
                domain: 'cosine-production.auth.us-east-1.amazoncognito.com',
                scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
                redirectSignIn: ['https://investcosine.com/auth/callback'],
                redirectSignOut: ['https://investcosine.com'],
                responseType: 'code',
                providers: ['Google']
              },
              email: true,
            },
          }
        }
      });
    } else {
      // Use environment variables
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId,
            userPoolClientId,
            loginWith: {
              oauth: {
                domain: cognitoDomain,
                scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
                redirectSignIn: [redirectSignIn || 'https://investcosine.com/auth/callback'],
                redirectSignOut: [redirectSignOut || 'https://investcosine.com'],
                responseType: 'code',
                providers: ['Google']
              },
              email: true,
            },
          }
        }
      });
    }

    console.log('✅ AWS Amplify configured successfully');
  } catch (error) {
    console.error('❌ Failed to configure Amplify:', error);
    throw error;
  }
};

export default configureAmplify;
