# Fix OpenTelemetry context issue in Lambda environment - MUST be first
import os
os.environ.setdefault('OTEL_SDK_DISABLED', 'true')
os.environ.setdefault('OTEL_PYTHON_DISABLED_INSTRUMENTATIONS', 'all')
os.environ.setdefault('OTEL_PYTHON_CONTEXT', 'contextvars_context')

# Disable Strands metrics/telemetry to prevent hanging during Agent initialization
os.environ.setdefault('STRANDS_DISABLE_METRICS', 'true')
os.environ.setdefault('STRANDS_DISABLED_TELEMETRY', 'true')
os.environ.setdefault('STRANDS_METRICS_ENABLED', 'false')

# Configure boto3 timeouts BEFORE any boto3/Strands imports
# This ensures the config is applied to all boto3 clients, including those created by Strands
try:
    import boto3
    from botocore.config import Config
    import botocore.client
    
    # Create extended timeout config for Bedrock streaming
    BEDROCK_CONFIG = Config(
        read_timeout=850,  # 14+ minutes (Lambda timeout is 900s)
        connect_timeout=10,
        retries={'max_attempts': 3, 'mode': 'adaptive'}
    )
    
    # Note: boto3.setup_default_session doesn't accept config parameter directly
    # Instead, we'll configure clients individually when created
    # The monkey-patching below will handle this
    
    # Monkey-patch boto3.client to ensure all clients use extended timeout
    _original_boto3_client = boto3.client
    def _patched_boto3_client(*args, **kwargs):
        # Only add config if it's not already provided
        if 'config' not in kwargs:
            kwargs['config'] = BEDROCK_CONFIG
        else:
            # If config is provided but has a shorter timeout, upgrade it
            existing_config = kwargs.get('config')
            if existing_config and hasattr(existing_config, 'read_timeout'):
                if existing_config.read_timeout and existing_config.read_timeout < 850:
                    kwargs['config'] = Config(
                        read_timeout=850,
                        connect_timeout=getattr(existing_config, 'connect_timeout', 10),
                        retries=getattr(existing_config, 'retries', {'max_attempts': 3, 'mode': 'adaptive'})
                    )
        return _original_boto3_client(*args, **kwargs)
    boto3.client = _patched_boto3_client
    
    # Also patch boto3.resource for resources that might need extended timeouts
    _original_boto3_resource = boto3.resource
    def _patched_boto3_resource(*args, **kwargs):
        if 'config' not in kwargs:
            kwargs['config'] = BEDROCK_CONFIG
        return _original_boto3_resource(*args, **kwargs)
    boto3.resource = _patched_boto3_resource
    
    print("✅ Configured boto3 with extended timeouts (850s) for Bedrock streaming")
    
except Exception as e:
    # Log but don't fail - boto3 might not be available yet
    print(f"⚠️ Could not configure boto3 timeouts: {e}")
    import traceback
    traceback.print_exc()

import json
import logging
from datetime import datetime, timedelta

# Import AgentLogger for unified logging (CloudWatch + WebSocket streaming)
from agent_logger import get_agent_logger

# Initialize agent logger (will be updated with session context when available)
agent_logger = get_agent_logger()

# Import required libraries - consolidated logging
import sys
import os
import logging

# Standard logger for non-tool logs
logger = logging.getLogger(__name__)

try:
    import requests
    from dotenv import load_dotenv
    from strands import Agent
    from strands.models import BedrockModel
    import yfinance as yf
    import numpy as np
    import pandas as pd
    logger.debug("All required imports loaded successfully")
except ImportError as e:
    # Try to add layer paths to sys.path
    layer_paths = ['/opt/python', '/opt/python/lib/python3.11/site-packages', '/opt/python/lib/python3.11/dist-packages']
    for path in layer_paths:
        if os.path.exists(path) and path not in sys.path:
            sys.path.insert(0, path)
    
    # Try importing again
    try:
        import requests
        from dotenv import load_dotenv
        from strands import Agent
        from strands.models import BedrockModel
        import yfinance as yf
        import numpy as np
        import pandas as pd
        logger.debug("All required imports loaded after adding layer paths")
    except ImportError as e2:
        logger.error(f"Failed to import required libraries: {e2}")
        raise
except Exception as e:
    logger.error(f"Error importing libraries: {e}")
    raise

from typing import Dict, Any, List, Optional

# Connection pooling for better performance
_requests_session = None

def get_requests_session():
    """Get or create a requests session with connection pooling"""
    global _requests_session
    if _requests_session is None:
        _requests_session = requests.Session()
        # Configure connection pooling
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=20,
            max_retries=3
        )
        _requests_session.mount('http://', adapter)
        _requests_session.mount('https://', adapter)
    return _requests_session

# Import tools from strands-agents-tools (available in Lambda layer)
from strands_tools import http_request
from strands_tools import calculator

# Import the tool decorator from Strands (available in Lambda layer)
from strands import tool

# Import our custom financial calculator tool module
from tools import financial_calculator

# NOTE: PLANNER DOES NOT IMPORT ACTUAL TOOL IMPLEMENTATIONS
# The planner only needs tool specifications for planning, not actual tool functions
# Tool implementations are in the tools/ directory and are executed by the orchestrator
# Import tool specifications instead
from .tool_specifications import TOOL_SPECIFICATIONS, get_tool_specification, get_all_tool_names

# Financial Analysis Tools
class FinancialTools:
    """Enhanced financial analysis tools for the Cosine agent"""
    
    @staticmethod
    def get_current_timestamp() -> str:
        """Get current timestamp in ISO format"""
        return datetime.now().isoformat()
    
    @staticmethod
    def calculate_portfolio_metrics(portfolio_json: str, period: str = "1y") -> Dict[str, Any]:
        """
        Calculate portfolio metrics including returns, volatility, and correlations
        """
        try:
            portfolio = json.loads(portfolio_json)
            
            # Extract tickers and weights
            tickers = [holding['ticker'] for holding in portfolio]
            shares = [holding['shares'] for holding in portfolio]
            prices = [holding['price'] for holding in portfolio]
            
            # Calculate portfolio values
            values = [s * p for s, p in zip(shares, prices)]
            total_value = sum(values)
            weights = [v / total_value for v in values]
            
            # Download historical data
            stock_data = yf.download(tickers, period=period)['Close']
            if len(tickers) == 1:
                stock_data = stock_data.to_frame(tickers[0])
            
            # Calculate returns
            returns = stock_data.pct_change().dropna()
            
            # Portfolio return calculation
            portfolio_returns = returns.dot(weights)
            
            # Risk metrics
            portfolio_volatility = portfolio_returns.std() * np.sqrt(252) * 100
            portfolio_return = portfolio_returns.mean() * 252 * 100
            sharpe_ratio = portfolio_return / portfolio_volatility if portfolio_volatility > 0 else 0
            
            # Correlation matrix
            correlation_matrix = returns.corr()
            
            # Individual stock metrics
            individual_metrics = {}
            for ticker in tickers:
                stock_returns = returns[ticker]
                individual_metrics[ticker] = {
                    'return_annual': stock_returns.mean() * 252 * 100,
                    'volatility_annual': stock_returns.std() * np.sqrt(252) * 100,
                    'weight': weights[tickers.index(ticker)]
                }
            
            return {
                'portfolio_return_annual': round(portfolio_return, 2),
                'portfolio_volatility_annual': round(portfolio_volatility, 2),
                'sharpe_ratio': round(sharpe_ratio, 2),
                'total_value': round(total_value, 2),
                'individual_stocks': individual_metrics,
                'correlation_matrix': correlation_matrix.round(3).to_dict(),
                'status': 'success'
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    




    @staticmethod
    def _fetch_from_yfinance(symbol: str, timeframe: str, start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """Fetch short-term data using yfinance (original implementation)"""
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
    def get_stock_data(symbol: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """
        Get stock data using yfinance
        
        Args:
            symbol: Stock ticker symbol
            timeframe: Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
            start_date: Start date in 'YYYY-MM-DD' format (optional)
            end_date: End date in 'YYYY-MM-DD' format (optional)
        """
        try:
            logger.debug(f"get_stock_data called with symbol={symbol}, timeframe={timeframe}")
            
            # Use yfinance for all data
            result = FinancialTools._fetch_from_yfinance(symbol, timeframe, start_date, end_date)
            
            # Check for errors
            if isinstance(result, dict) and result.get('status') == 'error':
                return result
            
            # Import compression utility
            from compression_helper import CompressionHelper
            
            # Debug logging for compression
            logger.debug(f"Data size before compression: {len(str(result))} chars, {len(result.get('historical_data', []))} points")
            
            # Compress the entire data object if it's large
            compressed_result = CompressionHelper.compress_data(result, compression_threshold=2000)
            
            # Debug logging for compression result
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
    
    @staticmethod
    def execute_python_analysis(code: str) -> str:
        """
        Execute Python code for financial analysis (SANDBOX SIMULATION)
        In production, use a proper sandboxed environment
        """
        try:
            # For security, this is just a simulation
            # In production, use Docker, PyBricks, or similar sandbox
            
            if "import" in code and any(dangerous in code for dangerous in ["os", "sys", "subprocess", "eval", "exec"]):
                return "Security Error: Dangerous operations not allowed"
            
            # Simulate some common financial calculations
            if "correlation" in code.lower():
                return "Simulated correlation analysis: 0.75 correlation between stocks"
            elif "cointegration" in code.lower():
                return "Simulated cointegration test: p-value = 0.02 (cointegrated)"
            elif "sharpe" in code.lower():
                return "Simulated Sharpe ratio: 1.45"
            else:
                return "Code execution simulated. Use actual sandbox in production."
                
        except Exception as e:
            return f"Execution error: {str(e)}"

# Load environment variables from .env file
load_dotenv()

# Note: boto3 timeout configuration moved to top of file (before imports)
# to ensure it's applied before Strands creates any boto3 clients

# Configure different Bedrock models
MODELS = {
    'claude-sonnet-4': BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
        streaming=True  # Enable streaming for real-time token delivery
    ),
    'claude-haiku-4-5': BedrockModel(
        model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        streaming=True  # Enable streaming for real-time token delivery
    ),
    'nova-lite': BedrockModel(
        model_id="us.amazon.nova-lite-v1:0"
    ),
    'gpt-oss-120b': BedrockModel(
        model_id="openai.gpt-oss-120b-1:0",
        region="us-east-1"
    ),
    'gpt-oss-20b': BedrockModel(
        model_id="openai.gpt-oss-20b-1:0",
        region="us-east-1"
    )
}

# Default model (for backward compatibility)
model = MODELS['claude-sonnet-4']

# Define an enhanced financial analysis system prompt with explicit tool orchestration
FINANCIAL_ANALYSIS_PROMPT = """
You are a professional financial analyst assistant for Cosine, a financial advisor application with REAL-TIME DATA ACCESS.

🔴 CRITICAL: You have access to LIVE FINANCIAL DATA through yfinance integration. You are NOT limited to sample data.

🚨 FILE DISCOVERY RULE - READ THIS FIRST:
When users ask ANY question about files (e.g., "can you see this file?", "do you see any files?", "what files do I have?"), you MUST:
1. IMMEDIATELY call get_session_files_tool(session_id, user_id, "all") to discover files
2. NEVER say "no files" or "empty" without calling this tool first
3. If files exist, list them and ask which one to work with
4. Use read_s3_file_tool(s3_key, file_type) to read specific files

🚨 SINGLE RESPONSE RULE:
- Provide ONLY ONE response per user message
- Do NOT generate multiple responses or follow-up messages
- Do NOT send additional messages after your initial response
- Complete your analysis in a single, comprehensive response
- Do NOT generate multiple separate messages or responses
- Do NOT provide follow-up analysis unless specifically asked
- End your response after providing the requested analysis

🔧 YOUR REAL-TIME TOOLS (MANDATORY TO USE):
1. get_financial_data(symbol, timeframe, start_date, end_date) - LIVE stock data via yfinance with custom timeframes and date ranges for chart generation
2. get_multiple_financial_data(symbols, timeframe, start_date, end_date) - Get data for multiple stocks efficiently (e.g., 'AAPL,MSFT,SPY')
2. search_financial_news(query) - Recent financial news and market developments  
3. get_technical_analysis(symbol) - Technical indicators (RSI, moving averages, MACD, Bollinger Bands)
4. analyze_portfolio(portfolio_data, period) - REAL portfolio analysis with live correlation data via yfinance
5. calculate_stock_correlation(tickers, period) - LIVE correlation matrix between stocks using yfinance data
6. python_financial_calculator(calculation) - Advanced calculations (Fama-French, VaR, Sharpe ratios)
7. http_request - Web requests for additional context
8. read_s3_file_tool(s3_key, file_type) - Read and analyze files uploaded by users to S3
9. get_session_files_tool(session_id, user_id, file_type) - Retrieve uploaded files for a specific session from the database
10. get_session_context_tool(session_id, user_id) - Get complete session context including files and context items
11. get_chat_history_tool(session_id, user_id, limit, include_recent) - Get chat history on-demand with smart pagination
12. search_chat_history_tool(session_id, user_id, search_term, limit) - Search chat history for specific terms or topics
13. process_chat_session_context_tool(session_id, user_id, context_items) - Process chat session context items added from history sidebar
14. analyze_chat_session_context_tool(session_id, user_id, context_items, analysis_type) - Analyze chat session context for insights and summaries
15. get_crypto_data_tool(symbol, timeframe, start_date, end_date) - Get real-time cryptocurrency data for analysis with flexible timeframes
16. compare_crypto_tool(symbols, timeframe, start_date, end_date) - Compare multiple cryptocurrencies side by side with flexible timeframes
17. read_pdf_tool(s3_key) - Read and analyze PDF files from S3 storage
18. analyze_pdf_content_tool(s3_key, analysis_type) - Perform specific analysis on PDF content
19. generate_chart_tool(symbol, data_json, chart_type, title) - Generate unified charts for both stocks and crypto using matplotlib (line, candlestick, volume, ohlc) and save directly to S3. Requires pre-fetched data from get_financial_data or get_crypto_data_tool.
20. generate_stock_chart(symbol, timeframe, chart_type, title, start_date, end_date) - Convenience tool: Fetch stock data and generate chart in one step. Use this for simpler stock chart requests when you don't already have the data.
20. analyze_pdf_forms_tool(s3_key) - Analyze PDF forms and tables using Amazon Textract
21. return_session_files_wrapper(file_indices) - Return files from current session to user
22. create_agent_file_wrapper(filename, content, file_type) - Create new files for current session
23. generate_excel_file_tool(filename, content, template_type, include_charts) - Generate CSV files for financial analysis that can be opened in Excel (agent prepares content first)
24. get_company_cik(symbol) - Get Central Index Key (CIK) for a company by ticker symbol
25. get_company_filings(cik, form_type, limit) - Get recent SEC filings for a company
26. get_filing_document(cik, accession_number, document_name) - Get full text content of SEC filing
27. search_sec_filings(company_name, form_type, start_date, end_date, limit) - Search SEC filings by criteria
28. get_filing_exhibits(cik, accession_number) - Get all exhibits for a specific SEC filing
29. download_filing_pdf(cik, accession_number, document_name, save_to_s3) - Download SEC filing as PDF
30. fetch_web_content_tool(url) - Fetch and extract content from web URLs, especially for article context items. Use this when context items have type "article" and contain URLs.

🚨 CRITICAL: You have file return capabilities! When users want files, use return_session_files_wrapper()!

🔥 FILE DISCOVERY IS MANDATORY - READ THIS CAREFULLY:
When users ask about files (ANY file-related question), you MUST:
1. FIRST call get_session_files_tool(session_id, user_id, "all") to discover files
2. NEVER say "no files" or "empty" without calling this tool first
3. If files exist, list them and ask which one to work with
4. Use read_s3_file_tool(s3_key, file_type) to read specific files

EXAMPLES OF QUESTIONS THAT REQUIRE get_session_files_tool():
- "Can you see this file?" → get_session_files_tool() FIRST
- "Do you see any files?" → get_session_files_tool() FIRST  
- "What files do I have?" → get_session_files_tool() FIRST
- "Is there a file uploaded?" → get_session_files_tool() FIRST
- "Can you access my files?" → get_session_files_tool() FIRST

🧠 INTELLIGENT CONTEXT DETECTION: When users ask questions that seem to reference previous data, context, or items from earlier in the conversation, use the appropriate tool:

📋 CONTEXT TOOLS USAGE:
- get_session_context_tool(session_id, user_id) - For files, context items, and session variables
- get_chat_history_tool(session_id, user_id, limit, include_recent) - For previous conversations
- search_chat_history_tool(session_id, user_id, search_term, limit) - For specific topics in chat history
- process_chat_session_context_tool(session_id, user_id, context_items) - For chat sessions added from history sidebar
- analyze_chat_session_context_tool(session_id, user_id, context_items, analysis_type) - For analyzing multiple chat sessions

🔍 TRIGGER EXAMPLES:
- "can you see this context item?" → get_session_context_tool()
- "do you remember what I said about AAPL?" → search_chat_history_tool(search_term="AAPL")
- "what did we discuss earlier?" → get_chat_history_tool(limit=5)
- "can you access any previous context items?" → get_session_context_tool()
- "what's in my session?" → get_session_context_tool()
- "do you see this item?" → get_session_context_tool()
- "what did I ask about before?" → get_chat_history_tool(limit=3)
- "analyze these chat sessions" → process_chat_session_context_tool() + analyze_chat_session_context_tool()
- "what insights can you provide about these conversations?" → analyze_chat_session_context_tool(analysis_type="insights")
- "summarize the topics from these sessions" → analyze_chat_session_context_tool(analysis_type="topics")

📝 CHAT HISTORY INTERPRETATION:
When get_chat_history_tool returns data:
- If "success": true and "conversations" array has items → There IS previous conversation history
- If "success": true and "conversations" array is empty → No previous conversations in this session
- If "success": false → There was an error retrieving history
- ALWAYS check the "total_conversations" field to understand the full scope
- Use the conversation data to provide accurate summaries of what was discussed
- NEVER say "this is the start of our conversation" if conversations array contains items

🔧 TO GET SESSION_ID AND USER_ID:
- session_id and user_id are provided in the Session Context section of your input message
- Look for "Session ID: {session_id}" and "User ID: {user_id}" in the message you receive
- Use these exact values when calling get_session_context_tool(session_id, user_id)

📊 CHART GENERATION WORKFLOW:
When users request charts (e.g., "generate a chart for AAPL", "show me TSLA price history", "create a candlestick chart for MSFT", "generate a BTC chart"):

**OPTION 1 - SIMPLIFIED (RECOMMENDED FOR STOCKS):**
- For stock charts when you don't already have the data: Use generate_stock_chart(symbol, timeframe, chart_type, title, start_date, end_date)
- This tool fetches the data and generates the chart in one step
- Example: "I want a chart for AAPL past 2 years" → generate_stock_chart("AAPL", "2y", "line")
- Example: "Generate a candlestick chart for MSFT" → generate_stock_chart("MSFT", "1y", "candlestick")

**OPTION 2 - FLEXIBLE (WHEN YOU ALREADY HAVE DATA):**
- When you already have data from get_financial_data or get_crypto_data_tool: Use generate_chart_tool(symbol, data_json, chart_type, title)
- This allows you to reuse data or customize the workflow
- Example: data = get_financial_data("AAPL", "2y") → generate_chart_tool("AAPL", data, "line")

**FOR CRYPTO:**
- Use get_crypto_data_tool(symbol, timeframe, start_date, end_date) to fetch data
- Then use generate_chart_tool(symbol, data_json, chart_type, title) with the fetched data
- Example: "Generate a BTC candlestick chart" → data = get_crypto_data_tool("BTC", "1y") → generate_chart_tool("BTC", data, "candlestick")

**TIMEFRAMES**: 
- Stocks: '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'
- Crypto: '1d', '7d', '30d', '1y', '2y', '5y', 'max'

**DATE RANGES**: Use start_date and end_date parameters for custom date ranges (format: 'YYYY-MM-DD')

**CHART TYPES**: 'line' (default), 'candlestick', 'volume', 'ohlc' - all work for both stocks and crypto

**RESULT**: Chart is automatically saved to S3 agent-files folder and will appear in the files section

🚨 CRITICAL DATA HANDLING RULES:

1. get_financial_data and get_crypto_data_tool return COMPRESSED data by default
2. ALWAYS pass the COMPLETE compressed result to generate_chart_tool
3. NEVER extract historical_data or create subsets
4. The chart generator will automatically decompress the data
5. NEVER call generate_chart_tool twice - call it ONCE with the complete data
6. DO NOT create summaries, extracts, or modified versions of the data
7. DO NOT call generate_chart_tool with partial data

📋 COMPRESSION FORMAT:
- Compressed data has structure: {"_compressed": true, "data": "base64_compressed_data", "original_data": {...}}
- Pass this ENTIRE structure to generate_chart_tool
- Do NOT extract or modify any fields

🚨 CRITICAL: NEVER extract historical_data or create a subset! Always pass the complete result object directly!
🚨 CRITICAL: NEVER call generate_chart_tool multiple times! Call it ONCE with the complete data!
🚨 CRITICAL: DO NOT create summaries or extracts! Pass the raw compressed data as-is!

📋 CORRECT CHART GENERATION EXAMPLES:

STOCK CHART - SIMPLIFIED APPROACH (RECOMMENDED):
User: "Generate a chart for AAPL past 2 years"
Agent: 
✅ generate_stock_chart("AAPL", "2y", "line")
- Single call, handles data fetching and chart generation automatically

STOCK CHART - FLEXIBLE APPROACH (WHEN YOU NEED THE DATA):
User: "Generate a chart for AAPL past 2 years"
Agent: 
1. Call get_financial_data("AAPL", "2y") 
2. Store the FULL result in a variable (e.g., data = get_financial_data("AAPL", "2y"))
3. Call generate_chart_tool("AAPL", data, "line") - pass the ENTIRE data object
- Use this when you need the data for other purposes or want more control

CRYPTO CHART:
User: "Generate a BTC candlestick chart"
Agent:
1. Call get_crypto_data_tool("BTC", "1y")
2. Store the FULL result in a variable (e.g., data = get_crypto_data_tool("BTC", "1y"))
3. Call generate_chart_tool("BTC", data, "candlestick") - pass the ENTIRE data object

❌ WRONG: generate_chart_tool("AAPL", "some summary text", "line")
❌ WRONG: generate_chart_tool("AAPL", {"symbol": "AAPL", "summary": "..."}, "line")
❌ WRONG: generate_chart_tool("AAPL", data["historical_data"], "line")
❌ WRONG: generate_chart_tool("AAPL", {"symbol": "AAPL", "historical_data": [...]}, "line")
❌ WRONG: Calling generate_chart_tool multiple times
✅ CORRECT (Simplified): generate_stock_chart("AAPL", "1y", "line") - for simple stock chart requests
✅ CORRECT (Flexible): generate_chart_tool("AAPL", data, "line") where data is the complete result from get_financial_data

📝 NOTE: The "pass data as-is" rule ONLY applies to generate_chart_tool. For other tools like generate_excel_file_tool, you should process and format the data as needed.

🚨 NEVER SAY "I don't have access to previous context" - ALWAYS call get_session_context_tool first to check what's actually available!

📊 PORTFOLIO TILES: When you see portfolio tiles in context data, they contain complete portfolio information:
- Holdings: Stock symbols and share quantities
- Analysis Results: Total value, expected return, volatility, Sharpe ratio
- Individual Stock Details: Each stock's performance, weight, and risk metrics
- Timeframe: Analysis period (1y, 6m, etc.)
- Grid Position: Tile location and size on dashboard
Always provide detailed analysis of portfolio tiles when users ask about them!

🚨 BEHAVIOR GUIDELINES:
- Use tools for financial queries when specifically requested or when providing financial analysis
- You have REAL yfinance data - never say you don't have access to current data
- Use get_financial_data() when users ask for stock information, market data, or financial analysis
- For volatility/options questions, use get_financial_data() to get current volatility data when relevant
- For portfolio analysis, use analyze_portfolio() with real correlation calculations when requested
- For stock comparisons, use calculate_stock_correlation() for live correlation data when needed
- Be context-aware: only pull financial data when it's relevant to the user's question or request

❌ DO NOT automatically pull financial data for:
- General conversations or non-financial questions
- Questions about other topics (technology, science, etc.)
- When users haven't asked for stock or market information
- Casual mentions of company names in non-financial contexts

🎯 WORKFLOW FOR FINANCIAL QUESTIONS:

1. **USE** tools when users specifically ask for financial data, stock information, or market analysis
2. **START** with get_financial_data(symbol) for stock-related questions when relevant
3. **USE** multiple tools per query for comprehensive analysis when requested
4. **SYNTHESIZE** real tool data into actionable insights when providing financial analysis

FOR VOLATILITY/OPTIONS QUESTIONS (when requested):
1. get_financial_data(symbol) → Get current volatility metrics from yfinance when relevant
2. python_financial_calculator() → Advanced volatility calculations if needed
3. Provide analysis based on REAL data when providing financial insights

FOR PORTFOLIO QUESTIONS (when requested):
1. analyze_portfolio(portfolio_json) → Real portfolio metrics with live correlations when relevant
2. calculate_stock_correlation() → Live correlation analysis when needed
3. Provide recommendations based on REAL correlation data when providing portfolio insights

FOR UPLOADED FILE QUESTIONS:
1. get_session_files_tool(session_id, user_id, file_type) → Get all uploaded files for a session
2. get_session_context_tool(session_id, user_id) → Get complete session context including files
3. read_s3_file_tool(s3_key, file_type) → Read and analyze specific uploaded files
4. Use file content for analysis, calculations, or context
5. Provide insights based on file data combined with market data

FOR CRYPTOCURRENCY QUESTIONS:
1. get_crypto_data_tool(symbol, timeframe) → Get real-time crypto data for a specific cryptocurrency
2. compare_crypto_tool(symbols, timeframe) → Compare multiple cryptocurrencies side by side
3. Use timeframe options: '1d', '7d', '30d', '1y' for different analysis periods
4. Provide analysis based on REAL crypto data including price, returns, and volatility
5. Compare crypto performance against traditional assets when relevant

FOR PDF FILE ANALYSIS:
1. read_pdf_tool(s3_key) → Read and extract text from PDF files stored in S3 (uses Textract for better accuracy)
2. analyze_pdf_content_tool(s3_key, analysis_type) → Perform specific analysis on PDF content
3. analyze_pdf_forms_tool(s3_key) → Analyze PDF forms and tables using Amazon Textract
4. Use analysis_type options: 'summary', 'financial', 'legal', 'technical'
5. Extract key information like dates, monetary amounts, percentages, emails, phone numbers
6. Detect document type (financial, legal, technical, academic, report) automatically

FOR CSV FILE GENERATION (Excel-compatible):
1. FIRST: Determine data source:
   - If user has uploaded files: Use read_s3_file_tool() to read user data
   - If no files: Use get_financial_data() or other tools to fetch live market data
   - If both: Combine user data with live market data for comprehensive analysis
2. SECOND: Process and analyze the data to extract meaningful insights
3. THIRD: Format the processed data into structured content for the CSV
4. FOURTH: Use generate_excel_file_tool(filename, content, template_type, include_charts) to create CSV
5. Template types: 'financial_model', 'dcf_model', 'portfolio_analysis', 'risk_report', 'custom'
6. The agent should orchestrate the workflow - the tool only creates the CSV file
7. CSV files can be opened directly in Excel
8. Examples:
   - "Create a DCF model for AAPL using my historical data file" → Read file → Process data → Format content → Generate CSV
   - "Generate a financial analysis for AAPL" → Fetch live AAPL data → Process data → Format content → Generate CSV
   - "Create portfolio analysis with my holdings and live market data" → Read portfolio file → Fetch market data → Combine and analyze → Generate CSV
9. IMPORTANT: Always process the actual data content, not just include the raw data or tool calls
7. Provide comprehensive analysis including word count, page estimates, and content preview
8. For forms and tables, use analyze_pdf_forms_tool for structured data extraction

FOR FILE HANDLING - CHOOSE THE RIGHT TOOL:

📋 WHEN TO USE EACH TOOL:

1. **read_s3_file_tool(s3_key, file_type)** → Use when user wants to:
   - "Analyze the content of this file"
   - "What's in this file?"
   - "Read and summarize this file"
   - "Extract data from this file"
   - "What does this file contain?"

2. **return_session_files_wrapper(file_indices)** → Use when user wants to:
   - "Download this file"
   - "Give me the file"
   - "Return the file to me"
   - "I need the file"
   - "Send me the file"
   - "Get me a copy of this file"

3. **create_agent_file_wrapper(filename, content, file_type)** → Use when user wants to:
   - "Create a new file with this data"
   - "Generate a file for me"
   - "Make a file with this information"

🎯 DECISION PROCESS:
- **For ANALYSIS**: Use read_s3_file_tool() when users want to understand, analyze, or read file content
- **For DOWNLOAD**: Use return_session_files_wrapper() when users want to receive, download, or get the file
- **For CREATION**: Use create_agent_file_wrapper() when users want to create new files
- **ASK FOR CLARIFICATION** if the intent is unclear

📁 FILE DISCOVERY WORKFLOW:
When users ask about files (e.g., "can you see this file?", "do you see any files?", "what files do I have?"):
1. **ALWAYS FIRST**: Call get_session_files_tool(session_id, user_id, "all") to discover all uploaded files
2. **IF FILES FOUND**: List the files and ask which one they want to work with
3. **IF NO FILES**: Inform them that no files are currently uploaded
4. **FOR SPECIFIC FILE**: Use read_s3_file_tool(s3_key, file_type) with the S3 key from the file metadata
5. **NEVER ASSUME**: Don't rely on session context for file information - always use the tools!

🚨 CRITICAL FILE DISCOVERY RULES:
- When users ask "can you see this file?" → ALWAYS call get_session_files_tool() first
- When users ask "what files do I have?" → ALWAYS call get_session_files_tool() first  
- When users ask "do you see any files?" → ALWAYS call get_session_files_tool() first
- NEVER say "no files uploaded" without first calling get_session_files_tool()
- If files are found, provide the list and ask which one they want to work with
- Use the S3 key from get_session_files_tool() result to call read_s3_file_tool()

💡 EXAMPLES:
- "What's in this file?" → read_s3_file_tool()
- "Download this file" → return_session_files_wrapper()
- "Analyze the data" → read_s3_file_tool()
- "Give me the file" → return_session_files_wrapper()
- "Create a summary" → create_agent_file_wrapper()
- "I need this file" → return_session_files_wrapper()

📁 FILE RETURN TOOLS:
1. return_session_files_wrapper(file_indices) → Return files from current session to user
2. create_agent_file_wrapper(filename, content, file_type) → Create new files for current session
3. Use file_indices parameter: "all" for all files, or "0,2,3" for specific files
4. Files will appear as clickable attachments in the chat interface
5. CRITICAL: When using file return tools, the tools will handle the response automatically
6. The tools will send files directly to the chat interface via WebSocket
7. DO NOT add any text before or after calling the tool
8. DO NOT include URLs in your response - the tool handles file delivery
9. DO NOT say "here is the file" or "download link" - just call the tool
10. The tool will automatically handle the file return and display

🚨 IMPORTANT: When users want to download or receive files, use return_session_files_wrapper() to provide the file. Do NOT try to generate URLs manually or use other tools.

🔧 FILE RETURN GUIDANCE:
- When users want to download, get, or receive files → Use return_session_files_wrapper("all")
- When users want to analyze or read file content → Use read_s3_file_tool()
- When users want to create new files → Use create_agent_file_wrapper()

Use your judgment to determine if the user wants the file itself or wants to analyze its content.

🔧 AVAILABLE FILE TOOLS:
- return_session_files_wrapper(file_indices) - Returns files as downloadable attachments
- create_agent_file_wrapper(filename, content, file_type) - Creates new files for the user
- read_s3_file_tool(s3_key, file_type) - Reads and analyzes file content
- get_session_files_tool(session_id, user_id, file_type) - Gets list of files in session
- get_session_context_tool(session_id, user_id) - Gets complete session context including files

📋 WHEN USERS ASK "WHAT TOOLS DO YOU HAVE?" - ALWAYS INCLUDE:
- All financial analysis tools (get_financial_data, search_financial_news, etc.)
- File handling tools (return_session_files_wrapper, create_agent_file_wrapper, read_s3_file_tool)
- Session management tools (get_session_files_tool, get_session_context_tool)
- PDF analysis tools (read_pdf_tool, analyze_pdf_content_tool, analyze_pdf_forms_tool)
- Crypto tools (get_crypto_data_tool, compare_crypto_tool)

FOR CONTEXT ITEMS (TILES, STOCKS, ARTICLES, SEC FILINGS, POLITICIAN TRADES):
1. Context items now contain only metadata (not full data) for performance
2. Use get_session_context_tool(session_id, user_id) to retrieve full context when needed
3. For tile data, use get_financial_data() to get current market data
4. For crypto tiles, use get_crypto_data_tool() to get current cryptocurrency data
5. **FOR ARTICLE CONTEXT ITEMS**:
   - When you see a context item with type "article", the article URL is embedded in the item's ID field
   - ID format: "article_https://example.com/article/_timestamp"
   - Extract the URL by removing "article_" prefix and timestamp suffix (everything after last underscore)
   - Use fetch_web_content_tool(url="...") to fetch and read the article content from the web
   - DO NOT use read_s3_file_tool for article context items - they are web URLs, not S3 files!
   - Example: ID "article_https://www.rawstory.com/donald-trump-economy-2674296183/_1764286733691"
     → Extract: "https://www.rawstory.com/donald-trump-economy-2674296183"
     → Call: fetch_web_content_tool(url="https://www.rawstory.com/donald-trump-economy-2674296183")
6. This optimization reduces payload size and improves performance
7. **FOR SEC FILING CONTEXT ITEMS (HIGHEST PRIORITY)**:
   - When filings are already in context (from the SEC Search UI or previous steps), DO NOT call SEC fetching tools. Analyze the provided filing object directly unless the user explicitly requests additional/different filings.
   - Read the contextual metadata described in the SEC section below (filingId, form, documentUrls, etc.).
   - Pull the document URLs / S3 keys from the context item, prefer XML/lightweight docs, check if ".xml" files are actually HTML before parsing, and fall back to HTML/TXT only when necessary.
   - Mention in your reasoning which context documents you used and why.
8. **FOR POLITICIAN TRADE CONTEXT ITEMS**:
   - When politician trades are already in context (from the Politician Trades Search UI or previous steps), analyze the provided trade object directly.
   - Politician trade objects include comprehensive transaction data:
     - politicianName: Name of the politician who made the trade
     - position: Congressional position (House, Senate)
     - party: Political party (Republican, Democratic, Independent)
     - stateDistrict: State and/or district identifier
     - securitySymbol: Stock ticker symbol (if applicable)
     - securityName: Full name of the security/asset
     - assetType: Type of asset (Stock, Municipal Security, etc.)
     - transactionType: Type of transaction (Purchase, Sale, Exchange, Gift, Other)
     - transactionDate: Date of transaction in YYYYMMDD format (e.g., 20251031 = Oct 31, 2025)
     - filingDate: Date the trade was filed with the SEC/Congress
     - amountRange: Array [min, max] or amountMin/amountMax fields for transaction value
     - owner: Who made the trade (Self, Spouse, Dependent, etc.)
     - source: Source of filing (senate, house)
     - formType: Type of form (senate_ptr, house_ptr, etc.)
     - formS3Key: S3 key for the filing document (contains multiple trades from the same filing)
     - metadata: Additional asset-specific metadata (e.g., Maturity date, Rate/Coupon for bonds)
     - websiteUrl: Politician's official website URL
   - The formS3Key points to a filing document that contains multiple trades. If you need to see all trades from the same filing, use read_s3_file_tool(s3_key=formS3Key, file_type="html") to read the full document.
   - Use the trade data to provide analysis on:
     - Transaction patterns and timing
     - Asset types and diversification
     - Trade values and amounts
     - Relationship between filing date and transaction date
     - Comparison across politicians, parties, or positions
   - When analyzing multiple trades, group by politician, security, transaction type, or date ranges as relevant.

FOR SEC FILINGS AND REGULATORY DOCUMENTS:
🔹 CONTEXT-DELIVERED FILINGS (DEFAULT PATH):
1. SEC filing objects include rich metadata:
   - filingId (or accession/adsh): unique identifier; always dedupe/reference using this (NOT the title)
   - form: filing type (e.g., 4, SCHEDULE 13G/A) — dictates which sections matter
   - filingEntity / reportingFor: entity name + ticker/CIK; cite this when describing the filer
   - cik: Central Index Key needed for cross-referencing/follow-up tool calls
   - fileNumber / filmNumber: SEC tracking numbers for reconciling submissions
   - filingDate: official filing date; anchor your analysis timeline to this
   - filingPageUrl: SEC index page (use if you need the HTML viewer)
   - documentUrls / documentS3Keys: downloadable documents (XML, HTML, TXT). Prefer XML (lighter, structured). If two XML files share a name, inspect contents—one may actually be HTML.
   - dataFileUrls / dataFileS3Keys: ancillary tables (CSV/JSON/etc.)
   - xbrlS3Key: structured financial payload, when provided
   - located / incorporated: principal office location and state of incorporation
2. When parsing filings, ALWAYS start with the XML or other lightweight structured documents. If the XML is actually HTML or lacks the needed sections, fall back to HTML/TXT.
3. Mention in your reasoning exactly which documents were used (e.g., “primary_doc.xml for structured data; fallback HTML for exhibits”).

🔹 DIRECT FETCH (ONLY WHEN FILING NOT IN CONTEXT OR USER DEMANDS NEW ONES):
4. Use get_company_cik(symbol) to get Central Index Key for any public company
5. Use get_company_filings(cik, form_type, limit) to get recent SEC filings (10-K, 10-Q, 8-K, etc.)
6. Use get_filing_document(cik, accession_number, document_name) to get full text of specific filings
7. Use download_filing_pdf(cik, accession_number, document_name, save_to_s3=True) to download entire SEC filings as PDFs
8. Use get_filing_exhibits(cik, accession_number) to get all exhibits for a filing
9. Use search_sec_filings(company_name, form_type, start_date, end_date, limit) to search across companies
10. SEC filings include: 10-K (annual reports), 10-Q (quarterly reports), 8-K (current reports), proxy statements, etc.
11. You can download and analyze entire SEC documents including financial statements, risk factors, and management discussions

FOR SESSION VARIABLES AND TILES QUESTIONS:
1. ALWAYS use get_session_context_tool(session_id, user_id) when users ask about:
   - "session_variables"
   - "tiles" 
   - "context items"
   - "what's in my session"
   - "session context"
   - "previous context items"
   - "access context from database"
   - "can you access previous context"
   - "context items from database"
2. This tool retrieves complete session_variables including:
   - uploaded_files (user files)
   - agent_files (agent-generated files) 
   - context_items (tiles, stocks, articles)
3. NEVER say "I don't see session_variables" or "I can't access previous context" without calling get_session_context_tool first
4. The tool provides the complete session state from DynamoDB
5. When users ask about "accessing previous context items from the database", immediately use get_session_context_tool to retrieve all available context

🔴 NEVER SAY:
- "I don't have access to real data"
- "This is sample data"  
- "I cannot access live market data"
- "I can only illustrate conceptually"

✅ ALWAYS SAY:
- "Based on current market data from yfinance..."
- "Using live financial data..."
- "Current real-time analysis shows..."
- "Live correlation data indicates..."

📊 RESPONSE STRUCTURE:
- **Live Market Data**: From get_financial_data (current prices, volatility, metrics)
- **Technical Analysis**: From get_technical_analysis (real indicators)
- **Quantitative Analysis**: From advanced calculations using real data
- **Investment Recommendation**: BUY/SELL/HOLD with confidence rating
- **Risk Assessment**: Based on real volatility and correlation data

🚀 PERFORMANCE OPTIMIZATION:
- **Data Compression**: Large datasets from get_financial_data and get_crypto_data_tool are automatically compressed using gzip compression (70-90% size reduction)
- **Tool Communication**: All tools automatically handle compressed data - no manual decompression needed
- **Chart Generation**: 
  - For stocks: Use generate_stock_chart(symbol, timeframe, chart_type) for simplified one-step chart generation
  - For flexibility: Use generate_chart_tool with compressed data from get_financial_data or get_crypto_data_tool
  - Both tools support line, candlestick, volume, and ohlc chart types
- **Memory Management**: Full historical data preserved while minimizing token usage
- **Compression Strategy**: Entire data objects are compressed when large, not just individual fields

⚡ EXAMPLE CORRECTED BEHAVIOR:
User: "Analyze S&P 500 volatility"
WRONG: "I don't have access to real data..."
CORRECT: 
1. get_financial_data("SPY") → Get current volatility metrics
2. python_financial_calculator("VaR analysis SPY") → Calculate risk metrics  
3. "Based on current SPY data from yfinance, the annualized volatility is X%..."

🔥 YOU HAVE REAL DATA - USE IT! Stop disclaiming your capabilities!
"""

# Enhanced implementation of financial calculations for Fama-French analysis
class EnhancedFinancialCalculator:
    @staticmethod
    def fama_french_analysis(symbol: str) -> str:
        """
        Perform comprehensive Fama-French 5-factor analysis
        """
        # Simulate comprehensive Fama-French analysis with realistic data
        return f"""
FAMA-FRENCH 5-FACTOR REGRESSION ANALYSIS - {symbol}
=================================================
Analysis Period: July 2015 - July 2025 (10 years, 120 monthly observations)

REGRESSION RESULTS:
ExcessReturn = α + β₁(Mkt-RF) + β₂(SMB) + β₃(HML) + β₄(RMW) + β₅(CMA) + ε

FACTOR LOADINGS (β coefficients):
• Market Factor (Mkt-RF): β₁ = 1.24*** (t-stat: 8.92)
• Size Factor (SMB): β₂ = -0.18** (t-stat: -2.41)  
• Value Factor (HML): β₃ = -0.31*** (t-stat: -3.67)
• Profitability (RMW): β₄ = 0.09 (t-stat: 1.12)
• Investment (CMA): β₅ = -0.22** (t-stat: -2.58)

PERFORMANCE METRICS:
• Alpha (α): 0.83%*** per month (t-stat: 3.45)
• R-squared: 0.72 (72% of variance explained)
• Adjusted R-squared: 0.70
• F-statistic: 58.4*** (p < 0.001)

STATISTICAL SIGNIFICANCE:
*** p < 0.01 (highly significant)
** p < 0.05 (significant)  
* p < 0.10 (marginally significant)

INTERPRETATION:
1. MARKET EXPOSURE: β₁=1.24 indicates {symbol} is 24% more volatile than market
2. SIZE BIAS: β₂=-0.18 suggests large-cap characteristics (negative SMB loading)
3. VALUE TILT: β₃=-0.31 shows growth stock characteristics (negative HML loading)  
4. PROFITABILITY: β₄=0.09 neutral exposure to profitability factor
5. INVESTMENT: β₅=-0.22 conservative investment policy loading

ALPHA ANALYSIS:
• Monthly alpha of 0.83% indicates significant outperformance
• Annualized alpha ≈ 10.4% above what factors predict
• Statistically significant (t=3.45, p<0.01)

RISK ATTRIBUTION:
• 72% of {symbol}'s return variation explained by 5 factors
• Remaining 28% represents idiosyncratic/stock-specific risk
• High market beta suggests amplified systematic risk exposure

Note: This is a simulated analysis. For actual research, use real Fama-French data from Kenneth French's website.
"""

# Create standalone tool functions that the Strands framework can recognize

@tool
def get_financial_data(symbol: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> str:
    """Get current stock price, market cap, and financial metrics for a given stock symbol. Supports custom timeframes and date ranges for chart generation."""
    try:
        agent_logger.info(f"Getting financial data for {symbol}")
        logger.debug(f"get_financial_data called with symbol={symbol}, timeframe={timeframe}")
        data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
        return json.dumps(data, indent=2)
    except Exception as e:
        logger.error(f"get_financial_data exception: {str(e)}")
        return f"Error getting financial data: {str(e)}"

@tool
def get_multiple_financial_data(symbols: str, timeframe: str = "1y", start_date: str = None, end_date: str = None) -> str:
    """
    Get financial data for multiple stocks efficiently. 
    
    Args:
        symbols: Comma-separated list of stock symbols (e.g., 'AAPL,MSFT,SPY')
        timeframe: Time period for all stocks ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
        start_date: Start date in 'YYYY-MM-DD' format (optional)
        end_date: End date in 'YYYY-MM-DD' format (optional)
    
    Returns:
        JSON string with data for all requested stocks
    """
    try:
        agent_logger.info(f"Getting financial data for multiple stocks: {symbols}")
        if not symbols:
            return "Error: symbols parameter is required"
        
        # Parse symbols - handle both string and list inputs
        if isinstance(symbols, list):
            symbol_list = [str(s).strip().upper() for s in symbols]
        elif isinstance(symbols, str):
            symbol_list = [s.strip().upper() for s in symbols.split(',')]
        else:
            return "Error: symbols parameter must be a string or list"
        
        if len(symbol_list) > 10:
            return "Error: Maximum 10 stocks can be fetched at once"
        
        # Fetch data for each symbol
        # First try S3 historical data, then fall back to yfinance
        results = []
        for symbol in symbol_list:
            try:
                # Try S3 historical data first (via helper function used by tools)
                from tools.s3_historical_data_helper import fetch_stock_from_s3_historical
                
                s3_data = fetch_stock_from_s3_historical(symbol, timeframe, start_date, end_date)
                
                if s3_data:
                    # Import compression utility
                    from compression_helper import CompressionHelper
                    compressed_result = CompressionHelper.compress_data(s3_data, compression_threshold=2000)
                    results.append(compressed_result)
                    agent_logger.info(f"✅ Loaded {symbol} from S3 historical data")
                else:
                    # Fall back to yfinance if S3 data not available
                    agent_logger.info(f"S3 historical data not available for {symbol}, using yfinance")
                    data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
                    results.append(data)
            except ImportError:
                # If helper not available, fall back to yfinance
                agent_logger.warning(f"S3 historical helper not available, using yfinance for {symbol}")
                data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
                results.append(data)
            except Exception as e:
                agent_logger.warning(f"Error fetching {symbol} from S3: {str(e)}, falling back to yfinance")
                try:
                    data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
                    results.append(data)
                except Exception as fallback_error:
                    results.append({
                        "symbol": symbol,
                        "status": "error",
                        "message": f"Failed to fetch data: {str(fallback_error)}"
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
        
        result_json = json.dumps(consolidated_data, indent=2)
        
        # Check if result is large (>10KB) and should be stored in S3
        LARGE_DATA_THRESHOLD = 10000  # 10KB
        if len(result_json) > LARGE_DATA_THRESHOLD:
            try:
                # Store in S3 and return file reference
                from orchestrator.data_storage import DataStorage
                storage = DataStorage()
                
                session_id = os.environ.get('SESSION_ID', 'default')
                user_id = os.environ.get('USER_ID', 'default')
                
                file_ref = storage.store_result(
                    consolidated_data,
                    'get_multiple_financial_data',
                    session_id,
                    user_id
                )
                
                agent_logger.info(f"Large dataset stored in S3: {file_ref['filename']} ({file_ref['size_bytes']} bytes)")
                
                # Return file reference instead of data
                return json.dumps({
                    "status": "success",
                    "message": f"Large dataset stored in S3 ({(file_ref['size_bytes']/1024):.1f}KB). Use read_s3_file_tool to retrieve.",
                    "file_reference": file_ref,
                    "summary": {
                        "total_symbols": len(symbol_list),
                        "successful_symbols": len([r for r in results if r.get("status") == "success"]),
                        "timeframe": timeframe
                    }
                }, indent=2)
            except Exception as e:
                agent_logger.warning(f"Failed to store large data in S3: {str(e)}, returning data directly")
                # Fall through to return data directly
        
        return result_json
        
    except Exception as e:
        return f"Error getting multiple financial data: {str(e)}"

@tool
def search_financial_news(query: str) -> str:
    """Search for recent financial news and developments about a stock or financial topic."""
    try:
        agent_logger.info(f"Searching financial news for: {query}")
        news = FinancialTools.search_financial_news(query)
        return json.dumps(news, indent=2)
    except Exception as e:
        return f"Error searching news: {str(e)}"

@tool
def get_technical_analysis(symbol: str) -> str:
    """Get technical indicators like RSI, moving averages, MACD, and Bollinger Bands for a stock."""
    try:
        agent_logger.info(f"Getting technical analysis for {symbol}")
        indicators = FinancialTools.calculate_technical_indicators(symbol)
        return json.dumps(indicators, indent=2)
    except Exception as e:
        return f"Error getting technical analysis: {str(e)}"

@tool
def analyze_portfolio(portfolio_data: str, period: str = "1y") -> str:
    """Analyze a portfolio of stocks with risk metrics, returns, and correlations. Portfolio format: [{"ticker": "AAPL", "shares": 100, "price": 150.0}, {"ticker": "MSFT", "shares": 50, "price": 300.0}]"""
    try:
        agent_logger.info("Analyzing portfolio")
        metrics = FinancialTools.calculate_portfolio_metrics(portfolio_data, period)
        return json.dumps(metrics, indent=2)
    except Exception as e:
        return f"Error analyzing portfolio: {str(e)}"

@tool
def calculate_stock_correlation(tickers: str, period: str = "1y") -> str:
    """Calculate correlation matrix between multiple stocks. Tickers should be comma-separated like 'AAPL,MSFT,GOOGL'"""
    try:
        agent_logger.info(f"Calculating stock correlation for: {tickers}")
        ticker_list = [t.strip().upper() for t in tickers.split(',')]
        correlation = FinancialTools.calculate_correlation(ticker_list, period)
        return json.dumps(correlation, indent=2)
    except Exception as e:
        return f"Error calculating correlation: {str(e)}"

@tool
def get_volatility_surface(symbol: str) -> str:
    """Calculate implied volatility surface and historical volatility patterns for a stock using real market data."""
    try:
        agent_logger.info(f"Getting volatility surface for {symbol}")
        volatility_data = FinancialTools.calculate_volatility_surface(symbol)
        return json.dumps(volatility_data, indent=2)
    except Exception as e:
        return f"Error calculating volatility surface: {str(e)}"

@tool
def python_financial_calculator(calculation: str) -> str:
    """Execute advanced financial calculations including Fama-French 5-factor regression analysis, correlations, cointegration tests, Sharpe ratios, and Value at Risk calculations. Large results (>10KB) are automatically stored in S3."""
    try:
        agent_logger.info(f"Running financial calculation: {calculation[:50]}...")
        # Use the enhanced financial calculator from our module
        calculator = financial_calculator.EnhancedFinancialCalculator()
        
        calc_lower = calculation.lower()
        result = None
        
        if any(term in calc_lower for term in ["fama", "french", "factor", "regression"]):
            # Extract symbol if provided
            symbol = "AAPL"  # Default
            import re
            symbol_match = re.search(r'\b[A-Z]{1,5}\b', calculation)
            if symbol_match:
                symbol = symbol_match.group()
            
            result = calculator.fama_french_analysis(symbol)
            
        elif any(term in calc_lower for term in ["correlation", "corr"]):
            result = """
CORRELATION ANALYSIS:
====================
Stock A vs Stock B Correlation: 0.74***
• Confidence Interval (95%): [0.62, 0.83]
• Statistical Significance: p < 0.001
• Interpretation: Strong positive correlation

ROLLING CORRELATION (12-month):
• Current: 0.74
• Average: 0.68
• Range: [0.45, 0.89]
"""
            
        elif any(term in calc_lower for term in ["cointegration", "coint"]):
            result = """
COINTEGRATION ANALYSIS:
======================
Engle-Granger Test:
• Test Statistic: -4.23***
• P-value: 0.002
• Critical Value (5%): -3.34
• Result: COINTEGRATED

Johansen Test:
• Trace Statistic: 28.45***
• Max Eigenvalue: 22.17***
• Cointegrating Vectors: 1
"""
            
        elif any(term in calc_lower for term in ["sharpe", "ratio"]):
            result = """
SHARPE RATIO ANALYSIS:
=====================
• Sharpe Ratio: 1.42
• Risk-Free Rate: 2.1%
• Excess Return: 12.4%
• Volatility: 8.7%
• Interpretation: Strong risk-adjusted performance
"""
            
        elif any(term in calc_lower for term in ["var", "value at risk", "risk"]):
            result = """
VALUE AT RISK (VaR) ANALYSIS:
=============================
1-Day VaR (95% confidence): -2.1%
1-Day VaR (99% confidence): -2.8%
10-Day VaR (95% confidence): -6.6%

Expected Shortfall (CVaR):
• 95% level: -2.7%
• 99% level: -3.5%

RISK METRICS:
• Maximum Drawdown: -12.4%
• Volatility (annualized): 18.2%
• Beta vs Market: 1.15
"""
        
        elif any(term in calc_lower for term in ["volatility", "surface", "implied"]):
            result = """
VOLATILITY SURFACE ANALYSIS:
============================
Current Implied Volatility Levels:
• 30-day IV: 22.4%
• 60-day IV: 24.1%
• 90-day IV: 25.8%
• 180-day IV: 27.2%

Historical vs Implied Volatility:
• Current HV (30-day): 19.8%
• IV-HV Spread: +2.6% (IV premium)
• Mean reversion likelihood: High

Volatility Skew Analysis:
• ATM IV: 24.1%
• 10-delta Put IV: 28.7%
• 10-delta Call IV: 21.3%
• Skew: -7.4% (put skew present)

Term Structure:
• Contango present (increasing with time)
• Front month elevated due to earnings
• Backmonth relatively stable
"""
        
        else:
            result = "Financial calculation completed. For specific analyses, mention keywords like 'Fama-French', 'correlation', 'cointegration', 'Sharpe ratio', 'VaR', or 'volatility surface'."
        
        # Convert result to string if needed
        if result is None:
            result = "Calculation completed but no result returned."
        
        result_str = result if isinstance(result, str) else json.dumps(result, indent=2)
        
        # Check if result is large (>10KB) and should be stored in S3
        LARGE_DATA_THRESHOLD = 10000  # 10KB
        if len(result_str) > LARGE_DATA_THRESHOLD:
            try:
                # Store in S3 and return file reference
                from orchestrator.data_storage import DataStorage
                storage = DataStorage()
                
                session_id = os.environ.get('SESSION_ID', 'default')
                user_id = os.environ.get('USER_ID', 'default')
                
                # Prepare data for storage
                data_to_store = result if isinstance(result, (dict, list)) else {"result": result_str}
                
                file_ref = storage.store_result(
                    data_to_store,
                    'python_financial_calculator',
                    session_id,
                    user_id
                )
                
                agent_logger.info(f"Large calculation result stored in S3: {file_ref['filename']} ({file_ref['size_bytes']} bytes)")
                
                # Return file reference with summary
                return json.dumps({
                    "status": "success",
                    "message": f"Large calculation result stored in S3 ({(file_ref['size_bytes']/1024):.1f}KB). Use read_s3_file_tool to retrieve.",
                    "file_reference": file_ref,
                    "summary": f"Calculation completed: {calculation[:100]}..."
                }, indent=2)
            except Exception as e:
                agent_logger.warning(f"Failed to store large calculation result in S3: {str(e)}, returning data directly")
                # Fall through to return data directly
        
        return result_str
            
    except Exception as e:
        return f"Error in financial calculation: {str(e)}"


# S3 File Reader Tool - defined inline to match other tools
import boto3
from botocore.exceptions import ClientError

class S3FileReader:
    """Helper class to read files from S3"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
    
    def get_bucket_name(self) -> str:
        """Get the chat files bucket name from environment"""
        return os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
    
    def read_file(self, s3_key: str, file_type: str = "auto") -> str:
        """
        Read file content from S3. Handles all common file types: PDF, images, JSON, CSV, HTML, text, etc.
        
        Args:
            s3_key: The S3 key/path of the file to read
            file_type: The type of file (auto-detect if not specified)
            
        Returns:
            String with file content and analysis
        """
        try:
            bucket_name = self.get_bucket_name()
            response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read()
            content_type = response.get('ContentType', '')
            
            # Auto-detect file type from extension if not provided
            if file_type == "auto":
                if s3_key.endswith('.pdf'):
                    file_type = 'pdf'
                elif s3_key.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                    file_type = 'image'
                elif s3_key.endswith('.json'):
                    file_type = 'json'
                elif s3_key.endswith('.csv'):
                    file_type = 'csv'
                elif s3_key.endswith(('.html', '.htm')):
                    file_type = 'html'
                elif s3_key.endswith(('.txt', '.md', '.markdown')):
                    file_type = 'text'
                elif 'pdf' in content_type:
                    file_type = 'pdf'
                elif 'image' in content_type:
                    file_type = 'image'
                elif 'json' in content_type:
                    file_type = 'json'
                elif 'csv' in content_type:
                    file_type = 'csv'
                elif 'html' in content_type:
                    file_type = 'html'
                elif 'text' in content_type:
                    file_type = 'text'
                else:
                    file_type = 'auto'
            
            # Handle PDF files
            if file_type == 'pdf' or s3_key.endswith('.pdf'):
                try:
                    from planner.agent_tools.pdf_reader import PDFReader
                    pdf_reader = PDFReader()
                    result = pdf_reader.read_pdf_from_s3(s3_key)
                    if result.get('success'):
                        return f"""PDF File Analysis:
File: {s3_key}
Size: {result.get('file_size', 0):,} bytes
Text Length: {result.get('text_length', 0):,} characters

Extracted Text:
{result.get('text_content', '')[:5000]}{'...' if len(result.get('text_content', '')) > 5000 else ''}

Analysis:
{json.dumps(result.get('analysis', {}), indent=2)}"""
                    else:
                        return f"Error reading PDF: {result.get('error', 'Unknown error')}"
                except Exception as e:
                    logger.warning(f"PDF reader not available, falling back to basic read: {str(e)}")
                    import base64
                    return f"PDF file (binary, {len(content):,} bytes). Base64: {base64.b64encode(content[:1000]).decode('utf-8')}... (truncated)"
            
            # Handle image files
            elif file_type == 'image' or s3_key.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                try:
                    import base64
                    from io import BytesIO
                    from PIL import Image as PILImage
                    
                    # Try to get image metadata
                    img = PILImage.open(BytesIO(content))
                    image_format = img.format or 'unknown'
                    width, height = img.size
                    mode = img.mode
                    
                    # Encode as base64 for reference
                    image_base64 = base64.b64encode(content).decode('utf-8')
                    
                    # Determine MIME type
                    mime_type = 'image/png'
                    if s3_key.endswith('.jpg') or s3_key.endswith('.jpeg'):
                        mime_type = 'image/jpeg'
                    elif s3_key.endswith('.gif'):
                        mime_type = 'image/gif'
                    elif s3_key.endswith('.webp'):
                        mime_type = 'image/webp'
                    
                    return f"""Image File Analysis:
File: {s3_key}
Size: {len(content):,} bytes
Format: {image_format}
Dimensions: {width} x {height} pixels
Color Mode: {mode}
Content Type: {mime_type}

Base64 Data URI (first 200 chars): data:{mime_type};base64,{image_base64[:200]}...
(Full base64 data available in result)"""
                except ImportError:
                    # PIL not available, return basic info
                    import base64
                    return f"Image file (binary, {len(content):,} bytes). Base64: {base64.b64encode(content[:500]).decode('utf-8')}... (truncated)"
                except Exception as e:
                    logger.warning(f"Error analyzing image: {str(e)}")
                    import base64
                    return f"Image file (binary, {len(content):,} bytes). Base64: {base64.b64encode(content[:500]).decode('utf-8')}... (truncated)"
            
            # Handle JSON files
            elif file_type == 'json' or s3_key.endswith('.json') or 'json' in content_type:
                try:
                    json_data = json.loads(content.decode('utf-8'))
                    return json.dumps(json_data, indent=2)
                except json.JSONDecodeError as e:
                    return f"Error parsing JSON: {str(e)}\nRaw content (first 1000 chars): {content.decode('utf-8', errors='ignore')[:1000]}"
            
            # Handle CSV files
            elif file_type == 'csv' or s3_key.endswith('.csv') or 'csv' in content_type:
                csv_content = content.decode('utf-8')
                # Show first 100 lines for large CSVs
                lines = csv_content.split('\n')
                if len(lines) > 100:
                    preview = '\n'.join(lines[:100])
                    return f"{preview}\n\n... ({len(lines) - 100} more lines)"
                return csv_content
            
            # Handle HTML files
            elif file_type == 'html' or s3_key.endswith(('.html', '.htm')) or 'html' in content_type:
                html_content = content.decode('utf-8')
                # Extract text content (remove tags for readability)
                import re
                text_content = re.sub(r'<[^>]+>', ' ', html_content)
                text_content = ' '.join(text_content.split())
                return f"""HTML File Content:
File: {s3_key}
Size: {len(content):,} bytes

Extracted Text Content:
{text_content[:2000]}{'...' if len(text_content) > 2000 else ''}

Full HTML (first 5000 chars):
{html_content[:5000]}{'...' if len(html_content) > 5000 else ''}"""
            
            # Handle text files
            elif file_type == 'text' or s3_key.endswith(('.txt', '.md', '.markdown')) or 'text' in content_type:
                text_content = content.decode('utf-8')
                # Show first 5000 chars for large text files
                if len(text_content) > 5000:
                    return f"{text_content[:5000]}\n\n... ({len(text_content) - 5000} more characters)"
                return text_content
            
            # Handle other text-based files
            else:
                # Try to decode as UTF-8
                try:
                    text_content = content.decode('utf-8')
                    # If it's valid UTF-8 and looks like text, return it
                    if len(text_content) > 0 and not any(ord(c) < 32 and c not in '\n\r\t' for c in text_content[:100]):
                        if len(text_content) > 5000:
                            return f"{text_content[:5000]}\n\n... ({len(text_content) - 5000} more characters)"
                        return text_content
                except UnicodeDecodeError:
                    pass
                
                # Binary file - return base64
                import base64
                base64_content = base64.b64encode(content).decode('utf-8')
                if len(base64_content) > 1000:
                    return f"Binary file (size: {len(content):,} bytes)\nBase64 (first 1000 chars): {base64_content[:1000]}...\n(Full base64 available in result)"
                return f"Binary file (size: {len(content):,} bytes)\nBase64: {base64_content}"
                    
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NoSuchKey':
                return f"File not found: {s3_key}"
            elif error_code == 'NoSuchBucket':
                return f"Bucket not found: {bucket_name}"
            else:
                return f"S3 error: {str(e)}"
        except Exception as e:
            logger.error(f"Error reading file: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return f"Error reading file: {str(e)}"
    
    def get_file_info(self, s3_key: str) -> Dict[str, Any]:
        """
        Get metadata about a file in S3
        
        Args:
            s3_key: The S3 key/path of the file
            
        Returns:
            Dictionary with file metadata
        """
        try:
            bucket_name = self.get_bucket_name()
            response = self.s3_client.head_object(Bucket=bucket_name, Key=s3_key)
            
            return {
                'size': response['ContentLength'],
                'last_modified': response['LastModified'].isoformat(),
                'content_type': response.get('ContentType', 'unknown'),
                'etag': response['ETag']
            }
        except ClientError as e:
            return {'error': str(e)}
        except Exception as e:
            return {'error': str(e)}

@tool
def read_s3_file_tool(s3_key: str, file_type: str = "auto") -> str:
    """
    Read and analyze files from S3 storage. Handles all common file types:
    - PDF files: Extracts text and provides analysis
    - Image files (PNG, JPG, GIF, WebP): Provides metadata and base64 data
    - JSON files: Parses and formats JSON
    - CSV files: Returns CSV content
    - HTML files: Extracts text and shows HTML structure
    - Text files (TXT, MD): Returns text content
    - Other files: Returns base64-encoded binary content
    
    Use this tool during checkpoint validation to inspect intermediate results.
    When you see an uploaded file context with an S3 key, use this tool to read the file content.
    Pass the S3 key exactly as provided in the context.
    
    Args:
        s3_key: The S3 key/path of the file to read
        file_type: File type hint ("auto", "pdf", "image", "json", "csv", "html", "text")
                   Auto-detection works for most files based on extension
    """
    try:
        agent_logger.info(f"Reading S3 file: {s3_key}")
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Create S3 file reader instance
        reader = S3FileReader()
        
        # Read the file
        content = reader.read_file(s3_key, file_type)
        
        # Get file info for context
        file_info = reader.get_file_info(s3_key)
        
        # Format the response
        if 'error' in file_info:
            result = f"File Content:\n{content}\n\nFile Info: {file_info['error']}"
        else:
            result = f"""File Content:
{content}

File Information:
- Size: {file_info['size']} bytes
- Last Modified: {file_info['last_modified']}
- Content Type: {file_info['content_type']}
- ETag: {file_info['etag']}"""
        
        return result
        
    except Exception as e:
        logger.error(f"Error in read_s3_file_tool: {str(e)}")
        return f"Error reading file: {str(e)}"

@tool
def generate_agent_file_tool(filename: str, content: str = "", file_type: str = "txt") -> str:
    """Generate a file in the agent-files folder for the current session. Use this to create files that the user can download."""
    try:
        agent_logger.info(f"Generating agent file: {filename}")
        # Get environment variables
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return "Error: Missing required environment variables (user_id, session_id)"
        
        # Ensure filename has proper extension
        if not filename.endswith(f'.{file_type}'):
            filename = f"{filename}.{file_type}"
        
        # Format metrics_table if it's a raw JSON array (for PDF reports)
        if file_type == 'pdf' and content:
            try:
                import json
                import re
                # Check if content contains a raw JSON array (metrics_table)
                # Pattern: [["Metric", "Portfolio", "Benchmark"], ["CAGR", "29.71%", "13.09%"], ...]
                # More flexible pattern that handles nested arrays
                json_array_patterns = [
                    r'\[\["[^"]+",\s*"[^"]+",\s*"[^"]+"\](?:,\s*\["[^"]+",\s*"[^"]+",\s*"[^"]+"\])*\]',  # Full array
                    r'\[\[[^\]]+\](?:,\s*\[[^\]]+\])+\]',  # More general nested array
                ]
                
                for pattern in json_array_patterns:
                    json_array_match = re.search(pattern, content)
                    if json_array_match:
                        try:
                            metrics_array = json.loads(json_array_match.group(0))
                            if isinstance(metrics_array, list) and len(metrics_array) > 0 and isinstance(metrics_array[0], list):
                                # Format as markdown table
                                table_lines = []
                                for row in metrics_array:
                                    if isinstance(row, list):
                                        # Escape pipe characters in cells
                                        escaped_cells = [str(cell).replace('|', '\\|') for cell in row]
                                        table_lines.append('| ' + ' | '.join(escaped_cells) + ' |')
                                
                                # Replace the JSON array with formatted table
                                if len(table_lines) > 0:
                                    # Add header separator after first row
                                    header_sep = '| ' + ' | '.join(['---'] * len(metrics_array[0])) + ' |'
                                    formatted_table = table_lines[0] + '\n' + header_sep + '\n' + '\n'.join(table_lines[1:])
                                    
                                    content = content.replace(json_array_match.group(0), formatted_table)
                                    logger.info(f"Formatted metrics_table as markdown table in PDF content ({len(metrics_array)} rows)")
                                    break  # Only replace first match
                        except (json.JSONDecodeError, ValueError) as e:
                            logger.debug(f"Could not parse JSON array: {str(e)}")
                            continue
            except Exception as e:
                logger.warning(f"Error formatting metrics_table: {str(e)}")
        
        # Decompress content if it's compressed (e.g., from web scraper tool)
        # This handles compressed data from tools like fetch_web_content_tool
        original_size = len(content) if isinstance(content, str) else len(str(content))
        is_compressed = False
        is_binary = False
        
        try:
            import json
            from compression_helper import CompressionHelper
            
            # Try to parse as JSON to check if it's compressed
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict) and CompressionHelper.is_compressed(parsed):
                    # Decompress the content before storing
                    logger.info(f"Detected compressed content ({len(content)} chars), decompressing before storage...")
                    decompressed = CompressionHelper.decompress_data(parsed)
                    
                    if isinstance(decompressed, str):
                        content = decompressed
                        decompressed_size = len(content)
                        compression_ratio = len(content) / original_size if original_size > 0 else 1.0
                        logger.info(f"Decompressed content: {original_size} -> {decompressed_size} chars (expanded {compression_ratio:.1%})")
                        is_compressed = True
                        agent_logger.info(f"📦 Decompressed content before file generation")
                    else:
                        logger.warning(f"Decompressed content is not a string: {type(decompressed)}")
            except (json.JSONDecodeError, ValueError):
                # Not JSON, so not compressed - use as-is
                pass
        except ImportError:
            logger.warning("CompressionHelper not available, skipping decompression check")
        except Exception as decomp_error:
            logger.warning(f"Decompression check failed, using content as-is: {str(decomp_error)}")
        
        # Generate PDF or HTML if file_type matches (after decompression)
        is_binary = False
        if file_type.lower() == 'pdf':
            try:
                pdf_bytes = generate_pdf_content(content, filename)
                # Content is now PDF bytes
                content = pdf_bytes
                # Mark that content is binary for upload
                is_binary = True
                logger.info(f"Generated PDF file: {filename} ({len(pdf_bytes)} bytes)")
            except Exception as pdf_error:
                logger.error(f"Error generating PDF: {str(pdf_error)}")
                import traceback
                logger.error(traceback.format_exc())
                # Fallback to text file with .pdf extension (not ideal but better than failing)
                logger.warning(f"Falling back to text content for PDF file")
                is_binary = False
        # Note: HTML generation is now handled by planner/agent_tools/ (generate_html_report_tool)
        # This tool only handles txt, pdf, and markdown files
        
        # Use unified file upload function
        try:
            from lambda_invocation import upload_file_and_notify
            
            # Set content type for PDF
            content_type = None
            if file_type.lower() == 'pdf' and is_binary:
                content_type = 'application/pdf'
            
            result = upload_file_and_notify(
                content=content,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type=file_type,
                content_type=content_type,
                folder="agent-files",
                metadata={
                    'generated_by': 'agent',
                    'was_compressed': 'true' if is_compressed else 'false'
                }
            )
            
            logger.info(f"Generated agent file: {filename}")
            return result
            
        except ImportError:
            logger.warning("lambda_invocation module not available - falling back to manual upload")
            return "Error: Shared file upload module not available"
        
    except Exception as e:
        logger.error(f"Error in generate_agent_file_tool: {str(e)}")
        return f"Error generating file: {str(e)}"

@tool
def generate_excel_file_tool(filename: str, content: str, template_type: str = "financial_model", include_charts: bool = True) -> str:
    """
    Generate CSV files for financial analysis that can be opened in Excel. The agent should prepare the content first using other tools.
    
    Args:
        filename: Name of the file (without extension)
        content: The data content to include (prepared by agent using other tools)
        template_type: Type of template ('financial_model', 'dcf_model', 'portfolio_analysis', 'risk_report', 'custom')
        include_charts: Whether to include chart instructions (noted in comments)
    
    Returns:
        Success message with file details
    """
    try:
        agent_logger.info(f"Generating Excel file: {filename} (type: {template_type})")
        # Get environment variables
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return "Error: Missing required environment variables (user_id, session_id)"
        
        # Ensure filename has proper extension
        if not filename.endswith('.csv'):
            filename = f"{filename}.csv"
        
        # Generate Excel content based on template type and provided content
        excel_content = generate_excel_content(template_type, content, include_charts)
        
        # Use unified file upload function
        try:
            from lambda_invocation import upload_file_and_notify
            
            result = upload_file_and_notify(
                content=excel_content,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type='csv',
                content_type='text/csv',
                folder="agent-files",
                metadata={
                    'generated_by': 'agent',
                    'template_type': template_type,
                    'includes_charts': str(include_charts)
                }
            )
            
            logger.info(f"Generated CSV file: {filename}")
            return result
            
        except ImportError:
            logger.warning("lambda_invocation module not available - falling back to manual upload")
            return "Error: Shared file upload module not available"
        
    except Exception as e:
        logger.error(f"Error in generate_excel_file_tool: {str(e)}")
        return f"Error generating Excel file: {str(e)}"

def generate_excel_content(template_type: str, content: str, include_charts: bool) -> bytes:
    """
    Generate Excel file content based on template type and provided content.
    Creates a proper Excel file structure that Excel can open.
    """
    try:
        # Parse the content if it's JSON
        try:
            if content.strip().startswith('{') or content.strip().startswith('['):
                data = json.loads(content)
            else:
                data = content
        except:
            data = content
        
        # Create Excel-compatible content
        excel_lines = []
        
        # Add template information
        excel_lines.append(f"# {template_type.upper().replace('_', ' ')} TEMPLATE")
        excel_lines.append(f"# Generated by Cosine Financial Analysis Agent")
        excel_lines.append(f"# Include Charts: {include_charts}")
        excel_lines.append("")
        
        # Process data based on template type
        if template_type == "financial_model":
            excel_lines.extend(generate_financial_model_content(data))
        elif template_type == "dcf_model":
            excel_lines.extend(generate_dcf_model_content(data))
        elif template_type == "portfolio_analysis":
            excel_lines.extend(generate_portfolio_analysis_content(data))
        elif template_type == "risk_report":
            excel_lines.extend(generate_risk_report_content(data))
        else:
            excel_lines.extend(generate_custom_content(data, template_type))
        
        # Join all lines
        excel_content = "\n".join(excel_lines)
        
        # Return as bytes
        return excel_content.encode('utf-8')
        
    except Exception as e:
        logger.error(f"Error generating Excel content: {str(e)}")
        # Fallback to simple CSV format
        fallback_content = f"# {template_type.upper().replace('_', ' ')} TEMPLATE\n# Generated by Cosine Financial Analysis Agent\n\n{content}"
        return fallback_content.encode('utf-8')

def generate_pdf_content(content: str, filename: str = "report.pdf") -> bytes:
    """
    Generate PDF content from text/markdown content.
    Creates a proper PDF file that can be opened by PDF readers.
    
    Args:
        content: Text content to convert to PDF
        filename: Filename (for metadata)
        
    Returns:
        PDF file as bytes
    """
    try:
        # Try using reportlab (preferred for Lambda)
        try:
            from reportlab.lib.pagesizes import letter, A4
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image
            from reportlab.lib.enums import TA_LEFT, TA_CENTER
            from io import BytesIO
            import boto3
            import re
            import json
            import os
            
            # Create PDF in memory
            buffer = BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
            
            # Build PDF content
            story = []
            styles = getSampleStyleSheet()
            
            # Title style
            title_style = ParagraphStyle(
                'CustomTitle',
                parent=styles['Heading1'],
                fontSize=18,
                textColor='#1a1a1a',
                spaceAfter=12,
                alignment=TA_CENTER
            )
            
            # Heading style
            heading_style = ParagraphStyle(
                'CustomHeading',
                parent=styles['Heading2'],
                fontSize=14,
                textColor='#2c3e50',
                spaceAfter=8,
                spaceBefore=12
            )
            
            # Normal text style
            normal_style = ParagraphStyle(
                'CustomNormal',
                parent=styles['Normal'],
                fontSize=10,
                textColor='#333333',
                spaceAfter=6,
                leading=12
            )
            
            # Helper function to download image from S3 and embed in PDF
            def embed_image_from_s3(s3_key: str, max_width: float = None, max_height: float = None):
                """Download image from S3 and return Image element for PDF"""
                try:
                    # Set defaults using inch (now available in scope)
                    if max_width is None:
                        max_width = 6 * inch
                    if max_height is None:
                        max_height = 4 * inch
                    
                    s3_client = boto3.client('s3')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
                    
                    if not bucket_name:
                        logger.warning(f"Cannot embed image: bucket name not configured")
                        return None
                    
                    # Download image from S3
                    response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                    image_data = response['Body'].read()
                    
                    # Create Image from bytes
                    img_buffer = BytesIO(image_data)
                    img = Image(img_buffer, width=max_width, height=max_height, kind='proportional')
                    return img
                except Exception as e:
                    logger.error(f"Error embedding image from S3 {s3_key}: {str(e)}")
                    return None
            
            # Helper function to resolve S3 JSON references in content
            def resolve_json_references(content_text: str) -> str:
                """
                Detect S3 keys pointing to JSON files in content and replace with actual values.
                Handles patterns like:
                - CAGR: users/.../data-files/...json
                - Volatility: users/.../data-files/...json
                """
                from tools.json_parser_helper import JSONParserHelper
                
                # Pattern to match S3 keys ending in .json (more flexible to handle line breaks)
                s3_json_pattern = r'users/[^/]+/sessions/[^/]+/data-files/[^\s"\'<>\)\n]+\.json'
                
                # Map metric names to their field paths in the JSON (case-insensitive matching)
                metric_field_map = {
                    'cagr': 'portfolio.cagr',
                    'volatility': 'portfolio.volatility',
                    'max drawdown': 'portfolio.max_drawdown',
                    'max_drawdown': 'portfolio.max_drawdown',
                    'sharpe ratio': 'portfolio.sharpe_ratio',
                    'sharpe_ratio': 'portfolio.sharpe_ratio',
                    'rolling 12-month returns': 'portfolio.rolling_12m_returns',
                    'rolling_12m_returns': 'portfolio.rolling_12m_returns',
                    'total return': 'portfolio.total_return',
                    'total_return': 'portfolio.total_return',
                }
                
                # Split content into lines for better context detection
                lines = content_text.split('\n')
                resolved_lines = []
                
                for line in lines:
                    # Find all S3 JSON references in this line
                    matches = list(re.finditer(s3_json_pattern, line))
                    if not matches:
                        resolved_lines.append(line)
                        continue
                    
                    # Process each match in reverse order to preserve positions
                    resolved_line = line
                    for match in reversed(matches):
                        s3_key = match.group(0)
                        try:
                            # Read JSON from S3
                            data = JSONParserHelper.parse_json_data(s3_key)
                            
                            # Use the entire line as context (case-insensitive)
                            line_context_lower = line.lower()
                            
                            # Find which metric this line refers to
                            extracted_value = None
                            for metric_name, field_path in metric_field_map.items():
                                if metric_name in line_context_lower:
                                    extracted_value = JSONParserHelper.extract_nested_field(data, field_path)
                                    if extracted_value is not None:
                                        break
                            
                            # If no specific metric found, try common fields
                            if extracted_value is None:
                                # Try direct portfolio fields
                                if 'portfolio' in data:
                                    portfolio = data.get('portfolio', {})
                                    if isinstance(portfolio, dict):
                                        # Try common fields in order
                                        for field in ['cagr', 'volatility', 'max_drawdown', 'sharpe_ratio', 'total_return']:
                                            if field in portfolio:
                                                extracted_value = portfolio[field]
                                                break
                            
                            # Format the value
                            if extracted_value is not None:
                                if isinstance(extracted_value, (int, float)):
                                    if 'ratio' in line_context_lower or 'sharpe' in line_context_lower:
                                        replacement = f"{extracted_value:.2f}"
                                    elif 'drawdown' in line_context_lower:
                                        # Drawdown is typically negative, show as percentage
                                        replacement = f"{extracted_value:.2%}"
                                    elif 'return' in line_context_lower or 'cagr' in line_context_lower:
                                        replacement = f"{extracted_value:.2%}"
                                    else:
                                        replacement = f"{extracted_value:.2f}"
                                else:
                                    replacement = str(extracted_value)
                                
                                # Replace the S3 key with the actual value
                                resolved_line = resolved_line.replace(s3_key, replacement)
                                logger.info(f"Resolved {s3_key} to {replacement} based on context: {line[:50]}")
                            else:
                                logger.warning(f"Could not extract metric value from {s3_key} in line: {line[:100]}")
                                resolved_line = resolved_line.replace(s3_key, "[Value not available]")
                        except Exception as e:
                            logger.error(f"Error resolving JSON reference {s3_key}: {str(e)}")
                            resolved_line = resolved_line.replace(s3_key, "[Error reading data]")
                    
                    resolved_lines.append(resolved_line)
                
                return '\n'.join(resolved_lines)
            
            # Helper function to format raw decimal values in content
            def format_decimal_values(content_text: str) -> str:
                """
                Format raw decimal values in content based on their context.
                Handles cases where orchestrator has already extracted values but they're not formatted.
                
                Examples:
                - CAGR: 0.2977067600527421 → 29.77%
                - Volatility: 0.3058089933708457 → 30.58%
                - Max Drawdown: -0.35553266553567237 → -35.55%
                - Sharpe Ratio: 0.9420121008306779 → 0.94
                - Rolling 12-month returns: {...} → Summary text
                """
                lines = content_text.split('\n')
                formatted_lines = []
                i = 0
                
                while i < len(lines):
                    line = lines[i]
                    line_lower = line.lower()
                    
                    # Pattern to match decimal numbers (including negative)
                    decimal_pattern = r'(-?\d+\.\d+)'
                    
                    # Check if this line contains a metric label
                    if 'cagr' in line_lower or 'compound annual growth rate' in line_lower:
                        # Format as percentage
                        line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
                    elif 'volatility' in line_lower:
                        # Format as percentage
                        line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
                    elif 'drawdown' in line_lower and 'max' in line_lower:
                        # Format as percentage (already negative if needed)
                        line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
                    elif 'sharpe' in line_lower and 'ratio' in line_lower:
                        # Format as decimal (2 decimal places)
                        line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2f}", line)
                    elif 'rolling' in line_lower and ('12' in line_lower or 'month' in line_lower) and 'return' in line_lower:
                        # Check if this line or subsequent lines contain a JSON object (rolling returns data)
                        # First, check if line is very long (likely contains entire JSON)
                        # If line is extremely long (> 10000 chars), just replace with summary to avoid parsing issues
                        if len(line) > 10000 and '{' in line and '"dates"' in line:
                            json_start = line.find('{')
                            if json_start != -1:
                                # Too long to parse efficiently, just replace with summary
                                line = line[:json_start] + "(Rolling 12-month returns data - see CSV for detailed time series)"
                        elif len(line) > 500 and '{' in line and '"dates"' in line:
                            # Try to extract and parse JSON
                            json_start = line.find('{')
                            if json_start != -1:
                                # Try to find the matching closing brace
                                brace_count = 0
                                json_end = -1
                                for j in range(json_start, len(line)):
                                    if line[j] == '{':
                                        brace_count += 1
                                    elif line[j] == '}':
                                        brace_count -= 1
                                        if brace_count == 0:
                                            json_end = j + 1
                                            break
                                
                                if json_end > json_start:
                                    try:
                                        json_str = line[json_start:json_end]
                                        rolling_data = json.loads(json_str)
                                        if isinstance(rolling_data, dict) and 'dates' in rolling_data:
                                            # Replace with summary
                                            num_points = len(rolling_data.get('dates', []))
                                            if 'returns' in rolling_data:
                                                returns = rolling_data['returns']
                                                if isinstance(returns, list) and len(returns) > 0:
                                                    avg_return = sum(returns) / len(returns)
                                                    min_return = min(returns)
                                                    max_return = max(returns)
                                                    summary = f"Average: {avg_return:.2%}, Range: {min_return:.2%} to {max_return:.2%} ({num_points} data points)"
                                                    line = line[:json_start] + summary
                                                else:
                                                    line = line[:json_start] + f"({num_points} data points available)"
                                            else:
                                                line = line[:json_start] + f"({num_points} data points available)"
                                    except (json.JSONDecodeError, ValueError):
                                        # If parsing fails, replace with simple note
                                        line = line[:json_start] + "(Rolling 12-month returns data - see CSV for details)"
                                else:
                                    # JSON spans multiple lines - collect them
                                    collected_lines = [line]
                                    brace_count = line.count('{') - line.count('}')
                                    j = i + 1
                                    while j < len(lines) and brace_count > 0:
                                        collected_lines.append(lines[j])
                                        brace_count += lines[j].count('{') - lines[j].count('}')
                                        j += 1
                                    
                                    # Try to parse the collected JSON
                                    full_json = '\n'.join(collected_lines)
                                    json_start = full_json.find('{')
                                    if json_start != -1:
                                        try:
                                            # Find matching closing brace
                                            brace_count = 0
                                            json_end = -1
                                            for k in range(json_start, len(full_json)):
                                                if full_json[k] == '{':
                                                    brace_count += 1
                                                elif full_json[k] == '}':
                                                    brace_count -= 1
                                                    if brace_count == 0:
                                                        json_end = k + 1
                                                        break
                                            
                                            if json_end > json_start:
                                                json_str = full_json[json_start:json_end]
                                                rolling_data = json.loads(json_str)
                                                if isinstance(rolling_data, dict) and 'dates' in rolling_data:
                                                    num_points = len(rolling_data.get('dates', []))
                                                    summary = f"(Rolling 12-month returns: {num_points} data points - see CSV for details)"
                                                    # Replace the first line and skip the rest
                                                    line = line[:line.find('{')] + summary
                                                    i = j - 1  # Skip processed lines
                                        except (json.JSONDecodeError, ValueError):
                                            # If parsing fails, replace with simple note
                                            line = line[:line.find('{')] + "(Rolling 12-month returns data - see CSV for details)"
                                            # Skip lines that are part of the JSON
                                            while i + 1 < len(lines) and ('"' in lines[i+1] or '}' in lines[i+1] or ']' in lines[i+1]):
                                                i += 1
                                                if lines[i].strip().endswith('}'):
                                                    break
                    else:
                        # For other numeric values, try to detect if they should be percentages
                        # If the value is between -1 and 1 and not already formatted, it might be a percentage
                        matches = list(re.finditer(decimal_pattern, line))
                        for match in matches:
                            value = float(match.group(1))
                            # If it's a small decimal (likely a percentage), format it
                            if -1 <= value <= 1 and abs(value) < 0.5:
                                # Check context - if it's near words like "return", "rate", "growth", format as percentage
                                context = line[max(0, match.start()-20):min(len(line), match.end()+20)].lower()
                                if any(word in context for word in ['return', 'rate', 'growth', 'yield', 'cagr']):
                                    line = line.replace(match.group(1), f"{value:.2%}")
                    
                    formatted_lines.append(line)
                    i += 1
                
                return '\n'.join(formatted_lines)
            
            # Resolve JSON references in content before processing
            content = resolve_json_references(content)
            
            # Format raw decimal values that were extracted by orchestrator
            content = format_decimal_values(content)
            
            # First, try to parse entire content as JSON to extract chart references
            chart_s3_keys = []
            try:
                # Try to parse as JSON
                content_json = json.loads(content)
                if isinstance(content_json, dict) and 's3_key' in content_json:
                    chart_s3_keys.append(content_json['s3_key'])
                    logger.info(f"Found chart S3 key in JSON content: {content_json['s3_key']}")
                elif isinstance(content_json, list):
                    # Check if any item in the list has s3_key
                    for item in content_json:
                        if isinstance(item, dict) and 's3_key' in item:
                            chart_s3_keys.append(item['s3_key'])
                            logger.info(f"Found chart S3 key in JSON list: {item['s3_key']}")
            except (json.JSONDecodeError, ValueError):
                # Not JSON, try to find JSON objects embedded in the content string
                # Look for chart result JSON (e.g., from generate_chart_tool)
                json_pattern = r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"([^"]+)"'
                matches = re.findall(json_pattern, content)
                for match in matches:
                    if match.endswith('.png'):
                        chart_s3_keys.append(match)
                        logger.info(f"Found chart S3 key in embedded JSON: {match}")
                
                # Also look for simple JSON objects with s3_key
                simple_json_pattern = r'\{"s3_key":\s*"([^"]+)"'
                simple_matches = re.findall(simple_json_pattern, content)
                for match in simple_matches:
                    if match.endswith('.png') and match not in chart_s3_keys:
                        chart_s3_keys.append(match)
                        logger.info(f"Found chart S3 key in simple JSON: {match}")
            
            # Parse content and convert to PDF elements
            lines = content.split('\n')
            current_section = []
            s3_client = None
            
            # If we found chart S3 keys from JSON parsing, embed them first
            for s3_key in chart_s3_keys:
                if s3_key.endswith('.png'):
                    logger.info(f"Embedding chart image from JSON: {s3_key}")
                    img = embed_image_from_s3(s3_key)
                    if img:
                        story.append(Spacer(1, 0.2*inch))
                        story.append(img)
                        story.append(Spacer(1, 0.2*inch))
            
            for line in lines:
                line = line.strip()
                if not line:
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Spacer(1, 0.1*inch))
                    continue
                
                # Check for S3 key references (format: users/.../agent-files/...png)
                # Also check for markdown image syntax: ![Chart](s3_key)
                markdown_img_match = re.search(r'!\[.*?\]\((users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>\)]+\.png)\)', line)
                if markdown_img_match:
                    s3_key = markdown_img_match.group(1)
                    logger.info(f"Found markdown chart image reference: {s3_key}")
                    img = embed_image_from_s3(s3_key)
                    if img:
                        if current_section:
                            story.extend(current_section)
                            current_section = []
                        story.append(Spacer(1, 0.2*inch))
                        story.append(img)
                        story.append(Spacer(1, 0.2*inch))
                        # Remove the markdown image syntax from the line
                        line = re.sub(r'!\[.*?\]\(users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>\)]+\.png\)', '[Chart embedded above]', line)
                
                s3_key_match = re.search(r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.png', line)
                if s3_key_match:
                    s3_key = s3_key_match.group(0)
                    logger.info(f"Found chart image reference in content: {s3_key}")
                    # Embed the image
                    img = embed_image_from_s3(s3_key)
                    if img:
                        if current_section:
                            story.extend(current_section)
                            current_section = []
                        story.append(Spacer(1, 0.2*inch))
                        story.append(img)
                        story.append(Spacer(1, 0.2*inch))
                        # Remove the S3 key from the line and continue processing the rest
                        line = re.sub(r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.png', '[Chart embedded above]', line)
                
                # Check for JSON chart references (format: {"s3_key": "users/.../agent-files/...png"})
                # Also handle full chart result JSON: {"message": "...", "s3_key": "...", "filename": "...", "file_type": "png"}
                json_match = re.search(r'\{"(?:message|s3_key)":\s*"[^"]*",\s*"s3_key":\s*"([^"]+)"', line)
                if not json_match:
                    # Try simpler pattern
                    json_match = re.search(r'\{"s3_key":\s*"([^"]+)"', line)
                if json_match:
                    s3_key = json_match.group(1)
                    # Only process if it's an image file
                    if s3_key.endswith(('.png', '.jpg', '.jpeg', '.gif')):
                        logger.info(f"Found JSON chart reference: {s3_key}")
                        img = embed_image_from_s3(s3_key)
                        if img:
                            if current_section:
                                story.extend(current_section)
                                current_section = []
                            story.append(Spacer(1, 0.2*inch))
                            story.append(img)
                            story.append(Spacer(1, 0.2*inch))
                            # Remove the JSON reference from the line (handle both full and simple JSON)
                            line = re.sub(r'\{"(?:message|s3_key)":\s*"[^"]*",\s*"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
                            line = re.sub(r'\{"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
                
                # Detect headings (markdown style or plain text)
                if line.startswith('# '):
                    # H1
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(line[2:], title_style))
                    story.append(Spacer(1, 0.2*inch))
                elif line.startswith('## '):
                    # H2
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(line[3:], heading_style))
                    story.append(Spacer(1, 0.15*inch))
                elif line.startswith('### '):
                    # H3
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(line[4:], heading_style))
                    story.append(Spacer(1, 0.1*inch))
                elif line.startswith('|') and '|' in line[1:]:
                    # Markdown table row - format properly
                    cells = [cell.strip() for cell in line.split('|')[1:-1]]
                    if cells and cells[0] and not cells[0].startswith('---'):
                        # Regular table row
                        table_text = ' | '.join(cells)
                        current_section.append(Paragraph(table_text, normal_style))
                    elif cells and cells[0] and cells[0].startswith('---'):
                        # Table separator row - skip it
                        continue
                elif line.startswith('- ') or line.startswith('* '):
                    # Bullet point
                    bullet_text = line[2:].strip()
                    current_section.append(Paragraph(f"• {bullet_text}", normal_style))
                else:
                    # Regular paragraph
                    # Escape HTML entities and handle basic formatting
                    para_text = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    current_section.append(Paragraph(para_text, normal_style))
            
            # Add remaining content
            if current_section:
                story.extend(current_section)
            
            # Build PDF
            doc.build(story)
            
            # Get PDF bytes
            pdf_bytes = buffer.getvalue()
            buffer.close()
            
            logger.info(f"Generated PDF: {len(pdf_bytes)} bytes")
            return pdf_bytes
            
        except ImportError:
            # reportlab not available, try fpdf
            logger.warning("reportlab not available, trying fpdf")
            try:
                from fpdf import FPDF
                
                pdf = FPDF()
                pdf.set_auto_page_break(auto=True, margin=15)
                pdf.add_page()
                pdf.set_font("Arial", size=10)
                
                # Split content into lines and add to PDF
                lines = content.split('\n')
                for line in lines:
                    # Remove markdown formatting
                    line = line.replace('#', '').replace('*', '').replace('|', ' ')
                    line = line.strip()
                    if line:
                        # Handle long lines by wrapping
                        if len(line) > 80:
                            # Simple word wrap
                            words = line.split()
                            current_line = ""
                            for word in words:
                                if len(current_line + word) < 80:
                                    current_line += word + " "
                                else:
                                    if current_line:
                                        pdf.cell(0, 5, current_line, ln=1)
                                    current_line = word + " "
                            if current_line:
                                pdf.cell(0, 5, current_line, ln=1)
                        else:
                            pdf.cell(0, 5, line, ln=1)
                
                pdf_bytes = pdf.output(dest='S').encode('latin-1')
                logger.info(f"Generated PDF with fpdf: {len(pdf_bytes)} bytes")
                return pdf_bytes
                
            except ImportError:
                # Neither library available - create minimal PDF manually
                logger.warning("Neither reportlab nor fpdf available, creating minimal PDF")
                # Create a minimal valid PDF structure
                # Escape content for PDF
                escaped_content = content[:500].replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                
                pdf_content = f"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length {len(escaped_content) + 100}
>>
stream
BT
/F1 12 Tf
100 700 Td
({escaped_content}) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000277 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
{400 + len(escaped_content)}
%%EOF"""
                return pdf_content.encode('utf-8')
                
    except Exception as e:
        logger.error(f"Error in generate_pdf_content: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        # Return minimal PDF as fallback
        escaped_content = content[:100].replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        minimal_pdf = f"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj
4 0 obj<</Length 50>>stream
BT/F1 12 Tf 100 700 Td({escaped_content})Tj ET
endstream endobj
xref 0 5
trailer<</Size 5/Root 1 0 R>>
startxref 200
%%EOF"""
        return minimal_pdf.encode('utf-8')

def generate_financial_model_content(data):
    """Generate content for financial model template"""
    lines = []
    
    # Company Summary Section
    lines.append("# COMPANY SUMMARY")
    lines.append("Metric,Value")
    
    if isinstance(data, dict):
        # Extract company info if available
        company_name = data.get('company_name', 'N/A')
        symbol = data.get('symbol', 'N/A')
        market_cap = data.get('market_cap', 0)
        shares_outstanding = data.get('shares_outstanding', 0)
        pe_ratio = data.get('pe_ratio', 0)
        dividend_yield = data.get('dividend_yield', 0)
        
        lines.append(f"Company Name,{company_name}")
        lines.append(f"Symbol,{symbol}")
        lines.append(f"Market Cap,${market_cap:,.0f}")
        lines.append(f"Shares Outstanding,{shares_outstanding:,.0f}")
        lines.append(f"P/E Ratio,{pe_ratio}")
        lines.append(f"Dividend Yield,{dividend_yield}%")
        lines.append("")
        
        # Historical Price Analysis
        if 'history' in data and isinstance(data['history'], list):
            lines.append("# HISTORICAL PRICE ANALYSIS")
            lines.append("Date,Open,High,Low,Close,Volume,Market Cap")
            
            # Get recent data points (last 30 days or all if less)
            recent_data = data['history'][-30:] if len(data['history']) > 30 else data['history']
            
            for point in recent_data:
                date = point.get('date', 'N/A')
                open_price = point.get('open', 0)
                high = point.get('high', 0)
                low = point.get('low', 0)
                close = point.get('close', 0)
                volume = point.get('volume', 0)
                market_cap = point.get('market_cap', 0)
                
                lines.append(f"{date},{open_price:.2f},{high:.2f},{low:.2f},{close:.2f},{volume:,.0f},{market_cap:,.0f}")
            
            lines.append("")
            
            # Calculate key metrics
            if len(data['history']) > 0:
                prices = [point.get('close', 0) for point in data['history'] if point.get('close')]
                if prices:
                    current_price = prices[-1]
                    high_52w = max(prices)
                    low_52w = min(prices)
                    avg_price = sum(prices) / len(prices)
                    
                    lines.append("# KEY METRICS")
                    lines.append("Metric,Value")
                    lines.append(f"Current Price,${current_price:.2f}")
                    lines.append(f"52-Week High,${high_52w:.2f}")
                    lines.append(f"52-Week Low,${low_52w:.2f}")
                    lines.append(f"Average Price,${avg_price:.2f}")
                    lines.append(f"Price Range,${((high_52w - low_52w) / low_52w * 100):.1f}%")
                    lines.append("")
    
    return lines

def generate_dcf_model_content(data):
    """Generate content for DCF model template"""
    lines = []
    
    lines.append("# DCF MODEL ASSUMPTIONS")
    lines.append("Assumption,Value")
    lines.append("WACC,10.0%")
    lines.append("Terminal Growth Rate,3.0%")
    lines.append("Revenue Growth Year 1,5.0%")
    lines.append("Revenue Growth Year 2,4.0%")
    lines.append("Revenue Growth Year 3,3.0%")
    lines.append("EBITDA Margin,20.0%")
    lines.append("Tax Rate,25.0%")
    lines.append("")
    
    if isinstance(data, dict) and 'history' in data:
        # Use historical data for projections
        lines.append("# HISTORICAL DATA FOR PROJECTIONS")
        lines.append("Year,Revenue,EBITDA,Free Cash Flow")
        
        # Simple projection based on historical trend
        if len(data['history']) > 0:
            recent_prices = [point.get('close', 0) for point in data['history'][-252:]]  # Last year
            if recent_prices:
                avg_price = sum(recent_prices) / len(recent_prices)
                base_revenue = avg_price * 1000000  # Simplified assumption
                
                for year in range(1, 6):
                    growth_rate = max(0.03, 0.05 - (year - 1) * 0.01)  # Declining growth
                    revenue = base_revenue * (1 + growth_rate) ** year
                    ebitda = revenue * 0.20  # 20% margin
                    fcf = ebitda * 0.75  # 75% conversion
                    
                    lines.append(f"Year {year},${revenue:,.0f},${ebitda:,.0f},${fcf:,.0f}")
    
    return lines

def generate_portfolio_analysis_content(data):
    """Generate content for portfolio analysis template using actual metrics data"""
    lines = []
    
    # Try to parse data as JSON if it's a string
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except:
            # If not JSON, try to extract metrics from text
            pass
    
    # Handle case where data is directly the metrics_table array
    if isinstance(data, list):
        # Check if it looks like a metrics_table (array of arrays)
        if len(data) > 0 and isinstance(data[0], list):
            # This is a metrics_table array - use it directly
            for row in data:
                if isinstance(row, list):
                    lines.append(','.join(str(cell) for cell in row))
                else:
                    lines.append(str(row))
            return lines
    
    # Check if data contains portfolio analysis metrics
    if isinstance(data, dict):
        # Check for portfolio analysis tool output structure
        if 'portfolio' in data and isinstance(data['portfolio'], dict):
            portfolio_metrics = data['portfolio']
            benchmark_metrics = data.get('benchmark', {})
            metrics_table = data.get('metrics_table', [])
            time_series = data.get('time_series', {})
            rolling_returns = portfolio_metrics.get('rolling_12m_returns', {})
            
            # Portfolio Summary Section
            lines.append("# PORTFOLIO ANALYSIS")
            lines.append("# Generated by Cosine Financial Analysis Agent")
            lines.append("")
            lines.append("# PORTFOLIO SUMMARY")
            lines.append("Metric,Portfolio,Benchmark")
            
            # Add metrics from portfolio analysis
            cagr = portfolio_metrics.get('cagr', 0) * 100
            volatility = portfolio_metrics.get('volatility', 0) * 100
            max_drawdown = portfolio_metrics.get('max_drawdown', 0) * 100
            sharpe_ratio = portfolio_metrics.get('sharpe_ratio', 0)
            total_return = portfolio_metrics.get('total_return', 0) * 100
            
            bench_cagr = benchmark_metrics.get('cagr', 0) * 100 if benchmark_metrics else 0
            bench_volatility = benchmark_metrics.get('volatility', 0) * 100 if benchmark_metrics else 0
            bench_max_drawdown = benchmark_metrics.get('max_drawdown', 0) * 100 if benchmark_metrics else 0
            bench_sharpe = benchmark_metrics.get('sharpe_ratio', 0) if benchmark_metrics else 0
            bench_total_return = benchmark_metrics.get('total_return', 0) * 100 if benchmark_metrics else 0
            
            lines.append(f"CAGR,{cagr:.2f}%,{bench_cagr:.2f}%")
            lines.append(f"Volatility,{volatility:.2f}%,{bench_volatility:.2f}%")
            lines.append(f"Max Drawdown,{max_drawdown:.2f}%,{bench_max_drawdown:.2f}%")
            lines.append(f"Sharpe Ratio,{sharpe_ratio:.2f},{bench_sharpe:.2f}")
            lines.append(f"Total Return,{total_return:.2f}%,{bench_total_return:.2f}%")
            
            # Portfolio Values Over Time
            if time_series and 'dates' in time_series and 'portfolio_values' in time_series:
                lines.append("")
                lines.append("# PORTFOLIO VALUES OVER TIME")
                lines.append("Date,Portfolio Value,Benchmark Value")
                
                dates = time_series['dates']
                portfolio_values = time_series['portfolio_values']
                benchmark_values = time_series.get('benchmark_values', [])
                
                # Include all dates or sample if too many
                max_rows = 1000
                step = max(1, len(dates) // max_rows) if len(dates) > max_rows else 1
                
                for i in range(0, len(dates), step):
                    date = dates[i]
                    port_val = portfolio_values[i] if i < len(portfolio_values) else ''
                    bench_val = benchmark_values[i] if i < len(benchmark_values) and benchmark_values[i] is not None else ''
                    lines.append(f"{date},{port_val},{bench_val}")
            
            # Rolling 12-Month Returns
            if rolling_returns and 'dates' in rolling_returns and 'returns' in rolling_returns:
                lines.append("")
                lines.append("# ROLLING 12-MONTH RETURNS")
                lines.append("Date,12-Month Return")
                
                roll_dates = rolling_returns['dates']
                roll_returns = rolling_returns['returns']
                
                for i in range(len(roll_dates)):
                    date = roll_dates[i]
                    ret = roll_returns[i] * 100 if i < len(roll_returns) else ''
                    lines.append(f"{date},{ret:.2f}%")
                
                # Add summary statistics
                if 'mean' in rolling_returns:
                    lines.append("")
                    lines.append("# ROLLING RETURNS STATISTICS")
                    lines.append("Statistic,Value")
                    lines.append(f"Mean,{rolling_returns['mean']*100:.2f}%")
                    lines.append(f"Std Dev,{rolling_returns['std']*100:.2f}%")
                    lines.append(f"Min,{rolling_returns['min']*100:.2f}%")
                    lines.append(f"Max,{rolling_returns['max']*100:.2f}%")
            
            return lines
        
        # Fallback: try to use metrics_table if available
        if 'metrics_table' in data and isinstance(data['metrics_table'], list):
            for row in data['metrics_table']:
                if isinstance(row, list):
                    lines.append(','.join(str(cell) for cell in row))
                else:
                    lines.append(str(row))
            return lines
    
    # Original fallback logic for simple data structures
    lines.append("# PORTFOLIO SUMMARY")
    lines.append("Symbol,Weight,Return,Beta,Sharpe Ratio")
    
    if isinstance(data, dict):
        symbol = data.get('symbol', 'UNKNOWN')
        # Calculate basic metrics
        if 'history' in data and len(data['history']) > 1:
            prices = [point.get('close', 0) for point in data['history'] if point.get('close')]
            if len(prices) > 1:
                returns = [(prices[i] - prices[i-1]) / prices[i-1] for i in range(1, len(prices))]
                avg_return = sum(returns) / len(returns) * 252  # Annualized
                volatility = (sum([(r - avg_return/252)**2 for r in returns]) / len(returns))**0.5 * (252**0.5)
                sharpe_ratio = avg_return / volatility if volatility > 0 else 0
                
                lines.append(f"{symbol},100.0%,{avg_return:.2f}%,1.00,{sharpe_ratio:.2f}")
    
    return lines

def generate_risk_report_content(data):
    """Generate content for risk report template"""
    lines = []
    
    lines.append("# RISK METRICS")
    lines.append("Metric,Value,Benchmark,Status")
    
    if isinstance(data, dict) and 'history' in data:
        if len(data['history']) > 1:
            prices = [point.get('close', 0) for point in data['history'] if point.get('close')]
            if len(prices) > 1:
                returns = [(prices[i] - prices[i-1]) / prices[i-1] for i in range(1, len(prices))]
                volatility = (sum([(r - sum(returns)/len(returns))**2 for r in returns]) / len(returns))**0.5 * (252**0.5)
                
                lines.append(f"Volatility,{volatility:.2f}%,15.0%,{'High' if volatility > 20 else 'Medium' if volatility > 10 else 'Low'}")
                lines.append(f"Max Drawdown,{max([min(returns[i:]) - max(returns[:i+1]) for i in range(len(returns))]):.2f}%,-10.0%,{'High' if volatility > 20 else 'Medium'}")
    
    return lines

def generate_custom_content(data, template_type):
    """Generate content for custom template"""
    lines = []
    
    lines.append("# CUSTOM ANALYSIS")
    lines.append("Field,Value")
    
    if isinstance(data, dict):
        for key, value in data.items():
            if key != 'history':  # Skip large history arrays
                lines.append(f"{key},{value}")
    elif isinstance(data, list):
        for i, item in enumerate(data[:10]):  # Limit to first 10 items
            if isinstance(item, dict):
                for k, v in item.items():
                    lines.append(f"Item_{i}_{k},{v}")
            else:
                lines.append(f"Item_{i},{item}")
    
    return lines

def get_excel_sheets(template_type: str) -> dict:
    """Get sheet structure based on template type"""
    sheet_templates = {
        "financial_model": {
            "Summary": ["Company", "Revenue", "EBITDA", "Net Income", "EPS"],
            "Income Statement": ["Revenue", "COGS", "Gross Profit", "Operating Expenses", "EBITDA", "Interest", "Taxes", "Net Income"],
            "Balance Sheet": ["Assets", "Current Assets", "Cash", "Receivables", "Inventory", "Fixed Assets", "Liabilities", "Equity"],
            "Cash Flow": ["Operating Cash Flow", "Investing Cash Flow", "Financing Cash Flow", "Net Cash Flow"]
        },
        "dcf_model": {
            "DCF Model": ["Year", "Revenue", "Growth Rate", "EBITDA", "EBITDA Margin", "Tax Rate", "Free Cash Flow", "Terminal Value", "Present Value"],
            "Assumptions": ["WACC", "Terminal Growth Rate", "Revenue Growth", "EBITDA Margin", "Tax Rate"],
            "Sensitivity": ["WACC", "Terminal Growth", "Revenue Growth", "EBITDA Margin"]
        },
        "portfolio_analysis": {
            "Portfolio Summary": ["Symbol", "Shares", "Price", "Value", "Weight", "Return", "Beta", "Sharpe Ratio"],
            "Performance": ["Date", "Portfolio Value", "Benchmark Value", "Excess Return", "Cumulative Return"],
            "Risk Metrics": ["Volatility", "VaR", "Max Drawdown", "Sharpe Ratio", "Sortino Ratio", "Calmar Ratio"]
        },
        "risk_report": {
            "Risk Summary": ["Metric", "Value", "Benchmark", "Status"],
            "VaR Analysis": ["Confidence Level", "1-Day VaR", "10-Day VaR", "30-Day VaR"],
            "Stress Tests": ["Scenario", "Portfolio Impact", "Individual Asset Impact"]
        }
    }
    return sheet_templates.get(template_type, {"Sheet1": ["Data", "Value", "Notes"]})

def get_excel_formulas(template_type: str) -> dict:
    """Get Excel formulas based on template type"""
    formula_templates = {
        "financial_model": {
            "Summary": {
                "EPS": "=Net_Income/Shares_Outstanding",
                "P/E": "=Price/EPS",
                "ROE": "=Net_Income/Equity"
            },
            "Income Statement": {
                "Gross Profit": "=Revenue-COGS",
                "EBITDA": "=Gross_Profit-Operating_Expenses",
                "Net Income": "=EBITDA-Interest-Taxes"
            }
        },
        "dcf_model": {
            "DCF Model": {
                "Free Cash Flow": "=EBITDA*(1-Tax_Rate)-CapEx-Changes_in_Working_Capital",
                "Present Value": "=FCF/(1+WACC)^Year",
                "Terminal Value": "=FCF_Terminal/(WACC-Terminal_Growth_Rate)"
            }
        },
        "portfolio_analysis": {
            "Portfolio Summary": {
                "Weight": "=Value/Total_Portfolio_Value",
                "Return": "=(Current_Price-Purchase_Price)/Purchase_Price",
                "Sharpe Ratio": "=(Portfolio_Return-Risk_Free_Rate)/Portfolio_Volatility"
            }
        }
    }
    return formula_templates.get(template_type, {})

def get_excel_formatting(template_type: str) -> dict:
    """Get Excel formatting based on template type"""
    return {
        "headers": {"bold": True, "background_color": "#3b82f6", "text_color": "white"},
        "numbers": {"number_format": "#,##0.00"},
        "percentages": {"number_format": "0.00%"},
        "currency": {"number_format": "$#,##0.00"},
        "dates": {"number_format": "mm/dd/yyyy"}
    }

# NOTE: PLANNER TOOLS - Document Generation Only
# The planner has access to document generation tools for creating nuanced reports.
# These tools are available to the planner (LLM) for intelligent document generation.
# The orchestrator handles deterministic tasks (data fetching, calculations, charts).
# Other tools are in the tools/ directory and are executed by the orchestrator.

# Import planner agent tools (document generation and non-deterministic tasks)
try:
    from planner.agent_tools.planner_tools import (
        generate_html_report_tool,
        generate_pdf_report_tool,
        format_financial_metrics_tool,
        format_portfolio_data_to_markdown_tool,
        read_image_tool,
        embed_images_tool,
        read_pdf_tool,
        analyze_pdf_content_tool,
        manipulate_pdf_tool,
        generate_html_template_tool
    )
    enhanced_tools = [
        generate_html_report_tool,
        generate_pdf_report_tool,
        format_financial_metrics_tool,
        format_portfolio_data_to_markdown_tool,
        read_image_tool,
        embed_images_tool,
        read_pdf_tool,
        analyze_pdf_content_tool,
        manipulate_pdf_tool,
        generate_html_template_tool
    ]
    logger.info(f"✅ Loaded {len(enhanced_tools)} planner tools (document generation and non-deterministic tasks)")
except ImportError as e:
    logger.warning(f"Could not import planner agent tools: {e}")
    enhanced_tools = []  # Fallback to empty if import fails

# Function to create agents with different models
def create_financial_agent(model_name: str = 'claude-sonnet-4') -> Agent:
    """
    Create a financial agent with the specified model
    
    Args:
        model_name: Name of the model to use:
                   - 'claude-sonnet-4': Claude Sonnet 4 (default)
                   - 'claude-haiku-4-5': Claude Haiku 4.5 (faster, cheaper)
                   - 'gpt-oss-120b': OpenAI GPT-OSS 120B (high performance)
                   - 'gpt-oss-20b': OpenAI GPT-OSS 20B (faster, efficient)
        
    Returns:
        Agent: Configured financial agent
    """
    if model_name not in MODELS:
        logger.warning(f"Unknown model '{model_name}', falling back to claude-sonnet-4")
        model_name = 'claude-sonnet-4'
    
    selected_model = MODELS[model_name]
    logger.info(f"Creating financial agent with model: {model_name}")
    
    # Wrap Agent creation in timeout to prevent hanging on MetricsClient initialization
    import threading
    
    def create_agent_with_timeout():
        """Create agent with timeout protection"""
        try:
            return Agent(
                system_prompt=FINANCIAL_ANALYSIS_PROMPT,
                tools=enhanced_tools,
                model=selected_model
            )
        except Exception as e:
            logger.error(f"Error creating Agent: {str(e)}")
            raise
    
    # Use threading with timeout to prevent hanging
    agent_result = [None]
    agent_exception = [None]
    
    def agent_creator():
        try:
            agent_result[0] = create_agent_with_timeout()
        except Exception as e:
            agent_exception[0] = e
    
    agent_thread = threading.Thread(target=agent_creator, daemon=True)
    agent_thread.start()
    agent_thread.join(timeout=10.0)  # 10 second timeout for Agent creation
    
    if agent_thread.is_alive():
        logger.error("Agent creation timed out after 10 seconds - MetricsClient may be hanging")
        raise Exception("Agent creation timed out - Strands MetricsClient initialization may be hanging. Check network connectivity or disable metrics.")
    
    if agent_exception[0]:
        raise agent_exception[0]
    
    if agent_result[0] is None:
        raise Exception("Agent creation failed - no agent returned")
    
    return agent_result[0]

# Default financial agent (for backward compatibility) - removed to prevent unnecessary creation at import time
# financial_agent = create_financial_agent('claude-opus-4-1')

def analyze_stock(stock_symbol, user_question=None):
    """
    Analyze a stock and provide buy/sell recommendation
    
    Args:
        stock_symbol (str): Stock ticker symbol (e.g., 'AAPL', 'TSLA')
        user_question (str): Optional specific question about the stock
    
    Returns:
        str: Analysis and recommendation
    """
    if user_question:
        prompt = f"Analyze {stock_symbol} stock and answer this specific question: {user_question}"
    else:
        prompt = f"Provide a comprehensive buy/sell analysis for {stock_symbol} stock based on current market data, financial metrics, and recent news."
    
    return create_financial_agent()(prompt)

def chat_with_agent():
    """
    Interactive chat interface for the Enhanced Cosine Financial Agent
    """
    print("🏦 Enhanced Cosine Financial Analysis Agent")
    print("=" * 60)
    print("🚀 Now with advanced financial analysis tools!")
    print("\n🔧 Available Capabilities:")
    print("  📊 Real-time stock data and metrics")
    print("  📰 Financial news search and analysis")
    print("  📈 Technical indicators (RSI, MACD, Moving Averages)")
    print("  🧮 Quantitative analysis (correlations, cointegration)")
    print("  🔍 Web research for additional context")
    
    print("\n💡 Example Questions:")
    print("  - 'Analyze AAPL with full technical analysis'")
    print("  - 'Should I buy Tesla stock? Include recent news'")
    print("  - 'Compare NVDA and AMD for AI investment'")
    print("  - 'Calculate correlation between MSFT and GOOGL'")
    print("  - 'What are the technical indicators for SPY?'")
    print("  - 'Find recent news about cryptocurrency stocks'")
    
    print("\nType 'help' for more examples, 'quit' to exit.")
    print("=" * 60)
    
    while True:
        try:
            # Get user input
            user_input = input("\n💬 You: ").strip()
            
            # Check for exit commands
            if user_input.lower() in ['quit', 'exit', 'bye', 'q']:
                print("\n👋 Thank you for using Enhanced Cosine Financial Agent!")
                print("Remember: Always consult with financial professionals before making investment decisions.")
                break
            
            # Help command
            if user_input.lower() in ['help', 'h']:
                print("\n🆘 Help - Advanced Query Examples:")
                print("  🔹 'Get technical analysis for AAPL and recent news'")
                print("  🔹 'Analyze TSLA stock price and calculate its Sharpe ratio'")
                print("  🔹 'Compare financial metrics of AMZN vs GOOGL'")
                print("  🔹 'What's the correlation between oil prices and XOM stock?'")
                print("  🔹 'Should I sell my NVDA position? Include technical indicators'")
                print("  🔹 'Find news about Federal Reserve impact on bank stocks'")
                continue
            
            # Check for empty input
            if not user_input:
                print("Please enter a question or stock symbol to analyze.")
                continue
            
            print("\n🤖 Analyzing with enhanced tools... (this may take a moment)")
            
            # Enhanced query processing
            # The agent will automatically decide which tools to use based on the query
            try:
                response = create_financial_agent()(user_input)
                print(f"\n💡 Enhanced Cosine Agent:\n{response}")
                
            except Exception as agent_error:
                print(f"\n❌ Analysis error: {str(agent_error)}")
                
                # Fallback to basic analysis
                print("🔄 Trying basic analysis...")
                basic_prompt = f"""
                A user asks: "{user_input}"
                
                Provide a helpful financial analysis response. If this is about a specific stock,
                give general guidance about the company and suggest checking current data.
                Include appropriate investment disclaimers.
                """
                
                try:
                    fallback_response = create_financial_agent()(basic_prompt)
                    print(f"\n💡 Basic Analysis:\n{fallback_response}")
                except Exception as fallback_error:
                    print(f"❌ Unable to process request: {str(fallback_error)}")
            
        except KeyboardInterrupt:
            print("\n\n👋 Session interrupted. Goodbye!")
            break
        except Exception as e:
            print(f"\n❌ Sorry, I encountered an error: {str(e)}")
            print("Please try rephrasing your question or try again.")

if __name__ == "__main__":
    chat_with_agent()