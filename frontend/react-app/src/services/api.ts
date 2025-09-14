// API service for connecting to backend Lambda functions
// This service handles all API calls to the AWS API Gateway endpoints

import { API_CONFIG, logApiConfig } from '../config/api';
import axios from 'axios';

const API_BASE_URL = API_CONFIG.BASE_URL;

// Debug logging on import
console.log('🚀 API Service initialized with:', {
  baseUrl: API_BASE_URL,
  isConfigured: API_CONFIG.BASE_URL !== 'https://your-api-gateway-url.amazonaws.com/staging'
});

// Common headers for all API requests
const getHeaders = () => ({
  'Content-Type': 'application/json'
});

// Generic API request function
export const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  console.log(`🌐 Making API request to: ${url}`);
  
  try {
    console.log(`📡 Request config:`, {
      method: options.method || 'GET',
      headers: getHeaders(),
    });

    console.log('url', url);
    
    // Use appropriate axios method based on HTTP method
    let response;
    if (options.method === 'POST') {
      response = await axios.post(url, options.body, { headers: getHeaders() });
    } else if (options.method === 'DELETE') {
      response = await axios.delete(url, { headers: getHeaders() });
    } else {
      response = await axios.get(url, { headers: getHeaders() });
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
      console.error(`🔍 Network Error Details:`, {
        url,
        baseUrl: API_BASE_URL,
        endpoint,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
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
  id: string;
  type: 'crypto' | 'stock' | 'custom' | 'placeholder';
  symbol?: string;
  timeframe?: string;
  title: string;
  displayOptions?: any;
  autoRefresh?: boolean;
  isPinned?: boolean;
  size: { width: number; height: number };
  gridPosition: { x: number; y: number };
  gridSize: { width: number; height: number };
  dashboard_id: string;
  created_at: string;
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
  dashboards: Array<{
    id: string;
    tabId: string;
    name: string;
    tiles: DashboardTile[];
    layout: string;
    created_at: string;
  }>;
  activeTabId: string;
  nextTabId: number;
  nextGroupId: number;
  last_updated: string;
}

export interface TilePositionUpdate {
  gridPosition?: { x: number; y: number };
  gridSize?: { width: number; height: number };
}

export const dashboardAPI = {
  getDashboard: async (userId: string = 'current-user'): Promise<{ dashboard_config: DashboardConfig }> => {
    return apiRequest<{ dashboard_config: DashboardConfig }>(`/dashboard?userId=${userId}`, {
      method: 'GET',
    });
  },

  updateDashboard: async (dashboardConfig: DashboardConfig): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>('/dashboard', {
      method: 'PUT',
      body: JSON.stringify({ dashboard_config: dashboardConfig }),
    });
  },

  addTile: async (tile: Partial<DashboardTile>, dashboardId?: string): Promise<{ tile: DashboardTile; message: string }> => {
    return apiRequest<{ tile: DashboardTile; message: string }>('/tiles', {
      method: 'POST',
      body: JSON.stringify({ 
        tile,
        dashboard_id: dashboardId 
      }),
    });
  },

  updateTile: async (tileId: string, updates: Partial<DashboardTile>): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/tiles/${tileId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  updateTilePosition: async (tileId: string, positionUpdate: TilePositionUpdate): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/tiles/${tileId}/position`, {
      method: 'PUT',
      body: JSON.stringify(positionUpdate),
    });
  },

  removeTile: async (tileId: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>(`/tiles/${tileId}`, {
      method: 'DELETE',
    });
  },
};

export const api = {
  stockVolatility: stockVolatilityAPI,
  stockData: stockDataAPI,
  portfolioAnalysis: portfolioAnalysisAPI,
  cryptoStats: cryptoStatsAPI,
  optionPricing: optionPricingAPI,
  stockAlerts: stockAlertsAPI,
  chat: chatAPI,
  health: apiHealthAPI,
  dashboard: dashboardAPI,
};

export default api;
