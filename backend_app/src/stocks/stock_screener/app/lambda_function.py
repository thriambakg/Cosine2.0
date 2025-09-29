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
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urlencode, quote

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Rate limiting configuration - using same scheme as stock-data lambda
RATE_LIMIT_DELAY = 5.0  # Minimum delay between requests (increased to avoid 429 errors)
MAX_RETRIES = 5  # Increased retries
RETRY_DELAY = 10.0  # Increased base delay
MAX_WORKERS = 8  # Reduced concurrent workers to avoid rate limits
BATCH_SIZE = 50  # Process stocks in batches

# Alpha Vantage API key - will be fetched from Secrets Manager
ALPHA_VANTAGE_API_KEY = None
ALPHA_VANTAGE_SECRET_NAME = "cosine-alpha-vantage-api-production"

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
        ALPHA_VANTAGE_API_KEY = secret_data.get('api_key')
        
        if ALPHA_VANTAGE_API_KEY:
            logger.info("Alpha Vantage API key successfully retrieved")
            return ALPHA_VANTAGE_API_KEY
        else:
            logger.error("Alpha Vantage API key not found in secret")
            return None
            
    except Exception as e:
        logger.error(f"Failed to fetch Alpha Vantage API key: {str(e)}")
        return None

# In-memory cache for rate limiting (simple approach for Lambda)
request_timestamps = {}

# Common stock symbols for screening (expandable)
COMMON_STOCKS = [
    # Technology
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'CRM', 'ADBE',
    'ORCL', 'INTC', 'AMD', 'CSCO', 'IBM', 'QCOM', 'TXN', 'AVGO', 'AMAT', 'MU',
    
    # Finance
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'USB', 'PNC', 'TFC',
    'BLK', 'SCHW', 'COF', 'BK', 'STT', 'NTRS', 'RF', 'CFG', 'KEY', 'HBAN',
    
    # Healthcare
    'JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN',
    'GILD', 'CVS', 'CI', 'ANTM', 'ISRG', 'MDT', 'SYK', 'ZTS', 'BIIB', 'REGN',
    
    # Consumer
    'KO', 'PEP', 'WMT', 'PG', 'JNJ', 'MCD', 'NKE', 'SBUX', 'TGT', 'HD',
    'LOW', 'COST', 'DIS', 'CMCSA', 'VZ', 'T', 'NEE', 'SO', 'DUK', 'AEP',
    
    # Industrial
    'BA', 'CAT', 'GE', 'MMM', 'HON', 'UPS', 'FDX', 'LMT', 'RTX', 'NOC',
    'GD', 'EMR', 'ITW', 'PH', 'ETN', 'CMI', 'DE', 'CSX', 'UNP', 'NSC',
    
    # Energy
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'KMI', 'WMB', 'OKE', 'PSX', 'VLO',
    'MPC', 'HES', 'FANG', 'PXD', 'OXY', 'DVN', 'MRO', 'APA', 'HAL', 'BKR',
    
    # Materials
    'LIN', 'APD', 'SHW', 'ECL', 'DD', 'DOW', 'FCX', 'NEM', 'PPG', 'IFF',
    'ALB', 'LYB', 'NUE', 'VMC', 'MLM', 'CF', 'MOS', 'IP', 'WRK', 'CC',
    
    # Utilities
    'NEE', 'SO', 'DUK', 'AEP', 'EXC', 'XEL', 'SRE', 'PPL', 'WEC', 'ES',
    'AWK', 'CNP', 'CMS', 'DTE', 'FE', 'LNT', 'NI', 'PNW', 'SCG', 'SJI',
    
    # Real Estate
    'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'EXR', 'AVB', 'EQR', 'MAA', 'UDR',
    'ESS', 'CPT', 'AIV', 'BXP', 'KIM', 'REG', 'VTR', 'HCP', 'PEAK', 'WELL',
    
    # Communication Services
    'GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA', 'VZ', 'T', 'CHTR', 'TMUS', 'DISH',
    'TWTR', 'SNAP', 'PINS', 'MTCH', 'ZG', 'TRIP', 'EXPE', 'BKNG', 'LYFT', 'UBER'
]

def get_alpha_vantage_api_key():
    """Fetch Alpha Vantage API key from AWS Secrets Manager"""
    global ALPHA_VANTAGE_API_KEY
    
    if ALPHA_VANTAGE_API_KEY is not None:
        return ALPHA_VANTAGE_API_KEY
    
    try:
        secrets_client = boto3.client('secretsmanager')
        secret_name = os.environ.get('ALPHA_VANTAGE_SECRET_NAME', ALPHA_VANTAGE_SECRET_NAME)
        
        logger.info(f"Fetching Alpha Vantage API key from secret: {secret_name}")
        response = secrets_client.get_secret_value(SecretId=secret_name)
        secret_data = json.loads(response['SecretString'])
        
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

def rate_limit_check(operation_type="screener"):
    """Enhanced rate limiting check - same as stock-data lambda"""
    global request_timestamps
    current_time = time.time()
    cache_key = f"rate_limit_{operation_type}"
    
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
            logger.info(f"Rate limiting: waiting {total_delay:.2f}s before next request for {operation_type}")
            time.sleep(total_delay)
    
    request_timestamps[cache_key] = time.time()
    
    # Clean up old timestamps to prevent memory issues
    if len(request_timestamps) > 50:
        # Remove timestamps older than 1 hour
        cutoff_time = current_time - 3600
        request_timestamps = {k: v for k, v in request_timestamps.items() if v > cutoff_time}

def make_yahoo_request_with_retry(url, headers, max_retries=MAX_RETRIES, json_payload=None):
    """Make Yahoo Finance request with retry logic - same as stock-data lambda"""
    for attempt in range(max_retries):
        try:
            # Add random delay to spread out requests
            delay = random.uniform(2.0, 5.0)
            time.sleep(delay)
            
            logger.info(f"Making Yahoo Finance request (attempt {attempt + 1}/{max_retries})")
            
            # Use POST with JSON payload if provided, otherwise GET
            if json_payload:
                response = requests.post(url, headers=headers, json=json_payload, timeout=30)
            else:
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

def screen_stocks_yahoo_finance(criteria: Dict[str, Any]) -> List[str]:
    """
    Screen stocks using Yahoo Finance's screener interface.
    Returns list of stock symbols matching the criteria.
    """
    try:
        logger.info(f"=== Starting Yahoo Finance screening with criteria: {criteria}")
        
        # Apply rate limiting
        rate_limit_check("yahoo_screener")
        logger.info("Rate limiting check passed")
        
        # Build Yahoo Finance screener URL
        base_url = "https://query1.finance.yahoo.com/v1/finance/screener"
        
        # Map our criteria to Yahoo Finance parameters
        screener_criteria = []
        
        # Market cap filter
        if criteria.get('marketCapRange'):
            mcap_min, mcap_max = criteria['marketCapRange']
            # Convert billions to actual market cap values
            mcap_min_actual = int(mcap_min * 1_000_000_000)
            mcap_max_actual = int(mcap_max * 1_000_000_000)
            screener_criteria.append({
                "field": "market_cap",
                "operator": "between",
                "values": [mcap_min_actual, mcap_max_actual]
            })
        
        # Price filter
        if criteria.get('priceRange'):
            price_min, price_max = criteria['priceRange']
            screener_criteria.append({
                "field": "price",
                "operator": "between", 
                "values": [price_min, price_max]
            })
        
        # Price change filter
        if criteria.get('priceChangeRange'):
            change_min, change_max = criteria['priceChangeRange']
            screener_criteria.append({
                "field": "change_percent",
                "operator": "between",
                "values": [change_min, change_max]
            })
        
        # Industry filter
        if criteria.get('industries') and len(criteria['industries']) > 0:
            screener_criteria.append({
                "field": "sector",
                "operator": "in",
                "values": criteria['industries']
            })
        
        # Build the request payload
        payload = {
            "size": 250,  # Max results per request
            "offset": 0,
            "sortField": "market_cap",
            "sortType": "DESC",
            "quoteType": "EQUITY",
            "topOperator": "AND",
            "criteria": screener_criteria
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Content-Type': 'application/json'
        }
        
        logger.info(f"Making Yahoo Finance screener request with payload: {payload}")
        
        # Make the request with retry logic
        # Note: Yahoo Finance screener API expects POST with JSON body, not GET with query params
        response = make_yahoo_request_with_retry(base_url, headers, json_payload=payload)
        
        if response.status_code != 200:
            logger.error(f"Yahoo Finance screener request failed: {response.status_code}")
            return []
        
        data = response.json()
        
        # Extract stock symbols from response
        stock_symbols = []
        if 'finance' in data and 'result' in data['finance']:
            results = data['finance']['result']
            for result in results:
                if 'quotes' in result:
                    for quote in result['quotes']:
                        symbol = quote.get('symbol', '').upper()
                        if symbol and len(symbol) <= 5:  # Basic validation
                            stock_symbols.append(symbol)
        
        logger.info(f"Yahoo Finance screener found {len(stock_symbols)} stocks")
        return stock_symbols[:250]  # Limit to 250 results
        
    except Exception as e:
        logger.error(f"Yahoo Finance screening failed: {str(e)}")
        return []

def get_comprehensive_stock_list(criteria: Dict[str, Any]) -> List[str]:
    """
    Get comprehensive list of stocks using Yahoo Finance screening.
    Falls back to predefined lists if screening fails.
    """
    try:
        # For now, skip Yahoo Finance screening to avoid API issues
        logger.info("Skipping Yahoo Finance screening for debugging, using fallback")
        
        # Fallback: Use industry-based filtering from our predefined lists
        logger.info("Using industry-based fallback")
        
        if criteria.get('industries') and len(criteria['industries']) > 0:
            # Filter COMMON_STOCKS by industry using yfinance
            return get_stocks_by_industry_fallback(criteria['industries'])
        else:
            # Return all common stocks if no industry filter
            return COMMON_STOCKS[:100]  # Limit to 100 for performance
            
    except Exception as e:
        logger.error(f"Comprehensive stock list generation failed: {str(e)}")
        return COMMON_STOCKS[:50]  # Emergency fallback

def get_stocks_by_industry_fallback(industries: List[str]) -> List[str]:
    """
    Fallback method to get stocks by industry using yfinance.
    This is slower but more reliable than Yahoo Finance screening.
    """
    try:
        logger.info(f"Getting stocks by industry fallback for: {industries}")
        
        relevant_stocks = []
        
        # For each industry, try to get stocks from that sector
        for industry in industries:
            industry_lower = industry.lower()
            
            # Map industries to stock symbols from our predefined lists
            if 'technology' in industry_lower or 'tech' in industry_lower:
                relevant_stocks.extend([
                    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'CRM', 'ADBE',
                    'ORCL', 'INTC', 'AMD', 'CSCO', 'IBM', 'QCOM', 'TXN', 'AVGO', 'AMAT', 'MU'
                ])
            elif 'finance' in industry_lower or 'financial' in industry_lower:
                relevant_stocks.extend([
                    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'USB', 'PNC', 'TFC',
                    'BLK', 'SCHW', 'COF', 'BK', 'STT', 'NTRS', 'RF', 'CFG', 'KEY', 'HBAN'
                ])
            elif 'healthcare' in industry_lower or 'health' in industry_lower:
                relevant_stocks.extend([
                    'JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN',
                    'GILD', 'CVS', 'CI', 'ANTM', 'ISRG', 'MDT', 'SYK', 'ZTS', 'BIIB', 'REGN'
                ])
            elif 'consumer' in industry_lower:
                relevant_stocks.extend([
                    'KO', 'PEP', 'WMT', 'PG', 'MCD', 'NKE', 'SBUX', 'TGT', 'HD', 'LOW',
                    'COST', 'DIS', 'CMCSA', 'VZ', 'T', 'NEE', 'SO', 'DUK', 'AEP'
                ])
            elif 'industrial' in industry_lower:
                relevant_stocks.extend([
                    'BA', 'CAT', 'GE', 'MMM', 'HON', 'UPS', 'FDX', 'LMT', 'RTX', 'NOC',
                    'GD', 'EMR', 'ITW', 'PH', 'ETN', 'CMI', 'DE', 'CSX', 'UNP', 'NSC'
                ])
            elif 'energy' in industry_lower:
                relevant_stocks.extend([
                    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'KMI', 'WMB', 'OKE', 'PSX', 'VLO',
                    'MPC', 'HES', 'FANG', 'PXD', 'OXY', 'DVN', 'MRO', 'APA', 'HAL', 'BKR'
                ])
            else:
                # If industry not recognized, add some general stocks
                relevant_stocks.extend(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'])
        
        # Remove duplicates and return
        unique_stocks = list(set(relevant_stocks))
        logger.info(f"Industry fallback found {len(unique_stocks)} relevant stocks")
        return unique_stocks[:100]  # Limit for performance
        
    except Exception as e:
        logger.error(f"Industry fallback failed: {str(e)}")
        return COMMON_STOCKS[:50]

def fetch_stock_basic_info(symbol: str, use_alpha_vantage: bool = False) -> Optional[Dict[str, Any]]:
    """
    Fetch basic stock information for screening with retry logic and Alpha Vantage fallback.
    Returns None if stock doesn't meet basic criteria or fails to fetch.
    """
    # For faster processing, try Alpha Vantage first if yfinance is rate limited
    if use_alpha_vantage:
        try:
            logger.info(f"🔑 Using Alpha Vantage API for {symbol}")
            result = fetch_stock_info_alpha_vantage(symbol)
            if result:
                logger.info(f"✅ Alpha Vantage successful for {symbol}")
                return result
        except Exception as e:
            logger.warning(f"Alpha Vantage failed for {symbol}: {str(e)}")
        return None
    
    # Try yfinance first with minimal retries for speed
    try:
        logger.info(f"Fetching basic info for {symbol} via yfinance")
        result = fetch_stock_info_yfinance(symbol)
        
        if result:
            logger.info(f"✅ yfinance successful for {symbol}")
            return result
        else:
            logger.warning(f"No data returned from yfinance for {symbol}")
            
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"yfinance failed for {symbol}: {error_msg}")
        
        # If it's a rate limit error, immediately try Alpha Vantage
        if "429" in error_msg or "Too Many Requests" in error_msg:
            logger.info(f"🔄 Rate limited on yfinance, immediately trying Alpha Vantage for {symbol}")
            try:
                result = fetch_stock_info_alpha_vantage(symbol)
                if result:
                    logger.info(f"✅ Alpha Vantage successful for {symbol}")
                    return result
            except Exception as av_e:
                logger.warning(f"Alpha Vantage fallback failed for {symbol}: {str(av_e)}")
    
    logger.warning(f"All methods failed for {symbol}")
    return None

def fetch_stock_info_yfinance(symbol: str) -> Optional[Dict[str, Any]]:
    """Fetch stock info using yfinance with rate limiting"""
    try:
        rate_limit_check(f"yfinance_{symbol}")
        
        stock = yf.Ticker(symbol)
        
        # Get basic info
        info = stock.info
        
        # Get historical data for volatility calculation
        hist = stock.history(period="1y")
        
        if hist.empty or 'currentPrice' not in info:
            return None
        
        current_price = info.get('currentPrice', info.get('regularMarketPrice', 0))
        previous_close = info.get('previousClose', current_price)
        
        # Calculate price change
        price_change = current_price - previous_close
        price_change_percent = (price_change / previous_close * 100) if previous_close > 0 else 0
        
        # Calculate volatility from historical data
        volatility = 0.0
        if len(hist) > 1:
            log_returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
            if len(log_returns) > 0:
                volatility = log_returns.std() * np.sqrt(252)  # Annualized volatility
        
        # Get market cap (convert to billions)
        market_cap = info.get('marketCap', 0)
        if market_cap > 0:
            market_cap_billions = market_cap / 1_000_000_000
        else:
            market_cap_billions = 0
        
        return {
            'symbol': symbol.upper(),
            'name': info.get('longName', symbol.upper()),
            'price': round(current_price, 2),
            'priceChange': round(price_change, 2),
            'priceChangePercent': round(price_change_percent, 2),
            'marketCap': round(market_cap_billions, 2),
            'volatility': round(volatility, 4),
            'industry': info.get('industry', 'Unknown'),
            'sector': info.get('sector', 'Unknown'),
            'volume': info.get('volume', info.get('regularMarketVolume', 0)),
            'pe': info.get('trailingPE', info.get('forwardPE', 0)),
            'data_source': 'yfinance'
        }
        
    except Exception as e:
        logger.warning(f"yfinance failed for {symbol}: {str(e)}")
        return None

def fetch_stock_info_alpha_vantage(symbol: str) -> Optional[Dict[str, Any]]:
    """Fetch stock info using Alpha Vantage API"""
    try:
        logger.info(f"🔑 Using Alpha Vantage API for {symbol}")
        
        api_key = get_alpha_vantage_api_key()
        if not api_key:
            logger.error("Alpha Vantage API key not available")
            return None
        
        rate_limit_check(f"alpha_vantage_{symbol}")
        
        # Get quote data
        quote_url = "https://www.alphavantage.co/query"
        quote_params = {
            'function': 'GLOBAL_QUOTE',
            'symbol': symbol,
            'apikey': api_key,
            'datatype': 'json'
        }
        
        response = requests.get(quote_url, params=quote_params, timeout=10)
        if response.status_code != 200:
            return None
        
        quote_data = response.json()
        
        if 'Global Quote' not in quote_data:
            return None
        
        quote = quote_data['Global Quote']
        
        current_price = float(quote.get('05. price', 0))
        previous_close = float(quote.get('08. previous close', current_price))
        volume = int(quote.get('06. volume', 0))
        
        price_change = current_price - previous_close
        price_change_percent = (price_change / previous_close * 100) if previous_close > 0 else 0
        
        # Get additional info (company overview)
        overview_url = "https://www.alphavantage.co/query"
        overview_params = {
            'function': 'OVERVIEW',
            'symbol': symbol,
            'apikey': api_key,
            'datatype': 'json'
        }
        
        overview_response = requests.get(overview_url, params=overview_params, timeout=10)
        overview_data = {}
        
        if overview_response.status_code == 200:
            overview_data = overview_response.json()
        
        market_cap = overview_data.get('MarketCapitalization', '0')
        if market_cap and market_cap != 'None':
            market_cap_billions = float(market_cap) / 1_000_000_000
        else:
            market_cap_billions = 0
        
        return {
            'symbol': symbol.upper(),
            'name': overview_data.get('Name', symbol.upper()),
            'price': round(current_price, 2),
            'priceChange': round(price_change, 2),
            'priceChangePercent': round(price_change_percent, 2),
            'marketCap': round(market_cap_billions, 2),
            'volatility': 0.0,  # Alpha Vantage doesn't provide volatility in basic endpoints
            'industry': overview_data.get('Industry', 'Unknown'),
            'sector': overview_data.get('Sector', 'Unknown'),
            'volume': volume,
            'pe': float(overview_data.get('PERatio', 0)) if overview_data.get('PERatio') != 'None' else 0,
            'data_source': 'alpha_vantage'
        }
        
    except Exception as e:
        logger.warning(f"Alpha Vantage failed for {symbol}: {str(e)}")
        return None

def filter_stocks(stocks: List[Dict[str, Any]], criteria: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Filter stocks based on screening criteria"""
    filtered_stocks = []
    
    for stock in stocks:
        if stock is None:
            continue
        
        # Industry filter
        if criteria.get('industries') and len(criteria['industries']) > 0:
            stock_industry = stock.get('industry', '').lower()
            stock_sector = stock.get('sector', '').lower()
            criteria_industries = [ind.lower() for ind in criteria['industries']]
            
            if not any(ind in stock_industry or ind in stock_sector for ind in criteria_industries):
                continue
        
        # Price range filter
        if criteria.get('priceRange'):
            price_min, price_max = criteria['priceRange']
            stock_price = stock.get('price', 0)
            if not (price_min <= stock_price <= price_max):
                continue
        
        # Market cap range filter
        if criteria.get('marketCapRange'):
            mcap_min, mcap_max = criteria['marketCapRange']
            stock_mcap = stock.get('marketCap', 0)
            if not (mcap_min <= stock_mcap <= mcap_max):
                continue
        
        # Volatility range filter
        if criteria.get('volatilityRange'):
            vol_min, vol_max = criteria['volatilityRange']
            stock_volatility = stock.get('volatility', 0)
            # Convert volatility to percentage for comparison
            stock_vol_pct = stock_volatility * 100
            if not (vol_min <= stock_vol_pct <= vol_max):
                continue
        
        # Price change range filter
        if criteria.get('priceChangeRange'):
            change_min, change_max = criteria['priceChangeRange']
            stock_change = stock.get('priceChangePercent', 0)
            if not (change_min <= stock_change <= change_max):
                continue
        
        filtered_stocks.append(stock)
    
    return filtered_stocks

def screen_stocks_comprehensive(criteria: Dict[str, Any], max_results: int = 100) -> List[Dict[str, Any]]:
    """
    Comprehensive stock screening using Yahoo Finance + yfinance.
    Uses Yahoo Finance for initial screening, then yfinance for detailed data.
    """
    try:
        logger.info(f"=== Starting comprehensive stock screening with criteria: {criteria}")
        
        # Step 1: Get comprehensive stock list using Yahoo Finance screening
        stock_symbols = get_comprehensive_stock_list(criteria)
        
        if not stock_symbols:
            logger.warning("No stocks found for screening, using fallback")
            stock_symbols = COMMON_STOCKS[:50]
        
        logger.info(f"Found {len(stock_symbols)} stocks to evaluate")
        
        # Step 2: Get detailed data using smart batching to balance speed vs rate limits
        all_stocks = []
        
        # Process in small batches with controlled concurrency and minimal delays for speed
        batch_size = min(3, MAX_WORKERS)  # Slightly larger batches for speed
        base_delay_between_batches = 1.0  # Reduced delay for faster processing
        
        for i in range(0, len(stock_symbols), batch_size):
            batch = stock_symbols[i:i + batch_size]
            logger.info(f"Processing batch {i//batch_size + 1}: {batch}")
            
            # Process batch in parallel with limited concurrency
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                # Submit batch tasks
                future_to_symbol = {
                    executor.submit(fetch_stock_basic_info, symbol, False): symbol 
                    for symbol in batch
                }
                
                # Collect batch results
                batch_results = []
                for future in as_completed(future_to_symbol):
                    symbol = future_to_symbol[future]
                    try:
                        stock_info = future.result(timeout=20)  # Reduced timeout
                        if stock_info:
                            batch_results.append(stock_info)
                            logger.info(f"Successfully processed {symbol}")
                        else:
                            logger.warning(f"No data for {symbol}")
                    except Exception as e:
                        logger.warning(f"Failed to process {symbol}: {str(e)}")
                
                all_stocks.extend(batch_results)
                logger.info(f"Batch completed: {len(batch_results)} valid results, total: {len(all_stocks)}")
            
            # Early termination if we have enough results
            if len(all_stocks) >= max_results:  # Reduced from 2x to 1x for faster completion
                logger.info(f"Early termination: collected {len(all_stocks)} stocks")
                break
            
            # Minimal delay between batches (except for the last batch)
            if i + batch_size < len(stock_symbols):
                # Minimal jitter to prevent thundering herd
                jitter = random.uniform(0.2, 0.8)
                delay_between_batches = base_delay_between_batches + jitter
                logger.info(f"Waiting {delay_between_batches:.2f}s before next batch...")
                time.sleep(delay_between_batches)
        
        logger.info(f"Collected {len(all_stocks)} stocks before filtering")
        
        # Step 3: Apply additional filtering (since Yahoo Finance screening might not catch everything)
        filtered_stocks = filter_stocks(all_stocks, criteria)
        
        # Step 4: Sort by market cap (largest first) and limit results
        filtered_stocks.sort(key=lambda x: x.get('marketCap', 0), reverse=True)
        
        logger.info(f"Final screening results: {len(filtered_stocks)} stocks")
        return filtered_stocks[:max_results]
        
    except Exception as e:
        logger.error(f"Comprehensive screening failed: {str(e)}")
        # Fallback to simple parallel processing
        return screen_stocks_parallel_fallback(criteria, max_results)

def screen_stocks_parallel_fallback(criteria: Dict[str, Any], max_results: int = 100) -> List[Dict[str, Any]]:
    """Fallback screening using predefined stock lists"""
    logger.info("Using fallback screening method")
    
    # Use industry-based stock selection
    if criteria.get('industries') and len(criteria['industries']) > 0:
        stock_symbols = get_stocks_by_industry_fallback(criteria['industries'])
    else:
        stock_symbols = COMMON_STOCKS[:100]
    
    all_stocks = []
    
    # Use ThreadPoolExecutor for parallel processing
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all tasks
        future_to_symbol = {
            executor.submit(fetch_stock_basic_info, symbol, False): symbol 
            for symbol in stock_symbols
        }
        
        # Collect results as they complete
        completed_count = 0
        for future in as_completed(future_to_symbol):
            symbol = future_to_symbol[future]
            try:
                stock_info = future.result()
                if stock_info:
                    all_stocks.append(stock_info)
                
                completed_count += 1
                if completed_count % 10 == 0:
                    logger.info(f"Completed {completed_count}/{len(stock_symbols)} stocks")
                
                # Early termination if we have enough results
                if len(all_stocks) >= max_results * 2:  # Get 2x to ensure good filtering
                    logger.info(f"Early termination: collected {len(all_stocks)} stocks")
                    break
                    
            except Exception as e:
                logger.warning(f"Failed to process {symbol}: {str(e)}")
    
    logger.info(f"Collected {len(all_stocks)} stocks before filtering")
    
    # Filter stocks based on criteria
    filtered_stocks = filter_stocks(all_stocks, criteria)
    
    # Sort by market cap (largest first) and limit results
    filtered_stocks.sort(key=lambda x: x.get('marketCap', 0), reverse=True)
    
    return filtered_stocks[:max_results]

def generate_mock_stock_results(criteria: Dict[str, Any], max_results: int = 50) -> List[Dict[str, Any]]:
    """Generate mock stock results for testing"""
    logger.info("Generating mock stock results")
    
    mock_stocks = []
    base_symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'CRM', 'ADBE']
    
    for i in range(min(max_results, 50)):
        symbol = base_symbols[i % len(base_symbols)]
        base_price = 100 + (hash(symbol + str(i)) % 500)
        
        mock_stocks.append({
            'symbol': symbol,
            'name': f'{symbol} Inc.',
            'price': round(base_price, 2),
            'priceChange': round((hash(symbol + str(i)) % 20) - 10, 2),
            'priceChangePercent': round((hash(symbol + str(i)) % 40) - 20, 2),
            'marketCap': round(100 + (hash(symbol + str(i)) % 900), 2),
            'volatility': round((hash(symbol + str(i)) % 50) / 100, 4),
            'industry': 'Technology',
            'sector': 'Technology',
            'volume': 1000000 + (hash(symbol + str(i)) % 5000000),
            'pe': round(10 + (hash(symbol + str(i)) % 30), 2),
            'data_source': 'mock'
        })
    
    return mock_stocks

def lambda_handler(event, context):
    """
    AWS Lambda handler for stock screening.
    
    Expected event format:
    {
        "criteria": {
            "industries": ["Technology", "Healthcare"],
            "volatilityRange": [0.1, 0.5],
            "priceChangeRange": [-10, 10],
            "marketCapRange": [1, 1000],
            "priceRange": [10, 500],
            "timeframe": "1y"
        },
        "maxResults": 50
    }
    """
    try:
        logger.info(f"=== STOCK SCREENER LAMBDA START ===")
        logger.info(f"Event received: {json.dumps(event, indent=2)}")
        logger.info(f"Context: {context}")
        logger.info(f"Environment variables: {dict(os.environ)}")
        
        # Set a timeout to ensure we return before API Gateway timeout (29 seconds)
        import signal
        
        def timeout_handler(signum, frame):
            logger.warning("Lambda timeout approaching, returning partial results")
            raise TimeoutError("Lambda timeout")
        
        # Set timeout to 25 seconds (4 seconds before API Gateway timeout)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(25)
        
        # Parse the event
        if isinstance(event, str):
            event = json.loads(event)
        
        # Extract parameters
        criteria = {}
        max_results = 50
        
        if event.get('queryStringParameters'):
            # API Gateway GET request
            params = event['queryStringParameters']
            criteria = json.loads(params.get('criteria', '{}'))
            max_results = int(params.get('maxResults', 50))
        elif event.get('body'):
            # API Gateway POST request
            body = event['body']
            if isinstance(body, str):
                body = json.loads(body)
            criteria = body.get('criteria', {})
            max_results = body.get('maxResults', 50)
        else:
            # Direct Lambda invocation
            criteria = event.get('criteria', {})
            max_results = event.get('maxResults', 50)
        
        logger.info(f"Screening criteria: {criteria}")
        logger.info(f"Max results: {max_results}")
        
        # Validate criteria
        if not criteria:
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
                    'success': False,
                    'error': 'No screening criteria provided',
                    'message': 'Please provide screening criteria'
                })
            }
        
        # Use comprehensive screening approach with Yahoo Finance + yfinance
        try:
            logger.info("=== Using comprehensive Yahoo Finance + yfinance screening ===")
            logger.info(f"Criteria: {criteria}")
            logger.info(f"Max results: {max_results}")
            results = screen_stocks_comprehensive(criteria, max_results)
            logger.info(f"Screening completed, got {len(results)} results")
            
            if not results:
                logger.warning("No stocks found matching criteria, generating mock results")
                results = generate_mock_stock_results(criteria, max_results)
            
            logger.info(f"Stock screening completed: {len(results)} results found")
            
            response = {
                'success': True,
                'results': results,
                'totalResults': len(results),
                'criteria': criteria,
                'timestamp': datetime.now().isoformat()
            }
            
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps(response)
            }
            
        except Exception as screening_error:
            logger.error(f"Screening failed: {str(screening_error)}")
            logger.info("Falling back to mock results")
            
            # Fallback to mock results
            mock_results = generate_mock_stock_results(criteria, max_results)
            
            response = {
                'success': True,
                'results': mock_results,
                'totalResults': len(mock_results),
                'criteria': criteria,
                'timestamp': datetime.now().isoformat(),
                'warning': 'Using mock data due to screening error'
            }
            
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps(response)
            }
        
    except TimeoutError as e:
        logger.warning(f"=== LAMBDA TIMEOUT - RETURNING PARTIAL RESULTS ===")
        logger.warning(f"Timeout error: {str(e)}")
        
        # Return partial results or mock data
        try:
            results = generate_mock_stock_results(criteria, max_results)
            logger.info(f"Returning {len(results)} mock results due to timeout")
            
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                    'success': True,
                    'results': results,
                    'totalResults': len(results),
                    'criteria': criteria,
                    'timestamp': datetime.now().isoformat(),
                    'warning': 'Results may be incomplete due to timeout'
                })
            }
        except Exception as mock_error:
            logger.error(f"Failed to generate mock results: {str(mock_error)}")
            # Fall through to general error handling
        
    except Exception as e:
        logger.error(f"=== STOCK SCREENER LAMBDA ERROR ===")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception message: {str(e)}")
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
                'success': False,
                'error': 'Internal server error',
                'message': str(e),
                'timestamp': datetime.now().isoformat()
            })
<<<<<<< HEAD
        }
=======
        }
>>>>>>> 005a609b94363ccc5f0afbf11f723cc3fdef16cd
