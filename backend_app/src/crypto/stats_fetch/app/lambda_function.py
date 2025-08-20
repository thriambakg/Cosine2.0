import json
import math
from datetime import datetime
from typing import List, Dict, Any
import urllib.request
import urllib.parse

def lambda_handler(event, context):
    """
    Lambda function to fetch cryptocurrency statistics without external dependencies.
    Calls CryptoCompare REST API directly and computes simple stats using stdlib only.
    """
    try:
        # Parse query parameters
        query_params = event.get('queryStringParameters', {}) or {}
        symbols = query_params.get('symbols', 'BTC,ETH,BNB,ADA,SOL,DOT,AVAX,MATIC,LINK,UNI')
        timeframe = query_params.get('timeframe', '1d')
        
        # Convert comma-separated symbols to list
        symbol_list = [s.strip().upper() for s in symbols.split(',')]
        
        # Limit to top 10 symbols for performance
        symbol_list = symbol_list[:10]
        
        print(f"Fetching crypto stats for symbols: {symbol_list}, timeframe: {timeframe}")
        
        # Fetch crypto data for each symbol
        crypto_data = []
        for symbol in symbol_list:
            try:
                stats = fetch_crypto_stats(symbol, timeframe)
                if 'error' not in stats:
                    crypto_data.append({
                        "symbol": symbol,
                        "name": get_coin_name(symbol),
                        "currentPrice": stats['current_price'],
                        "return24h": stats['price_change_24h'],
                        "annualReturn": stats['annual_return'],
                        "annualizedVolatility": stats['volatility'],
                        "chartData": stats['chart_data']  # Add historical data for charts
                    })
            except Exception as e:
                print(f"Error fetching data for {symbol}: {str(e)}")
                continue
        
        response_body = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": crypto_data,
            "data_source": "CryptoCompare REST API",
            "note": f"Data fetched for {len(crypto_data)} cryptocurrencies"
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,OPTIONS'
            },
            'body': json.dumps(response_body)
        }
        
    except Exception as e:
        print(f"Error in crypto stats lambda: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,OPTIONS'
            },
            'body': json.dumps({
                'error': 'Failed to fetch crypto statistics',
                'message': str(e)
            })
        }

def fetch_crypto_stats(selected_crypto_symbol: str, timeframe: str = '1d') -> Dict[str, Any]:
    """
    Fetch cryptocurrency statistics by calling CryptoCompare REST endpoints.
    Uses only Python stdlib to keep the deployment package lightweight.
    Matches the exact calculation logic from the original cryptocompare implementation.
    """
    try:
        # Map timeframe to period in days (default to 365 days like original)
        period_days = {
            '1d': 2,    # need at least 2 points to compute change
            '7d': 7,
            '30d': 30,
            '1y': 365
        }.get(timeframe, 365)

        # Fetch historical data using direct API call
        raw_data = fetch_historical_data(selected_crypto_symbol, timeframe)
        if len(raw_data) < 2:
            return {"error": "Not enough data to calculate statistics"}

        # Convert to list of close prices (matching the DataFrame logic)
        closes = [float(point['close']) for point in raw_data if 'close' in point and point['close'] is not None]
        
        if len(closes) < 2:
            return {"error": "Not enough data to calculate statistics"}

        # Calculate current price (last close)
        current_price = closes[-1]
        
        # Calculate 24h price change (current vs previous day)
        previous_price = closes[-2]
        price_change_24h = ((current_price - previous_price) / previous_price) * 100.0

        # Calculate annual return based on first and last price of the period
        start_price = closes[0]
        annual_return = ((current_price - start_price) / start_price) * 100.0

        # Calculate annualized volatility (standard deviation of daily log returns)
        log_returns = []
        for i in range(1, len(closes)):
            if closes[i-1] > 0 and closes[i] > 0:
                log_returns.append(math.log(closes[i] / closes[i-1]))

        if len(log_returns) == 0:
            volatility = 0.0
        else:
            # Calculate standard deviation of log returns
            mean_log_return = sum(log_returns) / len(log_returns)
            variance = sum((lr - mean_log_return) ** 2 for lr in log_returns) / len(log_returns)
            daily_std = math.sqrt(variance)
            
            # Annualize volatility using 252 trading days (matching original logic)
            volatility = daily_std * math.sqrt(252) * 100.0  # Convert to percentage
        
        # Prepare chart data
        chart_data = prepare_chart_data(raw_data, timeframe)
        
        return {
            "current_price": current_price,
            "price_change_24h": price_change_24h,
            "annual_return": annual_return,
            "volatility": volatility,
            "chart_data": chart_data
        }

    except Exception as e:
        return {"error": f"Error fetching data for {selected_crypto_symbol}: {str(e)}"}


def fetch_historical_data(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    """Fetch historical data from CryptoCompare REST API based on timeframe."""
    
    # Map timeframe to API endpoint and parameters
    if timeframe == '1d':
        # For 1 day, fetch hourly data (24 points)
        base_url = "https://min-api.cryptocompare.com/data/v2/histohour"
        params = {
            "fsym": symbol,
            "tsym": "USD",
            "limit": 24,
            "toTs": int(datetime.now().timestamp())
        }
    else:
        # For other timeframes, fetch daily data
        base_url = "https://min-api.cryptocompare.com/data/v2/histoday"
        days_map = {'7d': 7, '30d': 30, '1y': 365}
        days = days_map.get(timeframe, 365)
        params = {
            "fsym": symbol,
            "tsym": "USD",
            "limit": days,
            "toTs": int(datetime.now().timestamp())
        }
    
    url = f"{base_url}?{urllib.parse.urlencode(params)}"

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if payload.get("Response") != "Success":
        message = payload.get("Message", "Unknown error")
        raise RuntimeError(f"CryptoCompare API error: {message}")

    data_points = payload.get("Data", {}).get("Data", [])
    return data_points

def prepare_chart_data(raw_data: List[Dict[str, Any]], timeframe: str) -> List[Dict[str, Any]]:
    """
    Prepare historical data for charting based on timeframe.
    Returns formatted data points with time labels and prices.
    """
    if not raw_data or len(raw_data) < 2:
        return []
    
    # Sort data by timestamp (oldest first)
    sorted_data = sorted(raw_data, key=lambda x: x.get('time', 0))
    
    chart_data = []
    for i, point in enumerate(sorted_data):
        # Convert timestamp to readable format
        timestamp = point.get('time', 0)
        close_price = point.get('close', 0)
        
        # Skip invalid data points
        if not timestamp or not close_price or close_price <= 0:
            continue
            
        try:
            date_obj = datetime.fromtimestamp(timestamp)
            
            # Format time label based on timeframe
            if timeframe == '1d':
                # For 1 day, show hours (24 data points)
                time_label = date_obj.strftime('%H:%M')
            elif timeframe == '7d':
                # For 7 days, show day names
                time_label = date_obj.strftime('%a')
            elif timeframe == '30d':
                # For 30 days, show dates
                time_label = date_obj.strftime('%m/%d')
            else:  # 1y
                # For 1 year, show month names
                time_label = date_obj.strftime('%b')
                
            chart_data.append({
                "time": time_label,
                "price": float(close_price),
                "value": float(close_price)  # For compatibility with Recharts
            })
        except (ValueError, OSError) as e:
            # Skip invalid timestamps
            continue
    
    # Limit data points for better chart performance
    if len(chart_data) > 50:
        # Sample data points evenly
        step = len(chart_data) // 50
        chart_data = chart_data[::step]
    
    return chart_data

def get_coin_name(symbol):
    """Get coin name from symbol"""
    names = {
        'BTC': 'Bitcoin', 'ETH': 'Ethereum', 'BNB': 'BNB', 
        'ADA': 'Cardano', 'SOL': 'Solana', 'DOT': 'Polkadot',
        'AVAX': 'Avalanche', 'MATIC': 'Polygon', 
        'LINK': 'Chainlink', 'UNI': 'Uniswap'
    }
    return names.get(symbol, symbol)


