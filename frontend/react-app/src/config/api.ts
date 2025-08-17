// API Configuration
// This file manages API Gateway URLs and configuration

import { ENV_CONFIG, logEnvironmentConfig } from './environment';

export const API_CONFIG = {
  // API Gateway base URL - dynamically loaded from environment
  BASE_URL: ENV_CONFIG.apiGatewayUrl,
  
  // API endpoints
  ENDPOINTS: {
    CHAT: '/chat',
    STOCK_VOLATILITY: '/stocks/volatility',
    PORTFOLIO: '/portfolio',
    CRYPTO: '/crypto',
    OPTIONS: '/options',
    ALERTS: '/alerts',
    HEALTH: '/health',
  },
  
  // Request configuration
  REQUEST_CONFIG: {
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
  },
  
  // Cache configuration
  CACHE_CONFIG: {
    DEFAULT_TTL: 5 * 60 * 1000, // 5 minutes
    STOCK_VOLATILITY_TTL: 10 * 60 * 1000, // 10 minutes
    CRYPTO_STATS_TTL: 2 * 60 * 1000, // 2 minutes
    PORTFOLIO_TTL: 0, // No cache
    OPTION_PRICING_TTL: 0, // No cache
    ALERTS_TTL: 0, // No cache
    CHAT_TTL: 0, // No cache
  },
};

// Helper function to get full API URL
export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};

// Helper function to check if API is configured
export const isApiConfigured = (): boolean => {
  const url = API_CONFIG.BASE_URL;
  return Boolean(url && 
         !url.includes('your-') && 
         url !== 'https://your-api-gateway-url.amazonaws.com/staging' && 
         url !== 'https://your-staging-api-gateway-url.amazonaws.com/staging' &&
         url !== 'https://your-production-api-gateway-url.amazonaws.com/production');
};

// Helper function to get environment-specific configuration
export const getEnvironmentConfig = () => {
  return {
    environment: ENV_CONFIG.environment,
    isDevelopment: ENV_CONFIG.environment === 'development',
    isStaging: ENV_CONFIG.environment === 'staging',
    isProduction: ENV_CONFIG.environment === 'production',
    apiUrl: API_CONFIG.BASE_URL,
  };
};

// Debug function to log current API configuration
export const logApiConfig = () => {
  console.log('🔧 API Configuration Debug:');
  console.log('Environment:', ENV_CONFIG.environment);
  console.log('API Gateway URL:', API_CONFIG.BASE_URL);
  console.log('Is Configured:', isApiConfigured());
  console.log('Stock Volatility Endpoint:', getApiUrl(API_CONFIG.ENDPOINTS.STOCK_VOLATILITY));
  
  // Also log environment configuration
  logEnvironmentConfig();
};

export default API_CONFIG;
