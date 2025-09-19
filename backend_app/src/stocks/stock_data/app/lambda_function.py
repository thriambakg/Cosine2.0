import json
import os
import yfinance as yf
import numpy as np
import pandas as pd
import logging
from datetime import datetime, timedelta
import requests
import time
import random
import hashlib
import boto3

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Rate limiting configuration - increased to avoid 429 errors
RATE_LIMIT_DELAY = 5.0  # Minimum delay between requests (increased from 2.0)
MAX_RETRIES = 5  # Increased retries
RETRY_DELAY = 10.0  # Increased base delay

# Alpha Vantage API key - will be fetched from Secrets Manager
ALPHA_VANTAGE_API_KEY = None
ALPHA_VANTAGE_SECRET_NAME = "cosine-alpha-vantage-api-production"  # Will be set via environment variable

# In-memory cache for rate limiting (simple approach for Lambda)
request_timestamps = {}

def get_alpha_vantage_api_key():
    """
    Fetch Alpha Vantage API key from AWS Secrets Manager
    """
    global ALPHA_VANTAGE_API_KEY
    
    if ALPHA_VANTAGE_API_KEY is not None:
        return ALPHA_VANTAGE_API_KEY
    
    try:
        # Initialize Secrets Manager client
        secrets_client = boto3.client('secretsmanager')
        
        # Get secret name from environment variable or use default
        secret_name = os.environ.get('ALPHA_VANTAGE_SECRET_NAME', ALPHA_VANTAGE_SECRET_NAME)
        
        logger.info(f"Fetching Alpha Vantage API key from secret: {secret_name}")
        
        # Retrieve the secret
        response = secrets_client.get_secret_value(SecretId=secret_name)
        secret_data = json.loads(response['SecretString'])
        
        # Extract API key
        api_key = secret_data.get('api_key')
        if not api_key or api_key == "PLACEHOLDER_ALPHA_VANTAGE_API_KEY":
            logger.warning("Alpha Vantage API key not properly configured in Secrets Manager")
            return None
        
        ALPHA_VANTAGE_API_KEY = api_key
        logger.info("Successfully retrieved Alpha Vantage API key from Secrets Manager")
        return ALPHA_VANTAGE_API_KEY
        
    except Exception as e:
        logger.error(f"Failed to retrieve Alpha Vantage API key from Secrets Manager: {str(e)}")
        return None

def rate_limit_check(ticker):
    """Enhanced rate limiting check to avoid Yahoo Finance blocks"""
    global request_timestamps
    current_time = time.time()
    cache_key = f"rate_limit_{ticker}"
    
    if cache_key in request_timestamps:
        last_request = request_timestamps[cache_key]
        time_since_last = current_time - last_request
        
        # Use progressive delays based on how many requests we've made
        required_delay = RATE_LIMIT_DELAY
        if len(request_timestamps) > 3:  # If we've made multiple requests recently
            required_delay = RATE_LIMIT_DELAY * 2  # Double the delay
        
        if time_since_last < required_delay:
            delay_needed = required_delay - time_since_last
            # Add jitter to make requests less predictable
            jitter = random.uniform(1.0, 3.0)
            total_delay = delay_needed + jitter
            logger.info(f"Rate limiting: waiting {total_delay:.2f}s before next request for {ticker}")
            time.sleep(total_delay)
    
    request_timestamps[cache_key] = time.time()
    
    # Clean up old timestamps to prevent memory issues
    if len(request_timestamps) > 50:
        # Remove timestamps older than 1 hour
        cutoff_time = current_time - 3600
        request_timestamps = {k: v for k, v in request_timestamps.items() if v > cutoff_time}

def make_yahoo_request_with_retry(url, headers, max_retries=MAX_RETRIES):
    """Make Yahoo Finance request with retry logic and rate limiting"""
    for attempt in range(max_retries):
        try:
            # Add random delay to spread out requests (increased to avoid rate limits)
            delay = random.uniform(2.0, 5.0)  # Increased from 0.5-2.0 to 2.0-5.0
            time.sleep(delay)
            
            logger.info(f"Making Yahoo Finance request (attempt {attempt + 1}/{max_retries})")
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                return response
            elif response.status_code == 429:
                # Rate limited - exponential backoff with jitter
                wait_time = RETRY_DELAY * (2 ** attempt) + random.uniform(5.0, 15.0)
                logger.warning(f"Rate limited (429). Waiting {wait_time:.2f}s before retry {attempt + 1}/{max_retries}")
                time.sleep(wait_time)
                continue
            elif response.status_code == 403:
                # Forbidden - likely IP blocked, wait much longer
                wait_time = RETRY_DELAY * (3 ** attempt) + random.uniform(10.0, 30.0)
                logger.warning(f"Forbidden (403). Waiting {wait_time:.2f}s before retry {attempt + 1}/{max_retries}")
                time.sleep(wait_time)
                continue
            else:
                logger.error(f"HTTP request failed with status {response.status_code}")
                if attempt == max_retries - 1:
                    return response
                time.sleep(RETRY_DELAY + random.uniform(2.0, 5.0))
                continue
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request exception on attempt {attempt + 1}: {str(e)}")
            if attempt == max_retries - 1:
                raise
            time.sleep(RETRY_DELAY)
    
    raise Exception(f"All {max_retries} attempts failed")

def lambda_handler(event, context):
    """
    AWS Lambda handler to fetch stock statistics in crypto stats format for tile compatibility.
    
    Expected event format:
    {
        "ticker": "AAPL",
        "period": "1y"  # optional, defaults to "1y"
    }
    
    Returns stock statistics matching crypto stats format:
    - Current price and 24h change
    - 7-day and annual returns
    - Volatility
    - Chart data for visualization
    """
    try:
        logger.info(f"=== LAMBDA HANDLER START ===")
        logger.info(f"Event received: {event}")
        logger.info(f"Event type: {type(event)}")
        
        # Parse the event to get parameters
        if isinstance(event, str):
            logger.info("Event is string, parsing JSON")
            event = json.loads(event)
            logger.info(f"Parsed event: {event}")
        
        # Extract parameters from event
        ticker = None
        period = '1y'
        
        # Debug: Log all event keys
        logger.info(f"Event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
        
        if event.get('queryStringParameters'):
            logger.info("Extracting from queryStringParameters")
            logger.info(f"queryStringParameters: {event['queryStringParameters']}")
            logger.info(f"queryStringParameters type: {type(event['queryStringParameters'])}")
            ticker = event['queryStringParameters'].get('ticker')
            period = event['queryStringParameters'].get('period', '1y')
            logger.info(f"From queryStringParameters - ticker: {ticker}, period: {period}")
        elif event.get('body'):
            logger.info("Extracting from body")
            body = event['body']
            if isinstance(body, str):
                logger.info("Body is string, parsing JSON")
                body = json.loads(body)
            ticker = body.get('ticker')
            period = body.get('period', '1y')
            logger.info(f"From body - ticker: {ticker}, period: {period}")
        else:
            logger.info("Extracting from direct event parameters")
            ticker = event.get('ticker')
            period = event.get('period', '1y')
            logger.info(f"From direct params - ticker: {ticker}, period: {period}")
        
        logger.info(f"Final extracted values - ticker: {ticker}, period: {period}")
        logger.info(f"Ticker validation - ticker is None: {ticker is None}, ticker is empty string: {ticker == ''}")
        
        # Validate required parameters
        if not ticker:
            logger.error("No ticker provided")
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                    'error': 'Missing required parameter: ticker',
                    'message': 'Please provide a stock ticker symbol'
                })
            }
        
        logger.info(f"Calling fetch_stock_stats with ticker={ticker}, period={period}")
        
        # Fetch stock statistics in crypto stats format for tile compatibility
        stock_stats = fetch_stock_stats(ticker, period)
        
        logger.info(f"fetch_stock_stats returned: {stock_stats}")
        logger.info(f"Result type: {type(stock_stats)}")
        
        if 'error' in stock_stats:
            logger.error(f"Error in stock_stats: {stock_stats['error']}")
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                    'error': stock_stats['error'],
                    'ticker': ticker.upper()
                })
            }
        
        logger.info(f"=== LAMBDA HANDLER SUCCESS ===")
        logger.info(f"Returning successful response for {ticker}")
        logger.info(f"Response data structure: {list(stock_stats.keys()) if isinstance(stock_stats, dict) else 'Not a dict'}")
        logger.info(f"Current price: {stock_stats.get('current_price', 'Not found')}")
        logger.info(f"Price change 24h: {stock_stats.get('price_change_24h', 'Not found')}")
        logger.info(f"Chart data points: {len(stock_stats.get('chart_data', []))}")
        
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Max-Age': '1728000',
                'Content-Type': 'application/json'
            },
            'body': json.dumps(stock_stats)
        }
        
    except Exception as e:
        logger.error(f"=== LAMBDA HANDLER ERROR ===")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception message: {str(e)}")
        logger.error(f"Exception details: {repr(e)}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Max-Age': '1728000',
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e),
                'ticker': event.get('ticker', 'unknown') if isinstance(event, dict) else 'unknown'
            })
        }

def fetch_stock_data(ticker, period="1y"):
    """
    Fetch comprehensive stock data using yfinance library with rate limiting.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Comprehensive stock data
    """
    try:
        logger.info(f"Fetching data for {ticker} with period {period}")
        
        # Apply rate limiting
        rate_limit_check(ticker)
        
        # Create yfinance Ticker object
        stock = yf.Ticker(ticker)
        
        # Get current quote data
        quote_data = fetch_quote_data(stock, ticker)
        
        # Get historical data
        historical_data = fetch_historical_data(stock, ticker, period)
        
        # Calculate technical indicators
        technical_indicators = calculate_technical_indicators(historical_data)
        
        # Get company info
        company_info = fetch_company_info(stock, ticker)
        
        # Get additional analytics
        analytics = calculate_advanced_analytics(stock, ticker, historical_data)
        
        return {
            'ticker': ticker.upper(),
            'period': period,
            'quote': quote_data,
            'historical': historical_data,
            'technical': technical_indicators,
            'company': company_info,
            'analytics': analytics,
            'data_source': 'Yahoo Finance via yfinance',
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error fetching stock data for {ticker}: {str(e)}")
        # Try enhanced HTTP fallback first
        logger.info(f"Trying enhanced HTTP fallback for {ticker}")
        fallback_result = fetch_stock_data_fallback(ticker, period)
        if 'error' not in fallback_result:
            return fallback_result
        
        # If fallback also fails, return mock data
        logger.warning(f"All methods failed for {ticker}, returning mock data")
        return generate_mock_stock_data(ticker, period)

def fetch_stock_data_direct_http(ticker, period="1y"):
    """
    Direct HTTP fallback method that bypasses yfinance library completely.
    Uses multiple Yahoo Finance endpoints to get comprehensive data.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"=== Using direct HTTP fallback for {ticker} ===")
        
        # Apply rate limiting
        rate_limit_check(ticker)
        
        # Get current price and basic data
        current_data = fetch_current_price_direct(ticker)
        if 'error' in current_data:
            logger.error(f"Failed to get current price: {current_data['error']}")
            return current_data
        
        # Get historical data for chart
        chart_data = fetch_historical_data_direct(ticker, period)
        
        # Get additional statistics
        stats_data = fetch_additional_stats_direct(ticker)
        
        # Combine all data into crypto stats format
        result = {
            'current_price': current_data.get('current_price', 0),
            'price_change_24h': current_data.get('price_change_24h', 0),
            'week_return': stats_data.get('week_return', 0),
            'annual_return': stats_data.get('annual_return', 0),
            'volatility': stats_data.get('volatility', 0),
            'chart_data': chart_data,
            'data_source': 'Yahoo Finance Direct HTTP',
            'timestamp': datetime.now().isoformat()
        }
        
        logger.info(f"Direct HTTP fallback successful for {ticker}")
        return result
        
    except Exception as e:
        logger.error(f"Direct HTTP fallback failed for {ticker}: {str(e)}")
        return {"error": f"Direct HTTP fallback failed: {str(e)}"}

def fetch_current_price_direct(ticker):
    """Fetch current price using direct HTTP call to Yahoo Finance"""
    try:
        # Use the v8 chart endpoint for current price
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        }
        
        logger.info(f"Fetching current price for {ticker}")
        response = make_yahoo_request_with_retry(url, headers)
        
        if response.status_code != 200:
            return {"error": f"HTTP request failed: {response.status_code}"}
        
        data = response.json()
        
        if 'chart' not in data or not data['chart']['result']:
            return {"error": f"No data found for {ticker}"}
        
        result = data['chart']['result'][0]
        meta = result.get('meta', {})
        
        current_price = meta.get('regularMarketPrice', 0)
        previous_close = meta.get('previousClose', 0)
        price_change_24h = current_price - previous_close if current_price and previous_close else 0
        
        return {
            'current_price': current_price,
            'price_change_24h': price_change_24h,
            'previous_close': previous_close
        }
        
    except Exception as e:
        logger.error(f"Error fetching current price for {ticker}: {str(e)}")
        return {"error": f"Failed to fetch current price: {str(e)}"}

def fetch_historical_data_direct(ticker, period="1y"):
    """Fetch historical data for chart using direct HTTP call"""
    try:
        # Map period to Yahoo Finance parameters
        period_map = {
            '1d': {'range': '1d', 'interval': '1m'},
            '7d': {'range': '7d', 'interval': '1h'},
            '30d': {'range': '1mo', 'interval': '1d'},
            '1y': {'range': '1y', 'interval': '1d'}
        }
        
        period_config = period_map.get(period, period_map['1y'])
        
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        params = {
            'range': period_config['range'],
            'interval': period_config['interval'],
            'includePrePost': 'true'
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        }
        
        logger.info(f"Fetching historical data for {ticker} with period {period}")
        
        # Add longer delay between requests to avoid rate limiting
        time.sleep(random.uniform(3.0, 6.0))  # Increased from 1.0-2.0 to 3.0-6.0
        
        response = requests.get(url, params=params, headers=headers, timeout=30)
        
        if response.status_code != 200:
            logger.error(f"Historical data request failed: {response.status_code}")
            return []
        
        data = response.json()
        
        if 'chart' not in data or not data['chart']['result']:
            logger.error("No historical data in response")
            return []
        
        result = data['chart']['result'][0]
        timestamps = result.get('timestamp', [])
        quotes = result.get('indicators', {}).get('quote', [{}])[0]
        closes = quotes.get('close', [])
        
        # Format data for chart
        chart_data = []
        for i, timestamp in enumerate(timestamps):
            if i < len(closes) and closes[i] is not None:
                chart_data.append({
                    'time': timestamp,
                    'close': closes[i]
                })
        
        logger.info(f"Retrieved {len(chart_data)} data points for {ticker}")
        return chart_data
        
    except Exception as e:
        logger.error(f"Error fetching historical data for {ticker}: {str(e)}")
        return []

def fetch_additional_stats_direct(ticker):
    """Fetch additional statistics using direct HTTP calls"""
    try:
        # Use the v10 finance endpoint for additional stats
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
        params = {
            'modules': 'financialData,defaultKeyStatistics,price'
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        }
        
        logger.info(f"Fetching additional stats for {ticker}")
        
        # Add longer delay between requests to avoid rate limiting
        time.sleep(random.uniform(3.0, 6.0))  # Increased from 1.0-2.0 to 3.0-6.0
        
        response = requests.get(url, params=params, headers=headers, timeout=30)
        
        if response.status_code != 200:
            logger.warning(f"Additional stats request failed: {response.status_code}")
            return {'week_return': 0, 'annual_return': 0, 'volatility': 0}
        
        data = response.json()
        
        if 'quoteSummary' not in data or not data['quoteSummary']['result']:
            logger.warning("No additional stats in response")
            return {'week_return': 0, 'annual_return': 0, 'volatility': 0}
        
        result = data['quoteSummary']['result'][0]
        
        # Extract statistics
        financial_data = result.get('financialData', {})
        key_stats = result.get('defaultKeyStatistics', {})
        
        # Calculate returns (simplified)
        current_price = financial_data.get('currentPrice', {}).get('raw', 0)
        week_return = 0
        annual_return = 0
        
        if current_price:
            # Use 52-week high/low for annual return estimation
            week_52_high = key_stats.get('fiftyTwoWeekHigh', {}).get('raw', current_price)
            week_52_low = key_stats.get('fiftyTwoWeekLow', {}).get('raw', current_price)
            
            if week_52_low > 0:
                annual_return = ((current_price - week_52_low) / week_52_low) * 100
        
        # Estimate volatility (simplified)
        volatility = key_stats.get('beta', {}).get('raw', 1.0) * 20  # Rough estimation
        
        return {
            'week_return': week_return,
            'annual_return': annual_return,
            'volatility': volatility
        }
        
    except Exception as e:
        logger.error(f"Error fetching additional stats for {ticker}: {str(e)}")
        return {'week_return': 0, 'annual_return': 0, 'volatility': 0}

def fetch_stock_data_fallback(ticker, period="1y"):
    """
    Enhanced fallback method using direct HTTP calls to Yahoo Finance when yfinance library fails.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"=== Using enhanced HTTP fallback for {ticker} ===")
        
        # Try the new direct HTTP method first
        result = fetch_stock_data_direct_http(ticker, period)
        if 'error' not in result:
            return result
        
        # If that fails, try the original fallback method
        logger.info(f"Direct HTTP method failed, trying original fallback for {ticker}")
        
        # Add longer random delay to avoid rate limiting
        delay = random.uniform(5.0, 10.0)  # Increased from 1.0-3.0 to 5.0-10.0
        logger.info(f"Adding {delay:.2f}s delay to avoid rate limiting")
        time.sleep(delay)
        
        # Yahoo Finance API endpoints
        base_url = "https://query1.finance.yahoo.com/v8/finance/chart"
        
        # Map period to Yahoo Finance parameters and calculate proper date ranges
        import time as time_module
        from datetime import datetime, timedelta
        
        now = datetime.now()
        period_map = {
            '1d': {'days': 1, 'interval': '1m'},
            '7d': {'days': 7, 'interval': '1h'},
            '30d': {'days': 30, 'interval': '1d'},
            '1y': {'days': 365, 'interval': '1d'}
        }
        
        period_config = period_map.get(period, period_map['1y'])
        days_back = period_config['days']
        interval = period_config['interval']
        
        # Calculate proper date range
        start_date = now - timedelta(days=days_back)
        period1 = int(start_date.timestamp())
        period2 = int(now.timestamp())
        
        # Construct URL with proper date range
        url = f"{base_url}/{ticker}?period1={period1}&period2={period2}&interval={interval}&includePrePost=true&events=div%2Csplit"
        
        logger.info(f"Making HTTP request to: {url}")
        
        # Make request with headers to mimic browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        logger.info(f"HTTP response status: {response.status_code}")
        
        if response.status_code != 200:
            logger.error(f"HTTP request failed with status {response.status_code}")
            return {"error": f"HTTP request failed: {response.status_code}"}
        
        data = response.json()
        logger.info(f"Response data keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
        
        # Parse Yahoo Finance response
        if 'chart' not in data or not data['chart']['result']:
            logger.error("No chart data in response")
            return {"error": f"No chart data available for {ticker}"}
        
        result = data['chart']['result'][0]
        meta = result.get('meta', {})
        timestamps = result.get('timestamp', [])
        quotes = result.get('indicators', {}).get('quote', [{}])[0]
        
        if not timestamps or not quotes.get('close'):
            logger.error("No price data in response")
            return {"error": f"No price data available for {ticker}"}
        
        # Extract price data
        closes = quotes.get('close', [])
        opens = quotes.get('open', [])
        highs = quotes.get('high', [])
        lows = quotes.get('low', [])
        volumes = quotes.get('volume', [])
        
        # Filter out None values and create DataFrame
        valid_data = []
        for i, timestamp in enumerate(timestamps):
            if (i < len(closes) and closes[i] is not None and 
                i < len(opens) and opens[i] is not None):
                valid_data.append({
                    'timestamp': timestamp,
                    'open': opens[i],
                    'high': highs[i] if i < len(highs) and highs[i] is not None else opens[i],
                    'low': lows[i] if i < len(lows) and lows[i] is not None else opens[i],
                    'close': closes[i],
                    'volume': volumes[i] if i < len(volumes) and volumes[i] is not None else 0
                })
        
        if not valid_data:
            logger.error("No valid price data found")
            return {"error": f"No valid price data for {ticker}"}
        
        # Convert to DataFrame
        df = pd.DataFrame(valid_data)
        df['date'] = pd.to_datetime(df['timestamp'], unit='s')
        df = df.set_index('date')
        
        logger.info(f"Created DataFrame with {len(df)} rows")
        logger.info(f"Date range: {df.index.min()} to {df.index.max()}")
        
        # Calculate statistics
        current_price = df['close'].iloc[-1]
        start_price = df['close'].iloc[0]
        
        # Calculate 24h return based on timeframe
        if period == '1d':
            # For 1d timeframe, calculate 24h return from 24 hours ago (1440 minutes)
            if len(df) >= 1440:
                price_24h_ago = df['close'].iloc[-1440]
                price_change_24h = ((current_price - price_24h_ago) / price_24h_ago) * 100.0
            else:
                # If not enough data, use period return
                price_change_24h = ((current_price - start_price) / start_price) * 100.0
        else:
            # For other timeframes, use last 2 data points
            if len(df) >= 2:
                previous_close = df['close'].iloc[-2]
                price_change_24h = ((current_price - previous_close) / previous_close) * 100.0
            else:
                price_change_24h = 0.0
        
        # Calculate period return (from start to current)
        period_return = ((current_price - start_price) / start_price) * 100.0
        
        # Calculate 7-day return (last 7 data points or appropriate for timeframe)
        if period == '1d':
            # For 1d, use last 2 hours (120 minutes) as "7-day" equivalent
            week_points = min(120, len(df) - 1)
        elif period == '7d':
            # For 7d, use last 7 hours
            week_points = min(7, len(df) - 1)
        elif period == '30d':
            # For 30d, use last 7 days
            week_points = min(7, len(df) - 1)
        else:  # 1y
            # For 1y, use last 7 days
            week_points = min(7, len(df) - 1)
        
        if len(df) > week_points:
            week_ago_price = df['close'].iloc[-week_points-1]
            week_return = ((current_price - week_ago_price) / week_ago_price) * 100.0
        else:
            week_return = period_return
        
        # For annualized return, scale based on period
        if period == '1d':
            annual_return = period_return * 365  # Scale daily return to annual
        elif period == '7d':
            annual_return = period_return * (365/7)  # Scale weekly return to annual
        elif period == '30d':
            annual_return = period_return * (365/30)  # Scale monthly return to annual
        else:  # 1y
            annual_return = period_return  # Already annual
        
        # Calculate volatility (annualized)
        log_returns = np.log(df['close'] / df['close'].shift(1)).dropna()
        if len(log_returns) > 1:
            if period == '1d':
                # For 1d data (minute intervals), scale to daily volatility
                volatility = log_returns.std() * np.sqrt(1440) * 100.0  # 1440 minutes in a day
            elif period == '7d':
                # For 7d data (hourly intervals), scale to daily volatility
                volatility = log_returns.std() * np.sqrt(24) * 100.0  # 24 hours in a day
            else:
                # For daily data, standard annualized volatility
                volatility = log_returns.std() * np.sqrt(252) * 100.0  # 252 trading days
        else:
            volatility = 0.0
        
        # Prepare chart data with proper formatting
        chart_data = []
        for date, row in df.iterrows():
            # Format timestamp to match crypto chart format
            if period == '1d':
                # For 1d, show time (HH:MM)
                time_label = date.strftime('%H:%M')
            elif period == '7d':
                # For 7d, show day and time
                time_label = date.strftime('%m/%d %H:%M')
            elif period == '30d':
                # For 30d, show month/day
                time_label = date.strftime('%m/%d')
            else:  # 1y
                # For 1y, show month/year
                time_label = date.strftime('%m/%y')
            
            chart_data.append({
                'time': int(date.timestamp()),
                'time_label': time_label,
                'close': round(row['close'], 2)
            })
        
        result = {
            "current_price": round(current_price, 2),
            "price_change_24h": round(price_change_24h, 2),
            "week_return": round(week_return, 2),
            "annual_return": round(annual_return, 2),
            "volatility": round(volatility, 2),
            "chart_data": chart_data
        }
        
        logger.info(f"=== Fallback method successful for {ticker} ===")
        return result
        
    except Exception as e:
        logger.error(f"=== ERROR in fallback method for {ticker} ===")
        logger.error(f"Exception: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {"error": f"Fallback method failed for {ticker}: {str(e)}"}

def fetch_stock_stats(ticker, period="1y"):
    """
    Fetch stock statistics in the same format as crypto stats lambda for tile compatibility.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"=== Starting fetch_stock_stats for {ticker} with period {period} ===")
        
        # Create yfinance Ticker object
        logger.info(f"Creating yfinance Ticker object for {ticker}")
        stock = yf.Ticker(ticker)
        
        # Try to get basic info first
        try:
            logger.info(f"Attempting to get info for {ticker}")
            info = stock.info
            logger.info(f"Info retrieved for {ticker}: {type(info)}, keys: {list(info.keys()) if isinstance(info, dict) else 'Not a dict'}")
        except Exception as info_error:
            logger.warning(f"Failed to get info for {ticker}: {str(info_error)}")
            # If info fails due to rate limiting, try fallback method
            if "429" in str(info_error) or "Too Many Requests" in str(info_error):
                logger.info(f"Rate limiting detected, switching to fallback method for {ticker}")
                return fetch_stock_data_fallback(ticker, period)
        
        # Get historical data with detailed logging
        logger.info(f"Attempting to get historical data for {ticker} with period {period}")
        try:
            hist = stock.history(period=period)
        except Exception as hist_error:
            logger.error(f"yfinance history failed for {ticker}: {str(hist_error)}")
            # If history fails due to rate limiting or other issues, try fallback
            if ("429" in str(hist_error) or "Too Many Requests" in str(hist_error) or 
                "Expecting value" in str(hist_error) or "No price data" in str(hist_error)):
                logger.info(f"yfinance failed, switching to fallback method for {ticker}")
                return fetch_stock_data_fallback(ticker, period)
            else:
                raise hist_error
        
        logger.info(f"Historical data type: {type(hist)}")
        logger.info(f"Historical data shape: {hist.shape if hasattr(hist, 'shape') else 'No shape attribute'}")
        logger.info(f"Historical data empty: {hist.empty if hasattr(hist, 'empty') else 'No empty attribute'}")
        
        if hasattr(hist, 'columns'):
            logger.info(f"Historical data columns: {list(hist.columns)}")
        
        if hasattr(hist, 'index'):
            logger.info(f"Historical data index type: {type(hist.index)}")
            logger.info(f"Historical data index length: {len(hist.index)}")
        
        if hist.empty:
            logger.error(f"No data found for ticker {ticker} with period {period}")
            return {"error": f"No data found for ticker {ticker}"}
        
        # Log first few rows of data
        logger.info(f"First 3 rows of historical data:\n{hist.head(3)}")
        logger.info(f"Last 3 rows of historical data:\n{hist.tail(3)}")
        
        # Check for Close column specifically
        if 'Close' not in hist.columns:
            logger.error(f"Close column not found in historical data for {ticker}. Available columns: {list(hist.columns)}")
            return {"error": f"Close price data not available for {ticker}"}
        
        # Get current price and previous close
        logger.info(f"Getting current price and previous close for {ticker}")
        current_price = hist['Close'].iloc[-1]
        previous_close = hist['Close'].iloc[-2] if len(hist) > 1 else current_price
        
        logger.info(f"Current price: {current_price}, Previous close: {previous_close}")
        
        # Calculate 24h price change based on timeframe
        if period == '1d':
            # For 1d timeframe, calculate 24h return from 24 hours ago (1440 minutes)
            if len(hist) >= 1440:
                price_24h_ago = hist['Close'].iloc[-1440]
                price_change_24h = ((current_price - price_24h_ago) / price_24h_ago) * 100.0
            else:
                # If not enough data, use period return
                price_change_24h = ((current_price - start_price) / start_price) * 100.0
        else:
            # For other timeframes, use previous day calculation
            price_change_24h = ((current_price - previous_close) / previous_close) * 100.0
        logger.info(f"24h price change: {price_change_24h}%")
        
        # Calculate annual return (from start of period to current)
        start_price = hist['Close'].iloc[0]
        annual_return = ((current_price - start_price) / start_price) * 100.0
        logger.info(f"Annual return: {annual_return}% (start: {start_price}, current: {current_price})")
        
        # Calculate 7-day return (appropriate for timeframe)
        if period == '1d':
            # For 1d, use last 2 hours (120 minutes) as "7-day" equivalent
            week_points = min(120, len(hist) - 1)
        elif period == '7d':
            # For 7d, use last 7 hours
            week_points = min(7, len(hist) - 1)
        elif period == '30d':
            # For 30d, use last 7 days
            week_points = min(7, len(hist) - 1)
        else:  # 1y
            # For 1y, use last 7 days
            week_points = min(7, len(hist) - 1)
        
        if len(hist) > week_points:
            week_ago_price = hist['Close'].iloc[-week_points-1]
            week_return = ((current_price - week_ago_price) / week_ago_price) * 100.0
            logger.info(f"7-day return: {week_return}% (week ago: {week_ago_price})")
        else:
            week_return = annual_return  # Fallback to annual return if not enough data
            logger.info(f"7-day return: {week_return}% (fallback to annual return, insufficient data)")
        
        # Calculate volatility (annualized based on period)
        logger.info(f"Calculating volatility for {ticker}")
        log_returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
        logger.info(f"Log returns calculated, length: {len(log_returns)}")
        
        if len(log_returns) > 1:
            if period == '1d':
                # For 1d data (minute intervals), scale to daily volatility
                volatility = log_returns.std() * np.sqrt(1440) * 100.0  # 1440 minutes in a day
            elif period == '7d':
                # For 7d data (hourly intervals), scale to daily volatility
                volatility = log_returns.std() * np.sqrt(24) * 100.0  # 24 hours in a day
            else:
                # For daily data, standard annualized volatility
                volatility = log_returns.std() * np.sqrt(252) * 100.0  # 252 trading days
            logger.info(f"Volatility calculated: {volatility}%")
        else:
            volatility = 0.0
            logger.warning(f"Insufficient data for volatility calculation for {ticker}")
        
        # Prepare chart data in the same format as crypto stats
        logger.info(f"Preparing chart data for {ticker}")
        chart_data = prepare_chart_data(hist, period)
        logger.info(f"Chart data prepared, {len(chart_data)} data points")
        
        result = {
            "current_price": round(current_price, 2),
            "price_change_24h": round(price_change_24h, 2),
            "week_return": round(week_return, 2),
            "annual_return": round(annual_return, 2),
            "volatility": round(volatility, 2),
            "chart_data": chart_data
        }
        
        logger.info(f"=== Successfully completed fetch_stock_stats for {ticker} ===")
        logger.info(f"Result: {result}")
        return result
        
    except Exception as e:
        logger.error(f"=== ERROR in fetch_stock_stats for {ticker} ===")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception message: {str(e)}")
        logger.error(f"Exception details: {repr(e)}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        
        # Try fallback method if yfinance completely fails
        logger.info(f"Attempting fallback method for {ticker} due to yfinance failure")
        try:
            fallback_result = fetch_stock_data_fallback(ticker, period)
            if 'error' not in fallback_result:
                logger.info(f"Fallback method succeeded for {ticker}")
                return fallback_result
            else:
                logger.error(f"Fallback method also failed for {ticker}: {fallback_result.get('error')}")
        except Exception as fallback_error:
            logger.error(f"Fallback method exception for {ticker}: {str(fallback_error)}")
        
        return {"error": f"Error fetching data for {ticker}: {str(e)}"}

def prepare_chart_data(hist_data, period):
    """
    Prepare chart data in the same format as crypto stats lambda.
    
    Args:
        hist_data: Historical data from yfinance
        period: Time period
        
    Returns:
        list: Chart data points
    """
    try:
        logger.info(f"=== Starting prepare_chart_data for period {period} ===")
        logger.info(f"Input hist_data type: {type(hist_data)}")
        logger.info(f"Input hist_data shape: {hist_data.shape if hasattr(hist_data, 'shape') else 'No shape'}")
        
        chart_data = []
        
        # Limit data points based on period for performance
        max_points = {
            '1d': 24,    # Hourly data
            '7d': 7,     # Daily data
            '30d': 30,   # Daily data
            '1y': 365    # Daily data
        }.get(period, 365)
        
        logger.info(f"Max points for period {period}: {max_points}")
        
        # Take the last max_points data points
        recent_data = hist_data.tail(max_points)
        logger.info(f"Recent data shape: {recent_data.shape}")
        logger.info(f"Recent data index type: {type(recent_data.index)}")
        
        for i, (date, row) in enumerate(recent_data.iterrows()):
            try:
                logger.info(f"Processing row {i}: date={date}, type={type(date)}")
                logger.info(f"Row data: {row}")
                
                # Convert date to timestamp
                if hasattr(date, 'timestamp'):
                    timestamp = int(date.timestamp())
                else:
                    # Fallback for different date types
                    import pandas as pd
                    if isinstance(date, pd.Timestamp):
                        timestamp = int(date.timestamp())
                    else:
                        logger.error(f"Unsupported date type: {type(date)}")
                        continue
                
                close_price = round(row['Close'], 2)
                
                # Format time label based on period
                if period == '1d':
                    # For 1d, show time (HH:MM)
                    time_label = date.strftime('%H:%M')
                elif period == '7d':
                    # For 7d, show day and time
                    time_label = date.strftime('%m/%d %H:%M')
                elif period == '30d':
                    # For 30d, show month/day
                    time_label = date.strftime('%m/%d')
                else:  # 1y
                    # For 1y, show month/year
                    time_label = date.strftime('%m/%y')
                
                chart_data.append({
                    'time': timestamp,
                    'time_label': time_label,
                    'close': close_price
                })
                
                logger.info(f"Added data point: time={timestamp}, time_label={time_label}, close={close_price}")
                
            except Exception as row_error:
                logger.error(f"Error processing row {i}: {str(row_error)}")
                logger.error(f"Row data: {row}")
                continue
        
        logger.info(f"=== Completed prepare_chart_data, returning {len(chart_data)} data points ===")
        return chart_data
        
    except Exception as e:
        logger.error(f"=== ERROR in prepare_chart_data ===")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception message: {str(e)}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return []

def fetch_quote_data(stock, ticker):
    """Fetch current quote data for a stock using yfinance."""
    try:
        info = stock.info
        
        current_price = info.get('currentPrice', info.get('regularMarketPrice', 0))
        previous_close = info.get('previousClose', 0)
        change = current_price - previous_close
        change_percent = (change / previous_close * 100) if previous_close > 0 else 0
        
        return {
            'current_price': round(current_price, 2),
            'previous_close': round(previous_close, 2),
            'change': round(change, 2),
            'change_percent': round(change_percent, 2),
            'volume': info.get('volume', info.get('regularMarketVolume', 0)),
            'market_cap': info.get('marketCap', 0),
            'currency': info.get('currency', 'USD'),
            'exchange': info.get('exchange', ''),
            'market_state': info.get('marketState', 'CLOSED'),
            'day_high': info.get('dayHigh', 0),
            'day_low': info.get('dayLow', 0),
            'open': info.get('open', 0),
            'bid': info.get('bid', 0),
            'ask': info.get('ask', 0),
            'bid_size': info.get('bidSize', 0),
            'ask_size': info.get('askSize', 0)
        }
        
    except Exception as e:
        logger.error(f"Error fetching quote data for {ticker}: {str(e)}")
        return generate_mock_quote_data(ticker)

def fetch_historical_data(stock, ticker, period="1y"):
    """Fetch historical price data for a stock using yfinance."""
    try:
        # Get historical data
        hist = stock.history(period=period)
        
        if hist.empty:
            raise ValueError(f"No historical data found for ticker {ticker}")
        
        # Convert to list of dictionaries
        historical_points = []
        for date, row in hist.iterrows():
            historical_points.append({
                'date': date.isoformat(),
                'timestamp': int(date.timestamp()),
                'open': round(row['Open'], 2) if pd.notna(row['Open']) else None,
                'high': round(row['High'], 2) if pd.notna(row['High']) else None,
                'low': round(row['Low'], 2) if pd.notna(row['Low']) else None,
                'close': round(row['Close'], 2) if pd.notna(row['Close']) else None,
                'volume': int(row['Volume']) if pd.notna(row['Volume']) else None
            })
        
        return {
            'period': period,
            'data_points': len(historical_points),
            'prices': historical_points[-30:] if len(historical_points) > 30 else historical_points,  # Last 30 points for chart
            'all_data': historical_points  # All data for calculations
        }
        
    except Exception as e:
        logger.error(f"Error fetching historical data for {ticker}: {str(e)}")
        return generate_mock_historical_data(ticker, period)

def calculate_technical_indicators(historical_data):
    """Calculate technical indicators from historical data."""
    try:
        if not historical_data.get('all_data'):
            return generate_mock_technical_indicators()
        
        # Convert to pandas DataFrame for easier calculations
        df = pd.DataFrame(historical_data['all_data'])
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        
        if len(df) < 20:
            return generate_mock_technical_indicators()
        
        # Calculate moving averages
        sma_20 = df['close'].rolling(window=20).mean().iloc[-1] if len(df) >= 20 else df['close'].iloc[-1]
        sma_50 = df['close'].rolling(window=50).mean().iloc[-1] if len(df) >= 50 else df['close'].iloc[-1]
        sma_200 = df['close'].rolling(window=200).mean().iloc[-1] if len(df) >= 200 else df['close'].iloc[-1]
        
        # Calculate volatility (standard deviation of returns)
        returns = df['close'].pct_change().dropna()
        volatility = returns.std() * np.sqrt(252)  # Annualized
        
        # Calculate RSI
        rsi = calculate_rsi(df['close'].values)
        
        # Calculate MACD
        macd_line, macd_signal, macd_histogram = calculate_macd(df['close'].values)
        
        # Calculate Bollinger Bands
        bb_upper, bb_middle, bb_lower = calculate_bollinger_bands(df['close'].values)
        
        # Calculate support and resistance levels
        recent_highs = df['high'].tail(20)
        recent_lows = df['low'].tail(20)
        
        resistance = recent_highs.max()
        support = recent_lows.min()
        
        # Determine trend
        current_price = df['close'].iloc[-1]
        if current_price > sma_20 > sma_50:
            trend = 'strong_bullish'
        elif current_price > sma_20:
            trend = 'bullish'
        elif current_price < sma_20 < sma_50:
            trend = 'strong_bearish'
        elif current_price < sma_20:
            trend = 'bearish'
        else:
            trend = 'sideways'
        
        return {
            'sma_20': round(sma_20, 2),
            'sma_50': round(sma_50, 2),
            'sma_200': round(sma_200, 2),
            'volatility': round(volatility, 4),
            'volatility_percent': round(volatility * 100, 2),
            'rsi': round(rsi, 2),
            'macd': {
                'macd_line': round(macd_line, 4),
                'signal_line': round(macd_signal, 4),
                'histogram': round(macd_histogram, 4)
            },
            'bollinger_bands': {
                'upper': round(bb_upper, 2),
                'middle': round(bb_middle, 2),
                'lower': round(bb_lower, 2)
            },
            'resistance': round(resistance, 2),
            'support': round(support, 2),
            'trend': trend
        }
        
    except Exception as e:
        logger.error(f"Error calculating technical indicators: {str(e)}")
        return generate_mock_technical_indicators()

def calculate_rsi(prices, period=14):
    """Calculate Relative Strength Index."""
    if len(prices) < period + 1:
        return 50
    
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    
    if avg_loss == 0:
        return 100
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    return rsi

def calculate_macd(prices, fast=12, slow=26, signal=9):
    """Calculate MACD (Moving Average Convergence Divergence)."""
    if len(prices) < slow:
        return 0, 0, 0
    
    # Convert to pandas Series for easier EMA calculation
    series = pd.Series(prices)
    
    ema_fast = series.ewm(span=fast).mean()
    ema_slow = series.ewm(span=slow).mean()
    
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal).mean()
    histogram = macd_line - signal_line
    
    return macd_line.iloc[-1], signal_line.iloc[-1], histogram.iloc[-1]

def calculate_bollinger_bands(prices, period=20, std_dev=2):
    """Calculate Bollinger Bands."""
    if len(prices) < period:
        current_price = prices[-1]
        return current_price * 1.02, current_price, current_price * 0.98
    
    series = pd.Series(prices)
    sma = series.rolling(window=period).mean()
    std = series.rolling(window=period).std()
    
    upper_band = sma + (std * std_dev)
    lower_band = sma - (std * std_dev)
    
    return upper_band.iloc[-1], sma.iloc[-1], lower_band.iloc[-1]

def fetch_company_info(stock, ticker):
    """Fetch company information using yfinance."""
    try:
        info = stock.info
        
        return {
            'name': info.get('longName', ticker.upper()),
            'sector': info.get('sector', 'Unknown'),
            'industry': info.get('industry', 'Unknown'),
            'description': info.get('longBusinessSummary', f'Stock information for {ticker.upper()}'),
            'website': info.get('website', ''),
            'employees': info.get('fullTimeEmployees', 0),
            'country': info.get('country', 'Unknown'),
            'city': info.get('city', 'Unknown'),
            'state': info.get('state', 'Unknown'),
            'zip': info.get('zip', ''),
            'phone': info.get('phone', ''),
            'ceo': info.get('companyOfficers', [{}])[0].get('name', 'Unknown') if info.get('companyOfficers') else 'Unknown'
        }
    except Exception as e:
        logger.error(f"Error fetching company info for {ticker}: {str(e)}")
        return {
            'name': ticker.upper(),
            'sector': 'Unknown',
            'industry': 'Unknown',
            'description': f'Stock information for {ticker.upper()}',
            'website': '',
            'employees': 0,
            'country': 'Unknown',
            'city': 'Unknown',
            'state': 'Unknown',
            'zip': '',
            'phone': '',
            'ceo': 'Unknown'
        }

def calculate_advanced_analytics(stock, ticker, historical_data):
    """Calculate advanced financial analytics."""
    try:
        info = stock.info
        
        # Financial ratios
        pe_ratio = info.get('trailingPE', 0)
        forward_pe = info.get('forwardPE', 0)
        peg_ratio = info.get('pegRatio', 0)
        price_to_book = info.get('priceToBook', 0)
        price_to_sales = info.get('priceToSalesTrailing12Months', 0)
        
        # Profitability metrics
        profit_margin = info.get('profitMargins', 0)
        operating_margin = info.get('operatingMargins', 0)
        gross_margin = info.get('grossMargins', 0)
        
        # Growth metrics
        revenue_growth = info.get('revenueGrowth', 0)
        earnings_growth = info.get('earningsGrowth', 0)
        
        # Debt metrics
        debt_to_equity = info.get('debtToEquity', 0)
        current_ratio = info.get('currentRatio', 0)
        quick_ratio = info.get('quickRatio', 0)
        
        # Return metrics
        roe = info.get('returnOnEquity', 0)
        roa = info.get('returnOnAssets', 0)
        
        # Dividend information
        dividend_yield = info.get('dividendYield', 0)
        dividend_rate = info.get('dividendRate', 0)
        payout_ratio = info.get('payoutRatio', 0)
        
        # Calculate returns from historical data
        week_return = 0
        annual_return = 0
        
        if historical_data and len(historical_data) > 0:
            try:
                # Get current price and prices from different time periods
                current_price = info.get('currentPrice', info.get('regularMarketPrice', 0))
                
                # Calculate week return (7 days ago)
                if len(historical_data) >= 7:
                    week_ago_price = historical_data[-7].get('close', current_price)
                    if week_ago_price > 0:
                        week_return = ((current_price - week_ago_price) / week_ago_price) * 100
                
                # Calculate annual return (1 year ago or earliest available)
                if len(historical_data) >= 252:  # ~1 year of trading days
                    year_ago_price = historical_data[-252].get('close', current_price)
                elif len(historical_data) > 0:
                    year_ago_price = historical_data[0].get('close', current_price)
                else:
                    year_ago_price = current_price
                
                if year_ago_price > 0:
                    annual_return = ((current_price - year_ago_price) / year_ago_price) * 100
                    
                logger.info(f"Calculated returns for {ticker}: week_return={week_return:.2f}%, annual_return={annual_return:.2f}%")
                
            except Exception as calc_error:
                logger.error(f"Error calculating returns: {str(calc_error)}")
        
        return {
            'valuation': {
                'pe_ratio': round(pe_ratio, 2) if pe_ratio else None,
                'forward_pe': round(forward_pe, 2) if forward_pe else None,
                'peg_ratio': round(peg_ratio, 2) if peg_ratio else None,
                'price_to_book': round(price_to_book, 2) if price_to_book else None,
                'price_to_sales': round(price_to_sales, 2) if price_to_sales else None
            },
            'profitability': {
                'profit_margin': round(profit_margin * 100, 2) if profit_margin else None,
                'operating_margin': round(operating_margin * 100, 2) if operating_margin else None,
                'gross_margin': round(gross_margin * 100, 2) if gross_margin else None
            },
            'growth': {
                'revenue_growth': round(revenue_growth * 100, 2) if revenue_growth else None,
                'earnings_growth': round(earnings_growth * 100, 2) if earnings_growth else None
            },
            'debt': {
                'debt_to_equity': round(debt_to_equity, 2) if debt_to_equity else None,
                'current_ratio': round(current_ratio, 2) if current_ratio else None,
                'quick_ratio': round(quick_ratio, 2) if quick_ratio else None
            },
            'returns': {
                'roe': round(roe * 100, 2) if roe else None,
                'roa': round(roa * 100, 2) if roa else None,
                'week_return': round(week_return, 2),
                'annual_return': round(annual_return, 2)
            },
            'dividend': {
                'dividend_yield': round(dividend_yield * 100, 2) if dividend_yield else None,
                'dividend_rate': round(dividend_rate, 2) if dividend_rate else None,
                'payout_ratio': round(payout_ratio * 100, 2) if payout_ratio else None
            }
        }
        
    except Exception as e:
        logger.error(f"Error calculating advanced analytics for {ticker}: {str(e)}")
        return generate_mock_analytics()

def generate_mock_stock_data(ticker, period):
    """Generate mock stock data as fallback."""
    return {
        'ticker': ticker.upper(),
        'period': period,
        'quote': generate_mock_quote_data(ticker),
        'historical': generate_mock_historical_data(ticker, period),
        'technical': generate_mock_technical_indicators(),
        'company': {
            'name': ticker.upper(),
            'sector': 'Technology',
            'industry': 'Software',
            'description': f'Mock data for {ticker.upper()}',
            'website': '',
            'employees': 1000,
            'country': 'United States',
            'city': 'San Francisco',
            'state': 'CA',
            'zip': '94105',
            'phone': '',
            'ceo': 'John Doe'
        },
        'analytics': generate_mock_analytics(),
        'data_source': 'Mock Data (Fallback)',
        'timestamp': datetime.now().isoformat()
    }

def generate_mock_quote_data(ticker):
    """Generate mock quote data."""
    base_price = 100 + (hash(ticker) % 500)
    change = (hash(ticker + "change") % 20) - 10
    return {
        'current_price': round(base_price, 2),
        'previous_close': round(base_price - change, 2),
        'change': round(change, 2),
        'change_percent': round((change / (base_price - change)) * 100, 2),
        'volume': 1000000 + (hash(ticker) % 5000000),
        'market_cap': base_price * 1000000000,
        'currency': 'USD',
        'exchange': 'NASDAQ',
        'market_state': 'CLOSED',
        'day_high': round(base_price + 5, 2),
        'day_low': round(base_price - 5, 2),
        'open': round(base_price - 1, 2),
        'bid': round(base_price - 0.01, 2),
        'ask': round(base_price + 0.01, 2),
        'bid_size': 100,
        'ask_size': 100
    }

def generate_mock_historical_data(ticker, period):
    """Generate mock historical data."""
    base_price = 100 + (hash(ticker) % 500)
    points = []
    
    for i in range(30):
        price = base_price + (i * 0.5) + ((hash(ticker + str(i)) % 10) - 5)
        points.append({
            'date': (datetime.now() - timedelta(days=30-i)).isoformat(),
            'timestamp': int((datetime.now() - timedelta(days=30-i)).timestamp()),
            'open': round(price, 2),
            'high': round(price + 2, 2),
            'low': round(price - 2, 2),
            'close': round(price, 2),
            'volume': 1000000 + (hash(ticker + str(i)) % 1000000)
        })
    
    return {
        'period': period,
        'data_points': len(points),
        'prices': points,
        'all_data': points
    }

def generate_mock_technical_indicators():
    """Generate mock technical indicators."""
    return {
        'sma_20': 150.25,
        'sma_50': 148.75,
        'sma_200': 145.50,
        'volatility': 0.25,
        'volatility_percent': 25.0,
        'rsi': 55.5,
        'macd': {
            'macd_line': 0.5,
            'signal_line': 0.3,
            'histogram': 0.2
        },
        'bollinger_bands': {
            'upper': 160.0,
            'middle': 150.0,
            'lower': 140.0
        },
        'resistance': 160.0,
        'support': 140.0,
        'trend': 'bullish'
    }

def generate_mock_analytics():
    """Generate mock analytics data."""
    return {
        'valuation': {
            'pe_ratio': 25.5,
            'forward_pe': 23.2,
            'peg_ratio': 1.8,
            'price_to_book': 4.2,
            'price_to_sales': 8.5
        },
        'profitability': {
            'profit_margin': 15.2,
            'operating_margin': 18.5,
            'gross_margin': 45.8
        },
        'growth': {
            'revenue_growth': 12.5,
            'earnings_growth': 18.2
        },
        'debt': {
            'debt_to_equity': 0.3,
            'current_ratio': 2.1,
            'quick_ratio': 1.8
        },
        'returns': {
            'roe': 22.5,
            'roa': 12.8
        },
        'dividend': {
            'dividend_yield': 1.2,
            'dividend_rate': 2.5,
            'payout_ratio': 25.0
        }
    }

def generate_mock_stock_data(ticker, period="1y"):
    """Generate mock stock data in crypto stats format."""
    base_price = 100 + (hash(ticker) % 500)
    
    # Generate mock chart data
    chart_data = []
    for i in range(30):
        price = base_price + (i * 0.5) + ((hash(ticker + str(i)) % 10) - 5)
        chart_data.append({
            'time': int((datetime.now() - timedelta(days=30-i)).timestamp()),
            'close': round(price, 2)
        })
    
    return {
        'current_price': base_price,
        'price_change_24h': round((hash(ticker) % 20) - 10, 2),
        'week_return': round((hash(ticker) % 40) - 20, 2),
        'annual_return': round((hash(ticker) % 100) - 50, 2),
        'volatility': round((hash(ticker) % 50) / 100, 4),
        'chart_data': chart_data,
        'data_source': 'Mock Data',
        'timestamp': datetime.now().isoformat()
    }

def fetch_stock_data_alpha_vantage(ticker, period="1y"):
    """
    Fetch stock data using Alpha Vantage REST API.
    
    Based on https://www.alphavantage.co/documentation/
    Uses direct HTTP requests to their REST endpoints.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"🔑 === USING ALPHA VANTAGE REST API FOR {ticker.upper()} ===")
        
        # Get API key from Secrets Manager
        logger.info(f"🔍 Fetching Alpha Vantage API key from Secrets Manager...")
        api_key = get_alpha_vantage_api_key()
        if not api_key:
            logger.error("❌ Alpha Vantage API key not available")
            return {"error": "Alpha Vantage API key not configured"}
        else:
            logger.info(f"✅ Alpha Vantage API key successfully retrieved (length: {len(api_key)})")
        
        # Map period to Alpha Vantage API functions
        # Based on https://www.alphavantage.co/documentation/
        if period == '1d':
            # Intraday data for 1 day
            function = 'TIME_SERIES_INTRADAY'
            interval = '60min'  # 1-hour intervals for 1 day
            outputsize = 'compact'  # Last 100 data points
            logger.info(f"📅 Using Alpha Vantage INTRADAY API for 1-day data (60min intervals)")
        elif period == '7d':
            # Intraday data for 7 days
            function = 'TIME_SERIES_INTRADAY'
            interval = '60min'  # 1-hour intervals
            outputsize = 'full'  # Full data for 7 days
            logger.info(f"📅 Using Alpha Vantage INTRADAY API for 7-day data (60min intervals)")
        elif period == '30d':
            # Daily data for 30 days
            function = 'TIME_SERIES_DAILY'
            interval = None  # Not used for daily
            outputsize = 'compact'  # Last 100 days
            logger.info(f"📅 Using Alpha Vantage DAILY API for 30-day data")
        else:  # 1y
            # Daily data for 1 year
            function = 'TIME_SERIES_DAILY'
            interval = None  # Not used for daily
            outputsize = 'full'  # Full year of data
            logger.info(f"📅 Using Alpha Vantage DAILY API for 1-year data")
        
        # Build Alpha Vantage API URL
        base_url = "https://www.alphavantage.co/query"
        params = {
            'function': function,
            'symbol': ticker,
            'apikey': api_key,
            'outputsize': outputsize,
            'datatype': 'json'
        }
        
        # Add interval for intraday data
        if interval:
            params['interval'] = interval
        
        logger.info(f"🌐 Alpha Vantage API URL: {base_url}")
        logger.info(f"📋 Alpha Vantage API params: function={function}, symbol={ticker}, outputsize={outputsize}")
        if interval:
            logger.info(f"⏰ Alpha Vantage interval: {interval}")
        
        # Make HTTP request to Alpha Vantage
        logger.info(f"🚀 Making HTTP request to Alpha Vantage API...")
        response = requests.get(base_url, params=params, timeout=30)
        logger.info(f"📡 Alpha Vantage API response status: {response.status_code}")
        
        if response.status_code != 200:
            logger.error(f"Alpha Vantage API returned status {response.status_code}")
            return {"error": f"Alpha Vantage API error: {response.status_code}"}
        
        data = response.json()
        
        # Check for API errors
        if 'Error Message' in data:
            logger.error(f"Alpha Vantage API error: {data['Error Message']}")
            return {"error": f"Alpha Vantage API error: {data['Error Message']}"}
        
        if 'Note' in data:
            logger.warning(f"Alpha Vantage API note: {data['Note']}")
            return {"error": "Alpha Vantage API rate limited"}
        
        # Extract time series data based on function
        if function == 'TIME_SERIES_INTRADAY':
            time_series_key = f'Time Series ({interval})'
        else:  # TIME_SERIES_DAILY
            time_series_key = 'Time Series (Daily)'
        
        if time_series_key not in data:
            logger.error(f"Alpha Vantage API response missing time series: {list(data.keys())}")
            return {"error": "Alpha Vantage API response format error"}
        
        time_series = data[time_series_key]
        
        if not time_series:
            logger.error(f"No time series data returned for {ticker}")
            return {"error": f"No data available from Alpha Vantage for {ticker}"}
        
        # Convert to sorted list of (timestamp, data) tuples
        sorted_data = []
        for timestamp_str, price_data in time_series.items():
            try:
                # Parse timestamp (Alpha Vantage format: "2024-01-15 16:00:00" or "2024-01-15")
                if ' ' in timestamp_str:
                    timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
                else:
                    timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d')
                
                sorted_data.append((timestamp, price_data))
            except ValueError as e:
                logger.warning(f"Could not parse timestamp {timestamp_str}: {e}")
                continue
        
        # Sort by timestamp
        sorted_data.sort(key=lambda x: x[0])
        
        if not sorted_data:
            return {"error": f"No valid data points for {ticker}"}
        
        # Extract price data
        prices = []
        for timestamp, price_data in sorted_data:
            try:
                close_price = float(price_data['4. close'])
                prices.append((timestamp, close_price))
            except (KeyError, ValueError) as e:
                logger.warning(f"Could not parse price data for {timestamp}: {e}")
                continue
        
        if not prices:
            return {"error": f"No valid price data for {ticker}"}
        
        # Calculate statistics
        current_price = prices[-1][1]
        previous_price = prices[-2][1] if len(prices) > 1 else current_price
        price_change_24h = ((current_price - previous_price) / previous_price) * 100.0
        
        # Calculate period returns
        start_price = prices[0][1]
        period_return = ((current_price - start_price) / start_price) * 100.0
        
        # Calculate 7-day return
        if len(prices) >= 7:
            week_ago_price = prices[-7][1]
            week_return = ((current_price - week_ago_price) / week_ago_price) * 100.0
        else:
            week_return = period_return
        
        # For annual return, scale based on period
        if period == '1d':
            annual_return = period_return * 365
        elif period == '7d':
            annual_return = period_return * (365/7)
        elif period == '30d':
            annual_return = period_return * (365/30)
        else:  # 1y
            annual_return = period_return
        
        # Calculate volatility
        if len(prices) > 1:
            returns = []
            for i in range(1, len(prices)):
                daily_return = (prices[i][1] - prices[i-1][1]) / prices[i-1][1]
                returns.append(daily_return)
            
            if returns:
                volatility = np.std(returns) * np.sqrt(252) * 100.0  # Annualized
            else:
                volatility = 0.0
        else:
            volatility = 0.0
        
        # Prepare chart data
        chart_data = []
        for timestamp, price in prices[-100:]:  # Last 100 points
            chart_data.append({
                'time': int(timestamp.timestamp()),
                'close': round(price, 2)
            })
        
        result = {
            'current_price': round(current_price, 2),
            'price_change_24h': round(price_change_24h, 2),
            'week_return': round(week_return, 2),
            'annual_return': round(annual_return, 2),
            'volatility': round(volatility / 100, 4),  # Convert to decimal
            'chart_data': chart_data,
            'data_source': 'Alpha Vantage REST API',
            'timestamp': datetime.now().isoformat()
        }
        
        logger.info(f"Alpha Vantage REST API successful for {ticker}")
        logger.info(f"Chart data points: {len(chart_data)}")
        return result
        
    except Exception as e:
        logger.error(f"Alpha Vantage REST API failed for {ticker}: {str(e)}")
        return {"error": f"Alpha Vantage API failed: {str(e)}"}

def fetch_stock_data_yfinance(ticker, period="1y"):
    """
    Fetch stock data using yfinance library with improved rate limiting.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"=== Using yfinance library for {ticker} ===")
        
        # Apply enhanced rate limiting
        rate_limit_check(ticker)
        
        # Create yfinance Ticker object
        stock = yf.Ticker(ticker)
        
        # Get historical data with error handling
        try:
            hist = stock.history(period=period)
            if hist.empty:
                return {"error": f"No data found for ticker {ticker}"}
        except Exception as hist_error:
            logger.error(f"yfinance history failed for {ticker}: {str(hist_error)}")
            if ("429" in str(hist_error) or "Too Many Requests" in str(hist_error) or 
                "Expecting value" in str(hist_error) or "No price data" in str(hist_error)):
                return {"error": f"yfinance rate limited or failed: {str(hist_error)}"}
            else:
                raise hist_error
        
        # Calculate basic statistics
        current_price = hist['Close'].iloc[-1]
        previous_close = hist['Close'].iloc[-2] if len(hist) > 1 else current_price
        price_change_24h = ((current_price - previous_close) / previous_close) * 100.0
        
        # Calculate period returns
        start_price = hist['Close'].iloc[0]
        period_return = ((current_price - start_price) / start_price) * 100.0
        
        # Calculate 7-day return
        if len(hist) >= 7:
            week_ago_price = hist['Close'].iloc[-7]
            week_return = ((current_price - week_ago_price) / week_ago_price) * 100.0
        else:
            week_return = period_return
        
        # For annual return, scale based on period
        if period == '1d':
            annual_return = period_return * 365
        elif period == '7d':
            annual_return = period_return * (365/7)
        elif period == '30d':
            annual_return = period_return * (365/30)
        else:  # 1y
            annual_return = period_return
        
        # Calculate volatility
        log_returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
        if len(log_returns) > 1:
            if period == '1d':
                volatility = log_returns.std() * np.sqrt(1440) * 100.0
            elif period == '7d':
                volatility = log_returns.std() * np.sqrt(24) * 100.0
            else:
                volatility = log_returns.std() * np.sqrt(252) * 100.0
        else:
            volatility = 0.0
        
        # Prepare chart data
        chart_data = []
        for date, row in hist.tail(100).iterrows():  # Last 100 points
            chart_data.append({
                'time': int(date.timestamp()),
                'close': round(float(row['Close']), 2)
            })
        
        result = {
            'current_price': round(current_price, 2),
            'price_change_24h': round(price_change_24h, 2),
            'week_return': round(week_return, 2),
            'annual_return': round(annual_return, 2),
            'volatility': round(volatility / 100, 4),  # Convert to decimal
            'chart_data': chart_data,
            'data_source': 'Yahoo Finance via yfinance',
            'timestamp': datetime.now().isoformat()
        }
        
        logger.info(f"yfinance successful for {ticker}")
        logger.info(f"Chart data points: {len(chart_data)}")
        return result
        
    except Exception as e:
        logger.error(f"yfinance failed for {ticker}: {str(e)}")
        return {"error": f"yfinance API failed: {str(e)}"}

def fetch_stock_stats(ticker, period="1y"):
    """
    Main function to fetch stock statistics in crypto stats format for tile compatibility.
    This function tries multiple methods in order of preference.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Stock statistics matching crypto stats format
    """
    try:
        logger.info(f"🚀 === STARTING STOCK DATA FETCH FOR {ticker.upper()} (period: {period}) ===")
        
        # Method 1: Try yfinance library first (free, but rate limited)
        try:
            logger.info(f"📊 Method 1: Attempting yfinance library for {ticker}")
            result = fetch_stock_data_yfinance(ticker, period)
            if 'error' not in result:
                logger.info(f"✅ Method 1 (yfinance) SUCCESS for {ticker} - Data source: {result.get('data_source', 'yfinance')}")
                logger.info(f"📈 Result summary: Price=${result.get('current_price', 'N/A')}, Change={result.get('price_change_24h', 'N/A')}%, Chart points={len(result.get('chart_data', []))}")
                return result
            else:
                logger.warning(f"❌ Method 1 (yfinance) FAILED for {ticker}: {result.get('error', 'Unknown error')}")
        except Exception as e:
            logger.warning(f"❌ Method 1 (yfinance) EXCEPTION for {ticker}: {str(e)}")
        
        # Method 2: Try direct HTTP Yahoo Finance (free fallback)
        try:
            logger.info(f"🌐 Method 2: Attempting direct HTTP Yahoo Finance for {ticker}")
            result = fetch_stock_data_direct_http(ticker, period)
            if 'error' not in result:
                logger.info(f"✅ Method 2 (direct HTTP) SUCCESS for {ticker} - Data source: {result.get('data_source', 'Direct HTTP')}")
                logger.info(f"📈 Result summary: Price=${result.get('current_price', 'N/A')}, Change={result.get('price_change_24h', 'N/A')}%, Chart points={len(result.get('chart_data', []))}")
                return result
            else:
                logger.warning(f"❌ Method 2 (direct HTTP) FAILED for {ticker}: {result.get('error', 'Unknown error')}")
        except Exception as e:
            logger.warning(f"❌ Method 2 (direct HTTP) EXCEPTION for {ticker}: {str(e)}")
        
        # Method 3: Try Alpha Vantage API (costs money, use sparingly)
        try:
            logger.info(f"🔑 Method 3: Attempting Alpha Vantage REST API for {ticker}")
            logger.info(f"🔍 Checking Alpha Vantage API key availability...")
            api_key = get_alpha_vantage_api_key()
            if not api_key:
                logger.warning(f"⚠️ Alpha Vantage API key not available, skipping Method 3 for {ticker}")
            else:
                logger.info(f"🔑 Alpha Vantage API key found, proceeding with API call for {ticker}")
                result = fetch_stock_data_alpha_vantage(ticker, period)
                if 'error' not in result:
                    logger.info(f"✅ Method 3 (Alpha Vantage) SUCCESS for {ticker} - Data source: {result.get('data_source', 'Alpha Vantage')}")
                    logger.info(f"📈 Result summary: Price=${result.get('current_price', 'N/A')}, Change={result.get('price_change_24h', 'N/A')}%, Chart points={len(result.get('chart_data', []))}")
                    return result
                else:
                    logger.warning(f"❌ Method 3 (Alpha Vantage) FAILED for {ticker}: {result.get('error', 'Unknown error')}")
        except Exception as e:
            logger.warning(f"❌ Method 3 (Alpha Vantage) EXCEPTION for {ticker}: {str(e)}")
        
        # Method 4: Try enhanced HTTP fallback (original yfinance comprehensive method)
        try:
            logger.info(f"🔄 Method 4: Attempting enhanced HTTP fallback for {ticker}")
            stock_data = fetch_stock_data(ticker, period)
            
            # Convert comprehensive data to crypto stats format
            if 'error' not in stock_data:
                # Get chart data from historical data
                historical_data = stock_data.get('historical', [])
                chart_data = []
                
                # Transform historical data to chart format
                if isinstance(historical_data, list):
                    for point in historical_data:
                        chart_data.append({
                            'time': point.get('timestamp', 0),
                            'close': point.get('close', 0)
                        })
                
                result = {
                    'current_price': stock_data.get('quote', {}).get('current_price', 0),
                    'price_change_24h': stock_data.get('quote', {}).get('change', 0),  # Use 'change' instead of 'price_change_24h'
                    'week_return': stock_data.get('analytics', {}).get('returns', {}).get('week_return', 0),
                    'annual_return': stock_data.get('analytics', {}).get('returns', {}).get('annual_return', 0),
                    'volatility': stock_data.get('technical', {}).get('volatility_percent', 0) / 100,
                    'chart_data': chart_data,
                    'data_source': stock_data.get('data_source', 'Yahoo Finance'),
                    'timestamp': stock_data.get('timestamp', datetime.now().isoformat())
                }
                logger.info(f"✅ Method 4 (enhanced HTTP) SUCCESS for {ticker} - Data source: {result.get('data_source', 'Enhanced HTTP')}")
                logger.info(f"📈 Result summary: Price=${result.get('current_price', 'N/A')}, Change={result.get('price_change_24h', 'N/A')}%, Chart points={len(result.get('chart_data', []))}")
                return result
            else:
                logger.warning(f"❌ Method 4 (enhanced HTTP) FAILED for {ticker}: {stock_data.get('error', 'Unknown error')}")
        except Exception as e:
            logger.warning(f"❌ Method 4 (enhanced HTTP) EXCEPTION for {ticker}: {str(e)}")
        
        # Method 5: Return mock data as last resort
        logger.warning(f"🚨 ALL METHODS FAILED for {ticker}, falling back to mock data")
        mock_result = generate_mock_stock_data(ticker, period)
        logger.info(f"🎭 Mock data generated for {ticker}: Price=${mock_result.get('current_price', 'N/A')}, Chart points={len(mock_result.get('chart_data', []))}")
        return mock_result
        
    except Exception as e:
        logger.error(f"💥 fetch_stock_stats COMPLETE FAILURE for {ticker}: {str(e)}")
        mock_result = generate_mock_stock_data(ticker, period)
        logger.info(f"🎭 Emergency mock data generated for {ticker}: Price=${mock_result.get('current_price', 'N/A')}")
        return mock_result
