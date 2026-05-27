// API service for connecting to backend Lambda functions
// This service handles all API calls to the AWS API Gateway endpoints

import { API_CONFIG, logApiConfig } from '../config/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import { DashboardTab, DashboardGroup } from '../types/dashboardTypes';

const API_BASE_URL = API_CONFIG.BASE_URL;

/** Base URL for API Gateway (e.g. for fetch when not using apiRequest). */
export const getApiBaseUrl = (): string => API_BASE_URL;

// Track if we're already redirecting to prevent multiple redirects
let isRedirectingToLogin = false;

// Debug logging on import
console.log('🚀 API Service initialized with:', {
  baseUrl: API_BASE_URL,
  isConfigured: API_CONFIG.BASE_URL !== 'https://your-api-gateway-url.amazonaws.com/staging'
});

// Common headers for all API requests
const getHeaders = (userId?: string) => ({
  'Content-Type': 'application/json',
  ...(userId && { 'X-User-ID': userId })
});

// Generic API request function
export const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit & { userId?: string } = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  console.log(`🌐 Making API request to: ${url}`);
  
  try {
    // Attempt to fetch Cognito session and attach Bearer token
    let authHeader: Record<string, string> = {};
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessToken = session.tokens?.accessToken;
      
      // Log token info for debugging
      console.log('🔍 Token debug info:', {
        hasIdToken: !!idToken,
        hasAccessToken: !!accessToken,
        idTokenType: idToken ? typeof idToken : 'none',
        accessTokenType: accessToken ? typeof accessToken : 'none',
        apiUrl: API_BASE_URL
      });
      
      // Check if tokens are expired
      if (idToken || accessToken) {
        // Get the token that exists (prefer idToken)
        const token = idToken || accessToken;
        
        // Check if token has expiration (JWT tokens have exp claim)
        try {
          // Try to access token expiration
          // JWT tokens have a payload with an 'exp' claim (expiration timestamp in seconds)
          let tokenExpired = false;
          
          // Check if token has a payload property with exp
          if (token && typeof token === 'object' && 'payload' in token) {
            const payload = (token as any).payload;
            if (payload && typeof payload.exp === 'number') {
              const expirationTime = payload.exp;
              const currentTime = Math.floor(Date.now() / 1000);
              
              // If token is expired or expiring within 5 seconds, treat as expired
              if (expirationTime <= currentTime + 5) {
                tokenExpired = true;
              }
            }
          }
          
          if (tokenExpired && !isRedirectingToLogin) {
            console.warn('🔒 Cognito token expired or expiring soon - redirecting to login');
            
            // Set flag to prevent multiple redirects
            isRedirectingToLogin = true;
            
            // Dispatch auth expired event
            if (typeof window !== 'undefined') {
              const authExpiredEvent = new CustomEvent('auth-expired', {
                detail: {
                  status: 401,
                  endpoint,
                  message: 'Your session has expired. Please log in again.'
                }
              });
              window.dispatchEvent(authExpiredEvent);
              
              // Redirect to login after cleanup
              setTimeout(() => {
                try {
                  localStorage.removeItem('user');
                  sessionStorage.clear();
                } catch (e) {
                  console.warn('Failed to clear storage:', e);
                }
                window.location.href = '/';
              }, 500);
            }
            
            // Throw error to stop the request
            throw new Error('Token expired');
          }
        } catch (tokenCheckError: any) {
          if (tokenCheckError.message === 'Token expired') {
            throw tokenCheckError;
          }
          // If we can't check expiration, continue with the token
          console.warn('Could not verify token expiration:', tokenCheckError);
        }
        
        // Extract JWT token string from Amplify token object
        // In Amplify v6, tokens are objects with a toString() method that returns the JWT string
        let bearer = '';
        if (token) {
          // Try toString() first (Amplify v6 pattern)
          if (typeof token.toString === 'function') {
            bearer = token.toString();
          } 
          // Fallback: check if token has a direct string property
          else if (typeof token === 'string') {
            bearer = token;
          }
          // Fallback: check for common token string properties
          else if (token && typeof token === 'object') {
            bearer = (token as any).tokenString || (token as any).toString?.() || String(token);
          }
          
          // Log token info for debugging (without exposing the full token)
          if (bearer) {
            console.log('🔒 Using token for Authorization header:', {
              tokenLength: bearer.length,
              tokenPrefix: bearer.substring(0, 20) + '...',
              tokenType: idToken ? 'idToken' : 'accessToken'
            });
          } else {
            console.warn('🔒 Could not extract token string from token object:', token);
          }
        }
        
        if (bearer) {
          authHeader = { Authorization: `Bearer ${bearer}` };
        }
      } else {
        console.warn('🔒 No Cognito tokens found; proceeding without Authorization header');
      }
    } catch (authErr: any) {
      // Check if this is a token expiration error
      if (authErr.message === 'Token expired') {
        // Already handled above, just re-throw
        throw authErr;
      }
      
      // For other auth errors, log and continue (might be unauthenticated request)
      console.warn('🔒 Failed to fetch Cognito session; proceeding unauthenticated:', authErr);
    }

    // Merge custom headers with default headers and auth header
    const headers = { ...getHeaders(options.userId), ...authHeader, ...options.headers } as any;
    
    // Log auth header info (without exposing full token)
    if (authHeader.Authorization) {
      const authValue = authHeader.Authorization;
      const tokenPart = authValue.replace('Bearer ', '');
      console.log(`🔒 Authorization header present:`, {
        hasToken: !!tokenPart,
        tokenLength: tokenPart.length,
        tokenPrefix: tokenPart.substring(0, 30) + '...',
        fullHeaderPrefix: authValue.substring(0, 50) + '...'
      });
    } else {
      console.warn('⚠️ No Authorization header in request - request will likely fail with 401');
    }
    
    console.log(`📡 Request config:`, {
      method: options.method || 'GET',
      url,
      hasAuthHeader: !!authHeader.Authorization,
      headers: { ...headers, Authorization: authHeader.Authorization ? '[REDACTED]' : undefined },
      body: options.body,
    });

    console.log('url', url);
    
    // Use appropriate axios method based on HTTP method
    let response;
    if (options.method === 'POST') {
      response = await axios.post(url, options.body, { headers });
    } else if (options.method === 'PUT') {
      response = await axios.put(url, options.body, { headers });
    } else if (options.method === 'DELETE') {
      response = await axios.delete(url, { 
        headers,
        data: options.body  // DELETE requests need data in the config object
      });
    } else {
      response = await axios.get(url, { headers });
    }
    
    console.log(`📥 Response status: ${response.status} ${response.statusText}`);
    console.log(`📥 Response headers:`, response.headers);
    
    if (response.status >= 400) {
      console.error(`❌ API Error Response:`, response.data);
      throw new Error(response.data?.message || `HTTP error! status: ${response.status}`);
    }
    
    console.log(`✅ API Response data:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`💥 API request failed for ${endpoint}:`, error);
    
    // Log additional debugging info
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      
      console.error(`🔍 Network Error Details:`, {
        url,
        baseUrl: API_BASE_URL,
        endpoint,
        error: error.message,
        status: status,
        statusText: statusText,
        data: error.response?.data
      });
      
      // Handle authentication errors (401, 403) - token expired or unauthorized
      if ((status === 401 || status === 403) && !isRedirectingToLogin) {
        console.warn('🔒 Authentication error detected (401/403) - session expired, redirecting to login');
        
        // Set flag to prevent multiple redirects
        isRedirectingToLogin = true;
        
        // Dispatch event to notify auth context to clear session
        if (typeof window !== 'undefined') {
          const authExpiredEvent = new CustomEvent('auth-expired', {
            detail: {
              status,
              endpoint,
              message: 'Your session has expired. Please log in again.'
            }
          });
          window.dispatchEvent(authExpiredEvent);
          
          // Redirect to login page after a short delay to allow cleanup
          setTimeout(() => {
            // Clear any cached auth data
            try {
              localStorage.removeItem('user');
              sessionStorage.clear();
            } catch (e) {
              console.warn('Failed to clear storage:', e);
            }
            
            // Redirect to login
            window.location.href = '/';
          }, 500);
        }
      }
      
      // Log API configuration for debugging
      logApiConfig();
    }
    
    throw error;
  }
};

// ============================================================================
// STOCK VOLATILITY API
// ============================================================================

export interface StockVolatilityRequest {
  ticker: string;
  period?: string; // defaults to "1y"
}

export interface StockVolatilityResponse {
  ticker: string;
  period: string;
  volatility: number;
  volatility_percentage: string;
  annualized: boolean;
  calculation_method: string;
  note?: string;
}

export const stockVolatilityAPI = {
  getVolatility: async (params: StockVolatilityRequest): Promise<StockVolatilityResponse> => {
    const queryParams = new URLSearchParams({
      ticker: params.ticker,
      period: params.period || '1y',
    });
    
    return apiRequest<StockVolatilityResponse>(`/volatility?${queryParams}`);
  },
};

// ============================================================================
// STOCK DATA API (Comprehensive stock statistics and chart data)
// ============================================================================

export interface StockDataRequest {
  ticker: string;
  period?: string; // defaults to "1y"
}

export interface StockDataResponse {
  current_price: number;
  price_change_24h: number;
  week_return: number;
  annual_return: number;
  volatility: number;
  chart_data: Array<{
    time: number;
    close: number;
  }>;
}

export const stockDataAPI = {
  getStockData: async (params: StockDataRequest): Promise<StockDataResponse> => {
    const queryParams = new URLSearchParams({
      ticker: params.ticker,
      period: params.period || '1y',
    });
    
    return apiRequest<StockDataResponse>(`/stock-data?${queryParams}`);
  },
};

// ============================================================================
// PORTFOLIO ANALYSIS API
// ============================================================================

export interface PortfolioAnalysisRequest {
  portfolio_data: Array<[string, number, number]>; // [ticker, shares, current_price]
  period?: '1d' | '7d' | '30d' | '1y' | '6mo';
  analysis_type?: 'standalone' | 'robinhood';
}

export interface PortfolioAnalysisResponse {
  success: boolean;
  analysis_type: 'standalone' | 'robinhood';
  period: string;
  portfolio_metrics: {
    total_portfolio_value: number;
    portfolio_expected_return: number; // percentage
    portfolio_volatility: number; // percentage
    sharpe_ratio: number;
    stock_details: {
      [ticker: string]: {
        shares: number;
        current_price: number;
        total_value: number;
        annual_return: number;
        annual_volatility: number;
        weight: number;
      };
    };
    individual_stocks: string[];
  };
  source: 'standalone_tool' | 'robinhood_integration';
  positions_count: number;
  timestamp: string;
}

export const portfolioAnalysisAPI = {
  analyzePortfolio: async (data: PortfolioAnalysisRequest): Promise<PortfolioAnalysisResponse> => {
    return apiRequest<PortfolioAnalysisResponse>('/portfolio', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// CRYPTO STATISTICS API
// ============================================================================

export interface CryptoStatsRequest {
  symbols?: string[]; // defaults to top 10 cryptos
  timeframe?: '1d' | '7d' | '30d' | '1y';
}

export interface CryptoStatsResponse {
  timestamp: string;
  data: Array<{
    symbol: string;
    name: string;
    currentPrice: number;
    return24h: number;
    annualReturn: number;
    annualizedVolatility: number;
    chartData?: Array<{
      time: string;
      price: number;
      value: number;
    }>;
  }>;
}

export const cryptoStatsAPI = {
  getStats: async (params?: CryptoStatsRequest): Promise<CryptoStatsResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.symbols) {
      queryParams.append('symbols', params.symbols.join(','));
    }
    if (params?.timeframe) {
      queryParams.append('timeframe', params.timeframe);
    }
    
    const queryString = queryParams.toString();
    return apiRequest<CryptoStatsResponse>(`/crypto${queryString ? `?${queryString}` : ''}`);
  },
};

// ============================================================================
// OPTION PRICING API
// ============================================================================

export interface OptionPricingRequest {
  underlyingPrice: number;
  strikePrice: number;
  timeToExpiry: number; // in years
  riskFreeRate: number; // annual rate
  volatility: number; // annual volatility
  optionType: 'call' | 'put';
}

export interface OptionPricingResponse {
  optionPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  impliedVolatility: number;
  intrinsicValue: number;
  timeValue: number;
  calculationMethod: string;
}

export const optionPricingAPI = {
  calculatePrice: async (data: OptionPricingRequest): Promise<OptionPricingResponse> => {
    return apiRequest<OptionPricingResponse>('/options', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// STOCK ALERTS API
// ============================================================================

export interface StockAlertRequest {
  ticker: string;
  alertType: 'price_above' | 'price_below' | 'volume_above' | 'volatility_above';
  threshold: number;
  userId: string;
}

export interface StockAlertResponse {
  alertId: string;
  status: 'active' | 'triggered' | 'cancelled';
  message: string;
  createdAt: string;
  triggerConditions: {
    ticker: string;
    alertType: string;
    threshold: number;
    currentPrice?: number;
  };
}

export const stockAlertsAPI = {
  createAlert: async (data: StockAlertRequest): Promise<StockAlertResponse> => {
    return apiRequest<StockAlertResponse>('/alerts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  getUserAlerts: async (userId: string): Promise<{ alerts: StockAlertResponse[] }> => {
    return apiRequest<{ alerts: StockAlertResponse[] }>(`/alerts?userId=${userId}`, {
      method: 'GET',
    });
  },
  
  deleteAlert: async (userId: string, alertId: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/alerts?userId=${userId}&alertId=${alertId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// STOCK SCREENER API
// ============================================================================

export interface StockScreenerRequest {
  criteria: {
    industries?: string[];
    volatilityRange?: [number, number];
    priceChangeRange?: [number, number];
    marketCapRange?: [number, number];
    priceRange?: [number, number];
    timeframe?: string;
  };
  maxResults?: number;
  lastEvaluatedKey?: any;  // Pagination token
}

export interface StockScreenerResponse {
  success: boolean;
  results: Array<{
    symbol: string;
    name: string;
    price: number;
    priceChange: number;
    priceChangePercent: number;
    marketCap: number;
    volatility: number;
    industry: string;
    sector?: string;
    volume: number;
    pe: number;
    // Additional fields from EOD aggregator
    current_price?: number;
    price_change_percent?: number;
    market_cap?: number;
    week_return?: number;
    weekReturn?: number;
    shares_outstanding?: number;
    day_high?: number;
    day_low?: number;
    year_high?: number;
    year_low?: number;
    previous_close?: number;
    price_change?: number;
    avg_volume?: number;
    pe_ratio?: number;
    eps?: number;
    dividend_yield?: number;
    beta?: number;
    data_source?: string;
    last_updated?: string;
  }>;
  totalResults: number;
  has_more?: boolean;  // Pagination flag
  last_evaluated_key?: any;  // Pagination token
  criteria: StockScreenerRequest['criteria'];
  timestamp: string;
  message?: string;  // Added for "no results" message
  error?: string;    // Added for error messages
}

export const stockScreenerAPI = {
  screenStocks: async (params: StockScreenerRequest): Promise<StockScreenerResponse> => {
    return apiRequest<StockScreenerResponse>('/stock-screener', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ============================================================================
// NEWS SEARCH API
// ============================================================================

export interface NewsSearchRequest {
  dateFrom?: string;
  dateTo?: string;
  query: {
    keywords?: string[]; // Simplified: just array of keywords
  };
  dateRange?: '12h' | '24h' | '7d' | '30d' | 'all';
  limit?: number;
  offset?: number; // Kept for backward compatibility
  lastEvaluatedKey?: { published_date?: string; SK?: string }; // Cursor for "load more" pagination
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  source_url: string;
  source_name: string;
  published_date: string;
  keywords: string;
  category: string;
  sentiment: string;
  ai_tag: string;
  image_url?: string;
  creator: string;
  country: string;
  language: string;
}

export interface NewsSearchResponse {
  articles: NewsArticle[];
  total: number;
  limit: number;
  offset: number; // Kept for backward compatibility
  has_more?: boolean;
  last_evaluated_key?: { published_date?: string; SK?: string }; // Cursor for next "load more" request
  query: NewsSearchRequest;
  timestamp: string;
}

export const newsSearchAPI = {
  searchNews: async (params: NewsSearchRequest): Promise<NewsSearchResponse> => {
    return apiRequest<NewsSearchResponse>('/news', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ============================================================================
// CHAT API
// ============================================================================

export interface ChatRequest {
  message: string;
  userId: string;
  context?: {
    currentPage?: string;
    portfolioData?: any;
    previousMessages?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }>;
  };
}

export interface ChatResponse {
  response: string;
  suggestions?: string[];
  confidence: number;
  processingTime: number;
  context?: {
    relevantData?: any;
    recommendations?: string[];
  };
}

export const chatAPI = {
  sendMessage: async (data: ChatRequest): Promise<ChatResponse> => {
    return apiRequest<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// API STATUS AND HEALTH CHECK
// ============================================================================

export interface APIHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    [key: string]: {
      status: 'up' | 'down';
      responseTime: number;
      lastChecked: string;
    };
  };
}

export const apiHealthAPI = {
  checkHealth: async (): Promise<APIHealthResponse> => {
    return apiRequest<APIHealthResponse>('/health');
  },
};

// ============================================================================
// ERROR HANDLING AND UTILITIES
// ============================================================================

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Utility function to handle API errors consistently
export const handleAPIError = (error: any, endpoint: string): never => {
  if (error instanceof APIError) {
    throw error;
  }
  
  console.error(`API Error for ${endpoint}:`, error);
  throw new APIError(
    error.message || 'An unexpected error occurred',
    error.statusCode,
    endpoint
  );
};

// Export all APIs as a single object for easy importing
// ============================================================================
// DASHBOARD API
// ============================================================================

export interface DashboardTile {
  id?: string;
  type: 'crypto' | 'stock' | 'custom' | 'placeholder' | 'folder' | 'stock_screener' | 'news' | 'portfolio' | 'politician_trades' | 'sec_search' | 'govt_contracts' | 'congress_bills' | 'congress_roll_calls' | 'lda_disclosures' | 'fec_campaign_finance';
  symbol?: string;
  timeframe?: string;
  title: string;
  displayOptions?: any;
  autoRefresh?: boolean;
  isPinned?: boolean;
  size?: { width: number; height: number };
  gridPosition?: { x: number; y: number };
  gridSize?: { width: number; height: number };
  dashboard_id?: string;
  created_at?: string;
  folderPath?: string;
  folderId?: string;
  criteria?: any;
  filters?: any;
  searchParams?: any;
  portfolioData?: any;
}

export interface DashboardConfig {
  tabs: Array<{
    id: string;
    name: string;
    color: string;
    isPinned: boolean;
    created_at: string;
  }>;
  tabGroups: any[];
  activeTabId: string;
  last_updated: string;
  tabOrder?: string[];
  groupOrder?: string[];
  dashboards: Array<{
    id: string;
    tabId: string;
    name: string;
    tiles: DashboardTile[];
    layout: string;
    created_at: string;
  }>;
  nextTabId: number;
  nextGroupId: number;
}

export interface TilePositionUpdate {
  gridPosition?: { x: number; y: number };
  gridSize?: { width: number; height: number };
}

export const dashboardAPI = {
  getDashboard: async (userId: string): Promise<{ dashboard_config: DashboardConfig }> => {
    return apiRequest<{ dashboard_config: DashboardConfig }>(`/dashboard?userId=${userId}`, {
      method: 'GET',
    });
  },

  updateDashboard: async (dashboardConfig: DashboardConfig, userId: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/dashboard?userId=${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ dashboard_config: dashboardConfig }),
    });
  },

  shareDashboard: async (
    tabId: string,
    userId: string,
    shareType: 'link' | 'download'
  ): Promise<{ success: boolean; shareId?: string; shareLink?: string; downloadUrl?: string; error?: string }> => {
    return apiRequest<{ success: boolean; shareId?: string; shareLink?: string; downloadUrl?: string; error?: string }>(
      `/dashboard-share?userId=${userId}`,
      {
        method: 'POST',
        body: JSON.stringify({ tabId, shareType }),
      }
    );
  },

  importDashboard: async (
    userId: string,
    importType: 'file' | 'link',
    fileContent?: string,
    shareId?: string
  ): Promise<{ success: boolean; tab?: DashboardTab; message?: string; error?: string }> => {
    const body: any = {
      importType,
    };

    if (importType === 'file' && fileContent) {
      body.fileContent = fileContent;
    } else if (importType === 'link' && shareId) {
      body.shareId = shareId;
    }

    return apiRequest<{ success: boolean; tab?: DashboardTab; message?: string; error?: string }>(
      `/dashboard-import?userId=${userId}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  },

  createTab: async (tabData: { name: string; color?: string }, userId: string): Promise<{ tab: DashboardTab; message: string }> => {
    const body: any = {
      type: 'tab',
      name: tabData.name
    };
    
    // Only include color if it's provided
    if (tabData.color) {
      body.color = tabData.color;
    }
    
    return apiRequest<{ tab: DashboardTab; message: string }>(`/dashboard?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  createGroup: async (groupData: { name: string; color?: string }, userId: string): Promise<{ group: DashboardGroup; message: string }> => {
    return apiRequest<{ group: DashboardGroup; message: string }>(`/dashboard?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'group',
        name: groupData.name,
        color: groupData.color || '#3b82f6'
      }),
    });
  },

  reorderTabs: async (tabIds: string[], userId: string): Promise<{ message: string; order: string[] }> => {
    return apiRequest<{ message: string; order: string[] }>(`/dashboard-reorder?userId=${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'reorder_tabs',
        order: tabIds
      }),
    });
  },

  reorderGroups: async (groupIds: string[], userId: string): Promise<{ message: string; order: string[] }> => {
    const requestBody = {
      type: 'reorder_groups',
      order: groupIds
    };
    
    console.log('🔄 Reordering groups API call:', {
      userId,
      groupIds,
      requestBody,
      url: `/dashboard-reorder?userId=${userId}`
    });
    
    return apiRequest<{ message: string; order: string[] }>(`/dashboard-reorder?userId=${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
    }).catch(error => {
      console.error('🚨 reorderGroups API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        request: {
          url: error.config?.url,
          method: error.config?.method,
          data: error.config?.data
        }
      });
      throw error;
    });
  },

  addTile: async (tile: Partial<DashboardTile>, tabId?: string, userId?: string): Promise<{ tile: DashboardTile; message: string }> => {
    return apiRequest<{ tile: DashboardTile; message: string }>(`/dashboard-tiles?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({ 
        type: 'add_tile',
        tile,
        tabId 
      }),
    });
  },

  duplicateTile: async (tileId: string, tabId?: string, userId?: string, gridPosition?: { x: number; y: number }): Promise<{ success: boolean; tile?: DashboardTile; message?: string; error?: string }> => {
    const body: any = {
      operation: 'duplicate_tile',
      tileId
    };
    if (tabId) {
      body.tabId = tabId;
    }
    if (gridPosition) {
      body.gridPosition = gridPosition;
    }
    return apiRequest<{ success: boolean; tile?: DashboardTile; message?: string; error?: string }>(`/dashboard-tiles?userId=${userId}`, {
      method: 'POST',
      body: body, // Plain object, not JSON.stringify
    });
  },

  duplicateTab: async (tabId: string, userId: string): Promise<{ success: boolean; tab?: DashboardTab; message?: string; error?: string }> => {
    return apiRequest<{ success: boolean; tab?: DashboardTab; message?: string; error?: string }>(`/dashboard?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({
        operation: 'duplicate_tab',
        tabId
      }),
    });
  },

  duplicateGroup: async (groupId: string, userId: string): Promise<{ success: boolean; group?: DashboardGroup; tabs?: DashboardTab[]; tileCount?: number; message?: string; error?: string }> => {
    return apiRequest<{ success: boolean; group?: DashboardGroup; tabs?: DashboardTab[]; tileCount?: number; message?: string; error?: string }>(`/dashboard?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({
        operation: 'duplicate_group',
        groupId
      }),
    });
  },

  updateTile: async (tileId: string, updates: Partial<DashboardTile>): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/dashboard-tiles/${tileId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  updateTilePosition: async (tileId: string, positionUpdate: TilePositionUpdate): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/dashboard-tiles/${tileId}/position`, {
      method: 'PUT',
      body: JSON.stringify(positionUpdate),
    });
  },

  removeTile: async (tileId: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>('/dashboard-tiles', {
      method: 'DELETE',
      body: JSON.stringify({ tileId }),
    });
  },

  deleteTab: async (tabId: string, userId: string): Promise<{ message: string }> => {
    const requestBody = {
      type: 'tab',
      id: tabId
    };
    console.log('🗑️ API - Deleting tab:', { tabId, userId, requestBody });
    return apiRequest<{ message: string }>(`/dashboard?userId=${userId}`, {
      method: 'DELETE',
      body: JSON.stringify(requestBody),
    });
  },

  deleteGroup: async (groupId: string, userId: string): Promise<{ message: string }> => {
    const requestBody = {
      type: 'group',
      id: groupId
    };
    console.log('🗑️ API - Deleting group:', { groupId, userId, requestBody });
    return apiRequest<{ message: string }>(`/dashboard?userId=${userId}`, {
      method: 'DELETE',
      body: JSON.stringify(requestBody),
    });
  },

  importTile: async (tileData: any, tabId: string, userId: string): Promise<any> => {
    return apiRequest<any>(`/dashboard-import?userId=${userId}`, {
      method: 'POST',
      body: JSON.stringify({
        operation: 'import_tile',
        tabId: tabId,
        tileData: tileData
      })
    });
  },
};

// SEC Search API
export interface SECSearchParams {
  cik?: string | string[];  // Support both single CIK and multiple CIKs
  entityName?: string | string[];  // Support both single and multiple entity names
  keywords?: string | string[]; // Support multiple keywords
  formTypes?: string[];
  dateFrom?: string;
  dateTo?: string;
  reportingFor?: string;
  located?: string | string[];  // Support both single and multiple locations
  incorporated?: string | string[];  // Support both single and multiple incorporation states
  fileNumber?: string;
  filmNumber?: string;
  columns?: string[];
  page?: number;
}

export interface SECAutocompleteSuggestion {
  name: string;
  cik: string;
  ticker: string;
}

export interface SECSearchResult {
  form: string;
  filingDate: string;
  reportingFor: string;
  filingEntity: string;
  cik: string;
  located: string;
  incorporated: string;
  fileNumber: string;
  filmNumber: string;
  accession: string;
  filingPageUrl: string | null;
  documentUrls: string[];
  dataFileUrls: string[];
  adsh: string;
  filingPageS3Key?: string | null;
  documentS3Keys?: Record<string, string>;
  dataFileS3Keys?: Record<string, string>;
}

export interface SECFormFilter {
  form: string;
  count: number;
}

export interface SECEntityFilter {
  entity: string;
  count: number;
}

export interface SECLocationFilter {
  location: string;
  count: number;
}

export interface SECIncorporationFilter {
  state: string;
  count: number;
}

export interface SECSearchResponse {
  success: boolean;
  total_found?: number;
  results?: SECSearchResult[];
  form_filters?: SECFormFilter[];  // Available form types in current search results
  entity_filters?: SECEntityFilter[];  // Available entities in current search results
  location_filters?: SECLocationFilter[];  // Available locations in current search results
  incorporation_filters?: SECIncorporationFilter[];  // Available incorporation states in current search results
  error?: string;
  // Async search fields
  job_id?: string;
  status?: string;
  message?: string;
  // Cache fields
  cached?: boolean;
  results_s3_key?: string;
}

export interface SECJobStatus {
  job_id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress?: {
    current_page: number;
    total_pages: number | null;
    results_count: number;
    total_found: number;
  };
  results?: SECSearchResponse;
  results_s3_key?: string;
  error?: string;
  cancelled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SECAutocompleteResponse {
  suggestions: SECAutocompleteSuggestion[];
}

export const secSearchAPI = {
  // Get autocomplete suggestions
  getAutocomplete: async (query: string): Promise<SECAutocompleteResponse> => {
    return apiRequest<SECAutocompleteResponse>(
      `/sec-search-autocomplete?query=${encodeURIComponent(query)}`
    );
  },

  // Perform full search (sync mode)
  search: async (params: SECSearchParams): Promise<SECSearchResponse> => {
    return apiRequest<SECSearchResponse>('/sec-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Start async search (returns job_id) - all searches are now async
  searchAsync: async (params: SECSearchParams): Promise<SECSearchResponse> => {
    return apiRequest<SECSearchResponse>('/sec-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Get job status
  getJobStatus: async (job_id: string): Promise<SECJobStatus> => {
    return apiRequest<SECJobStatus>(`/sec-search-status?job_id=${encodeURIComponent(job_id)}`, {
      method: 'GET',
    });
  },

  // Cancel a job
  cancelJob: async (job_id: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    return apiRequest<{ success: boolean; message?: string; error?: string }>('/sec-search-cancel', {
      method: 'POST',
      body: JSON.stringify({ job_id }),
    });
  },

  // Fetch results from S3
  fetchResultsFromS3: async (job_id: string, s3_key?: string): Promise<SECSearchResponse> => {
    const params = new URLSearchParams({ job_id });
    if (s3_key) {
      params.append('s3_key', s3_key);
    }
    return apiRequest<SECSearchResponse>(`/sec-search-results?${params.toString()}`, {
      method: 'GET',
    });
  },
};

// Politician Trades Search API
export interface PoliticianTradesSearchParams {
  politicianName?: string | string[]; // Support multiple politicians
  position?: string | string[]; // Support multiple positions
  party?: string | string[]; // Support multiple parties
  security?: string | string[]; // Support multiple securities (symbol and name search)
  transactionType?: string | string[]; // Support multiple transaction types
  stateDistrict?: string | string[]; // Support multiple state/districts
  keywords?: string | string[]; // Support multiple keywords for free-text search
  dateFrom?: string; // Transaction date from
  dateTo?: string; // Transaction date to
  filingDateFrom?: string; // Filing date from
  filingDateTo?: string; // Filing date to
  amountRange?: string; // Standard amount range selection (e.g., "$1,001-$15,000")
  requiresManualReview?: boolean;
  isUnparsed?: boolean;
  matchConfidence?: number;
  page?: number;
  pageSize?: number;
  lastEvaluatedKey?: { transactionDate?: number; tradeId?: string }; // Cursor for "load more" pagination
}

export interface PoliticianTrade {
  tradeId: string;
  amountMax?: number;
  amountMin?: number;
  amountRange?: number[] | string; // Array of [min, max] or string
  assetType?: string;
  comment?: string;
  filingDate?: string; // YYYY-MM-DD format
  formS3Key?: string;
  formType?: string;
  isUnparsed?: boolean;
  matchConfidence?: number;
  metadata?: any;
  owner?: string;
  party?: string;
  politicianName?: string;
  position?: string;
  processingDate?: string;
  requiresManualReview?: boolean;
  securityName?: string;
  securitySymbol?: string;
  source?: string;
  stateDistrict?: string;
  transactionDate?: number; // YYYYMMDD integer format (e.g., 20251103)
  transactionType?: string;
  websiteUrl?: string;
}

export interface PoliticianTradesSearchResponse {
  success: boolean;
  results?: PoliticianTrade[];
  total_found?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
  last_evaluated_key?: { transactionDate?: number; tradeId?: string }; // Cursor for next "load more" request
  error?: string;
}

export const politicianTradesSearchAPI = {
  search: async (params: PoliticianTradesSearchParams): Promise<PoliticianTradesSearchResponse> => {
    return apiRequest<PoliticianTradesSearchResponse>('/politician-trades-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ============================================================================
// GOVERNMENT CONTRACTS SEARCH API
// ============================================================================

export interface GovtContractsSearchFilters {
  keywords?: string[];
  award_type?: string[];
  award_id?: string[];  // Exact award ID queries (multi-select, no autocomplete)
  awarding_agency_name?: string[];
  awarding_agency_code?: string[];  // Added for API conversion
  funding_agency_name?: string[];
  funding_agency_code?: string[];  // Added for API conversion
  recipient_id?: string[];
  recipient_name?: string[];
  recipient_location_state?: string[];
  recipient_zip_code?: string[];
  recipient_location_country?: string[];
  naics_code?: string[];
  psc_code?: string[];
  cfda_number?: string[];
  min_obligation?: number;
  max_obligation?: number;
  date_year?: number;  // Fiscal year for date filtering (e.g., 2025)
  date_from?: string;  // Recently updated: filter contracts last indexed within date range (YYYY-MM-DD)
  date_to?: string;  // Recently updated: filter contracts last indexed within date range (YYYY-MM-DD)
  fiscal_year?: number[];
  [key: string]: any;  // Allow additional properties for dynamic filters
}

export interface GovtContractsSearchRequest {
  filters: GovtContractsSearchFilters;
  limit?: number;
  last_evaluated_key?: any;
}

export interface GovtContractAward {
  award_id: string;
  award_type?: string;
  total_obligated_amount?: number;  // Primary field for amount
  total_obligation?: number;  // Legacy field, kept for backward compatibility
  period_start_date?: string;
  period_end_date?: string;  // Legacy field
  period_of_performance_start_date?: string;
  period_of_performance_current_end_date?: string;
  period_of_performance_potential_end_date?: string;
  ordering_period_end_date?: string;  // For IDVs - ordering period end date
  award_or_idv_flag?: string;  // "IDV" for Indefinite Delivery Vehicles, "AWARD" for regular awards
  awarding_agency_name?: string;
  awarding_agency_code?: string;
  awarding_sub_agency_name?: string;
  awarding_sub_agency_code?: string;
  awarding_office_name?: string;
  awarding_office_code?: string;
  funding_agency_name?: string;
  funding_agency_code?: string;
  funding_sub_agency_name?: string;
  funding_sub_agency_code?: string;
  funding_office_name?: string;
  funding_office_code?: string;
  recipient_name?: string;
  recipient_id?: string;
  recipient_uei?: string;
  recipient_location_state?: string;
  recipient_state_name?: string;
  recipient_location_country?: string;
  recipient_country_name?: string;
  recipient_city_name?: string;
  recipient_county_name?: string;
  recipient_address_line_1?: string;
  recipient_address_line_2?: string;
  recipient_zip_code?: string;
  recipient_parent_name?: string;
  naics_code?: string;
  naics_description?: string;
  psc_code?: string;
  psc_description?: string;
  cfda_number?: string;
  cfda_title?: string;
  fiscal_year?: number;
  description?: string;
  transactions?: any[];
  subawards?: any[];
  is_assistance?: boolean;  // True for assistance, false for contract
  oversize_s3_key?: string;  // S3 key for oversized items
  transaction_count?: number;
  subaward_count?: number;
  usaspending_permalink?: string;
  current_total_value_of_award?: string | number;
  potential_total_value_of_award?: string | number;
  base_and_exercised_options_value?: string | number;
  base_and_all_options_value?: string | number;
  primary_place_of_performance_city_name?: string;
  primary_place_of_performance_county_name?: string;
  primary_place_of_performance_state_name?: string;
  primary_place_of_performance_state_code?: string;
  primary_place_of_performance_country_name?: string;
  primary_place_of_performance_country_code?: string;
  primary_place_of_performance_zip_4?: string;
  action_date?: string;
  last_modified_date?: string;
  last_updated?: string;
  initial_report_date?: string;
  federal_accounts_funding_this_award?: string;
  treasury_accounts_funding_this_award?: string;
  program_activities_funding_this_award?: string;
  object_classes_funding_this_award?: string;
  disaster_emergency_fund_codes_for_overall_award?: string;
  total_outlayed_amount_for_overall_award?: string | number;
  total_non_federal_funding_amount?: string | number;
  award_id_fain?: string;
  combined_obligated_amount?: number;  // Calculated sum of obligations from transactions/child awards (for IDVs)
  child_awards?: string[];  // Array of child award IDs (for IDV parents)
  child_awards_details?: Array<{  // Detailed child award information (fetched from DynamoDB)
    award_id: string;
    award_id_piid?: string;
    description?: string;
    total_obligated_amount?: number;
    period_of_performance_start_date?: string;
    period_of_performance_current_end_date?: string;
    transaction_count?: number;
    subaward_count?: number;
    award_type?: string;
    award_type_description?: string;
    recipient_name?: string;
    awarding_agency_name?: string;
    parent_idv_id?: string;  // Parent IDV ID for navigation
    is_idv_child?: boolean;  // Flag indicating this is a child award
  }>;
  parent_idv_id?: string;  // For child awards - link back to parent IDV
  is_idv_child?: boolean;  // True if this is a child award of an IDV
  is_idv_parent?: boolean;  // True if this is an IDV parent award
  [key: string]: any;
}

export interface GovtContractsSearchResponse {
  success: boolean;
  results: GovtContractAward[];
  count: number;
  has_more: boolean;
  last_evaluated_key?: any;
  method?: string;
  index_used?: string;
}

export interface GovtContractsGetAwardRequest {
  award_id: string;
}

export interface GovtContractsGetAwardResponse {
  success: boolean;
  result?: GovtContractAward;
  count?: number;
  error?: string;
}

export const govtContractsSearchAPI = {
  search: async (params: GovtContractsSearchRequest): Promise<GovtContractsSearchResponse> => {
    return apiRequest<GovtContractsSearchResponse>('/usaspending-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
  getAward: async (params: GovtContractsGetAwardRequest): Promise<GovtContractsGetAwardResponse> => {
    return apiRequest<GovtContractsGetAwardResponse>('/usaspending-search', {
      method: 'POST',
      body: JSON.stringify({ award_id: params.award_id }),
    });
  },
};

// ============================================================================
// GOVERNMENT CONTRACTS AUTOCOMPLETE API
// ============================================================================

export interface GovtContractsAutocompleteRequest {
  autocomplete_type: string;
  search_text: string;
  limit?: number;
  filter?: any;
}

export interface GovtContractsAutocompleteResponse {
  success: boolean;
  autocomplete_type: string;
  results: Array<{
    id?: string;
    code?: string;
    name?: string;
    text?: string;
    [key: string]: any;
  }>;
  messages?: string[];
  metadata?: {
    timestamp: string;
    endpoint: string;
  };
}

export const govtContractsAutocompleteAPI = {
  autocomplete: async (params: GovtContractsAutocompleteRequest): Promise<GovtContractsAutocompleteResponse> => {
    return apiRequest<GovtContractsAutocompleteResponse>('/usaspending-autocomplete', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ============================================================================
// GOVERNMENT CONTRACTS ENRICHMENT API
// ============================================================================

export interface GovtContractsEnrichmentRequest {
  award_id: string;
}

export interface GovtContractsEnrichmentResponse {
  success: boolean;
  updated?: boolean;
  message?: string;
  error?: string;
  award_id: string;
  transactions_count?: number;
  subawards_count?: number;
  child_awards_count?: number;
}

export const govtContractsEnrichmentAPI = {
  enrich: async (params: GovtContractsEnrichmentRequest): Promise<GovtContractsEnrichmentResponse> => {
    return apiRequest<GovtContractsEnrichmentResponse>('/usaspending-enrichment', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// Session Management API
export const sessionManagementAPI = {
  // Get all sessions for a user
  getSessions: async (userId: string): Promise<{ sessions: any[], count: number }> => {
    console.log('📋 API - Getting sessions for user:', userId);
    return apiRequest<{ sessions: any[], count: number }>(`/sessions?user_id=${userId}`, {
      method: 'GET',
    });
  },

  // Get a specific session with all messages
  getSession: async (sessionId: string, userId: string): Promise<any> => {
    console.log('📋 API - Getting session:', { sessionId, userId });
    return apiRequest<any>(`/session?session_id=${sessionId}&user_id=${userId}`, {
      method: 'GET',
    });
  },

  // Create a new session
  createSession: async (userId: string, sessionData: {
    title?: string;
    model?: string;
    create_welcome_message?: boolean;
  }): Promise<{ session_id: string, title: string, model: string, created_at: number, message_count: number }> => {
    const requestBody = {
      title: sessionData.title || new Date().toLocaleString(),
      model: sessionData.model || 'claude-sonnet-4',
      create_welcome_message: sessionData.create_welcome_message !== false
    };
    console.log('📋 API - Creating session:', { userId, requestBody });
    return apiRequest<{ session_id: string, title: string, model: string, created_at: number, message_count: number }>(`/sessions?user_id=${userId}`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  },

  // Update session (add messages or update metadata)
  updateSession: async (sessionId: string, userId: string, updateData: {
    messages?: Array<{ content: string, sender: string, message_type?: string, metadata?: any }>;
    title?: string;
    model?: string;
    session_variables?: any;
  }): Promise<any> => {
    console.log('📋 API - Updating session:', { sessionId, userId, updateData });
    return apiRequest<any>(`/session?user_id=${userId}&session_id=${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
  },

  // Delete a session
  deleteSession: async (sessionId: string, userId: string): Promise<{ message: string }> => {
    console.log('📋 API - Deleting session:', { sessionId, userId });
    return apiRequest<{ message: string }>(`/session?session_id=${sessionId}&user_id=${userId}`, {
      method: 'DELETE',
    });
  },

  // Share/Export a session
  shareSession: async (
    sessionId: string,
    userId: string,
    shareType: 'link' | 'download'
  ): Promise<{ success: boolean; shareId?: string; shareLink?: string; downloadUrl?: string; error?: string }> => {
    return apiRequest<{ success: boolean; shareId?: string; shareLink?: string; downloadUrl?: string; error?: string }>(
      `/session-share?userId=${userId}`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, shareType }),
      }
    );
  },

  // Import a session
  importSession: async (
    userId: string,
    importType: 'file' | 'link',
    fileContent?: string,
    shareId?: string
  ): Promise<{ success: boolean; session_id?: string; session_data?: any; error?: string }> => {
    const body: any = {
      importType,
    };

    if (importType === 'file' && fileContent) {
      body.fileContent = fileContent;
    } else if (importType === 'link' && shareId) {
      body.shareId = shareId;
    }

    return apiRequest<{ success: boolean; session_id?: string; session_data?: any; error?: string }>(
      `/session-import?userId=${userId}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  },
};

// ============================================================================
// CONGRESS BILLS SEARCH API
// ============================================================================

export interface CongressBillsSearchFilters {
  bill_title?: string[];
  bill_type?: string[];
  sponsor_name?: string[]; // Deprecated: use politician_name instead
  politician_name?: string[]; // New: searches both sponsor and cosponsor
  politician_role?: ('sponsor' | 'cosponsor')[]; // Filter by role: [] = both, ['sponsor'] = sponsor only, ['cosponsor'] = cosponsor only, ['sponsor', 'cosponsor'] = both
  introduced_date_from?: string;
  introduced_date_to?: string;
  congress?: number[];
  policy_area?: string[];
  sponsor_party?: string[];
  latest_action_date_from?: string;
  latest_action_date_to?: string;
  bipartisan?: number;
  bill_number?: number;
  /** 1 = only bills that have roll call votes (uses HasRollCallIndex GSI) */
  has_roll_call?: number;
  [key: string]: any;
}

export interface CongressBill {
  bill_id: string;
  bill_title?: string;
  bill_type?: string;
  bill_number?: number;
  sponsor_full_name?: string;
  sponsor_party?: string;
  sponsor_state?: string;
  introduced_date?: string;
  latest_action_date?: string;
  latest_action_text?: string;
  congress?: number;
  bipartisan?: number;
  policy_area?: string;
  [key: string]: any;
}

export interface CongressBillsSearchResponse {
  success: boolean;
  results?: CongressBill[];
  has_more?: boolean;
  last_evaluated_key?: any;
  count?: number;
  method?: string;
  index_used?: string;
}

/** Roll call search: SEARCH#VOTE (by politician_ids) or SEARCH#ROLL (by congress/session/roll). Returns full table rows, 100 per page. */
export interface RollCallSearchParams {
  search_index: 'SEARCH#VOTE' | 'SEARCH#ROLL';
  politician_ids?: string[];
  politician_id?: string;
  congress?: number;
  session?: number;
  roll?: number;
  limit?: number;
  last_evaluated_key?: any;
}

export interface RollCallSearchResponse {
  success: boolean;
  results?: any[];
  /** Enriched rows with only fields needed for display/filter (bill_title, roll_date, bill_type, sponsor_party, etc.) */
  enriched_results?: any[];
  has_more?: boolean;
  last_evaluated_key?: any;
  count?: number;
  search_index?: string;
  error?: string;
}

export const congressBillsSearchAPI = {
  search: async (params: {
    filters: CongressBillsSearchFilters;
    limit?: number;
    last_evaluated_key?: any;
  }): Promise<CongressBillsSearchResponse> => {
    console.log('📋 API - Searching congress bills:', params);
    return apiRequest<CongressBillsSearchResponse>('/congress-bills-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
  /** Roll call search: SEARCH#VOTE or SEARCH#ROLL indices; returns full rows, up to 100 per page. */
  rollCallSearch: async (params: RollCallSearchParams): Promise<RollCallSearchResponse> => {
    const body: Record<string, any> = {
      roll_call_search: {
        search_index: params.search_index,
        limit: Math.min(100, Math.max(1, params.limit ?? 100)),
        last_evaluated_key: params.last_evaluated_key,
      },
    };
    if (params.search_index === 'SEARCH#VOTE') {
      body.roll_call_search.politician_ids = params.politician_ids ?? (params.politician_id ? [params.politician_id] : []);
    } else {
      if (params.congress != null) body.roll_call_search.congress = params.congress;
      if (params.session != null) body.roll_call_search.session = params.session;
      if (params.roll != null) body.roll_call_search.roll = params.roll;
    }
    return apiRequest<RollCallSearchResponse>('/congress-bills-search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  getBill: async (params: { bill_id: string }): Promise<{
    success: boolean;
    result?: any;
    count?: number;
    error?: string;
  }> => {
    console.log('📋 API - Fetching congress bill by ID:', params);
    return apiRequest('/congress-bills-search', {
      method: 'POST',
      body: JSON.stringify({ bill_id: params.bill_id }),
    });
  },
  /** Single roll call details for details page (congress, session, roll). Returns roll item + bill_associated + vote_summary + members. */
  getRollCallDetails: async (params: {
    congress: number;
    session: number;
    roll: number;
  }): Promise<{
    success: boolean;
    result?: RollCallDetailsResult;
    error?: string;
  }> => {
    return apiRequest('/congress-bills-search', {
      method: 'POST',
      body: JSON.stringify({
        roll_call_details: {
          congress: params.congress,
          session: params.session,
          roll: params.roll,
        },
      }),
    });
  },
};

/** Single roll call details: roll item with bill_associated, vote_summary, and members list. */
export interface RollCallDetailsResult {
  congress: number;
  session: number;
  roll: number;
  search_index_sk: string;
  bill_id_associated?: string;
  roll_display?: string;
  vote_question?: string;
  result?: string;
  result_display?: string;
  vote_type?: string;
  latest_action_date?: string;
  legislation_number?: string;
  legislation_type?: string;
  legislation_url?: string;
  bill_associated?: {
    bill_id?: string;
    bill_title?: string;
    short_title?: string;
    latest_action_text?: string;
    latest_action_date?: string;
  };
  vote_summary?: {
    total?: { yea?: number; nay?: number; present?: number; not_voting?: number };
    by_party?: Record<string, { yea?: number; nay?: number; present?: number; not_voting?: number }>;
  };
  members?: RollCallMemberVote[];
}

export interface RollCallMemberVote {
  voteCast?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  voteParty?: string;
  party?: string;
  state?: string;
  stateCode?: string;
  voteState?: string;
  bioguideID?: string;
}

export const congressBillsAutocompleteAPI = {
  autocomplete: async (params: {
    autocomplete_type: 'sponsor_name' | 'bill_title' | 'policy_area';
    search_text: string;
    limit?: number;
  }): Promise<{
    success: boolean;
    results?: Array<{ name?: string; text?: string; value?: string; [key: string]: any }>;
  }> => {
    console.log('📋 API - Autocomplete congress bills:', params);
    return apiRequest('/congress-bills-autocomplete', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ============================================================================
// LDA SEARCH API
// ============================================================================

export interface LDASearchFilters {
  general_text_search?: string[]; // Legacy format
  general_text_search_fields?: {
    registrant?: string[] | false;
    client?: string[] | false;
    lobbyist?: string[] | false;
    pac?: string[] | false;
    foreign?: string[] | false;
  };
  date_from?: string;
  date_to?: string;
  report_type?: string[];
  amount_min?: number;
  amount_max?: number;
  registrant_name?: string[];
  client_name?: string[];
  lobbyist_name?: string[];
  foreign_entity_name?: string[];
  general_issue_code?: string[];
  state?: string[];
  government_entity?: string[];  // Government entity names (not IDs)
  government_entity_id?: number[];  // Legacy - kept for backwards compatibility
  filing_period?: string[];
  contribution_item_type?: string[];
  is_foreign?: boolean;
  pac?: boolean;
  filer_type?: string[];
  item_type?: string[];  // FILING or CONTRIBUTION - filters by PK prefix
  [key: string]: any;
}

export interface LDAFiling {
  id?: string;
  filing_uuid?: string;
  report_type?: string;
  registrant_name?: string;
  client_name?: string;
  lobbyist_name?: string;
  amount_reported?: number;
  dt_posted?: string;
  state?: string;
  general_issue_code?: string;
  filing_period?: string;
  filing_year?: number;
  [key: string]: any;
}

export interface LDASearchResponse {
  success: boolean;
  results?: LDAFiling[];
  has_more?: boolean;
  last_evaluated_key?: any;
  count?: number;
  method?: string;
  index_used?: string;
}

export interface LDAGetFilingRequest {
  filing_id: string;
}

export interface LDAGetFilingResponse {
  success: boolean;
  result?: LDAFiling;
  count?: number;
  error?: string;
}

export const ldaSearchAPI = {
  search: async (params: {
    filters: LDASearchFilters;
    limit?: number;
    last_evaluated_key?: any;
  }): Promise<LDASearchResponse> => {
    console.log('📋 API - Searching LDA filings:', params);
    return apiRequest<LDASearchResponse>('/lda-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
  getFiling: async (params: LDAGetFilingRequest): Promise<LDAGetFilingResponse> => {
    console.log('📋 API - Getting LDA filing:', params.filing_id);
    return apiRequest<LDAGetFilingResponse>('/lda-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// FEC Campaign Finance
export interface FECSearchHit {
  entity_type: 'candidate' | 'committee';
  entity_id: string;
  name: string;
  subtitle?: string;
  cycles?: number[];
  party?: string;
  state?: string;
  office?: string;
  committee_type?: string;
}

export interface FECSearchFilters {
  q?: string;
  cycle?: number;
}

export interface FECSearchResponse {
  success: boolean;
  results?: FECSearchHit[];
  count?: number;
  cycle?: number;
  error?: string;
}

export interface FECProfileResponse {
  success: boolean;
  result?: Record<string, unknown> | null;
  count?: number;
  error?: string;
}

export interface FECSchedulesResponse {
  success: boolean;
  results?: Record<string, unknown>[];
  count?: number;
  page?: number;
  per_page?: number;
  total_rows?: number;
  total_pages?: number;
  has_more?: boolean;
  schedule?: string;
  s3_key?: string;
  error?: string;
}

export const fecSearchAPI = {
  search: async (params: {
    filters: FECSearchFilters;
    limit?: number;
  }): Promise<FECSearchResponse> => {
    return apiRequest<FECSearchResponse>('/fec-search', {
      method: 'POST',
      body: JSON.stringify({ action: 'search', filters: params.filters, limit: params.limit }),
    });
  },
  getProfile: async (params: {
    entity_type: 'candidate' | 'committee';
    entity_id: string;
    cycle: number;
  }): Promise<FECProfileResponse> => {
    return apiRequest<FECProfileResponse>('/fec-search', {
      method: 'POST',
      body: JSON.stringify({ action: 'profile', ...params }),
    });
  },
  getSchedules: async (params: {
    entity_id: string;
    cycle: number;
    schedule: 'schedule_a' | 'schedule_b' | 'schedule_e';
    page?: number;
    per_page?: number;
  }): Promise<FECSchedulesResponse> => {
    return apiRequest<FECSchedulesResponse>('/fec-search', {
      method: 'POST',
      body: JSON.stringify({ action: 'schedules', entity_type: 'committee', ...params }),
    });
  },
};

export interface LDAAutocompleteResponse {
  success: boolean;
  results?: Array<{ value: string; type: string; label: string }>;
  count?: number;
  total_count?: number;
  has_more?: boolean;
  offset?: number;
  limit?: number;
  query?: string;
  field_types?: string[];
  metadata?: {
    timestamp?: string;
    bucket?: string;
  };
}

export interface LDAAutocompleteItem {
  value: string;
  type: string;
  label: string;
}

export const ldaAutocompleteAPI = {
  search: async (params: {
    query: string;
    field_types?: string[];
    limit?: number;
    offset?: number;
  }): Promise<LDAAutocompleteResponse> => {
    console.log('📋 API - LDA autocomplete:', params);
    const response = await apiRequest<LDAAutocompleteResponse>('/lda-autocomplete', {
      method: 'POST',
      body: JSON.stringify({
        query: params.query,
        field_types: params.field_types || ['registrant', 'client', 'lobbyist', 'pac'],
        limit: params.limit || 20,
        offset: params.offset || 0,
      }),
    });
    // Return the full response including pagination info
    return response;
  },
};

// ============================================================================
// FILE RETURN API
// ============================================================================

export interface FileDownloadRequest {
  user_id: string;
  s3_key?: string;
  filename?: string;
  session_id?: string;
  bucket?: string;
  request_type?: 'download' | 'preview';
  item_type?: 'context_item' | 'uploaded_file' | 'agent_file';
}

export interface FileDownloadResponse {
  success: boolean;
  data?: {
    download_url?: string;
    preview_url?: string;
    preview_type?: 'context_item' | 'image' | 'pdf' | 'text' | 'download_only';
    content?: any;
    filename?: string;
    expires_in?: number;
    content_type?: string;
    file_size?: number;
    metadata?: any;
    message?: string;
  };
  error?: string;
}

export const fileReturnAPI = {
  downloadFile: async (params: FileDownloadRequest): Promise<FileDownloadResponse> => {
    console.log('📥 API - File download:', params);
    try {
      const response = await apiRequest<any>('/file-download', {
        method: 'POST',
        body: JSON.stringify({
          ...params,
          request_type: 'download',
        }),
      });
      
      // Wrap the response in the expected format
      if (response && typeof response === 'object' && 'download_url' in response) {
        // Direct response from lambda - wrap it
        return {
          success: true,
          data: {
            download_url: response.download_url,
            filename: response.filename,
            expires_in: response.expires_in,
          },
        };
      } else if (response && typeof response === 'object' && 'success' in response) {
        // Already wrapped response
        return response as FileDownloadResponse;
      } else {
        // Unexpected response format
        console.error('Unexpected download response format:', response);
        return {
          success: false,
          error: 'Unexpected response format from server',
        };
      }
    } catch (error: any) {
      console.error('❌ File download error:', error);
      return {
        success: false,
        error: error.message || 'Failed to download file',
      };
    }
  },

  getFileContent: async (params: FileDownloadRequest): Promise<{ success: boolean; file_content?: string; filename?: string; error?: string }> => {
    console.log('📥 API - Get file content:', params);
    try {
      const response = await apiRequest<any>('/file-download', {
        method: 'POST',
        body: JSON.stringify({
          ...params,
          request_type: 'content',
        }),
      });
      
      if (response && typeof response === 'object' && 'file_content' in response) {
        return {
          success: true,
          file_content: response.file_content,
          filename: response.filename,
        };
      } else {
        return {
          success: false,
          error: response?.error || 'Unexpected response format from server',
        };
      }
    } catch (error: any) {
      console.error('❌ Get file content error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get file content',
      };
    }
  },

  previewFile: async (params: FileDownloadRequest): Promise<FileDownloadResponse> => {
    console.log('👁️ API - File preview:', params);
    try {
      const response = await apiRequest<any>('/file-download', {
        method: 'POST',
        body: JSON.stringify({
          ...params,
          request_type: 'preview',
        }),
      });
      
      // The lambda returns the preview data directly in the body, not wrapped in {success, data}
      // Check if response already has success field (wrapped) or is direct data
      if (response && typeof response === 'object' && 'success' in response) {
        // Already wrapped
        return response as FileDownloadResponse;
      } else if (response && typeof response === 'object' && ('preview_type' in response || 'content' in response)) {
        // Direct response from lambda - wrap it
        return {
          success: true,
          data: response,
        };
      } else {
        // Unexpected response format
        console.error('Unexpected response format:', response);
        return {
          success: false,
          error: 'Unexpected response format from server',
        };
      }
    } catch (error: any) {
      console.error('❌ File preview error:', error);
      return {
        success: false,
        error: error.message || 'Failed to preview file',
      };
    }
  },
};

// ============================================================================
// FILESYSTEM API
// ============================================================================

export interface FilesystemAddFileRequest {
  user_id: string;
  folder_path?: string;
  file_content: string; // Base64 encoded (for small files)
  filename: string;
  title?: string;
  description?: string;
  file_size?: number; // File size in bytes (for large file detection)
  use_presigned_url?: boolean; // Force use of pre-signed URL
}

export interface FilesystemAddContextItemRequest {
  user_id: string;
  folder_path?: string;
  context_data: any; // Full JSON object
  title: string;
  item_type?: 'context_item' | 'tile' | 'sec_filing' | 'lda_disclosure' | 'congress_bill' | 'roll_call' | 'politician_trade' | 'govt_contract' | 'news_article' | 'stock_result';
}

export interface FilesystemAddBulkContextItemsRequest {
  user_id: string;
  folder_path?: string;
  items: Array<{
    context_data: any; // Full JSON object
    title: string;
    item_type?: 'context_item' | 'tile' | 'sec_filing' | 'lda_disclosure' | 'congress_bill' | 'roll_call' | 'politician_trade' | 'govt_contract' | 'news_article' | 'stock_result';
  }>;
}

export interface FilesystemCreateFolderRequest {
  user_id: string;
  folder_name: string;
  parent_path?: string;
}

export interface FilesystemDeleteItemRequest {
  user_id: string;
  folder_path?: string;
  item_id: string;
}

export interface FilesystemDeleteBulkItemsRequest {
  user_id: string;
  items: Array<{
    item_id: string;
    folder_path?: string;
    is_folder?: boolean;
  }>;
}

export interface FilesystemDeleteFolderRequest {
  user_id: string;
  folder_path: string;
}

export interface FilesystemMoveItemRequest {
  user_id: string;
  item_id: string;
  source_folder_path?: string;
  dest_folder_path?: string;
}

export interface FilesystemMoveBulkItemsRequest {
  user_id: string;
  items: Array<{
    item_id: string;
    source_folder_path?: string;
  }>;
  dest_folder_path?: string;
}

export interface FilesystemRenameItemRequest {
  user_id: string;
  folder_path?: string;
  item_id: string;
  new_name: string;
}

export interface FilesystemUpdateItemRequest {
  user_id: string;
  folder_path?: string;
  item_id: string;
  content_data: any; // Full JSON object to save
}

export interface FilesystemListFolderRequest {
  user_id: string;
  folder_path?: string;
}

export interface FilesystemGetItemRequest {
  user_id: string;
  folder_path?: string;
  item_id: string;
}

export interface FilesystemCopyItemRequest {
  user_id: string;
  folder_path?: string;
  item_id: string;
}

export interface FilesystemCopyFolderRequest {
  user_id: string;
  folder_path: string;
}

export interface FilesystemPasteItemRequest {
  user_id: string;
  dest_folder_path?: string;
  clipboard_data: any; // Clipboard data from copy operation
}

export interface FilesystemPasteItemsByIdsRequest {
  user_id: string;
  dest_folder_path?: string;
  item_data: Array<{
    item_id: string;
    source_folder_path: string;
    is_folder: boolean;
  }>;
}

export interface FilesystemResponse<T = any> {
  success: boolean;
  result?: T;
  error?: string;
}

export const filesystemAPI = {
  addFile: async (params: FilesystemAddFileRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Adding',
        itemCount: 1
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      // Check file size - base64 increases size by ~33%, so 4MB raw = ~5.3MB encoded
      // API Gateway has 10MB limit, so we use 4MB threshold for safety
      const fileSize = params.file_size;
      const usePresigned = params.use_presigned_url || (fileSize && fileSize > 4 * 1024 * 1024);
      
      if (usePresigned && fileSize) {
        // For large files (>4MB), use pre-signed S3 POST URL
        // Step 1: Get pre-signed upload URL
        const uploadUrlResponse = await apiRequest<FilesystemResponse>('/filesystem', {
          method: 'POST',
          body: JSON.stringify({
            operation: 'get_upload_url',
            user_id: params.user_id,
            folder_path: params.folder_path,
            filename: params.filename,
            file_size: fileSize,
          }),
        });
        
        if (!uploadUrlResponse.success || !uploadUrlResponse.result) {
          throw new Error(uploadUrlResponse.error || 'Failed to get upload URL');
        }
        
        const { upload_url, fields, s3_key } = uploadUrlResponse.result;
        
        // Step 2: Upload file directly to S3 using FormData
        // IMPORTANT: For S3 POST, the file field MUST be the last field
        const formData = new FormData();
        
        // Add all fields from pre-signed POST FIRST (including signature, policy, etc.)
        // These must come before the file field
        console.log('📦 [FILESYSTEM] Pre-signed POST fields:', Object.keys(fields));
        Object.entries(fields).forEach(([key, value]) => {
          formData.append(key, value as string);
        });
        
        // Decode base64 and add file as Blob LAST (S3 POST requirement)
        const binaryString = atob(params.file_content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // Don't set Content-Type on Blob - let FormData/browser handle it automatically
        // Setting it explicitly can cause policy mismatches
        const fileBlob = new Blob([bytes]);
        
        // For S3 POST, the file field should just be 'file' (no filename parameter)
        // The filename is already in the 'key' field from the presigned POST
        formData.append('file', fileBlob);
        
        console.log('📦 [FILESYSTEM] FormData prepared, file size:', fileBlob.size, 'bytes');
        
        // Upload to S3
        const uploadResponse = await fetch(upload_url, {
          method: 'POST',
          body: formData,
        });
        
        if (!uploadResponse.ok) {
          // Try to get error details from S3 response
          let errorDetails = '';
          try {
            const errorText = await uploadResponse.text();
            errorDetails = ` - Response: ${errorText.substring(0, 200)}`;
          } catch (e) {
            // Ignore if can't read response
          }
          throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}${errorDetails}`);
        }
        
        // Step 3: Confirm upload and register in filesystem
        const confirmResponse = await apiRequest<FilesystemResponse>('/filesystem', {
          method: 'POST',
          body: JSON.stringify({
            operation: 'confirm_upload',
            user_id: params.user_id,
            folder_path: params.folder_path,
            s3_key: s3_key,
            filename: params.filename,
            title: params.title,
            description: params.description,
          }),
        });
        
        // Dispatch success notification
        if (confirmResponse.success && confirmResponse.result) {
          const successEvent = new CustomEvent('filesystem-success', {
            detail: { 
              itemCount: 1,
              itemName: confirmResponse.result.name || params.filename || 'File'
            }
          });
          window.dispatchEvent(successEvent);
        }
        
        return confirmResponse;
      } else {
        // For small files, use existing base64 upload flow
        const smallFileResponse = await apiRequest<FilesystemResponse>('/filesystem', {
          method: 'POST',
          body: JSON.stringify({
            operation: 'add_file',
            ...params,
          }),
        });
        
        // Dispatch success notification
        if (smallFileResponse.success && smallFileResponse.result) {
          const successEvent = new CustomEvent('filesystem-success', {
            detail: { 
              itemCount: 1,
              itemName: smallFileResponse.result.name || params.filename || 'File'
            }
          });
          window.dispatchEvent(successEvent);
        }
        
        return smallFileResponse;
      }
    } catch (error: any) {
      console.error('❌ Filesystem add file error:', error);
      
      // Handle 413 Content Too Large
      if (error.response?.status === 413 || error.message?.includes('413')) {
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: 'File is too large. Please use a file smaller than 10MB, or the system will automatically use direct S3 upload for large files.'
          }
        });
        window.dispatchEvent(errorEvent);
        return {
          success: false,
          error: 'File is too large. Maximum size is 10MB.',
        };
      }
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'adding file'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to add file'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to add file',
      };
    }
  },

  addContextItem: async (params: FilesystemAddContextItemRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Adding',
        itemCount: 1
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'add_context_item',
          ...params,
        }),
      });
      
      // Dispatch success notification
      if (response.success && response.result) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: 1,
            itemName: response.result.name || params.title || 'Item'
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem add context item error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'adding item'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to add context item'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to add context item',
      };
    }
  },

  addBulkContextItems: async (params: FilesystemAddBulkContextItemsRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Adding',
        itemCount: params.items.length
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'add_bulk_context_items',
          ...params,
        }),
      });
      
      // Dispatch success notification
      if (response.success && response.result) {
        const result = response.result as any;
        const itemCount = result.succeeded || params.items.length;
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: itemCount,
            itemName: itemCount === 1 ? 'Item' : `${itemCount} items`
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem add bulk context items error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'adding items'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to add bulk context items'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to add bulk context items',
      };
    }
  },

  createFolder: async (params: FilesystemCreateFolderRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'create_folder',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem create folder error:', error);
      return {
        success: false,
        error: error.message || 'Failed to create folder',
      };
    }
  },

  deleteItem: async (params: FilesystemDeleteItemRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Deleting',
        itemCount: 1
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'delete_item',
          ...params,
        }),
      });
      
      // Dispatch success notification if successful
      if (response.success) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: 1,
            itemName: 'Item'
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem delete item error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'deleting item'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to delete item'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to delete item',
      };
    }
  },

  deleteBulkItems: async (params: FilesystemDeleteBulkItemsRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const itemCount = params.items?.length || 1;
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Deleting',
        itemCount: itemCount
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'delete_bulk_items',
          ...params,
        }),
      });
      
      // Dispatch success notification if successful
      if (response.success) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: itemCount,
            itemName: itemCount === 1 ? 'Item' : `${itemCount} items`
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem delete bulk items error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'deleting items'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to delete bulk items'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to delete bulk items',
      };
    }
  },

  deleteFolder: async (params: FilesystemDeleteFolderRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Deleting',
        itemCount: 1
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'delete_folder',
          ...params,
        }),
      });
      
      // Dispatch success notification if successful
      if (response.success) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: 1,
            itemName: 'Folder'
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem delete folder error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'deleting folder'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to delete folder'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to delete folder',
      };
    }
  },

  moveItem: async (params: FilesystemMoveItemRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Moving',
        itemCount: 1
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'move_item',
          ...params,
        }),
      });
      
      // Dispatch success notification if successful
      if (response.success) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: 1,
            itemName: 'Item'
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem move item error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'moving item'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to move item'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to move item',
      };
    }
  },

  moveBulkItems: async (params: FilesystemMoveBulkItemsRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const itemCount = params.items?.length || 1;
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Moving',
        itemCount: itemCount
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'move_bulk_items',
          ...params,
        }),
      });
      
      // Dispatch success notification if successful
      if (response.success) {
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: itemCount,
            itemName: itemCount === 1 ? 'Item' : `${itemCount} items`
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem move bulk items error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'moving items'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to move bulk items'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to move bulk items',
      };
    }
  },

  renameItem: async (params: FilesystemRenameItemRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'rename_item',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem rename item error:', error);
      return {
        success: false,
        error: error.message || 'Failed to rename item',
      };
    }
  },

  updateItem: async (params: FilesystemUpdateItemRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'update_item',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem update item error:', error);
      return {
        success: false,
        error: error.message || 'Failed to update item',
      };
    }
  },

  listFolder: async (params: FilesystemListFolderRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'list_folder',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem list folder error:', error);
      return {
        success: false,
        error: error.message || 'Failed to list folder',
      };
    }
  },

  getItem: async (params: FilesystemGetItemRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'get_item',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem get item error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get item',
      };
    }
  },

  copyItem: async (params: FilesystemCopyItemRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'copy_item',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem copy item error:', error);
      return {
        success: false,
        error: error.message || 'Failed to copy item',
      };
    }
  },

  copyFolder: async (params: FilesystemCopyFolderRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'copy_folder',
          ...params,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem copy folder error:', error);
      return {
        success: false,
        error: error.message || 'Failed to copy folder',
      };
    }
  },

  pasteItem: async (params: FilesystemPasteItemRequest): Promise<FilesystemResponse> => {
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'paste_item',
          ...params,
        }),
      });
      
      // Dispatch success notification
      if (response.success && response.result) {
        const itemName = response.result.name || 'Item';
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: 1,
            itemName: itemName
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem paste item error:', error);
      return {
        success: false,
        error: error.message || 'Failed to paste item',
      };
    }
  },

  pasteItemsByIds: async (params: FilesystemPasteItemsByIdsRequest): Promise<FilesystemResponse> => {
    // Dispatch loading notification
    const itemCount = params.item_data?.length || 1;
    const loadingEvent = new CustomEvent('filesystem-loading', {
      detail: { 
        operation: 'Copying',
        itemCount: itemCount
      }
    });
    window.dispatchEvent(loadingEvent);
    
    try {
      const response = await apiRequest<FilesystemResponse>('/filesystem', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'paste_items_by_ids',
          ...params,
        }),
      });
      
      // Dispatch success notification
      if (response.success && response.result) {
        const count = response.result.count || itemCount;
        const successEvent = new CustomEvent('filesystem-success', {
          detail: { 
            itemCount: count,
            itemName: count === 1 ? 'Item' : `${count} items`
          }
        });
        window.dispatchEvent(successEvent);
      }
      
      return response;
    } catch (error: any) {
      console.error('❌ Filesystem paste items by IDs error:', error);
      
      // Handle 504 Gateway Timeout
      if (error.response?.status === 504 || error.code === 'ECONNABORTED') {
        const timeoutEvent = new CustomEvent('filesystem-timeout', {
          detail: { 
            operation: 'copying items'
          }
        });
        window.dispatchEvent(timeoutEvent);
      } else {
        // Dispatch error notification for other errors
        const errorEvent = new CustomEvent('filesystem-error', {
          detail: { 
            error: error.message || 'Failed to paste items'
          }
        });
        window.dispatchEvent(errorEvent);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to paste items',
      };
    }
  },
};

export const api = {
  stockVolatility: stockVolatilityAPI,
  stockData: stockDataAPI,
  portfolioAnalysis: portfolioAnalysisAPI,
  cryptoStats: cryptoStatsAPI,
  optionPricing: optionPricingAPI,
  stockAlerts: stockAlertsAPI,
  stockScreener: stockScreenerAPI,
  newsSearch: newsSearchAPI,
  chat: chatAPI,
  health: apiHealthAPI,
  dashboard: dashboardAPI,
  sessions: sessionManagementAPI,
  secSearch: secSearchAPI,
  politicianTradesSearch: politicianTradesSearchAPI,
  govtContractsSearch: govtContractsSearchAPI,
  govtContractsAutocomplete: govtContractsAutocompleteAPI,
  govtContractsEnrichment: govtContractsEnrichmentAPI,
  congressBillsSearch: congressBillsSearchAPI,
  congressBillsAutocomplete: congressBillsAutocompleteAPI,
  ldaSearch: ldaSearchAPI,
  ldaAutocomplete: ldaAutocompleteAPI,
  fecSearch: fecSearchAPI,
  fileReturn: fileReturnAPI,
  filesystem: filesystemAPI,
  billing: {
    getSpendingSummary: async (year?: string): Promise<{ success: boolean; current_month_total: number; monthly_data: any[]; available_years?: string[]; requested_year?: string | null }> => {
      const yearParam = year ? `&year=${year}` : '';
      return apiRequest<{ success: boolean; current_month_total: number; monthly_data: any[]; available_years?: string[]; requested_year?: string | null }>(`/billing-spending?summary=true${yearParam}`, {
        method: 'GET',
      });
    },
    getEarningsSummary: async (month?: string): Promise<{ success: boolean; current_month_total: number; total_raised: number; monthly_earnings: any[] }> => {
      const monthParam = month ? `&month=${month}` : '';
      return apiRequest<{ success: boolean; current_month_total: number; total_raised: number; monthly_earnings: any[] }>(`/billing-payment?summary=true${monthParam}`, {
        method: 'GET',
      });
    },
    createPaymentIntent: async (amount: number, currency: string = 'usd', metadata?: Record<string, string>): Promise<{ success: boolean; payment_intent: { client_secret: string; payment_intent_id: string; amount: number; currency: string } }> => {
      return apiRequest<{ success: boolean; payment_intent: { client_secret: string; payment_intent_id: string; amount: number; currency: string } }>(`/billing-payment`, {
        method: 'POST',
        body: JSON.stringify({
          operation: 'create_payment_intent',
          amount,
          currency,
          metadata: metadata || {}
        }),
      });
    },
  },
};

   