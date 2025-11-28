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
        logger.info(f"📄 Starting article extraction from {url}")
        logger.info(f"📄 HTML content length: {len(html_content)} characters")
        
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Log page structure
        logger.info(f"📄 Page title: {soup.find('title').get_text(strip=True) if soup.find('title') else 'No title found'}")
        
        # Remove script and style elements (but keep structure)
        removed_count = 0
        for tag_type in ["script", "style", "noscript", "iframe"]:
            for tag in soup.find_all(tag_type):
                tag.decompose()
                removed_count += 1
        logger.info(f"📄 Removed {removed_count} script/style/iframe tags")
        
        # Remove navigation, header, footer, aside (but log what we're removing)
        for tag_type in ["nav", "header", "footer", "aside"]:
            for tag in soup.find_all(tag_type):
                tag.decompose()
        
        logger.info(f"📄 After removing scripts/styles/nav/header/footer, remaining HTML length: {len(str(soup))} characters")
        
        # Log available main content areas
        main_tags = soup.find_all(['main', 'article', 'section'])
        logger.info(f"📄 Found {len(main_tags)} potential main content areas (main/article/section tags)")
        for i, tag in enumerate(main_tags[:5]):  # Log first 5
            text_preview = tag.get_text(strip=True)[:100]
            classes = ' '.join(tag.get('class', []))
            logger.info(f"📄   {i+1}. <{tag.name}> class='{classes}' - {len(tag.get_text(strip=True))} chars - Preview: {text_preview}...")
        
        # Try to find article content using common patterns
        article_content = None
        article_text = ""
        selector_used = None
        
        # Try various article selectors (ordered by specificity)
        article_selectors = [
            'article',
            '[role="article"]',
            'main article',
            '.article-content',
            '.article-body',
            '.post-content',
            '.entry-content',
            '.story-body',
            '.post-body',
            '.article-text',
            '.article-main',
            '.article-wrapper',
            '.content-wrapper',
            '#article-content',
            '#article-body',
            '#main-content',
            '#content',
            '.content',
            'main',
            '[class*="article"]',
            '[class*="story"]',
            '[class*="post"]',
            '[class*="entry"]',
            '[id*="article"]',
            '[id*="content"]',
            '[id*="main"]',
            'section[class*="content"]',
            'div[class*="article"]',
            'div[class*="story"]',
        ]
        
        logger.info(f"📄 Trying {len(article_selectors)} article selectors...")
        for selector in article_selectors:
            try:
                article = soup.select_one(selector)
                if article:
                    text_length = len(article.get_text(strip=True))
                    logger.info(f"✅ Found content with selector '{selector}': {text_length} characters")
                    if text_length > len(article_text):
                        article_content = article
                        article_text = article_content.get_text(separator='\n', strip=True)
                        selector_used = selector
            except Exception as e:
                logger.debug(f"⚠️ Selector '{selector}' failed: {str(e)}")
                continue
        
        # If no article tag found, try to find main content area
        if not article_content or len(article_text) < 500:
            logger.info("📄 No suitable article found, trying main content area...")
            main = soup.find('main')
            if main:
                main_text = main.get_text(separator='\n', strip=True)
                logger.info(f"📄 Found <main> tag with {len(main_text)} characters")
                if len(main_text) > len(article_text):
                    article_content = main
                    article_text = main_text
                    selector_used = 'main'
        
        # Try to find content by looking for large text blocks
        if not article_content or len(article_text) < 500:
            logger.info("📄 Trying to find large text blocks (fallback method)...")
            # Find all divs, sections, articles, and main tags, look for ones with substantial text
            all_elements = soup.find_all(['div', 'section', 'article', 'main'])
            best_element = None
            best_length = 0
            candidates = []
            
            for elem in all_elements:
                # Skip if it's likely navigation or header/footer
                classes = ' '.join(elem.get('class', [])).lower()
                elem_id = elem.get('id', '').lower()
                
                # Skip navigation/header/footer elements
                if any(skip in classes or skip in elem_id for skip in ['nav', 'header', 'footer', 'sidebar', 'menu', 'ad', 'advertisement', 'comment', 'social', 'share', 'related', 'widget']):
                    continue
                
                text = elem.get_text(separator=' ', strip=True)
                if len(text) > 300:  # Consider blocks with at least 300 chars
                    candidates.append((elem, len(text), classes, elem_id))
                    if len(text) > best_length:
                        best_length = len(text)
                        best_element = elem
            
            # Log top candidates
            if candidates:
                candidates.sort(key=lambda x: x[1], reverse=True)
                logger.info(f"📄 Found {len(candidates)} candidate text blocks:")
                for i, (elem, length, classes, elem_id) in enumerate(candidates[:5]):
                    logger.info(f"📄   {i+1}. {length} chars - <{elem.name}> class='{classes[:50]}' id='{elem_id[:30]}'")
            
            if best_element and best_length > len(article_text):
                logger.info(f"✅ Selected large text block with {best_length} characters")
                article_content = best_element
                article_text = best_element.get_text(separator='\n', strip=True)
                selector_used = 'large_text_block'
        
        # Final fallback to body (but try to clean it up first)
        if not article_content or len(article_text) < 500:
            logger.warning("📄 Using body as final fallback...")
            body = soup.find('body')
            if body:
                # Try to remove common non-content elements from body
                for tag in body.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style']):
                    tag.decompose()
                
                body_text = body.get_text(separator='\n', strip=True)
                logger.info(f"📄 Body text length: {len(body_text)} characters")
                
                if len(body_text) > len(article_text):
                    article_content = body
                    article_text = body_text
                    selector_used = 'body_cleaned'
        
        if article_content:
            # Extract text content
            if not article_text:
                article_text = article_content.get_text(separator='\n', strip=True)
            
            # Clean up excessive whitespace
            article_text = re.sub(r'\n\s*\n\s*\n+', '\n\n', article_text)
            article_text = article_text.strip()
            
            logger.info(f"📄 Final extracted text length: {len(article_text)} characters")
            logger.info(f"📄 Selector used: {selector_used}")
            logger.info(f"📄 First 200 chars of extracted text: {article_text[:200]}...")
        
        # Extract title
        title = None
        title_selectors = [
            'h1',
            'title',
            '.article-title',
            '.post-title',
            '.entry-title',
            '[property="og:title"]',
            '[name="og:title"]',
            'h1.article-title',
            'h1.post-title',
            '.headline',
            '.story-headline',
        ]
        
        logger.info(f"📄 Trying {len(title_selectors)} title selectors...")
        for selector in title_selectors:
            try:
                title_elem = soup.select_one(selector)
                if title_elem:
                    if title_elem.name == 'meta':
                        title = title_elem.get('content', '')
                    else:
                        title = title_elem.get_text(strip=True)
                    if title and len(title) > 10:  # Ensure it's a real title
                        logger.info(f"✅ Found title with selector '{selector}': {title[:100]}")
                        break
            except Exception as e:
                logger.debug(f"⚠️ Title selector '{selector}' failed: {str(e)}")
                continue
        
        if not title:
            title_tag = soup.find('title')
            if title_tag:
                title = title_tag.get_text(strip=True)
                logger.info(f"📄 Using <title> tag: {title[:100]}")
        
        # Extract meta description
        description = None
        meta_desc = soup.find('meta', attrs={'name': 'description'}) or soup.find('meta', attrs={'property': 'og:description'})
        if meta_desc:
            description = meta_desc.get('content', '')
        
        result = {
            'title': title or 'Untitled',
            'description': description,
            'content': article_text,
            'url': url,
            'content_length': len(article_text),
            'extraction_method': selector_used or 'html_parsing'
        }
        
        logger.info(f"📄 Extraction complete: {result['content_length']} characters, method: {result['extraction_method']}")
        
        # Log warning if content seems too short
        if len(article_text) < 500:
            logger.warning(f"⚠️ Extracted content seems short ({len(article_text)} chars). This might indicate extraction issues.")
            logger.warning(f"⚠️ Consider checking the page structure or trying different selectors.")
            # Log some HTML structure for debugging
            if article_content:
                logger.warning(f"📄 Article element tag: {article_content.name}, classes: {article_content.get('class', [])}")
                logger.warning(f"📄 Article element HTML preview: {str(article_content)[:1000]}...")
            else:
                logger.warning(f"📄 No article_content found! Logging page structure...")
                # Log all major elements
                for tag_name in ['article', 'main', 'section', 'div']:
                    tags = soup.find_all(tag_name, limit=10)
                    if tags:
                        logger.warning(f"📄 Found {len(soup.find_all(tag_name))} <{tag_name}> tags")
                        for i, tag in enumerate(tags[:3]):
                            classes = ' '.join(tag.get('class', []))
                            text_len = len(tag.get_text(strip=True))
                            logger.warning(f"📄   {i+1}. class='{classes[:50]}' - {text_len} chars")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Error extracting article content: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
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
        
        logger.info(f"🌐 Fetching web content from: {url}")
        agent_logger.info(f"🌐 Fetching web content from: {url}")
        
        # Make HTTP request
        try:
            response = requests.get(url, headers=DEFAULT_HEADERS, timeout=30, allow_redirects=True)
            response.raise_for_status()
            logger.info(f"✅ HTTP {response.status_code} - Content-Type: {response.headers.get('Content-Type', 'unknown')}")
            logger.info(f"📄 Response size: {len(response.text)} characters")
        except requests.exceptions.RequestException as e:
            error_msg = f"Error fetching URL {url}: {str(e)}"
            logger.error(error_msg)
            return error_msg
        
        # Check content type
        content_type = response.headers.get('Content-Type', '').lower()
        logger.info(f"📄 Content-Type: {content_type}")
        if 'text/html' not in content_type:
            logger.warning(f"⚠️ URL does not return HTML content. Content-Type: {content_type}")
            return f"Error: URL does not return HTML content. Content-Type: {content_type}"
        
        # Log HTML structure for debugging
        logger.info(f"📄 HTML preview (first 500 chars): {response.text[:500]}...")
        
        # Extract article content
        extracted = extract_article_content(response.text, url)
        
        logger.info(f"📄 Extraction result: {extracted['content_length']} characters extracted using method: {extracted['extraction_method']}")
        
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

