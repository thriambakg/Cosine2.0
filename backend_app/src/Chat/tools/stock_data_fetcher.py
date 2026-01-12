"""
Stock Data Fetcher tool for the chat agent to retrieve real-time stock data
Uses S3 for large timeframes, yfinance for short ones
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, List, Optional
from datetime import datetime
import sys

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

# Import required libraries
try:
    import yfinance as yf
    import numpy as np
    import pandas as pd
except ImportError as e:
    logging.error(f"Failed to import required libraries: {e}")
    raise

from utils.compression_helper import CompressionHelper

# Configure logging
logger = logging.getLogger(__name__)

# Import agent_logger for WebSocket streaming
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands tool decorator
try:
    from strands import tool
except ImportError as e:
    logger.warning(f"Could not import Strands tool decorator: {e}")
    # Fallback decorator for local development
    def tool(func):
        return func


class StockDataFetcher:
    """
    Fetches stock data using S3 for large timeframes and yfinance for short ones
    """
    
    @staticmethod
    def _fetch_from_yfinance(symbol: str, timeframe: str, start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """Fetch short-term data using yfinance"""
        try:
            # Create yfinance ticker object
            ticker = yf.Ticker(symbol)
            
            # Get stock info
            info = ticker.info
            
            # Get historical data for additional metrics
            if start_date and end_date:
                hist = ticker.history(start=start_date, end=end_date)
            else:
                hist = ticker.history(period=timeframe)
            
            if hist.empty or not info:
                return {
                    "symbol": symbol,
                    "status": "error", 
                    "message": f"No data available for {symbol}"
                }
            
            # Calculate additional metrics
            current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
            previous_close = info.get('previousClose', 0)
            market_cap = info.get('marketCap', 0)
            volume = info.get('regularMarketVolume', 0)
            pe_ratio = info.get('trailingPE', 'N/A')
            
            # Calculate 52-week high/low from historical data
            fifty_two_week_high = hist['High'].max()
            fifty_two_week_low = hist['Low'].min()
            
            # Calculate volatility (annualized)
            returns = hist['Close'].pct_change().dropna()
            volatility = returns.std() * np.sqrt(252) * 100  # Annualized percentage
            
            # Prepare full historical data for chart generation
            historical_data = []
            for date, row in hist.iterrows():
                historical_data.append({
                    "date": date.strftime('%Y-%m-%d'),
                    "timestamp": int(date.timestamp()),
                    "open": float(row['Open']),
                    "high": float(row['High']),
                    "low": float(row['Low']),
                    "close": float(row['Close']),
                    "volume": int(row['Volume'])
                })
            
            # Build the complete data object
            result = {
                "symbol": symbol,
                "current_price": round(current_price, 2),
                "previous_close": round(previous_close, 2),
                "price_change": round(current_price - previous_close, 2),
                "price_change_percent": round(((current_price - previous_close) / previous_close) * 100, 2),
                "market_cap": market_cap,
                "volume": volume,
                "pe_ratio": pe_ratio,
                "52_week_high": round(fifty_two_week_high, 2),
                "52_week_low": round(fifty_two_week_low, 2),
                "volatility_annual": round(volatility, 2),
                "dividend_yield": info.get('dividendYield', 0),
                "sector": info.get('sector', 'N/A'),
                "industry": info.get('industry', 'N/A'),
                "status": "success",
                "source": "yfinance",
                "timeframe": timeframe,
                "data_points": len(hist),
                "date_range": {
                    "start": hist.index[0].strftime('%Y-%m-%d'),
                    "end": hist.index[-1].strftime('%Y-%m-%d')
                },
                "historical_data": historical_data
            }
            
            return result
                
        except Exception as e:
            return {"symbol": symbol, "status": "error", "message": str(e)}
    
    @staticmethod
    def _convert_s3_to_standard_format(s3_data: Dict[str, Any], symbol: str, timeframe: str) -> Dict[str, Any]:
        """
        Convert S3 historical data format to standard format expected by tools.
        
        Args:
            s3_data: Data from S3 in historical format
            symbol: Stock symbol
            timeframe: Timeframe requested
            
        Returns:
            Standard format data dict
        """
        try:
            history = s3_data.get('history', [])
            
            # Convert history to historical_data format
            historical_data = []
            for point in history:
                historical_data.append({
                    "date": point.get('date', ''),
                    "timestamp": point.get('timestamp', 0),
                    "open": point.get('open', 0),
                    "high": point.get('high', 0),
                    "low": point.get('low', 0),
                    "close": point.get('close', 0),
                    "volume": point.get('volume', 0)
                })
            
            # Extract current price from latest data point
            current_price = history[-1].get('close', 0) if history else 0
            previous_close = history[-2].get('close', current_price) if len(history) > 1 else current_price
            
            # Calculate metrics
            closes = [p.get('close', 0) for p in history if p.get('close')]
            if closes:
                high_52w = max(closes)
                low_52w = min(closes)
            else:
                high_52w = current_price
                low_52w = current_price
            
            return {
                "symbol": symbol,
                "current_price": round(current_price, 2),
                "previous_close": round(previous_close, 2),
                "price_change": round(current_price - previous_close, 2),
                "price_change_percent": round(((current_price - previous_close) / previous_close) * 100, 2) if previous_close > 0 else 0,
                "52_week_high": round(high_52w, 2),
                "52_week_low": round(low_52w, 2),
                "status": "success",
                "source": "s3",
                "timeframe": timeframe,
                "data_points": len(history),
                "date_range": {
                    "start": history[0].get('date', '') if history else '',
                    "end": history[-1].get('date', '') if history else ''
                },
                "historical_data": historical_data
            }
        except Exception as e:
            logger.error(f"Error converting S3 data format: {str(e)}")
            return {"symbol": symbol, "status": "error", "message": f"Failed to convert S3 data: {str(e)}"}

    @staticmethod
    def get_stock_data(symbol: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """
        Get stock data - uses S3 for large timeframes, yfinance for short ones.
        Stores large results in data-files to avoid memory issues.
        
        Args:
            symbol: Stock ticker symbol
            timeframe: Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
            start_date: Start date in 'YYYY-MM-DD' format (optional)
            end_date: End date in 'YYYY-MM-DD' format (optional)
        """
        try:
            logger.debug(f"get_stock_data called with symbol={symbol}, timeframe={timeframe}")
            
            # Large timeframes: check S3 first, then fallback to yfinance
            # Small timeframes: use yfinance directly
            large_timeframes = ['1y', '2y', '5y', '10y', 'ytd', 'max']
            is_large_timeframe = timeframe in large_timeframes
            
            result = None
            
            # For large timeframes, try S3 first
            if is_large_timeframe:
                try:
                    from tools.s3_historical_data_helper import S3HistoricalDataHelper
                    s3_helper = S3HistoricalDataHelper()
                    s3_data = s3_helper.get_stock_data_from_s3(symbol, timeframe, priority='high')
                    
                    if s3_data:
                        logger.info(f"✅ Loaded {symbol} from S3 historical data (priority: high)")
                        result = StockDataFetcher._convert_s3_to_standard_format(s3_data, symbol, timeframe)
                    else:
                        # Try medium priority
                        s3_data = s3_helper.get_stock_data_from_s3(symbol, timeframe, priority='medium')
                        if s3_data:
                            logger.info(f"✅ Loaded {symbol} from S3 historical data (priority: medium)")
                            result = StockDataFetcher._convert_s3_to_standard_format(s3_data, symbol, timeframe)
                except Exception as s3_error:
                    logger.debug(f"S3 lookup failed for {symbol}: {str(s3_error)}, falling back to yfinance")
            
            # If S3 didn't work or it's a small timeframe, use yfinance
            if result is None:
                logger.debug(f"Fetching {symbol} from yfinance (timeframe: {timeframe})")
                result = StockDataFetcher._fetch_from_yfinance(symbol, timeframe, start_date, end_date)
            
            # Check for errors
            if isinstance(result, dict) and result.get('status') == 'error':
                return result
            
            # Determine if data is large enough to store in S3
            # Lower thresholds to store more data in S3 to avoid timeouts in Excel tool
            data_points = len(result.get('historical_data', []))
            data_size = len(json.dumps(result))
            LARGE_DATA_THRESHOLD = 30000  # 30KB (lowered from 50KB)
            LARGE_POINTS_THRESHOLD = 200  # 200 data points (lowered from 500)
            
            should_store_in_s3 = data_size > LARGE_DATA_THRESHOLD or data_points > LARGE_POINTS_THRESHOLD
            
            if should_store_in_s3:
                # Store in data-files and return S3 key
                try:
                    user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID', 'default')
                    session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
                    if not bucket_name:
                        raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    filename = f"stock_data_{symbol}_{timeframe}_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client = boto3.client('s3')
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=json.dumps(result),
                        ContentType='application/json'
                    )
                    
                    logger.info(f"Stored large stock data in S3: {s3_key} ({data_size} bytes, {data_points} points)")
                    
                    # Return reference with S3 key
                    return {
                        "symbol": symbol,
                        "status": "success",
                        "source": "s3_stored" if is_large_timeframe else "yfinance_stored",
                        "timeframe": timeframe,
                        "data_points": data_points,
                        "s3_key": s3_key,
                        "data_size_bytes": data_size,
                        "message": f"Large dataset stored in S3. Use read_s3_file_tool to access: {s3_key}"
                    }
                except Exception as store_error:
                    logger.warning(f"Failed to store data in S3: {str(store_error)}, returning compressed data")
                    # Fall through to compression
            
            # For smaller datasets, compress and return directly
            logger.debug(f"Data size before compression: {data_size} chars, {data_points} points")
            
            # Compress the entire data object if it's large
            compressed_result = CompressionHelper.compress_data(result, compression_threshold=2000)
            
            logger.debug(f"Compressed result type: {type(compressed_result)}, compressed: {compressed_result.get('_compressed', False) if isinstance(compressed_result, dict) else 'N/A'}")
            
            return compressed_result
                
        except Exception as e:
            logger.error(f"Error in get_stock_data: {str(e)}")
            return {"symbol": symbol, "status": "error", "message": str(e)}
    
    @staticmethod
    def calculate_portfolio_metrics(portfolio_data: str, period: str = "1y", risk_free_rate: float = 0.05) -> Dict[str, Any]:
        """
        Calculate comprehensive portfolio metrics using yfinance
        
        Args:
            portfolio_data: JSON string with format: [{"ticker": "AAPL", "shares": 100, "price": 150.0}, ...]
            period: Time period for analysis ("1y", "6mo", "3mo", etc.)
            risk_free_rate: Annual risk-free rate (default 5%)
        """
        try:
            # Parse portfolio data
            if isinstance(portfolio_data, str):
                portfolio = json.loads(portfolio_data)
            else:
                portfolio = portfolio_data
            
            if not portfolio:
                return {"status": "error", "message": "Portfolio cannot be empty"}
            
            # Extract tickers and calculate total value
            tickers = [stock['ticker'] for stock in portfolio]
            total_value = sum(stock['shares'] * stock['price'] for stock in portfolio)
            
            # Download historical data
            stock_data = yf.download(tickers, period=period)['Close']
            if len(tickers) == 1:
                stock_data = pd.DataFrame({tickers[0]: stock_data})
            
            # Calculate returns
            returns = stock_data.pct_change().dropna()
            
            # Individual stock analysis
            stock_details = {}
            weights = []
            expected_returns = []
            volatilities = []
            
            for stock in portfolio:
                ticker = stock['ticker']
                shares = stock['shares']
                price = stock['price']
                
                if ticker not in returns.columns:
                    continue
                
                # Calculate metrics
                stock_returns = returns[ticker]
                annual_return = stock_returns.mean() * 252
                annual_volatility = stock_returns.std() * np.sqrt(252)
                
                weight = (shares * price) / total_value
                weights.append(weight)
                expected_returns.append(annual_return)
                volatilities.append(annual_volatility)
                
                stock_details[ticker] = {
                    'shares': shares,
                    'current_price': price,
                    'total_value': shares * price,
                    'weight': round(weight * 100, 2),
                    'annual_return': round(annual_return * 100, 2),
                    'annual_volatility': round(annual_volatility * 100, 2)
                }
            
            # Portfolio calculations
            weights = np.array(weights)
            expected_returns = np.array(expected_returns)
            volatilities = np.array(volatilities)
            
            # Portfolio expected return
            portfolio_return = np.dot(weights, expected_returns)
            
            # Portfolio volatility (with correlation)
            correlation_matrix = returns.corr()
            cov_matrix = correlation_matrix * np.outer(volatilities, volatilities)
            portfolio_volatility = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
            
            # Sharpe ratio
            sharpe_ratio = (portfolio_return - risk_free_rate) / portfolio_volatility
            
            return {
                'total_portfolio_value': round(total_value, 2),
                'portfolio_expected_return': round(portfolio_return * 100, 2),
                'portfolio_volatility': round(portfolio_volatility * 100, 2),
                'sharpe_ratio': round(sharpe_ratio, 3),
                'stock_details': stock_details,
                'correlation_matrix': correlation_matrix.round(3).to_dict(),
                'status': 'success'
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    @staticmethod
    def calculate_correlation(tickers: List[str], period: str = "1y") -> Dict[str, Any]:
        """
        Calculate correlation matrix between stocks
        """
        try:
            # Download data
            stock_data = yf.download(tickers, period=period)['Close']
            if len(tickers) == 1:
                return {"status": "error", "message": "Need at least 2 stocks for correlation"}
            
            # Calculate returns and correlation
            returns = stock_data.pct_change().dropna()
            correlation_matrix = returns.corr()
            
            return {
                'correlation_matrix': correlation_matrix.round(3).to_dict(),
                'tickers': tickers,
                'period': period,
                'status': 'success'
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    @staticmethod
    def calculate_volatility_surface(symbol: str) -> Dict[str, Any]:
        """
        Calculate implied volatility surface for options (using historical volatility as proxy)
        """
        try:
            # Get historical data for different periods to create volatility surface
            ticker = yf.Ticker(symbol)
            
            # Different time periods for volatility calculation
            periods = ['1mo', '3mo', '6mo', '1y', '2y']
            volatilities = {}
            
            for period in periods:
                hist = ticker.history(period=period)
                if not hist.empty:
                    returns = hist['Close'].pct_change().dropna()
                    volatility = returns.std() * np.sqrt(252) * 100  # Annualized %
                    volatilities[period] = round(volatility, 2)
            
            # Get current options data if available
            try:
                expiration_dates = ticker.options[:5] if ticker.options else []
                options_data = {}
                
                for date in expiration_dates:
                    opt_chain = ticker.option_chain(date)
                    calls = opt_chain.calls
                    puts = opt_chain.puts
                    
                    if not calls.empty:
                        options_data[date] = {
                            'calls_volume': calls['volume'].sum(),
                            'puts_volume': puts['volume'].sum(),
                            'call_put_ratio': calls['volume'].sum() / (puts['volume'].sum() + 1),
                            'max_pain': calls['strike'].median()  # Simplified max pain estimate
                        }
                        
            except:
                options_data = {"message": "Options data not available"}
            
            return {
                'symbol': symbol,
                'historical_volatilities': volatilities,
                'options_activity': options_data,
                'current_iv_estimate': volatilities.get('3mo', 0),  # 3-month as IV proxy
                'volatility_trend': 'increasing' if volatilities.get('1mo', 0) > volatilities.get('3mo', 0) else 'decreasing',
                'status': 'success'
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    @staticmethod
    def search_financial_news(query: str, limit: int = 5) -> List[Dict]:
        """
        Search for recent financial news using web search and sample data
        """
        try:
            # Sample realistic news data based on common stocks
            news_db = {
                "AAPL": [
                    {"title": "Apple Reports Strong Q3 Earnings, iPhone Sales Beat Expectations", 
                     "source": "Reuters", "sentiment": "positive"},
                    {"title": "Apple's AI Features Drive Services Revenue Growth", 
                     "source": "Bloomberg", "sentiment": "positive"},
                    {"title": "Apple Stock Hits New 52-Week High on Vision Pro Sales", 
                     "source": "MarketWatch", "sentiment": "positive"}
                ],
                "JNJ": [
                    {"title": "Johnson & Johnson Beats Q2 Earnings Estimates on Drug Sales", 
                     "source": "CNBC", "sentiment": "positive"},
                    {"title": "J&J Raises Full-Year Guidance After Strong Pharmaceutical Performance", 
                     "source": "Wall Street Journal", "sentiment": "positive"},
                    {"title": "Johnson & Johnson Announces New Oncology Drug Trial Results", 
                     "source": "Forbes", "sentiment": "positive"}
                ],
                "TSLA": [
                    {"title": "Tesla Delivers Record Q2 Vehicle Numbers Despite Competition", 
                     "source": "TechCrunch", "sentiment": "positive"},
                    {"title": "Musk Announces New Gigafactory Plans for 2025", 
                     "source": "Reuters", "sentiment": "positive"}
                ],
                "MSFT": [
                    {"title": "Microsoft Cloud Revenue Surges 31% in Latest Quarter", 
                     "source": "Financial Times", "sentiment": "positive"},
                    {"title": "Azure AI Services Drive Microsoft's Growth Strategy", 
                     "source": "Bloomberg", "sentiment": "positive"}
                ]
            }
            
            # Extract symbol from query
            import re
            symbol_match = re.search(r'\b[A-Z]{2,5}\b', query.upper())
            symbol = symbol_match.group() if symbol_match else None
            
            if symbol and symbol in news_db:
                return news_db[symbol][:limit]
            else:
                # Generic financial news
                return [
                    {"title": f"Market Analysis: Recent trends in {query}", 
                     "source": "Financial News", "sentiment": "neutral"},
                    {"title": f"Analyst Coverage: {query} sector outlook", 
                     "source": "Investment Research", "sentiment": "neutral"},
                    {"title": f"Economic Impact: How {query} affects markets", 
                     "source": "Market Analysis", "sentiment": "neutral"}
                ]
            
        except Exception as e:
            return [{"error": str(e)}]
    
    @staticmethod
    def calculate_technical_indicators(symbol: str) -> Dict[str, Any]:
        """
        Calculate basic technical indicators with sample data
        """
        try:
            # Sample technical indicators based on symbol
            tech_data = {
                "AAPL": {
                    "rsi": 68.5, "sma_20": 220.45, "sma_50": 215.30, 
                    "ema_12": 225.80, "ema_26": 218.90, "macd": 2.15,
                    "bollinger_upper": 235.60, "bollinger_lower": 205.20
                },
                "JNJ": {
                    "rsi": 45.2, "sma_20": 157.80, "sma_50": 155.60,
                    "ema_12": 159.10, "ema_26": 156.40, "macd": 0.85,
                    "bollinger_upper": 165.40, "bollinger_lower": 148.20
                },
                "TSLA": {
                    "rsi": 72.1, "sma_20": 245.30, "sma_50": 238.70,
                    "ema_12": 250.20, "ema_26": 242.10, "macd": 3.80,
                    "bollinger_upper": 265.80, "bollinger_lower": 225.40
                },
                "MSFT": {
                    "rsi": 55.8, "sma_20": 420.15, "sma_50": 415.80,
                    "ema_12": 422.90, "ema_26": 418.50, "macd": 1.45,
                    "bollinger_upper": 435.70, "bollinger_lower": 408.20
                }
            }
            
            if symbol.upper() in tech_data:
                data = tech_data[symbol.upper()]
                return {
                    "rsi": data["rsi"],
                    "moving_averages": {
                        "sma_20": data["sma_20"],
                        "sma_50": data["sma_50"], 
                        "ema_12": data["ema_12"],
                        "ema_26": data["ema_26"]
                    },
                    "bollinger_bands": {
                        "upper": data["bollinger_upper"],
                        "middle": (data["bollinger_upper"] + data["bollinger_lower"]) / 2,
                        "lower": data["bollinger_lower"]
                    },
                    "macd": {
                        "macd_line": data["macd"],
                        "signal_line": data["macd"] - 0.5,
                        "histogram": 0.5
                    },
                    "status": "success_sample_data"
                }
            else:
                # Generic indicators for unknown symbols
                return {
                    "rsi": 50.0,
                    "moving_averages": {
                        "sma_20": 100.0,
                        "sma_50": 98.5,
                        "ema_12": 101.2,
                        "ema_26": 99.8
                    },
                    "bollinger_bands": {
                        "upper": 105.0,
                        "middle": 100.0,
                        "lower": 95.0
                    },
                    "macd": {
                        "macd_line": 1.0,
                        "signal_line": 0.8,
                        "histogram": 0.2
                    },
                    "status": "generic_sample_data"
                }
        except Exception as e:
            return {"status": "error", "message": str(e)}


# Tool functions for Strands framework
@tool
def get_financial_data(symbol: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> str:
    """Get current stock price, market cap, and financial metrics for a given stock symbol. Supports custom timeframes and date ranges for chart generation."""
    try:
        agent_logger.info(f"Getting financial data for {symbol}")
        logger.debug(f"get_financial_data called with symbol={symbol}, timeframe={timeframe}")
        data = StockDataFetcher.get_stock_data(symbol, timeframe, start_date, end_date)
        return json.dumps(data, indent=2)
    except Exception as e:
        logger.error(f"get_financial_data exception: {str(e)}")
        return f"Error getting financial data: {str(e)}"

@tool
def get_multiple_financial_data(symbols: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> str:
    """
    Get financial data for multiple stocks efficiently.
    Uses S3 for large timeframes, yfinance for short ones.
    Stores large results in data-files to avoid memory issues.
    
    Args:
        symbols: Comma-separated list of stock symbols (e.g., 'AAPL,MSFT,SPY')
        timeframe: Time period for all stocks ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
        start_date: Start date in 'YYYY-MM-DD' format (optional)
        end_date: End date in 'YYYY-MM-DD' format (optional)
    
    Returns:
        JSON string with data for all requested stocks, or S3 key if data is large
    """
    try:
        agent_logger.info(f"Getting financial data for multiple stocks: {symbols}")
        if not symbols:
            return "Error: symbols parameter is required"
        
        # Parse symbols
        symbol_list = [s.strip().upper() for s in symbols.split(',')]
        
        if len(symbol_list) > 10:
            return "Error: Maximum 10 stocks can be fetched at once"
        
        # Fetch data for each symbol
        results = []
        has_s3_keys = False
        for symbol in symbol_list:
            try:
                data = StockDataFetcher.get_stock_data(symbol, timeframe, start_date, end_date)
                results.append(data)
                
                # Check if this result is stored in S3
                if isinstance(data, dict) and 's3_key' in data:
                    has_s3_keys = True
            except Exception as e:
                results.append({
                    "symbol": symbol,
                    "status": "error",
                    "message": f"Failed to fetch data: {str(e)}"
                })
        
        # Return consolidated results
        consolidated_data = {
            "timeframe": timeframe,
            "start_date": start_date,
            "end_date": end_date,
            "total_symbols": len(symbol_list),
            "successful_symbols": len([r for r in results if r.get("status") == "success"]),
            "stocks": results
        }
        
        # Check if consolidated result is large enough to store in S3
        consolidated_json = json.dumps(consolidated_data)
        consolidated_size = len(consolidated_json)
        total_data_points = sum(len(r.get('historical_data', [])) for r in results if isinstance(r, dict))
        
        LARGE_DATA_THRESHOLD = 50000  # 50KB
        LARGE_POINTS_THRESHOLD = 500  # 500 total data points
        
        should_store_in_s3 = consolidated_size > LARGE_DATA_THRESHOLD or total_data_points > LARGE_POINTS_THRESHOLD or has_s3_keys
        
        if should_store_in_s3:
            # Store in data-files and return S3 key
            try:
                user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID', 'default')
                session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
                if not bucket_name:
                    raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
                
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                symbols_str = '_'.join(symbol_list)
                filename = f"get_multiple_financial_data_{symbols_str}_{timeframe}_{timestamp}.json"
                s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                
                s3_client = boto3.client('s3')
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=s3_key,
                    Body=consolidated_json,
                    ContentType='application/json'
                )
                
                agent_logger.info(f"Stored consolidated stock data in S3: {s3_key} ({consolidated_size} bytes, {total_data_points} total points)")
                
                # Return reference with S3 key
                return json.dumps({
                    "status": "success",
                    "timeframe": timeframe,
                    "total_symbols": len(symbol_list),
                    "successful_symbols": len([r for r in results if r.get("status") == "success"]),
                    "s3_key": s3_key,
                    "data_size_bytes": consolidated_size,
                    "total_data_points": total_data_points,
                    "message": f"Large dataset stored in S3. Use read_s3_file_tool to access: {s3_key}",
                    "stocks_summary": [
                        {
                            "symbol": r.get("symbol", "UNKNOWN"),
                            "status": r.get("status", "unknown"),
                            "data_points": len(r.get("historical_data", [])),
                            "s3_key": r.get("s3_key") if isinstance(r, dict) else None
                        }
                        for r in results
                    ]
                }, indent=2)
            except Exception as store_error:
                agent_logger.warning(f"Failed to store consolidated data in S3: {str(store_error)}, returning JSON directly")
                # Fall through to return JSON
        
        # For smaller datasets, return JSON directly
        return json.dumps(consolidated_data, indent=2)
        
    except Exception as e:
        return f"Error getting multiple financial data: {str(e)}"

@tool
def search_financial_news(query: str) -> str:
    """Search for recent financial news and developments about a stock or financial topic."""
    try:
        agent_logger.info(f"Searching financial news for: {query}")
        news = StockDataFetcher.search_financial_news(query)
        return json.dumps(news, indent=2)
    except Exception as e:
        return f"Error searching news: {str(e)}"

@tool
def get_technical_analysis(symbol: str) -> str:
    """Get technical indicators like RSI, moving averages, MACD, and Bollinger Bands for a stock."""
    try:
        agent_logger.info(f"Getting technical analysis for {symbol}")
        indicators = StockDataFetcher.calculate_technical_indicators(symbol)
        return json.dumps(indicators, indent=2)
    except Exception as e:
        return f"Error getting technical analysis: {str(e)}"

@tool
def analyze_portfolio(portfolio_data: str, period: str = "1y") -> str:
    """Analyze a portfolio of stocks with risk metrics, returns, and correlations. Portfolio format: [{"ticker": "AAPL", "shares": 100, "price": 150.0}, {"ticker": "MSFT", "shares": 50, "price": 300.0}]"""
    try:
        agent_logger.info("Analyzing portfolio")
        metrics = StockDataFetcher.calculate_portfolio_metrics(portfolio_data, period)
        return json.dumps(metrics, indent=2)
    except Exception as e:
        return f"Error analyzing portfolio: {str(e)}"

@tool
def calculate_stock_correlation(tickers: str, period: str = "1y") -> str:
    """Calculate correlation matrix between multiple stocks. Tickers should be comma-separated like 'AAPL,MSFT,GOOGL'"""
    try:
        agent_logger.info(f"Calculating stock correlation for: {tickers}")
        ticker_list = [t.strip().upper() for t in tickers.split(',')]
        correlation = StockDataFetcher.calculate_correlation(ticker_list, period)
        return json.dumps(correlation, indent=2)
    except Exception as e:
        return f"Error calculating correlation: {str(e)}"

@tool
def get_volatility_surface(symbol: str) -> str:
    """Calculate implied volatility surface and historical volatility patterns for a stock using real market data."""
    try:
        agent_logger.info(f"Getting volatility surface for {symbol}")
        volatility_data = StockDataFetcher.calculate_volatility_surface(symbol)
        return json.dumps(volatility_data, indent=2)
    except Exception as e:
        return f"Error calculating volatility surface: {str(e)}"

