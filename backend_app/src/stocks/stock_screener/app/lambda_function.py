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
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urlencode, quote

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load comprehensive stock lists from CSV files
def load_stock_symbols_from_csv():
    """
    Load all available stock symbols from NYSE and NASDAQ CSV files.
    Returns a list of unique stock symbols.
    """
    all_symbols = []
    
    # Load NYSE stocks from local directory
    nyse_path = os.path.join(os.path.dirname(__file__), 'nyse-listed.csv')
    if os.path.exists(nyse_path):
        try:
            with open(nyse_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    symbol = row.get('ACT Symbol', '').strip().upper()
                    # Filter out preferred stocks, warrants, units, rights, notes
                    if symbol and not any(x in symbol for x in ['$', '.', '-', 'W', 'U', 'R', '+']):
                        # Additional validation - only include simple equity symbols
                        if len(symbol) <= 5 and symbol.isalpha():
                            all_symbols.append(symbol)
            logger.info(f"✅ Loaded {len(all_symbols)} symbols from NYSE CSV")
        except Exception as e:
            logger.error(f"Failed to load NYSE CSV: {str(e)}")
    else:
        logger.warning(f"⚠️ NYSE CSV not found at: {nyse_path}")
    
    # Load NASDAQ stocks from local directory
    nasdaq_path = os.path.join(os.path.dirname(__file__), 'nasdaq-listed.csv')
    if os.path.exists(nasdaq_path):
        try:
            with open(nasdaq_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    symbol = row.get('Symbol', '').strip().upper()
                    # Filter out preferred stocks, warrants, units, rights, notes
                    if symbol and not any(x in symbol for x in ['$', '.', '-', 'W', 'U', 'R', '+']):
                        # Additional validation - only include simple equity symbols
                        if len(symbol) <= 5 and symbol.isalpha():
                            all_symbols.append(symbol)
            logger.info(f"✅ Loaded {len(all_symbols)} total symbols from NASDAQ CSV")
        except Exception as e:
            logger.error(f"Failed to load NASDAQ CSV: {str(e)}")
    else:
        logger.warning(f"⚠️ NASDAQ CSV not found at: {nasdaq_path}")
    
    # Remove duplicates and sort
    unique_symbols = sorted(list(set(all_symbols)))
    logger.info(f"✅ Total unique stock symbols loaded: {len(unique_symbols)}")
    
    return unique_symbols

# Load stock symbols at module initialization (cached for Lambda reuse)
try:
    logger.info("🔄 Initializing stock symbols from CSV files...")
    ALL_AVAILABLE_STOCKS = load_stock_symbols_from_csv()
    if not ALL_AVAILABLE_STOCKS:
        logger.warning("⚠️ CSV loading returned empty list, falling back to predefined list")
        ALL_AVAILABLE_STOCKS = None
        else:
        logger.info(f"✅ Successfully loaded {len(ALL_AVAILABLE_STOCKS)} stock symbols from CSV")
        logger.info(f"✅ Sample symbols: {ALL_AVAILABLE_STOCKS[:20]}")
    except Exception as e:
    logger.error(f"❌ Failed to load stock symbols from CSV: {str(e)}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    ALL_AVAILABLE_STOCKS = None

# Rate limiting configuration - STRICT for yfinance
RATE_LIMIT_DELAY = 2.0  # Base delay between operations
MAX_RETRIES = 3  # Limited retries to avoid extended failures
RETRY_DELAY = 15.0  # Long delay on retry to avoid rate limit escalation
MAX_WORKERS = 5  # Maximum number of concurrent workers for parallel processing
BATCH_SIZE = 50  # Download stocks in batches

# Global last request timestamp for strict rate limiting
_last_yf_request_time = 0
_yf_request_lock = None  # Will be initialized on first use

def get_rate_limit_lock():
    """Get or create the rate limit lock"""
    global _yf_request_lock
    if _yf_request_lock is None:
        import threading
        _yf_request_lock = threading.Lock()
    return _yf_request_lock

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


def enforce_yf_rate_limit():
    """
    Strict rate limiting for yfinance to avoid 429 errors.
    Thread-safe with guaranteed minimum delay between ALL yfinance calls.
    """
    global _last_yf_request_time
    lock = get_rate_limit_lock()
    
    with lock:
    current_time = time.time()
        time_since_last = current_time - _last_yf_request_time
        
        if time_since_last < RATE_LIMIT_DELAY:
            delay_needed = RATE_LIMIT_DELAY - time_since_last
            # Add small jitter to avoid thundering herd
            jitter = random.uniform(0.1, 0.5)
            total_delay = delay_needed + jitter
            
            logger.info(f"🕐 Rate limiting: waiting {total_delay:.2f}s before yfinance call")
            time.sleep(total_delay)
    
        _last_yf_request_time = time.time()
        logger.info(f"✅ Rate limit check passed, proceeding with yfinance call")

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

def download_stock_data_bulk_http(symbols: List[str], period: str = "1mo") -> Dict[str, pd.DataFrame]:
    """
    Download stock data for multiple symbols using direct HTTP calls in parallel batches.
    Yahoo Finance doesn't support multi-symbol chart API, so we batch individual requests.
    
    Args:
        symbols: List of stock symbols
        period: Time period for historical data
    
    Returns:
        Dict mapping symbol to its historical DataFrame
    """
    results = {}
    
    # Yahoo Finance chart API doesn't support multiple symbols in one request
    # But we can parallelize individual requests for better performance
    logger.info(f"📥 Bulk HTTP download for {len(symbols)} symbols using parallel requests")
    
    # Process in batches to avoid overwhelming the API
    # Optimized for API Gateway's 29-second timeout
    batch_size = 20  # Download 20 stocks at a time in parallel (increased from 10)
    
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        batch_num = i//batch_size + 1
        total_batches = (len(symbols) + batch_size - 1)//batch_size
        logger.info(f"📥 Processing batch {batch_num}/{total_batches}: {len(batch)} symbols")
        
        # Download batch in parallel using ThreadPoolExecutor
        batch_results = []
        
        def download_with_delay(symbol):
            """Download a single symbol with minimal delay"""
            try:
                # Minimal delay to spread requests (reduced from 0.2-0.5s)
                time.sleep(random.uniform(0.1, 0.2))
                df = download_stock_data_direct_http(symbol, period)
                if not df.empty:
                    return (symbol, df)
            except Exception as e:
                logger.warning(f"⚠️ Failed to download {symbol}: {str(e)}")
            return None
        
        # Use ThreadPoolExecutor with more workers for faster parallel downloads
        with ThreadPoolExecutor(max_workers=min(10, len(batch))) as executor:
            futures = [executor.submit(download_with_delay, symbol) for symbol in batch]
            for future in as_completed(futures):
                result = future.result()
                if result:
                    batch_results.append(result)
        
        # Add batch results
        for symbol, df in batch_results:
            results[symbol] = df
        
        logger.info(f"✅ Batch {batch_num} complete: {len(batch_results)}/{len(batch)} successful")
        
        # Shorter delay between batches (reduced from 2-3s to 1s)
        if i + batch_size < len(symbols):
            logger.info(f"⏱️ Waiting 1s before next batch...")
            time.sleep(1.0)
    
    logger.info(f"✅ Bulk HTTP download complete: {len(results)}/{len(symbols)} symbols")
    return results

def download_stock_data_direct_http(symbol: str, period: str = "1mo") -> pd.DataFrame:
    """
    Download stock data using direct HTTP call to Yahoo Finance.
    This bypasses yfinance library to avoid rate limiting issues.
    
    Based on working stock-data Lambda implementation.
    
    Args:
        symbol: Stock symbol
        period: Time period for historical data
    
    Returns:
        DataFrame with historical price data
    """
    try:
        # Map period to Yahoo Finance parameters
        period_map = {
            '1d': {'range': '1d', 'interval': '1m'},
            '7d': {'range': '7d', 'interval': '1h'},
            '1mo': {'range': '1mo', 'interval': '1d'},
            '3mo': {'range': '3mo', 'interval': '1d'},
            '6mo': {'range': '6mo', 'interval': '1d'},
            '1y': {'range': '1y', 'interval': '1d'}
        }
        
        period_config = period_map.get(period, period_map['1mo'])
        
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
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
        
        # Minimal delay between requests (we handle delays in batch function)
        # No delay here since we're already staggering in the batch download
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code != 200:
            logger.warning(f"⚠️ HTTP request failed for {symbol}: {response.status_code}")
            return pd.DataFrame()
        
        data = response.json()
        
        if 'chart' not in data or not data['chart']['result']:
            logger.warning(f"⚠️ No chart data for {symbol}")
            return pd.DataFrame()
        
        result = data['chart']['result'][0]
        timestamps = result.get('timestamp', [])
        quotes = result.get('indicators', {}).get('quote', [{}])[0]
        closes = quotes.get('close', [])
        opens = quotes.get('open', [])
        highs = quotes.get('high', [])
        lows = quotes.get('low', [])
        volumes = quotes.get('volume', [])
        
        # Build DataFrame
        df_data = []
        for i, timestamp in enumerate(timestamps):
            if i < len(closes) and closes[i] is not None:
                df_data.append({
                    'Date': pd.Timestamp.fromtimestamp(timestamp),
                    'Open': opens[i] if i < len(opens) and opens[i] is not None else closes[i],
                    'High': highs[i] if i < len(highs) and highs[i] is not None else closes[i],
                    'Low': lows[i] if i < len(lows) and lows[i] is not None else closes[i],
                    'Close': closes[i],
                    'Volume': volumes[i] if i < len(volumes) and volumes[i] is not None else 0
                })
        
        if not df_data:
            return pd.DataFrame()
        
        df = pd.DataFrame(df_data)
        df.set_index('Date', inplace=True)
        
        return df
        
    except Exception as e:
        logger.warning(f"⚠️ Direct HTTP download failed for {symbol}: {str(e)}")
        return pd.DataFrame()

def download_stock_data_individual(symbols: List[str], period: str = "1mo", max_symbols: int = 50) -> Dict[str, pd.DataFrame]:
    """
    Download stock data individually using direct HTTP to Yahoo Finance.
    This avoids yfinance library rate limiting issues.
    
    Args:
        symbols: List of stock symbols
        period: Time period for historical data
        max_symbols: Maximum number of symbols to process (to avoid timeout)
    
    Returns:
        Dict mapping symbol to its historical DataFrame
    """
    results = {}
    symbols_to_process = symbols[:max_symbols]
    
    logger.info(f"📥 Downloading individual stock data via direct HTTP for {len(symbols_to_process)} symbols")
    
    for i, symbol in enumerate(symbols_to_process):
        try:
            df = download_stock_data_direct_http(symbol, period)
            
            if not df.empty:
                results[symbol] = df
                if (i + 1) % 10 == 0:
                    logger.info(f"📥 Progress: {i + 1}/{len(symbols_to_process)} symbols downloaded")
            else:
                logger.warning(f"⚠️ No data for {symbol}")
                
        except Exception as e:
            logger.warning(f"⚠️ Failed to download {symbol}: {str(e)}")
            continue
    
    logger.info(f"✅ Successfully downloaded data for {len(results)}/{len(symbols_to_process)} symbols via direct HTTP")
    return results

def download_stock_data_bulk(symbols: List[str], period: str = "1mo") -> pd.DataFrame:
    """
    Download stock data in bulk using yfinance.download() with robust rate limiting.
    This is more efficient than individual Ticker() calls.
    
    Args:
        symbols: List of stock symbols to download
        period: Time period for historical data (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max)
    
    Returns:
        DataFrame with multi-level columns (symbol, data_field)
    """
    try:
        enforce_yf_rate_limit()
        
        # Convert list to space-separated string for yfinance
        symbols_str = ' '.join(symbols)
        
        logger.info(f"📥 Downloading data for {len(symbols)} symbols using yf.download()")
        logger.info(f"📥 Period: {period}, Symbols sample: {symbols[:10]}")
        
        # Suppress yfinance logging
        import logging as yf_logging
        yf_logging.getLogger('yfinance').setLevel(yf_logging.CRITICAL)
        
        # Download data with error handling - try different approaches
        data = None
        
        # First, test with a single known good symbol to verify yfinance is working
        # Using single symbol is less likely to trigger rate limits
        test_symbol = 'AAPL'
        logger.info(f"🧪 Testing yfinance with single symbol: {test_symbol}")
        
        try:
            test_data = yf.download(
                tickers=test_symbol,
                period='5d',
                interval='1d',
                auto_adjust=True,
                prepost=False,
                threads=False,
                progress=False
            )
            
            if not test_data.empty:
                logger.info(f"✅ Test download successful, yfinance is working! Shape: {test_data.shape}")
            else:
                logger.error(f"❌ Test download failed - yfinance may be down or blocked in Lambda environment")
                logger.error(f"❌ This is a known issue with yfinance in AWS Lambda due to rate limiting")
                logger.error(f"❌ Consider using alternative data sources (Alpha Vantage, FMP, etc.)")
                return pd.DataFrame()
        except Exception as e:
            logger.error(f"❌ Test download failed with error: {str(e)}")
            logger.error(f"❌ yfinance is likely blocked or rate-limited in this Lambda environment")
            return pd.DataFrame()
        
        # Approach 1: Bulk download with group_by='ticker'
        try:
            logger.info("📥 Attempting bulk download with group_by='ticker'")
            data = yf.download(
                tickers=symbols_str,
                period=period,
                interval='1d',
                group_by='ticker',
                auto_adjust=True,
                prepost=False,
                threads=False,
                progress=False
            )
            
            if not data.empty:
                logger.info(f"✅ Bulk download successful (group_by='ticker'), shape: {data.shape}")
                return data
        except Exception as e:
            logger.warning(f"⚠️ Bulk download with group_by='ticker' failed: {str(e)}")
        
        # Approach 2: Try without group_by if first approach fails
        if data is None or data.empty:
            logger.info("📥 Attempting bulk download without group_by")
            enforce_yf_rate_limit()
            
            data = yf.download(
                tickers=symbols_str,
                period=period,
                interval='1d',
                auto_adjust=True,
                prepost=False,
                threads=False,
                progress=False
            )
            
            if not data.empty:
                logger.info(f"✅ Bulk download successful (no group_by), shape: {data.shape}")
                return data
        
        # Approach 3: Fall back to downloading a smaller batch
        if data is None or data.empty:
            logger.warning(f"⚠️ Bulk approaches failed, trying smaller batch (first 50 symbols)")
            enforce_yf_rate_limit()
            
            # Try with just the first 50 symbols to see if that works
            small_batch = symbols[:50]
            small_symbols_str = ' '.join(small_batch)
            
            data = yf.download(
                tickers=small_symbols_str,
                period=period,
                interval='1d',
                group_by='ticker',
                auto_adjust=True,
                prepost=False,
                threads=False,
                progress=False
            )
            
            if not data.empty:
                logger.info(f"✅ Small batch download successful, shape: {data.shape}")
                logger.warning(f"⚠️ Only processed {len(small_batch)}/{len(symbols)} symbols due to download issues")
                return data
        
        logger.warning(f"⚠️ All bulk download approaches returned empty DataFrame")
        logger.warning(f"⚠️ This might indicate yfinance API issues or network problems")
        return pd.DataFrame()
        
    except Exception as e:
        logger.error(f"❌ Bulk download failed with exception: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return pd.DataFrame()

def get_stock_info_bulk(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Get current stock info for multiple symbols using Ticker.info with rate limiting.
    
    Args:
        symbols: List of stock symbols
    
    Returns:
        Dictionary mapping symbol to stock info
    """
    stock_info = {}
    
    for symbol in symbols:
        try:
            enforce_yf_rate_limit()
            
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if info and 'regularMarketPrice' in info or 'currentPrice' in info:
                stock_info[symbol] = info
                logger.info(f"✅ Got info for {symbol}")
            else:
                logger.warning(f"⚠️ No valid info for {symbol}")
                
        except Exception as e:
            logger.warning(f"❌ Failed to get info for {symbol}: {str(e)}")
            continue
    
    return stock_info

def screen_stocks_yahoo_finance_OLD(criteria: Dict[str, Any]) -> List[str]:
    """
    Screen stocks using Yahoo Finance's screener interface.
    Returns list of stock symbols matching the criteria.
    """
    try:
        logger.info(f"=== Starting Yahoo Finance screening with criteria: {criteria}")
        
        # Apply rate limiting
        enforce_yf_rate_limit()
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

def select_liquid_stocks_from_csv(all_symbols: List[str], max_symbols: int = 200) -> List[str]:
    """
    Select the most liquid/popular stocks from the comprehensive list.
    Prioritizes stocks that are likely to have good data quality and liquidity.
    
    Strategy:
    1. Prioritize stocks from major indices (NASDAQ-100, S&P 500)
    2. Prefer shorter symbols (often more established companies)
    3. Return a diverse, representative sample
    """
    # Major tech and popular stocks (likely to be in major indices)
    priority_stocks = [
        'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'LLY',
        'AVGO', 'JPM', 'V', 'UNH', 'XOM', 'MA', 'COST', 'HD', 'PG', 'NFLX',
        'JNJ', 'BAC', 'ABBV', 'CRM', 'CVX', 'MRK', 'KO', 'WMT', 'AMD', 'ORCL',
        'PEP', 'CSCO', 'ACN', 'ADBE', 'TMO', 'LIN', 'MCD', 'ABT', 'DHR', 'GE',
        'TXN', 'QCOM', 'INTC', 'VZ', 'CMCSA', 'AMGN', 'NEE', 'DIS', 'INTU', 'IBM',
        'PM', 'CAT', 'UNP', 'HON', 'RTX', 'T', 'SPGI', 'BA', 'GS', 'AXP',
        'DE', 'UBER', 'SYK', 'BLK', 'BKNG', 'SCHW', 'AMAT', 'NOW', 'ELV', 'PLD',
        'GILD', 'MMC', 'VRTX', 'C', 'ADP', 'ADI', 'MDLZ', 'REGN', 'CI', 'ISRG',
        'PYPL', 'MO', 'LRCX', 'SBUX', 'CB', 'PGR', 'BMY', 'SLB', 'ETN', 'EQIX'
    ]
    
    selected = []
    
    # First, add priority stocks that exist in our comprehensive list
    for symbol in priority_stocks:
        if symbol in all_symbols:
            selected.append(symbol)
    
    logger.info(f"Added {len(selected)} priority stocks")
    
    # Then, add additional stocks to reach max_symbols
    # Prefer shorter symbols (typically more established companies)
    remaining_symbols = [s for s in all_symbols if s not in selected]
    remaining_symbols.sort(key=lambda x: (len(x), x))  # Sort by length, then alphabetically
    
    needed = max_symbols - len(selected)
    selected.extend(remaining_symbols[:needed])
    
    logger.info(f"✅ Selected {len(selected)} total liquid stocks")
    return selected

def get_stocks_by_industry_from_csv(industries: List[str], all_symbols: List[str]) -> List[str]:
    """
    Filter stocks by industry using the comprehensive CSV list.
    This is more expensive as it requires fetching info for each stock.
    
    Strategy:
    1. Start with a subset of symbols (avoid checking all 7,000+)
    2. Sample evenly across the alphabet for diversity
    3. Check each symbol's industry/sector via yfinance
    4. Return matches
    """
    logger.info(f"🔍 Filtering {len(all_symbols)} symbols by industries: {industries}")
    
    # Sample stocks evenly across the alphabet for diversity
    # This avoids only getting stocks starting with 'A'
    sample_size = min(300, len(all_symbols))  # Check up to 300 stocks
    step = len(all_symbols) // sample_size
    sampled_symbols = [all_symbols[i] for i in range(0, len(all_symbols), max(step, 1))][:sample_size]
    
    logger.info(f"Sampled {len(sampled_symbols)} symbols for industry checking")
    
    matched_stocks = []
    industries_lower = [ind.lower() for ind in industries]
    
    # Check each sampled symbol's industry (with rate limiting)
    for symbol in sampled_symbols:
        try:
            enforce_yf_rate_limit()
            
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                continue
            
            stock_sector = info.get('sector', '').lower()
            stock_industry = info.get('industry', '').lower()
            
            # Check if stock matches any of the requested industries
            for industry in industries_lower:
                if industry in stock_sector or industry in stock_industry:
                    matched_stocks.append(symbol)
                    logger.info(f"✅ Matched {symbol} - Sector: {stock_sector}, Industry: {stock_industry}")
                    break
            
            # Early exit if we have enough matches
            if len(matched_stocks) >= 150:
                logger.info(f"✅ Found enough matches ({len(matched_stocks)}), stopping early")
                break
                
        except Exception as e:
            logger.warning(f"Failed to check industry for {symbol}: {str(e)}")
            continue
    
    logger.info(f"✅ Found {len(matched_stocks)} stocks matching industries")
    
    # If we didn't find enough matches, fall back to predefined industry lists
    if len(matched_stocks) < 50:
        logger.warning(f"⚠️ Only found {len(matched_stocks)} matches, using fallback industry mapping")
        return get_stocks_by_industry_fallback(industries)
    
    return matched_stocks

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

def fetch_stock_basic_info(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Fetch basic stock information for screening with retry logic.
    Returns None if stock doesn't meet basic criteria or fails to fetch.
    """
    # Try yfinance with minimal retries for speed
    try:
        logger.info(f"Fetching basic info for {symbol} via yfinance")
        result = fetch_stock_info_yfinance(symbol)
        
        if result:
            logger.info(f"✅ yfinance successful for {symbol}")
            return result
        else:
            logger.warning(f"No data returned from yfinance for {symbol}")
            
    except Exception as e:
        logger.warning(f"yfinance failed for {symbol}: {str(e)}")
    
    logger.warning(f"Failed to fetch data for {symbol}")
    return None

def fetch_stock_info_yfinance(symbol: str) -> Optional[Dict[str, Any]]:
    """Fetch stock info using yfinance with rate limiting"""
    try:
        enforce_yf_rate_limit()
        
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

def screen_stocks_from_dynamodb(criteria: Dict[str, Any], max_results: int = 100, last_evaluated_key: Optional[Dict] = None) -> tuple[List[Dict[str, Any]], Optional[Dict], bool]:
    """
    Screen stocks by querying pre-cached data from DynamoDB.
    This is MUCH faster than fetching from Yahoo Finance (<1 second vs 15+ seconds).
    Uses new numeric GSI sort keys for efficient BETWEEN queries.
    Supports pagination via last_evaluated_key.
    
    Args:
        criteria: Screening criteria with optional timeframe
        max_results: Maximum number of results to return per page
        last_evaluated_key: Pagination token from previous request
    
    Returns:
        Tuple of (results list, last_evaluated_key, has_more)
    """
    try:
        logger.info(f"=== Starting DynamoDB stock screening ===")
        logger.info(f"Criteria: {criteria}")
        
        # Extract timeframe from criteria (default to 1d)
        timeframe = criteria.get('timeframe', '1d')
        logger.info(f"Using timeframe: {timeframe}")
        
        # Import DynamoDB query module
        from dynamodb_query import query_stocks_by_criteria
        
        # Query DynamoDB with timeframe (sub-second response!)
        stocks, last_eval_key, has_more = query_stocks_by_criteria(criteria, max_results, timeframe, last_evaluated_key)
        
        logger.info(f"✅ Retrieved {len(stocks)} stocks from DynamoDB cache (has_more={has_more})")
        
        # Format for frontend
        results = []
        for stock in stocks:
            # Convert market cap to billions for display
            market_cap_raw = stock.get('market_cap', 0)
            market_cap_billions = market_cap_raw / 1_000_000_000 if market_cap_raw > 0 else 0
            
            current_price = stock.get('current_price', 0)
            price_change_pct = stock.get('price_change_percent', 0)
            volatility_pct = stock.get('volatility', 0) * 100  # Convert to percentage
            
            results.append({
                'symbol': stock.get('symbol', ''),
                'name': stock.get('company_name', stock.get('symbol', '')),
                'price': current_price,  # Frontend expects 'price'
                'current_price': current_price,  # Keep for compatibility
                'priceChange': stock.get('price_change', 0),  # Frontend expects 'priceChange'
                'priceChangePercent': price_change_pct,  # Frontend expects camelCase
                'price_change_percent': price_change_pct,  # Keep snake_case for compatibility
                'volatility': volatility_pct,  # Already converted to percentage
                'marketCap': round(market_cap_billions, 2),  # Frontend expects camelCase, in billions
                'market_cap': market_cap_billions,  # Keep for compatibility
                'industry': stock.get('industry', 'Unknown'),
                'sector': stock.get('sector', 'Unknown'),
                'volume': stock.get('volume', 0),
                'weekReturn': stock.get('week_return', 0),  # camelCase for frontend
                'week_return': stock.get('week_return', 0),  # snake_case for compatibility
                'shares_outstanding': stock.get('shares_outstanding', 0),
                'day_high': stock.get('day_high', 0),
                'day_low': stock.get('day_low', 0),
                'year_high': stock.get('year_high', 0),
                'year_low': stock.get('year_low', 0),
                'previous_close': stock.get('previous_close', 0),
                'avg_volume': stock.get('avg_volume', 0),
                'pe': stock.get('pe_ratio', 0),  # Frontend expects 'pe'
                'pe_ratio': stock.get('pe_ratio', 0),  # Keep for compatibility
                'eps': stock.get('eps', 0),
                'dividend_yield': stock.get('dividend_yield', 0),
                'beta': stock.get('beta', 0),
                'data_source': 'DynamoDB-EOD-Cache',
                'last_updated': stock.get('last_updated', '')
            })
        
        logger.info(f"✅ Returning {len(results)} stocks")
        return results, last_eval_key, has_more
        
    except Exception as e:
        logger.error(f"❌ DynamoDB screening failed: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        # Fall back to direct HTTP if DynamoDB fails
        logger.warning("⚠️ Falling back to direct HTTP screening")
        # Note: bulk download doesn't support pagination yet
        bulk_results = screen_stocks_with_bulk_download(criteria, max_results)
        return bulk_results, None, False

def screen_stocks_with_bulk_download(criteria: Dict[str, Any], max_results: int = 100) -> List[Dict[str, Any]]:
    """
    Screen stocks using yfinance bulk download for efficiency and better rate limit compliance.
    
    Strategy:
    1. Select relevant symbols based on industry filter
    2. Bulk download historical data for all symbols at once (single API call)
    3. Calculate metrics from historical data (volatility, price change)
    4. Get current info for filtered symbols only (minimized API calls)
    5. Filter and return results
    """
    try:
        logger.info(f"=== Starting bulk download stock screening ===")
        logger.info(f"Criteria: {criteria}")
        
        # Step 1: Get candidate stock list
        # Use comprehensive CSV list if available, otherwise fall back to predefined list
        if ALL_AVAILABLE_STOCKS:
            logger.info(f"📊 Using comprehensive stock list: {len(ALL_AVAILABLE_STOCKS)} total symbols available")
            
            # Apply industry filter if specified
            if criteria.get('industries') and len(criteria['industries']) > 0:
                # For industry filtering, use yfinance Ticker.info (expensive but necessary)
                # Limit to a reasonable subset for performance
                candidate_symbols = get_stocks_by_industry_from_csv(criteria['industries'], ALL_AVAILABLE_STOCKS)
                logger.info(f"Found {len(candidate_symbols)} stocks for industries: {criteria['industries']}")
            else:
                # No industry filter - use popular/liquid stocks from the comprehensive list
                # Prioritize stocks likely to have good data quality
                candidate_symbols = select_liquid_stocks_from_csv(ALL_AVAILABLE_STOCKS, max_symbols=200)
                logger.info(f"Selected {len(candidate_symbols)} liquid stocks from comprehensive list")
        else:
            # Fallback to predefined list
            logger.warning("⚠️ Comprehensive stock list not available, using fallback")
            if criteria.get('industries') and len(criteria['industries']) > 0:
                candidate_symbols = get_stocks_by_industry_fallback(criteria['industries'])
            else:
                candidate_symbols = COMMON_STOCKS[:100]
        
        # Limit candidates to avoid timeout (150 is a good balance)
        candidate_symbols = candidate_symbols[:150]
        logger.info(f"Proceeding with {len(candidate_symbols)} candidate symbols")
        
        # Step 2: Bulk download historical data for all candidates
        period = criteria.get('timeframe', '1mo')
        logger.info(f"📥 Bulk downloading {period} data for {len(candidate_symbols)} symbols...")
        logger.info(f"📥 First 20 symbols to download: {candidate_symbols[:20]}")
        logger.info(f"📥 Symbol validation - all strings: {all(isinstance(s, str) for s in candidate_symbols)}")
        logger.info(f"📥 Symbol validation - no empty strings: {all(s.strip() for s in candidate_symbols)}")
        
        # Use direct HTTP bulk downloads (bypasses yfinance rate limiting)
        logger.info("📥 Using direct HTTP bulk method (bypasses yfinance library issues)")
        logger.info("📥 Downloading data via Yahoo Finance direct API in batches...")
        
        # Limit symbols to fit within API Gateway's 29-second timeout
        # At ~0.5s per stock with parallel batching, we can do ~40 stocks in 20 seconds
        # Leave buffer for processing time
        max_symbols_to_screen = min(40, len(candidate_symbols))
        symbols_to_download = candidate_symbols[:max_symbols_to_screen]
        
        logger.info(f"📥 Downloading {len(symbols_to_download)} symbols via bulk HTTP")
        logger.info(f"📥 Estimated time: ~{len(symbols_to_download) * 0.5:.1f} seconds")
        hist_data_dict = download_stock_data_bulk_http(symbols_to_download, period=period)
        
        if not hist_data_dict:
            logger.error("❌ Bulk HTTP downloads failed")
            logger.error("❌ Yahoo Finance API may be down or blocked")
            return []
        
        logger.info(f"✅ Bulk HTTP download succeeded with {len(hist_data_dict)} stocks")
        
        # Convert dict of DataFrames to multi-index DataFrame format
        # (similar to what yf.download returns with group_by='ticker')
        hist_data = pd.DataFrame()
        for symbol, df in hist_data_dict.items():
            for col in df.columns:
                hist_data[(symbol, col)] = df[col]
        
        # Flatten column names to match expected format
        hist_data.columns = pd.MultiIndex.from_tuples(hist_data.columns)
        
        logger.info(f"✅ Converted to multi-index format: {hist_data.shape}")
        
        # Step 3: Calculate metrics from historical data
        logger.info(f"📊 Calculating metrics from historical data...")
        stock_metrics = []
        
        for symbol in candidate_symbols:
            try:
                # Handle single symbol vs multi-symbol DataFrame structure
                if len(candidate_symbols) == 1:
                    symbol_data = hist_data
                else:
                    if symbol not in hist_data.columns.get_level_values(0):
                        continue
                    symbol_data = hist_data[symbol]
                
                if symbol_data.empty or len(symbol_data) < 2:
                    continue
                
                # Get current and previous price
                close_prices = symbol_data['Close'].dropna()
                if len(close_prices) < 2:
                    continue
                
                current_price = float(close_prices.iloc[-1])
                previous_price = float(close_prices.iloc[-2])
                
                # Calculate price change
                price_change = current_price - previous_price
                price_change_percent = (price_change / previous_price * 100) if previous_price > 0 else 0
                
                # Calculate volatility (annualized standard deviation of log returns)
                log_returns = np.log(close_prices / close_prices.shift(1)).dropna()
                volatility = 0.0
                if len(log_returns) > 1:
                    volatility = float(log_returns.std() * np.sqrt(252))  # Annualized
                
                # Calculate average volume
                volumes = symbol_data['Volume'].dropna()
                avg_volume = int(volumes.mean()) if len(volumes) > 0 else 0
                
                stock_metrics.append({
                    'symbol': symbol,
                    'price': round(current_price, 2),
                    'priceChange': round(price_change, 2),
                    'priceChangePercent': round(price_change_percent, 2),
                    'volatility': round(volatility, 4),
                    'volume': avg_volume
                })
                
            except Exception as e:
                logger.warning(f"Failed to calculate metrics for {symbol}: {str(e)}")
                continue
        
        logger.info(f"✅ Calculated metrics for {len(stock_metrics)} stocks")
        
        # Step 4: Apply initial filters based on calculated metrics
        filtered_metrics = []
        for stock in stock_metrics:
            # Price range filter
            if criteria.get('priceRange'):
                price_min, price_max = criteria['priceRange']
                if not (price_min <= stock['price'] <= price_max):
                    continue
            
            # Volatility range filter
            if criteria.get('volatilityRange'):
                vol_min, vol_max = criteria['volatilityRange']
                stock_vol_pct = stock['volatility'] * 100
                if not (vol_min <= stock_vol_pct <= vol_max):
                    continue
            
            # Price change range filter
            if criteria.get('priceChangeRange'):
                change_min, change_max = criteria['priceChangeRange']
                if not (change_min <= stock['priceChangePercent'] <= change_max):
                    continue
            
            filtered_metrics.append(stock)
        
        logger.info(f"✅ {len(filtered_metrics)} stocks passed initial filters")
        
        # Step 5: Get detailed info for filtered stocks only (market cap, industry, PE)
        # Limit to top candidates to minimize API calls
        top_candidates = filtered_metrics[:max_results * 2]  # Get 2x for filtering
        top_symbols = [stock['symbol'] for stock in top_candidates]
        
        logger.info(f"📥 Getting detailed info for top {len(top_symbols)} candidates...")
        stock_info = get_stock_info_bulk(top_symbols)
        
        # Step 6: Combine metrics with detailed info
        final_results = []
        for stock_metric in top_candidates:
            symbol = stock_metric['symbol']
            info = stock_info.get(symbol, {})
            
            if not info:
                # If no info available, skip this stock
                continue
            
            # Extract additional info
            market_cap = info.get('marketCap', 0)
            market_cap_billions = market_cap / 1_000_000_000 if market_cap > 0 else 0
            
            # Apply market cap filter
            if criteria.get('marketCapRange'):
                mcap_min, mcap_max = criteria['marketCapRange']
                if not (mcap_min <= market_cap_billions <= mcap_max):
                    continue
            
            # Build final result
            final_results.append({
                'symbol': symbol,
                'name': info.get('longName', symbol),
                'price': stock_metric['price'],
                'priceChange': stock_metric['priceChange'],
                'priceChangePercent': stock_metric['priceChangePercent'],
                'marketCap': round(market_cap_billions, 2),
                'volatility': stock_metric['volatility'],
                'industry': info.get('industry', 'Unknown'),
                'sector': info.get('sector', 'Unknown'),
                'volume': stock_metric['volume'],
                'pe': info.get('trailingPE', info.get('forwardPE', 0)),
                'data_source': 'yfinance_bulk'
            })
        
        # Step 7: Sort by market cap and return
        final_results.sort(key=lambda x: x.get('marketCap', 0), reverse=True)
        
        logger.info(f"✅ Final screening results: {len(final_results)} stocks")
        return final_results[:max_results]
        
    except Exception as e:
        logger.error(f"❌ Bulk download screening failed: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []

def screen_stocks_comprehensive_OLD(criteria: Dict[str, Any], max_results: int = 100) -> List[Dict[str, Any]]:
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
                    executor.submit(fetch_stock_basic_info, symbol): symbol 
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
            executor.submit(fetch_stock_basic_info, symbol): symbol 
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
        
        # Note: Removed artificial 25-second timeout to allow full Lambda execution
        # Lambda has 300 seconds (5 minutes) configured
        # API Gateway has 29 seconds max, but we'll handle that gracefully
        # For long-running operations, we rely on Lambda's natural timeout
        
        # Parse the event
        if isinstance(event, str):
            event = json.loads(event)
        
        # Extract parameters
        criteria = {}
        max_results = 100  # Default page size
        last_evaluated_key = None
        
        if event.get('queryStringParameters'):
            # API Gateway GET request
            params = event['queryStringParameters']
            criteria = json.loads(params.get('criteria', '{}'))
            max_results = int(params.get('maxResults', 100))
            if params.get('lastEvaluatedKey'):
                last_evaluated_key = json.loads(params.get('lastEvaluatedKey'))
        elif event.get('body'):
            # API Gateway POST request
            body = event['body']
            if isinstance(body, str):
                body = json.loads(body)
            criteria = body.get('criteria', {})
            max_results = body.get('maxResults', 100)
            last_evaluated_key = body.get('lastEvaluatedKey')
        else:
            # Direct Lambda invocation
            criteria = event.get('criteria', {})
            max_results = event.get('maxResults', 100)
            last_evaluated_key = event.get('lastEvaluatedKey')
        
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
        
        # Use bulk download screening approach with strict rate limiting
        try:
            logger.info("=== Using DynamoDB cache screening (with HTTP fallback) ===")
            logger.info(f"Criteria: {criteria}")
            logger.info(f"Max results: {max_results}")
            logger.info(f"Last evaluated key: {last_evaluated_key}")
            results, last_eval_key, has_more = screen_stocks_from_dynamodb(criteria, max_results, last_evaluated_key)
            logger.info(f"Screening completed, got {len(results)} results (has_more={has_more})")
            
            # Return empty results with message instead of mock data
            if not results:
                logger.info("No stocks found matching criteria")
                response = {
                    'success': True,
                    'results': [],
                    'totalResults': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
                    'criteria': criteria,
                    'timestamp': datetime.now().isoformat(),
                    'message': 'No stocks match the selected criteria. Try adjusting your filters.'
                }
            else:
                logger.info(f"Stock screening completed: {len(results)} results found")
                response = {
                    'success': True,
                    'results': results,
                    'totalResults': len(results),
                    'has_more': has_more,
                    'last_evaluated_key': last_eval_key,
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
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            
            # Return error response instead of mock data
            response = {
                'success': False,
                'results': [],
                'totalResults': 0,
                'criteria': criteria,
                'timestamp': datetime.now().isoformat(),
                'error': str(screening_error),
                'message': 'Screening failed. Please try again or adjust your criteria.'
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
        logger.warning(f"=== LAMBDA TIMEOUT ===")
        logger.warning(f"Timeout error: {str(e)}")
            
            return {
            'statusCode': 408,  # Request Timeout
                'headers': {
                    'Access-Control-Allow-Headers': 'Origin,X-Requested-With,Content-Type,Authorization,X-Amz-Date,X-amz-security-token,token',
                    'Access-Control-Allow-Methods': 'HEAD,OPTIONS,POST,GET',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Max-Age': '1728000',
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                'success': False,
                'results': [],
                'totalResults': 0,
                    'criteria': criteria,
                    'timestamp': datetime.now().isoformat(),
                'error': 'Request timeout',
                'message': 'The screening request took too long. Please try with fewer criteria.'
                })
            }
        
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
        }
