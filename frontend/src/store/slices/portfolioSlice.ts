import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Robinhood-specific interfaces
export interface RobinhoodAccount {
  user_id: string;
  username: string;
  email: string;
  account_number: string;
  total_portfolio_value: number;
  day_change: number;
  day_change_percent: number;
}

export interface StockDetails {
  weight: number;
  annual_return: number;
  annual_volatility: number;
  shares: number;
  current_price: number;
  total_value: number;
}

export interface PortfolioAnalysis {
  total_portfolio_value: number;
  portfolio_expected_return: number;
  portfolio_volatility: number;
  sharpe_ratio: number;
  stock_details: Record<string, StockDetails>;
}

export interface CryptoData {
  symbol: string;
  price: number;
  change_24h: number;
  volume: number;
  market_cap: number;
}

export interface StockVolatilityData {
  ticker: string;
  volatility: number;
  timeFrame: string;
  timestamp: string;
}

interface PortfolioState {
  // Robinhood Integration
  robinhoodAccount: RobinhoodAccount | null;
  portfolioAnalysis: PortfolioAnalysis | null;
  isRobinhoodConnected: boolean;
  
  // Other Portfolio Data
  cryptoData: CryptoData[];
  stockVolatilityData: StockVolatilityData[];
  stockAlerts: any[];
  
  // Loading states
  loading: {
    robinhood: boolean;
    crypto: boolean;
    stocks: boolean;
    analysis: boolean;
  };
  
  // Error states
  errors: {
    robinhood: string | null;
    crypto: string | null;
    stocks: string | null;
    analysis: string | null;
  };
}

const initialState: PortfolioState = {
  robinhoodAccount: null,
  portfolioAnalysis: null,
  isRobinhoodConnected: false,
  cryptoData: [],
  stockVolatilityData: [],
  stockAlerts: [],
  loading: {
    robinhood: false,
    crypto: false,
    stocks: false,
    analysis: false,
  },
  errors: {
    robinhood: null,
    crypto: null,
    stocks: null,
    analysis: null,
  },
};

const portfolioSlice = createSlice({
  name: 'portfolio',
  initialState,
  reducers: {
    // Robinhood Actions
    setRobinhoodLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.robinhood = action.payload;
    },
    setRobinhoodAccount: (state, action: PayloadAction<RobinhoodAccount>) => {
      state.robinhoodAccount = action.payload;
      state.isRobinhoodConnected = true;
      state.errors.robinhood = null;
    },
    setPortfolioAnalysis: (state, action: PayloadAction<PortfolioAnalysis>) => {
      state.portfolioAnalysis = action.payload;
      state.errors.analysis = null;
    },
    setRobinhoodError: (state, action: PayloadAction<string>) => {
      state.errors.robinhood = action.payload;
      state.loading.robinhood = false;
    },
    disconnectRobinhood: (state) => {
      state.robinhoodAccount = null;
      state.portfolioAnalysis = null;
      state.isRobinhoodConnected = false;
      state.errors.robinhood = null;
    },
    
    // Crypto Actions
    setCryptoLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.crypto = action.payload;
    },
    setCryptoData: (state, action: PayloadAction<CryptoData[]>) => {
      state.cryptoData = action.payload;
      state.errors.crypto = null;
    },
    setCryptoError: (state, action: PayloadAction<string>) => {
      state.errors.crypto = action.payload;
      state.loading.crypto = false;
    },
    
    // Stock Actions
    setStockVolatilityLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.stocks = action.payload;
    },
    addStockVolatilityData: (state, action: PayloadAction<StockVolatilityData>) => {
      const existingIndex = state.stockVolatilityData.findIndex(
        (data) => data.ticker === action.payload.ticker && data.timeFrame === action.payload.timeFrame
      );
      
      if (existingIndex >= 0) {
        state.stockVolatilityData[existingIndex] = action.payload;
      } else {
        state.stockVolatilityData.push(action.payload);
      }
      state.errors.stocks = null;
    },
    setStockError: (state, action: PayloadAction<string>) => {
      state.errors.stocks = action.payload;
      state.loading.stocks = false;
    },
    
    // Stock Alerts
    addStockAlert: (state, action: PayloadAction<any>) => {
      state.stockAlerts.push(action.payload);
    },
    removeStockAlert: (state, action: PayloadAction<string>) => {
      state.stockAlerts = state.stockAlerts.filter(alert => alert.id !== action.payload);
    },
    
    // Clear All Data
    clearAllPortfolioData: (state) => {
      return initialState;
    },
  },
});

export const {
  setRobinhoodLoading,
  setRobinhoodAccount,
  setPortfolioAnalysis,
  setRobinhoodError,
  disconnectRobinhood,
  setCryptoLoading,
  setCryptoData,
  setCryptoError,
  setStockVolatilityLoading,
  addStockVolatilityData,
  setStockError,
  addStockAlert,
  removeStockAlert,
  clearAllPortfolioData,
} = portfolioSlice.actions;

export default portfolioSlice.reducer;
