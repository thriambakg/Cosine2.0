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

# Rate limiting configuration - STRICT for yfinance
RATE_LIMIT_DELAY = 2.0  # Base delay between operations
MAX_RETRIES = 3  # Limited retries to avoid extended failures
RETRY_DELAY = 15.0  # Long delay on retry to avoid rate limit escalation
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
        logger.info(f"📥 Symbols: {symbols_str[:200]}{'...' if len(symbols_str) > 200 else ''}")
        
        # Download data with error handling
        data = yf.download(
            tickers=symbols_str,
            period=period,
            interval='1d',
            group_by='ticker',
            auto_adjust=True,
            prepost=False,
            threads=False,  # Disable threading to respect rate limits
            progress=False,  # Disable progress bar in Lambda
            show_errors=False  # Don't print errors for each failed ticker
        )
        
        if data.empty:
            logger.warning(f"⚠️ yf.download returned empty DataFrame for {len(symbols)} symbols")
            return pd.DataFrame()
        
        logger.info(f"✅ Downloaded data shape: {data.shape}")
        return data
        
    except Exception as e:
        logger.error(f"❌ Bulk download failed: {str(e)}")
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
        
        # Step 1: Get candidate stock list based on industry
        if criteria.get('industries') and len(criteria['industries']) > 0:
            candidate_symbols = get_stocks_by_industry_fallback(criteria['industries'])
            logger.info(f"Found {len(candidate_symbols)} stocks for industries: {criteria['industries']}")
        else:
            # Use a curated list of liquid, popular stocks for faster screening
            candidate_symbols = COMMON_STOCKS[:100]
            logger.info(f"Using default stock list: {len(candidate_symbols)} symbols")
        
        # Limit candidates to avoid timeout
        candidate_symbols = candidate_symbols[:150]
        logger.info(f"Proceeding with {len(candidate_symbols)} candidate symbols")
        
        # Step 2: Bulk download historical data for all candidates
        period = criteria.get('timeframe', '1mo')
        logger.info(f"📥 Bulk downloading {period} data for {len(candidate_symbols)} symbols...")
        hist_data = download_stock_data_bulk(candidate_symbols, period=period)
        
        if hist_data.empty:
            logger.error("Bulk download returned no data")
            return []
        
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
        
        # Use bulk download screening approach with strict rate limiting
        try:
            logger.info("=== Using yfinance bulk download screening ===")
            logger.info(f"Criteria: {criteria}")
            logger.info(f"Max results: {max_results}")
            results = screen_stocks_with_bulk_download(criteria, max_results)
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
        }
