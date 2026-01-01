"""
Deterministic Chart and Metrics Generators - Separate tools for orchestrator
No LLM calls - purely deterministic execution
"""

import json
import logging
import boto3
import os
from datetime import datetime
from typing import Dict, Any, Optional
from io import BytesIO
import numpy as np
import pandas as pd

# Set matplotlib to use non-interactive backend (required for Lambda)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

logger = logging.getLogger(__name__)


class ChartImageGenerator:
    """
    Deterministic chart generator that creates chart images.
    Designed for orchestrator use - no LLM calls.
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
    
    def generate_chart_image(
        self,
        data_json: str,
        chart_type: str = "line",
        title: str = None,
        interactive: bool = False,
        user_id: str = None,
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        Generate chart image from JSON data.
        
        Args:
            data_json: JSON string from get_multiple_financial_data
            chart_type: Type of chart ('line', 'candlestick', 'volume')
            title: Custom title for the chart
            interactive: Whether to generate interactive chart (future: HTML/JS)
            user_id: User ID for S3 storage
            session_id: Session ID for S3 storage
            
        Returns:
            Dict with:
            - chart_s3_key: S3 key of the chart image
        """
        try:
            # Parse and decompress JSON data
            data = self._parse_and_decompress_data(data_json)
            
            # Extract stocks data
            stocks_data = data.get('stocks', [])
            if not stocks_data:
                raise ValueError("No stocks data found in JSON")
            
            # Decompress individual stocks if they are compressed
            decompressed_stocks = []
            for stock in stocks_data:
                if isinstance(stock, dict) and stock.get("_compressed") is True:
                    logger.info(f"Decompressing stock: {stock.get('symbol', 'UNKNOWN')}")
                    try:
                        from utils.compression_helper import CompressionHelper
                        decompressed_stock = CompressionHelper.decompress_data(stock)
                        # Remove original_data if present
                        if isinstance(decompressed_stock, dict) and 'original_data' in decompressed_stock:
                            decompressed_stock.pop('original_data', None)
                        decompressed_stocks.append(decompressed_stock)
                    except Exception as e:
                        logger.warning(f"Failed to decompress stock, using original_data fallback: {str(e)}")
                        if 'original_data' in stock:
                            decompressed_stocks.append(stock['original_data'])
                        else:
                            decompressed_stocks.append(stock)
                else:
                    # Remove original_data if present in uncompressed stock
                    if isinstance(stock, dict) and 'original_data' in stock:
                        stock = stock.copy()
                        stock.pop('original_data', None)
                    decompressed_stocks.append(stock)
            stocks_data = decompressed_stocks
            
            # Generate chart
            chart_s3_key = self._generate_chart_image(
                stocks_data, chart_type, title, user_id, session_id
            )
            
            return {
                'success': True,
                'chart_s3_key': chart_s3_key,
                'chart_type': chart_type,
                'interactive': interactive
            }
            
        except Exception as e:
            logger.error(f"Error generating chart image: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }
    
    def _parse_and_decompress_data(self, data_json: str) -> Dict[str, Any]:
        """Parse JSON and decompress if needed, removing original_data fallback"""
        if isinstance(data_json, str):
            try:
                data = json.loads(data_json)
                # Check if data is compressed
                try:
                    from compression_helper import CompressionHelper
                    if isinstance(data, dict) and CompressionHelper.is_compressed(data):
                        logger.info("Decompressing data before processing")
                        # Decompress and remove original_data if present
                        decompressed = CompressionHelper.decompress_data(data)
                        # Remove original_data from the decompressed result if it exists
                        if isinstance(decompressed, dict) and 'original_data' in decompressed:
                            decompressed.pop('original_data', None)
                        return decompressed
                except ImportError:
                    pass  # CompressionHelper not available, assume not compressed
                # Remove original_data if present in uncompressed data
                if isinstance(data, dict) and 'original_data' in data:
                    data.pop('original_data', None)
                return data
            except json.JSONDecodeError:
                raise ValueError(f"Invalid JSON data: {data_json[:200]}...")
        else:
            # Remove original_data if present
            if isinstance(data_json, dict) and 'original_data' in data_json:
                data_json.pop('original_data', None)
            return data_json
    
    def _generate_chart_image(
        self,
        stocks_data: list,
        chart_type: str,
        title: str,
        user_id: str,
        session_id: str
    ) -> str:
        """
        Generate chart image and save to S3.
        
        Returns:
            S3 key of the chart image
        """
        # Create figure
        fig, ax = plt.subplots(figsize=(14, 8))
        
        # Plot each stock
        colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd']
        
        for idx, stock in enumerate(stocks_data):
            if stock.get('status') != 'success':
                continue
            
            symbol = stock.get('symbol', 'UNKNOWN')
            historical_data = stock.get('historical_data', [])
            
            if not historical_data:
                logger.warning(f"No historical data for {symbol}")
                continue
            
            logger.info(f"Processing {len(historical_data)} data points for {symbol}")
            
            # Convert to DataFrame
            df = pd.DataFrame(historical_data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.sort_values('date')
            
            logger.info(f"Chart for {symbol}: {len(df)} data points from {df['date'].min()} to {df['date'].max()}")
            logger.info(f"Using ALL {len(df)} daily data points for chart - no downsampling")
            
            # Plot all data points - ensure no downsampling
            # matplotlib.plot() will plot all points in a continuous line
            color = colors[idx % len(colors)]
            ax.plot(df['date'], df['close'], label=symbol, linewidth=2, color=color, 
                   marker='', markersize=0, linestyle='-', antialiased=True)
        
        # Formatting
        ax.set_xlabel('Date', fontsize=12)
        ax.set_ylabel('Price', fontsize=12)
        ax.set_title(title or 'Stock Price Comparison', fontsize=14, fontweight='bold')
        ax.legend(loc='best')
        ax.grid(True, alpha=0.3)
        
        # Format x-axis dates based on data range
        # Calculate the date range to determine appropriate tick frequency
        if stocks_data:
            first_stock = next((s for s in stocks_data if s.get('status') == 'success' and s.get('historical_data')), None)
            if first_stock and first_stock.get('historical_data'):
                df_sample = pd.DataFrame(first_stock['historical_data'])
                df_sample['date'] = pd.to_datetime(df_sample['date'])
                date_range = (df_sample['date'].max() - df_sample['date'].min()).days
                
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
                    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
            else:
                # Fallback to default
                ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
                ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
        else:
            # Fallback to default
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
            ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
        
        plt.xticks(rotation=45)
        
        # Scale y-axis based on data: start at minimum value, end at 10% above max
        # Collect all close prices from all plotted stocks
        all_prices = []
        for stock in stocks_data:
            if stock.get('status') == 'success' and stock.get('historical_data'):
                historical_data = stock.get('historical_data', [])
                for data_point in historical_data:
                    if 'close' in data_point:
                        all_prices.append(data_point['close'])
        
        if all_prices and len(all_prices) > 0:
            min_price = min(all_prices)
            max_price = max(all_prices)
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
        
        # Add watermark
        fig.text(0.99, 0.01, 'investcosine.com', fontsize=8, color='gray',
                ha='right', va='bottom', alpha=0.7, transform=fig.transFigure)
        
        plt.tight_layout()
        
        # Save to buffer
        buffer = BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plt.close(fig)
        
        # Upload to S3
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Generate symbols string for filename
        symbols = '_'.join([s.get('symbol', 'UNK') for s in stocks_data if s.get('status') == 'success'])
        filename = f"chart_{symbols}_{chart_type}_{timestamp}.png"
        s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
        
        self.s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=buffer.getvalue(),
            ContentType='image/png'
        )
        
        logger.info(f"Chart saved to S3: {s3_key}")
        return s3_key


class SummaryMetricsCalculator:
    """
    Deterministic summary metrics calculator.
    Designed for orchestrator use - no LLM calls.
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
    
    def calculate_summary_metrics(
        self,
        data_json: str,
        user_id: str = None,
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        Calculate summary metrics from JSON data.
        
        Args:
            data_json: JSON string from get_multiple_financial_data
            user_id: User ID for S3 storage
            session_id: Session ID for S3 storage
            
        Returns:
            Dict with:
            - summary_metrics: Dict with calculated metrics
            - summary_s3_key: S3 key of the summary JSON
        """
        try:
            # Parse and decompress JSON data
            data = self._parse_and_decompress_data(data_json)
            
            # Extract stocks data
            stocks_data = data.get('stocks', [])
            if not stocks_data:
                raise ValueError("No stocks data found in JSON")
            
            # Decompress individual stocks if they are compressed
            decompressed_stocks = []
            for stock in stocks_data:
                if isinstance(stock, dict) and stock.get("_compressed") is True:
                    logger.info(f"Decompressing stock: {stock.get('symbol', 'UNKNOWN')}")
                    try:
                        from utils.compression_helper import CompressionHelper
                        decompressed_stock = CompressionHelper.decompress_data(stock)
                        # Remove original_data if present
                        if isinstance(decompressed_stock, dict) and 'original_data' in decompressed_stock:
                            decompressed_stock.pop('original_data', None)
                        decompressed_stocks.append(decompressed_stock)
                    except Exception as e:
                        logger.warning(f"Failed to decompress stock, using original_data fallback: {str(e)}")
                        if 'original_data' in stock:
                            decompressed_stocks.append(stock['original_data'])
                        else:
                            decompressed_stocks.append(stock)
                else:
                    # Remove original_data if present in uncompressed stock
                    if isinstance(stock, dict) and 'original_data' in stock:
                        stock = stock.copy()
                        stock.pop('original_data', None)
                    decompressed_stocks.append(stock)
            stocks_data = decompressed_stocks
            
            # Calculate summary metrics
            summary_metrics = self._calculate_summary_metrics(stocks_data)
            
            # Save summary metrics to S3
            summary_s3_key = self._save_summary_metrics(
                summary_metrics, user_id, session_id
            )
            
            return {
                'success': True,
                'summary_metrics': summary_metrics,
                'summary_s3_key': summary_s3_key
            }
            
        except Exception as e:
            logger.error(f"Error calculating summary metrics: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }
    
    def _parse_and_decompress_data(self, data_json: str) -> Dict[str, Any]:
        """Parse JSON and decompress if needed, removing original_data fallback"""
        if isinstance(data_json, str):
            try:
                data = json.loads(data_json)
                # Check if data is compressed
                try:
                    from compression_helper import CompressionHelper
                    if isinstance(data, dict) and CompressionHelper.is_compressed(data):
                        logger.info("Decompressing data before processing")
                        # Decompress and remove original_data if present
                        decompressed = CompressionHelper.decompress_data(data)
                        # Remove original_data from the decompressed result if it exists
                        if isinstance(decompressed, dict) and 'original_data' in decompressed:
                            decompressed.pop('original_data', None)
                        return decompressed
                except ImportError:
                    pass  # CompressionHelper not available, assume not compressed
                # Remove original_data if present in uncompressed data
                if isinstance(data, dict) and 'original_data' in data:
                    data.pop('original_data', None)
                return data
            except json.JSONDecodeError:
                raise ValueError(f"Invalid JSON data: {data_json[:200]}...")
        else:
            # Remove original_data if present
            if isinstance(data_json, dict) and 'original_data' in data_json:
                data_json.pop('original_data', None)
            return data_json
    
    def _calculate_summary_metrics(self, stocks_data: list) -> Dict[str, Any]:
        """
        Calculate summary metrics for all stocks.
        
        Returns:
            Dict with metrics for each stock and comparisons
        """
        metrics = {
            'stocks': {},
            'comparison': {},
            'timeframe': None,
            'generated_at': datetime.now().isoformat()
        }
        
        stock_metrics = []
        
        for stock in stocks_data:
            if stock.get('status') != 'success':
                continue
            
            symbol = stock.get('symbol', 'UNKNOWN')
            historical_data = stock.get('historical_data', [])
            
            if not historical_data:
                continue
            
            # Convert to DataFrame for easier calculations
            df = pd.DataFrame(historical_data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.sort_values('date')
            
            # Calculate metrics
            current_price = df['close'].iloc[-1]
            start_price = df['close'].iloc[0]
            total_return = ((current_price - start_price) / start_price) * 100
            
            # Volatility (annualized)
            returns = df['close'].pct_change().dropna()
            volatility = returns.std() * np.sqrt(252) * 100  # Annualized
            
            # 52-week high/low
            high_52w = df['close'].max()
            low_52w = df['close'].min()
            high_date = df.loc[df['close'].idxmax(), 'date']
            low_date = df.loc[df['close'].idxmin(), 'date']
            
            # Max drawdown
            cumulative = (1 + returns).cumprod()
            running_max = cumulative.expanding().max()
            drawdown = (cumulative - running_max) / running_max
            max_drawdown = drawdown.min() * 100
            max_drawdown_date = df.loc[drawdown.idxmin(), 'date'] if not drawdown.empty else None
            
            # Average volume
            avg_volume = df['volume'].mean()
            
            stock_metric = {
                'symbol': symbol,
                'current_price': round(float(current_price), 2),
                'start_price': round(float(start_price), 2),
                'total_return_pct': round(float(total_return), 2),
                'volatility_annual_pct': round(float(volatility), 2),
                'high_52w': round(float(high_52w), 2),
                'low_52w': round(float(low_52w), 2),
                'high_52w_date': high_date.strftime('%Y-%m-%d') if pd.notna(high_date) else None,
                'low_52w_date': low_date.strftime('%Y-%m-%d') if pd.notna(low_date) else None,
                'max_drawdown_pct': round(float(max_drawdown), 2),
                'max_drawdown_date': max_drawdown_date.strftime('%Y-%m-%d') if max_drawdown_date is not None else None,
                'avg_volume': int(avg_volume),
                'data_points': len(df),
                'date_range': {
                    'start': df['date'].iloc[0].strftime('%Y-%m-%d'),
                    'end': df['date'].iloc[-1].strftime('%Y-%m-%d')
                }
            }
            
            metrics['stocks'][symbol] = stock_metric
            stock_metrics.append(stock_metric)
            
            # Store timeframe from first stock
            if metrics['timeframe'] is None:
                metrics['timeframe'] = stock.get('timeframe', 'unknown')
        
        # Calculate comparisons if multiple stocks
        if len(stock_metrics) > 1:
            returns = [s['total_return_pct'] for s in stock_metrics]
            volatilities = [s['volatility_annual_pct'] for s in stock_metrics]
            
            metrics['comparison'] = {
                'best_performer': max(stock_metrics, key=lambda x: x['total_return_pct']),
                'worst_performer': min(stock_metrics, key=lambda x: x['total_return_pct']),
                'highest_volatility': max(stock_metrics, key=lambda x: x['volatility_annual_pct']),
                'lowest_volatility': min(stock_metrics, key=lambda x: x['volatility_annual_pct']),
                'avg_return': round(np.mean(returns), 2),
                'avg_volatility': round(np.mean(volatilities), 2)
            }
        
        return metrics
    
    def _save_summary_metrics(
        self,
        summary_metrics: Dict[str, Any],
        user_id: str,
        session_id: str
    ) -> str:
        """
        Save summary metrics to S3.
        
        Returns:
            S3 key of the summary JSON
        """
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        filename = f"chart_summary_metrics_{timestamp}.json"
        s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
        
        # Convert to JSON string
        metrics_json = json.dumps(summary_metrics, indent=2)
        
        self.s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=metrics_json.encode('utf-8'),
            ContentType='application/json'
        )
        
        logger.info(f"Summary metrics saved to S3: {s3_key}")
        return s3_key


# Global instances
chart_image_generator = ChartImageGenerator()
summary_metrics_calculator = SummaryMetricsCalculator()


def generate_chart_image_tool(
    data_json: str,
    chart_type: str = "line",
    title: str = None,
    interactive: bool = False
) -> str:
    """
    Deterministic tool for generating chart images.
    Designed for orchestrator use - no LLM calls.
    
    Args:
        data_json: JSON string from get_multiple_financial_data
        chart_type: Type of chart ('line', 'candlestick', 'volume')
        title: Custom title for the chart
        interactive: Whether to generate interactive chart (future feature)
        
    Returns:
        JSON string with chart_s3_key
    """
    try:
        # Get user_id and session_id from environment (set by orchestrator)
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return json.dumps({
                'success': False,
                'error': 'USER_ID and SESSION_ID environment variables required'
            })
        
        result = chart_image_generator.generate_chart_image(
            data_json=data_json,
            chart_type=chart_type,
            title=title,
            interactive=interactive,
            user_id=user_id,
            session_id=session_id
        )
        
        return json.dumps(result, indent=2)
        
    except Exception as e:
        logger.error(f"Error in generate_chart_image_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def calculate_summary_metrics_tool(
    data_json: str
) -> str:
    """
    Deterministic tool for calculating summary metrics.
    Designed for orchestrator use - no LLM calls.
    
    Args:
        data_json: JSON string from get_multiple_financial_data
        
    Returns:
        JSON string with summary_metrics and summary_s3_key
    """
    try:
        # Get user_id and session_id from environment (set by orchestrator)
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return json.dumps({
                'success': False,
                'error': 'USER_ID and SESSION_ID environment variables required'
            })
        
        result = summary_metrics_calculator.calculate_summary_metrics(
            data_json=data_json,
            user_id=user_id,
            session_id=session_id
        )
        
        return json.dumps(result, indent=2)
        
    except Exception as e:
        logger.error(f"Error in calculate_summary_metrics_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return json.dumps({
            'success': False,
            'error': str(e)
        })
