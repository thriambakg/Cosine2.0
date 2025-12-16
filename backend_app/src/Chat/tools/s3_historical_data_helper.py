"""
S3 Historical Data Helper - Checks S3 for cached stock data before fetching
"""

import json
import logging
import boto3
import os
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class S3HistoricalDataHelper:
    """Helper for reading stock historical data from S3"""
    
    def __init__(self):
        """Initialize S3 helper"""
        self.bucket_name = os.environ.get('STOCK_HISTORICAL_BUCKET_NAME') or os.environ.get('STOCK_DATA_BUCKET_NAME')
        if not self.bucket_name:
            # Try to construct bucket name from environment
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            self.bucket_name = f"{project_name}-stock-historical-{environment}"
        
        self.s3_client = boto3.client('s3')
        logger.info(f"S3HistoricalDataHelper initialized with bucket: {self.bucket_name}")
    
    def get_stock_data_from_s3(self, symbol: str, timeframe: str = "1y", priority: str = "high") -> Optional[Dict[str, Any]]:
        """
        Get stock data from S3 if available.
        
        Args:
            symbol: Stock ticker symbol
            timeframe: Time period (used to filter data)
            priority: Priority tier (high, medium, low)
            
        Returns:
            Stock data dict or None if not found
        """
        try:
            s3_key = f"historical/{priority}/{symbol.upper()}.json"
            
            # Try to read from S3
            try:
                response = self.s3_client.get_object(
                    Bucket=self.bucket_name,
                    Key=s3_key
                )
                
                data = json.loads(response['Body'].read().decode('utf-8'))
                
                # Filter by timeframe if needed
                filtered_data = self._filter_by_timeframe(data, timeframe)
                
                logger.info(f"✅ Loaded {symbol} from S3 historical data: {len(filtered_data.get('history', []))} points")
                return filtered_data
                
            except ClientError as e:
                if e.response['Error']['Code'] == 'NoSuchKey':
                    logger.debug(f"S3 historical data not available for {symbol}, will use yfinance")
                    return None
                else:
                    logger.warning(f"Error reading S3 for {symbol}: {str(e)}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error getting stock data from S3: {str(e)}")
            return None
    
    def _filter_by_timeframe(self, data: Dict[str, Any], timeframe: str) -> Dict[str, Any]:
        """
        Filter historical data by timeframe.
        
        Args:
            data: Full historical data
            timeframe: Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max')
            
        Returns:
            Filtered data
        """
        history = data.get('history', [])
        if not history:
            return data
        
        # Calculate cutoff date
        now = datetime.now()
        cutoff_date = None
        
        if timeframe == '1d':
            cutoff_date = now - timedelta(days=1)
        elif timeframe == '5d':
            cutoff_date = now - timedelta(days=5)
        elif timeframe == '1mo':
            cutoff_date = now - timedelta(days=30)
        elif timeframe == '3mo':
            cutoff_date = now - timedelta(days=90)
        elif timeframe == '6mo':
            cutoff_date = now - timedelta(days=180)
        elif timeframe == '1y':
            cutoff_date = now - timedelta(days=365)
        elif timeframe == '2y':
            cutoff_date = now - timedelta(days=730)
        elif timeframe == '5y':
            cutoff_date = now - timedelta(days=1825)
        elif timeframe == '10y':
            cutoff_date = now - timedelta(days=3650)
        elif timeframe == 'ytd':
            cutoff_date = datetime(now.year, 1, 1)
        # 'max' uses all data, no filtering
        
        if cutoff_date:
            cutoff_timestamp = int(cutoff_date.timestamp())
            filtered_history = [
                point for point in history
                if point.get('timestamp', 0) >= cutoff_timestamp
            ]
            
            # Update data with filtered history
            filtered_data = data.copy()
            filtered_data['history'] = filtered_history
            filtered_data['data_points'] = len(filtered_history)
            
            if filtered_history:
                filtered_data['first_date'] = filtered_history[0].get('date', '')
            
            return filtered_data
        
        return data



