// Environment Configuration
// This file manages environment-specific configuration and API URLs

import { DEVELOPMENT_CONFIG } from './environments/development';
import { STAGING_CONFIG } from './environments/staging';
import { PRODUCTION_CONFIG } from './environments/production';

export interface EnvironmentConfig {
  environment: 'development' | 'staging' | 'production';
  apiGatewayUrl: string;
  websocketUrl?: string;
  awsRegion: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoDomain?: string;
  redirectSignIn?: string;
  redirectSignOut?: string;
  projectName: string;
}

// Environment-specific configurations
const ENVIRONMENT_CONFIGS: Record<string, EnvironmentConfig> = {
  development: DEVELOPMENT_CONFIG,
  staging: STAGING_CONFIG,
  production: PRODUCTION_CONFIG
};

// Get runtime configuration from dynamically generated config.js
const getRuntimeConfig = () => {
  if (typeof window !== 'undefined' && window.COSINE_CONFIG) {
    console.log('🔧 Runtime config found:', window.COSINE_CONFIG);
    return {
      apiGatewayUrl: window.COSINE_CONFIG.apiGatewayUrl,
      websocketUrl: window.COSINE_CONFIG.websocketUrl,
      awsRegion: window.COSINE_CONFIG.awsRegion,
      environment: window.COSINE_CONFIG.environment,
      cognitoUserPoolId: window.COSINE_CONFIG.cognitoUserPoolId,
      cognitoClientId: window.COSINE_CONFIG.cognitoClientId,
      cognitoDomain: window.COSINE_CONFIG.cognitoDomain,
      redirectSignIn: window.COSINE_CONFIG.redirectSignIn,
      redirectSignOut: window.COSINE_CONFIG.redirectSignOut,
    };
  }
  console.log('🔧 No runtime config found, window.COSINE_CONFIG:', typeof window !== 'undefined' ? window.COSINE_CONFIG : 'window not available');
  return null;
};

// Get current environment
const getCurrentEnvironment = (): string => {
  // Check runtime config first
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig?.environment && ['development', 'staging', 'production'].includes(runtimeConfig.environment)) {
    console.log('🌍 Using environment from runtime config:', runtimeConfig.environment);
    return runtimeConfig.environment;
  }
  
  // Check for environment variable
  const envFromVar = process.env.NEXT_PUBLIC_ENVIRONMENT;
  if (envFromVar && ['development', 'staging', 'production'].includes(envFromVar)) {
    console.log('🌍 Using environment from NEXT_PUBLIC_ENVIRONMENT:', envFromVar);
    return envFromVar;
  }
  
  // Check for VITE environment variable (for Vite builds)
  const viteEnv = process.env.VITE_ENVIRONMENT;
  if (viteEnv && ['development', 'staging', 'production'].includes(viteEnv)) {
    console.log('🌍 Using environment from VITE_ENVIRONMENT:', viteEnv);
    return viteEnv;
  }
  
  // Default to development
  console.log('🌍 Using default environment: development');
  return 'development';
};

// Check if we're running on localhost
const isLocalhostEnv = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || 
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '');

// Get API Gateway URL from runtime config or environment variables
const getApiGatewayUrl = (): string => {
  // For localhost, use production API Gateway (to match production Cognito)
  if (isLocalhostEnv) {
    const productionUrl = ENVIRONMENT_CONFIGS.production?.apiGatewayUrl;
    if (productionUrl && !productionUrl.includes('your-')) {
      console.log('🏠 Localhost detected: Using production API Gateway URL for local development:', productionUrl);
      return productionUrl;
    }
  }
  
  // Check runtime config first (highest priority)
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig?.apiGatewayUrl && !runtimeConfig.apiGatewayUrl.includes('{{')) {
    console.log('🔗 Using API Gateway URL from runtime config:', runtimeConfig.apiGatewayUrl);
    return runtimeConfig.apiGatewayUrl;
  }
  
  // Check for explicit API Gateway URL
  const explicitUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL || process.env.VITE_API_GATEWAY_URL;
  if (explicitUrl && !explicitUrl.includes('your-')) {
    console.log('🔗 Using API Gateway URL from environment variable:', explicitUrl);
    return explicitUrl;
  }
  
  // Fall back to environment-specific config
  const env = getCurrentEnvironment();
  const envUrl = ENVIRONMENT_CONFIGS[env]?.apiGatewayUrl || ENVIRONMENT_CONFIGS.development.apiGatewayUrl;
  console.log('🔗 Using API Gateway URL from environment config:', envUrl, '(environment:', env, ')');
  return envUrl;
};

// Get AWS region from runtime config or environment variables
const getAwsRegion = (): string => {
  // Check runtime config first
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig?.awsRegion && !runtimeConfig.awsRegion.includes('{{')) {
    return runtimeConfig.awsRegion;
  }
  
  // Check for explicit AWS region
  const explicitRegion = process.env.NEXT_PUBLIC_AWS_REGION || process.env.VITE_AWS_REGION;
  if (explicitRegion && !explicitRegion.includes('{{')) {
    return explicitRegion;
  }
  
  // Fall back to environment-specific config
  const env = getCurrentEnvironment();
  return ENVIRONMENT_CONFIGS[env]?.awsRegion || ENVIRONMENT_CONFIGS.development.awsRegion;
};

// Get WebSocket URL from runtime config or environment variables
const getWebSocketUrl = (): string | undefined => {
  // Check runtime config first (highest priority)
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig?.websocketUrl && !runtimeConfig.websocketUrl.includes('{{')) {
    console.log('🔌 Using WebSocket URL from runtime config:', runtimeConfig.websocketUrl);
    return runtimeConfig.websocketUrl;
  }
  
  // Check for explicit WebSocket URL
  const explicitUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || process.env.VITE_WEBSOCKET_URL;
  if (explicitUrl && !explicitUrl.includes('your-')) {
    console.log('🔌 Using WebSocket URL from environment variable:', explicitUrl);
    return explicitUrl;
  }
  
  // Fall back to environment-specific config
  const env = getCurrentEnvironment();
  const envUrl = ENVIRONMENT_CONFIGS[env]?.websocketUrl;
  if (envUrl) {
    console.log('🔌 Using WebSocket URL from environment config:', envUrl, '(environment:', env, ')');
    return envUrl;
  }
  
  console.log('🔌 No WebSocket URL configured for environment:', env);
  return undefined;
};

// Get Cognito configuration from runtime config or environment variables
const getCognitoConfig = () => {
  // Check runtime config first
  const runtimeConfig = getRuntimeConfig();
  if (runtimeConfig?.cognitoUserPoolId && !runtimeConfig.cognitoUserPoolId.includes('{{')) {
    return {
      userPoolId: runtimeConfig.cognitoUserPoolId,
      clientId: runtimeConfig.cognitoClientId,
      domain: runtimeConfig.cognitoDomain,
    };
  }
  
  return {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || process.env.VITE_COGNITO_USER_POOL_ID,
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || process.env.VITE_COGNITO_CLIENT_ID,
    domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || process.env.VITE_COGNITO_DOMAIN,
  };
};

// Build the final environment configuration
export const getEnvironmentConfig = (): EnvironmentConfig => {
  const environment = getCurrentEnvironment();
  const cognitoConfig = getCognitoConfig();
  const runtimeConfig = getRuntimeConfig();
  
  return {
    environment: environment as 'development' | 'staging' | 'production',
    apiGatewayUrl: getApiGatewayUrl(),
    websocketUrl: getWebSocketUrl(),
    awsRegion: getAwsRegion(),
    cognitoUserPoolId: cognitoConfig.userPoolId,
    cognitoClientId: cognitoConfig.clientId,
    cognitoDomain: cognitoConfig.domain,
    redirectSignIn: runtimeConfig?.redirectSignIn,
    redirectSignOut: runtimeConfig?.redirectSignOut,
    projectName: ENVIRONMENT_CONFIGS[environment]?.projectName || 'cosine'
  };
};

// Export the current environment configuration
export const ENV_CONFIG = getEnvironmentConfig();

// Debug function to log environment configuration
export const logEnvironmentConfig = () => {
  console.log('🌍 Environment Configuration:');
  console.log('Environment:', ENV_CONFIG.environment);
  console.log('API Gateway URL:', ENV_CONFIG.apiGatewayUrl);
  console.log('WebSocket URL:', ENV_CONFIG.websocketUrl || 'Not configured');
  console.log('AWS Region:', ENV_CONFIG.awsRegion);
  console.log('Project Name:', ENV_CONFIG.projectName);
  console.log('Cognito User Pool ID:', ENV_CONFIG.cognitoUserPoolId || 'Not configured');
  console.log('Cognito Client ID:', ENV_CONFIG.cognitoClientId || 'Not configured');
  console.log('Cognito Domain:', ENV_CONFIG.cognitoDomain || 'Not configured');
  
  // Log runtime config if available
  if (typeof window !== 'undefined' && window.COSINE_CONFIG) {
    console.log('🔧 Runtime Configuration Available:', window.COSINE_CONFIG);
  }
  
  // Log all environment variables for debugging
  console.log('🔧 Environment Variables:');
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_')) {
      console.log(`${key}:`, process.env[key]);
    }
  });
};

// Helper functions
export const isDevelopment = (): boolean => ENV_CONFIG.environment === 'development';
export const isStaging = (): boolean => ENV_CONFIG.environment === 'staging';
export const isProduction = (): boolean => ENV_CONFIG.environment === 'production';

export default ENV_CONFIG;
