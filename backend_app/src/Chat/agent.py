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
        # Configure connection pooling (https only - no plain HTTP)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=20,
            max_retries=3
        )
        _requests_session.mount('https://', adapter)
    return _requests_session

# Import tools from strands-agents-tools (available in Lambda layer)
from strands_tools import http_request
from strands_tools import calculator

# Import the tool decorator from Strands (available in Lambda layer)
from strands import tool

# Import our custom financial calculator tool module
from tools.financial_calculator import python_financial_calculator, EnhancedFinancialCalculator

# Import our custom session database access tool
from tools.session_database_access import get_session_files_tool, get_session_context_tool, SessionDatabaseAccess
from tools.crypto_data_fetcher import get_crypto_data_tool, compare_crypto_tool
from tools.pdf_tool import read_pdf_tool
from tools.sec_edgar_api import get_company_cik, get_company_filings, get_filing_document, search_sec_filings, get_filing_exhibits, download_filing_pdf
from tools.chart_generator import generate_chart_tool, generate_stock_chart
from tools.excel_generator import generate_excel_with_charts_tool
from tools.chat_history_tool import get_chat_history_tool, search_chat_history_tool
from tools.chat_session_context_tool import process_chat_session_context_tool, analyze_chat_session_context_tool
from tools.web_scraper import fetch_web_content_tool
from tools.stock_data_fetcher import (
    get_financial_data,
    get_multiple_financial_data,
    search_financial_news,
    get_technical_analysis,
    analyze_portfolio,
    calculate_stock_correlation,
    get_volatility_surface,
    StockDataFetcher
)
from tools.congress_bills_search import search_congress_bills
from tools.govt_contracts_search import search_govt_contracts
from tools.govt_contracts_autocomplete_tool import govt_contracts_autocomplete
from tools.politician_trades_search import search_politician_trades
from tools.lda_autocomplete_tool import lda_autocomplete
from tools.lda_search_tool import lda_search
from tools.search_autocomplete_tool import search_autocomplete
from tools.datetime_tool import get_current_datetime, calculate_date_range
from tools.document_index_tool import get_document_index_tool, get_document_by_id_tool

# Financial Analysis Tools
class FinancialTools:
    """Enhanced financial analysis tools for the FinGov agent"""
    
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
                        result = FinancialTools._convert_s3_to_standard_format(s3_data, symbol, timeframe)
                    else:
                        # Try medium priority
                        s3_data = s3_helper.get_stock_data_from_s3(symbol, timeframe, priority='medium')
                        if s3_data:
                            logger.info(f"✅ Loaded {symbol} from S3 historical data (priority: medium)")
                            result = FinancialTools._convert_s3_to_standard_format(s3_data, symbol, timeframe)
                except Exception as s3_error:
                    logger.debug(f"S3 lookup failed for {symbol}: {str(s3_error)}, falling back to yfinance")
            
            # If S3 didn't work or it's a small timeframe, use yfinance
            if result is None:
                logger.debug(f"Fetching {symbol} from yfinance (timeframe: {timeframe})")
            result = FinancialTools._fetch_from_yfinance(symbol, timeframe, start_date, end_date)
            
            # Check for errors
            if isinstance(result, dict) and result.get('status') == 'error':
                return result
            
            # Determine if data is large enough to store in S3
            data_points = len(result.get('historical_data', []))
            data_size = len(json.dumps(result))
            LARGE_DATA_THRESHOLD = 50000  # 50KB
            LARGE_POINTS_THRESHOLD = 500  # 500 data points
            
            should_store_in_s3 = data_size > LARGE_DATA_THRESHOLD or data_points > LARGE_POINTS_THRESHOLD
            
            if should_store_in_s3:
                # Store in data-files and return S3 key
                try:
                    import boto3
                    import os
                    from datetime import datetime
                    
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
            from utils.compression_helper import CompressionHelper
            
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
You are a professional financial analyst assistant for FinGov, a government financial research platform with REAL-TIME DATA ACCESS.

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
8. read_s3_file_tool(s3_key, file_type) - Read and analyze files uploaded by users to S3 (including PDFs). Automatically decrypts .cosine encrypted context items. **AUTOMATICALLY detects document types (SEC filings, financial PDFs, etc.) and extracts structured financial data. Prefer this for PDFs first; use read_pdf_tool only for large PDFs when page-by-page reading is needed.**
9. get_session_files_tool(session_id, user_id, file_type) - Retrieve uploaded files for a specific session from the database
10. get_session_context_tool(session_id, user_id) - Get complete session context including files and context items
11. get_chat_history_tool(session_id, user_id, limit, include_recent) - Get chat history on-demand with smart pagination
12. search_chat_history_tool(session_id, user_id, search_term, limit) - Search chat history for specific terms or topics
13. process_chat_session_context_tool(session_id, user_id, context_items) - Process chat session context items added from history sidebar
14. analyze_chat_session_context_tool(session_id, user_id, context_items, analysis_type) - Analyze chat session context for insights and summaries
15. get_crypto_data_tool(symbol, timeframe, start_date, end_date) - Get real-time cryptocurrency data for analysis with flexible timeframes
16. compare_crypto_tool(symbols, timeframe, start_date, end_date) - Compare multiple cryptocurrencies side by side with flexible timeframes
17. read_pdf_tool(s3_key, page_numbers=None, s3_bucket=None) - Read text from a PDF in S3. Handles context files and user uploads; decrypts .cosine if needed. Pass page_numbers as a list of 1-indexed pages (e.g. [1, 2, 5]) or omit to read all pages. Use for any PDF (prefer read_s3_file_tool first for auto-detection and structured financials; use read_pdf_tool when you need specific pages or raw text).
18. generate_chart_tool(symbol, data_json, chart_type, title) - Generate unified charts for both stocks and crypto using matplotlib (line, candlestick, volume, ohlc) and save directly to S3. Requires pre-fetched data from get_financial_data or get_crypto_data_tool.
19. generate_stock_chart(symbol, timeframe, chart_type, title, start_date, end_date) - Convenience tool: Fetch stock data and generate chart in one step. Use this for simpler stock chart requests when you don't already have the data.
20. return_session_files_wrapper(file_indices) - Return files from current session to user
21. create_agent_file_wrapper(filename, content, file_type) - Create new files for current session
22. generate_excel_file_tool(filename, content, template_type, include_charts) - Generate CSV files for financial analysis that can be opened in Excel (agent prepares content first)
23. get_company_cik(symbol) - Get Central Index Key (CIK) for a company by ticker symbol
24. get_company_filings(cik, form_type, limit) - Get recent SEC filings for a company
25. get_filing_document(cik, accession_number, document_name) - Get full text content of SEC filing
26. search_sec_filings(company_name, form_type, start_date, end_date, limit) - Search SEC filings by criteria
27. get_filing_exhibits(cik, accession_number) - Get all exhibits for a specific SEC filing
28. download_filing_pdf(cik, accession_number, document_name, save_to_s3) - Download SEC filing as PDF
29. fetch_web_content_tool(url) - Fetch and extract content from web URLs, especially for article context items. Use this when context items have type "article" and contain URLs.
30. search_congress_bills(filters, limit, last_evaluated_key, roll_call_search, question_date, roll_call_details) - Search congressional bills, roll call lists, OR fetch full details for one roll call. For full details of a single roll call (e.g. when user has roll call in context), use roll_call_details: pass the context item's data as JSON; **always include search_index_sk when the context item has it** (exact PK/SK lookup). Example: roll_call_details='{"search_index_sk": "119#2026-01-15#1#40"}' or '{"congress": 119, "session": 1, "roll": 40}'. For bill search use filters; for roll call list use roll_call_search (SEARCH#VOTE or SEARCH#ROLL). Use question_date to default congress when needed.
31. search_govt_contracts(filters, limit, last_evaluated_key) - Search government contracts/awards in DynamoDB
32. govt_contracts_autocomplete(search_text, autocomplete_type, limit) - Get exact values for search_govt_contracts filters. Types: recipient, awarding_agency, funding_agency, cfda, naics, psc, city, location, program_activity, glossary. Use before search when the user gives generic or natural-language terms for any of these fields.
33. search_politician_trades(filters, page, page_size, last_evaluated_key) - Search politician stock trades in DynamoDB
34. lda_autocomplete(query, field_types, limit) - LDA autocomplete tool for finding registrants, clients, lobbyists, PACs, foreign entities
35. lda_search(filters, limit, last_evaluated_key) - LDA search tool for searching lobbying disclosures
36. search_autocomplete(query, list_type, limit) - Search autocomplete tool for matching natural language queries to CSV list values (policy areas, general issues, government entities, legislators)
37. get_current_datetime() - Get current date/time for exact timeframe calculations
38. calculate_date_range(period, start_date, end_date) - Calculate date ranges relative to current date

🚨 CRITICAL: You have file return capabilities! When users want files, use return_session_files_wrapper()!

🔍 SEARCH AUTocomplete AND NATURAL LANGUAGE MATCHING:
When users ask about searching for bills, LDA filings, or other data using natural language (e.g., "renewable energy", "healthcare", "environmental protection"), you MUST use search_autocomplete() to match their query to the correct CSV list values.

**CRITICAL RULES:**
1. **ALWAYS use search_autocomplete() BEFORE performing searches** when users use natural language terms that might match CSV list values
2. **Use the CORRECT list_type for each search type:**
   - For Congress Bills searches: Use 'policy_area' or 'congress_legislator'
   - For LDA searches: Use 'general_issue' or 'government_entity'
   - NEVER use policy_area for LDA searches or general_issue for Congress Bills searches

**List Type Mapping:**
- 'policy_area': Used in Congress Bills search (policy_area filter)
  - Examples: "Energy", "Health", "Education", "Environmental Protection"
  - Natural language matches: "renewable energy" → "Energy", "healthcare" → "Health", "environment" → "Environmental Protection"
- 'general_issue': Used in LDA search (general_issue_code filter)
  - Examples: "ENG" (Energy), "HCR" (Health Care), "EDU" (Education)
  - Natural language matches: "renewable energy" → "ENG", "healthcare" → "HCR"
- 'government_entity': Used in LDA search (government_entity filter)
  - Examples: "Energy, Dept of", "Health & Human Services, Dept of", "Education, Dept of"
  - Natural language matches: "energy department" → "Energy, Dept of", "HHS" → "Health & Human Services, Dept of"
- 'congress_legislator': Used in Congress Bills search (sponsor_name, cosponsor_name filters)
  - Examples: "John Smith", "Jane Doe" (active Congress members)
  - Natural language matches: "Senator Smith" → "John Smith", "Representative Doe" → "Jane Doe"

**Workflow for Natural Language Queries:**
1. User asks: "Can you search for any bills passed recently which have to do with renewable energy?"
2. Recognize this is a Congress Bills search about a policy area
3. Call: search_autocomplete("renewable energy", "policy_area")
4. Get best match: "Energy" (score: 0.85)
5. Use "Energy" in search_congress_bills() with policy_area filter

**Examples:**
- User: "Search for bills about renewable energy" 
  → search_autocomplete("renewable energy", "policy_area") → "Energy" → search_congress_bills(policy_area=["Energy"])
- User: "Find LDA filings related to healthcare"
  → search_autocomplete("healthcare", "general_issue") → "HCR" → lda_search(general_issue_code=["HCR"])
- User: "Show me bills sponsored by Senator Smith"
  → search_autocomplete("Senator Smith", "congress_legislator") → "John Smith" → search_congress_bills(sponsor_name=["John Smith"])
- User: "How did Senator X vote on recent roll calls?" or "Show roll call votes for Maria Cantwell"
  → search_autocomplete("Maria Cantwell", "congress_legislator") → get politician_id (e.g. "C000127") from matches → search_congress_bills(roll_call_search='{"search_index": "SEARCH#VOTE", "politician_ids": ["C000127"], "limit": 50}')
- User: "What were the recent roll calls in the current congress?"
  → search_congress_bills(roll_call_search='{"search_index": "SEARCH#ROLL", "limit": 20}', question_date=<today YYYY-MM-DD>) so congress defaults to most recent
- User: "Search for lobbying related to the Energy Department"
  → search_autocomplete("Energy Department", "government_entity") → "Energy, Dept of" → lda_search(government_entity=["Energy, Dept of"])

**IMPORTANT:**
- The search_autocomplete tool uses fuzzy matching to handle natural language variations
- It returns a "best_match" with a similarity score - use the best match if score > 0.5
- If no good match is found (score < 0.5), inform the user and suggest alternative terms
- Always verify the list_type matches the search type (Congress Bills vs LDA) before using the matched value

🔍 CONGRESS BILLS AND LDA SEARCH BEST PRACTICES:
**CRITICAL: Fetch Incrementally and Check Results Early**

When users ask for searches (e.g., "recent bills about renewable energy", "clean energy bills"):
1. **Use small limits initially (10-20 items)** - Don't fetch hundreds of items at once
2. **Check the first batch** - Review the first 10 results to see if they match the user's intent
3. **Only continue if needed** - If the first batch doesn't have what the user wants, use pagination (last_evaluated_key) to fetch more
4. **Don't dig deep automatically** - Only fetch more results if the user explicitly asks or if the first batch clearly doesn't match

**Workflow Example:**
- User: "Can you search for any bills passed recently which have to do with renewable energy?"
- Step 1: Use search_autocomplete("renewable energy", "policy_area") → Get "Energy"
- Step 2: Call search_congress_bills({"policy_area": ["Energy"], "introduced_date_from": "2025-01-01"}, limit=10)
- Step 3: Check the 10 results - look for bills with "clean energy", "renewable", "solar", "wind" in titles
- Step 4: If good matches found, present them. If not, use last_evaluated_key to fetch next 10
- Step 5: Only continue paginating if user explicitly asks for more or if results are clearly not matching

**Default Limits:**
- search_congress_bills: Default limit=10 (matches frontend page size)
- lda_search: Default limit=10 (matches frontend page size)
- Only increase limit if user explicitly asks for more results or you need to search deeper

**Pagination:**
- Use last_evaluated_key from previous search to get next batch
- Don't fetch all results upfront - fetch incrementally as needed
- The tool will return has_more=true if more results are available

**Roll call details (single roll, e.g. from context):**
- When the user has a roll call in context or asks for full vote details for a specific roll call, use search_congress_bills(roll_call_details=<JSON>). **If the context item has search_index_sk in data, include it in the JSON** so the backend does an exact lookup (e.g. roll_call_details='{"search_index_sk": "119#2026-01-15#1#40"}'). Otherwise use congress, session, roll from context (e.g. roll_call_details='{"congress": 119, "session": 1, "roll": 40}').
**Roll call search (list):**
- When the user asks about a politician's votes or "roll call" record: (1) search_autocomplete("politician name", "congress_legislator") to get politician_id from matches, (2) search_congress_bills(roll_call_search='{"search_index": "SEARCH#VOTE", "politician_ids": ["<politician_id>"], "limit": 50}').
- When the user asks for "recent roll calls" or "current congress roll calls" without a date: use get_current_datetime("date") and pass it as question_date so congress defaults to the most recent. Call search_congress_bills(roll_call_search='{"search_index": "SEARCH#ROLL", "limit": 20}', question_date=<today>).
- Roll call searches should always use autocomplete for politician names to get correct politician_id (bioguide_id).

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

🚨 CONTEXT-FIRST RULE (CRITICAL):
Before performing ANY new search, ALWAYS check if the user might be referring to items already in context:
1. **ALWAYS check context first** when the query is ambiguous (e.g., "this contract", "the contract", "check transactions", "how many are there")
2. **Use get_session_context_tool(session_id, user_id)** to check for relevant context items BEFORE running new searches
3. **If context items are found** that match the query (e.g., govt_contract_award when user asks about "this contract"), USE THEM instead of running a new search
4. **Only perform new searches** if no relevant context items are found OR if the user explicitly asks for a new search (e.g., "search for contracts", "find contracts")

**Examples:**
- User: "Check the transactions now, how many are there in this contract?" 
  → MUST check context first → If govt_contract_award found in context → Use that award_id → Query DynamoDB with award_id
  → DO NOT run search_govt_contracts(filters={"recipient_name": [...]})
- User: "Explain this contract"
  → Check context first → If contract in context → Use it
- User: "Search for Iowa DOT contracts"
  → User explicitly asks for search → Run search query

**When to Check Context:**
- "this [item]", "the [item]", "that [item]" (referring to something)
- "check [something]", "see [something]", "look at [something]" (may reference context)
- "how many", "what are the" (may be asking about context items)
- Any question that could refer to previously added context items

**When NOT to Check Context:**
- User explicitly says "search for", "find", "lookup"
- User provides specific search criteria (e.g., "search for contracts with recipient_name X")
- User asks for new data (e.g., "show me all contracts from 2025")

📋 CONTEXT TOOLS USAGE:
- get_session_context_tool(session_id, user_id) - For files, context items, and session variables
- get_chat_history_tool(session_id, user_id, limit, include_recent) - For previous conversations
- search_chat_history_tool(session_id, user_id, search_term, limit) - For specific topics in chat history
- process_chat_session_context_tool(session_id, user_id, context_items) - For chat sessions added from history sidebar
- analyze_chat_session_context_tool(session_id, user_id, context_items, analysis_type) - For analyzing multiple chat sessions

🏛️ GOVERNMENT CONTRACT TRANSACTIONS - AUTOMATIC FETCHING (CRITICAL):
🚨 **CRITICAL RULE**: When users ask about transactions for a contract that is IN CONTEXT, you MUST:
1. Use the contract FROM CONTEXT (get_session_context_tool) - DO NOT run a fresh search
2. Extract the award_id from the context contract's data field
3. Query DynamoDB with that SPECIFIC award_id to get transactions
4. DO NOT search by recipient_name or other fields - use award_id from context

**STEP-BY-STEP WORKFLOW (MANDATORY):**
User asks: "can you see any of the transactions within this contract?" OR "Check the transactions now, how many are there?"

Agent MUST execute in this exact order:
  1. get_session_context_tool(session_id, user_id) 
     → Returns: context_items array with contract award
  2. Find contract in context_items where type = "govt_contract_award"
  3. Extract award_id from contract.data.award_id 
     → Example: "ASST_NON_693JJ22030000ZS50IARR01208_069"
  4. Query DynamoDB: search_govt_contracts(filters={"award_id": [award_id]}, limit=1)
     → This returns the FULL award record with transactions field
  5. Extract transactions array: result.results[0].transactions
     → This is an array of transaction objects
  6. Parse each transaction and display:
     - transaction_unique_key (or transaction_id)
     - action_date (transaction date)
     - federal_action_obligation (amount - can be positive or negative)
     - transaction_description (project description)
     - action_type_description ("REVISION", "NEW", etc.)
     - modification_number

**Example Output Format:**
"Found 3 transactions for this contract:

Transaction 1:
- ID: ASST_TX_6925_693JJ22030000ZS50IARR01208_...
- Date: Jun 5, 2025
- Amount: $63,263
- Type: REVISION
- Description: PROJECT TITLE: MARION COUNTY, SOUTH LINCOLN STREET/IA 14 - INSTALLATION OF ACTIVE WARNING DEVICES...

Transaction 2:
- ID: ASST_TX_6925_693JJ22030000ZS50IARR01208_...
- Date: Jun 5, 2025
- Amount: -$196,228
- Type: REVISION
- Description: (same project)

Transaction 3:
- ID: ASST_TX_6925_693JJ22030000ZS50IARR01208_...
- Date: Aug 19, 2020
- Amount: $196,228
- Type: NEW
- Description: (same project)"

**🚨 CRITICAL - DO NOT:**
- ❌ Run search_govt_contracts(filters={"recipient_name": ["IOWA DEPARTMENT OF TRANSPORTATION"]}) - This searches ALL contracts, not the one in context
- ❌ Say "I can only see high-level award details" - You CAN get transactions by querying with award_id
- ❌ Skip fetching transactions when user explicitly asks about them
- ❌ Use recipient_name or other filters - ONLY use award_id from context

**✅ CRITICAL - MUST:**
- ✅ Always use get_session_context_tool FIRST to get the contract from context
- ✅ Extract award_id from context contract's data field
- ✅ Query DynamoDB with filters={"award_id": [award_id]} - this gets the specific contract with transactions
- ✅ Extract and display ALL transactions from the transactions array
- ✅ Show transaction amounts (positive and negative), dates, and descriptions

🏛️ GOVERNMENT CONTRACT SEARCH AND COMPARISON — USE AUTOCOMPLETE FOR EXACT VALUES:
The search index uses exact/normalized values. **Use govt_contracts_autocomplete BEFORE search_govt_contracts** whenever the user gives a generic or natural-language term for any of these filters:

- **recipient_name** → autocomplete_type "recipient" (e.g. "university", "Lockheed") — literal "UNIVERSITY" returns 0 results; get exact names first.
- **awarding_agency_name** → autocomplete_type "awarding_agency" (e.g. "Department of Energy", "Defense").
- **funding_agency_name** → autocomplete_type "funding_agency".
- **cfda_number** → autocomplete_type "cfda" (program numbers).
- **naics_code** → autocomplete_type "naics" (industry codes).
- **psc_code** → autocomplete_type "psc" (product/service codes).
- **Location/city** → autocomplete_type "city" or "location".
- **program_activity**, **glossary** → use for program or term lookup.

When the user asks to **compare** a contract (e.g. ASU DOE) with other schools, agencies, or "university" contracts:
1. Call govt_contracts_autocomplete(search_text="university", autocomplete_type="recipient", limit=10) to get exact recipient names.
2. **Pick a few comparables** (e.g. 3–5): same region/state, same type (public/private), or similar scale. For a defense contract, use autocomplete for agency or recipient as needed and pick comparable recipients.
3. Call search_govt_contracts with **exact values** from autocomplete (recipient_name list, awarding_agency_name, etc.), plus fiscal_year as needed.
4. **Avoid context overflow**: Prefer limit=5–10; do NOT read huge S3 JSON into context. Summarize from metadata or a small result set.

**Example:** "Compare with other universities" → govt_contracts_autocomplete("university", "recipient", 10) → pick 3–5 names → search_govt_contracts(filters={"awarding_agency_name": "Department of Energy", "recipient_name": ["UNIVERSITY OF TEXAS AT AUSTIN", "STANFORD UNIVERSITY", ...], "fiscal_year": [2024, 2025]}, limit=10).

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
   - **AUTOMATIC INDEXING**: SEC filings and financial documents are automatically detected and indexed
   - Structured financial data (revenue, margins, cash flow, debt) is extracted automatically
4. get_document_index_tool(user_id, document_type, company_name) → Query indexed financial data across documents
5. get_document_by_id_tool(document_id) → Get specific indexed document with full financial data
6. Use file content for analysis, calculations, or context
7. Provide insights based on file data combined with market data

**Example Workflow:**
- User uploads SEC 10-K filing → read_s3_file_tool() automatically extracts all financials
- Query: "What are all the 10-K filings I've uploaded?" → get_document_index_tool(user_id, "sec_10k")
- Query: "Compare revenue across my Walmart filings" → get_document_index_tool(user_id, company_name="Walmart")

🔐 .COSINE FILE DECRYPTION:
- .cosine files are encrypted context items stored in the user's filesystem (users/{user_id}/filesys/*)
- These files contain encrypted context data (news articles, SEC filings, LDA disclosures, politician trades, etc.)
- The read_s3_file_tool automatically decrypts .cosine files when you read them - no special action needed
- When you see a file with .cosine extension in session context or file listings, you can read it normally using read_s3_file_tool(s3_key)
- The tool will automatically:
  1. Detect the .cosine extension
  2. Extract the user_id from the S3 key path
  3. Decrypt the file using the decryption helper
  4. Return the decrypted JSON data for analysis
- Example: If you see "users/abc123/filesys/folder/item.cosine" in file listings, simply call read_s3_file_tool("users/abc123/filesys/folder/item.cosine")
- The decrypted content will be a JSON object with context item data (type, title, subtitle, timestamp, and content fields)
- NEVER say ".cosine files are encrypted and cannot be read" - they CAN be read and decrypted automatically!

📁 FILESYSTEM OBJECT HANDLING:
When you encounter filesystem objects in session context (items with type "context_item" that have S3 keys in the users/{user_id}/filesys/* path):

**CRITICAL: ALWAYS DECRYPT .COSINE FILES FROM CONTEXT ITEMS**
- When you see a context item with a title ending in ".cosine" or a subtitle indicating it's a filesystem item, you MUST decrypt it
- Context items from the filesystem will have an "s3_key" field in their data structure
- To access the S3 key from a context item:
  - Check the context item's "data" field for "s3_key"
  - Or check if the context item has an "s3_key" field directly
  - The S3 key will be in the format: "users/{user_id}/filesys/{folder}/{filename}.cosine"
- Example context item structure:
  {
    "id": "...",
    "type": "context_item",
    "title": "Congress Bill.cosine",
    "subtitle": "...",
    "data": {
      "s3_key": "users/123/filesys/folder/Congress Bill.cosine"
    }
  }
- When you see this, IMMEDIATELY call: read_s3_file_tool(context_item["data"]["s3_key"]). If the context item has data.s3_bucket, also pass it: read_s3_file_tool(s3_key=context_item["data"]["s3_key"], s3_bucket=context_item["data"]["s3_bucket"]) so the file is read from the correct bucket (SEC filings, congress bills, LDA, politician trades, etc.).

**FOR NON-COSINE FILES:**
- Use read_s3_file_tool(s3_key, file_type) to read the file directly
- The tool automatically detects file type (including PDFs), routes to parsers when applicable, and extracts structured data (e.g. financials for PDF financial documents)
- For PDFs: Prefer read_s3_file_tool(s3_key) first for auto-detection and structured data. Use read_pdf_tool(s3_key, page_numbers=[1,2,...]) when you need specific pages or raw text (e.g. large PDFs: read pages incrementally)
- For other file types: Use read_s3_file_tool() and specialized tools as needed

**FOR .COSINE FILES (Encrypted Context Items):**
- .cosine files are encrypted context items that represent tiles or other context items
- These files contain metadata and S3 keys that reference underlying data (e.g., HTML files for indexed filings)
- To access .cosine files:
  1. Get the S3 key from the context item (from context_item["data"]["s3_key"] or context_item["s3_key"])
  2. Use read_s3_file_tool(s3_key) - it will automatically decrypt the file
  3. The decrypted content will be a JSON object with structure:
     {
       "type": "context_item_type",
       "title": "...",
       "subtitle": "...",
       "timestamp": "...",
       "data": {
         "s3_key": "path/to/underlying/data.html",  // This references the actual data file
         // ... other metadata
       }
     }
  4. After decrypting, check the "data.s3_key" field to find the underlying data file
  5. Use read_s3_file_tool(data.s3_key) to read the actual underlying data (HTML, JSON, etc.)
  6. For example:
     - Get S3 key from context: context_item["data"]["s3_key"] = "users/123/filesys/item.cosine"
     - Decrypt: read_s3_file_tool("users/123/filesys/item.cosine")
     - Get underlying data: read_s3_file_tool(decrypted_data["data"]["s3_key"])
- .cosine files are typically tiles (Congress Bill, SEC Filing, LDA Disclosure, etc.) that have been saved to the filesystem
- The underlying S3 key in the decrypted data points to the actual indexed filing HTML, JSON data, or other source material
- Always decrypt .cosine files first, then read the underlying data using the S3 key from the decrypted content
- NEVER skip decrypting .cosine files - if you see a context item with ".cosine" in the title or a filesystem path, you MUST decrypt it using read_s3_file_tool()

**WORKFLOW FOR FILESYSTEM OBJECTS:**
1. When you see a context item with ".cosine" in the title or filesystem path:
   a. Extract the S3 key from context_item["data"]["s3_key"] or context_item["s3_key"]
   b. IMMEDIATELY call read_s3_file_tool(s3_key) to decrypt it
   c. Parse the decrypted JSON to extract the underlying S3 key from data.s3_key
   d. Use read_s3_file_tool() again with the underlying S3 key to read the actual data
2. If it's a non-cosine file:
   a. Get the S3 key from the context item
   b. Use read_s3_file_tool() to read the file (for PDFs this auto-detects and extracts structured data when applicable)
   c. For PDFs: use read_pdf_tool(s3_key, page_numbers=[...]) when you need specific pages or raw text
3. Analyze and provide insights based on the file content

**EXAMPLES:**
- User: "Summarize this Congress Bill" and context has "Congress Bill.cosine"
  → Extract s3_key from context → read_s3_file_tool(s3_key) → Extract underlying s3_key → read_s3_file_tool(underlying_s3_key) → Summarize
- User: "What's in this SEC filing?" and context has "SEC Filing.cosine"
  → Extract s3_key from context → read_s3_file_tool(s3_key) → Extract underlying s3_key → read_s3_file_tool(underlying_s3_key) → Analyze

FOR CRYPTOCURRENCY QUESTIONS:
1. get_crypto_data_tool(symbol, timeframe) → Get real-time crypto data for a specific cryptocurrency
2. compare_crypto_tool(symbols, timeframe) → Compare multiple cryptocurrencies side by side
3. Use timeframe options: '1d', '7d', '30d', '1y' for different analysis periods
4. Provide analysis based on REAL crypto data including price, returns, and volatility
5. Compare crypto performance against traditional assets when relevant

FOR PDF FILE ANALYSIS:
- **Primary:** Use read_s3_file_tool(s3_key) for PDFs when you want auto-detection and structured financial data.
- **When you need pages or raw text:** Use read_pdf_tool(s3_key, page_numbers=None) to read all pages, or read_pdf_tool(s3_key, page_numbers=[1, 2, 5]) for specific 1-indexed pages. Use this for large PDFs (read pages incrementally to avoid token limits), context-item PDFs, or user-uploaded PDFs. Handles .cosine decrypt automatically.

📋 FILESYSTEM PDF READING (users/user_id/filesys/):
- Filesystem PDFs: users/{user_id}/filesys/{item_id}.pdf. Use the S3 key from context exactly as provided.
- Prefer read_s3_file_tool(s3_key) first. If the PDF is large, use read_pdf_tool(s3_key, page_numbers=[1]) to assess, then read_pdf_tool(s3_key, page_numbers=[2, 3, ...]) as needed.

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

🔹 AUTOMATIC DOCUMENT PROCESSING:
When you use read_s3_file_tool to read files, the system automatically:
- Detects document types (SEC filings, XBRL, financial statements, PDFs, etc.)
- Routes documents to specialized parsers when appropriate
- Extracts structured data (financial metrics, tables, etc.) when available
- Indexes extracted data for future queries

**For SEC filings and financial documents:**
- If a file is detected as an SEC filing (10-K, 10-Q, 8-K, etc.), it's automatically routed to the SEC parser
- The parser extracts structured financial data from iXBRL/XBRL tags when available
- The response may include both raw content and structured_data with exact financial numbers
- When structured_data is present, prioritize it over text-based summaries for financial metrics

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

📊 REPORT GENERATION (DEFAULT FORMAT):
- When the user asks for a "report" or to "generate a report" (or similar) without specifying a format, default to HTML: use create_agent_file_wrapper(filename, content, "html") or generate_agent_file_tool(filename, content, "html") so the output is a .html file.
- Use a different report type only when the user explicitly asks for it (e.g. "export as CSV", "PDF report", "Excel report", "give me a text file").

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
- read_pdf_tool(s3_key, page_numbers, s3_bucket) for PDF text from S3 (any source; decrypts .cosine)
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
8. **FOR LDA FILING CONTEXT ITEMS**:
   - When LDA filings are already in context (from the LDA Search UI or previous steps), they include an s3_key field in data.s3_key that points to the full filing document.
   - LDA filing context items have structure:
     {
       "type": "lda_filing",
       "title": "3rd Quarter - Report - CASSIDY & ASSOCIATES, INC.",
       "subtitle": "Posted: Oct 16, 2025 • 3rd Quarter (July 1 - Sep 30) • Year: 2025 • Amount: $80,000",
       "data": {
         "s3_key": "filings/Q3/0a1dfd26-af61-473c-bd47-89f48762689d.html",
         "registrant_name": "...",
         "client_name": "...",
         "filing_type_display": "...",
         "amount_reported": 80000,
         // ... other metadata
       }
     }
   - To read the full filing document, use read_s3_file_tool with the key (and bucket when present): when context item data has s3_bucket and s3_key, call read_s3_file_tool(s3_key=data.s3_key, s3_bucket=data.s3_bucket) so the correct bucket is used; otherwise use read_s3_file_tool(data.s3_key).
   - The s3_key will start with "filings/" and points to the document file. When data.s3_uri is present it is "bucket/key" for the same purpose.
   - The context item metadata includes key information, but use read_s3_file_tool to get complete details when needed
9. **FOR POLITICIAN TRADE CONTEXT ITEMS**:
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
   - The formS3Key points to a filing document that contains multiple trades. If you need to see all trades from the same filing, use read_s3_file_tool(s3_key=formS3Key, file_type="html", s3_bucket=data.s3_bucket) when data.s3_bucket is present, else read_s3_file_tool(s3_key=formS3Key, file_type="html").
   - Use the trade data to provide analysis on:
     - Transaction patterns and timing
     - Asset types and diversification
     - Trade values and amounts
     - Relationship between filing date and transaction date
     - Comparison across politicians, parties, or positions
   - When analyzing multiple trades, group by politician, security, transaction type, or date ranges as relevant.

FOR SEC FILINGS AND REGULATORY DOCUMENTS:
🔹 AUTOMATIC DOCUMENT PROCESSING:
When you use read_s3_file_tool to read files:
- Documents are automatically detected by type (SEC 10-K, 10-Q, 8-K, XBRL, financial statements, etc.)
- If detected as an SEC filing or financial document, they're routed to specialized parsers
- Parsers extract structured financial data (Income Statement, Balance Sheet, Cash Flow, metrics) when available
- Extracted data is automatically indexed in DynamoDB for fast retrieval
- Use get_document_index_tool() to query indexed financial data across multiple documents
- Use get_document_by_id_tool() to retrieve specific indexed documents

**When analyzing SEC filings or financial documents:**
- Use read_s3_file_tool(s3_key) - it will automatically detect and parse if appropriate
- Check the response for structured_data or parsed_financials sections
- If structured financial data is present, use it for exact numbers (revenue, margins, cash flow, etc.)
- The structured data comes from authoritative XBRL/iXBRL tags when available
- Raw content is also provided for additional context (risk factors, MD&A, etc.)

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

🔹 SEC FILING DOWNLOAD AND PROCESSING WORKFLOW (CRITICAL):
**When users ask to read or analyze SEC filings that are NOT already in S3:**
1. **MANDATORY WORKFLOW**: 
   - Step 1: Use `download_filing_pdf(cik, accession_number, document_name, save_to_s3=True)` to download the filing from SEC API
     * This downloads the filing from SEC EDGAR and stores it in S3 at: `users/{user_id}/sessions/{session_id}/agent-files/{timestamp}_{document_name}`
     * The response includes the S3 URL - extract the S3 key from the URL path (everything after the bucket name)
   - Step 2: Extract the S3 key from the download response
     * The response format is: "✅ Successfully downloaded and saved SEC filing to S3:\n\nDocument: {document_name}\nCIK: {cik}\nAccession: {accession}\nS3 URL: https://{bucket}.s3.amazonaws.com/{s3_key}\n..."
     * Extract the S3 key from the S3 URL (the path after the bucket name)
     * Format: `users/{user_id}/sessions/{session_id}/agent-files/{timestamp}_{document_name}`
   - Step 3: Use `read_s3_file_tool(s3_key)` to process the downloaded filing
     * The `read_s3_file_tool` will automatically:
       * Detect the document type (SEC 10-K, 10-Q, 8-K, etc.)
       * Extract structured financial data (revenue, margins, cash flow, debt, equity)
       * Index the extracted data for fast retrieval
       * Return both raw content and structured financial summary

2. **WHEN TO USE THIS WORKFLOW**:
   - User asks to "read" a filing that hasn't been uploaded yet
   - User asks to "analyze" a specific SEC filing by CIK/accession number
   - User wants detailed financial extraction from a filing
   - The filing is not already in session context or uploaded files
   - **CRITICAL**: In staging/development environments where files may not exist in S3, ALWAYS download first before reading

3. **EXAMPLE WORKFLOW**:
   User: "Read Tesla's Q3 2025 10-Q filing"
   Agent:
   1. **FIRST**: get_current_datetime() → "2026-01-17" (to verify filing is valid historical data)
   2. get_company_cik("TSLA") → Get CIK: 0001318605
   3. get_company_filings("0001318605", "10-Q", limit=1) → Get most recent 10-Q with accession "0001628280-25-045968" and document "tsla-20250930.htm"
   4. download_filing_pdf("0001318605", "0001628280-25-045968", "tsla-20250930.htm", save_to_s3=True) 
      → Response: "✅ Successfully downloaded...\nS3 URL: https://bucket.s3.amazonaws.com/users/123/sessions/abc/agent-files/1768672072_tsla-20250930.htm"
   5. Extract S3 key from URL: "users/123/sessions/abc/agent-files/1768672072_tsla-20250930.htm"
   6. read_s3_file_tool("users/123/sessions/abc/agent-files/1768672072_tsla-20250930.htm") 
      → Processes with document parsing, extracts financial data, indexes it
   
   **IMPORTANT**: Since current date is 2026-01-17, Q3 2025 (ended 2025-09-30) is a VALID historical filing - treat it as real data, NOT hypothetical

4. **IMPORTANT NOTES**:
   - **NEVER skip the download step** - always download first, then read
   - The S3 key is in the S3 URL returned by download_filing_pdf - extract it from the URL path
   - read_s3_file_tool handles all document type detection and financial data extraction automatically
   - If the file is already in S3 (from previous download or upload), you can skip download and go directly to read_s3_file_tool
   - For HTML filings, download_filing_pdf will download the HTML file (not just PDFs - it handles any document type)
   - **In staging/development**: Files may not exist in S3 yet, so ALWAYS download first before attempting to read

🔹 DYNAMIC DATE AWARENESS FOR SEC FILINGS (CRITICAL):
**ALWAYS GET CURRENT DATE FIRST** when users ask about "recent", "latest", or "new" filings:
1. **MANDATORY FIRST STEP**: When users ask for "recent filings", "latest filings", "new filings", or ANY SEC filing request:
   - IMMEDIATELY call get_current_datetime() to get today's date BEFORE fetching any filings
   - Use this date to calculate what "recent" means relative to the actual current date
   - NEVER assume a date or use hardcoded dates - always get the real current date first
   - **CRITICAL**: If the current date is January 17, 2026, then Q3 2025 (ended September 30, 2025) is a VALID historical filing - NOT hypothetical
   - **NEVER** say a filing is "hypothetical" or "hasn't occurred yet" without first checking the current date

2. **DEFAULT DATE RANGES FOR "RECENT" REQUESTS**:
   - When users say "recent" or "latest" without specifying dates, default to:
     - **Past 30-60 days** for 8-K forms (current reports - most timely)
     - **Past 90 days** for 10-Q forms (quarterly reports)
     - **Past 365 days** for 10-K forms (annual reports)
   - Use calculate_date_range() to compute start_date based on current date
   - Example: If today is 2026-01-16 and user asks for "recent 8-K filings":
     - Get current date: get_current_datetime() → "2026-01-16"
     - Calculate range: calculate_date_range("60d") → start_date="2025-11-17", end_date="2026-01-16"
     - Search: search_sec_filings(company_name, "8-K", "2025-11-17", "2026-01-16", limit)

3. **FILING TYPE PRIORITIZATION FOR RECENT DEVELOPMENTS**:
   - **8-K Forms (Current Reports) - HIGHEST PRIORITY for recent material events**:
     - Filed when material events occur (earnings, acquisitions, executive changes, etc.)
     - More timely than quarterly reports
     - Best for: Recent material developments, current events, breaking news
     - When user asks for "recent" or "latest" without specifying form type, prioritize 8-K first
   - **Form 4 (Insider Trading Reports) - Valuable for recent activity**:
     - Recent executive trading activity
     - Insider sentiment indicators
     - Potential signals about company outlook
   - **10-Q vs 8-K Priority**:
     - **8-K**: Better for recent material events and current developments (use for "recent" requests)
     - **10-Q**: Better for comprehensive quarterly financial analysis (use when user wants financial analysis)
   - **Ideal approach**: Use 8-K for recent developments, then 10-Q for deeper financial context

4. **WORKFLOW EXAMPLE FOR "RECENT FILINGS"**:
   User: "What are Walmart's recent filings?"
   Agent:
   1. get_current_datetime() → "2026-01-16"
   2. calculate_date_range("60d") → start_date="2025-11-17", end_date="2026-01-16"
   3. get_company_cik("WMT") → Get CIK
   4. search_sec_filings("Walmart", "8-K", "2025-11-17", "2026-01-16", limit=10) → Get recent 8-Ks first
   5. If user wants financial analysis: get_company_filings(cik, "10-Q", limit=4) → Get recent 10-Qs
   6. Present 8-Ks as most recent developments, then offer 10-Q analysis if needed

5. **CONTEXTUAL RELEVANCE**:
   - Always compare filing dates to current date to determine if filings are truly "recent"
   - If a filing is from months ago and more recent filings exist, mention this to the user
   - Prevent showing users stale data from months ago when more recent filings are available
   - Example: If today is 2026-01-16 and you see a 10-Q from 2025-10-15, note that it's from 3 months ago and check for more recent filings

**CRITICAL RULES**:
1. NEVER assume what "recent" means - always get the current date first, then calculate the appropriate date range!
2. NEVER say a filing is "hypothetical", "hasn't occurred yet", or "is a future filing" without first calling get_current_datetime() to verify
3. If current date is 2026-01-17, then Q3 2025 (ended 2025-09-30) is a VALID historical filing - treat it as real data
4. Only filings with dates AFTER the current date should be considered test/mock data (and these are automatically filtered out by the API)
5. When analyzing any SEC filing, ALWAYS get the current date first to provide proper context about how recent the filing is

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
- "This appears to be a hypothetical filing"
- "This filing hasn't occurred yet"
- "This is a future filing"
- "This is test data"
- ANY statement suggesting a filing is hypothetical or hasn't occurred WITHOUT first calling get_current_datetime() to verify

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

# Financial data tools have been moved to tools/stock_data_fetcher.py
# Financial calculator tool has been moved to tools/financial_calculator.py
# They are imported at the top of this file


# S3 File Reader Tool - defined inline to match other tools
import boto3
from botocore.exceptions import ClientError

class S3FileReader:
    """Helper class to read files from S3"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = None
    
    def get_bucket_name(self, s3_key: str = None) -> str:
        """
        Get the appropriate bucket name based on the S3 key pattern.
        Must match logic in tools/s3_file_reader.py so filings/ and trades/ route to correct buckets.
        """
        project_name = os.environ.get('PROJECT_NAME', 'cosine')
        environment = os.environ.get('ENVIRONMENT', 'production')

        # If s3_key starts with billtext/, use congress bills data bucket
        if s3_key and s3_key.startswith('billtext/'):
            bucket_name = os.environ.get('CONGRESS_BILLS_DATA_S3_BUCKET_NAME')
            if bucket_name:
                logger.info(f"Using congress bills data bucket for billtext file: {bucket_name}")
                return bucket_name
            bucket_name = f"{project_name}-congress-bills-data-{environment}"
            logger.info(f"Using constructed congress bills data bucket name: {bucket_name}")
            return bucket_name

        # If s3_key starts with filings/, distinguish SEC EDGAR vs LDA
        if s3_key and s3_key.startswith('filings/'):
            is_lda = s3_key.startswith('filings/RR/') or s3_key.startswith('filings/LDA/')
            if is_lda:
                bucket_name = os.environ.get('LDA_DISCLOSURES_S3_BUCKET_NAME')
                if bucket_name:
                    return bucket_name
                return f"{project_name}-lda-disclosures-{environment}"
            # SEC EDGAR filings
            bucket_name = os.environ.get('SEC_FILINGS_S3_BUCKET') or os.environ.get('SEC_FILINGS_BUCKET')
            if bucket_name:
                logger.info(f"Using SEC filings bucket for filings/ file: {bucket_name}")
                return bucket_name
            bucket_name = f"{project_name}-sec-filings-{environment}"
            logger.info(f"Using constructed SEC filings bucket name: {bucket_name}")
            return bucket_name

        # If s3_key starts with trades/, use politician trades bucket
        if s3_key and s3_key.startswith('trades/'):
            bucket_name = os.environ.get('POLITICIAN_TRADES_BUCKET') or os.environ.get('POLITICIAN_TRADES_S3_BUCKET')
            if bucket_name:
                return bucket_name
            return f"{project_name}-politician-trades-{environment}"

        # Default to chat files bucket
        if self.bucket_name is None:
            self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
            if not self.bucket_name:
                raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
        return self.bucket_name
    
    def read_file(self, s3_key: str, file_type: str = "auto", s3_bucket: str = None) -> str:
        """
        Read file content from S3
        
        Args:
            s3_key: The S3 key/path of the file to read
            file_type: The type of file (auto-detect if not specified)
            s3_bucket: Optional. When provided, use this bucket instead of inferring from key.
            
        Returns:
            String with file content
        """
        try:
            bucket_name = s3_bucket if s3_bucket else self.get_bucket_name(s3_key)
            logger.info(f"Reading file from S3: {bucket_name}/{s3_key}")
            response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read()  # This is bytes, not string
            
            # Handle .cosine encrypted files (context items from filesystem)
            # Check this FIRST before other file type logic
            s3_key_lower = s3_key.lower()
            file_type_lower = file_type.lower() if file_type else ''
            
            # Check if this is a .cosine file by extension or explicit file_type
            is_cosine_file = s3_key_lower.endswith('.cosine') or file_type_lower == 'cosine'
            
            # Also check if content looks like Fernet-encrypted data (starts with gAAAAAB)
            content_preview = content[:20] if len(content) >= 20 else content
            looks_encrypted = isinstance(content_preview, bytes) and content_preview.startswith(b'gAAAAAB')
            
            if is_cosine_file or (looks_encrypted and '/filesys/' in s3_key):
                logger.info(f"🔐 Detected .cosine file or encrypted content, attempting decryption")
                logger.info(f"🔐 s3_key: {s3_key}, file_type: {file_type}, is_cosine_file: {is_cosine_file}, looks_encrypted: {looks_encrypted}")
                try:
                    # Import decryption helper (following pattern used by other tools)
                    try:
                        from utils.decryption_helper import decrypt_cosine_file
                        logger.info(f"✅ Successfully imported decryption_helper from utils")
                    except ImportError as import_err:
                        logger.error(f"❌ Failed to import from utils.decryption_helper: {str(import_err)}")
                        # Try direct import as fallback
                        try:
                            from decryption_helper import decrypt_cosine_file
                            logger.info(f"✅ Successfully imported decryption_helper directly")
                        except ImportError as import_err2:
                            logger.error(f"❌ Also failed direct import: {str(import_err2)}")
                            # Try adding path and importing
                            try:
                                import_path = os.path.join(os.path.dirname(__file__), 'utils')
                                if import_path not in sys.path:
                                    sys.path.insert(0, import_path)
                                from decryption_helper import decrypt_cosine_file
                                logger.info(f"✅ Successfully imported after adding path")
                            except ImportError as import_err3:
                                logger.error(f"❌ All import attempts failed: {str(import_err3)}")
                                return f"Error: Failed to import decryption helper. Tried: utils.decryption_helper, decryption_helper, and path-based import. Last error: {str(import_err3)}"
                    
                    # Extract user_id from s3_key (format: users/{user_id}/filesys/...)
                    s3_key_parts = s3_key.split('/')
                    user_id = None
                    
                    if len(s3_key_parts) >= 2 and s3_key_parts[0] == 'users':
                        user_id = s3_key_parts[1]
                        logger.info(f"🔐 Extracted user_id from S3 key: {user_id}")
                    else:
                        # Fallback: try to get user_id from environment
                        user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                        if user_id:
                            logger.info(f"🔐 Using user_id from environment: {user_id}")
                        else:
                            logger.error(f"❌ Cannot find user_id in S3 key or environment")
                            logger.error(f"❌ S3 key parts: {s3_key_parts}")
                            logger.error(f"❌ Environment USER_ID: {os.environ.get('USER_ID')}")
                            logger.error(f"❌ Environment CURRENT_USER_ID: {os.environ.get('CURRENT_USER_ID')}")
                            return f"Error: Cannot decrypt .cosine file - user_id not found in S3 key or environment. S3 key: {s3_key}"
                    
                    # Ensure content is bytes (not string)
                    if isinstance(content, str):
                        logger.warning(f"⚠️ Content is string, converting to bytes")
                        content = content.encode('utf-8')
                    
                    # Attempt decryption
                    logger.info(f"🔐 Attempting to decrypt .cosine file (size: {len(content)} bytes, type: {type(content).__name__}) for user {user_id}")
                    logger.info(f"🔐 Content preview (first 50 bytes): {content[:50] if len(content) >= 50 else content}")
                    try:
                        decrypted_data = decrypt_cosine_file(user_id, content)
                        logger.info(f"✅ Successfully decrypted .cosine file, returning JSON data")
                        logger.info(f"✅ Decrypted data keys: {list(decrypted_data.keys()) if isinstance(decrypted_data, dict) else 'N/A'}")
                        return json.dumps(decrypted_data, indent=2, default=str)
                    except ValueError as ve:
                        logger.error(f"❌ Decryption failed with ValueError: {str(ve)}")
                        return f"Error decrypting .cosine file: {str(ve)}"
                    except Exception as decrypt_err:
                        logger.error(f"❌ Decryption failed with exception: {str(decrypt_err)}")
                        import traceback
                        logger.error(f"❌ Decryption traceback: {traceback.format_exc()}")
                        return f"Error decrypting .cosine file: {str(decrypt_err)}"
                        
                except Exception as e:
                    logger.error(f"❌ Unexpected error in .cosine decryption block: {str(e)}")
                    import traceback
                    logger.error(f"❌ Traceback: {traceback.format_exc()}")
                    return f"Error decrypting .cosine file: {str(e)}"
            
            # Determine content type
            content_type = response.get('ContentType', '')
            if 'json' in content_type or file_type == 'json' or s3_key.endswith('.json'):
                # JSON file
                try:
                    json_data = json.loads(content.decode('utf-8'))
                    return json.dumps(json_data, indent=2)
                except json.JSONDecodeError as e:
                    return f"Error parsing JSON: {str(e)}\nRaw content: {content.decode('utf-8')}"
            elif 'csv' in content_type or file_type == 'csv' or s3_key.endswith('.csv'):
                # CSV file
                return content.decode('utf-8')
            elif 'text' in content_type or file_type == 'txt' or s3_key.endswith('.txt'):
                # Text file
                return content.decode('utf-8')
            elif 'html' in content_type or s3_key.endswith('.html'):
                # HTML file (for bill text)
                return content.decode('utf-8')
            else:
                # Try to decode as UTF-8, fallback to base64 if it fails
                try:
                    return content.decode('utf-8')
                except UnicodeDecodeError:
                    import base64
                    return f"Binary file content (base64): {base64.b64encode(content).decode('utf-8')}"
                    
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NoSuchKey':
                # If file not found in first bucket, try congress bills bucket if it's a billtext file
                if s3_key.startswith('billtext/') and bucket_name != self.get_bucket_name(s3_key):
                    logger.info(f"File not found in {bucket_name}, trying congress bills bucket")
                    try:
                        congress_bucket = self.get_bucket_name(s3_key)
                        response = self.s3_client.get_object(Bucket=congress_bucket, Key=s3_key)
                        content = response['Body'].read()
                        # Decode and return (same logic as above)
                        content_type = response.get('ContentType', '')
                        if 'html' in content_type or s3_key.endswith('.html'):
                            return content.decode('utf-8')
                        else:
                            return content.decode('utf-8')
                    except ClientError as e2:
                        return f"File not found in either bucket: {s3_key}"
                return f"File not found: {s3_key} in bucket {bucket_name}"
            elif error_code == 'NoSuchBucket':
                return f"Bucket not found: {bucket_name}"
            elif error_code == 'AccessDenied':
                return f"Access denied to bucket {bucket_name} for key {s3_key}. Check IAM permissions."
            else:
                return f"S3 error ({error_code}): {str(e)}"
        except Exception as e:
            return f"Error reading file: {str(e)}"
    
    def get_file_info(self, s3_key: str, s3_bucket: str = None) -> Dict[str, Any]:
        """
        Get metadata about a file in S3
        
        Args:
            s3_key: The S3 key/path of the file
            s3_bucket: Optional. When provided, use this bucket instead of inferring from key.
            
        Returns:
            Dictionary with file metadata
        """
        try:
            bucket_name = s3_bucket if s3_bucket else self.get_bucket_name(s3_key)
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
def read_s3_file_tool(s3_key: str, file_type: str = "auto", s3_bucket: str = None) -> str:
    """Read uploaded files from S3 storage. When you see an uploaded file context with an S3 key, use this tool to read the file content. When context has s3_bucket and s3_key, pass both so the correct bucket is used."""
    try:
        agent_logger.info(f"Reading S3 file: {s3_key}" + (f" (bucket: {s3_bucket})" if s3_bucket else ""))
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Create S3 file reader instance
        reader = S3FileReader()
        
        # Read the file (use explicit bucket when provided)
        content = reader.read_file(s3_key, file_type, s3_bucket=s3_bucket)
        
        # Get file info for context
        file_info = reader.get_file_info(s3_key, s3_bucket=s3_bucket)
        
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
        
        # Decompress content if it's compressed (e.g., from web scraper tool)
        # This handles compressed data from tools like fetch_web_content_tool
        original_size = len(content)
        is_compressed = False
        
        try:
            import json
            from utils.compression_helper import CompressionHelper
            
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
        
        # Use unified file upload function
        try:
            from lambda_invocation import upload_file_and_notify
            
            result = upload_file_and_notify(
                content=content,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type=file_type,
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
        excel_lines.append(f"# Generated by FinGov Financial Analysis Agent")
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
        fallback_content = f"# {template_type.upper().replace('_', ' ')} TEMPLATE\n# Generated by FinGov Financial Analysis Agent\n\n{content}"
        return fallback_content.encode('utf-8')

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
    """Generate content for portfolio analysis template"""
    lines = []
    
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

# Define the tools list that Strands can automatically detect
enhanced_tools = [
    fetch_web_content_tool,  # Web content fetcher for article context items
    get_financial_data,
    get_multiple_financial_data,
    search_financial_news, 
    get_technical_analysis,
    analyze_portfolio,  # Portfolio analysis with live yfinance data
    calculate_stock_correlation,  # Live correlation analysis
    get_volatility_surface,  # New volatility surface analysis
    python_financial_calculator,  # Advanced financial calculations
    http_request,  # Web request tool
    read_s3_file_tool,  # S3 file reader tool
    get_session_files_tool,  # Session database access tool
    generate_agent_file_tool,  # Generate files in agent-files folder
    generate_excel_file_tool,  # Generate Excel files for financial analysis
    get_session_context_tool,  # Complete session context tool
    get_crypto_data_tool,  # Real-time cryptocurrency data tool
    compare_crypto_tool,  # Cryptocurrency comparison tool
    read_pdf_tool,  # Single PDF reader (S3 + optional .cosine decrypt; page_numbers list)
    get_company_cik,  # Get company CIK from ticker symbol
    get_company_filings,  # Get SEC filings for a company
    get_filing_document,  # Get full text of SEC filing
    search_sec_filings,  # Search SEC filings by criteria
    get_filing_exhibits,  # Get exhibits for SEC filing
    download_filing_pdf,  # Download SEC filing as PDF
    generate_chart_tool,  # Generate unified charts for both stocks and crypto (requires pre-fetched data)
    generate_stock_chart,  # Convenience tool: fetch stock data and generate chart in one step
    generate_excel_with_charts_tool,  # Generate Excel (.xlsx) files with embedded charts from financial data
    get_chat_history_tool,  # Get chat history on-demand with pagination
    search_chat_history_tool,  # Search chat history for specific terms
    process_chat_session_context_tool,  # Process chat session context from history sidebar
    analyze_chat_session_context_tool,  # Analyze chat session context for insights
    fetch_web_content_tool,  # Fetch and extract content from web URLs (for article context items)
    search_congress_bills,  # Search congressional bills in DynamoDB
    search_govt_contracts,  # Search government contracts/awards in DynamoDB
    govt_contracts_autocomplete,  # Get exact recipient/agency names before search_govt_contracts
    search_politician_trades,  # Search politician stock trades in DynamoDB
    lda_autocomplete,  # LDA autocomplete tool for finding registrants, clients, lobbyists, PACs
    lda_search,  # LDA search tool for searching lobbying disclosures
    search_autocomplete,  # Search autocomplete tool for matching natural language to CSV list values (policy areas, general issues, government entities, legislators)
    get_current_datetime,  # Get current date/time for exact timeframe calculations
    calculate_date_range,  # Calculate date ranges relative to current date
]

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
    Interactive chat interface for the Enhanced FinGov Financial Agent
    """
    print("🏦 Enhanced FinGov Financial Analysis Agent")
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
                print("\n👋 Thank you for using Enhanced FinGov Financial Agent!")
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
                print(f"\n💡 Enhanced FinGov Agent:\n{response}")
                
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
    