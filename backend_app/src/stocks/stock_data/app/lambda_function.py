import json
import yfinance as yf
import numpy as np
import pandas as pd
import logging
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        
        if event.get('queryStringParameters'):
            logger.info("Extracting from queryStringParameters")
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
    Fetch comprehensive stock data using yfinance library.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        dict: Comprehensive stock data
    """
    try:
        logger.info(f"Fetching data for {ticker} with period {period}")
        
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
        # Return mock data as fallback
        return generate_mock_stock_data(ticker, period)

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
        
        # Get historical data with detailed logging
        logger.info(f"Attempting to get historical data for {ticker} with period {period}")
        hist = stock.history(period=period)
        
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
        
        # Calculate 24h price change (current vs previous day)
        price_change_24h = ((current_price - previous_close) / previous_close) * 100.0
        logger.info(f"24h price change: {price_change_24h}%")
        
        # Calculate annual return (from start of period to current)
        start_price = hist['Close'].iloc[0]
        annual_return = ((current_price - start_price) / start_price) * 100.0
        logger.info(f"Annual return: {annual_return}% (start: {start_price}, current: {current_price})")
        
        # Calculate 7-day return
        if len(hist) >= 7:
            week_ago_price = hist['Close'].iloc[-7]
            week_return = ((current_price - week_ago_price) / week_ago_price) * 100.0
            logger.info(f"7-day return: {week_return}% (week ago: {week_ago_price})")
        else:
            week_return = annual_return  # Fallback to annual return if not enough data
            logger.info(f"7-day return: {week_return}% (fallback to annual return, insufficient data)")
        
        # Calculate volatility (standard deviation of daily log returns)
        logger.info(f"Calculating volatility for {ticker}")
        log_returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
        logger.info(f"Log returns calculated, length: {len(log_returns)}")
        
        if len(log_returns) > 1:
            daily_std = log_returns.std()
            volatility = daily_std * np.sqrt(252) * 100.0  # Annualized volatility in percentage
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
                
                chart_data.append({
                    'time': timestamp,
                    'close': close_price
                })
                
                logger.info(f"Added data point: time={timestamp}, close={close_price}")
                
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
                'roa': round(roa * 100, 2) if roa else None
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
