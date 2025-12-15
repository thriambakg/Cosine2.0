"""
Content Formatter - Formats financial metrics and data for display

This tool helps the planner format raw data into human-readable content
with proper percentage formatting, decimal precision, etc.
"""

import re
import json
import logging

logger = logging.getLogger(__name__)


def format_financial_content(content: str, data_source: dict = None) -> str:
    """
    Format financial content with proper decimal/percentage formatting.
    
    Args:
        content: Raw content string that may contain unformatted decimals
        data_source: Optional dict with financial data to format
        
    Returns:
        Formatted content string
    """
    lines = content.split('\n')
    formatted_lines = []
    
    for line in lines:
        line_lower = line.lower()
        
        # Pattern to match decimal numbers (including negative)
        decimal_pattern = r'(-?\d+\.\d+)'
        
        # Format based on context
        if 'cagr' in line_lower or 'compound annual growth rate' in line_lower:
            line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
        elif 'volatility' in line_lower:
            line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
        elif 'drawdown' in line_lower and 'max' in line_lower:
            line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2%}", line)
        elif 'sharpe' in line_lower and 'ratio' in line_lower:
            line = re.sub(decimal_pattern, lambda m: f"{float(m.group(1)):.2f}", line)
        elif 'rolling' in line_lower and ('12' in line_lower or 'month' in line_lower) and 'return' in line_lower:
            # Handle large JSON objects
            json_start = line.find('{')
            if json_start != -1:
                if len(line) > 10000:
                    line = line[:json_start] + "(Rolling 12-month returns data - see CSV for detailed time series)"
                else:
                    try:
                        # Try to extract summary from JSON
                        json_end = line.rfind('}')
                        if json_end > json_start:
                            json_str = line[json_start:json_end+1]
                            rolling_data = json.loads(json_str)
                            if isinstance(rolling_data, dict) and 'dates' in rolling_data:
                                num_points = len(rolling_data.get('dates', []))
                                if 'returns' in rolling_data:
                                    returns = rolling_data['returns']
                                    if isinstance(returns, list) and len(returns) > 0:
                                        avg_return = sum(returns) / len(returns)
                                        min_return = min(returns)
                                        max_return = max(returns)
                                        summary = f"Average: {avg_return:.2%}, Range: {min_return:.2%} to {max_return:.2%} ({num_points} data points)"
                                        line = line[:json_start] + summary
                                    else:
                                        line = line[:json_start] + f"({num_points} data points available)"
                                else:
                                    line = line[:json_start] + f"({num_points} data points available)"
                    except (json.JSONDecodeError, ValueError):
                        line = line[:json_start] + "(Rolling 12-month returns data - see CSV for details)"
        
        formatted_lines.append(line)
    
    return '\n'.join(formatted_lines)


def format_metric_value(value: any, metric_type: str) -> str:
    """
    Format a single metric value based on its type.
    
    Args:
        value: The metric value (float, int, or string)
        metric_type: Type of metric ('cagr', 'volatility', 'drawdown', 'sharpe', etc.)
        
    Returns:
        Formatted string
    """
    try:
        if isinstance(value, str):
            # Try to parse as float
            value = float(value)
        
        if metric_type.lower() in ['cagr', 'volatility', 'drawdown', 'return', 'yield']:
            return f"{value:.2%}"
        elif metric_type.lower() in ['sharpe', 'ratio']:
            return f"{value:.2f}"
        else:
            return f"{value:.2f}"
    except (ValueError, TypeError):
        return str(value)

