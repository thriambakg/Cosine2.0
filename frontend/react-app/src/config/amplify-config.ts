import { Amplify } from 'aws-amplify';
import { ENV_CONFIG } from './environment';

// Production Cognito credentials (fallback for localhost development)
const PRODUCTION_COGNITO_CONFIG = {
  userPoolId: 'us-east-1_dACC5MBr3',
  userPoolClientId: '57opgf3bjct1v7vos2anppjepp',
  domain: 'cosine-production.auth.us-east-1.amazoncognito.com',
};

// Check if we're running on localhost
const isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || 
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '');

// Configure Amplify with Cognito credentials from runtime config
const configureAmplify = () => {
  try {
    // For localhost, always use production Cognito (where dev credentials exist)
    // For deployed environments (staging/production), use config from config.js
    let cognitoUserPoolId: string;
    let cognitoClientId: string;
    let cognitoDomain: string;
    
    if (isLocalhost) {
      // Always use production Cognito on localhost for local development
      console.log('🏠 Localhost detected: Using production Cognito for local development');
      cognitoUserPoolId = PRODUCTION_COGNITO_CONFIG.userPoolId;
      cognitoClientId = PRODUCTION_COGNITO_CONFIG.userPoolClientId;
      cognitoDomain = PRODUCTION_COGNITO_CONFIG.domain;
    } else {
      // Use config from config.js for deployed environments (staging/production)
      cognitoUserPoolId = ENV_CONFIG.cognitoUserPoolId || '';
      cognitoClientId = ENV_CONFIG.cognitoClientId || '';
      cognitoDomain = ENV_CONFIG.cognitoDomain || '';
    }
    
    const redirectSignIn = ENV_CONFIG.redirectSignIn || 'http://localhost:3000/auth/callback';
    const redirectSignOut = ENV_CONFIG.redirectSignOut || 'http://localhost:3000';
    const awsRegion = ENV_CONFIG.awsRegion || 'us-east-1';

    if (!cognitoUserPoolId || !cognitoClientId) {
      throw new Error('Cognito User Pool ID and Client ID are required. Please ensure config.js is loaded or you are on localhost.');
    }

    if (!cognitoDomain) {
      throw new Error('Cognito Domain is required. Please ensure config.js is loaded or you are on localhost.');
    }

    // TypeScript now knows cognitoDomain is a string after the validation check
    const validatedCognitoDomain: string = cognitoDomain;

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
              domain: validatedCognitoDomain,
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
    
    console.log('✅ AWS Amplify configured with Cognito credentials:', {
      userPoolId: cognitoUserPoolId,
      clientId: cognitoClientId,
      domain: validatedCognitoDomain,
      redirectSignIn: redirectSignInUrls,
      redirectSignOut: redirectSignOutUrls,
      region: awsRegion,
      source: isLocalhost ? 'production (localhost fallback)' : 'runtime config (config.js)',
      environment: isLocalhost ? 'localhost (production Cognito)' : ENV_CONFIG.environment,
      apiGatewayUrl: ENV_CONFIG.apiGatewayUrl,
      warning: isLocalhost && ENV_CONFIG.apiGatewayUrl?.includes('staging') 
        ? '⚠️ Mismatch: Using production Cognito but calling staging API Gateway. This will cause 401 errors!' 
        : undefined
    });
    
    // Warn if there's a mismatch between Cognito pool and API Gateway environment
    if (isLocalhost && ENV_CONFIG.apiGatewayUrl?.includes('staging')) {
      console.error('❌ CONFIGURATION MISMATCH DETECTED:');
      console.error('   - Using production Cognito pool (localhost fallback)');
      console.error('   - But calling staging API Gateway');
      console.error('   - This will cause 401 Unauthorized errors!');
      console.error('   - Solution: Use production API Gateway URL or create staging user');
    }
  } catch (error) {
    console.error('❌ Failed to configure Amplify:', error);
    throw error;
  }
};

export default configureAmplify;
