// AWS Amplify Configuration with Federated Authentication
// frontend/src/config/amplify-config.ts

import { Amplify } from 'aws-amplify';

// This configuration will be populated from your Terraform outputs
const amplifyConfig = {
  Auth: {
    // Cognito User Pool configuration
    region: 'us-east-1', // Your AWS region
    userPoolId: 'us-east-1_1dOeIUrQu', // From Terraform output: module.cognito.user_pool_id
    userPoolWebClientId: '4194qg8gsba2886u97slpab40o', // From Terraform output: module.cognito.user_pool_client_id
    
    // Optional: Custom domain for hosted UI
    // domain: 'auth.yourdomain.com',
    
    // OAuth configuration for federated identity providers
    oauth: {
      domain: 'cosine-staging.auth.us-east-1.amazoncognito.com', // Cognito domain
      scope: ['phone', 'email', 'profile', 'openid', 'aws.cognito.signin.user.admin'],
      redirectSignIn: [
        'http://localhost:3000/auth/callback',
        'https://localhost:3000/auth/callback',
        'https://yourdomain.com/auth/callback' // Add your production domain
      ],
      redirectSignOut: [
        'http://localhost:3000/',
        'https://localhost:3000/',
        'https://yourdomain.com/' // Add your production domain
      ],
      responseType: 'code', // Use authorization code flow
      
      // Configure social providers
      socialProviders: [
        'GOOGLE',        // Will be available when Google provider is enabled
        'MICROSOFT'      // Will be available when Microsoft provider is enabled
      ],
    },
    
    // Authentication flow configuration
    authenticationFlowType: 'USER_SRP_AUTH',
    
    // Additional security settings
    cookieStorage: {
      domain: '.yourdomain.com', // Set to your domain for production
      path: '/',
      expires: 365,
      secure: true,
      sameSite: 'strict'
    }
  }
};

// Configure Amplify
Amplify.configure(amplifyConfig);

export default amplifyConfig;
