import { Amplify } from 'aws-amplify';

// Configure Amplify with Cognito credentials
const configureAmplify = () => {
  try {
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
              redirectSignIn: ['http://localhost:3000/auth/callback', 'https://investcosine.com/auth/callback'],
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
