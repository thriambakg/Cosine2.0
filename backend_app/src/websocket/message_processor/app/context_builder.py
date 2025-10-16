"""
Context Builder for AI Chat
Builds enriched prompts from context items (tiles, articles, chat sessions)
"""

import json
from typing import List, Dict, Any


def build_context_prompt(user_message: str, context_items: List[Dict[str, Any]]) -> str:
    """
    Build an enriched system prompt from context items
    
    Args:
        user_message: The user's question
        context_items: List of context items with their data
        
    Returns:
        Enriched prompt string to send to AI
    """
    if not context_items:
        return user_message
    
    prompt_parts = [
        "You are a financial analysis AI assistant with access to real-time market data.",
        "The user has provided the following context for analysis:\n"
    ]
    
    # Add each context item to prompt
    for i, item in enumerate(context_items, 1):
        item_type = item.get('type')
        
        if item_type == 'tile':
            prompt_parts.append(format_tile_context(i, item))
        elif item_type == 'article':
            prompt_parts.append(format_article_context(i, item))
        elif item_type == 'chat':
            prompt_parts.append(format_chat_context(i, item))
        elif item_type == 'stock_data':
            # Handle stock data from screener
            prompt_parts.append(format_stock_data(i, item.get('title', 'Stock'), item.get('data', {})))
        elif item_type == 'custom':
            # Handle other custom types
            prompt_parts.append(format_tile_context(i, item))
        elif item_type == 'file':
            # Handle uploaded files
            prompt_parts.append(format_file_context(i, item.get('data', {})))
        else:
            prompt_parts.append(f"[Context Item {i}: Unknown Type]")
    
    # Add user's question
    prompt_parts.append(f"\n\nUser Question: {user_message}")
    prompt_parts.append("\nPlease provide a comprehensive analysis based on the context provided above.")
    
    return "\n".join(prompt_parts)


def format_tile_context(index: int, item: Dict[str, Any]) -> str:
    """Format tile data for prompt"""
    item_type = item.get('type')
    tile_data = item.get('data', {})
    tile_type = tile_data.get('tileType') or tile_data.get('type')
    title = item.get('title', 'Unknown Tile')
    
    # Debug logging
    import logging
    logger = logging.getLogger()
    logger.info(f"🔍 Formatting context item {index}: item_type={item_type}, tile_type={tile_type}, title={title}")
    
    # Handle stock_data from screener (type: 'custom' with type: 'stock_data')
    if tile_type == 'stock_data':
        logger.info(f"📊 Formatting as stock_data")
        return format_stock_data(index, title, tile_data)
    elif tile_type == 'stock':
        logger.info(f"📈 Formatting as stock tile")
        return format_stock_tile(index, title, tile_data)
    elif tile_type == 'crypto':
        logger.info(f"₿ Formatting as crypto tile")
        return format_crypto_tile(index, title, tile_data)
    elif tile_type == 'news':
        logger.info(f"📰 Formatting as news tile")
        return format_news_tile(index, title, tile_data)
    else:
        logger.warning(f"⚠️ Unknown tile type, using default format")
        return f"[Context Item {index}: {title}]"


def format_stock_data(index: int, title: str, stock_data: Dict[str, Any]) -> str:
    """Format stock data from screener"""
    # Handle both Decimal and float types
    def safe_float(value, default=0):
        """Safely convert Decimal or float to float"""
        if value is None:
            return default
        try:
            return float(value)
        except (ValueError, TypeError):
            return default
    
    symbol = stock_data.get('symbol', 'Unknown')
    name = stock_data.get('name', symbol)
    timeframe = stock_data.get('timeframe', 'Unknown')
    sector = stock_data.get('sector', 'Unknown')
    industry = stock_data.get('industry', 'Unknown')
    
    result = f"\n[Context Item {index}: Stock - {symbol}]\n"
    result += f"Company: {name}\n"
    result += f"Sector: {sector}\n"
    result += f"Industry: {industry}\n"
    result += f"Timeframe: {timeframe}\n\n"
    
    result += "Market Data:\n"
    
    # Price information
    price = safe_float(stock_data.get('price'))
    if price:
        result += f"  - Current Price: ${price:.2f}\n"
    
    price_change = stock_data.get('priceChange')
    if price_change is not None:
        result += f"  - Price Change: ${safe_float(price_change):.2f}\n"
    
    price_change_percent = stock_data.get('priceChangePercent')
    if price_change_percent is not None:
        result += f"  - Price Change %: {safe_float(price_change_percent):.2f}%\n"
    
    # Market metrics
    market_cap = safe_float(stock_data.get('marketCap'))
    if market_cap:
        if market_cap >= 1e12:
            result += f"  - Market Cap: ${market_cap/1e12:.2f}T\n"
        elif market_cap >= 1e9:
            result += f"  - Market Cap: ${market_cap/1e9:.2f}B\n"
        elif market_cap >= 1e6:
            result += f"  - Market Cap: ${market_cap/1e6:.2f}M\n"
        else:
            result += f"  - Market Cap: ${market_cap:,.0f}\n"
    
    volatility = safe_float(stock_data.get('volatility'))
    if volatility:
        result += f"  - Volatility: {volatility:.2f}%\n"
    
    volume = safe_float(stock_data.get('volume'))
    if volume:
        result += f"  - Volume: {int(volume):,}\n"
    
    avg_volume = safe_float(stock_data.get('avgVolume'))
    if avg_volume:
        result += f"  - Avg Volume: {int(avg_volume):,}\n"
    
    # Fundamental metrics
    pe_ratio = safe_float(stock_data.get('peRatio'))
    if pe_ratio and pe_ratio > 0:
        result += f"  - P/E Ratio: {pe_ratio:.2f}\n"
    
    dividend_yield = safe_float(stock_data.get('dividendYield'))
    if dividend_yield and dividend_yield > 0:
        result += f"  - Dividend Yield: {dividend_yield:.2f}%\n"
    
    # Price ranges
    day_high = safe_float(stock_data.get('dayHigh'))
    day_low = safe_float(stock_data.get('dayLow'))
    if day_high and day_low:
        result += f"  - Day Range: ${day_low:.2f} - ${day_high:.2f}\n"
    
    year_high = safe_float(stock_data.get('yearHigh'))
    year_low = safe_float(stock_data.get('yearLow'))
    if year_high and year_low:
        result += f"  - 52-Week Range: ${year_low:.2f} - ${year_high:.2f}\n"
    
    week_return = stock_data.get('weekReturn')
    if week_return is not None:
        result += f"  - Week Return: {safe_float(week_return):.2f}%\n"
    
    previous_close = safe_float(stock_data.get('previousClose'))
    if previous_close:
        result += f"  - Previous Close: ${previous_close:.2f}\n"
    
    return result


def format_stock_tile(index: int, title: str, tile_data: Dict[str, Any]) -> str:
    """Format stock tile data"""
    symbol = tile_data.get('symbol', 'Unknown')
    timeframe = tile_data.get('timeframe', 'Unknown')
    backend_data = tile_data.get('backendData', {})
    
    result = f"\n[Context Item {index}: Stock Data - {symbol}]\n"
    result += f"Timeframe: {timeframe}\n"
    
    # Add tile metadata
    grid_position = tile_data.get('gridPosition')
    grid_size = tile_data.get('gridSize')
    display_options = tile_data.get('displayOptions')
    is_pinned = tile_data.get('isPinned', False)
    
    if grid_position:
        result += f"Dashboard Position: Grid ({grid_position.get('x')}, {grid_position.get('y')})\n"
    if grid_size:
        result += f"Dashboard Size: {grid_size.get('width')}x{grid_size.get('height')} grid units\n"
    if is_pinned:
        result += "Status: Pinned to dashboard\n"
    if display_options:
        enabled_options = [k for k, v in display_options.items() if v]
        if enabled_options:
            result += f"Display Options: {', '.join(enabled_options)}\n"
    
    if backend_data:
        # Extract key metrics
        current_price = backend_data.get('current_price')
        price_change = backend_data.get('price_change_24h')
        annual_return = backend_data.get('annual_return')
        volatility = backend_data.get('volatility')
        
        result += "\nMarket Data:\n"
        if current_price:
            result += f"  - Current Price: ${current_price:.2f}\n"
        if price_change:
            result += f"  - 24h Change: ${price_change:.2f}\n"
        if annual_return:
            result += f"  - Annual Return: {annual_return:.2f}%\n"
        if volatility:
            result += f"  - Volatility: {volatility:.4f}\n"
    
    return result


def format_crypto_tile(index: int, title: str, tile_data: Dict[str, Any]) -> str:
    """Format crypto tile data"""
    symbol = tile_data.get('symbol', 'Unknown')
    timeframe = tile_data.get('timeframe', 'Unknown')
    backend_data = tile_data.get('backendData', {})
    
    result = f"\n[Context Item {index}: Crypto Data - {symbol}]\n"
    result += f"Timeframe: {timeframe}\n"
    
    # Add tile metadata
    grid_position = tile_data.get('gridPosition')
    grid_size = tile_data.get('gridSize')
    display_options = tile_data.get('displayOptions')
    is_pinned = tile_data.get('isPinned', False)
    
    if grid_position:
        result += f"Dashboard Position: Grid ({grid_position.get('x')}, {grid_position.get('y')})\n"
    if grid_size:
        result += f"Dashboard Size: {grid_size.get('width')}x{grid_size.get('height')} grid units\n"
    if is_pinned:
        result += "Status: Pinned to dashboard\n"
    if display_options:
        enabled_options = [k for k, v in display_options.items() if v]
        if enabled_options:
            result += f"Display Options: {', '.join(enabled_options)}\n"
    
    if backend_data and 'data' in backend_data:
        crypto_list = backend_data['data']
        if crypto_list and len(crypto_list) > 0:
            crypto = crypto_list[0]
            result += "\nMarket Data:\n"
            
            # Extract and format key metrics with proper labels
            # Handle both camelCase (from API) and snake_case (if standardized later)
            current_price = crypto.get('currentPrice') or crypto.get('current_price')
            price_change_24h = crypto.get('return24h') or crypto.get('price_change_24h')
            week_return = crypto.get('weekReturn') or crypto.get('week_return')
            annual_return = crypto.get('annualReturn') or crypto.get('annual_return')
            volatility = crypto.get('annualizedVolatility') or crypto.get('volatility')
            market_cap = crypto.get('marketCap') or crypto.get('market_cap')
            volume_24h = crypto.get('volume24h') or crypto.get('volume_24h')
            chart_data = crypto.get('chartData') or crypto.get('chart_data', [])
            
            if current_price is not None:
                result += f"  - Current Price: ${current_price:,.2f}\n"
            if price_change_24h is not None:
                result += f"  - 24h Price Change: {price_change_24h:,.2f}%\n"
            if week_return is not None:
                result += f"  - 7-Day Return: {week_return:.2f}%\n"
            if annual_return is not None:
                result += f"  - Annual Return: {annual_return:.2f}%\n"
            if volatility is not None:
                result += f"  - Annualized Volatility: {volatility:.2f}%\n"
            if market_cap is not None:
                result += f"  - Market Cap: ${market_cap:,.0f}\n"
            if volume_24h is not None:
                result += f"  - 24h Volume: ${volume_24h:,.0f}\n"
            if chart_data and len(chart_data) > 0:
                result += f"  - Historical Data: {len(chart_data)} data points over {timeframe}\n"
                # Extract price range from chart data
                prices = [p.get('price') or p.get('value') or p.get('close', 0) for p in chart_data if isinstance(p, dict)]
                if prices:
                    result += f"  - Price Range (Period): ${min(prices):,.2f} - ${max(prices):,.2f}\n"
    
    return result


def format_news_tile(index: int, title: str, tile_data: Dict[str, Any]) -> str:
    """Format news tile data"""
    backend_data = tile_data.get('backendData', {})
    articles = backend_data.get('articles', [])
    total_count = backend_data.get('total_count', len(articles))
    filters = backend_data.get('filters', {})
    
    result = f"\n[Context Item {index}: News Articles]\n"
    
    # Add tile metadata
    grid_position = tile_data.get('gridPosition')
    grid_size = tile_data.get('gridSize')
    is_pinned = tile_data.get('isPinned', False)
    
    if grid_position:
        result += f"Dashboard Position: Grid ({grid_position.get('x')}, {grid_position.get('y')})\n"
    if grid_size:
        result += f"Dashboard Size: {grid_size.get('width')}x{grid_size.get('height')} grid units\n"
    if is_pinned:
        result += "Status: Pinned to dashboard\n"
    
    if filters:
        result += f"Filters Applied: {json.dumps(filters, indent=2)}\n"
    
    result += f"Total Articles: {total_count}\n"
    result += f"Showing: {len(articles)} articles\n\n"
    
    # List articles (limit to 10 for brevity)
    for i, article in enumerate(articles[:10], 1):
        result += f"  {i}. {article.get('title', 'No title')}\n"
        result += f"     Source: {article.get('source', 'Unknown')}\n"
        result += f"     URL: {article.get('url', 'N/A')}\n"
        if article.get('published_date'):
            result += f"     Published: {article.get('published_date')}\n"
        result += "\n"
    
    if len(articles) > 10:
        result += f"  ... and {len(articles) - 10} more articles\n"
    
    return result


def format_article_context(index: int, item: Dict[str, Any]) -> str:
    """Format individual article for prompt"""
    article_data = item.get('data', {})
    title = item.get('title', 'No title')
    
    result = f"\n[Context Item {index}: News Article]\n"
    result += f"Title: {title}\n"
    result += f"Source: {article_data.get('source', 'Unknown')}\n"
    result += f"URL: {article_data.get('url', 'N/A')}\n"
    
    if article_data.get('description'):
        result += f"Description: {article_data.get('description')}\n"
    if article_data.get('published_date'):
        result += f"Published: {article_data.get('published_date')}\n"
    
    result += "\nNote: Full article content can be retrieved if needed using the web_article_reader tool.\n"
    
    return result


def format_chat_context(index: int, item: Dict[str, Any]) -> str:
    """Format chat session for prompt"""
    chat_data = item.get('data', {})
    messages = chat_data.get('messages', [])
    model = chat_data.get('model', 'Unknown')
    message_count = chat_data.get('message_count', len(messages))
    
    result = f"\n[Context Item {index}: Previous Chat Session]\n"
    result += f"Model: {model}\n"
    result += f"Total Messages: {message_count}\n"
    result += f"Showing: {len(messages)} messages (trimmed for context)\n\n"
    
    # Format conversation
    result += "Conversation:\n"
    for msg in messages:
        sender = msg.get('sender', 'unknown').upper()
        text = msg.get('text', '')
        # Truncate long messages
        if len(text) > 500:
            text = text[:500] + "..."
        result += f"  {sender}: {text}\n\n"
    
    return result


def extract_context_summary(context_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Extract a summary of context items for session metadata
    
    Returns:
        Dictionary with context summary
    """
    summary = {
        'total_items': len(context_items),
        'by_type': {},
        'symbols': [],
        'article_count': 0,
    }
    
    for item in context_items:
        item_type = item.get('type')
        
        # Count by type
        summary['by_type'][item_type] = summary['by_type'].get(item_type, 0) + 1
        
        # Extract symbols
        if item_type == 'tile':
            tile_data = item.get('data', {})
            symbol = tile_data.get('symbol')
            if symbol:
                summary['symbols'].append(symbol)
        
        # Count articles
        if item_type == 'article':
            summary['article_count'] += 1
        elif item_type == 'tile' and tile_data.get('tileType') == 'news':
            backend_data = tile_data.get('backendData', {})
            articles = backend_data.get('articles', [])
            summary['article_count'] += len(articles)
    
    return summary


def format_file_context(index: int, file_item: Dict[str, Any]) -> str:
    """
    Format uploaded file context for AI prompt
    
    Args:
        index: Context item index
        file_item: File item with S3 key/URL
        
    Returns:
        Formatted file context string
    """
    try:
        filename = file_item.get('original_filename', 'Unknown File')
        content_type = file_item.get('content_type', '')
        file_size = file_item.get('file_size', 0)
        s3_key = file_item.get('s3_key', '')
        s3_url = file_item.get('s3_url', '')
        
        # Format file size
        if file_size > 1024 * 1024:
            size_str = f"{file_size / (1024 * 1024):.1f} MB"
        elif file_size > 1024:
            size_str = f"{file_size / 1024:.1f} KB"
        else:
            size_str = f"{file_size} bytes"
        
        context_parts = [
            f"[Context Item {index}: Uploaded File]",
            f"File: {filename}",
            f"Type: {content_type}",
            f"Size: {size_str}",
            f"S3 Key: {s3_key}",
            f"S3 URL: {s3_url}",
            f"Content: [Use read_s3_file_tool with S3 key to read file content]"
        ]
        
        return "\n".join(context_parts)
        
    except Exception as e:
        return f"[Context Item {index}: File Error - {str(e)}]"
