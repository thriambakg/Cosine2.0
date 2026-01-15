import { Amplify } from 'aws-amplify';
import { ENV_CONFIG } from './environment';

// Configure Amplify with Cognito credentials from runtime config
const configureAmplify = () => {
  try {
    // Get Cognito configuration from runtime config (config.js)
    const cognitoUserPoolId = ENV_CONFIG.cognitoUserPoolId;
    const cognitoClientId = ENV_CONFIG.cognitoClientId;
    const cognitoDomain = ENV_CONFIG.cognitoDomain;
    const redirectSignIn = ENV_CONFIG.redirectSignIn || 'http://localhost:3000/auth/callback';
    const redirectSignOut = ENV_CONFIG.redirectSignOut || 'http://localhost:3000';
    const awsRegion = ENV_CONFIG.awsRegion || 'us-east-1';

    if (!cognitoUserPoolId || !cognitoClientId) {
      throw new Error('Cognito User Pool ID and Client ID are required. Please ensure config.js is loaded.');
    }

    // Build redirect URLs array - include localhost for development and the configured URL
    const redirectSignInUrls = [
      'http://localhost:3000/auth/callback',
      redirectSignIn
    ].filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates

    const redirectSignOutUrls = [
      'http://localhost:3000',
      redirectSignOut
    ].filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates

    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: cognitoUserPoolId,
          userPoolClientId: cognitoClientId,
          loginWith: {
            oauth: {
              domain: cognitoDomain,
              scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
              redirectSignIn: redirectSignInUrls,
              redirectSignOut: redirectSignOutUrls,
              responseType: 'code',
              providers: ['Google']
            },
            email: true,
          },
        }
      }
    });
    
    console.log('✅ AWS Amplify configured with Cognito credentials from runtime config:', {
      userPoolId: cognitoUserPoolId,
      clientId: cognitoClientId,
      domain: cognitoDomain,
      redirectSignIn: redirectSignInUrls,
      redirectSignOut: redirectSignOutUrls,
      region: awsRegion
    });
  } catch (error) {
    console.error('❌ Failed to configure Amplify:', error);
    throw error;
  }
};

export default configureAmplify;
