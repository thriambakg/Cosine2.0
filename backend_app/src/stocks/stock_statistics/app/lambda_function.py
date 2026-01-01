import os
# Set OpenBLAS to use a compatible CPU architecture for Lambda
# This prevents the libopenblas64_p-r0-15028c96.3.21.so error
os.environ['OPENBLAS_CORETYPE'] = 'Haswell'

import json
import yfinance as yf
import numpy as np
import pandas as pd
import logging
from datetime import datetime
import volatility_fetcher as fv
import requests
import time
import random
import boto3
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Use print statements for debugging since CloudWatch Logs permissions may be limited
def debug_print(message):
    """Print function that works even if CloudWatch Logs permissions are limited"""
    print(f"[DEBUG] {message}")

def fetch_current_price_fallback(ticker):
    """
    Fallback method to fetch current price directly from Yahoo Finance API
    when yfinance fails due to rate limiting or other issues.
    """
    debug_print(f"Starting fallback price fetch for {ticker}")
    
    try:
        # Add random delay to avoid rate limiting
        delay = random.uniform(0.5, 1.5)
        debug_print(f"Adding {delay:.2f}s delay before price API call")
        time.sleep(delay)
        
        # Yahoo Finance API endpoint for current price
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        debug_print(f"Fallback price API URL: {url}")
        
        # Get current day data
        params = {"range": "1d", "interval": "1m"}
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        
        debug_print(f"Making fallback price API request for {ticker}")
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        debug_print(f"Fallback price API response status: {response.status_code}")
        
        if response.status_code != 200:
            debug_print(f"Fallback price API returned non-200 status: {response.status_code}")
            raise Exception(f"API returned status {response.status_code}")
        
        # Parse JSON response
        data = response.json()
        debug_print(f"Fallback price API JSON parsed successfully for {ticker}")
        
        # Validate response structure
        if 'chart' not in data:
            raise Exception(f"No chart data found for {ticker}")
        
        if not data['chart']['result']:
            raise Exception(f"No data found for {ticker}")
        
        result = data['chart']['result'][0]
        
        # Extract price data
        if 'indicators' not in result or 'quote' not in result['indicators']:
            raise Exception(f"No quote data found for {ticker}")
        
        quote = result['indicators']['quote'][0]
        
        # Try to get current price from different fields
        current_price = None
        
        # Try 'close' first (most recent close)
        if 'close' in quote and quote['close']:
            closes = [p for p in quote['close'] if p is not None]
            if closes:
                current_price = closes[-1]
                debug_print(f"Got price from 'close' field: ${current_price:.2f}")
        
        # Try 'regularMarketPrice' if close is not available
        if current_price is None and 'regularMarketPrice' in quote and quote['regularMarketPrice']:
            prices = [p for p in quote['regularMarketPrice'] if p is not None]
            if prices:
                current_price = prices[-1]
                debug_print(f"Got price from 'regularMarketPrice' field: ${current_price:.2f}")
        
        # Try 'preMarketPrice' as last resort
        if current_price is None and 'preMarketPrice' in quote and quote['preMarketPrice']:
            prices = [p for p in quote['preMarketPrice'] if p is not None]
            if prices:
                current_price = prices[-1]
                debug_print(f"Got price from 'preMarketPrice' field: ${current_price:.2f}")
        
        if current_price is None or current_price <= 0:
            raise Exception(f"No valid price data found for {ticker}")
        
        debug_print(f"Successfully fetched current price for {ticker}: ${current_price:.2f}")
        return float(current_price)
        
    except Exception as e:
        debug_print(f"Fallback price fetch failed for {ticker}: {e}")
        raise

def fetch_stock_data_fallback(ticker, period="1y"):
    """
    Fallback method to fetch stock data directly from Yahoo Finance API
    when yfinance fails due to rate limiting or other issues.
    """
    logger.info(f"Starting fallback method for {ticker} with period: {period}")
    
    try:
        # Add random delay to avoid rate limiting
        delay = random.uniform(0.5, 1.5)
        logger.info(f"Adding {delay:.2f}s delay before API call")
        time.sleep(delay)
        
        # Yahoo Finance API endpoint
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        logger.info(f"Fallback API URL: {url}")
        
        # Set period parameters
        period_map = {
            "1d": {"range": "1d", "interval": "1m"},
            "7d": {"range": "7d", "interval": "1d"},
            "30d": {"range": "30d", "interval": "1d"},
            "1y": {"range": "1y", "interval": "1d"},
            "6mo": {"range": "6mo", "interval": "1d"}
        }
        
        params = period_map.get(period, period_map["1y"])
        logger.info(f"Fallback API params: {params}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        
        logger.info(f"Making fallback API request for {ticker}")
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        logger.info(f"Fallback API response status: {response.status_code}")
        logger.info(f"Fallback API response headers: {dict(response.headers)}")
        
        if response.status_code != 200:
            logger.error(f"Fallback API returned non-200 status: {response.status_code}")
            logger.error(f"Response text: {response.text[:500]}...")
        
        response.raise_for_status()
        
        # Parse JSON response
        try:
            data = response.json()
            logger.info(f"Fallback API JSON parsed successfully for {ticker}")
        except Exception as json_error:
            logger.error(f"Failed to parse JSON response for {ticker}: {json_error}")
            logger.error(f"Response text: {response.text[:500]}...")
            raise
        
        # Validate response structure
        if 'chart' not in data:
            logger.error(f"No 'chart' key in response for {ticker}")
            logger.error(f"Response keys: {list(data.keys())}")
            raise Exception(f"No chart data found for {ticker}")
        
        if not data['chart']['result']:
            logger.error(f"Empty result in chart data for {ticker}")
            logger.error(f"Chart data: {data['chart']}")
            raise Exception(f"No data found for {ticker}")
        
        result = data['chart']['result'][0]
        logger.info(f"Chart result keys: {list(result.keys())}")
        
        # Extract data
        if 'timestamp' not in result:
            logger.error(f"No timestamp data for {ticker}")
            raise Exception(f"No timestamp data for {ticker}")
        
        if 'indicators' not in result or 'quote' not in result['indicators']:
            logger.error(f"No quote data for {ticker}")
            raise Exception(f"No quote data for {ticker}")
        
        timestamps = result['timestamp']
        quotes = result['indicators']['quote'][0]
        closes = quotes['close']
        
        logger.info(f"Extracted {len(timestamps)} timestamps and {len(closes)} close prices for {ticker}")
        
        # Validate data
        if not timestamps or not closes:
            logger.error(f"Empty timestamps or close prices for {ticker}")
            raise Exception(f"No price data found for {ticker}")
        
        # Filter out None values
        valid_data = [(ts, close) for ts, close in zip(timestamps, closes) if close is not None]
        logger.info(f"Valid data points for {ticker}: {len(valid_data)} out of {len(timestamps)}")
        
        if not valid_data:
            logger.error(f"No valid price data for {ticker}")
            raise Exception(f"No valid price data found for {ticker}")
        
        # Create DataFrame
        df = pd.DataFrame({
            'Close': [close for _, close in valid_data],
            'Date': [datetime.fromtimestamp(ts) for ts, _ in valid_data]
        })
        df = df.set_index('Date').dropna()
        
        logger.info(f"Created DataFrame for {ticker}: shape={df.shape}")
        
        if df.empty:
            logger.error(f"Empty DataFrame after processing for {ticker}")
            raise Exception(f"No price data found for {ticker}")
        
        logger.info(f"Fallback method successful for {ticker}: {len(df)} records")
        return df
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error in fallback method for {ticker}: {e}")
        raise Exception(f"Network error fetching data for {ticker}: {str(e)}")
    except Exception as e:
        logger.error(f"Fallback method failed for {ticker}: {str(e)} (type: {type(e).__name__})")
        raise

def calculate_correlation(tickers, period="1y"):
    """
    Calculate the correlation coefficient between a list of stock tickers over a specified period.

    Args:
    tickers (list): A list of stock tickers (e.g., ['AAPL', 'GOOGL', 'AMZN']).
    period (str): The period to retrieve the data for, default is "1y" (1 year).

    Returns:
    pd.DataFrame: A correlation matrix of stock returns.
    """
    # Try yfinance first, then fallback
    try:
        stock_data = yf.download(tickers, period=period)['Close']
        if not stock_data.empty:
            daily_returns = stock_data.pct_change().dropna()
            return daily_returns.corr()
    except Exception as e:
        logger.warning(f"yfinance failed for correlation calculation: {e}")
    
    # Fallback: fetch each ticker individually
    stock_data_list = []
    for ticker in tickers:
        try:
            df = fetch_stock_data_fallback(ticker, period)
            stock_data_list.append(df)
        except Exception as e:
            logger.error(f"Failed to fetch data for {ticker}: {e}")
            raise ValueError(f"Could not retrieve data for {ticker}")
    
    # Combine data and calculate correlation
    combined_data = pd.concat([df['Close'] for df in stock_data_list], axis=1, keys=tickers)
    daily_returns = combined_data.pct_change().dropna()
    correlation_matrix = daily_returns.corr()
    
    return correlation_matrix

def calculate_portfolio_metrics(portfolio_tuples, period="1y"):
    """
    Calculate comprehensive portfolio metrics including risk and return analysis.
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    period (str): Analysis period
    
    Returns:
    dict: Portfolio metrics including total value, expected return, volatility, Sharpe ratio
    """
    try:
        debug_print(f"Calculating portfolio metrics for {len(portfolio_tuples)} positions")
        
        # Extract tickers and calculate weights
        tickers = [ticker for ticker, _, _ in portfolio_tuples]
        total_portfolio_value = sum(shares * price for _, shares, price in portfolio_tuples)
        
        # Calculate weights
        weights = {}
        stock_details = {}
        
        for ticker, shares, price in portfolio_tuples:
            position_value = shares * price
            weight = position_value / total_portfolio_value
            weights[ticker] = weight
            
            stock_details[ticker] = {
                'shares': shares,
                'current_price': price,
                'total_value': position_value,
                'weight': weight,
                'annual_return': 0.0,  # Will be calculated below
                'annual_volatility': 0.0  # Will be calculated below
            }
        
        # Fetch historical data for all tickers with fallback
        stock_data_dict = {}
        debug_print(f"Starting data fetch for tickers: {tickers}")
        debug_print(f"About to enter ticker loop for {len(tickers)} tickers")
        
        for ticker in tickers:
            debug_print(f"Processing ticker: {ticker}")
            try:
                # Try yfinance first
                debug_print(f"Attempting yfinance fetch for {ticker} with period: {period}")
                stock = yf.Ticker(ticker)
                df = stock.history(period=period)
                
                debug_print(f"yfinance response for {ticker}: shape={df.shape}, columns={list(df.columns)}")
                
                if df.empty:
                    debug_print(f"Empty DataFrame returned from yfinance for {ticker}")
                    raise Exception("Empty data from yfinance")
                    
                stock_data_dict[ticker] = df
                debug_print(f"Successfully fetched data for {ticker} using yfinance: {len(df)} records")
                
            except Exception as e:
                debug_print(f"yfinance failed for {ticker}: {str(e)} (type: {type(e).__name__})")
                debug_print(f"Attempting fallback method for {ticker}")
                try:
                    df = fetch_stock_data_fallback(ticker, period)
                    stock_data_dict[ticker] = df
                    debug_print(f"Successfully fetched data for {ticker} using fallback: {len(df)} records")
                except Exception as fallback_error:
                    debug_print(f"Fallback method failed for {ticker}: {str(fallback_error)} (type: {type(fallback_error).__name__})")
                    debug_print(f"Both yfinance and fallback failed for {ticker}")
                    raise Exception(f"No stock data could be retrieved for {ticker}. Check ticker symbol.")
        
        debug_print(f"Successfully fetched data for {len(stock_data_dict)} out of {len(tickers)} tickers")
        
        # Calculate individual stock metrics
        annual_returns = []
        volatilities = []
        
        for ticker in tickers:
            df = stock_data_dict[ticker]
            
            # Calculate annual return
            if len(df) > 1:
                total_return = (df['Close'].iloc[-1] / df['Close'].iloc[0]) - 1
                annual_return = total_return * (252 / len(df))  # Annualized
            else:
                annual_return = 0.0
            
            # Calculate volatility
            if len(df) > 1:
                log_returns = np.log(df['Close'] / df['Close'].shift(1)).dropna()
                volatility = log_returns.std() * np.sqrt(252)  # Annualized
            else:
                volatility = 0.0
            
            annual_returns.append(annual_return)
            volatilities.append(volatility)
            
            # Calculate variance (volatility squared)
            variance = volatility ** 2
            
            # Update stock details
            stock_details[ticker]['annual_return'] = annual_return * 100  # Convert to percentage
            stock_details[ticker]['annual_volatility'] = volatility * 100  # Convert to percentage
            stock_details[ticker]['variance'] = variance  # Keep as decimal (not percentage squared)
            stock_details[ticker]['standard_deviation'] = volatility  # Same as volatility, but explicit
        
        # Calculate portfolio metrics
        portfolio_expected_return = sum(weights[ticker] * annual_returns[i] for i, ticker in enumerate(tickers)) * 100
        
        # Calculate portfolio volatility using correlation matrix
        correlation_dict = None
        covariance_dict = None
        portfolio_variance = 0
        portfolio_volatility = 0
        
        try:
            logger.info("Attempting correlation matrix calculation")
            correlation_matrix_df = calculate_correlation(tickers, period)
            logger.info("Correlation matrix calculated successfully")
            
            # Convert correlation matrix to dictionary format
            correlation_dict = {}
            for i, ticker1 in enumerate(tickers):
                correlation_dict[ticker1] = {}
                for j, ticker2 in enumerate(tickers):
                    correlation_dict[ticker1][ticker2] = float(correlation_matrix_df.iloc[i, j])
            
            # Calculate covariance matrix from correlation matrix and volatilities
            # Covariance = Correlation * StdDev1 * StdDev2
            # Note: volatilities are already in decimal form (not percentage)
            covariance_dict = {}
            for i, ticker1 in enumerate(tickers):
                covariance_dict[ticker1] = {}
                for j, ticker2 in enumerate(tickers):
                    # Covariance = Correlation * StdDev1 * StdDev2
                    cov_value = correlation_dict[ticker1][ticker2] * volatilities[i] * volatilities[j]
                    covariance_dict[ticker1][ticker2] = float(cov_value)
            
            # Calculate portfolio variance using correlation matrix
            portfolio_variance = 0
            for i, ticker1 in enumerate(tickers):
                for j, ticker2 in enumerate(tickers):
                    portfolio_variance += (weights[ticker1] * weights[ticker2] * 
                                         volatilities[i] * volatilities[j] * 
                                         correlation_dict[ticker1][ticker2])
            portfolio_volatility = np.sqrt(portfolio_variance) * 100
            logger.info("Portfolio volatility calculated with correlation matrix")
        except Exception as e:
            logger.warning(f"Correlation calculation failed: {e}, using simplified volatility")
            # Simplified volatility calculation (assumes no correlation)
            portfolio_variance = sum(weights[ticker] * (volatilities[i] ** 2) 
                                   for i, ticker in enumerate(tickers))
            portfolio_volatility = np.sqrt(portfolio_variance) * 100
            logger.info("Portfolio volatility calculated using simplified method")
        
        # Calculate Sharpe ratio (assuming risk-free rate of 2%)
        risk_free_rate = 0.02
        sharpe_ratio = (portfolio_expected_return/100 - risk_free_rate) / (portfolio_volatility/100) if portfolio_volatility > 0 else 0
        
        # Calculate CAGR (Compound Annual Growth Rate)
        # Use the first and last portfolio values from historical data
        portfolio_cagr = None
        try:
            # Calculate portfolio value over time
            if len(stock_data_dict) > 0:
                # Get the earliest and latest dates from all stocks
                all_dates = set()
                for df in stock_data_dict.values():
                    all_dates.update(df.index)
                sorted_dates = sorted(all_dates)
                
                if len(sorted_dates) > 1:
                    # Calculate portfolio value at start and end
                    start_value = 0
                    end_value = 0
                    
                    for ticker in tickers:
                        df = stock_data_dict[ticker]
                        if len(df) > 0:
                            start_price = df['Close'].iloc[0]
                            end_price = df['Close'].iloc[-1]
                            shares = next((s for t, s, _ in portfolio_tuples if t == ticker), 0)
                            start_value += shares * start_price
                            end_value += shares * end_price
                    
                    if start_value > 0:
                        # Calculate number of years
                        days_diff = (sorted_dates[-1] - sorted_dates[0]).days
                        years = days_diff / 365.25
                        
                        if years > 0:
                            # CAGR = (End Value / Start Value)^(1/years) - 1
                            portfolio_cagr = ((end_value / start_value) ** (1 / years) - 1) * 100
                            debug_print(f"CAGR calculated: {portfolio_cagr:.2f}% (start: ${start_value:.2f}, end: ${end_value:.2f}, years: {years:.2f})")
        except Exception as e:
            logger.warning(f"CAGR calculation failed: {e}")
            debug_print(f"CAGR calculation error: {str(e)}")
            # Try fallback to expected return if CAGR calculation fails
            try:
                portfolio_cagr = portfolio_expected_return
                debug_print(f"CAGR fallback to expected return: {portfolio_cagr:.2f}%")
            except:
                portfolio_cagr = 0.0  # Default to 0.0 instead of None so it displays
                debug_print(f"CAGR defaulted to 0.0%")
        
        # Ensure CAGR is never None
        if portfolio_cagr is None:
            portfolio_cagr = 0.0
        
        # Calculate Beta (portfolio beta vs market, using SPY as benchmark)
        portfolio_beta = None
        try:
            # Fetch SPY data for market benchmark
            spy = yf.Ticker("SPY")
            spy_df = spy.history(period=period)
            
            if not spy_df.empty and len(stock_data_dict) > 0:
                # Calculate portfolio returns
                portfolio_returns = []
                spy_returns = []
                
                # Get common dates
                all_dates = set(spy_df.index)
                for df in stock_data_dict.values():
                    all_dates = all_dates.intersection(set(df.index))
                
                sorted_dates = sorted(all_dates)
                
                if len(sorted_dates) > 1:
                    for date in sorted_dates[1:]:  # Skip first date (no previous value)
                        # Calculate portfolio return for this date
                        portfolio_value = 0
                        prev_portfolio_value = 0
                        
                        for ticker in tickers:
                            df = stock_data_dict[ticker]
                            if date in df.index:
                                prev_date_idx = df.index.get_loc(date) - 1
                                if prev_date_idx >= 0:
                                    prev_price = df['Close'].iloc[prev_date_idx]
                                    curr_price = df['Close'].loc[date]
                                    shares = next((s for t, s, _ in portfolio_tuples if t == ticker), 0)
                                    portfolio_value += shares * curr_price
                                    prev_portfolio_value += shares * prev_price
                        
                        if prev_portfolio_value > 0:
                            portfolio_ret = (portfolio_value / prev_portfolio_value) - 1
                            portfolio_returns.append(portfolio_ret)
                            
                            # Calculate SPY return
                            if date in spy_df.index:
                                prev_date_idx = spy_df.index.get_loc(date) - 1
                                if prev_date_idx >= 0:
                                    prev_spy = spy_df['Close'].iloc[prev_date_idx]
                                    curr_spy = spy_df['Close'].loc[date]
                                    spy_ret = (curr_spy / prev_spy) - 1
                                    spy_returns.append(spy_ret)
                
                # Calculate beta using covariance/variance
                if len(portfolio_returns) > 1 and len(spy_returns) > 1 and len(portfolio_returns) == len(spy_returns):
                    portfolio_returns = np.array(portfolio_returns)
                    spy_returns = np.array(spy_returns)
                    
                    covariance = np.cov(portfolio_returns, spy_returns)[0][1]
                    spy_variance = np.var(spy_returns)
                    
                    if spy_variance > 0 and not np.isnan(covariance) and not np.isnan(spy_variance):
                        portfolio_beta = float(covariance / spy_variance)
                        debug_print(f"Beta calculated: {portfolio_beta:.4f} (covariance: {covariance:.6f}, spy_variance: {spy_variance:.6f})")
                    else:
                        debug_print(f"Beta calculation skipped: spy_variance={spy_variance}, covariance={covariance}")
                else:
                    debug_print(f"Beta calculation skipped: insufficient data (portfolio_returns: {len(portfolio_returns)}, spy_returns: {len(spy_returns)})")
            else:
                debug_print(f"Beta calculation skipped: spy_df empty or no stock data")
        except Exception as e:
            logger.warning(f"Beta calculation failed: {e}")
            debug_print(f"Beta calculation error: {str(e)}")
            portfolio_beta = None  # Don't default to 1.0, let frontend show N/A
        
        # Default to 1.0 only if we have no data at all
        if portfolio_beta is None:
            portfolio_beta = 1.0
            debug_print("Beta defaulted to 1.0")
        
        # Calculate Alpha (portfolio return - (risk_free_rate + beta * (market_return - risk_free_rate)))
        portfolio_alpha = None
        try:
            # Get market return (SPY return)
            spy = yf.Ticker("SPY")
            spy_df = spy.history(period=period)
            
            if not spy_df.empty and len(spy_df) > 1 and portfolio_beta is not None:
                market_return = ((spy_df['Close'].iloc[-1] / spy_df['Close'].iloc[0]) - 1) * 100  # Annualized percentage
                
                # Alpha = Portfolio Return - (Risk Free Rate + Beta * (Market Return - Risk Free Rate))
                # Convert to percentage
                portfolio_alpha = portfolio_expected_return - (risk_free_rate * 100 + portfolio_beta * (market_return - risk_free_rate * 100))
                debug_print(f"Alpha calculated: {portfolio_alpha:.2f}% (portfolio_return: {portfolio_expected_return:.2f}%, market_return: {market_return:.2f}%, beta: {portfolio_beta:.4f})")
            else:
                debug_print(f"Alpha calculation skipped: spy_df empty or beta is None")
        except Exception as e:
            logger.warning(f"Alpha calculation failed: {e}")
            debug_print(f"Alpha calculation error: {str(e)}")
            portfolio_alpha = 0.0  # Default to 0.0 instead of None so it displays
        
        # Ensure alpha is never None
        if portfolio_alpha is None:
            portfolio_alpha = 0.0
        
        # Calculate average covariance for each stock with other stocks in portfolio
        if covariance_dict is not None:
            for ticker in tickers:
                if ticker in stock_details:
                    covariances_with_others = []
                    for other_ticker in tickers:
                        if ticker != other_ticker and other_ticker in covariance_dict.get(ticker, {}):
                            covariances_with_others.append(covariance_dict[ticker][other_ticker])
                    if covariances_with_others:
                        stock_details[ticker]['avg_covariance'] = float(np.mean(covariances_with_others))
                    else:
                        stock_details[ticker]['avg_covariance'] = 0.0
        
        # Prepare correlation and covariance data for response
        correlation_data = None
        covariance_data = None
        if correlation_dict is not None:
            correlation_data = {
                'matrix': correlation_dict,
                'tickers': tickers
            }
        if covariance_dict is not None:
            covariance_data = {
                'matrix': covariance_dict,
                'tickers': tickers
            }
        
        # Portfolio variance is already calculated correctly above (line 418-423 or 429-430)
        # Don't overwrite it - it's already in decimal form
        # Portfolio standard deviation = sqrt(variance) = volatility (already calculated)
        # But we need to ensure portfolio_variance is in decimal form (not percentage squared)
        # portfolio_variance is already in decimal form from the calculation above
        
        # Calculate portfolio standard deviation from variance (should match volatility/100)
        portfolio_standard_deviation = np.sqrt(portfolio_variance) if portfolio_variance > 0 else 0.0
        
        # Ensure all values are properly converted to floats (or None) for JSON serialization
        # This ensures they're always included in the response, even if 0.0
        debug_print(f"Final metrics before return:")
        debug_print(f"  CAGR: {portfolio_cagr} (type: {type(portfolio_cagr)})")
        debug_print(f"  Alpha: {portfolio_alpha} (type: {type(portfolio_alpha)})")
        debug_print(f"  Beta: {portfolio_beta} (type: {type(portfolio_beta)})")
        debug_print(f"  Variance: {portfolio_variance} (type: {type(portfolio_variance)})")
        debug_print(f"  StdDev: {portfolio_standard_deviation} (type: {type(portfolio_standard_deviation)})")
        
        return {
            'total_portfolio_value': float(total_portfolio_value),
            'portfolio_expected_return': float(portfolio_expected_return),
            'portfolio_volatility': float(portfolio_volatility),
            'portfolio_variance': float(portfolio_variance) if portfolio_variance is not None else None,  # Already in decimal form
            'portfolio_standard_deviation': float(portfolio_standard_deviation) if portfolio_standard_deviation is not None else None,  # In decimal form (sqrt of variance)
            'sharpe_ratio': float(sharpe_ratio),
            'cagr': float(portfolio_cagr),
            'alpha': float(portfolio_alpha),
            'beta': float(portfolio_beta),
            'correlation': correlation_data,
            'covariance': covariance_data,
            'stock_details': stock_details,
            'individual_stocks': tickers
        }
        
    except Exception as e:
        logger.error(f"Portfolio metrics calculation failed: {e}")
        raise Exception(f"Failed to calculate portfolio metrics: {str(e)}")

def calculate_portfolio_variance(portfolio_weights, annual_volatilities, correlation_matrix):
    """
    Calculate the variance of a portfolio given the weights, volatilities, and correlation matrix.

    Args:
    portfolio_weights (numpy.array): Array of weights of the stocks in the portfolio.
    annual_volatilities (numpy.array): Array of annual volatilities (standard deviations) of the stocks.
    correlation_matrix (pandas.DataFrame): Correlation matrix of stock returns.

    Returns:
    float: Portfolio variance.
    """

    portfolio_weights = np.array(portfolio_weights)
    annual_volatilities = np.array(annual_volatilities)
    correlation_matrix = np.array(correlation_matrix)
    # Convert correlation matrix to a covariance matrix
    # Calculate the covariance matrix using the volatilities and correlation matrix
    cov_matrix = correlation_matrix * np.outer(annual_volatilities, annual_volatilities)

    # Calculate portfolio variance using the formula: w^T * covariance_matrix * w
    portfolio_variance = np.dot(portfolio_weights.T, np.dot(cov_matrix, portfolio_weights))

    return np.sqrt(portfolio_variance)


def calculate_portfolio_metrics(portfolio_tuples, period, risk_free_rate=0.02):
    """
    Calculate portfolio risk and expected return.
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    risk_free_rate (float): Annual risk-free rate (default 2%)
    
    Returns:
    dict: Portfolio metrics including total risk, expected return, and individual stock details
    """
    # Validate input
    if not portfolio_tuples:
        raise ValueError("Portfolio cannot be empty")
    
    # Prepare data structures
    stock_tickers = [ticker for ticker, _, _ in portfolio_tuples]
    
    # Calculate total portfolio value
    total_portfolio_value = sum([shares * price for _, shares, price in portfolio_tuples])
    
    # Download historical stock data with fallback
    debug_print(f"Attempting to fetch data for {stock_tickers}")
    try:
        stock_data = yf.download(stock_tickers, period=period)['Close']
        debug_print(f"yf.download response shape: {stock_data.shape}, empty: {stock_data.empty}")
        
        if stock_data.empty:
            debug_print("yf.download returned empty data, triggering fallback")
            raise Exception("yf.download returned empty data")
            
        debug_print(f"Successfully downloaded data for {stock_tickers} using yf.download")
        logger.info(f"Successfully downloaded data for {stock_tickers}")
    except Exception as e:
        debug_print(f"yf.download failed: {e}, trying individual ticker fallback")
        logger.error(f"Error downloading stock data: {e}")
        
        # Fallback: fetch each ticker individually
        stock_data_list = []
        for ticker in stock_tickers:
            debug_print(f"Fetching fallback data for {ticker}")
            try:
                df = fetch_stock_data_fallback(ticker, period)
                stock_data_list.append(df)
                debug_print(f"Successfully fetched fallback data for {ticker}")
            except Exception as fallback_error:
                debug_print(f"Fallback failed for {ticker}: {fallback_error}")
                logger.error(f"Failed to fetch data for {ticker}: {fallback_error}")
                raise ValueError(f"No stock data could be retrieved for {ticker}. Check stock tickers.")
        
        # Combine individual dataframes
        stock_data = pd.concat([df['Close'] for df in stock_data_list], axis=1, keys=stock_tickers)
        debug_print(f"Successfully combined fallback data: {stock_data.shape}")
    
    # Ensure data is present for all stocks
    if stock_data.empty:
        raise ValueError("No stock data could be retrieved. Check stock tickers.")
    
    # Calculate returns
    returns = stock_data.pct_change().dropna()
    
    # Individual stock analysis
    stock_details = {}
    portfolio_weights = []
    expected_returns = []
    annual_volatilities = []
    
    for ticker, shares, current_price in portfolio_tuples:
        # Skip if data is insufficient
        if ticker not in returns.columns:
            logger.warning(f"No data available for {ticker}")
            continue
        
        # Calculate individual stock metrics
        stock_returns = returns[ticker]
        avg_annual_return = stock_returns.mean() * 252  # Annualized return
        
        # Calculate volatility directly from the data we have
        try:
            annual_volatility = stock_returns.std() * np.sqrt(252)  # Annualized volatility as decimal
            debug_print(f"Calculated volatility for {ticker}: {annual_volatility:.4f} ({annual_volatility*100:.2f}%)")
        except Exception as vol_error:
            debug_print(f"Volatility calculation failed for {ticker}: {vol_error}")
            annual_volatility = 0.0  # Default to 0 if calculation fails
        
        # Calculate portfolio weight
        stock_value = shares * current_price
        weight = stock_value / total_portfolio_value
        portfolio_weights.append(weight)
        expected_returns.append(avg_annual_return)
        annual_volatilities.append(annual_volatility)
        
        # Store stock details
        stock_details[ticker] = {
            'shares': shares,
            'current_price': current_price,
            'total_value': stock_value,
            'annual_return': avg_annual_return * 100,  # Convert to percentage for display
            'annual_volatility': annual_volatility * 100,  # Convert to percentage for display
            'weight': weight
        }
    
    # Validate calculations
    if not stock_details:
        raise ValueError("Unable to calculate metrics for any stocks in the portfolio")
    
    # Portfolio expected return (weighted average of individual returns)
    portfolio_expected_return = np.dot(portfolio_weights, expected_returns)
    
    # Portfolio variance calculation (including covariance)
    correlation_matrix = calculate_correlation(stock_tickers,period=period)

    portfolio_volatility = calculate_portfolio_variance(portfolio_weights, annual_volatilities, correlation_matrix)
    
    # Sharpe Ratio calculation
    sharpe_ratio = (portfolio_expected_return - risk_free_rate) / portfolio_volatility
    
    return {
        'total_portfolio_value': total_portfolio_value,
        'portfolio_expected_return': portfolio_expected_return * 100,  # Convert to percentage
        'portfolio_volatility': portfolio_volatility * 100,  # Convert to percentage
        'sharpe_ratio': sharpe_ratio,
        'stock_details': stock_details,
        'individual_stocks': stock_tickers
    }

def lambda_handler(event, context):
    """
    AWS Lambda handler for portfolio analysis
    
    Supports multiple use cases:
    1. API Gateway: Direct synchronous requests
    2. SQS: Asynchronous requests via queue (with wrapper Lambda)
    3. Robinhood Integration: Receives portfolio data from Robinhood lambda
    4. Standalone Tool: Receives manual portfolio configuration from frontend
    
    Args:
        event: API Gateway event, SQS event, or direct invocation
        context: Lambda context object
        
    Returns:
        dict: HTTP response with portfolio analysis or error
    """
    debug_print("=== Portfolio Analysis Lambda Handler Started ===")
    debug_print(f"Event keys: {list(event.keys())}")
    
    # Detect if this is an SQS event
    is_sqs_event = 'Records' in event and len(event.get('Records', [])) > 0
    request_id = None
    job_id = None
    completion_sns_topic = os.environ.get('PORTFOLIO_ANALYSIS_COMPLETION_SNS_TOPIC_ARN')
    
    if is_sqs_event:
        # Extract from SQS message
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            try:
                message_body = json.loads(first_record.get('body', '{}'))
                request_id = message_body.get('request_id')
                job_id = message_body.get('job_id')
                # Extract the actual API Gateway event from the message
                event = message_body.get('api_gateway_event', event)
                debug_print(f"Processing SQS event - request_id: {request_id}, job_id: {job_id}")
            except Exception as e:
                debug_print(f"Error parsing SQS message: {e}")
                is_sqs_event = False
    
    debug_print(f"HTTP Method: {event.get('httpMethod', 'Unknown')}")
    
    try:
        # Parse request body
        debug_print("Parsing request body")
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
            debug_print("Successfully parsed JSON body")
        else:
            body = event.get('body', {})
            debug_print("Using body as-is (not JSON string)")
        
        debug_print(f"Request body keys: {list(body.keys())}")
        debug_print(f"Request body: {json.dumps(body, indent=2)}")
        
        # CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        # Handle preflight requests
        if event.get('httpMethod') == 'OPTIONS':
            logger.info("Handling OPTIONS preflight request")
            return {
                'statusCode': 200,
                'headers': headers,
                'body': ''
            }
        
        # Validate input
        logger.info("Validating input parameters")
        portfolio_data = body.get('portfolio_data')
        period = body.get('period', '1y')
        analysis_type = body.get('analysis_type', 'standalone')  # 'robinhood' or 'standalone'
        source = body.get('source', 'tile')  # 'tile' or 'page' - determines if chart_data should be included
        
        # Validate period
        valid_periods = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']
        if period not in valid_periods:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': f'Invalid period: {period}',
                    'details': f'Supported periods: {", ".join(valid_periods)}'
                })
            }
        
        logger.info(f"Portfolio data: {portfolio_data}")
        logger.info(f"Period: {period}")
        logger.info(f"Analysis type: {analysis_type}")
        
        if not portfolio_data:
            logger.error("No portfolio data provided")
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data is required',
                    'details': 'Provide portfolio_data as list of [ticker, shares, price] tuples'
                })
            }
        
        # Validate portfolio data format
        if not isinstance(portfolio_data, list):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data must be a list',
                    'details': 'Expected format: [["AAPL", 10, 190.50], ["GOOGL", 5, 125.75]]'
                })
            }
        
        # Validate each portfolio entry (now expects [ticker, shares] format)
        portfolio_entries = []
        for i, entry in enumerate(portfolio_data):
            # Support both [ticker, shares] and [ticker, shares, price] formats for backward compatibility
            if not isinstance(entry, list) or len(entry) < 2 or len(entry) > 3:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Invalid portfolio entry at index {i}',
                        'details': 'Each entry must be [ticker, shares] or [ticker, shares, price]'
                    })
                }
            
            ticker = entry[0]
            shares = entry[1]
            
            try:
                shares = float(shares)
                portfolio_entries.append((str(ticker).upper(), shares))
                debug_print(f"Portfolio entry {i}: {ticker.upper()} - {shares} shares")
            except (ValueError, TypeError):
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Invalid data types at index {i}',
                        'details': 'Shares must be a number'
                    })
                }
        
        # Fetch current prices for all tickers
        debug_print("Fetching current prices for all tickers")
        portfolio_tuples = []
        for ticker, shares in portfolio_entries:
            try:
                # Get current price from yfinance with fallback options
                stock = yf.Ticker(ticker)
                current_price = None
                
                # Try different methods to get current price
                try:
                    # Method 1: Try to get the most recent closing price
                    hist_data = stock.history(period="5d")  # Get last 5 days
                    if not hist_data.empty:
                        current_price = hist_data['Close'].iloc[-1]
                        debug_print(f"Fetched current price for {ticker} from history: ${current_price:.2f}")
                    else:
                        raise Exception("No historical data available")
                        
                except Exception as hist_error:
                    debug_print(f"History method failed for {ticker}: {hist_error}")
                    
                    # Method 2: Try to get info data
                    try:
                        info = stock.info
                        if 'currentPrice' in info and info['currentPrice']:
                            current_price = info['currentPrice']
                            debug_print(f"Fetched current price for {ticker} from info: ${current_price:.2f}")
                        elif 'regularMarketPrice' in info and info['regularMarketPrice']:
                            current_price = info['regularMarketPrice']
                            debug_print(f"Fetched current price for {ticker} from market price: ${current_price:.2f}")
                        elif 'previousClose' in info and info['previousClose']:
                            current_price = info['previousClose']
                            debug_print(f"Fetched previous close for {ticker}: ${current_price:.2f}")
                        else:
                            raise Exception("No price data in info")
                            
                    except Exception as info_error:
                        debug_print(f"Info method failed for {ticker}: {info_error}")
                        
                        # Method 3: Try direct HTTP API fallback (same as used for historical data)
                        try:
                            debug_print(f"Trying direct HTTP API fallback for {ticker}")
                            current_price = fetch_current_price_fallback(ticker)
                            debug_print(f"Fallback method successful for {ticker}: ${current_price:.2f}")
                        except Exception as fallback_error:
                            debug_print(f"Fallback method failed for {ticker}: {fallback_error}")
                            raise Exception(f"All price fetching methods failed: history={hist_error}, info={info_error}, fallback={fallback_error}")
                
                if current_price is None or current_price <= 0:
                    raise Exception(f"Invalid price data: {current_price}")
                
                portfolio_tuples.append((ticker, shares, float(current_price)))
                debug_print(f"Successfully added {ticker} to portfolio with price ${current_price:.2f}")
                
            except Exception as price_error:
                debug_print(f"Failed to fetch current price for {ticker}: {price_error}")
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Failed to fetch current price for {ticker}',
                        'details': str(price_error)
                    })
                }
        
        # Calculate portfolio metrics
        debug_print(f"Starting portfolio analysis with {len(portfolio_tuples)} positions, period: {period}")
        debug_print(f"Portfolio tuples: {portfolio_tuples}")
        
        try:
            portfolio_metrics = calculate_portfolio_metrics(portfolio_tuples, period)
            debug_print("Portfolio metrics calculation completed successfully")
            debug_print(f"Portfolio metrics keys: {list(portfolio_metrics.keys())}")
        except Exception as calc_error:
            logger.error(f"Portfolio metrics calculation failed: {str(calc_error)} (type: {type(calc_error).__name__})")
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Failed to calculate portfolio metrics',
                    'details': f'Calculation error: {str(calc_error)}'
                })
            }
        
        if portfolio_metrics is None:
            logger.error("Portfolio metrics returned None")
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Failed to calculate portfolio metrics',
                    'details': 'Check that all stock tickers are valid and data is available'
                })
            }
        
        # Prepare response
        logger.info("Preparing response data")
        response_data = {
            'success': True,
            'analysis_type': analysis_type,
            'period': period,
            'portfolio_metrics': portfolio_metrics,
            'timestamp': datetime.now().isoformat()
        }
        
        # Add metadata based on analysis type
        if analysis_type == 'robinhood':
            response_data['source'] = 'robinhood_integration'
            response_data['positions_count'] = len(portfolio_tuples)
        else:
            response_data['source'] = 'standalone_tool'
            response_data['positions_count'] = len(portfolio_tuples)
        
        # If source is 'page', generate chart data for all stocks
        if source == 'page':
            logger.info("Generating chart data for page source")
            try:
                chart_data = {}
                tickers = [ticker for ticker, _, _ in portfolio_tuples]
                
                # Fetch historical data for chart generation
                for ticker in tickers:
                    try:
                        stock = yf.Ticker(ticker)
                        df = stock.history(period=period)
                        
                        if not df.empty:
                            # Convert to chart_data format (same as stock-data endpoint)
                            chart_points = []
                            for idx, row in df.iterrows():
                                chart_points.append({
                                    'time': int(idx.timestamp()),
                                    'open': float(row['Open']),
                                    'high': float(row['High']),
                                    'low': float(row['Low']),
                                    'close': float(row['Close']),
                                    'volume': int(row['Volume']) if 'Volume' in row else 0
                                })
                            chart_data[ticker] = chart_points
                            logger.info(f"Generated {len(chart_points)} chart points for {ticker}")
                        else:
                            logger.warning(f"Empty data for {ticker}, skipping chart data")
                    except Exception as chart_error:
                        logger.error(f"Error generating chart data for {ticker}: {chart_error}")
                        # Continue with other tickers even if one fails
                
                if chart_data:
                    response_data['chart_data'] = chart_data
                    logger.info(f"Successfully generated chart data for {len(chart_data)} stocks")
            except Exception as e:
                logger.error(f"Error generating chart data: {e}", exc_info=True)
                # Don't fail the request if chart data generation fails
        
        logger.info(f"Response prepared successfully for {analysis_type} analysis")
        logger.info(f"Total portfolio value: ${portfolio_metrics['total_portfolio_value']:,.2f}")
        logger.info(f"Expected return: {portfolio_metrics['portfolio_expected_return']:.2f}%")
        logger.info(f"Volatility: {portfolio_metrics['portfolio_volatility']:.2f}%")
        logger.info(f"Sharpe ratio: {portfolio_metrics['sharpe_ratio']:.2f}")
        
        response = {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(response_data)
        }
        
        debug_print(f"Returning response with statusCode: {response['statusCode']}")
        debug_print(f"Response body length: {len(response['body'])} characters")
        debug_print(f"Response data keys: {list(response_data.keys())}")
        
        # If this was from SQS, publish completion notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                completion_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 200,
                    'body': response_data,
                    'status': 'completed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(completion_message, default=str),
                    Subject=f'Portfolio Analysis Completion: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id or ''
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published completion notification for job {job_id}")
            except Exception as e:
                logger.error(f"Error publishing completion notification: {e}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (results sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'Processed from SQS', 'job_id': job_id})
            }
        
        logger.info("=== Portfolio Analysis Lambda Handler Completed Successfully ===")
        return response
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Invalid JSON in request body',
                'details': str(e)
            })
        }
        
    except Exception as e:
        logger.error(f"Lambda handler error: {e}")
        
        error_response = {
            'error': 'Internal server error',
            'details': str(e)
        }
        
        # If this was from SQS, publish failure notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                failure_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 500,
                    'body': error_response,
                    'status': 'failed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(failure_message, default=str),
                    Subject=f'Portfolio Analysis Failure: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id or ''
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published failure notification for job {job_id}")
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {e2}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (error sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 500,
                'body': json.dumps({'message': 'Analysis failed', 'job_id': job_id, 'error': str(e)})
            }
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(error_response)
        }

def lambda_function(portfolio_tuples, period="1y"):
    """
    Legacy function for direct portfolio analysis (used by Robinhood integration)
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    period (str): Analysis period
    """
    try:
        # Calculate portfolio metrics
        portfolio_metrics = calculate_portfolio_metrics(portfolio_tuples, period)
        
        return portfolio_metrics
    
    except Exception as e:
        logger.error(f"Portfolio calculation failed: {e}")
        return None

# Allow direct script execution for testing
if __name__ == "__main__":
    # Test the lambda handler with a sample portfolio
    test_event = {
        'httpMethod': 'POST',
        'body': json.dumps({
            'portfolio_data': [
                ['AAPL', 10, 190.50],  # ticker, shares, current price
                ['GOOGL', 5, 125.75],
                ['MSFT', 7, 340.20]
            ],
            'period': '1y',
            'analysis_type': 'standalone'
        })
    }
    
    # Test standalone analysis
    print("Testing Standalone Portfolio Analysis:")
    print("=" * 50)
    result = lambda_handler(test_event, None)
    print(f"Status Code: {result['statusCode']}")
    if result['statusCode'] == 200:
        response_body = json.loads(result['body'])
        metrics = response_body['portfolio_metrics']
        print(f"Total Portfolio Value: ${metrics['total_portfolio_value']:,.2f}")
        print(f"Expected Return: {metrics['portfolio_expected_return']:.2f}%")
        print(f"Volatility: {metrics['portfolio_volatility']:.2f}%")
        print(f"Sharpe Ratio: {metrics['sharpe_ratio']:.2f}")
    else:
        print(f"Error: {result['body']}")
    
    # Test Robinhood analysis type
    print("\nTesting Robinhood Integration Format:")
    print("=" * 50)
    test_event['body'] = json.dumps({
        'portfolio_data': [
            ['TSLA', 3, 240.85],
            ['AMZN', 2, 145.30]
        ],
        'period': '6mo',
        'analysis_type': 'robinhood'
    })
    
    result = lambda_handler(test_event, None)
    print(f"Status Code: {result['statusCode']}")
    if result['statusCode'] == 200:
        response_body = json.loads(result['body'])
        print(f"Analysis Type: {response_body['analysis_type']}")
        print(f"Source: {response_body['source']}")
        print(f"Positions: {response_body['positions_count']}")
    else:
        print(f"Error: {result['body']}")
