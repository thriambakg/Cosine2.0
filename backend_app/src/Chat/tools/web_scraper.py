"""
Web Scraper Tool for fetching article content from URLs
Allows the agent to fetch and parse web content, especially for article context items
"""

import requests
import logging
from typing import Dict, Any, Optional
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import re

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

# Standard headers to mimic a browser
DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
}

def extract_article_content(html_content: str, url: str) -> Dict[str, Any]:
    """
    Extract article content from HTML using BeautifulSoup
    
    Args:
        html_content: Raw HTML content
        url: Source URL for context
        
    Returns:
        Dictionary with extracted article content
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "noscript"]):
            script.decompose()
        
        # Try to find article content using common patterns
        article_content = None
        article_text = ""
        
        # Try various article selectors
        article_selectors = [
            'article',
            '[role="article"]',
            '.article-content',
            '.article-body',
            '.post-content',
            '.entry-content',
            '.content',
            'main article',
            '#article-content',
            '#article-body',
        ]
        
        for selector in article_selectors:
            article = soup.select_one(selector)
            if article:
                article_content = article
                break
        
        # If no article tag found, try to find main content area
        if not article_content:
            main = soup.find('main')
            if main:
                article_content = main
            else:
                # Fallback to body
                article_content = soup.find('body')
        
        if article_content:
            # Extract text content
            article_text = article_content.get_text(separator='\n', strip=True)
            
            # Clean up excessive whitespace
            article_text = re.sub(r'\n\s*\n\s*\n+', '\n\n', article_text)
            article_text = article_text.strip()
        
        # Extract title
        title = None
        title_selectors = [
            'h1',
            'title',
            '.article-title',
            '.post-title',
            '.entry-title',
            '[property="og:title"]',
        ]
        
        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                if title_elem.name == 'meta':
                    title = title_elem.get('content', '')
                else:
                    title = title_elem.get_text(strip=True)
                if title:
                    break
        
        if not title:
            title = soup.find('title')
            if title:
                title = title.get_text(strip=True)
        
        # Extract meta description
        description = None
        meta_desc = soup.find('meta', attrs={'name': 'description'}) or soup.find('meta', attrs={'property': 'og:description'})
        if meta_desc:
            description = meta_desc.get('content', '')
        
        return {
            'title': title or 'Untitled',
            'description': description,
            'content': article_text,
            'url': url,
            'content_length': len(article_text),
            'extraction_method': 'html_parsing'
        }
        
    except Exception as e:
        logger.error(f"Error extracting article content: {str(e)}")
        return {
            'title': 'Error',
            'content': f"Error extracting content: {str(e)}",
            'url': url,
            'extraction_method': 'error'
        }

@tool
def fetch_web_content_tool(url: str) -> str:
    """
    Fetch and extract content from a web URL, especially useful for article context items.
    
    This tool is designed to:
    - Fetch HTML content from web URLs
    - Extract article text, title, and metadata
    - Handle common article website structures
    - Return clean, readable text content
    
    Use this tool when:
    - A context item has type "article" and contains a URL
    - You need to read the full content of an article from a URL
    - The article ID contains a URL (e.g., "article_https://example.com/article")
    
    Args:
        url: The URL to fetch content from (must start with http:// or https://)
        
    Returns:
        String containing the extracted article content, title, and metadata, or an error message
    """
    try:
        if not url:
            return "Error: URL parameter is required"
        
        # Validate URL format
        if not url.startswith(('http://', 'https://')):
            return f"Error: Invalid URL format. URL must start with http:// or https://. Got: {url}"
        
        logger.info(f"Fetching web content from: {url}")
        agent_logger.info(f"🌐 Fetching web content from: {url}")
        
        # Make HTTP request
        try:
            response = requests.get(url, headers=DEFAULT_HEADERS, timeout=30, allow_redirects=True)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            error_msg = f"Error fetching URL {url}: {str(e)}"
            logger.error(error_msg)
            return error_msg
        
        # Check content type
        content_type = response.headers.get('Content-Type', '').lower()
        if 'text/html' not in content_type:
            return f"Error: URL does not return HTML content. Content-Type: {content_type}"
        
        # Extract article content
        extracted = extract_article_content(response.text, url)
        
        # Format response
        result_parts = [
            f"📄 Article Content from {url}",
            f"\nTitle: {extracted['title']}",
        ]
        
        if extracted.get('description'):
            result_parts.append(f"Description: {extracted['description']}")
        
        result_parts.append(f"\nContent ({extracted['content_length']} characters):")
        result_parts.append("=" * 80)
        result_parts.append(extracted['content'])
        result_parts.append("=" * 80)
        result_parts.append(f"\nSource URL: {url}")
        
        logger.info(f"Successfully extracted {extracted['content_length']} characters from {url}")
        agent_logger.info(f"✅ Successfully extracted article content ({extracted['content_length']} chars)")
        
        return "\n".join(result_parts)
        
    except Exception as e:
        error_msg = f"Error in fetch_web_content_tool: {str(e)}"
        logger.error(error_msg)
        import traceback
        logger.error(traceback.format_exc())
        return error_msg

