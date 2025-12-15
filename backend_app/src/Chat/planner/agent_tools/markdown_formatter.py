"""
Markdown Formatter - Converts data structures to formatted markdown

Helps the planner convert structured data (metrics, tables, etc.) into
well-formatted markdown for document generation.
"""

import logging

logger = logging.getLogger(__name__)


def format_markdown_content(data: dict, include_charts: bool = True) -> str:
    """
    Convert structured financial data to markdown format.
    
    Args:
        data: Dictionary with financial data (portfolio metrics, time series, etc.)
        include_charts: Whether to include chart placeholders
        
    Returns:
        Formatted markdown string
    """
    lines = []
    
    # Portfolio metrics section
    if 'portfolio' in data:
        portfolio = data['portfolio']
        lines.append("## Portfolio Performance Metrics\n")
        
        if 'cagr' in portfolio:
            lines.append(f"**CAGR:** {portfolio['cagr']:.2%}")
        if 'volatility' in portfolio:
            lines.append(f"**Volatility:** {portfolio['volatility']:.2%}")
        if 'max_drawdown' in portfolio:
            lines.append(f"**Max Drawdown:** {portfolio['max_drawdown']:.2%}")
        if 'sharpe_ratio' in portfolio:
            lines.append(f"**Sharpe Ratio:** {portfolio['sharpe_ratio']:.2f}")
        
        if 'rolling_12m_returns' in portfolio:
            lines.append("\n### Rolling 12-Month Returns")
            rolling = portfolio['rolling_12m_returns']
            if isinstance(rolling, dict):
                if 'mean' in rolling:
                    lines.append(f"- Average: {rolling['mean']:.2%}")
                if 'std' in rolling:
                    lines.append(f"- Std Dev: {rolling['std']:.2%}")
                if 'min' in rolling:
                    lines.append(f"- Min: {rolling['min']:.2%}")
                if 'max' in rolling:
                    lines.append(f"- Max: {rolling['max']:.2%}")
    
    # Metrics table
    if 'metrics_table' in data and isinstance(data['metrics_table'], list):
        lines.append("\n## Performance Comparison\n")
        lines.append("| Metric | Portfolio | Benchmark |")
        lines.append("|--------|-----------|-----------|")
        for row in data['metrics_table'][1:]:  # Skip header
            if len(row) >= 3:
                lines.append(f"| {row[0]} | {row[1]} | {row[2]} |")
    
    # Chart placeholder
    if include_charts:
        lines.append("\n## Performance Chart\n")
        lines.append("![Performance Chart](CHART_S3_KEY_PLACEHOLDER)")
    
    return '\n'.join(lines)


def format_rolling_returns_table(rolling_data: dict, max_rows: int = 20) -> str:
    """
    Format rolling returns data as a markdown table.
    
    Args:
        rolling_data: Dictionary with 'dates' and 'returns' arrays
        max_rows: Maximum number of rows to include (for readability)
        
    Returns:
        Markdown table string
    """
    if not isinstance(rolling_data, dict) or 'dates' not in rolling_data or 'returns' not in rolling_data:
        return "(Rolling returns data not available)"
    
    dates = rolling_data['dates']
    returns = rolling_data['returns']
    
    lines = ["### Rolling 12-Month Returns", "", "| Date | Return |", "|------|--------|"]
    
    # Show first few and last few rows if there are many
    if len(dates) > max_rows:
        for i in range(min(5, len(dates))):
            date_str = dates[i][:10] if len(dates[i]) > 10 else dates[i]
            ret_str = f"{returns[i]:.2%}" if i < len(returns) else "N/A"
            lines.append(f"| {date_str} | {ret_str} |")
        
        lines.append("| ... | ... |")
        
        for i in range(max(0, len(dates) - 5), len(dates)):
            date_str = dates[i][:10] if len(dates[i]) > 10 else dates[i]
            ret_str = f"{returns[i]:.2%}" if i < len(returns) else "N/A"
            lines.append(f"| {date_str} | {ret_str} |")
    else:
        for i in range(len(dates)):
            date_str = dates[i][:10] if len(dates[i]) > 10 else dates[i]
            ret_str = f"{returns[i]:.2%}" if i < len(returns) else "N/A"
            lines.append(f"| {date_str} | {ret_str} |")
    
    return '\n'.join(lines)

