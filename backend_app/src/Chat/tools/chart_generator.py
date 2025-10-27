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
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        self.user_id = os.environ.get('USER_ID')
        self.session_id = os.environ.get('SESSION_ID')

    def _validate_env_vars(self):
        if not self.bucket_name or not self.user_id or not self.session_id:
            raise ValueError("Missing required environment variables (CHAT_FILES_BUCKET_NAME, USER_ID, SESSION_ID)")

    def _detect_data_type(self, data_dict):
        """
        Detect whether the data is from stock or crypto tool based on structure.
        
        Stock data indicators:
        - Has 'historical_data' key with OHLCV data
        - Has 'timeframe', 'data_points', 'date_range' keys
        
        Crypto data indicators:
        - Has 'chart_data' key with time/price data
        - Has 'name' key (coin name)
        - Chart data has 'time' and 'price' keys (not 'close')
        """
        if 'historical_data' in data_dict:
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
        if data_type == 'stock':
            if 'historical_data' in data_dict:
                # Stock data with historical_data (from get_financial_data)
                historical_data = data_dict['historical_data']
                normalized_data = []
                for point in historical_data:
                    normalized_data.append({
                        'time': point.get('timestamp', point.get('date', 0)),
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

        s3_key = f"users/{self.user_id}/sessions/{self.session_id}/agent-files/{filename}"
        
        metadata = {
            'generated_by': 'agent',
            'filename': filename,
            'symbol': symbol,
            'chart_type': chart_type,
            'timeframe': timeframe,
            'data_points': str(data_points),
            'asset_type': asset_type
        }

        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=s3_key,
            Body=buffer.getvalue(),
            ContentType='image/png',
            Metadata=metadata
        )
        return f"✅ Chart generated successfully!\n📊 File: {filename}\n📈 Symbol: {symbol}\n📅 Timeframe: {timeframe}\n📊 Chart Type: {chart_type}\n📊 Data Points: {data_points}\n🔗 The chart has been saved to your session files and will appear in the files section."

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
        try:
            data_dict = json.loads(data_json)
            
            # Detect data type
            data_type = self._detect_data_type(data_dict)
            logger.info(f"Detected data type: {data_type} for symbol: {symbol}")
            
            if data_type == 'unknown':
                return f"Error: Unable to detect data type for {symbol}. Please ensure data is from get_financial_data or get_crypto_data_tool."
            
            # Check for errors
            if "error" in data_dict:
                return f"Error: {data_dict['error']}"
            
            # Normalize data
            normalized_data, timeframe = self._normalize_data(data_dict, data_type)
            
            if not normalized_data:
                return f"Error: No chart data found for {symbol}"
            
            # Convert to DataFrame
            df = pd.DataFrame(normalized_data)
            
            # Convert time to datetime
            if df['time'].dtype == 'int64':
                df['time'] = pd.to_datetime(df['time'], unit='s')
            else:
                df['time'] = pd.to_datetime(df['time'])
            
            df.set_index('time', inplace=True)
            
            # Create figure with watermark
            fig, ax = plt.subplots(figsize=(12, 8))
            self._add_watermark(fig)
            
            # Set title
            if not title:
                asset_name = data_dict.get('name', symbol)
                title = f"{asset_name} Price Chart ({timeframe})"
            ax.set_title(title, fontsize=16, fontweight='bold')
            
            # Generate chart based on type
            if chart_type == "line":
                ax.plot(df.index, df['close'], linewidth=2, color='#1f77b4')
                ax.fill_between(df.index, df['close'], alpha=0.3, color='#1f77b4')
                
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
            
            # Set labels and formatting
            ax.set_xlabel('Date')
            ax.set_ylabel('Price ($)')
            ax.grid(True, alpha=0.3)
            
            # Format x-axis
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
            ax.xaxis.set_major_locator(mdates.AutoLocator())
            plt.xticks(rotation=45)
            
            plt.tight_layout()
            
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
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
    return chart_generator.generate_chart(symbol, data_json, chart_type, title)