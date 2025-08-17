// API Configuration
// This file manages API Gateway URLs and configuration

export const API_CONFIG = {
  // API Gateway base URL - will be replaced with actual URL after deployment
  BASE_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'https://your-api-gateway-url.amazonaws.com/staging',
  
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
  return API_CONFIG.BASE_URL !== 'https://your-api-gateway-url.amazonaws.com/staging';
};

// Helper function to get environment-specific configuration
export const getEnvironmentConfig = () => {
  const environment = process.env.NEXT_PUBLIC_ENVIRONMENT || 'development';
  
  return {
    environment,
    isDevelopment: environment === 'development',
    isStaging: environment === 'staging',
    isProduction: environment === 'production',
    apiUrl: API_CONFIG.BASE_URL,
  };
};

export default API_CONFIG;
