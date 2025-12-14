"""
Portfolio Analysis Tool - Performs real portfolio calculations including CAGR, volatility,
max drawdown, Sharpe ratio, and rolling returns using actual financial data.
"""

import json
import os
import re
import logging
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
except ImportError as e:
    logger.error(f"Failed to import Strands types: {e}")
    raise

# Tool specification following Strands pattern
TOOL_SPEC = {
    "name": "analyze_portfolio_performance",
    "description": "Analyze portfolio performance vs benchmark. Calculates CAGR, volatility, max drawdown, Sharpe ratio, and rolling 12-month returns. Requires financial data from previous step (S3 key or data reference).",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "data_source": {
                    "type": "string",
                    "description": "S3 key of stored financial data from previous step, or JSON string with financial data"
                },
                "portfolio_holdings": {
                    "type": "string",
                    "description": "Portfolio holdings in format: '2 shares AAPL, 3 shares VOO' or JSON array"
                },
                "benchmark_symbol": {
                    "type": "string",
                    "description": "Benchmark symbol (e.g., '^GSPC' for S&P 500)",
                    "default": "^GSPC"
                },
                "risk_free_rate": {
                    "type": "number",
                    "description": "Risk-free rate for Sharpe ratio calculation (as decimal, e.g., 0.02 for 2%)",
                    "default": 0.02
                }
            },
            "required": ["data_source", "portfolio_holdings"]
        }
    }
}

class PortfolioAnalyzer:
    """Performs real portfolio analysis calculations"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
    
    def _read_data_from_s3(self, s3_key: str) -> Dict[str, Any]:
        """Read financial data from S3"""
        try:
            logger.info(f"Reading financial data from S3: {s3_key}")
            
            # Ensure bucket name is set
            if not self.bucket_name:
                self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
                if not self.bucket_name:
                    raise ValueError("S3 bucket name not configured")
            
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            content = response['Body'].read().decode('utf-8')
            return json.loads(content)
        except ClientError as e:
            logger.error(f"Error reading from S3: {e}")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON from S3: {e}")
            raise
    
    def _parse_portfolio_holdings(self, holdings_input: Any) -> List[Dict[str, Any]]:
        """Parse portfolio holdings from string like '2 shares AAPL, 3 shares VOO' or list/dict"""
        holdings = []
        
        # Handle if input is already a list
        if isinstance(holdings_input, list):
            # Validate list format
            for item in holdings_input:
                if isinstance(item, dict):
                    # Already in correct format: [{"symbol": "AAPL", "shares": 2}, ...]
                    if 'symbol' in item and 'shares' in item:
                        holdings.append(item)
                    # Alternative format: [{"ticker": "AAPL", "shares": 2}, ...]
                    elif 'ticker' in item and 'shares' in item:
                        holdings.append({
                            'symbol': item['ticker'],
                            'shares': item['shares']
                        })
                elif isinstance(item, str):
                    # List of strings like ["AAPL", "VOO"] - assume equal shares
                    holdings.append({'symbol': item, 'shares': 1.0})
            if holdings:
                return holdings
        
        # Handle if input is a dict
        if isinstance(holdings_input, dict):
            # Format: {"AAPL": 2, "VOO": 3}
            for symbol, shares in holdings_input.items():
                holdings.append({'symbol': str(symbol), 'shares': float(shares)})
            if holdings:
                return holdings
        
        # Convert to string if not already
        holdings_str = str(holdings_input) if not isinstance(holdings_input, str) else holdings_input
        
        # Try to parse as JSON first
        try:
            holdings_data = json.loads(holdings_str)
            if isinstance(holdings_data, list):
                return self._parse_portfolio_holdings(holdings_data)  # Recursive call to handle list
            elif isinstance(holdings_data, dict):
                return self._parse_portfolio_holdings(holdings_data)  # Recursive call to handle dict
        except:
            pass
        
        # Parse from natural language string
        # Pattern: "N shares SYMBOL" or "SYMBOL: N shares"
        pattern = r'(\d+(?:\.\d+)?)\s+shares?\s+([A-Z]+)|([A-Z]+):\s*(\d+(?:\.\d+)?)\s+shares?'
        matches = re.findall(pattern, holdings_str.upper())
        
        for match in matches:
            if match[0]:  # "N shares SYMBOL" format
                shares = float(match[0])
                symbol = match[1]
            else:  # "SYMBOL: N shares" format
                symbol = match[2]
                shares = float(match[3])
            
            holdings.append({
                'symbol': symbol,
                'shares': shares
            })
        
        return holdings
    
    def _load_financial_data(self, data_source: Any) -> Dict[str, pd.DataFrame]:
        """Load financial data from S3 or JSON string"""
        # Handle if data_source is already a dict (from placeholder resolution)
        if isinstance(data_source, dict):
            data = data_source
        else:
            # Try to parse as JSON string first
            try:
                data = json.loads(str(data_source))
            except:
                # Assume it's an S3 key (string)
                data = self._read_data_from_s3(str(data_source))
        
        # Check if this is a file reference JSON (from get_multiple_financial_data)
        # If so, we need to read the actual data file
        if isinstance(data, dict) and 'file_reference' in data and 'stocks' not in data:
            file_ref = data.get('file_reference', {})
            if isinstance(file_ref, dict) and 's3_key' in file_ref:
                # Read the actual data file
                logger.info(f"Detected file reference JSON, reading actual data from: {file_ref['s3_key']}")
                data = self._read_data_from_s3(file_ref['s3_key'])
        
        # Extract stock data from the structure
        stocks_data = {}
        
        if 'stocks' in data:
            # Format from get_multiple_financial_data
            for stock in data['stocks']:
                # Try to get data even if status is not explicitly 'success'
                # Some tools may not set status but still have data
                if 'historical_data' in stock:
                    symbol = stock.get('symbol', 'UNKNOWN')
                    try:
                        historical_data = stock['historical_data']
                        if isinstance(historical_data, list) and len(historical_data) > 0:
                            df = pd.DataFrame(historical_data)
                            if 'date' in df.columns:
                                df['date'] = pd.to_datetime(df['date'])
                                df.set_index('date', inplace=True)
                                stocks_data[symbol] = df
                            elif 'Date' in df.columns:
                                df['Date'] = pd.to_datetime(df['Date'])
                                df.set_index('Date', inplace=True)
                                stocks_data[symbol] = df
                    except Exception as e:
                        logger.warning(f"Failed to process data for {symbol}: {e}")
                        continue
                elif stock.get('status') == 'success' and 'data' in stock:
                    # Alternative format with 'data' instead of 'historical_data'
                    symbol = stock.get('symbol', 'UNKNOWN')
                    try:
                        stock_data = stock['data']
                        if isinstance(stock_data, list) and len(stock_data) > 0:
                            df = pd.DataFrame(stock_data)
                            if 'date' in df.columns:
                                df['date'] = pd.to_datetime(df['date'])
                                df.set_index('date', inplace=True)
                                stocks_data[symbol] = df
                    except Exception as e:
                        logger.warning(f"Failed to process data for {symbol}: {e}")
                        continue
        elif isinstance(data, dict):
            # Try to find price data in various formats
            for key, value in data.items():
                if isinstance(value, list) and len(value) > 0:
                    # Try to convert to DataFrame
                    try:
                        df = pd.DataFrame(value)
                        if 'date' in df.columns or 'Date' in df.columns:
                            date_col = 'date' if 'date' in df.columns else 'Date'
                            df[date_col] = pd.to_datetime(df[date_col])
                            df.set_index(date_col, inplace=True)
                            stocks_data[key] = df
                    except:
                        pass
        
        return stocks_data
    
    def _calculate_portfolio_value(self, holdings: List[Dict[str, Any]], stocks_data: Dict[str, pd.DataFrame]) -> pd.Series:
        """Calculate portfolio value over time"""
        # Get all dates from all stocks
        all_dates = set()
        for df in stocks_data.values():
            all_dates.update(df.index)
        
        all_dates = sorted(all_dates)
        
        # Calculate portfolio value for each date
        portfolio_values = []
        dates = []
        
        for date in all_dates:
            total_value = 0.0
            valid = True
            
            for holding in holdings:
                symbol = holding['symbol']
                shares = holding['shares']
                
                if symbol in stocks_data:
                    df = stocks_data[symbol]
                    if date in df.index:
                        # Use close price if available, otherwise use last available price
                        if 'close' in df.columns:
                            price = df.loc[date, 'close']
                        elif 'Close' in df.columns:
                            price = df.loc[date, 'Close']
                        else:
                            # Use first numeric column
                            numeric_cols = df.select_dtypes(include=[np.number]).columns
                            if len(numeric_cols) > 0:
                                price = df.loc[date, numeric_cols[0]]
                            else:
                                valid = False
                                break
                        
                        total_value += shares * price
                    else:
                        # Use last available price before this date
                        available = df[df.index <= date]
                        if len(available) > 0:
                            if 'close' in df.columns:
                                price = available.iloc[-1]['close']
                            elif 'Close' in df.columns:
                                price = available.iloc[-1]['Close']
                            else:
                                numeric_cols = df.select_dtypes(include=[np.number]).columns
                                if len(numeric_cols) > 0:
                                    price = available.iloc[-1][numeric_cols[0]]
                                else:
                                    valid = False
                                    break
                            total_value += shares * price
                        else:
                            valid = False
                            break
                else:
                    valid = False
                    break
            
            if valid:
                portfolio_values.append(total_value)
                dates.append(date)
        
        return pd.Series(portfolio_values, index=pd.DatetimeIndex(dates))
    
    def _calculate_returns(self, prices: pd.Series) -> pd.Series:
        """Calculate daily returns"""
        return prices.pct_change().dropna()
    
    def _calculate_cagr(self, prices: pd.Series) -> float:
        """Calculate Compound Annual Growth Rate"""
        if len(prices) < 2:
            return 0.0
        
        start_price = prices.iloc[0]
        end_price = prices.iloc[-1]
        years = (prices.index[-1] - prices.index[0]).days / 365.25
        
        if years <= 0 or start_price <= 0:
            return 0.0
        
        cagr = (end_price / start_price) ** (1 / years) - 1
        return cagr
    
    def _calculate_volatility(self, returns: pd.Series) -> float:
        """Calculate annualized volatility"""
        if len(returns) < 2:
            return 0.0
        
        # Annualize daily volatility
        return returns.std() * np.sqrt(252)
    
    def _calculate_max_drawdown(self, prices: pd.Series) -> float:
        """Calculate maximum drawdown"""
        if len(prices) < 2:
            return 0.0
        
        # Calculate running maximum
        running_max = prices.expanding().max()
        
        # Calculate drawdown
        drawdown = (prices - running_max) / running_max
        
        return drawdown.min()
    
    def _calculate_sharpe_ratio(self, returns: pd.Series, risk_free_rate: float) -> float:
        """Calculate Sharpe ratio"""
        if len(returns) < 2:
            return 0.0
        
        # Annualize returns and risk-free rate
        annual_return = returns.mean() * 252
        annual_volatility = returns.std() * np.sqrt(252)
        
        if annual_volatility == 0:
            return 0.0
        
        excess_return = annual_return - risk_free_rate
        sharpe = excess_return / annual_volatility
        
        return sharpe
    
    def _calculate_rolling_returns(self, prices: pd.Series, window_months: int = 12) -> pd.Series:
        """Calculate rolling 12-month returns"""
        if len(prices) < window_months * 21:  # Approximate trading days per month
            return pd.Series(dtype=float)
        
        # Convert to monthly if needed, or use daily with appropriate window
        window_days = window_months * 21  # Approximate
        
        rolling_returns = []
        rolling_dates = []
        
        for i in range(window_days, len(prices)):
            start_price = prices.iloc[i - window_days]
            end_price = prices.iloc[i]
            period_return = (end_price / start_price) - 1
            rolling_returns.append(period_return)
            rolling_dates.append(prices.index[i])
        
        return pd.Series(rolling_returns, index=pd.DatetimeIndex(rolling_dates))
    
    def analyze(self, data_source: str, portfolio_holdings: str, benchmark_symbol: str = "^GSPC", risk_free_rate: float = 0.02) -> Dict[str, Any]:
        """Perform complete portfolio analysis"""
        try:
            # Parse holdings
            holdings = self._parse_portfolio_holdings(portfolio_holdings)
            logger.info(f"Analyzing portfolio with holdings: {holdings}")
            
            # Load financial data
            stocks_data = self._load_financial_data(data_source)
            logger.info(f"Loaded data for symbols: {list(stocks_data.keys())}")
            
            if not stocks_data:
                raise ValueError("No financial data found in data source")
            
            # Calculate portfolio value over time
            portfolio_values = self._calculate_portfolio_value(holdings, stocks_data)
            
            if len(portfolio_values) < 2:
                raise ValueError("Insufficient data to calculate portfolio metrics")
            
            # Get benchmark data
            benchmark_values = None
            if benchmark_symbol in stocks_data:
                df = stocks_data[benchmark_symbol]
                if 'close' in df.columns:
                    benchmark_values = df['close']
                elif 'Close' in df.columns:
                    benchmark_values = df['Close']
                else:
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    if len(numeric_cols) > 0:
                        benchmark_values = df[numeric_cols[0]]
            
            # Calculate portfolio metrics
            portfolio_returns = self._calculate_returns(portfolio_values)
            
            metrics = {
                'portfolio': {
                    'cagr': self._calculate_cagr(portfolio_values),
                    'volatility': self._calculate_volatility(portfolio_returns),
                    'max_drawdown': self._calculate_max_drawdown(portfolio_values),
                    'sharpe_ratio': self._calculate_sharpe_ratio(portfolio_returns, risk_free_rate),
                    'total_return': (portfolio_values.iloc[-1] / portfolio_values.iloc[0]) - 1,
                    'start_value': float(portfolio_values.iloc[0]),
                    'end_value': float(portfolio_values.iloc[-1])
                }
            }
            
            # Calculate rolling returns
            rolling_12m = self._calculate_rolling_returns(portfolio_values, 12)
            if len(rolling_12m) > 0:
                metrics['portfolio']['rolling_12m_returns'] = {
                    'dates': [d.isoformat() for d in rolling_12m.index],
                    'returns': rolling_12m.tolist(),
                    'mean': float(rolling_12m.mean()),
                    'std': float(rolling_12m.std()),
                    'min': float(rolling_12m.min()),
                    'max': float(rolling_12m.max())
                }
            
            # Calculate benchmark metrics if available
            if benchmark_values is not None and len(benchmark_values) > 0:
                benchmark_returns = self._calculate_returns(benchmark_values)
                metrics['benchmark'] = {
                    'symbol': benchmark_symbol,
                    'cagr': self._calculate_cagr(benchmark_values),
                    'volatility': self._calculate_volatility(benchmark_returns),
                    'max_drawdown': self._calculate_max_drawdown(benchmark_values),
                    'sharpe_ratio': self._calculate_sharpe_ratio(benchmark_returns, risk_free_rate),
                    'total_return': (benchmark_values.iloc[-1] / benchmark_values.iloc[0]) - 1
                }
            
            # Create time series data for charts
            metrics['time_series'] = {
                'dates': [d.isoformat() for d in portfolio_values.index],
                'portfolio_values': portfolio_values.tolist()
            }
            
            if benchmark_values is not None:
                # Align benchmark with portfolio dates
                aligned_benchmark = []
                for date in portfolio_values.index:
                    if date in benchmark_values.index:
                        aligned_benchmark.append(float(benchmark_values.loc[date]))
                    else:
                        # Use last available value
                        available = benchmark_values[benchmark_values.index <= date]
                        if len(available) > 0:
                            aligned_benchmark.append(float(available.iloc[-1]))
                        else:
                            aligned_benchmark.append(None)
                
                metrics['time_series']['benchmark_values'] = aligned_benchmark
            
            # Create metrics table for CSV
            metrics_table = []
            metrics_table.append(['Metric', 'Portfolio', 'Benchmark' if benchmark_values is not None else 'N/A'])
            metrics_table.append(['CAGR', f"{metrics['portfolio']['cagr']*100:.2f}%", 
                                f"{metrics['benchmark']['cagr']*100:.2f}%" if 'benchmark' in metrics else 'N/A'])
            metrics_table.append(['Volatility', f"{metrics['portfolio']['volatility']*100:.2f}%",
                                f"{metrics['benchmark']['volatility']*100:.2f}%" if 'benchmark' in metrics else 'N/A'])
            metrics_table.append(['Max Drawdown', f"{metrics['portfolio']['max_drawdown']*100:.2f}%",
                                f"{metrics['benchmark']['max_drawdown']*100:.2f}%" if 'benchmark' in metrics else 'N/A'])
            metrics_table.append(['Sharpe Ratio', f"{metrics['portfolio']['sharpe_ratio']:.2f}",
                                f"{metrics['benchmark']['sharpe_ratio']:.2f}" if 'benchmark' in metrics else 'N/A'])
            metrics_table.append(['Total Return', f"{metrics['portfolio']['total_return']*100:.2f}%",
                                f"{metrics['benchmark']['total_return']*100:.2f}%" if 'benchmark' in metrics else 'N/A'])
            
            metrics['metrics_table'] = metrics_table
            
            return metrics
            
        except Exception as e:
            logger.error(f"Error in portfolio analysis: {e}", exc_info=True)
            raise

def analyze_portfolio_performance(tool_use: ToolUse) -> ToolResult:
    """Main tool function for portfolio analysis"""
    try:
        input_data = tool_use["input"]
        data_source = input_data.get("data_source")
        portfolio_holdings = input_data.get("portfolio_holdings")
        benchmark_symbol = input_data.get("benchmark_symbol", "^GSPC")
        risk_free_rate = input_data.get("risk_free_rate", 0.02)
        
        if not data_source:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: data_source parameter is required"}]
            }
        
        if not portfolio_holdings:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: portfolio_holdings parameter is required"}]
            }
        
        # Handle data_source if it's a dict (from placeholder resolution)
        if isinstance(data_source, dict):
            # If it's a file_reference dict, extract the s3_key
            if 's3_key' in data_source:
                data_source = data_source['s3_key']
            elif 'file_reference' in data_source and isinstance(data_source['file_reference'], dict):
                data_source = data_source['file_reference'].get('s3_key', '')
            else:
                # Try to convert dict to JSON string
                data_source = json.dumps(data_source)
        
        analyzer = PortfolioAnalyzer()
        metrics = analyzer.analyze(data_source, portfolio_holdings, benchmark_symbol, risk_free_rate)
        
        # Return structured result
        result_json = json.dumps(metrics, indent=2)
        
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": result_json}]
        }
        
    except Exception as e:
        logger.error(f"Error in analyze_portfolio_performance: {e}", exc_info=True)
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error in portfolio analysis: {str(e)}"}]
        }

