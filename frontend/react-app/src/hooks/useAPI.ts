import { useState, useCallback, useRef } from 'react';
import { api, APIError } from '../services/api';

// Generic API hook state
interface APIState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Generic API hook return type
interface APIHookReturn<T> extends APIState<T> {
  execute: (...args: any[]) => Promise<T | null>;
  executeForceRefresh: (...args: any[]) => Promise<T | null>;
  reset: () => void;
}

// Cache for API responses
const apiCache = new Map<string, { data: any; timestamp: number; ttl: number }>();

// Cache TTL in milliseconds (5 minutes default)
const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

// Function to clear all cache
export const clearAPICache = () => {
  apiCache.clear();
  console.log('🧹 API cache cleared');
};

// Generate cache key with better parameter handling
const generateCacheKey = (endpoint: string, params: any): string => {
  // Sort parameters to ensure consistent cache keys
  const sortedParams = params ? Object.keys(params)
    .sort()
    .reduce((result: any, key) => {
      result[key] = params[key];
      return result;
    }, {}) : {};
  
  return `${endpoint}:${JSON.stringify(sortedParams)}`;
};

// Check if cache entry is valid
const isCacheValid = (cacheEntry: { timestamp: number; ttl: number }): boolean => {
  return Date.now() - cacheEntry.timestamp < cacheEntry.ttl;
};

// Generic API hook
export function useAPI<T>(
  apiFunction: (...args: any[]) => Promise<T>,
  cacheTTL: number = DEFAULT_CACHE_TTL
): APIHookReturn<T> {
  const [state, setState] = useState<APIState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async (...args: any[]): Promise<T | null> => {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      // Generate cache key
      const cacheKey = generateCacheKey(apiFunction.name, args);

      // Check cache first
      const cached = apiCache.get(cacheKey);
      if (cached && isCacheValid(cached)) {
        setState({
          data: cached.data,
          loading: false,
          error: null,
        });
        return cached.data;
      }

      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const result = await apiFunction(...args);

        // Cache the result
        apiCache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
          ttl: cacheTTL,
        });

        setState({
          data: result,
          loading: false,
          error: null,
        });

        return result;
      } catch (error) {
        // Don't set error if request was aborted
        if (error instanceof Error && error.name === 'AbortError') {
          return null;
        }

        const errorMessage = error instanceof APIError 
          ? error.message 
          : error instanceof Error 
            ? error.message 
            : 'An unexpected error occurred';

        setState({
          data: null,
          loading: false,
          error: errorMessage,
        });

        return null;
      }
    },
    [apiFunction, cacheTTL]
  );

  const executeForceRefresh = useCallback(
    async (...args: any[]): Promise<T | null> => {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      // Generate cache key
      const cacheKey = generateCacheKey(apiFunction.name, args);

      // Force refresh - don't check cache
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const result = await apiFunction(...args);

        // Cache the result
        apiCache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
          ttl: cacheTTL,
        });

        setState({
          data: result,
          loading: false,
          error: null,
        });

        return result;
      } catch (error) {
        // Don't set error if request was aborted
        if (error instanceof Error && error.name === 'AbortError') {
          return null;
        }

        const errorMessage = error instanceof APIError 
          ? error.message 
          : error instanceof Error 
            ? error.message 
            : 'An unexpected error occurred';

        setState({
          data: null,
          loading: false,
          error: errorMessage,
        });

        return null;
      }
    },
    [apiFunction, cacheTTL]
  );

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    execute,
    executeForceRefresh,
    reset,
  };
}

// ============================================================================
// SPECIFIC API HOOKS
// ============================================================================

// Stock Volatility Hook
export function useStockVolatility() {
  // Temporarily disable caching for debugging
  return useAPI(api.stockVolatility.getVolatility, 0);
}

// Stock Data Hook (Comprehensive stock statistics and chart data)
export function useStockData() {
  // Short cache for real-time stock data
  return useAPI(api.stockData.getStockData, 30 * 1000); // 30 second cache
}

// Portfolio Analysis Hook
export function usePortfolioAnalysis() {
  return useAPI(api.portfolioAnalysis.analyzePortfolio, 0); // No cache for portfolio analysis
}

// Crypto Stats Hook - Short cache for real-time crypto data
export function useCryptoStats() {
  return useAPI(api.cryptoStats.getStats, 5 * 1000); // 5 second cache for real-time data
}

// Enhanced Crypto Data Hook for Dashboard - Supports multiple symbols
export function useCryptoData() {
  return useAPI(api.cryptoStats.getStats, 5 * 1000); // 5 second cache for real-time data
}

// Option Pricing Hook
export function useOptionPricing() {
  return useAPI(api.optionPricing.calculatePrice, 0); // No cache for option pricing
}

// Stock Alerts Hook
export function useStockAlerts() {
  return useAPI(api.stockAlerts.createAlert, 0); // No cache for alerts
}

// Stock Screener Hook
export function useStockScreener() {
  return useAPI(api.stockScreener.screenStocks, 5 * 60 * 1000); // 5 minute cache for screener results
}

// Chat Hook
export function useChat() {
  return useAPI(api.chat.sendMessage, 0); // No cache for chat
}

// API Health Hook
export function useAPIHealth() {
  return useAPI(api.health.checkHealth, 30 * 1000); // 30 second cache
}

// SEC Search Hooks
export function useSECSearch() {
  return useAPI(api.secSearch.search, 0); // No cache for search results
}

export function useSECAutocomplete() {
  return useAPI(api.secSearch.getAutocomplete, 5 * 60 * 1000); // 5 minute cache for autocomplete
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

// Hook for managing multiple API calls
export function useMultipleAPIs<T extends Record<string, any>>(
  apiFunctions: T
): { [K in keyof T]: APIHookReturn<Awaited<ReturnType<T[K]>>> } {
  const results: any = {};

  for (const [key, apiFunction] of Object.entries(apiFunctions)) {
    results[key] = useAPI(apiFunction);
  }

  return results;
}

// Hook for sequential API calls
export function useSequentialAPI<T>(
  apiFunctions: Array<(...args: any[]) => Promise<T>>
): {
  execute: (...args: any[]) => Promise<T[]>;
  results: T[];
  loading: boolean;
  error: string | null;
} {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: any[]): Promise<T[]> => {
      setLoading(true);
      setError(null);

      try {
        const apiResults: T[] = [];
        
        for (const apiFunction of apiFunctions) {
          const result = await apiFunction(...args);
          apiResults.push(result);
        }

        setResults(apiResults);
        setLoading(false);
        return apiResults;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        setError(errorMessage);
        setLoading(false);
        throw error;
      }
    },
    [apiFunctions]
  );

  return {
    execute,
    results,
    loading,
    error,
  };
}

// Hook for polling API
export function usePollingAPI<T>(
  apiFunction: (...args: any[]) => Promise<T>,
  interval: number = 30000, // 30 seconds default
  enabled: boolean = true
): APIHookReturn<T> & { startPolling: () => void; stopPolling: () => void } {
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const apiHook = useAPI(apiFunction);

  const startPolling = useCallback(() => {
    if (isPolling) return;
    
    setIsPolling(true);
    intervalRef.current = setInterval(() => {
      apiHook.execute();
    }, interval);
  }, [isPolling, interval, apiHook]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Start polling when enabled
  if (enabled && !isPolling) {
    startPolling();
  }

  // Stop polling when disabled
  if (!enabled && isPolling) {
    stopPolling();
  }

  return {
    ...apiHook,
    startPolling,
    stopPolling,
  };
}

// Export all hooks
export const hooks = {
  useStockVolatility,
  usePortfolioAnalysis,
  useCryptoStats,
  useOptionPricing,
  useStockAlerts,
  useStockScreener,
  useChat,
  useAPIHealth,
  useMultipleAPIs,
  useSequentialAPI,
  usePollingAPI,
};

export default hooks;
