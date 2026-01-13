"""
Excel Generator Tool
Creates Excel (.xlsx) files with embedded charts using openpyxl and pandas.
Supports data from get_financial_data, get_multiple_financial_data, and other data sources.
"""

import json
import os
import logging
import boto3
from datetime import datetime
from typing import Dict, Any, List, Optional, Union
from io import BytesIO
import sys

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

# Import agent files helper
try:
    from utils.agent_files_helper import AgentFilesHelper
except ImportError:
    # Fallback for local development
    AgentFilesHelper = None

# Import required libraries
try:
    import pandas as pd
    import openpyxl
    from openpyxl import Workbook
    from openpyxl.chart import LineChart, BarChart, ScatterChart, PieChart
    from openpyxl.chart.reference import Reference
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError as e:
    logging.error(f"Failed to import required libraries: {e}")
    raise

# Configure logging
logger = logging.getLogger(__name__)

# Import agent_logger for WebSocket streaming
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands tool decorator
try:
    from strands import tool
except ImportError as e:
    logger.warning(f"Could not import Strands tool decorator: {e}")
    # Fallback decorator for local development
    def tool(func):
        return func


class ExcelGenerator:
    """
    Generates Excel files with embedded charts using openpyxl.
    Supports stock data, crypto data, and custom data structures.
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
    
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
    
    def _parse_data(self, data: Union[str, dict]) -> Dict[str, Any]:
        """
        Parse data from JSON string, dict, or S3 key.
        Handles cases where:
        1. data is an S3 key string (preferred for large datasets)
        2. data is a JSON string with 's3_key' field
        3. data is a dict with 's3_key' field
        4. data is a dict with stocks that have individual 's3_key' fields
        5. data is a JSON string with actual data (for small datasets)
        """
        if isinstance(data, str):
            # Check if it's an S3 key (starts with users/ or data-files/)
            if data.startswith('users/') or data.startswith('data-files/'):
                agent_logger.info(f"📦 Detected S3 key, reading from: {data}")
                logger.info(f"📦 Detected S3 key, reading from: {data}")
                return self._read_from_s3(data)
            
            # Try to parse as JSON
            try:
                parsed = json.loads(data)
                # Check if the parsed JSON contains an s3_key (preferred path for large datasets)
                if isinstance(parsed, dict) and 's3_key' in parsed:
                    s3_key = parsed['s3_key']
                    agent_logger.info(f"📦 Data contains s3_key, reading from: {s3_key}")
                    logger.info(f"📦 Data contains s3_key, reading from: {s3_key}")
                    return self._read_from_s3(s3_key)
                
                # If it's a dict with compressed data, check size
                if isinstance(parsed, dict) and parsed.get('_compressed'):
                    data_size = len(data)
                    if data_size > 50000:  # If compressed data is still large, warn
                        agent_logger.warning(f"⚠️ Large compressed dataset ({data_size} chars). Consider using S3 key for better performance.")
                        logger.warning(f"⚠️ Large compressed dataset ({data_size} chars). Consider using S3 key for better performance.")
                
                return parsed
            except json.JSONDecodeError:
                raise ValueError(f"Invalid JSON data or S3 key: {data[:100]}")
        
        elif isinstance(data, dict):
            # Check if dict contains an s3_key field (preferred path for large datasets)
            if 's3_key' in data:
                s3_key = data['s3_key']
                agent_logger.info(f"📦 Data dict contains s3_key, reading from: {s3_key}")
                logger.info(f"📦 Data dict contains s3_key, reading from: {s3_key}")
                s3_data = self._read_from_s3(s3_key)
                
                # If original data has summary info, merge it
                if 'stocks_summary' in data or 'total_symbols' in data:
                    s3_data['stocks_summary'] = data.get('stocks_summary', [])
                    s3_data['total_symbols'] = data.get('total_symbols', 0)
                
                return s3_data
            
            # Check if stocks array contains individual S3 keys
            if 'stocks' in data and isinstance(data['stocks'], list):
                stocks = data['stocks']
                for i, stock in enumerate(stocks):
                    if isinstance(stock, dict) and 's3_key' in stock and 'historical_data' not in stock:
                        s3_key = stock['s3_key']
                        agent_logger.info(f"📦 Stock {stock.get('symbol', 'UNKNOWN')} data in S3, reading from: {s3_key}")
                        logger.info(f"📦 Stock {stock.get('symbol', 'UNKNOWN')} data in S3, reading from: {s3_key}")
                        try:
                            stock_data = self._read_from_s3(s3_key)
                            # Merge with existing stock metadata
                            stock_data.update({k: v for k, v in stock.items() if k != 's3_key'})
                            stocks[i] = stock_data
                        except Exception as e:
                            logger.error(f"❌ Failed to read stock data from S3: {str(e)}")
                            agent_logger.error(f"❌ Failed to read stock data from S3: {str(e)}")
                            # Keep the stock entry as-is if S3 read fails
            
            # Check if it's compressed data and warn if large
            if data.get('_compressed'):
                data_str = json.dumps(data)
                if len(data_str) > 50000:
                    agent_logger.warning(f"⚠️ Large compressed dataset ({len(data_str)} chars). Consider using S3 key for better performance.")
                    logger.warning(f"⚠️ Large compressed dataset ({len(data_str)} chars). Consider using S3 key for better performance.")
        
        return data
    
    def _read_from_s3(self, s3_key: str, max_rows: int = 10000) -> Dict[str, Any]:
        """
        Read data from S3. Handles large files efficiently.
        For very large datasets, limits historical data rows to avoid memory/timeout issues.
        
        Args:
            s3_key: S3 key to read from
            max_rows: Maximum number of historical data rows to include (default: 10000)
        """
        try:
            bucket_name = self._get_bucket_name()
            logger.info(f"Reading S3 object: {bucket_name}/{s3_key}")
            
            # Get object metadata first to check size
            try:
                head_response = self.s3_client.head_object(Bucket=bucket_name, Key=s3_key)
                file_size = head_response.get('ContentLength', 0)
                logger.info(f"S3 file size: {file_size} bytes ({file_size / 1024 / 1024:.2f} MB)")
            except Exception as e:
                logger.warning(f"Could not get file metadata: {str(e)}")
                file_size = 0
            
            # Read the object
            response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read().decode('utf-8')
            
            # Parse JSON
            data = json.loads(content)
            
            # Handle decompression if needed
            if isinstance(data, dict) and data.get("_compressed") is True:
                logger.info("🔍 Decompressing compressed data")
                try:
                    from utils.compression_helper import CompressionHelper
                    data = CompressionHelper.decompress_data(data)
                    # Remove original_data if present
                    if isinstance(data, dict) and 'original_data' in data:
                        data.pop('original_data', None)
                    logger.info("✅ Successfully decompressed data")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to decompress data: {str(e)}")
                    # Try to use original_data if available
                    if isinstance(data, dict) and 'original_data' in data:
                        data = data['original_data']
            
            # Limit historical data rows if dataset is very large
            if isinstance(data, dict):
                # Single stock data
                if 'historical_data' in data and isinstance(data['historical_data'], list):
                    historical_data = data['historical_data']
                    if len(historical_data) > max_rows:
                        logger.info(f"📊 Limiting historical data from {len(historical_data)} to {max_rows} rows for Excel generation")
                        # Sample evenly across the dataset
                        step = len(historical_data) // max_rows
                        data['historical_data'] = historical_data[::step][:max_rows]
                        data['_rows_limited'] = True
                        data['_original_rows'] = len(historical_data)
                
                # Multiple stocks data
                if 'stocks' in data and isinstance(data['stocks'], list):
                    for stock in data['stocks']:
                        if isinstance(stock, dict) and 'historical_data' in stock:
                            historical_data = stock['historical_data']
                            if isinstance(historical_data, list) and len(historical_data) > max_rows:
                                logger.info(f"📊 Limiting {stock.get('symbol', 'UNKNOWN')} historical data from {len(historical_data)} to {max_rows} rows")
                                step = len(historical_data) // max_rows
                                stock['historical_data'] = historical_data[::step][:max_rows]
                                stock['_rows_limited'] = True
                                stock['_original_rows'] = len(historical_data)
            
            logger.info(f"✅ Successfully read {len(content)} chars from S3")
            return data
            
        except Exception as e:
            logger.error(f"Error reading from S3: {str(e)}")
            raise
    
    def _detect_data_type(self, data: Dict[str, Any]) -> str:
        """Detect the type of data structure"""
        if 'stocks' in data and isinstance(data['stocks'], list):
            return 'multiple_stocks'
        elif 'historical_data' in data:
            return 'stock'
        elif 'chart_data' in data:
            return 'crypto'
        elif isinstance(data, list) and len(data) > 0:
            # Check if it's a list of stock data
            if isinstance(data[0], dict) and 'symbol' in data[0]:
                return 'multiple_stocks_list'
            return 'custom_list'
        elif isinstance(data, dict):
            return 'custom_dict'
        return 'unknown'
    
    def _create_stock_dataframe(self, data: Dict[str, Any], max_rows: int = 10000) -> pd.DataFrame:
        """
        Create pandas DataFrame from stock data.
        For very large datasets, limits rows to avoid memory issues.
        
        Args:
            data: Stock data dictionary
            max_rows: Maximum number of rows to include (default: 10000)
        """
        historical_data = data.get('historical_data', [])
        if not historical_data:
            return pd.DataFrame()
        
        # Limit rows if dataset is very large
        if len(historical_data) > max_rows:
            logger.warning(f"Dataset has {len(historical_data)} rows, limiting to {max_rows} for Excel")
            # Sample evenly across the dataset
            step = len(historical_data) // max_rows
            historical_data = historical_data[::step][:max_rows]
        
        df = pd.DataFrame(historical_data)
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date')
        return df
    
    def _create_crypto_dataframe(self, data: Dict[str, Any], max_rows: int = 10000) -> pd.DataFrame:
        """
        Create pandas DataFrame from crypto data.
        For very large datasets, limits rows to avoid memory issues.
        
        Args:
            data: Crypto data dictionary
            max_rows: Maximum number of rows to include (default: 10000)
        """
        chart_data = data.get('chart_data', [])
        if not chart_data:
            return pd.DataFrame()
        
        # Limit rows if dataset is very large
        if len(chart_data) > max_rows:
            logger.warning(f"Dataset has {len(chart_data)} rows, limiting to {max_rows} for Excel")
            # Sample evenly across the dataset
            step = len(chart_data) // max_rows
            chart_data = chart_data[::step][:max_rows]
        
        df = pd.DataFrame(chart_data)
        if 'time' in df.columns:
            df['time'] = pd.to_datetime(df['time'], unit='s', errors='coerce')
            df = df.set_index('time')
        return df
    
    def _add_stock_chart(self, ws, df: pd.DataFrame, symbol: str, start_row: int = 1) -> int:
        """Add a stock price chart to the worksheet"""
        if df.empty or 'close' not in df.columns:
            return start_row
        
        # Create line chart
        chart = LineChart()
        chart.title = f"{symbol} Price Chart"
        chart.style = 10
        chart.y_axis.title = 'Price (USD)'
        chart.x_axis.title = 'Date'
        
        # Add data
        values = Reference(ws, min_col=2, min_row=start_row, max_row=start_row + len(df) - 1)
        dates = Reference(ws, min_col=1, min_row=start_row, max_row=start_row + len(df) - 1)
        
        series = openpyxl.chart.Series(values, dates, title=symbol)
        chart.series.append(series)
        
        # Position chart
        chart.width = 15
        chart.height = 10
        ws.add_chart(chart, f"D{start_row}")
        
        return start_row + len(df) + 15
    
    def _add_crypto_chart(self, ws, df: pd.DataFrame, symbol: str, start_row: int = 1) -> int:
        """Add a crypto price chart to the worksheet"""
        if df.empty or 'price' not in df.columns:
            return start_row
        
        # Create line chart
        chart = LineChart()
        chart.title = f"{symbol} Price Chart"
        chart.style = 10
        chart.y_axis.title = 'Price (USD)'
        chart.x_axis.title = 'Time'
        
        # Add data
        values = Reference(ws, min_col=2, min_row=start_row, max_row=start_row + len(df) - 1)
        dates = Reference(ws, min_col=1, min_row=start_row, max_row=start_row + len(df) - 1)
        
        series = openpyxl.chart.Series(values, dates, title=symbol)
        chart.series.append(series)
        
        # Position chart
        chart.width = 15
        chart.height = 10
        ws.add_chart(chart, f"D{start_row}")
        
        return start_row + len(df) + 15
    
    def _format_header(self, ws, row: int, columns: List[str]):
        """Format header row"""
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF", size=12)
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for col_idx, col_name in enumerate(columns, 1):
            cell = ws.cell(row=row, column=col_idx)
            cell.value = col_name
            cell.fill = header_fill
            cell.font = header_font
            cell.border = border
            cell.alignment = Alignment(horizontal='center', vertical='center')
    
    def _format_data_row(self, ws, row: int, num_cols: int):
        """Format data row"""
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for col in range(1, num_cols + 1):
            cell = ws.cell(row=row, column=col)
            cell.border = border
    
    def generate_excel_from_stock_data(self, data: Dict[str, Any], filename: str) -> bytes:
        """Generate Excel file from stock data"""
        wb = Workbook()
        ws = wb.active
        ws.title = "Stock Data"
        
        symbol = data.get('symbol', 'UNKNOWN')
        ws['A1'] = f"{symbol} Financial Data"
        ws['A1'].font = Font(bold=True, size=16)
        
        # Add summary metrics
        row = 3
        metrics = {
            'Current Price': data.get('current_price', 'N/A'),
            'Price Change': data.get('price_change', 'N/A'),
            'Price Change %': f"{data.get('price_change_percent', 0)}%",
            'Market Cap': data.get('market_cap', 'N/A'),
            'Volume': data.get('volume', 'N/A'),
            'P/E Ratio': data.get('pe_ratio', 'N/A'),
            '52 Week High': data.get('52_week_high', 'N/A'),
            '52 Week Low': data.get('52_week_low', 'N/A'),
            'Volatility': f"{data.get('volatility_annual', 0)}%",
        }
        
        for key, value in metrics.items():
            ws.cell(row=row, column=1, value=key).font = Font(bold=True)
            ws.cell(row=row, column=2, value=value)
            row += 1
        
        # Add historical data
        row += 2
        df = self._create_stock_dataframe(data)
        if not df.empty:
            # Write headers
            columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
            self._format_header(ws, row, columns)
            row += 1
            
            # Write data
            for idx, (date, row_data) in enumerate(df.iterrows(), start=row):
                ws.cell(row=idx, column=1, value=date)
                ws.cell(row=idx, column=2, value=row_data.get('open', row_data.get('Open', '')))
                ws.cell(row=idx, column=3, value=row_data.get('high', row_data.get('High', '')))
                ws.cell(row=idx, column=4, value=row_data.get('low', row_data.get('Low', '')))
                ws.cell(row=idx, column=5, value=row_data.get('close', row_data.get('Close', '')))
                ws.cell(row=idx, column=6, value=row_data.get('volume', row_data.get('Volume', '')))
                self._format_data_row(ws, idx, len(columns))
            
            # Add chart
            chart_row = row
            row = self._add_stock_chart(ws, df, symbol, chart_row)
        
        # Auto-adjust column widths
        for column in ws.columns:
            max_length = 0
            column_letter = get_column_letter(column[0].column)
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
        
        # Save to bytes
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output.read()
    
    def generate_excel_from_multiple_stocks(self, data: Dict[str, Any], filename: str) -> bytes:
        """Generate Excel file from multiple stocks data"""
        wb = Workbook()
        
        stocks = data.get('stocks', [])
        if not stocks:
            # Try to parse as list
            if isinstance(data, list):
                stocks = data
            else:
                raise ValueError("No stocks data found")
        
        # Create summary sheet
        ws_summary = wb.active
        ws_summary.title = "Summary"
        
        # Add summary header
        ws_summary['A1'] = "Stock Comparison Summary"
        ws_summary['A1'].font = Font(bold=True, size=16)
        
        # Add summary table
        row = 3
        columns = ['Symbol', 'Current Price', 'Price Change %', 'Market Cap', 'Volume', 'P/E Ratio']
        self._format_header(ws_summary, row, columns)
        row += 1
        
        for stock in stocks:
            if isinstance(stock, dict) and stock.get('status') == 'success':
                ws_summary.cell(row=row, column=1, value=stock.get('symbol', ''))
                ws_summary.cell(row=row, column=2, value=stock.get('current_price', ''))
                ws_summary.cell(row=row, column=3, value=f"{stock.get('price_change_percent', 0)}%")
                ws_summary.cell(row=row, column=4, value=stock.get('market_cap', ''))
                ws_summary.cell(row=row, column=5, value=stock.get('volume', ''))
                ws_summary.cell(row=row, column=6, value=stock.get('pe_ratio', ''))
                self._format_data_row(ws_summary, row, len(columns))
                row += 1
        
        # Create individual sheets for each stock
        for stock in stocks:
            if isinstance(stock, dict) and stock.get('status') == 'success':
                symbol = stock.get('symbol', 'UNKNOWN')
                ws = wb.create_sheet(title=symbol[:31])  # Excel sheet name limit
                
                # Add title
                ws['A1'] = f"{symbol} Financial Data"
                ws['A1'].font = Font(bold=True, size=16)
                
                # Add metrics
                row = 3
                metrics = {
                    'Current Price': stock.get('current_price', 'N/A'),
                    'Price Change': stock.get('price_change', 'N/A'),
                    'Price Change %': f"{stock.get('price_change_percent', 0)}%",
                    'Market Cap': stock.get('market_cap', 'N/A'),
                    'Volume': stock.get('volume', 'N/A'),
                }
                
                for key, value in metrics.items():
                    ws.cell(row=row, column=1, value=key).font = Font(bold=True)
                    ws.cell(row=row, column=2, value=value)
                    row += 1
                
                # Add historical data
                row += 2
                df = self._create_stock_dataframe(stock)
                if not df.empty:
                    columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
                    self._format_header(ws, row, columns)
                    row += 1
                    
                    for idx, (date, row_data) in enumerate(df.iterrows(), start=row):
                        ws.cell(row=idx, column=1, value=date)
                        ws.cell(row=idx, column=2, value=row_data.get('open', row_data.get('Open', '')))
                        ws.cell(row=idx, column=3, value=row_data.get('high', row_data.get('High', '')))
                        ws.cell(row=idx, column=4, value=row_data.get('low', row_data.get('Low', '')))
                        ws.cell(row=idx, column=5, value=row_data.get('close', row_data.get('Close', '')))
                        ws.cell(row=idx, column=6, value=row_data.get('volume', row_data.get('Volume', '')))
                        self._format_data_row(ws, idx, len(columns))
                    
                    # Add chart
                    chart_row = row
                    self._add_stock_chart(ws, df, symbol, chart_row)
                
                # Auto-adjust column widths
                for column in ws.columns:
                    max_length = 0
                    column_letter = get_column_letter(column[0].column)
                    for cell in column:
                        try:
                            if len(str(cell.value)) > max_length:
                                max_length = len(str(cell.value))
                        except:
                            pass
                    adjusted_width = min(max_length + 2, 50)
                    ws.column_dimensions[column_letter].width = adjusted_width
        
        # Save to bytes
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output.read()
    
    def generate_excel_from_custom_data(self, data: Union[Dict, List], filename: str, sheet_name: str = "Data") -> bytes:
        """Generate Excel file from custom data structure"""
        wb = Workbook()
        ws = wb.active
        ws.title = sheet_name[:31]  # Excel sheet name limit
        
        if isinstance(data, list):
            if len(data) == 0:
                ws['A1'] = "No data available"
                output = BytesIO()
                wb.save(output)
                output.seek(0)
                return output.read()
            
            # Convert list to DataFrame
            df = pd.DataFrame(data)
            
            # Write headers
            columns = list(df.columns)
            self._format_header(ws, 1, columns)
            
            # Write data
            for idx, (_, row_data) in enumerate(df.iterrows(), start=2):
                for col_idx, col_name in enumerate(columns, 1):
                    value = row_data[col_name]
                    if pd.isna(value):
                        value = ''
                    ws.cell(row=idx, column=col_idx, value=value)
                self._format_data_row(ws, idx, len(columns))
        
        elif isinstance(data, dict):
            # Write key-value pairs
            row = 1
            for key, value in data.items():
                ws.cell(row=row, column=1, value=str(key)).font = Font(bold=True)
                if isinstance(value, (dict, list)):
                    ws.cell(row=row, column=2, value=json.dumps(value))
                else:
                    ws.cell(row=row, column=2, value=value)
                row += 1
        
        # Auto-adjust column widths
        for column in ws.columns:
            max_length = 0
            column_letter = get_column_letter(column[0].column)
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
        
        # Save to bytes
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output.read()
    
    def upload_to_s3(self, excel_bytes: bytes, filename: str) -> str:
        """Upload Excel file to S3 and update session_variables"""
        try:
            user_id = self._get_user_id()
            session_id = self._get_session_id()
            
            # Ensure filename has .xlsx extension
            if not filename.endswith('.xlsx'):
                filename = f"{filename}.xlsx"
            
            # Use AgentFilesHelper if available (preferred method)
            if AgentFilesHelper:
                try:
                    result = AgentFilesHelper.upload_file_and_update_session(
                        user_id=user_id,
                        session_id=session_id,
                        file_bytes=excel_bytes,
                        filename=filename,
                        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        file_metadata={
                            'file_type': 'xlsx',
                            'generated_by': 'excel_generator_tool'
                        }
                    )
                    
                    logger.info(f"Successfully uploaded Excel file and updated session: {result['s3_key']}")
                    agent_logger.info(f"Excel file generated and session updated: {result['s3_key']}")
                    
                    return json.dumps({
                        'status': 'success',
                        'message': f'Excel file generated successfully: {filename}',
                        'filename': filename,
                        's3_key': result['s3_key'],
                        's3_url': result['file_metadata']['s3_url'],
                        'file_size': len(excel_bytes),
                        'file_metadata': result['file_metadata']
                    })
                except Exception as helper_error:
                    logger.warning(f"AgentFilesHelper failed, falling back to direct S3 upload: {str(helper_error)}")
                    # Fall through to direct S3 upload
            
            # Fallback: Direct S3 upload (if AgentFilesHelper not available)
            bucket_name = self._get_bucket_name()
            s3_key = f"users/{user_id}/sessions/{session_id}/agent-files/{filename}"
            
            # Upload to S3
            self.s3_client.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=excel_bytes,
                ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                Metadata={
                    'user_id': user_id,
                    'session_id': session_id,
                    'filename': filename,
                    'file_type': 'xlsx',
                    'generated_by': 'excel_generator_tool',
                    'upload_timestamp': str(int(datetime.utcnow().timestamp()))
                }
            )
            
            logger.info(f"Successfully uploaded Excel file (direct upload): {s3_key}")
            logger.warning("Session variables not updated - AgentFilesHelper not available")
            
            return json.dumps({
                'status': 'success',
                'message': f'Excel file generated successfully: {filename}',
                'filename': filename,
                's3_key': s3_key,
                's3_url': f"https://{bucket_name}.s3.amazonaws.com/{s3_key}",
                'file_size': len(excel_bytes)
            })
        
        except Exception as e:
            logger.error(f"Error uploading Excel file to S3: {str(e)}")
            return json.dumps({
                'status': 'error',
                'message': f'Error uploading Excel file: {str(e)}'
            })


@tool
def generate_excel_with_charts_tool(
    data: str,
    filename: str,
    chart_type: str = "line",
    sheet_name: str = None
) -> str:
    """
    Generate an Excel (.xlsx) file with embedded charts from financial or custom data.
    Supports data from get_financial_data, get_multiple_financial_data, and custom data structures.
    
    IMPORTANT: This tool automatically handles large datasets stored in S3. When data tools return
    an s3_key (for large datasets), you should pass the s3_key directly:
    1. The s3_key string itself (e.g., "users/.../data-files/...")
    2. Or a JSON string with 's3_key' field: '{"s3_key": "users/.../data-files/..."}'
    
    The tool will automatically read from S3 and limit rows to 10,000 per dataset to avoid timeouts.
    The Excel file will be saved to agent-files and the S3 key will be returned.
    
    Args:
        data: JSON string or S3 key containing the data to convert to Excel. Can be:
            - S3 key string (preferred for large datasets): "users/.../data-files/..."
            - JSON string with 's3_key' field: '{"s3_key": "users/.../data-files/..."}'
            - Result from get_financial_data() (single stock) - will be processed directly
            - Result from get_multiple_financial_data() (multiple stocks) - may contain s3_key
            - Custom JSON data structure (list of objects or dict)
        filename: Name of the Excel file (without .xlsx extension)
        chart_type: Type of chart to create ("line", "bar", "scatter", "pie", or "none")
        sheet_name: Custom name for the data sheet (optional, defaults to "Stock Data" or "Data")
    
    Returns:
        JSON string with status, filename, s3_key (for the Excel file in agent-files), and message
        
    Example:
        # Using S3 key from stock data tool (recommended for large datasets)
        stock_data = get_financial_data("AAPL", "1mo")
        # If stock_data contains {"s3_key": "users/.../data-files/..."}, use it:
        generate_excel_with_charts_tool('{"s3_key": "users/.../data-files/stock_data_AAPL_1mo_20231223.json"}', "AAPL_Analysis", "line")
        
        # Or pass S3 key directly as string
        generate_excel_with_charts_tool("users/user_id/sessions/session_id/data-files/stock_data_AAPL_1mo_20231223.json", "AAPL_Analysis", "line")
        
        # Multiple stocks with S3 key
        stocks_data = get_multiple_financial_data("AAPL,MSFT,GOOGL", "1y")
        # Extract s3_key and use it
        generate_excel_with_charts_tool(stocks_data, "Stock_Comparison", "line")
        
        # Custom data (small datasets only)
        custom_data = '[{"name": "Item1", "value": 100}, {"name": "Item2", "value": 200}]'
        generate_excel_with_charts_tool(custom_data, "Custom_Report", "bar")
    """
    try:
        agent_logger.info(f"Generating Excel file with charts: {filename}")
        
        generator = ExcelGenerator()
        
        # Parse data (handles S3 keys automatically)
        parsed_data = generator._parse_data(data)
        
        # Detect data type
        data_type = generator._detect_data_type(parsed_data)
        
        # Generate Excel based on data type
        if data_type == 'stock':
            excel_bytes = generator.generate_excel_from_stock_data(parsed_data, filename)
        elif data_type in ['multiple_stocks', 'multiple_stocks_list']:
            excel_bytes = generator.generate_excel_from_multiple_stocks(parsed_data, filename)
        elif data_type == 'crypto':
            # Crypto data - similar to stock but different structure
            excel_bytes = generator.generate_excel_from_custom_data(parsed_data, filename, sheet_name or "Crypto Data")
        else:
            # Custom data
            excel_bytes = generator.generate_excel_from_custom_data(parsed_data, filename, sheet_name or "Data")
        
        # Upload to S3 (saves to agent-files)
        result = generator.upload_to_s3(excel_bytes, filename)
        return result
    
    except Exception as e:
        error_msg = f"Error generating Excel file: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            'status': 'error',
            'message': error_msg
        })


        })

