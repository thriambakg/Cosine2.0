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
        else:
            prompt_parts.append(f"[Context Item {i}: Unknown Type]")
    
    # Add user's question
    prompt_parts.append(f"\n\nUser Question: {user_message}")
    prompt_parts.append("\nPlease provide a comprehensive analysis based on the context provided above.")
    
    return "\n".join(prompt_parts)


def format_tile_context(index: int, item: Dict[str, Any]) -> str:
    """Format tile data for prompt"""
    tile_data = item.get('data', {})
    tile_type = tile_data.get('tileType')
    title = item.get('title', 'Unknown Tile')
    
    if tile_type == 'stock':
        return format_stock_tile(index, title, tile_data)
    elif tile_type == 'crypto':
        return format_crypto_tile(index, title, tile_data)
    elif tile_type == 'news':
        return format_news_tile(index, title, tile_data)
    else:
        return f"[Context Item {index}: {title}]"


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
            
            # Extract metrics
            for key, value in crypto.items():
                if key not in ['symbol', 'name']:
                    result += f"  - {key.replace('_', ' ').title()}: {value}\n"
    
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
