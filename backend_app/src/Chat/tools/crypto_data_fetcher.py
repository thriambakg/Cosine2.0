"""
Crypto Data Fetcher tool for the chat agent to retrieve real-time cryptocurrency data
"""

import json
import os
import urllib.parse
import requests
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import math
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.compression_helper import CompressionHelper

# Configure logging
logger = logging.getLogger()

# Import agent_logger for WebSocket streaming
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    # Import successful - no need to log
except ImportError as e:
    logger.warning(f"Could not import Strands types: {e}")
    # Define fallback types for local development
    class ToolResult:
        def __init__(self, content: str, is_error: bool = False):
            self.content = content
            self.is_error = is_error
    
    class ToolUse:
        def __init__(self, name: str, arguments: Dict[str, Any]):
            self.name = name
            self.arguments = arguments

class CryptoDataFetcher:
    """
    Fetches cryptocurrency data using CryptoCompare API
    """
    
    def __init__(self):
        self.base_url = "https://min-api.cryptocompare.com/data"
        self.api_key = os.environ.get('CRYPTOCOMPARE_API_KEY', '')
    
    def fetch_crypto_data(self, symbol: str, timeframe: str = '7d', start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """
        Fetch cryptocurrency data for a given symbol and timeframe
        
        Args:
            symbol: Cryptocurrency symbol (e.g., 'BTC', 'ETH')
            timeframe: Time period ('1d', '7d', '30d', '1y', '2y', '5y', 'max')
            start_date: Start date in 'YYYY-MM-DD' format (optional)
            end_date: End date in 'YYYY-MM-DD' format (optional)
            
        Returns:
            Dictionary with crypto data including price, returns, volatility
        """
        try:
            symbol = symbol.upper()
            
            # Fetch historical data
            historical_data = self._fetch_historical_data(symbol, timeframe, start_date, end_date)
            if not historical_data:
                return {"error": f"No data available for {symbol}"}
            
            # Calculate statistics
            stats = self._calculate_statistics(historical_data, symbol, timeframe)
            
            return stats
            
        except Exception as e:
            logger.error(f"Error fetching crypto data for {symbol}: {str(e)}")
            return {"error": f"Failed to fetch data for {symbol}: {str(e)}"}
    
    def _fetch_historical_data(self, symbol: str, timeframe: str, start_date: str = None, end_date: str = None) -> List[Dict[str, Any]]:
        """Fetch historical data from CryptoCompare API with support for custom date ranges"""
        try:
            # Map timeframe to API parameters
            if timeframe == '1d':
                # For 1 day, fetch hourly data
                endpoint = f"{self.base_url}/v2/histohour"
                params = {
                    "fsym": symbol,
                    "tsym": "USD",
                    "limit": 24,
                    "toTs": int(datetime.now().timestamp())
                }
            else:
                # For other timeframes, fetch daily data
                endpoint = f"{self.base_url}/v2/histoday"
                days_map = {
                    '7d': 7, 
                    '30d': 30, 
                    '1y': 365,
                    '2y': 730,
                    '5y': 1825,
                    'max': 2000  # Maximum limit for API
                }
                days = days_map.get(timeframe, 7)
                params = {
                    "fsym": symbol,
                    "tsym": "USD",
                    "limit": days,
                    "toTs": int(datetime.now().timestamp())
                }
            
            # Handle custom date ranges
            if start_date and end_date:
                try:
                    from datetime import datetime
                    start_ts = int(datetime.strptime(start_date, '%Y-%m-%d').timestamp())
                    end_ts = int(datetime.strptime(end_date, '%Y-%m-%d').timestamp())
                    
                    # Use daily data for custom ranges
                    endpoint = f"{self.base_url}/v2/histoday"
                    params = {
                        "fsym": symbol,
                        "tsym": "USD",
                        "toTs": end_ts,
                        "limit": min(2000, (end_ts - start_ts) // 86400)  # Convert days to seconds
                    }
                except ValueError:
                    logger.warning(f"Invalid date format: {start_date} or {end_date}")
            
            # Add API key if available
            if self.api_key:
                params['api_key'] = self.api_key
            
            # Build URL
            url = f"{endpoint}?{urllib.parse.urlencode(params)}"
            
            # Make request (requests avoids urllib file:// scheme risk)
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            resp.raise_for_status()
            payload = resp.json()
            
            if payload.get("Response") != "Success":
                message = payload.get("Message", "Unknown error")
                raise RuntimeError(f"CryptoCompare API error: {message}")
            
            data_points = payload.get("Data", {}).get("Data", [])
            return data_points
            
        except Exception as e:
            logger.error(f"Error fetching historical data for {symbol}: {str(e)}")
            return []
    
    def _calculate_statistics(self, data: List[Dict[str, Any]], symbol: str, timeframe: str) -> Dict[str, Any]:
        """Calculate crypto statistics from historical data"""
        try:
            if len(data) < 2:
                return {"error": "Not enough data to calculate statistics"}
            
            # Extract close prices
            closes = [float(point['close']) for point in data if 'close' in point and point['close'] is not None]
            
            if len(closes) < 2:
                return {"error": "Not enough valid price data"}
            
            # Current price (last close)
            current_price = closes[-1]
            
            # 24h price change
            previous_price = closes[-2]
            price_change_24h = ((current_price - previous_price) / previous_price) * 100.0
            
            # Period return
            start_price = closes[0]
            period_return = ((current_price - start_price) / start_price) * 100.0
            
            # Calculate volatility (standard deviation of log returns)
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
                
                # Annualize volatility
                volatility = daily_std * math.sqrt(252) * 100.0
            
            # Prepare chart data
            chart_data = self._prepare_chart_data(data, timeframe)
            
            # Get coin name
            coin_name = self._get_coin_name(symbol)
            
            # Build the complete data object first
            result = {
                "symbol": symbol,
                "name": coin_name,
                "current_price": current_price,
                "price_change_24h": price_change_24h,
                "period_return": period_return,
                "volatility": volatility,
                "timeframe": timeframe,
                "chart_data": chart_data,
                "data_points": len(data),
                "last_updated": datetime.utcnow().isoformat() + "Z"
            }
            
            # Compress the entire data object if it's large
            compressed_result = CompressionHelper.compress_data(result, compression_threshold=2000)
            
            return compressed_result
            
        except Exception as e:
            logger.error(f"Error calculating statistics: {str(e)}")
            return {"error": f"Failed to calculate statistics: {str(e)}"}
    
    def _prepare_chart_data(self, data: List[Dict[str, Any]], timeframe: str) -> List[Dict[str, Any]]:
        """Prepare chart data for visualization"""
        try:
            # Sort data by timestamp
            sorted_data = sorted(data, key=lambda x: x.get('time', 0))
            
            chart_data = []
            for point in sorted_data:
                timestamp = point.get('time', 0)
                close_price = point.get('close', 0)
                
                if not timestamp or not close_price or close_price <= 0:
                    continue
                
                try:
                    date_obj = datetime.fromtimestamp(timestamp)
                    
                    # Format time label based on timeframe
                    if timeframe == '1d':
                        time_label = date_obj.strftime('%H:%M')
                    elif timeframe == '7d':
                        time_label = date_obj.strftime('%a')
                    elif timeframe == '30d':
                        time_label = date_obj.strftime('%m/%d')
                    else:  # 1y
                        time_label = date_obj.strftime('%b')
                    
                    chart_data.append({
                        "time": time_label,
                        "price": float(close_price),
                        "value": float(close_price)
                    })
                except (ValueError, OSError):
                    continue
            
            # Limit data points for performance
            if len(chart_data) > 50:
                step = len(chart_data) // 50
                chart_data = chart_data[::step]
            
            return chart_data
            
        except Exception as e:
            logger.error(f"Error preparing chart data: {str(e)}")
            return []
    
    def _get_coin_name(self, symbol: str) -> str:
        """Get coin name from symbol"""
        names = {
            'BTC': 'Bitcoin', 'ETH': 'Ethereum', 'BNB': 'BNB', 
            'ADA': 'Cardano', 'SOL': 'Solana', 'DOT': 'Polkadot',
            'AVAX': 'Avalanche', 'MATIC': 'Polygon', 
            'LINK': 'Chainlink', 'UNI': 'Uniswap',
            'DOGE': 'Dogecoin', 'XRP': 'Ripple', 'LTC': 'Litecoin',
            'BCH': 'Bitcoin Cash', 'EOS': 'EOS', 'TRX': 'TRON'
        }
        return names.get(symbol, symbol)

# Global instance
crypto_fetcher = CryptoDataFetcher()

@tool
def get_crypto_data_tool(symbol: str, timeframe: str = "7d", start_date: str = None, end_date: str = None) -> str:
    """
    Tool function to fetch real-time cryptocurrency data with flexible timeframes
    
    Args:
        symbol: Cryptocurrency symbol (e.g., 'BTC', 'ETH', 'DOGE')
        timeframe: Time period for analysis ('1d', '7d', '30d', '1y', '2y', '5y', 'max')
        start_date: Start date in 'YYYY-MM-DD' format (optional)
        end_date: End date in 'YYYY-MM-DD' format (optional)
    
    Returns:
        String with cryptocurrency data including price, returns, and volatility
    """
    try:
        agent_logger.info(f"Getting crypto data for {symbol}")
        if not symbol:
            return "Error: symbol parameter is required"
        
        # Fetch crypto data
        result = crypto_fetcher.fetch_crypto_data(symbol.upper(), timeframe, start_date, end_date)
        
        if "error" in result:
            return f"Error fetching crypto data for {symbol}: {result['error']}"
        
        # Format response for AI
        response_parts = [
            f"Cryptocurrency Data for {result['name']} ({result['symbol']}):",
            f"- Current Price: ${result['current_price']:,.2f}",
            f"- 24h Change: {result['price_change_24h']:+.2f}%",
            f"- {timeframe.upper()} Return: {result['period_return']:+.2f}%",
            f"- Annualized Volatility: {result['volatility']:.2f}%",
            f"- Data Points: {result['data_points']}",
            f"- Last Updated: {result['last_updated']}"
        ]
        
        # Add chart data summary
        if result['chart_data']:
            response_parts.append(f"\nChart Data ({len(result['chart_data'])} points):")
            # Show first few and last few data points
            chart_data = result['chart_data']
            if len(chart_data) > 6:
                for i in range(3):
                    point = chart_data[i]
                    response_parts.append(f"  {point['time']}: ${point['price']:,.2f}")
                response_parts.append("  ...")
                for i in range(-3, 0):
                    point = chart_data[i]
                    response_parts.append(f"  {point['time']}: ${point['price']:,.2f}")
            else:
                for point in chart_data:
                    response_parts.append(f"  {point['time']}: ${point['price']:,.2f}")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in get_crypto_data_tool: {str(e)}")
        return f"Error fetching crypto data: {str(e)}"

@tool
def compare_crypto_tool(symbols: str, timeframe: str = "7d", start_date: str = None, end_date: str = None) -> str:
    """
    Tool function to compare multiple cryptocurrencies with flexible timeframes
    
    Args:
        symbols: Comma-separated list of crypto symbols (e.g., 'BTC,ETH,DOGE')
        timeframe: Time period for comparison ('1d', '7d', '30d', '1y', '2y', '5y', 'max')
        start_date: Start date in 'YYYY-MM-DD' format (optional)
        end_date: End date in 'YYYY-MM-DD' format (optional)
        
    Returns:
        String with comparison data for multiple cryptocurrencies
    """
    try:
        if not symbols:
            return "Error: symbols parameter is required"
        
        # Parse symbols
        symbol_list = [s.strip().upper() for s in symbols.split(',')]
        
        if len(symbol_list) > 5:
            return "Error: Maximum 5 cryptocurrencies can be compared at once"
        
        # Fetch data for each symbol
        results = []
        for symbol in symbol_list:
            data = crypto_fetcher.fetch_crypto_data(symbol, timeframe, start_date, end_date)
            if "error" not in data:
                results.append(data)
        
        if not results:
            return "Error: No valid cryptocurrency data found"
        
        # Format comparison
        response_parts = [
            f"Cryptocurrency Comparison ({timeframe.upper()} timeframe):",
            f"Data for {len(results)} cryptocurrencies:"
        ]
        
        for result in results:
            response_parts.append(f"\n{result['name']} ({result['symbol']}):")
            response_parts.append(f"  Price: ${result['current_price']:,.2f}")
            response_parts.append(f"  24h Change: {result['price_change_24h']:+.2f}%")
            response_parts.append(f"  {timeframe.upper()} Return: {result['period_return']:+.2f}%")
            response_parts.append(f"  Volatility: {result['volatility']:.2f}%")
        
        # Add summary statistics
        if len(results) > 1:
            prices = [r['current_price'] for r in results]
            returns = [r['period_return'] for r in results]
            volatilities = [r['volatility'] for r in results]
            
            response_parts.append(f"\nSummary:")
            response_parts.append(f"  Highest Price: ${max(prices):,.2f} ({results[prices.index(max(prices))]['symbol']})")
            response_parts.append(f"  Best Return: {max(returns):+.2f}% ({results[returns.index(max(returns))]['symbol']})")
            response_parts.append(f"  Highest Volatility: {max(volatilities):.2f}% ({results[volatilities.index(max(volatilities))]['symbol']})")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in compare_crypto_tool: {str(e)}")
        return f"Error comparing cryptocurrencies: {str(e)}"
