import json
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import pandas as pd
import boto3
import os
from io import BytesIO
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    logger.info("Successfully imported Strands types from layer")
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
        return os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')

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
            
            for stock in stocks_data:
                if stock.get('status') == 'success' and 'historical_data' in stock:
                    symbol = stock.get('symbol', 'UNKNOWN')
                    historical_data = stock['historical_data']
                    
                    # Normalize each stock's data
                    stock_normalized = []
                    for point in historical_data:
                        stock_normalized.append({
                            'time': point.get('timestamp', point.get('date', 0)),
                            'close': point.get('close', 0),
                            'open': point.get('open', point.get('close', 0)),
                            'high': point.get('high', point.get('close', 0)),
                            'low': point.get('low', point.get('close', 0)),
                            'volume': point.get('volume', 0)
                        })
                    
                    normalized_data[symbol] = stock_normalized
            
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
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
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

    def generate_chart(self, symbol: str, data_json: str, chart_type: str = "line", title: str = None) -> str:
        """
        Generate a unified chart that works with both stock and crypto data.
        
        Args:
            symbol: Stock ticker or crypto symbol
            data_json: JSON string containing data from get_financial_data or get_crypto_data_tool
            chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc')
            title: Custom title for the chart (optional)
            
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
            
            # Decompress data if it's compressed
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
            from compression_helper import CompressionHelper
            
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
            
            # Check for errors
            if "error" in data_dict:
                return f"Error: {data_dict['error']}"
            
            # Normalize data
            normalized_data, timeframe = self._normalize_data(data_dict, data_type)
            
            if not normalized_data:
                return f"Error: No chart data found for {symbol}"
            
            # Create figure with professional styling
            fig, ax = plt.subplots(figsize=(14, 8))
            
            # Set professional background colors
            fig.patch.set_facecolor('#F0F2F5')
            ax.set_facecolor('#F0F2F5')
            
            # Log total data points being processed
            total_data_points = sum(len(data) for data in normalized_data.values()) if isinstance(normalized_data, dict) else len(normalized_data)
            logger.info(f"🔍 DEBUG: Chart maker processing {total_data_points} total data points")
            
            # Handle different data types
            if data_type == 'multiple_stocks':
                # Handle multiple stocks comparison
                colors = ['#F06292', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
                
                for i, (stock_symbol, stock_data) in enumerate(normalized_data.items()):
                    if not stock_data:
                        continue
                    
                    logger.info(f"🔍 DEBUG: Processing {len(stock_data)} data points for {stock_symbol}")
                        
                    # Convert to DataFrame
                    df = pd.DataFrame(stock_data)
                    
                    # Convert time to datetime
                    if df['time'].dtype == 'int64':
                        df['time'] = pd.to_datetime(df['time'], unit='s')
                    else:
                        df['time'] = pd.to_datetime(df['time'])
                    
                    df.set_index('time', inplace=True)
                    
                    # Plot line for this stock with professional styling
                    color = colors[i % len(colors)]
                    ax.plot(df.index, df['close'], linewidth=3, color=color, alpha=0.9, label=stock_symbol)
                
                # Set title for multiple stocks
                if not title:
                    stock_symbols = list(normalized_data.keys())
                    title = f"Stock Comparison Chart ({timeframe}) - {', '.join(stock_symbols)}"
                ax.set_title(title, fontsize=18, fontweight='bold', pad=20)
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
            
            # Format x-axis with better date labels
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
            ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))  # Every 3 months
            plt.xticks(rotation=45, fontsize=10)
            plt.yticks(fontsize=10)
            
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
            
            return self._save_chart_to_s3(
                fig, filename, symbol, chart_type, 
                timeframe, len(normalized_data), data_type
            )
            
        except Exception as e:
            logger.error(f"Error generating chart for {symbol}: {str(e)}")
            return f"❌ Error generating chart: {str(e)}"

# Global instance
chart_generator = UnifiedChartGenerator()

@tool
def generate_chart_tool(symbol: str, data_json: str, chart_type: str = "line", title: str = None) -> str:
    """
    Generate a unified chart that works with both stock and cryptocurrency data.
    Automatically detects data type and generates appropriate charts.
    
    Args:
        symbol: Stock ticker or cryptocurrency symbol
        data_json: JSON string containing data from get_financial_data or get_crypto_data_tool
        chart_type: Type of chart ('line', 'candlestick', 'volume', 'ohlc') - defaults to 'line'
        title: Custom title for the chart (optional)
    
    Returns:
        Success message with file details
    """
    # Debug logging to see what data is being passed
    logger.info(f"🔍 DEBUG: generate_chart_tool called with symbol={symbol}, chart_type={chart_type}")
    logger.info(f"🔍 DEBUG: data_json length: {len(data_json)} characters")
    logger.info(f"🔍 DEBUG: data_json preview: {data_json[:200]}...")
    
    return chart_generator.generate_chart(symbol, data_json, chart_type, title)