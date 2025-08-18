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
                        "annualizedVolatility": stats['volatility']
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
        raw_data = fetch_histoday_data(selected_crypto_symbol, period_days)
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
        
        return {
            "current_price": current_price,
            "price_change_24h": price_change_24h,
            "annual_return": annual_return,
            "volatility": volatility
        }

    except Exception as e:
        return {"error": f"Error fetching data for {selected_crypto_symbol}: {str(e)}"}


def fetch_histoday_data(symbol: str, days: int) -> List[Dict[str, Any]]:
    """Fetch daily historical data from CryptoCompare REST API (histoday)."""
    base_url = "https://min-api.cryptocompare.com/data/v2/histoday"
    params = {
        "fsym": symbol,
        "tsym": "USD",
        "limit": max(days, 2),
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

def get_coin_name(symbol):
    """Get coin name from symbol"""
    names = {
        'BTC': 'Bitcoin', 'ETH': 'Ethereum', 'BNB': 'BNB', 
        'ADA': 'Cardano', 'SOL': 'Solana', 'DOT': 'Polkadot',
        'AVAX': 'Avalanche', 'MATIC': 'Polygon', 
        'LINK': 'Chainlink', 'UNI': 'Uniswap'
    }
    return names.get(symbol, symbol)


