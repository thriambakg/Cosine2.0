import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Paper,
  Chip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Autocomplete,
  Tooltip,
  CircularProgress,
  Popover,
  Container,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Calculate as CalculateIcon,
  Timeline as TimelineIcon,
  ShowChart as ShowChartIcon,
  CompareArrows as CompareArrowsIcon,
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Brush } from 'recharts';
import { usePortfolioAnalysis, useStockData } from '../hooks/useAPI';
import { securitySuggestionsServiceV2, Security } from '../services/securitySuggestionsV2';

// Force refresh - updated at 2025-01-10T00:00:00.000Z

interface PortfolioEntry {
  stock: string;
  shares: number;
}

interface PortfolioResults {
  total_portfolio_value: number;
  portfolio_expected_return: number;
  portfolio_volatility: number;
  portfolio_variance?: number;
  portfolio_standard_deviation?: number;
  sharpe_ratio: number;
  cagr?: number;
  alpha?: number;
  beta?: number;
  correlation?: {
    matrix?: { [key: string]: { [key: string]: number } };
    tickers?: string[];
  };
  covariance?: {
    matrix?: { [key: string]: { [key: string]: number } };
    tickers?: string[];
  };
  stock_details: {
    [key: string]: {
      weight: number;
      annual_return: number;
      annual_volatility: number;
      variance?: number;
      standard_deviation?: number;
      avg_covariance?: number;
      shares: number;
      current_price: number;
      total_value: number;
    }
  }
}

export default function PortfolioRisk() {
  // Initialize state from localStorage if available, otherwise use defaults
  const getInitialEntries = (): PortfolioEntry[] => {
    try {
      const savedEntries = localStorage.getItem('portfolio-entries');
      if (savedEntries) {
        const parsed = JSON.parse(savedEntries);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load initial entries from localStorage:', e);
    }
    return [{ stock: '', shares: 0 }];
  };

  const getInitialResults = (): PortfolioResults | null => {
    try {
      const savedResults = localStorage.getItem('portfolio-results');
      if (savedResults) {
        return JSON.parse(savedResults);
      }
    } catch (e) {
      console.warn('Failed to load initial results from localStorage:', e);
    }
    return null;
  };

  const getInitialTimeframe = (): string => {
    return localStorage.getItem('portfolio-timeframe') || '1y';
  };

  const getInitialChartType = (): 'single' | 'multiple' | 'compare' => {
    const saved = localStorage.getItem('portfolio-chart-type');
    if (saved && ['single', 'multiple', 'compare'].includes(saved)) {
      return saved as 'single' | 'multiple' | 'compare';
    }
    return 'single';
  };

  const getInitialCompareStock = (): string => {
    return localStorage.getItem('portfolio-compare-stock') || '';
  };

  const [entries, setEntries] = useState<PortfolioEntry[]>(getInitialEntries);
  const [results, setResults] = useState<PortfolioResults | null>(getInitialResults);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<string>(getInitialTimeframe);
  
  // Chart state
  const [chartType, setChartType] = useState<'single' | 'multiple' | 'compare'>(getInitialChartType);
  const [compareStock, setCompareStock] = useState<string>(getInitialCompareStock);
  const [compareInputValue, setCompareInputValue] = useState<string>(getInitialCompareStock);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [isSecurityDataLoaded, setIsSecurityDataLoaded] = useState(false);
  const [securitySuggestions, setSecuritySuggestions] = useState<Security[]>([]);
  
  // Track if this is the initial mount with restored state
  const initialMountRef = useRef(true);
  
  // Calculator bubble popover state
  const [calculatorAnchor, setCalculatorAnchor] = useState<HTMLButtonElement | null>(null);
  const calculatorOpen = Boolean(calculatorAnchor);
  
  // Use the portfolio analysis hook - updated to use real API with force refresh
  const { executeForceRefresh: analyzePortfolio, loading: isLoading, error: apiError } = usePortfolioAnalysis();
  const { executeForceRefresh: fetchStockData } = useStockData();

  // Load security data
  useEffect(() => {
    const loadSecurityData = async () => {
      try {
        await securitySuggestionsServiceV2.loadSecurities();
        setIsSecurityDataLoaded(true);
        const allSecurities = securitySuggestionsServiceV2.getAllSecurities();
        const seen = new Set<string>();
        const uniqueSecurities = allSecurities.filter(security => {
          if (seen.has(security.symbol)) return false;
          seen.add(security.symbol);
          return true;
        });
        setSecuritySuggestions(uniqueSecurities.slice(0, 50));
      } catch (error) {
        console.error('Failed to load security suggestions:', error);
      }
    };
    loadSecurityData();
  }, []);

  // Load exported portfolio data on component mount (if present)
  // This takes priority over localStorage initialization
  useEffect(() => {
    // Check for exported portfolio data (from tile export)
    const exportedData = sessionStorage.getItem('portfolio-export-data');
    if (exportedData) {
      try {
        const parsed = JSON.parse(exportedData);
        if (parsed.entries && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
          setEntries(parsed.entries);
        }
        if (parsed.timeframe) {
          setTimeframe(parsed.timeframe);
        }
        // Keep exported data flag to trigger auto-calculation via useEffect
        // Don't load from localStorage if we loaded from export
        return;
      } catch (e) {
        console.warn('Failed to parse exported portfolio data:', e);
        sessionStorage.removeItem('portfolio-export-data');
      }
    }
    
    // If state was initialized from localStorage, the initialMountRef useEffect will handle chart loading
    // No need to do anything here since state is already initialized from localStorage
  }, []);

  // Transform cached stock data into chart format based on chart type
  // This function must be defined before calculateRisk uses it
  const transformCachedDataToChart = useCallback((
    cachedData: { [key: string]: any },
    compareData: any | null,
    type: 'single' | 'multiple' | 'compare',
    validEntries: PortfolioEntry[]
  ) => {
    const stockSymbols = validEntries.map(e => {
      const symbolMatch = e.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
      const symbol = symbolMatch ? symbolMatch[1].trim() : e.stock.trim();
      return symbol.toUpperCase();
    });

    // Map stock symbols to their corresponding entries to ensure correct order and shares
    const symbolToEntryMap = new Map<string, PortfolioEntry>();
    validEntries.forEach(entry => {
      const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
      const symbol = symbolMatch ? symbolMatch[1].trim().toUpperCase() : entry.stock.trim().toUpperCase();
      symbolToEntryMap.set(symbol, entry);
    });
    
    // Get stock data in the same order as stockSymbols, ensuring we match entries correctly
    const allStockData = stockSymbols.map(symbol => {
      const data = cachedData[symbol] || null;
      return { symbol, data };
    }).filter(item => item.data !== null);
    
    if (type === 'single') {
      const portfolioChartData: any[] = [];
      const timePoints = new Set<number>();

      allStockData.forEach(({ data }) => {
        if (data && data.chart_data) {
          data.chart_data.forEach((point: any) => {
            timePoints.add(point.time);
          });
        }
      });

      const sortedTimes = Array.from(timePoints).sort();
      const expectedStockCount = allStockData.length;
      
      sortedTimes.forEach((time, timeIdx) => {
        let portfolioValue = 0;
        let stocksWithData = 0;
        
        allStockData.forEach(({ symbol, data }) => {
          const entry = symbolToEntryMap.get(symbol);
          if (entry && data && data.chart_data) {
            const point = data.chart_data.find((p: any) => p.time === time);
            if (point) {
              const shares = entry.shares;
              const stockValue = point.close * shares;
              portfolioValue += stockValue;
              stocksWithData++;
              // Debug log for first and last time points
              if (timeIdx === 0 || timeIdx === sortedTimes.length - 1) {
                console.log(`📊 Portfolio calculation [${timeIdx === 0 ? 'first' : 'last'}]: ${symbol} - Price: $${point.close.toFixed(2)}, Shares: ${shares}, Value: $${stockValue.toFixed(2)}`);
              }
            }
          }
        });
        
        // Only add data point if we have data for ALL stocks (to ensure accurate portfolio value)
        if (portfolioValue > 0 && stocksWithData === expectedStockCount) {
          portfolioChartData.push({
            time,
            value: portfolioValue,
            date: new Date(time * 1000).toLocaleDateString(),
          });
          // Debug log for first and last data points
          if (portfolioChartData.length === 1) {
            console.log(`📊 First portfolio value: $${portfolioValue.toFixed(2)} (${stocksWithData}/${expectedStockCount} stocks)`);
          }
          if (timeIdx === sortedTimes.length - 1) {
            console.log(`📊 Last portfolio value: $${portfolioValue.toFixed(2)} (${stocksWithData}/${expectedStockCount} stocks)`);
          }
        } else if (timeIdx === sortedTimes.length - 1) {
          // Log warning if last point is missing data
          console.warn(`⚠️ Last time point missing data: portfolioValue=${portfolioValue}, stocksWithData=${stocksWithData}/${expectedStockCount}`);
        }
      });
      
      return portfolioChartData;
    } else if (type === 'multiple') {
      const timePoints = new Set<number>();
      allStockData.forEach(({ data }) => {
        if (data && data.chart_data) {
          data.chart_data.forEach((point: any) => {
            timePoints.add(point.time);
          });
        }
      });
      
      const chartDataMap: { [key: number]: any } = {};
      Array.from(timePoints).sort().forEach(time => {
        chartDataMap[time] = { time, date: new Date(time * 1000).toLocaleDateString() };
      });
      
      allStockData.forEach(({ symbol, data }) => {
        if (data && data.chart_data) {
          data.chart_data.forEach((point: any) => {
            if (chartDataMap[point.time]) {
              chartDataMap[point.time][symbol] = point.close;
            }
          });
        }
      });
      
      return Object.values(chartDataMap).filter(d => Object.keys(d).length > 2);
    } else if (type === 'compare' && compareData) {
      const portfolioChartData: any[] = [];
      const timePoints = new Set<number>();
      
      allStockData.forEach(({ data }) => {
        if (data && data.chart_data) {
          data.chart_data.forEach((point: any) => {
            timePoints.add(point.time);
          });
        }
      });
      
      if (compareData && compareData.chart_data) {
        compareData.chart_data.forEach((point: any) => {
          timePoints.add(point.time);
        });
      }
      
      const sortedTimes = Array.from(timePoints).sort();
      const expectedStockCount = allStockData.length;
      
      // First pass: calculate initial portfolio value and first compare price for normalization
      let initialPortfolioValue: number | null = null;
      let firstComparePrice: number | null = null;
      
      for (const time of sortedTimes) {
        let portfolioValue = 0;
        let stocksWithData = 0;
        
        allStockData.forEach(({ symbol, data }) => {
          const entry = symbolToEntryMap.get(symbol);
          if (entry && data && data.chart_data) {
            const point = data.chart_data.find((p: any) => p.time === time);
            if (point) {
              const shares = entry.shares;
              const stockValue = point.close * shares;
              portfolioValue += stockValue;
              stocksWithData++;
            }
          }
        });
        
        const comparePoint = compareData?.chart_data?.find((p: any) => p.time === time);
        
        // Get initial values from first valid data point
        if (stocksWithData === expectedStockCount && comparePoint && initialPortfolioValue === null) {
          initialPortfolioValue = portfolioValue;
          firstComparePrice = comparePoint.close;
          break;
        }
      }
      
      // Calculate normalization factor
      const normalizationFactor = (initialPortfolioValue !== null && firstComparePrice !== null && firstComparePrice > 0)
        ? initialPortfolioValue / firstComparePrice
        : 1;
      
      // Second pass: build chart data with normalized compare values
      sortedTimes.forEach((time) => {
        let portfolioValue = 0;
        let stocksWithData = 0;
        
        allStockData.forEach(({ symbol, data }) => {
          const entry = symbolToEntryMap.get(symbol);
          if (entry && data && data.chart_data) {
            const point = data.chart_data.find((p: any) => p.time === time);
            if (point) {
              const shares = entry.shares;
              const stockValue = point.close * shares;
              portfolioValue += stockValue;
              stocksWithData++;
            }
          }
        });
        
        const comparePoint = compareData?.chart_data?.find((p: any) => p.time === time);
        
        // Only add data point if we have portfolio data for ALL stocks AND compare data
        if (stocksWithData === expectedStockCount && comparePoint) {
          // Normalize compare stock to match initial portfolio value
          const normalizedCompareValue = comparePoint.close * normalizationFactor;
          
          portfolioChartData.push({
            time,
            portfolio: portfolioValue,
            compare: normalizedCompareValue,
            date: new Date(time * 1000).toLocaleDateString(),
          });
        }
      });
      
      // Log if no data points were created
      if (portfolioChartData.length === 0) {
        console.warn('⚠️ No compare chart data points created. Portfolio stocks:', expectedStockCount, 'Compare data points:', compareData?.chart_data?.length || 0);
      }
      
      return portfolioChartData;
    }
    
    return [];
  }, []);

  const calculateRisk = async () => {
    setError(null);
    
    try {
      // Prepare portfolio data for API call
      const portfolioData = entries
        .filter(entry => entry.stock && entry.shares > 0)
        .map(entry => {
          // Extract just the ticker symbol (handle cases where it might be "AAPL - APPLE INC. (HIGH CAP)" or just "AAPL")
          const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
          const symbol = symbolMatch ? symbolMatch[1].trim() : entry.stock.trim();
          return [symbol.toUpperCase(), entry.shares, 0] as [string, number, number]; // Price will be fetched by API
        });
      
      if (portfolioData.length === 0) {
        setError('Please add at least one stock with shares > 0');
        return;
      }
      
      // Clear old chart cache for this portfolio before new calculation
      const validEntries = entries.filter(e => e.stock && e.shares > 0);
      const stockSymbols = validEntries.map(e => {
        const symbolMatch = e.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
        const symbol = symbolMatch ? symbolMatch[1].trim() : e.stock.trim();
        return symbol.toUpperCase();
      });
      const oldCacheKey = `portfolio-chart-cache-${stockSymbols.sort().join('-')}-${timeframe}`;
      sessionStorage.removeItem(oldCacheKey);
      console.log('🗑️ Cleared old chart cache:', oldCacheKey);
      
      // Also clear any compare stock caches
      const compareCacheKeys = Object.keys(sessionStorage).filter(key => 
        key.startsWith('portfolio-chart-cache-compare-')
      );
      compareCacheKeys.forEach(key => sessionStorage.removeItem(key));
      if (compareCacheKeys.length > 0) {
        console.log('🗑️ Cleared compare stock caches:', compareCacheKeys.length);
      }
      
      // Call the portfolio analysis API with source='page' to get chart data
      const response = await analyzePortfolio({
        portfolio_data: portfolioData,
        period: timeframe,
        analysis_type: 'standalone',
        source: 'page'
      });
      
      console.log('Portfolio analysis response:', response);
      
      if (response && response.success) {
        setResults(response.portfolio_metrics);
        
        // Reset chart type to 'single' (total portfolio) for fresh calculations
        setChartType('single');
        setCompareStock('');
        setCompareInputValue('');
        
        // If chart_data is included in response, use it instead of fetching separately
        if ((response as any).chart_data) {
          // Process chart data from backend response
          const validEntries = entries.filter(e => e.stock && e.shares > 0);
          const stockSymbols = validEntries.map(e => {
            const symbolMatch = e.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
            const symbol = symbolMatch ? symbolMatch[1].trim() : e.stock.trim();
            return symbol.toUpperCase();
          });
          
          // Convert backend chart_data format to frontend format
          const processedChartData: { [key: string]: any[] } = {};
          stockSymbols.forEach(symbol => {
            if ((response as any).chart_data[symbol]) {
              processedChartData[symbol] = (response as any).chart_data[symbol].map((point: any) => ({
                time: point.time,
                close: point.close,
                open: point.open,
                high: point.high,
                low: point.low,
                volume: point.volume
              }));
            }
          });
          
          // Store processed chart data and cache it
          if (Object.keys(processedChartData).length > 0) {
            // Process chart data directly with backend data
            const allStockData = stockSymbols.map(symbol => {
              const chartPoints = processedChartData[symbol] || [];
              return {
                symbol,
                chart_data: chartPoints
              };
            });

            // Cache the stock data in session storage
            const cacheKey = `portfolio-chart-cache-${stockSymbols.sort().join('-')}-${timeframe}`;
            const dataToCache: { [key: string]: any } = {};
            stockSymbols.forEach((symbol, idx) => {
              if (allStockData[idx]) {
                dataToCache[symbol] = allStockData[idx];
              }
            });
            sessionStorage.setItem(cacheKey, JSON.stringify(dataToCache));

            // Transform to current chart type using cached data
            const transformedData = transformCachedDataToChart(
              dataToCache,
              null,
              chartType,
              validEntries
            );
            setChartData(transformedData);
            // For compare mode, we still need to fetch the compare stock separately, so fall through to loadChartData
          }
        }
      } else {
        setError('Failed to analyze portfolio. Please check your stock tickers.');
      }
    } catch (err) {
      console.error('Portfolio analysis error:', err);
      setError(apiError || 'An error occurred while analyzing your portfolio. Please try again.');
    }
  };

  // Auto-calculate when exported data is loaded (after state is set)
  useEffect(() => {
    const exportedData = sessionStorage.getItem('portfolio-export-data');
    const hasValidEntries = entries.some(e => e.stock && e.shares > 0);
    
    // If we have exported data and valid entries but no results, trigger calculation
    if (exportedData && hasValidEntries && !results && !isLoading) {
      // Clear exported data flag
      sessionStorage.removeItem('portfolio-export-data');
      // Trigger calculation after a short delay to ensure state is set
      const timeoutId = setTimeout(() => {
        calculateRisk();
      }, 300);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, timeframe, results, isLoading]);

  // Save session data to localStorage whenever entries, results, or timeframe change
  useEffect(() => {
    localStorage.setItem('portfolio-entries', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    if (results) {
      localStorage.setItem('portfolio-results', JSON.stringify(results));
    }
  }, [results]);

  useEffect(() => {
    localStorage.setItem('portfolio-timeframe', timeframe);
  }, [timeframe]);

  useEffect(() => {
    localStorage.setItem('portfolio-chart-type', chartType);
  }, [chartType]);

  useEffect(() => {
    if (compareStock) {
      localStorage.setItem('portfolio-compare-stock', compareStock);
    } else {
      localStorage.removeItem('portfolio-compare-stock');
    }
  }, [compareStock]);

  const addEntry = () => {
    setEntries([...entries, { stock: '', shares: 0 }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof PortfolioEntry, value: string | number) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntries(newEntries);
  };

  // Load chart data
  const loadChartData = useCallback(async () => {
    if (!results || !entries.some(e => e.stock && e.shares > 0)) {
      console.log('⚠️ loadChartData: Missing requirements', { 
        hasResults: !!results, 
        hasValidEntries: entries.some(e => e.stock && e.shares > 0) 
      });
      setChartData([]);
      return;
    }

    console.log('📊 Loading chart data...', { 
      hasResults: !!results, 
      entriesCount: entries.filter(e => e.stock && e.shares > 0).length,
      chartType,
      timeframe 
    });

    setIsLoadingChart(true);
    try {
      const validEntries = entries.filter(e => e.stock && e.shares > 0);
      // Extract just the ticker symbol from each entry
      const stockSymbols = validEntries.map(e => {
        const symbolMatch = e.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
        const symbol = symbolMatch ? symbolMatch[1].trim() : e.stock.trim();
        return symbol.toUpperCase();
      });

      // Check if we have cached data for portfolio stocks
      const cacheKey = `portfolio-chart-cache-${stockSymbols.sort().join('-')}-${timeframe}`;
      const cachedDataStr = sessionStorage.getItem(cacheKey);
      let allStockData: any[] = [];
      let shouldCache = false;

      console.log('🔍 Checking for cached chart data:', { cacheKey, hasCache: !!cachedDataStr, stockSymbols });

      if (cachedDataStr) {
        // Use cached data
        try {
          const cachedData = JSON.parse(cachedDataStr);
          const portfolioStocksData = stockSymbols.map(symbol => cachedData[symbol] || null).filter(Boolean);
          
          // Check if we have all required stocks in cache
          if (portfolioStocksData.length === stockSymbols.length) {
            // Check if we need compare stock data
            if (chartType === 'compare' && compareStock) {
              const compareSymbol = compareStock.trim().toUpperCase();
              const compareCacheKey = `portfolio-chart-cache-compare-${compareSymbol}-${timeframe}`;
              const cachedCompareStr = sessionStorage.getItem(compareCacheKey);
              
              let compareData: any = null;
              
              if (cachedCompareStr) {
                // Use cached compare data
                try {
                  compareData = JSON.parse(cachedCompareStr);
                  console.log('✅ Using cached compare stock data:', compareSymbol);
                } catch (e) {
                  console.warn('Failed to parse cached compare data:', e);
                }
              }
              
              // If no cached data or invalid cached data, fetch compare stock only
              if (!compareData || !compareData.chart_data || compareData.chart_data.length === 0) {
                console.log('📥 Fetching compare stock data:', compareSymbol);
                try {
                  compareData = await fetchStockData({ ticker: compareSymbol, period: timeframe });
                  if (compareData && compareData.chart_data && compareData.chart_data.length > 0) {
                    sessionStorage.setItem(compareCacheKey, JSON.stringify(compareData));
                    console.log('✅ Cached compare stock data:', compareSymbol, `(${compareData.chart_data.length} points)`);
                  } else {
                    console.error('Compare stock data missing chart_data or is empty');
                    setError(`No chart data available for comparison stock: ${compareSymbol}`);
                    setIsLoadingChart(false);
                    return;
                  }
                } catch (error) {
                  console.error('Failed to fetch compare stock data:', error);
                  setError(`Failed to fetch data for comparison stock: ${compareSymbol}`);
                  setIsLoadingChart(false);
                  return;
                }
              }
              
              // Transform with portfolio cache and compare data
              if (compareData && compareData.chart_data && compareData.chart_data.length > 0) {
                const transformedData = transformCachedDataToChart(
                  cachedData,
                  compareData,
                  chartType,
                  validEntries
                );
                console.log('✅ Compare chart data transformed:', {
                  dataPoints: transformedData.length,
                  firstPortfolio: transformedData[0]?.portfolio,
                  firstCompare: transformedData[0]?.compare,
                  lastPortfolio: transformedData[transformedData.length - 1]?.portfolio,
                  lastCompare: transformedData[transformedData.length - 1]?.compare
                });
                if (transformedData.length > 0) {
                  setChartData(transformedData);
                  setIsLoadingChart(false);
                  return;
                } else {
                  console.warn('Transformed compare chart data is empty');
                  setError('No overlapping time points between portfolio and comparison stock');
                  setIsLoadingChart(false);
                  return;
                }
              } else {
                console.error('Compare stock data is missing chart_data or is empty');
                setError(`No chart data available for comparison stock: ${compareSymbol}`);
                setIsLoadingChart(false);
                return;
              }
            } else {
              // Transform cached data to requested chart type
              const transformedData = transformCachedDataToChart(
                cachedData,
                null,
                chartType,
                validEntries
              );
              const lastDataPoint = transformedData[transformedData.length - 1];
              console.log('✅ Using cached chart data, transformed:', {
                dataPoints: transformedData.length,
                firstValue: transformedData[0]?.value,
                lastValue: lastDataPoint?.value,
                lastDataPointFull: lastDataPoint,
                sampleData: transformedData.slice(0, 3),
                lastThreeDataPoints: transformedData.slice(-3),
                validEntries: validEntries.map(e => ({ stock: e.stock, shares: e.shares }))
              });
              setChartData(transformedData);
              setIsLoadingChart(false);
              return;
            }
          }
        } catch (e) {
          console.warn('Failed to parse cached chart data:', e);
          // Fall through to fetch fresh data
        }
      }

      // Need to fetch data (either no cache or incomplete cache)
      shouldCache = true;
      
      // Add compare stock if in compare mode
      const stocksToFetch = [...stockSymbols];
      if (chartType === 'compare' && compareStock) {
        stocksToFetch.push(compareStock.trim().toUpperCase());
      }

      // Fetch data for all stocks
      const stockDataPromises = stocksToFetch.map(symbol =>
        fetchStockData({ ticker: symbol, period: timeframe })
      );

      allStockData = await Promise.all(stockDataPromises);

      // Cache the portfolio stocks data
      if (shouldCache && allStockData.length > 0) {
        const dataToCache: { [key: string]: any } = {};
        stockSymbols.forEach((symbol, idx) => {
          if (allStockData[idx]) {
            dataToCache[symbol] = allStockData[idx];
          }
        });
        sessionStorage.setItem(cacheKey, JSON.stringify(dataToCache));
        
        // Cache compare stock if in compare mode
        if (chartType === 'compare' && compareStock && allStockData.length > stockSymbols.length) {
          const compareSymbol = compareStock.trim().toUpperCase();
          const compareData = allStockData[allStockData.length - 1];
          const compareCacheKey = `portfolio-chart-cache-compare-${compareSymbol}-${timeframe}`;
          sessionStorage.setItem(compareCacheKey, JSON.stringify(compareData));
        }
      }

      // Transform the fetched data to the requested chart type
      const portfolioStocksData = allStockData.slice(0, stockSymbols.length);
      const compareStockData = chartType === 'compare' && compareStock 
        ? allStockData[allStockData.length - 1] 
        : null;
      
      // Build cache object for transformation
      const cacheObj: { [key: string]: any } = {};
      stockSymbols.forEach((symbol, idx) => {
        if (portfolioStocksData[idx]) {
          cacheObj[symbol] = portfolioStocksData[idx];
        }
      });
      
      const transformedData = transformCachedDataToChart(
        cacheObj,
        compareStockData,
        chartType,
        validEntries
      );
      
      console.log('📊 Transformed chart data from fetch:', {
        dataPoints: transformedData.length,
        firstValue: transformedData[0]?.value || transformedData[0]?.portfolio,
        lastValue: transformedData[transformedData.length - 1]?.value || transformedData[transformedData.length - 1]?.portfolio,
        lastDataPoint: transformedData[transformedData.length - 1],
        sampleData: transformedData.slice(0, 3),
        lastThreeDataPoints: transformedData.slice(-3),
        chartType,
        validEntries: validEntries.map(e => ({ stock: e.stock, shares: e.shares }))
      });
      
      setChartData(transformedData);
    } catch (error) {
      console.error('Error loading chart data:', error);
      setChartData([]);
    } finally {
      setIsLoadingChart(false);
    }
  }, [results, timeframe, chartType, compareStock, fetchStockData, transformCachedDataToChart, entries]);

  // Handle initial chart load when state is restored from localStorage on mount
  useEffect(() => {
    if (initialMountRef.current && results && entries.some(e => e.stock && e.shares > 0) && chartData.length === 0) {
      console.log('🔄 Initial mount with restored state, loading chart data', {
        hasResults: !!results,
        entriesCount: entries.filter(e => e.stock && e.shares > 0).length,
        chartType,
        timeframe
      });
      initialMountRef.current = false;
      // Use a delay to ensure all state is ready
      const timeoutId = setTimeout(() => {
        if (results && entries.some(e => e.stock && e.shares > 0)) {
          console.log('⏰ Initial mount timeout: Calling loadChartData');
          loadChartData();
        }
      }, 400);
      return () => clearTimeout(timeoutId);
    } else if (initialMountRef.current) {
      initialMountRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip on initial mount (handled by the effect above)
    if (initialMountRef.current) {
      return;
    }
    
    // Only load chart data when results are set (from calculateRisk or restored from localStorage)
    // DO NOT include entries in dependencies - we only want to reload when results change (after Calculate is clicked)
    if (results && entries.some(e => e.stock && e.shares > 0)) {
      console.log('🔄 useEffect: Triggering chart data load', { 
        hasResults: !!results, 
        entries: entries.filter(e => e.stock && e.shares > 0).length,
        chartType,
        timeframe 
      });
      // Use a delay to ensure all state is set when restoring from localStorage
      // Increase delay to ensure entries are fully restored
      const timeoutId = setTimeout(() => {
        // Double-check that we have valid entries before loading chart
        if (results && entries.some(e => e.stock && e.shares > 0)) {
          console.log('⏰ Timeout: Calling loadChartData');
          loadChartData();
        } else {
          console.log('⚠️ Timeout: Conditions not met for chart load', {
            hasResults: !!results,
            hasValidEntries: entries.some(e => e.stock && e.shares > 0)
          });
        }
      }, 300);
      return () => clearTimeout(timeoutId);
    } else if (results && !entries.some(e => e.stock && e.shares > 0)) {
      // If we have results but no valid entries, clear chart data
      console.log('⚠️ useEffect: Has results but no valid entries, clearing chart');
      setChartData([]);
    } else {
      console.log('⚠️ useEffect: Not loading chart', { 
        hasResults: !!results, 
        hasEntries: entries.some(e => e.stock && e.shares > 0) 
      });
    }
    // Only reload when results, chartType, compareStock, or timeframe change
    // NOT when entries change - we only want to reload after Calculate is clicked (which sets results)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, chartType, compareStock, timeframe]);

  const getYAxisDomain = useCallback(() => {
    if (!chartData || chartData.length === 0) {
      return ['auto', 'auto'];
    }
    
    let values: number[] = [];
    if (chartType === 'single') {
      values = chartData.map(d => d.value).filter(v => v && !isNaN(v));
    } else if (chartType === 'multiple') {
      entries.filter(e => e.stock && e.shares > 0).forEach(entry => {
        // Extract symbol the same way as in loadChartData
        const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
        const symbol = symbolMatch ? symbolMatch[1].trim().toUpperCase() : entry.stock.trim().toUpperCase();
        chartData.forEach(d => {
          if (d[symbol] && !isNaN(d[symbol])) {
            values.push(d[symbol]);
          }
        });
      });
    } else if (chartType === 'compare') {
      chartData.forEach(d => {
        if (d.portfolio && !isNaN(d.portfolio)) values.push(d.portfolio);
        if (d.compare && !isNaN(d.compare)) values.push(d.compare);
      });
    }
    
    if (values.length === 0) {
      return ['auto', 'auto'];
    }
    
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    // Use 10% padding for multiple stock mode, 20% for single and compare modes
    const padding = chartType === 'multiple' ? (maxVal - minVal) * 0.10 : (maxVal - minVal) * 0.20;
    const domainMin = Math.max(0, minVal - padding); // Ensure min doesn't go below 0
    const domainMax = maxVal + padding;
    return [domainMin, domainMax];
  }, [chartData, chartType, entries]);

  const getRiskLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Low', color: '#22c55e' };
    if (volatility < 20) return { level: 'Medium', color: '#f59e0b' };
    return { level: 'High', color: '#ef4444' };
  };

  const tileColor = '#3b82f6';

  const clearSession = () => {
    // Clear localStorage
    localStorage.removeItem('portfolio-entries');
    localStorage.removeItem('portfolio-results');
    localStorage.removeItem('portfolio-timeframe');
    localStorage.removeItem('portfolio-chart-type');
    localStorage.removeItem('portfolio-compare-stock');
    
    // Clear session storage cache
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('portfolio-chart-cache-')) {
        sessionStorage.removeItem(key);
      }
    });
    
    // Reset state
    setEntries([{ stock: '', shares: 0 }]);
    setResults(null);
    setError(null);
    setTimeframe('1y');
    setChartType('single');
    setCompareStock('');
    setCompareInputValue('');
    setChartData([]);
  };

  const handleCalculatorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setCalculatorAnchor(event.currentTarget);
  };

  const handleCalculatorClose = () => {
    setCalculatorAnchor(null);
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        {/* Calculator Bubble Button - Top Right */}
        <Box sx={{ position: 'relative', mb: 2 }}>
          <IconButton
            onClick={handleCalculatorClick}
            disabled={isLoading}
            sx={{
              position: 'absolute',
              top: -8,
              right: 0,
              zIndex: 10,
              width: 48,
              height: 48,
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              border: '2px solid #3b82f6',
              borderRadius: '50%',
              color: '#3b82f6',
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.3)',
                borderColor: '#2563eb',
              },
              '&.Mui-disabled': {
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderColor: 'rgba(59, 130, 246, 0.3)',
              },
            }}
          >
            {isLoading ? (
              <CircularProgress size={24} sx={{ color: '#3b82f6' }} />
            ) : (
              <CalculateIcon />
            )}
          </IconButton>

          {/* Calculator Popover */}
          <Popover
            open={calculatorOpen}
            anchorEl={calculatorAnchor}
            onClose={handleCalculatorClose}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            PaperProps={{
              sx: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(20px)',
                border: '1px solid #374151',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                mt: 1,
                minWidth: 400,
                maxWidth: 600,
                maxHeight: '80vh',
                overflow: 'auto',
              },
            }}
          >
            <Box sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography 
                  variant="h6" 
                  sx={{ 
                    color: '#ffffff', 
                    fontWeight: 600, 
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Portfolio Holdings
                </Typography>
                
                <FormControl 
                  size="small"
                  sx={{ 
                    minWidth: 120,
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        borderColor: '#374151',
                      },
                      '&:hover fieldset': {
                        borderColor: '#3b82f6',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#3b82f6',
                      },
                    },
                    '& .MuiInputLabel-root': {
                      color: '#9ca3af',
                    },
                    '& .MuiSelect-select': {
                      color: '#ffffff',
                    },
                    '& .MuiSvgIcon-root': {
                      color: '#9ca3af',
                    },
                  }}
                >
                  <InputLabel id="timeframe-label">Timeframe</InputLabel>
                  <Select
                    labelId="timeframe-label"
                    value={timeframe}
                    label="Timeframe"
                    onChange={(e) => setTimeframe(e.target.value)}
                  >
                    <MenuItem value="1d">1 Day</MenuItem>
                    <MenuItem value="5d">5 Days</MenuItem>
                    <MenuItem value="1mo">1 Month</MenuItem>
                    <MenuItem value="3mo">3 Months</MenuItem>
                    <MenuItem value="6mo">6 Months</MenuItem>
                    <MenuItem value="1y">1 Year</MenuItem>
                    <MenuItem value="2y">2 Years</MenuItem>
                    <MenuItem value="5y">5 Years</MenuItem>
                    <MenuItem value="10y">10 Years</MenuItem>
                    <MenuItem value="ytd">Year to Date</MenuItem>
                    <MenuItem value="max">Max</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              {entries.map((entry, index) => (
                <Box 
                  key={index} 
                  sx={{ 
                    display: 'flex', 
                    gap: 2, 
                    mb: 2, 
                    alignItems: 'center',
                    p: 2,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <Autocomplete
                    value={isSecurityDataLoaded && entry.stock
                      ? securitySuggestionsServiceV2.findBySymbol(entry.stock.toUpperCase()) ?? entry.stock
                      : entry.stock || null}
                    onChange={(_, newValue) => {
                      if (newValue) {
                        if (typeof newValue === 'string') {
                          const symbolMatch = newValue.match(/^([A-Z.]+)(?:\s*-|$)/);
                          const symbol = symbolMatch ? symbolMatch[1].trim() : newValue.trim();
                          updateEntry(index, 'stock', symbol.toUpperCase());
                        } else {
                          updateEntry(index, 'stock', newValue.symbol.toUpperCase());
                        }
                      }
                    }}
                    onInputChange={(_, newInputValue) => {
                      if (isSecurityDataLoaded && newInputValue) {
                        const suggestions = securitySuggestionsServiceV2.getSuggestions(newInputValue, 50);
                        const seen = new Set<string>();
                        const uniqueSuggestions = suggestions.filter(security => {
                          if (seen.has(security.symbol)) return false;
                          seen.add(security.symbol);
                          return true;
                        });
                        setSecuritySuggestions(uniqueSuggestions);
                      }
                    }}
                    onBlur={(e) => {
                      const inputValue = (e.target as HTMLInputElement).value;
                      if (inputValue) {
                        const normalizedSymbol = inputValue.trim().toUpperCase();
                        if (normalizedSymbol && normalizedSymbol.length > 0) {
                          updateEntry(index, 'stock', normalizedSymbol);
                        }
                      }
                    }}
                    options={securitySuggestions}
                    getOptionLabel={(option) => {
                      if (typeof option === 'string') return option;
                      return option.displayText || option.symbol || '';
                    }}
                    isOptionEqualToValue={(option: Security | string, value: Security | string | null) => {
                      if (!value) return false;
                      if (typeof option === 'string' && typeof value === 'string') {
                        return option.toUpperCase() === value.toUpperCase();
                      }
                      if (typeof option === 'string' && typeof value === 'object' && 'symbol' in value) {
                        return option.toUpperCase() === (value.symbol?.toUpperCase() || '');
                      }
                      if (typeof value === 'string' && typeof option === 'object' && 'symbol' in option) {
                        return value.toUpperCase() === (option.symbol?.toUpperCase() || '');
                      }
                      if (typeof option === 'object' && typeof value === 'object' && 'symbol' in option && 'symbol' in value) {
                        return option.symbol === value.symbol;
                      }
                      return false;
                    }}
                    loading={!isSecurityDataLoaded}
                    renderOption={(props, option) => {
                      if (typeof option === 'string') {
                        return (
                          <Box component="li" {...props} key={option} sx={{ py: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                              {option}
                            </Typography>
                          </Box>
                        );
                      }
                      const security = option as Security;
                      const capColor = security.marketCap === 'high' ? '#10b981' : security.marketCap === 'mid' ? '#f59e0b' : '#ef4444';
                      const capLabel = security.marketCap === 'high' ? 'High Cap' : security.marketCap === 'mid' ? 'Mid Cap' : 'Low Cap';
                      const uniqueKey = `${security.symbol}-${security.marketCap}-${security.name}`;
                      return (
                        <Box component="li" {...props} key={uniqueKey} sx={{ py: 1 }}>
                          <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                                {security.symbol}
                              </Typography>
                              <Chip 
                                label={capLabel} 
                                size="small" 
                                sx={{ 
                                  height: '18px', 
                                  fontSize: '0.65rem',
                                  backgroundColor: capColor,
                                  color: 'white'
                                }} 
                              />
                            </Box>
                            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                              {security.name}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    }}
                    freeSolo
                    autoSelect={false}
                    selectOnFocus={false}
                    clearOnBlur={false}
                    autoHighlight={false}
                    disableListWrap={true}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Stock Ticker"
                        size="small"
                        sx={{ 
                          flexGrow: 1,
                          '& .MuiOutlinedInput-root': {
                            '& fieldset': {
                              borderColor: '#374151',
                            },
                            '&:hover fieldset': {
                              borderColor: '#3b82f6',
                            },
                            '&.Mui-focused fieldset': {
                              borderColor: '#3b82f6',
                            },
                          },
                          '& .MuiInputLabel-root': {
                            color: '#9ca3af',
                          },
                          '& .MuiInputBase-input': {
                            color: '#ffffff',
                          },
                        }}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {!isSecurityDataLoaded ? <CircularProgress color="inherit" size={20} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    sx={{
                      flexGrow: 2,
                      minWidth: 200,
                      '& .MuiAutocomplete-popper': {
                        '& .MuiPaper-root': {
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid #374151',
                        },
                      },
                    }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Shares"
                    value={entry.shares}
                    onChange={(e) => updateEntry(index, 'shares', parseFloat(e.target.value) || 0)}
                    inputProps={{
                      inputMode: 'numeric',
                      pattern: '[0-9]*',
                    }}
                    sx={{ 
                      flexGrow: 1,
                      maxWidth: 120,
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': {
                          borderColor: '#374151',
                        },
                        '&:hover fieldset': {
                          borderColor: '#3b82f6',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#3b82f6',
                        },
                      },
                      '& .MuiInputLabel-root': {
                        color: '#9ca3af',
                      },
                      '& .MuiInputBase-input': {
                        color: '#ffffff',
                      },
                      '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
                        WebkitAppearance: 'none',
                        margin: 0,
                      },
                      '& input[type=number]': {
                        MozAppearance: 'textfield',
                      },
                    }}
                  />
                  <IconButton 
                    size="small"
                    onClick={() => removeEntry(index)}
                    disabled={entries.length === 1}
                    sx={{
                      color: '#ef4444',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      '&:hover': {
                        backgroundColor: 'rgba(239, 68, 68, 0.2)',
                      },
                      '&.Mui-disabled': {
                        color: '#6b7280',
                        backgroundColor: 'rgba(107, 114, 128, 0.1)',
                      },
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}

              <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={addEntry}
                  sx={{
                    borderColor: '#3b82f6',
                    color: '#3b82f6',
                    '&:hover': {
                      borderColor: '#2563eb',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Add Stock
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<CalculateIcon />}
                  onClick={() => {
                    calculateRisk();
                    handleCalculatorClose();
                  }}
                  disabled={isLoading || entries.some(e => !e.stock || e.shares <= 0)}
                  sx={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    fontWeight: 600,
                    '&:hover': {
                      background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                    },
                    '&.Mui-disabled': {
                      background: 'rgba(107, 114, 128, 0.3)',
                      color: '#6b7280',
                    },
                  }}
                >
                  {isLoading ? 'Calculating...' : 'Calculate Risk'}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={clearSession}
                  sx={{
                    color: '#ef4444',
                    borderColor: '#ef4444',
                    '&:hover': {
                      borderColor: '#dc2626',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    },
                  }}
                >
                  Clear
                </Button>
              </Box>
            </Box>
          </Popover>
        </Box>


      {/* Error Display */}
      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 3,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            '& .MuiAlert-message': {
              color: '#ef4444',
            },
          }}
        >
          {error}
        </Alert>
      )}

        {/* Error Display */}
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 3,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              '& .MuiAlert-message': {
                color: '#ef4444',
              },
            }}
          >
            {error}
          </Alert>
        )}

        {/* Results Section - Expanded */}
        {results && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: 'calc(100vh - 200px)' }}>
            {/* Chart Section - Expanded */}
            {entries.some(e => e.stock && e.shares > 0) && (
              <Paper
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  flex: '1 1 60%',
                  minHeight: 500,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Typography 
                  variant="h6" 
                  sx={{ 
                    color: '#ffffff', 
                    fontWeight: 600, 
                    mb: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Portfolio Performance Chart
                </Typography>
                <Box sx={{ position: 'relative', flex: 1, minHeight: 400, backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', p: 2 }}>
              {isLoadingChart ? (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={24} sx={{ color: tileColor }} />
                </Box>
              ) : chartData && chartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis 
                        dataKey="time" 
                        stroke="#9ca3af" 
                        fontSize={10}
                        tick={{ fill: '#9ca3af' }}
                        axisLine={{ stroke: '#374151' }}
                        label={{ value: 'Date', position: 'insideBottom', offset: -5, fill: '#9ca3af', fontSize: 11 }}
                        tickFormatter={(value) => {
                          const dataPoint = chartData.find(d => d.time === value);
                          return dataPoint?.date || new Date(value * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis 
                        stroke="#9ca3af" 
                        fontSize={10}
                        tick={{ fill: '#9ca3af' }}
                        axisLine={{ stroke: '#374151' }}
                        label={{ value: chartType === 'single' ? 'Portfolio Value ($)' : 'Price ($)', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
                        domain={getYAxisDomain()}
                        tickFormatter={(value) => {
                          if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                          if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
                          return `$${value.toFixed(0)}`;
                        }}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid #374151',
                          borderRadius: '4px',
                          color: 'white'
                        }}
                        labelFormatter={(value) => {
                          const dataPoint = chartData.find(d => d.time === value);
                          return dataPoint?.date || new Date(value * 1000).toLocaleDateString();
                        }}
                        formatter={(value: any) => {
                          if (typeof value === 'number') {
                            return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          }
                          return value;
                        }}
                      />
                      {chartType === 'single' && (
                        <Line 
                          type="monotone" 
                          dataKey="value" 
                          stroke={tileColor} 
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: tileColor }}
                        />
                      )}
                      {chartType === 'multiple' && entries.filter(e => e.stock && e.shares > 0).map((entry, idx) => {
                        // Extract symbol the same way as in loadChartData
                        const symbolMatch = entry.stock.match(/^([A-Z.]+)(?:\s*-|$)/);
                        const symbol = symbolMatch ? symbolMatch[1].trim().toUpperCase() : entry.stock.trim().toUpperCase();
                        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4'];
                        return (
                          <Line 
                            key={symbol}
                            type="monotone" 
                            dataKey={symbol} 
                            stroke={colors[idx % colors.length]} 
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            name={symbol}
                          />
                        );
                      })}
                      {chartType === 'multiple' && (
                        <Legend 
                          wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }}
                          iconType="line"
                        />
                      )}
                      {chartType === 'compare' && (
                        <>
                          <Line 
                            type="monotone" 
                            dataKey="portfolio" 
                            stroke={tileColor} 
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            name="Portfolio"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="compare" 
                            stroke="#f59e0b" 
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            name={compareStock || 'Comparison'}
                          />
                          <Legend 
                            wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }}
                            iconType="line"
                          />
                        </>
                      )}
                      <Brush
                        dataKey="time"
                        height={30}
                        stroke="#3b82f6"
                        fill="rgba(59, 130, 246, 0.1)"
                        tickFormatter={(value) => {
                          const dataPoint = chartData.find(d => d.time === value);
                          return dataPoint?.date || new Date(value * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  {/* Chart Type Icon Selector - Bottom Left */}
                  <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Combined Portfolio">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setChartType('single');
                          setCompareDialogOpen(false);
                        }}
                        sx={{
                          backgroundColor: chartType === 'single' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(15, 23, 42, 0.9)',
                          color: chartType === 'single' ? tileColor : '#9ca3af',
                          border: `1px solid ${chartType === 'single' ? tileColor : '#374151'}`,
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.3)',
                            borderColor: tileColor,
                          },
                          width: 32,
                          height: 32,
                        }}
                      >
                        <TimelineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="All Stocks">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setChartType('multiple');
                          setCompareDialogOpen(false);
                        }}
                        sx={{
                          backgroundColor: chartType === 'multiple' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(15, 23, 42, 0.9)',
                          color: chartType === 'multiple' ? tileColor : '#9ca3af',
                          border: `1px solid ${chartType === 'multiple' ? tileColor : '#374151'}`,
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.3)',
                            borderColor: tileColor,
                          },
                          width: 32,
                          height: 32,
                        }}
                      >
                        <ShowChartIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Compare with Stock">
                      <Box sx={{ position: 'relative' }}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (chartType !== 'compare') {
                              setChartType('compare');
                            }
                            setCompareDialogOpen(!compareDialogOpen);
                          }}
                          sx={{
                            backgroundColor: chartType === 'compare' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(15, 23, 42, 0.9)',
                            color: chartType === 'compare' ? tileColor : '#9ca3af',
                            border: `1px solid ${chartType === 'compare' ? tileColor : '#374151'}`,
                            '&:hover': {
                              backgroundColor: 'rgba(59, 130, 246, 0.3)',
                              borderColor: tileColor,
                            },
                            width: 32,
                            height: 32,
                          }}
                        >
                          <CompareArrowsIcon fontSize="small" />
                        </IconButton>
                        {compareDialogOpen && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 40,
                              left: 0,
                              backgroundColor: 'rgba(15, 23, 42, 0.95)',
                              border: '1px solid #374151',
                              borderRadius: '4px',
                              p: 1,
                              zIndex: 1000,
                              minWidth: 200,
                            }}
                          >
                            <Autocomplete
                              value={compareInputValue}
                              onChange={(_, newValue) => {
                                if (newValue) {
                                  let symbol = '';
                                  if (typeof newValue === 'string') {
                                    const symbolMatch = newValue.match(/^([A-Z.]+)(?:\s*-|$)/);
                                    symbol = symbolMatch ? symbolMatch[1].trim() : newValue.trim();
                                  } else {
                                    symbol = newValue.symbol || '';
                                  }
                                  symbol = symbol.toUpperCase();
                                  if (symbol) {
                                    setCompareStock(symbol);
                                    setCompareInputValue(symbol);
                                    setChartType('compare'); // Ensure chart type is set to compare
                                    setCompareDialogOpen(false);
                                  }
                                }
                              }}
                              onInputChange={(_, newInputValue) => {
                                // Normalize to uppercase as user types
                                const normalized = newInputValue.toUpperCase();
                                setCompareInputValue(normalized);
                                if (isSecurityDataLoaded && normalized) {
                                  const suggestions = securitySuggestionsServiceV2.getSuggestions(normalized, 50);
                                  const seen = new Set<string>();
                                  const uniqueSuggestions = suggestions.filter(security => {
                                    if (seen.has(security.symbol)) return false;
                                    seen.add(security.symbol);
                                    return true;
                                  });
                                  setSecuritySuggestions(uniqueSuggestions);
                                }
                              }}
                              options={securitySuggestions}
                              getOptionLabel={(option) => {
                                if (typeof option === 'string') return option;
                                return option.displayText || option.symbol || '';
                              }}
                              freeSolo
                              autoSelect={false}
                              selectOnFocus={false}
                              clearOnBlur={false}
                              autoHighlight={false}
                              disableListWrap={true}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  placeholder="Enter ticker (press Enter)"
                                  size="small"
                                  onKeyDown={(e) => {
                                    // Handle Enter key to submit free text input
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      const inputValue = (e.target as HTMLInputElement).value.trim().toUpperCase();
                                      if (inputValue) {
                                        // Extract just the ticker symbol if user entered display text
                                        const symbolMatch = inputValue.match(/^([A-Z.]+)(?:\s*-|$)/);
                                        const symbol = symbolMatch ? symbolMatch[1].trim() : inputValue.trim();
                                        if (symbol) {
                                          setCompareStock(symbol);
                                          setCompareInputValue(symbol);
                                          setChartType('compare'); // Ensure chart type is set to compare
                                          setCompareDialogOpen(false);
                                        }
                                      }
                                    }
                                    // Allow default behavior for other keys
                                    if (params.inputProps?.onKeyDown) {
                                      params.inputProps.onKeyDown(e as any);
                                    }
                                  }}
                                  sx={{
                                    '& .MuiOutlinedInput-root': {
                                      color: 'white',
                                      '& fieldset': {
                                        borderColor: '#374151',
                                      },
                                    },
                                  }}
                                />
                              )}
                            />
                          </Box>
                        )}
                      </Box>
                    </Tooltip>
                  </Box>
                </>
              ) : (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                    No chart data available
                  </Typography>
                </Box>
              )}
                </Box>
              </Paper>
            )}

            {/* Bottom Section - Two Tables Side by Side */}
            <Box sx={{ display: 'flex', gap: 3, flex: '1 1 35%', minHeight: 400 }}>
              {/* Stock Details Table - Bottom Left */}
              <Paper
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  flex: '1 1 50%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Typography 
                  variant="h6" 
                  sx={{ 
                    color: '#ffffff', 
                    fontWeight: 600, 
                    mb: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Stock Details
                </Typography>
                <TableContainer
                  sx={{
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    flex: 1,
                    overflow: 'auto',
                  }}
                >
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                  <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Stock</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Weight</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Annual Return</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Volatility</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Std Dev</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Variance</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Avg Covariance</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Shares</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Current Price</TableCell>
                  <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Total Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(results.stock_details).map(([stock, details]) => (
                  <TableRow 
                    key={stock}
                    sx={{
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      },
                    }}
                  >
                    <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>{stock}</TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {(details.weight * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: details.annual_return >= 0 ? '#22c55e' : '#ef4444' }}>
                      {details.annual_return >= 0 ? '+' : ''}{details.annual_return.toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.annual_volatility.toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.standard_deviation !== undefined ? (details.standard_deviation * 100).toFixed(2) + '%' : 'N/A'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.variance !== undefined ? details.variance.toFixed(6) : 'N/A'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.avg_covariance !== undefined ? details.avg_covariance.toFixed(6) : 'N/A'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      {details.shares.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#9ca3af' }}>
                      ${details.current_price.toFixed(2)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      ${details.total_value.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
              </TableContainer>
              </Paper>

              {/* Advanced Metrics Table - Bottom Right */}
              <Paper
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  flex: '1 1 50%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Typography 
                  variant="h6" 
                  sx={{ 
                    color: '#ffffff', 
                    fontWeight: 600, 
                    mb: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Advanced Metrics
                </Typography>
                <TableContainer
                  sx={{
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    flex: 1,
                    overflow: 'auto',
                    '&::-webkit-scrollbar': {
                      width: '6px',
                    },
                    '&::-webkit-scrollbar-track': {
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                    },
                    '&::-webkit-scrollbar-thumb': {
                      backgroundColor: 'rgba(59, 130, 246, 0.5)',
                      borderRadius: '3px',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    },
                  }}
                >
                  <Table>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Metric</TableCell>
                        <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Total Portfolio Value</TableCell>
                        <TableCell align="right" sx={{ color: '#ffffff', fontWeight: 600 }}>
                          ${results.total_portfolio_value.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Expected Annual Return</TableCell>
                        <TableCell align="right" sx={{ color: '#22c55e', fontWeight: 600 }}>
                          {results.portfolio_expected_return >= 0 ? '+' : ''}{results.portfolio_expected_return.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>CAGR</TableCell>
                        <TableCell align="right" sx={{ color: (results.cagr !== undefined && results.cagr !== null && results.cagr >= 0) ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                          {(results.cagr !== undefined && results.cagr !== null) ? `${results.cagr >= 0 ? '+' : ''}${results.cagr.toFixed(2)}%` : 'N/A'}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Alpha</TableCell>
                        <TableCell align="right" sx={{ color: (results.alpha !== undefined && results.alpha !== null && results.alpha >= 0) ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                          {(results.alpha !== undefined && results.alpha !== null) ? `${results.alpha >= 0 ? '+' : ''}${results.alpha.toFixed(2)}%` : 'N/A'}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Beta</TableCell>
                        <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                          {(results.beta !== undefined && results.beta !== null) ? results.beta.toFixed(2) : 'N/A'}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Volatility</TableCell>
                        <TableCell align="right" sx={{ color: '#ef4444', fontWeight: 600 }}>
                          {results.portfolio_volatility.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Standard Deviation</TableCell>
                        <TableCell align="right" sx={{ color: '#ef4444', fontWeight: 600 }}>
                          {(results.portfolio_standard_deviation !== undefined && results.portfolio_standard_deviation !== null) ? (results.portfolio_standard_deviation * 100).toFixed(2) + '%' : 'N/A'}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Portfolio Variance</TableCell>
                        <TableCell align="right" sx={{ color: '#ef4444', fontWeight: 600 }}>
                          {(results.portfolio_variance !== undefined && results.portfolio_variance !== null) ? results.portfolio_variance.toFixed(6) : 'N/A'}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Sharpe Ratio</TableCell>
                        <TableCell align="right" sx={{ color: '#a855f7', fontWeight: 600 }}>
                          {results.sharpe_ratio.toFixed(2)}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                        <TableCell sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>Risk Level</TableCell>
                        <TableCell align="right">
                          <Chip
                            label={getRiskLevel(results.portfolio_volatility).level}
                            size="small"
                            sx={{
                              backgroundColor: getRiskLevel(results.portfolio_volatility).color,
                              color: '#ffffff',
                              fontWeight: 600,
                            }}
                          />
                        </TableCell>
                      </TableRow>
                      {results.correlation && results.correlation.matrix && results.correlation.tickers && results.correlation.tickers.length > 1 && (
                        <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                          <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Avg Correlation</TableCell>
                          <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                            {(() => {
                              const tickers = results.correlation!.tickers!;
                              const matrix = results.correlation!.matrix!;
                              let sum = 0;
                              let count = 0;
                              for (let i = 0; i < tickers.length; i++) {
                                for (let j = i + 1; j < tickers.length; j++) {
                                  const corr = matrix[tickers[i]]?.[tickers[j]];
                                  if (corr !== undefined && !isNaN(corr)) {
                                    sum += corr;
                                    count++;
                                  }
                                }
                              }
                              const avg = count > 0 ? sum / count : 0;
                              return avg.toFixed(3);
                            })()}
                          </TableCell>
                        </TableRow>
                      )}
                      {results.covariance && results.covariance.matrix && results.covariance.tickers && results.covariance.tickers.length > 1 && (
                        <TableRow sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                          <TableCell sx={{ color: '#ffffff', fontWeight: 600 }}>Avg Covariance</TableCell>
                          <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                            {(() => {
                              const tickers = results.covariance!.tickers!;
                              const matrix = results.covariance!.matrix!;
                              let sum = 0;
                              let count = 0;
                              for (let i = 0; i < tickers.length; i++) {
                                for (let j = i + 1; j < tickers.length; j++) {
                                  const cov = matrix[tickers[i]]?.[tickers[j]];
                                  if (cov !== undefined && !isNaN(cov)) {
                                    sum += Math.abs(cov);
                                    count++;
                                  }
                                }
                              }
                              const avg = count > 0 ? sum / count : 0;
                              return avg.toFixed(6);
                            })()}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Box>
          </Box>
        )}
      </Container>
    </Box>
  );
}
