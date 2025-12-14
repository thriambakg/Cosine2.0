"""
S3 Historical Data Helper
Utility functions for fetching stock historical data from S3 before falling back to yfinance.
This is used by tools (not the planner) to avoid API calls when data is already available.
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def fetch_stock_from_s3_historical(symbol: str, timeframe: str, start_date: str = None, end_date: str = None) -> Optional[Dict[str, Any]]:
    """
    Fetch historical stock data from S3 if available.
    Checks historical/{priority}/{symbol}.json in the stock historical bucket.
    
    This function is used by tools (not the planner) to fetch data from S3
    before falling back to yfinance API calls.
    
    Args:
        symbol: Stock ticker symbol
        timeframe: Time period (used to determine date range)
        start_date: Start date in 'YYYY-MM-DD' format (optional)
        end_date: End date in 'YYYY-MM-DD' format (optional)
        
    Returns:
        Dict with stock data in expected format, or None if not found
    """
    try:
        # Try to get bucket name from environment or construct it
        # Bucket format: cosine-stock-historical-{environment}
        historical_bucket = os.environ.get('STOCK_HISTORICAL_BUCKET')
        if not historical_bucket:
            # Try to construct from project name and environment
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            historical_bucket = f"{project_name}-stock-historical-{environment}"
        
        s3_client = boto3.client('s3')
        
        # Try different priority tiers (high, medium, low)
        priorities = ['high', 'medium', 'low']
        
        for priority in priorities:
            s3_key = f"historical/{priority}/{symbol}.json"
            try:
                response = s3_client.get_object(Bucket=historical_bucket, Key=s3_key)
                stock_data = json.loads(response['Body'].read().decode('utf-8'))
                
                # Extract history array
                history = stock_data.get('history', [])
                if not history or len(history) < 2:
                    continue
                
                # Calculate date range from timeframe if not provided
                if not start_date or not end_date:
                    end_date_obj = datetime.now()
                    if timeframe == '5y':
                        start_date_obj = end_date_obj - timedelta(days=5*365)
                    elif timeframe == '2y':
                        start_date_obj = end_date_obj - timedelta(days=2*365)
                    elif timeframe == '1y':
                        start_date_obj = end_date_obj - timedelta(days=365)
                    elif timeframe == '6mo':
                        start_date_obj = end_date_obj - timedelta(days=180)
                    elif timeframe == '3mo':
                        start_date_obj = end_date_obj - timedelta(days=90)
                    elif timeframe == '1mo':
                        start_date_obj = end_date_obj - timedelta(days=30)
                    elif timeframe == '5d':
                        start_date_obj = end_date_obj - timedelta(days=5)
                    elif timeframe == '1d':
                        start_date_obj = end_date_obj - timedelta(days=1)
                    else:
                        # Default to 1 year
                        start_date_obj = end_date_obj - timedelta(days=365)
                    
                    if not start_date:
                        start_date = start_date_obj.strftime('%Y-%m-%d')
                    if not end_date:
                        end_date = end_date_obj.strftime('%Y-%m-%d')
                
                # Parse date strings
                start_date_obj = datetime.strptime(start_date, '%Y-%m-%d')
                end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
                
                # Filter history by date range
                filtered_history = []
                for point in history:
                    point_date_str = point.get('date', '')
                    if not point_date_str:
                        continue
                    
                    # Parse date (handle ISO format with or without timezone)
                    try:
                        if 'T' in point_date_str:
                            point_date = datetime.fromisoformat(point_date_str.replace('Z', '+00:00'))
                        else:
                            point_date = datetime.strptime(point_date_str, '%Y-%m-%d')
                    except:
                        # Try timestamp if date parsing fails
                        timestamp = point.get('timestamp')
                        if timestamp:
                            point_date = datetime.fromtimestamp(timestamp)
                        else:
                            continue
                    
                    # Remove timezone for comparison
                    if point_date.tzinfo:
                        point_date = point_date.replace(tzinfo=None)
                    
                    if start_date_obj <= point_date <= end_date_obj:
                        filtered_history.append(point)
                
                if len(filtered_history) < 2:
                    logger.debug(f"Insufficient filtered data for {symbol} in {priority} tier")
                    continue
                
                # Get most recent data point for current metrics
                latest_point = filtered_history[-1]
                first_point = filtered_history[0]
                
                # Transform to expected format
                historical_data = []
                for point in filtered_history:
                    historical_data.append({
                        "date": point.get('date', '').split('T')[0],  # Extract date part
                        "timestamp": point.get('timestamp', 0),
                        "open": float(point.get('open', 0)),
                        "high": float(point.get('high', 0)),
                        "low": float(point.get('low', 0)),
                        "close": float(point.get('close', 0)),
                        "volume": int(point.get('volume', 0))
                    })
                
                # Calculate metrics
                current_price = float(latest_point.get('close', 0))
                previous_close = float(first_point.get('close', 0))
                price_change = current_price - previous_close
                price_change_percent = ((price_change / previous_close) * 100) if previous_close > 0 else 0
                
                # Calculate volatility from returns
                closes = [float(p.get('close', 0)) for p in filtered_history if p.get('close', 0) > 0]
                if len(closes) > 1:
                    import numpy as np
                    returns = np.diff(closes) / closes[:-1]
                    volatility = float(np.std(returns) * np.sqrt(252) * 100)  # Annualized percentage
                else:
                    volatility = 0.0
                
                # Get 52-week high/low from all history (not just filtered)
                all_highs = [float(p.get('high', 0)) for p in history if p.get('high', 0) > 0]
                all_lows = [float(p.get('low', 0)) for p in history if p.get('low', 0) > 0]
                fifty_two_week_high = max(all_highs) if all_highs else current_price
                fifty_two_week_low = min(all_lows) if all_lows else current_price
                
                result = {
                    "symbol": symbol,
                    "current_price": round(current_price, 2),
                    "previous_close": round(previous_close, 2),
                    "price_change": round(price_change, 2),
                    "price_change_percent": round(price_change_percent, 2),
                    "market_cap": int(latest_point.get('market_cap', 0)),
                    "volume": int(latest_point.get('volume', 0)),
                    "pe_ratio": stock_data.get('pe_ratio', 'N/A'),
                    "52_week_high": round(fifty_two_week_high, 2),
                    "52_week_low": round(fifty_two_week_low, 2),
                    "volatility_annual": round(volatility, 2),
                    "dividend_yield": stock_data.get('dividend_yield', 0),
                    "sector": stock_data.get('sector', 'N/A'),
                    "industry": stock_data.get('industry', 'N/A'),
                    "status": "success",
                    "source": "S3-Historical",
                    "timeframe": timeframe,
                    "data_points": len(filtered_history),
                    "date_range": {
                        "start": historical_data[0]["date"] if historical_data else start_date,
                        "end": historical_data[-1]["date"] if historical_data else end_date
                    },
                    "historical_data": historical_data
                }
                
                logger.info(f"✅ Loaded {symbol} from S3 historical data: {len(filtered_history)} points ({priority} priority)")
                return result
                
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', '')
                if error_code == 'NoSuchKey':
                    continue
                logger.debug(f"Error reading {symbol} from S3 {priority} tier: {e}")
                continue
            except Exception as e:
                logger.debug(f"Error reading {symbol} from S3 {priority} tier: {e}")
                continue
        
        return None
        
    except Exception as e:
        logger.debug(f"Error fetching from S3 historical for {symbol}: {e}")
        return None
