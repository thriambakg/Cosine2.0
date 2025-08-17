// API service for connecting to backend Lambda functions
// This service handles all API calls to the AWS API Gateway endpoints

import { API_CONFIG, getApiUrl, isApiConfigured } from '../config/api';

const API_BASE_URL = API_CONFIG.BASE_URL;

// Common headers for all API requests
const getHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
});

// Generic API request function
const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const config: RequestInit = {
    headers: getHeaders(),
    ...options,
  };

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API request failed for ${endpoint}:`, error);
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
    
    return apiRequest<StockVolatilityResponse>(`/stocks/volatility?${queryParams}`);
  },
};

// ============================================================================
// PORTFOLIO ANALYSIS API
// ============================================================================

export interface PortfolioAnalysisRequest {
  stocks: Array<{
    ticker: string;
    shares: number;
    purchasePrice: number;
  }>;
  riskTolerance?: 'low' | 'medium' | 'high';
}

export interface PortfolioAnalysisResponse {
  totalValue: number;
  totalReturn: number;
  totalReturnPercentage: number;
  portfolioRisk: number;
  sharpeRatio: number;
  maxDrawdown: number;
  diversificationScore: number;
  recommendations: string[];
  stockAnalysis: Array<{
    ticker: string;
    currentValue: number;
    return: number;
    returnPercentage: number;
    weight: number;
    risk: number;
  }>;
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
    price: number;
    change24h: number;
    changePercentage24h: number;
    marketCap: number;
    volume24h: number;
    volatility: number;
  }>;
  summary: {
    totalMarketCap: number;
    totalVolume24h: number;
    averageVolatility: number;
  };
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
  notificationEmail?: string;
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
  };
}

export const stockAlertsAPI = {
  createAlert: async (data: StockAlertRequest): Promise<StockAlertResponse> => {
    return apiRequest<StockAlertResponse>('/alerts', {
      method: 'POST',
      body: JSON.stringify(data),
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
export const api = {
  stockVolatility: stockVolatilityAPI,
  portfolioAnalysis: portfolioAnalysisAPI,
  cryptoStats: cryptoStatsAPI,
  optionPricing: optionPricingAPI,
  stockAlerts: stockAlertsAPI,
  chat: chatAPI,
  health: apiHealthAPI,
};

export default api;
