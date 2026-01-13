import json
# Set matplotlib to use non-interactive backend (required for Lambda)
import matplotlib
matplotlib.use('Agg')  # Must be set before importing pyplot
# Optimize matplotlib for faster rendering
matplotlib.rcParams['path.simplify'] = True
matplotlib.rcParams['path.simplify_threshold'] = 1.0
matplotlib.rcParams['agg.path.chunksize'] = 10000  # Process paths in chunks
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import pandas as pd
import boto3
import os
from io import BytesIO
import logging
import threading
import uuid
import signal
from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

# Configure logging
logger = logging.getLogger()

# Import agent_logger for WebSocket streaming
try:
    import sys
    import os
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
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

class UnifiedChartGenerator:
    """
    Unified chart generator that can handle both stock and cryptocurrency data.
    Automatically detects data type and generates appropriate charts.
    """
    def __init__(self):
        self.s3_client = boto3.client('s3')
        # Don't set user_id and session_id here - get them dynamically when needed
    
    def _get_user_id(self):
        """Get user ID dynamically from environment variables"""
        return os.environ.get('USER_ID', 'default-user')
    
    def _get_session_id(self):
        """Get session ID dynamically from environment variables"""
        return os.environ.get('SESSION_ID', 'default-session')
    
    def _get_bucket_name(self):
        """Get bucket name dynamically from environment variables"""
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        if not bucket_name:
            raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
        return bucket_name

    def _validate_env_vars(self):
        # Get current values dynamically
        bucket_name = self._get_bucket_name()
        user_id = self._get_user_id()
        session_id = self._get_session_id()
        
        # Debug logging to see what environment variables are available
        logger.info(f"🔍 DEBUG: Chart generator environment variables:")
        logger.info(f"🔍 DEBUG: USER_ID = {os.environ.get('USER_ID', 'NOT SET')}")
        logger.info(f"🔍 DEBUG: SESSION_ID = {os.environ.get('SESSION_ID', 'NOT SET')}")
        logger.info(f"🔍 DEBUG: CHAT_FILES_BUCKET_NAME = {os.environ.get('CHAT_FILES_BUCKET_NAME', 'NOT SET')}")
        logger.info(f"🔍 DEBUG: Using user_id = {user_id}, session_id = {session_id}")
        
        return bucket_name, user_id, session_id

    def _detect_data_type(self, data_dict):
        """
        Detect whether the data is from stock or crypto tool based on structure.
        
        Stock data indicators:
        - Has 'historical_data' key with OHLCV data
        - Has 'timeframe', 'data_points', 'date_range' keys
        - Has 'stocks' key (multiple stocks data)
        
        Crypto data indicators:
        - Has 'chart_data' key with time/price data
        - Has 'name' key (coin name)
        - Chart data has 'time' and 'price' keys (not 'close')
        """
        # Check for multiple stocks data
        if 'stocks' in data_dict and isinstance(data_dict['stocks'], list):
            return 'multiple_stocks'
        elif 'historical_data' in data_dict:
            return 'stock'
        elif 'chart_data' in data_dict:
            # Check chart data structure to confirm crypto
            chart_data = data_dict.get('chart_data', [])
            if chart_data and isinstance(chart_data, list) and len(chart_data) > 0:
                first_point = chart_data[0]
                if 'price' in first_point and 'time' in first_point:
                    return 'crypto'
                elif 'close' in first_point and 'time' in first_point:
                    return 'stock'  # Stock data in chart_data format
        return 'unknown'

    def _normalize_data(self, data_dict, data_type):
        """
        Normalize data from different sources into a consistent format.
        """
        if data_type == 'multiple_stocks':
            # Handle multiple stocks data from get_multiple_financial_data
            stocks_data = data_dict.get('stocks', [])
            normalized_data = {}
            
            logger.info(f"🔍 DEBUG: Processing {len(stocks_data)} stocks for normalization")
            
            for stock in stocks_data:
                # Check if stock has historical_data (more lenient - don't require status='success')
                # Some stocks might not have status field, or might be compressed
                if not isinstance(stock, dict):
                    logger.warning(f"⚠️ Skipping non-dict stock: {type(stock)}")
                    continue
                
                # Check for historical_data - this is the key requirement
                if 'historical_data' in stock:
                    symbol = stock.get('symbol', 'UNKNOWN')
                    historical_data = stock['historical_data']
                    
                    # Ensure historical_data is a list
                    if not isinstance(historical_data, list) or len(historical_data) == 0:
                        logger.warning(f"⚠️ Stock {symbol} has no valid historical_data (type: {type(historical_data)}, length: {len(historical_data) if isinstance(historical_data, list) else 'N/A'})")
                        continue
                    
                    logger.info(f"✅ Processing {len(historical_data)} data points for {symbol}")
                    
                    # Normalize each stock's data
                    stock_normalized = []
                    for point in historical_data:
                        if not isinstance(point, dict):
                            continue
                        # Handle date field - can be timestamp (int), date string, or date key
                        time_value = point.get('timestamp')
                        if time_value is None:
                            time_value = point.get('date')
                        if time_value is None:
                            continue  # Skip if no time/date field
                        
                        stock_normalized.append({
                            'time': time_value,  # Keep as-is (will be converted to datetime later)
                            'close': point.get('close', 0),
                            'open': point.get('open', point.get('close', 0)),
                            'high': point.get('high', point.get('close', 0)),
                            'low': point.get('low', point.get('close', 0)),
                            'volume': point.get('volume', 0)
                        })
                    
                    if stock_normalized:
                        normalized_data[symbol] = stock_normalized
                        logger.info(f"✅ Successfully normalized {len(stock_normalized)} points for {symbol}")
                    else:
                        logger.warning(f"⚠️ No valid data points extracted for {symbol}")
                else:
                    # Log why stock was skipped
                    symbol = stock.get('symbol', 'UNKNOWN')
                    status = stock.get('status', 'N/A')
                    has_error = 'error' in stock or 'message' in stock
                    logger.warning(f"⚠️ Skipping stock {symbol}: status={status}, has_historical_data={False}, has_error={has_error}")
            
            logger.info(f"🔍 DEBUG: Successfully normalized {len(normalized_data)} stocks: {list(normalized_data.keys())}")
            
            return normalized_data, data_dict.get('timeframe', 'Custom Range')
            
        elif data_type == 'stock':
            if 'historical_data' in data_dict:
                # Stock data with historical_data (from get_financial_data)
                historical_data = data_dict['historical_data']
                normalized_data = []
                logger.info(f"🔍 DEBUG: Processing {len(historical_data)} historical data points")
                for point in historical_data:
                    normalized_data.append({
                        'time': point.get('date', point.get('timestamp', 0)),  # Try 'date' first since that's what we have
                        'close': point.get('close', 0),
                        'open': point.get('open', point.get('close', 0)),
                        'high': point.get('high', point.get('close', 0)),
                        'low': point.get('low', point.get('close', 0)),
                        'volume': point.get('volume', 0)
                    })
                return normalized_data, data_dict.get('timeframe', 'Custom Range')
            else:
                # Stock data with chart_data (from Lambda function)
                chart_data = data_dict.get('chart_data', [])
                normalized_data = []
                for point in chart_data:
                    normalized_data.append({
                        'time': point.get('time', 0),
                        'close': point.get('close', 0),
                        'open': point.get('open', point.get('close', 0)),
                        'high': point.get('high', point.get('close', 0)),
                        'low': point.get('low', point.get('close', 0)),
                        'volume': point.get('volume', 0)
                    })
                return normalized_data, 'Custom Range'
        
        elif data_type == 'crypto':
            chart_data = data_dict.get('chart_data', [])
            normalized_data = []
            for point in chart_data:
                normalized_data.append({
                    'time': point.get('time', 0),
                    'close': point.get('price', point.get('close', 0)),
                    'open': point.get('price', point.get('close', 0)),  # Crypto often only has close price
                    'high': point.get('price', point.get('close', 0)),
                    'low': point.get('price', point.get('close', 0)),
                    'volume': point.get('volume', 0)
                })
            return normalized_data, data_dict.get('timeframe', 'Custom Range')
        
        return [], 'Unknown'

    def _save_chart_to_s3(self, fig, filename: str, symbol: str, chart_type: str, timeframe: str, data_points: int, asset_type: str) -> str:
        self._validate_env_vars()

        buffer = BytesIO()
        # Reduced DPI from 300 to 150 for faster rendering and smaller file size
        # Still high enough quality for display
        plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight')
        buffer.seek(0)
        plt.close(fig)  # Close the plot to free memory

        # Use unified file upload function
        try:
            from lambda_invocation import upload_file_and_notify
            
            # Get environment variables dynamically for file upload
            bucket_name, user_id, session_id = self._validate_env_vars()
            
            metadata = {
                'generated_by': 'agent',
                'symbol': symbol,
                'chart_type': chart_type,
                'timeframe': timeframe,
                'data_points': str(data_points),
                'asset_type': asset_type
            }
            
            result = upload_file_and_notify(
                content=buffer.getvalue(),
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type='png',
                content_type='image/png',
                folder="agent-files",
                metadata=metadata
            )
            
            logger.info(f"Generated chart: {filename}")
            return result
            
        except ImportError:
            logger.warning("lambda_invocation module not available - falling back to manual upload")
            return "Error: Shared file upload module not available"

    def _add_watermark(self, fig):
        """Add investcosine.com watermark to the chart."""
        fig.text(0.99, 0.01, 'investcosine.com', 
                fontsize=8, color='gray', alpha=0.7,
                ha='right', va='bottom', 
                transform=fig.transFigure)

    def generate_chart(self, symbol: str, data_json: str, chart_type: str = "line", title: str = None, normalize: bool = False) -> str:
        """
        Generate a unified chart that works with both stock and crypto data.
        
        Args:
            symbol: Stock ticker or crypto symbol
            data_json: JSON string containing data from get_financial_data or get_crypto_data_tool
            chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc')
            title: Custom title for the chart (optional)
            normalize: If True and multiple stocks, normalize prices to start at same baseline (default: False)
            
        Returns:
            Success message with file details
        """
        # Get environment variables dynamically
        bucket_name, user_id, session_id = self._validate_env_vars()
        
        try:
            logger.info(f"🔍 DEBUG: Chart generator received data type: {type(data_json)}")
            data_dict = json.loads(data_json)
            logger.info(f"🔍 DEBUG: After JSON parsing, data type: {type(data_dict)}")
            logger.info(f"🔍 DEBUG: After JSON parsing, keys: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'Not a dict'}")
            
            # Check if data contains an S3 key (from get_multiple_financial_data when data is large)
            # get_multiple_financial_data returns: {"status": "success", "s3_key": "...", "stocks_summary": [...]}
            if isinstance(data_dict, dict) and 's3_key' in data_dict:
                # Check if this is a consolidated result from get_multiple_financial_data
                if 'stocks_summary' in data_dict or 'total_symbols' in data_dict:
                    # This is the consolidated result - read the full data from S3
                    s3_key = data_dict['s3_key']
                    logger.info(f"📦 Consolidated data stored in S3, reading from: {s3_key}")
                    try:
                        bucket_name = self._get_bucket_name()
                        s3_response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                        s3_content = s3_response['Body'].read().decode('utf-8')
                        data_dict = json.loads(s3_content)
                        logger.info(f"✅ Successfully read {len(s3_content)} chars from S3")
                    except Exception as s3_error:
                        logger.error(f"❌ Failed to read from S3: {str(s3_error)}")
                        return f"Error: Failed to read data from S3: {str(s3_error)}"
                elif 'stocks' not in data_dict:
                    # This is a single stock result with S3 key - read from S3
                    s3_key = data_dict['s3_key']
                    logger.info(f"📦 Single stock data stored in S3, reading from: {s3_key}")
                    try:
                        bucket_name = self._get_bucket_name()
                        s3_response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                        s3_content = s3_response['Body'].read().decode('utf-8')
                        data_dict = json.loads(s3_content)
                        logger.info(f"✅ Successfully read {len(s3_content)} chars from S3")
                        
                        # Check if symbol suggests multiple stocks but we only have single stock data
                        # Try to find consolidated file if symbol contains "vs" or multiple tickers
                        if ' vs ' in symbol.upper() or ',' in symbol:
                            logger.warning(f"⚠️ Symbol '{symbol}' suggests multiple stocks, but data appears to be single stock")
                            logger.warning(f"⚠️ Attempting to find consolidated file for comparison chart")
                            # Try to find consolidated file in same directory
                            try:
                                # Extract directory from S3 key
                                s3_key_dir = '/'.join(s3_key.split('/')[:-1])
                                # Look for consolidated file pattern: get_multiple_financial_data_*.json
                                import boto3
                                s3_client = boto3.client('s3')
                                prefix = f"{s3_key_dir}/get_multiple_financial_data_"
                                response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix, MaxKeys=10)
                                if 'Contents' in response:
                                    # Find most recent consolidated file
                                    consolidated_files = sorted(
                                        [obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.json')],
                                        key=lambda x: x.split('_')[-1],  # Sort by timestamp in filename
                                        reverse=True
                                    )
                                    if consolidated_files:
                                        consolidated_key = consolidated_files[0]
                                        logger.info(f"📦 Found consolidated file: {consolidated_key}, reading...")
                                        consolidated_response = s3_client.get_object(Bucket=bucket_name, Key=consolidated_key)
                                        consolidated_content = consolidated_response['Body'].read().decode('utf-8')
                                        data_dict = json.loads(consolidated_content)
                                        logger.info(f"✅ Successfully read consolidated data with {len(consolidated_content)} chars from S3")
                            except Exception as consolidated_error:
                                logger.warning(f"⚠️ Could not find consolidated file: {str(consolidated_error)}")
                                logger.warning(f"⚠️ Will proceed with single stock data - chart may not show comparison")
                    except Exception as s3_error:
                        logger.error(f"❌ Failed to read from S3: {str(s3_error)}")
                        return f"Error: Failed to read data from S3: {str(s3_error)}"
            
            # Check if stocks array contains individual S3 keys
            if isinstance(data_dict, dict) and 'stocks' in data_dict:
                # Check if any stock in the stocks array has an s3_key
                stocks = data_dict.get('stocks', [])
                for i, stock in enumerate(stocks):
                    if isinstance(stock, dict) and 's3_key' in stock and 'historical_data' not in stock:
                        # This stock's data is in S3 - read it
                        s3_key = stock['s3_key']
                        logger.info(f"📦 Stock {stock.get('symbol', 'UNKNOWN')} data stored in S3, reading from: {s3_key}")
                        try:
                            bucket_name = self._get_bucket_name()
                            s3_response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                            s3_content = s3_response['Body'].read().decode('utf-8')
                            stock_data = json.loads(s3_content)
                            # Replace the stock entry with the actual data
                            stocks[i] = stock_data
                            logger.info(f"✅ Successfully read stock data from S3")
                        except Exception as s3_error:
                            logger.error(f"❌ Failed to read stock data from S3: {str(s3_error)}")
                            # Continue with other stocks
            
            # Decompress data if it's compressed
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
            from utils.compression_helper import CompressionHelper
            
            # Decompress individual stocks if they are compressed
            if isinstance(data_dict, dict) and 'stocks' in data_dict:
                stocks = data_dict.get('stocks', [])
                decompressed_stocks = []
                for stock in stocks:
                    if isinstance(stock, dict) and stock.get("_compressed") is True:
                        logger.info(f"🔍 DEBUG: Decompressing stock: {stock.get('symbol', 'UNKNOWN')}")
                        try:
                            decompressed_stock = CompressionHelper.decompress_data(stock)
                            # Remove original_data if present
                            if isinstance(decompressed_stock, dict) and 'original_data' in decompressed_stock:
                                decompressed_stock.pop('original_data', None)
                            decompressed_stocks.append(decompressed_stock)
                            logger.info(f"✅ Successfully decompressed stock: {stock.get('symbol', 'UNKNOWN')}")
                        except Exception as e:
                            logger.warning(f"⚠️ Failed to decompress stock, using original_data fallback: {str(e)}")
                            # Try to use original_data if available
                            if isinstance(stock, dict) and 'original_data' in stock:
                                decompressed_stocks.append(stock['original_data'])
                            else:
                                # If decompression fails and no original_data, keep the stock as-is
                                decompressed_stocks.append(stock)
                    else:
                        # Stock is not compressed, add it as-is
                        decompressed_stocks.append(stock)
                # Update the stocks array with decompressed stocks
                data_dict['stocks'] = decompressed_stocks
                logger.info(f"🔍 DEBUG: Decompressed {len(decompressed_stocks)} stocks in the array")
            
            # Check if the entire response is compressed (new approach)
            if isinstance(data_dict, dict) and data_dict.get("_compressed") is True:
                # Entire response is compressed - decompress it
                logger.info("🔍 DEBUG: Decompressing entire data object")
                logger.info(f"🔍 DEBUG: Compressed data structure: {list(data_dict.keys())}")
                logger.info(f"🔍 DEBUG: Compressed data size: {data_dict.get('_compressed_size', 'unknown')}")
                logger.info(f"🔍 DEBUG: Original data size: {data_dict.get('_original_size', 'unknown')}")
                
                # Check the base64 data before decompression
                compressed_data = data_dict.get('data', '')
                logger.info(f"🔍 DEBUG: Base64 data length: {len(compressed_data)}")
                logger.info(f"🔍 DEBUG: Base64 data preview: {compressed_data[:100]}...")
                
                try:
                    data_dict = CompressionHelper.decompress_data(data_dict)
                    logger.info(f"🔍 DEBUG: After decompression, keys: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'Not a dict'}")
                    logger.info(f"🔍 DEBUG: After decompression, has historical_data: {'historical_data' in data_dict if isinstance(data_dict, dict) else False}")
                except Exception as decompress_error:
                    logger.error(f"❌ Failed to decompress data: {str(decompress_error)}")
                    logger.error("🔄 Attempting to use original data without compression...")
                    
                    # Try to extract the original data if available
                    if 'original_data' in data_dict:
                        logger.info("📦 Using original_data field as fallback")
                        data_dict = data_dict['original_data']
                        logger.info(f"🔍 DEBUG: Fallback data keys: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'Not a dict'}")
                    else:
                        logger.error("❌ No fallback data available, returning error")
                        return f"Error: Unable to decompress data. The compressed data appears to be corrupted. Please try again."
            elif isinstance(data_dict, dict) and 'historical_data' in data_dict:
                # Legacy: Only historical_data is compressed, decompress it
                hist_data = data_dict['historical_data']
                if isinstance(hist_data, dict) and hist_data.get("_compressed") is True:
                    logger.info("🔍 DEBUG: Decompressing historical_data field only")
                    data_dict['historical_data'] = CompressionHelper.decompress_data(hist_data)
            elif isinstance(data_dict, dict) and 'chart_data' in data_dict:
                # Legacy: Only chart_data is compressed, decompress it
                chart_data = data_dict['chart_data']
                if isinstance(chart_data, dict) and chart_data.get("_compressed") is True:
                    logger.info("🔍 DEBUG: Decompressing chart_data field only")
                    data_dict['chart_data'] = CompressionHelper.decompress_data(chart_data)
            
            # Debug logging to see data structure
            logger.info(f"Data structure after decompression: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'Not a dict'}")
            logger.info(f"Data type: {type(data_dict)}")
            if isinstance(data_dict, dict):
                logger.info(f"Has 'historical_data' key: {'historical_data' in data_dict}")
                logger.info(f"Full data structure: {data_dict}")
                if 'historical_data' in data_dict:
                    hist_data = data_dict['historical_data']
                    logger.info(f"Historical data type: {type(hist_data)}")
                    if isinstance(hist_data, list) and len(hist_data) > 0:
                        logger.info(f"First historical data point: {hist_data[0]}")
                else:
                    logger.error(f"Missing 'historical_data' key! Available keys: {list(data_dict.keys())}")
            
            # Detect data type
            data_type = self._detect_data_type(data_dict)
            logger.info(f"Detected data type: {data_type} for symbol: {symbol}")
            
            # If symbol suggests multiple stocks but we detected single stock, try to find consolidated file
            # Skip this check if we already have multiple_stocks data type to avoid unnecessary S3 calls
            if data_type == 'stock' and (' vs ' in symbol.upper() or ',' in symbol or normalize):
                logger.warning(f"⚠️ Symbol '{symbol}' suggests multiple stocks or normalization requested, but data appears to be single stock")
                logger.warning(f"⚠️ Attempting to find consolidated file for comparison chart")
                # Try to find consolidated file in same directory (if we have an S3 key context)
                # Use quick lookup with timeout protection
                try:
                    # Extract user_id and session_id from environment
                    user_id = os.environ.get('USER_ID')
                    session_id = os.environ.get('SESSION_ID')
                    if user_id and session_id:
                        bucket_name = self._get_bucket_name()
                        # Look for consolidated file in the data-files directory
                        prefix = f"users/{user_id}/sessions/{session_id}/data-files/get_multiple_financial_data_"
                        import boto3
                        s3_client = boto3.client('s3')
                        # Limit to 5 results for faster lookup
                        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix, MaxKeys=5)
                        if 'Contents' in response and len(response['Contents']) > 0:
                            # Find most recent consolidated file (use LastModified for faster sorting)
                            consolidated_files = [
                                obj['Key'] for obj in response['Contents'] 
                                if obj['Key'].endswith('.json')
                            ]
                            if consolidated_files:
                                # Sort by LastModified (faster than parsing filename)
                                consolidated_files.sort(key=lambda k: next(
                                    (obj['LastModified'] for obj in response['Contents'] if obj['Key'] == k),
                                    None
                                ), reverse=True)
                                consolidated_key = consolidated_files[0]
                                logger.info(f"📦 Found consolidated file: {consolidated_key}, reading...")
                                consolidated_response = s3_client.get_object(Bucket=bucket_name, Key=consolidated_key)
                                consolidated_content = consolidated_response['Body'].read().decode('utf-8')
                                data_dict = json.loads(consolidated_content)
                                logger.info(f"✅ Successfully read consolidated data with {len(consolidated_content)} chars from S3")
                                # Re-detect data type with consolidated data
                                data_type = self._detect_data_type(data_dict)
                                logger.info(f"✅ Re-detected data type: {data_type} after reading consolidated file")
                except Exception as consolidated_error:
                    logger.warning(f"⚠️ Could not find consolidated file: {str(consolidated_error)}")
                    if normalize:
                        logger.warning(f"⚠️ Normalization requested but only single stock data available - normalization will be skipped")
            
            if data_type == 'unknown':
                logger.error(f"❌ Chart Generation Failed: Data type unknown for {symbol}")
                logger.error(f"❌ Available keys: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'Not a dict'}")
                logger.error(f"❌ Expected: 'historical_data' key for stocks or 'chart_data' key for crypto")
                
                # Check if this looks like incomplete stock data
                if isinstance(data_dict, dict) and 'data_points' in data_dict and 'symbol' in data_dict and 'current_price' in data_dict:
                    logger.error(f"❌ This appears to be incomplete stock data - missing 'historical_data' field")
                    return f"Error: You passed incomplete data for {symbol}. The data contains metadata (current_price, data_points, etc.) but is missing the 'historical_data' field needed for chart generation. Please call get_financial_data('{symbol}', '{data_dict.get('timeframe', '2y')}') again and pass the COMPLETE result to generate_chart_tool."
                else:
                    return f"Error: Unable to detect data type for {symbol}. Please ensure you call get_financial_data(symbol, timeframe) first to fetch the data, then pass the COMPLETE result to generate_chart_tool. The data must contain 'historical_data' for stocks or 'chart_data' for crypto."
            
            # If we get here, data_type is valid (stock, crypto, or multiple_stocks)
            logger.info(f"✅ Data type validated: {data_type} for {symbol}")
            
            # Check for errors
            if "error" in data_dict:
                return f"Error: {data_dict['error']}"
            
            # Normalize data
            normalized_data, timeframe = self._normalize_data(data_dict, data_type)
            
            if not normalized_data:
                return f"Error: No chart data found for {symbol}"
            
            # Create figure with professional styling
            # Reduced size for faster rendering (12x7 instead of 14x8)
            fig, ax = plt.subplots(figsize=(12, 7), dpi=100)  # Lower DPI for faster rendering
            
            # Set professional background colors
            fig.patch.set_facecolor('#F0F2F5')
            ax.set_facecolor('#F0F2F5')
            
            # Log total data points being processed
            total_data_points = sum(len(data) for data in normalized_data.values()) if isinstance(normalized_data, dict) else len(normalized_data)
            logger.info(f"🔍 DEBUG: Chart maker processing {total_data_points} total data points")
            
            # Sample data if too many points to speed up chart generation (max 500 points per stock)
            # This prevents Bedrock timeouts by reducing computation time
            MAX_POINTS_PER_STOCK = 500
            if isinstance(normalized_data, dict):
                for stock_symbol, stock_data in list(normalized_data.items()):
                    if len(stock_data) > MAX_POINTS_PER_STOCK:
                        # Sample evenly to reduce to MAX_POINTS_PER_STOCK
                        step = len(stock_data) / MAX_POINTS_PER_STOCK
                        sampled_data = [stock_data[int(i * step)] for i in range(MAX_POINTS_PER_STOCK)]
                        normalized_data[stock_symbol] = sampled_data
                        logger.info(f"📊 Sampled {stock_symbol} from {len(stock_data)} to {len(sampled_data)} points for faster rendering")
            elif isinstance(normalized_data, list) and len(normalized_data) > MAX_POINTS_PER_STOCK:
                step = len(normalized_data) / MAX_POINTS_PER_STOCK
                normalized_data = [normalized_data[int(i * step)] for i in range(MAX_POINTS_PER_STOCK)]
                logger.info(f"📊 Sampled data from {len(normalized_data)} to {MAX_POINTS_PER_STOCK} points for faster rendering")
            
            # Handle different data types
            if data_type == 'multiple_stocks':
                # Handle multiple stocks comparison
                colors = ['#F06292', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
                
                logger.info(f"🔍 DEBUG: Plotting {len(normalized_data)} stocks: {list(normalized_data.keys())}")
                
                # First, convert all data to DataFrames and find common date range
                stock_dataframes = {}
                for stock_symbol, stock_data in normalized_data.items():
                    if not stock_data:
                        continue
                    df = pd.DataFrame(stock_data)
                    # Convert time to datetime
                    try:
                        if pd.api.types.is_numeric_dtype(df['time']):
                            df['time'] = pd.to_datetime(df['time'], unit='s')
                        else:
                            df['time'] = pd.to_datetime(df['time'])
                    except Exception as e:
                        logger.warning(f"⚠️ Error converting time for {stock_symbol}: {str(e)}")
                        df['time'] = pd.to_datetime(df['time'], errors='coerce')
                    df = df.sort_values('time')
                    df = df.dropna(subset=['time', 'close'])
                    if len(df) > 0:
                        stock_dataframes[stock_symbol] = df
                
                # Find common date range (intersection of all stocks' date ranges)
                if len(stock_dataframes) > 0:
                    common_start = max([df['time'].min() for df in stock_dataframes.values()])
                    common_end = min([df['time'].max() for df in stock_dataframes.values()])
                    logger.info(f"🔍 DEBUG: Common date range: {common_start} to {common_end}")
                    
                    # Filter all stocks to common date range
                    for stock_symbol in stock_dataframes.keys():
                        df = stock_dataframes[stock_symbol]
                        stock_dataframes[stock_symbol] = df[(df['time'] >= common_start) & (df['time'] <= common_end)]
                        logger.info(f"🔍 DEBUG: Filtered {stock_symbol} to {len(stock_dataframes[stock_symbol])} points in common range")
                
                # If normalization is requested, calculate baseline prices from common date range
                baseline_prices = {}
                if normalize:
                    for stock_symbol, df in stock_dataframes.items():
                        if len(df) > 0:
                            # Get the first price in the common date range
                            first_price = df.iloc[0]['close']
                            if first_price > 0 and not (isinstance(first_price, float) and first_price != first_price):
                                baseline_prices[stock_symbol] = first_price
                                logger.info(f"🔍 DEBUG: Baseline for {stock_symbol} (common range): ${first_price:.2f}")
                    logger.info(f"🔍 DEBUG: Normalization enabled. Baseline prices: {baseline_prices}")
                
                plotted_count = 0
                plotted_dataframes = {}  # Store DataFrames after normalization for y-axis scaling
                for i, stock_symbol in enumerate(stock_dataframes.keys()):
                    df = stock_dataframes[stock_symbol].copy()
                    
                    if len(df) == 0:
                        logger.warning(f"⚠️ No data points for {stock_symbol} after filtering to common range")
                        continue
                    
                    logger.info(f"🔍 DEBUG: Processing {len(df)} data points for {stock_symbol} (filtered to common range)")
                    
                    # Set time as index
                    df.set_index('time', inplace=True)
                    
                    # Verify we have valid data
                    if df['close'].isna().all() or (df['close'] == 0).all():
                        logger.warning(f"⚠️ No valid data points for {stock_symbol}")
                        continue
                    
                    # Apply normalization if requested
                    if normalize and stock_symbol in baseline_prices:
                        baseline = baseline_prices[stock_symbol]
                        if baseline > 0:
                            # Normalize: multiply all prices by (100 / baseline) so they start at 100
                            df['close'] = df['close'] * (100.0 / baseline)
                            logger.info(f"🔍 DEBUG: Normalized {stock_symbol} prices (baseline: ${baseline:.2f})")
                    
                    # Store DataFrame for y-axis scaling (after normalization)
                    plotted_dataframes[stock_symbol] = df
                    
                    # Plot line for this stock with professional styling
                    color = colors[i % len(colors)]
                    ax.plot(df.index, df['close'], linewidth=3, color=color, alpha=0.9, label=stock_symbol)
                    plotted_count += 1
                    logger.info(f"✅ Plotted line {plotted_count} for {stock_symbol} with {len(df)} data points")
                
                logger.info(f"🔍 DEBUG: Successfully plotted {plotted_count} stocks out of {len(normalized_data)} total stocks")
                
                # Set title for multiple stocks
                if not title:
                    stock_symbols = list(normalized_data.keys())
                    if normalize:
                        title = f"Normalized Stock Comparison ({timeframe}) - {', '.join(stock_symbols)}"
                    else:
                        title = f"Stock Comparison Chart ({timeframe}) - {', '.join(stock_symbols)}"
                ax.set_title(title, fontsize=18, fontweight='bold', pad=20)
                
                # Update y-axis label for normalized charts
                if normalize:
                    ax.set_ylabel('Normalized Price (Index: 100)', fontsize=12, fontweight='bold')
                
                ax.legend()
            else:
                # Handle single stock/crypto
                logger.info(f"🔍 DEBUG: Processing {len(normalized_data)} data points for single {data_type}")
                
                # Convert to DataFrame
                df = pd.DataFrame(normalized_data)
                
                # Convert time to datetime
                if df['time'].dtype == 'int64':
                    df['time'] = pd.to_datetime(df['time'], unit='s')
                else:
                    df['time'] = pd.to_datetime(df['time'])
                
                # Debug logging to check data
                logger.info(f"🔍 DEBUG: DataFrame shape: {df.shape}")
                logger.info(f"🔍 DEBUG: Final data points in chart: {len(df)}")
                logger.info(f"🔍 DEBUG: Date range: {df.index.min()} to {df.index.max()}")
                logger.info(f"🔍 DEBUG: Price range: {df['close'].min():.2f} to {df['close'].max():.2f}")
                logger.info(f"🔍 DEBUG: First few rows:")
                logger.info(f"🔍 DEBUG: {df.head()}")
                
                df.set_index('time', inplace=True)
                
                # Set title
                if not title:
                    asset_name = data_dict.get('name', symbol)
                    title = f"{asset_name} Price Chart ({timeframe})"
                ax.set_title(title, fontsize=18, fontweight='bold', pad=20)
                
                # Generate chart based on type
                if chart_type == "line":
                    # Professional line chart styling
                    line_color = '#F06292'  # Pink color like the 7Y chart
                    ax.plot(df.index, df['close'], linewidth=3, color=line_color, alpha=0.9, label=f'{symbol} Price')
                    ax.fill_between(df.index, df['close'], alpha=0.1, color=line_color)
                elif chart_type == "candlestick":
                    # Create candlestick chart
                    for i, (date, row) in enumerate(df.iterrows()):
                        color = 'green' if row['close'] >= row['open'] else 'red'
                        # Body
                        body_height = abs(row['close'] - row['open'])
                        body_bottom = min(row['open'], row['close'])
                        ax.bar(date, body_height, bottom=body_bottom, 
                              color=color, alpha=0.7, width=0.8)
                        # Wicks
                        ax.plot([date, date], [row['low'], row['high']], 
                               color='black', linewidth=0.5)
                        # Open/Close ticks
                        ax.plot([date - pd.Timedelta(hours=2), date], [row['open'], row['open']], 
                               color='black', linewidth=1)
                        ax.plot([date, date + pd.Timedelta(hours=2)], [row['close'], row['close']], 
                               color='black', linewidth=1)
                                
                elif chart_type == "volume":
                    if 'volume' in df.columns and df['volume'].sum() > 0:
                        ax.bar(df.index, df['volume'], color='lightblue', alpha=0.7)
                        ax.set_ylabel('Volume')
                    else:
                        ax.text(0.5, 0.5, "Volume data not available for this asset/timeframe.", 
                               horizontalalignment='center', verticalalignment='center', 
                               transform=ax.transAxes, fontsize=12, color='gray')
                        ax.set_ylabel('Volume (N/A)')
                            
                elif chart_type == "ohlc":
                    # OHLC chart (simplified candlestick)
                    for i, (date, row) in enumerate(df.iterrows()):
                        # High-Low line
                        ax.plot([date, date], [row['low'], row['high']], 
                               color='black', linewidth=1)
                        # Open-Close line
                        ax.plot([date, date], [row['open'], row['close']], 
                               color='blue', linewidth=3)
            
            # Set professional labels and formatting
            ax.set_xlabel('Date', fontsize=12, fontweight='bold')
            ax.set_ylabel('Price ($)', fontsize=12, fontweight='bold')
            
            # Professional grid styling
            ax.grid(True, alpha=0.3, linestyle='-', linewidth=0.5)
            ax.set_axisbelow(True)
            
            # Format x-axis with better date labels based on data range
            if len(df) > 0:
                date_range = (df.index.max() - df.index.min()).days
                
                # Use daily ticks for 1y data (252 trading days), weekly for longer periods
                if date_range <= 400:  # ~1 year or less
                    # For 1y data, show labels every ~10 trading days to avoid clutter
                    # But all data points are still plotted
                    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
                    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=10))  # Every ~2 weeks
                    ax.xaxis.set_minor_locator(mdates.WeekdayLocator(interval=1))  # Minor ticks for every weekday
                elif date_range <= 800:  # ~2 years
                    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
                    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=5))  # Every week
                else:  # Longer periods
                    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
                    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
            else:
                # Fallback to default
                ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
                ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
            
            plt.xticks(rotation=45, fontsize=10)
            plt.yticks(fontsize=10)
            
            # Scale y-axis based on data: start at minimum value, end at 10% above max
            # Collect all price values from the plotted data (AFTER normalization if enabled)
            all_prices = []
            if data_type == 'multiple_stocks':
                # For multiple stocks, collect prices from plotted DataFrames (already normalized if normalize=True)
                if 'plotted_dataframes' in locals() and plotted_dataframes:
                    # Use DataFrames that were already normalized and plotted
                    for stock_symbol, df_stock in plotted_dataframes.items():
                        if 'close' in df_stock.columns:
                            all_prices.extend(df_stock['close'].tolist())
                else:
                    # Fallback: collect from original normalized_data (for non-normalized charts)
                    for stock_symbol, stock_data in normalized_data.items():
                        if stock_data:
                            df_stock = pd.DataFrame(stock_data)
                            if 'close' in df_stock.columns:
                                all_prices.extend(df_stock['close'].tolist())
            else:
                # For single stock, use the df we already have (already normalized if normalize was enabled)
                if 'close' in df.columns:
                    all_prices = df['close'].tolist()
            
            if all_prices and len(all_prices) > 0:
                # Filter out invalid prices (NaN, None, 0, negative)
                valid_prices = [p for p in all_prices if p is not None and not (isinstance(p, float) and (p != p or p <= 0))]
                if valid_prices:
                    min_price = min(valid_prices)
                    max_price = max(valid_prices)
                    # Set y-axis: start at minimum value, end at 10% above max
                    # Handle edge case where min and max are the same
                    if min_price == max_price:
                        # If all prices are the same, add some padding
                        y_min = min_price * 0.99
                        y_max = max_price * 1.01
                    else:
                        y_min = min_price
                        y_max = max_price * 1.1
                    ax.set_ylim(y_min, y_max)
                    logger.info(f"📊 Y-axis scaled: {y_min:.2f} to {y_max:.2f} (data range: {min_price:.2f} to {max_price:.2f})")
                else:
                    logger.warning(f"⚠️ No valid prices found for y-axis scaling")
            
            # Add legend for single stock charts
            if data_type != 'multiple_stocks':
                ax.legend(loc='upper left', fontsize=11, framealpha=0.9)
            
            # Add watermark
            fig.text(0.99, 0.01, 'investcosine.com', fontsize=10, color='gray', 
                    ha='right', va='bottom', alpha=0.7, transform=fig.transFigure)
            
            plt.tight_layout()
            
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            if data_type == 'multiple_stocks':
                stock_symbols = '_'.join(normalized_data.keys())
                filename = f"comparison_{stock_symbols}_{chart_type}_chart_{timestamp}.png"
            else:
                filename = f"{symbol}_{chart_type}_chart_{timestamp}.png"
            
            logger.info(f"📊 Chart figure created successfully, saving to S3: {filename}")
            
            try:
                result = self._save_chart_to_s3(
                    fig, filename, symbol, chart_type, 
                    timeframe, len(normalized_data), data_type
                )
                logger.info(f"📊 Chart save result: {result}")
                return result
            except Exception as save_error:
                logger.error(f"❌ Error in _save_chart_to_s3: {str(save_error)}")
                import traceback
                logger.error(f"❌ Save traceback: {traceback.format_exc()}")
                # Make sure to close the figure even if save fails
                try:
                    plt.close(fig)
                except:
                    pass
                return f"Error saving chart: {str(save_error)}"
            
        except Exception as e:
            logger.error(f"Error generating chart for {symbol}: {str(e)}")
            return f"❌ Error generating chart: {str(e)}"

# Global instance
chart_generator = UnifiedChartGenerator()

@tool
def generate_chart_tool(symbol: str, data_json: str = None, s3_key: str = None, chart_type: str = "line", title: str = None, normalize: bool = False) -> str:
    """
    Generate a unified chart that works with both stock and cryptocurrency data.
    Automatically detects data type and generates appropriate charts.
    
    Args:
        symbol: Stock ticker or cryptocurrency symbol (or comparison name like "SNAP vs SPY")
        data_json: JSON string containing data from get_financial_data or get_multiple_financial_data (optional if s3_key provided)
        s3_key: S3 key to read data from (optional, use this for large datasets to avoid passing data in tool arguments)
        chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc') - defaults to 'line'
        title: Custom title for the chart (optional)
        normalize: If True and multiple stocks are provided, normalize prices to start at same baseline (100) for comparison - defaults to False
    
    Returns:
        Success message with file details
    
    Note:
        - For large datasets, use s3_key parameter instead of data_json to avoid timeouts
        - If get_multiple_financial_data returns an s3_key, pass it directly: generate_chart_tool(symbol, s3_key="users/.../data-files/...")
        - For comparison charts with multiple stocks, pass the COMPLETE result from get_multiple_financial_data
        - Set normalize=True to show relative performance starting from the same baseline
        - The tool automatically detects multiple stocks and creates a single comparison chart
    """
    try:
        agent_logger.info(f"Generating {chart_type} chart for {symbol} (normalize={normalize})")
        
        # If s3_key is provided, read data from S3 instead of using data_json
        if s3_key:
            logger.info(f"📦 Reading chart data from S3: {s3_key}")
            try:
                bucket_name = chart_generator._get_bucket_name()
                s3_response = chart_generator.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                s3_content = s3_response['Body'].read().decode('utf-8')
                data_json = s3_content
                logger.info(f"✅ Successfully read {len(s3_content)} chars from S3")
                
                # Check if symbol suggests multiple stocks but S3 key points to single stock file
                # If so, try to find consolidated file (with timeout protection)
                if (' vs ' in symbol.upper() or ',' in symbol or normalize) and 'get_multiple_financial_data_' not in s3_key:
                    logger.warning(f"⚠️ Symbol '{symbol}' suggests multiple stocks, but S3 key points to single stock file")
                    logger.warning(f"⚠️ Attempting to find consolidated file for comparison chart")
                    try:
                        # Extract directory from S3 key
                        s3_key_dir = '/'.join(s3_key.split('/')[:-1])
                        # Look for consolidated file pattern: get_multiple_financial_data_*.json
                        # Use a quick lookup with limited results to avoid timeout
                        prefix = f"{s3_key_dir}/get_multiple_financial_data_"
                        response = chart_generator.s3_client.list_objects_v2(
                            Bucket=bucket_name, 
                            Prefix=prefix, 
                            MaxKeys=5  # Limit to 5 to speed up lookup
                        )
                        if 'Contents' in response and len(response['Contents']) > 0:
                            # Find most recent consolidated file (simplified sorting)
                            consolidated_files = [
                                obj['Key'] for obj in response['Contents'] 
                                if obj['Key'].endswith('.json')
                            ]
                            if consolidated_files:
                                # Sort by LastModified (faster than parsing filename)
                                consolidated_files.sort(key=lambda k: next(
                                    (obj['LastModified'] for obj in response['Contents'] if obj['Key'] == k),
                                    None
                                ), reverse=True)
                                consolidated_key = consolidated_files[0]
                                logger.info(f"📦 Found consolidated file: {consolidated_key}, reading...")
                                consolidated_response = chart_generator.s3_client.get_object(Bucket=bucket_name, Key=consolidated_key)
                                consolidated_content = consolidated_response['Body'].read().decode('utf-8')
                                data_json = consolidated_content
                                logger.info(f"✅ Successfully read consolidated data with {len(consolidated_content)} chars from S3")
                    except Exception as consolidated_error:
                        logger.warning(f"⚠️ Could not find consolidated file: {str(consolidated_error)}")
                        logger.warning(f"⚠️ Will proceed with single stock data - chart may not show comparison")
            except Exception as s3_error:
                logger.error(f"❌ Failed to read from S3: {str(s3_error)}")
                return f"Error: Failed to read data from S3: {str(s3_error)}"
        elif not data_json:
            return "Error: Either data_json or s3_key must be provided"
        
        # Debug logging to see what data is being passed
        logger.info(f"🔍 DEBUG: generate_chart_tool called with symbol={symbol}, chart_type={chart_type}, normalize={normalize}")
        logger.info(f"🔍 DEBUG: data_json length: {len(data_json)} characters")
        logger.info(f"🔍 DEBUG: data_json preview: {data_json[:200]}...")
        
        # Generate chart with timeout protection (20 seconds max to avoid Bedrock timeout)
        # Use ThreadPoolExecutor to enforce timeout
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    chart_generator.generate_chart,
                    symbol, data_json, chart_type, title, normalize
                )
                # Wait max 20 seconds for chart generation (reduced from 30 to prevent Bedrock timeout)
                result = future.result(timeout=20.0)
                return result
        except FutureTimeoutError:
            logger.warning(f"⚠️ Chart generation timed out after 20 seconds for {symbol}")
            return f"⚠️ Chart generation timed out. For large datasets, try reducing the timeframe or the chart will be generated in the background."
        except Exception as e:
            logger.error(f"Error in chart generation thread: {str(e)}")
            return f"❌ Error generating chart: {str(e)}"
    except Exception as e:
        logger.error(f"Error generating chart for {symbol}: {str(e)}")
        return f"❌ Error generating chart: {str(e)}"

@tool
def generate_stock_chart(symbol: str, timeframe: str = "1y", chart_type: str = "line", title: str = None, start_date: str = None, end_date: str = None) -> str:
    """
    Convenience tool to generate a stock chart by fetching data and creating the chart in one step.
    This is a simplified wrapper that handles data fetching internally.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT')
        timeframe: Time period for the chart ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max') - defaults to '1y'
        chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc') - defaults to 'line'
        title: Custom title for the chart (optional)
        start_date: Start date in 'YYYY-MM-DD' format (optional, overrides timeframe if provided)
        end_date: End date in 'YYYY-MM-DD' format (optional)
    
    Returns:
        Success message with file details
    
    Example:
        generate_stock_chart("AAPL", "1y", "candlestick")
        generate_stock_chart("MSFT", "6mo", "line", "Microsoft Stock Price")
    """
    try:
        agent_logger.info(f"Generating {chart_type} chart for {symbol} (timeframe: {timeframe})")
        logger.info(f"🔍 DEBUG: generate_stock_chart called with symbol={symbol}, timeframe={timeframe}, chart_type={chart_type}")
        
        # Import FinancialTools to fetch data
        import sys
        import os
        sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
        try:
            from agent import FinancialTools
        except ImportError:
            # Fallback: try importing from parent directory
            parent_dir = os.path.dirname(os.path.dirname(__file__))
            sys.path.append(parent_dir)
            from agent import FinancialTools
        
        # Fetch stock data
        logger.info(f"📊 Fetching stock data for {symbol}...")
        stock_data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
        
        # Convert to JSON string (matching the format expected by generate_chart_tool)
        import json
        data_json = json.dumps(stock_data)
        
        logger.info(f"✅ Data fetched successfully, generating chart...")
        
        # Generate chart using the existing method
        return chart_generator.generate_chart(symbol, data_json, chart_type, title)
        
    except Exception as e:
        logger.error(f"Error generating stock chart for {symbol}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"❌ Error generating stock chart: {str(e)}"
            if all_prices and len(all_prices) > 0:
                # Filter out invalid prices (NaN, None, 0, negative)
                valid_prices = [p for p in all_prices if p is not None and not (isinstance(p, float) and (p != p or p <= 0))]
                if valid_prices:
                    min_price = min(valid_prices)
                    max_price = max(valid_prices)
                    # Set y-axis: start at minimum value, end at 10% above max
                    # Handle edge case where min and max are the same
                    if min_price == max_price:
                        # If all prices are the same, add some padding
                        y_min = min_price * 0.99
                        y_max = max_price * 1.01
                    else:
                        y_min = min_price
                        y_max = max_price * 1.1
                    ax.set_ylim(y_min, y_max)
                    logger.info(f"📊 Y-axis scaled: {y_min:.2f} to {y_max:.2f} (data range: {min_price:.2f} to {max_price:.2f})")
                else:
                    logger.warning(f"⚠️ No valid prices found for y-axis scaling")
            
            # Add legend for single stock charts
            if data_type != 'multiple_stocks':
                ax.legend(loc='upper left', fontsize=11, framealpha=0.9)
            
            # Add watermark
            fig.text(0.99, 0.01, 'investcosine.com', fontsize=10, color='gray', 
                    ha='right', va='bottom', alpha=0.7, transform=fig.transFigure)
            
            plt.tight_layout()
            
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            if data_type == 'multiple_stocks':
                stock_symbols = '_'.join(normalized_data.keys())
                filename = f"comparison_{stock_symbols}_{chart_type}_chart_{timestamp}.png"
            else:
                filename = f"{symbol}_{chart_type}_chart_{timestamp}.png"
            
            logger.info(f"📊 Chart figure created successfully, saving to S3: {filename}")
            
            try:
                result = self._save_chart_to_s3(
                    fig, filename, symbol, chart_type, 
                    timeframe, len(normalized_data), data_type
                )
                logger.info(f"📊 Chart save result: {result}")
                return result
            except Exception as save_error:
                logger.error(f"❌ Error in _save_chart_to_s3: {str(save_error)}")
                import traceback
                logger.error(f"❌ Save traceback: {traceback.format_exc()}")
                # Make sure to close the figure even if save fails
                try:
                    plt.close(fig)
                except:
                    pass
                return f"Error saving chart: {str(save_error)}"
            
        except Exception as e:
            logger.error(f"Error generating chart for {symbol}: {str(e)}")
            return f"❌ Error generating chart: {str(e)}"

# Global instance
chart_generator = UnifiedChartGenerator()

@tool
def generate_chart_tool(symbol: str, data_json: str = None, s3_key: str = None, chart_type: str = "line", title: str = None, normalize: bool = False) -> str:
    """
    Generate a unified chart that works with both stock and cryptocurrency data.
    Automatically detects data type and generates appropriate charts.
    
    Args:
        symbol: Stock ticker or cryptocurrency symbol (or comparison name like "SNAP vs SPY")
        data_json: JSON string containing data from get_financial_data or get_multiple_financial_data (optional if s3_key provided)
        s3_key: S3 key to read data from (optional, use this for large datasets to avoid passing data in tool arguments)
        chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc') - defaults to 'line'
        title: Custom title for the chart (optional)
        normalize: If True and multiple stocks are provided, normalize prices to start at same baseline (100) for comparison - defaults to False
    
    Returns:
        Success message with file details
    
    Note:
        - For large datasets, use s3_key parameter instead of data_json to avoid timeouts
        - If get_multiple_financial_data returns an s3_key, pass it directly: generate_chart_tool(symbol, s3_key="users/.../data-files/...")
        - For comparison charts with multiple stocks, pass the COMPLETE result from get_multiple_financial_data
        - Set normalize=True to show relative performance starting from the same baseline
        - The tool automatically detects multiple stocks and creates a single comparison chart
    """
    try:
        agent_logger.info(f"Generating {chart_type} chart for {symbol} (normalize={normalize})")
        
        # If s3_key is provided, read data from S3 instead of using data_json
        if s3_key:
            logger.info(f"📦 Reading chart data from S3: {s3_key}")
            try:
                bucket_name = chart_generator._get_bucket_name()
                s3_response = chart_generator.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                s3_content = s3_response['Body'].read().decode('utf-8')
                data_json = s3_content
                logger.info(f"✅ Successfully read {len(s3_content)} chars from S3")
                
                # Check if symbol suggests multiple stocks but S3 key points to single stock file
                # If so, try to find consolidated file (with timeout protection)
                if (' vs ' in symbol.upper() or ',' in symbol or normalize) and 'get_multiple_financial_data_' not in s3_key:
                    logger.warning(f"⚠️ Symbol '{symbol}' suggests multiple stocks, but S3 key points to single stock file")
                    logger.warning(f"⚠️ Attempting to find consolidated file for comparison chart")
                    try:
                        # Extract directory from S3 key
                        s3_key_dir = '/'.join(s3_key.split('/')[:-1])
                        # Look for consolidated file pattern: get_multiple_financial_data_*.json
                        # Use a quick lookup with limited results to avoid timeout
                        prefix = f"{s3_key_dir}/get_multiple_financial_data_"
                        response = chart_generator.s3_client.list_objects_v2(
                            Bucket=bucket_name, 
                            Prefix=prefix, 
                            MaxKeys=5  # Limit to 5 to speed up lookup
                        )
                        if 'Contents' in response and len(response['Contents']) > 0:
                            # Find most recent consolidated file (simplified sorting)
                            consolidated_files = [
                                obj['Key'] for obj in response['Contents'] 
                                if obj['Key'].endswith('.json')
                            ]
                            if consolidated_files:
                                # Sort by LastModified (faster than parsing filename)
                                consolidated_files.sort(key=lambda k: next(
                                    (obj['LastModified'] for obj in response['Contents'] if obj['Key'] == k),
                                    None
                                ), reverse=True)
                                consolidated_key = consolidated_files[0]
                                logger.info(f"📦 Found consolidated file: {consolidated_key}, reading...")
                                consolidated_response = chart_generator.s3_client.get_object(Bucket=bucket_name, Key=consolidated_key)
                                consolidated_content = consolidated_response['Body'].read().decode('utf-8')
                                data_json = consolidated_content
                                logger.info(f"✅ Successfully read consolidated data with {len(consolidated_content)} chars from S3")
                    except Exception as consolidated_error:
                        logger.warning(f"⚠️ Could not find consolidated file: {str(consolidated_error)}")
                        logger.warning(f"⚠️ Will proceed with single stock data - chart may not show comparison")
            except Exception as s3_error:
                logger.error(f"❌ Failed to read from S3: {str(s3_error)}")
                return f"Error: Failed to read data from S3: {str(s3_error)}"
        elif not data_json:
            return "Error: Either data_json or s3_key must be provided"
        
        # Debug logging to see what data is being passed
        logger.info(f"🔍 DEBUG: generate_chart_tool called with symbol={symbol}, chart_type={chart_type}, normalize={normalize}")
        logger.info(f"🔍 DEBUG: data_json length: {len(data_json)} characters")
        logger.info(f"🔍 DEBUG: data_json preview: {data_json[:200]}...")
        
        # Generate chart with timeout protection (20 seconds max to avoid Bedrock timeout)
        # Use ThreadPoolExecutor to enforce timeout
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    chart_generator.generate_chart,
                    symbol, data_json, chart_type, title, normalize
                )
                # Wait max 20 seconds for chart generation (reduced from 30 to prevent Bedrock timeout)
                result = future.result(timeout=20.0)
                return result
        except FutureTimeoutError:
            logger.warning(f"⚠️ Chart generation timed out after 20 seconds for {symbol}")
            return f"⚠️ Chart generation timed out. For large datasets, try reducing the timeframe or the chart will be generated in the background."
        except Exception as e:
            logger.error(f"Error in chart generation thread: {str(e)}")
            return f"❌ Error generating chart: {str(e)}"
    except Exception as e:
        logger.error(f"Error generating chart for {symbol}: {str(e)}")
        return f"❌ Error generating chart: {str(e)}"

@tool
def generate_stock_chart(symbol: str, timeframe: str = "1y", chart_type: str = "line", title: str = None, start_date: str = None, end_date: str = None) -> str:
    """
    Convenience tool to generate a stock chart by fetching data and creating the chart in one step.
    This is a simplified wrapper that handles data fetching internally.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT')
        timeframe: Time period for the chart ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max') - defaults to '1y'
        chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc') - defaults to 'line'
        title: Custom title for the chart (optional)
        start_date: Start date in 'YYYY-MM-DD' format (optional, overrides timeframe if provided)
        end_date: End date in 'YYYY-MM-DD' format (optional)
    
    Returns:
        Success message with file details
    
    Example:
        generate_stock_chart("AAPL", "1y", "candlestick")
        generate_stock_chart("MSFT", "6mo", "line", "Microsoft Stock Price")
    """
    try:
        agent_logger.info(f"Generating {chart_type} chart for {symbol} (timeframe: {timeframe})")
        logger.info(f"🔍 DEBUG: generate_stock_chart called with symbol={symbol}, timeframe={timeframe}, chart_type={chart_type}")
        
        # Import FinancialTools to fetch data
        import sys
        import os
        sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
        try:
            from agent import FinancialTools
        except ImportError:
            # Fallback: try importing from parent directory
            parent_dir = os.path.dirname(os.path.dirname(__file__))
            sys.path.append(parent_dir)
            from agent import FinancialTools
        
        # Fetch stock data
        logger.info(f"📊 Fetching stock data for {symbol}...")
        stock_data = FinancialTools.get_stock_data(symbol, timeframe, start_date, end_date)
        
        # Convert to JSON string (matching the format expected by generate_chart_tool)
        import json
        data_json = json.dumps(stock_data)
        
        logger.info(f"✅ Data fetched successfully, generating chart...")
        
        # Generate chart using the existing method
        return chart_generator.generate_chart(symbol, data_json, chart_type, title)
        
    except Exception as e:
        logger.error(f"Error generating stock chart for {symbol}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"❌ Error generating stock chart: {str(e)}"