import { Amplify } from 'aws-amplify';

// Configure Amplify with Cognito credentials
const configureAmplify = () => {
  try {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : 'unknown';
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
    
    console.log('🔧 Amplify Config Debug:');
    console.log('  Current URL:', currentUrl);
    console.log('  Current Origin:', currentOrigin);
    console.log('  Configured redirectSignIn:', ['http://localhost:3000/auth/callback', 'https://investcosine.com/auth/callback']);
    console.log('  Configured redirectSignOut:', ['http://localhost:3000', 'https://investcosine.com']);
    console.log('  Cognito Domain:', 'cosine-production.auth.us-east-1.amazoncognito.com');
    
    // Use the same hardcoded configuration that was working in the old project
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: 'us-east-1_dACC5MBr3',
          userPoolClientId: '57opgf3bjct1v7vos2anppjepp',
          loginWith: {
            oauth: {
              domain: 'cosine-production.auth.us-east-1.amazoncognito.com',
              scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
              redirectSignIn: ['http://localhost:3000/auth/callback', 'https://investcosine.com/auth/callback', 'https://investcosine.com/dashboard'],
              redirectSignOut: ['http://localhost:3000', 'https://investcosine.com'],
              responseType: 'code',
              providers: ['Google']
            },
            email: true,
          },
        }
      }
    });
    
    console.log('✅ AWS Amplify configured with hardcoded Cognito credentials');
  } catch (error) {
    console.error('❌ Failed to configure Amplify:', error);
    throw error;
  }
};

export default configureAmplify;
