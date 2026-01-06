"""
News Search Lambda Function
Provides search functionality for news articles stored in DynamoDB
Uses GSI5 for title-based search with cursor-based pagination
"""

import json
import boto3
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from decimal import Decimal
import sys

# Add parent directory to path to import cors_helper
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
NEWS_TABLE_NAME = os.environ.get('NEWS_TABLE_NAME', 'cosine-news-production')
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '200'))

# Initialize table
table = dynamodb.Table(NEWS_TABLE_NAME)


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder for Decimal types"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def convert_from_dynamodb_format(item: Dict[str, Any]) -> Dict[str, Any]:
    """Convert DynamoDB item to Python dict with proper types"""
    result = {}
    for key, value in item.items():
        if isinstance(value, Decimal):
            result[key] = int(value) if value % 1 == 0 else float(value)
        elif isinstance(value, dict):
            result[key] = convert_from_dynamodb_format(value)
        elif isinstance(value, list):
            result[key] = [
                convert_from_dynamodb_format(v) if isinstance(v, dict) else
                (int(v) if isinstance(v, Decimal) and v % 1 == 0 else float(v) if isinstance(v, Decimal) else v)
                for v in value
            ]
        else:
            result[key] = value
    return result


def convert_to_dynamodb_format(value: Any) -> Any:
    """Convert Python types to DynamoDB-compatible types"""
    if isinstance(value, float):
        return Decimal(str(value))
    elif isinstance(value, int):
        return value
    elif isinstance(value, list):
        return [convert_to_dynamodb_format(item) for item in value]
    elif isinstance(value, dict):
        return {k: convert_to_dynamodb_format(v) for k, v in value.items()}
    return value


def calculate_date_filter(date_from: str = None, date_to: str = None) -> Optional[tuple]:
    """
    Calculate date filter based on explicit date_from/date_to.
    
    Args:
        date_from: Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)
        date_to: End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)
    
    Returns:
        Tuple of (start_date, end_date) in ISO format strings, or (None, None) if no filter
    """
    if not date_from and not date_to:
        return (None, None)
    
    start_date_str = date_from
    end_date_str = date_to
    
    # If only one is provided, set defaults
    if date_from and not date_to:
        end_date_str = None  # No end date filter
    elif date_to and not date_from:
        start_date_str = '1970-01-01T00:00:00Z'  # Very early date
    
    # Ensure dates are in ISO format with Z suffix
    if start_date_str and not start_date_str.endswith('Z'):
        if 'T' in start_date_str:
            start_date_str = start_date_str + 'Z'
        else:
            start_date_str = start_date_str + 'T00:00:00Z'
    
    if end_date_str and not end_date_str.endswith('Z'):
        if 'T' in end_date_str:
            end_date_str = end_date_str + 'Z'
        else:
            end_date_str = end_date_str + 'T23:59:59Z'
    
    return (start_date_str, end_date_str)


def prioritize_keyword_matches(articles: List[Dict[str, Any]], keyword: str) -> List[Dict[str, Any]]:
    """
    Prioritize articles by match quality:
    1. Exact match (case-insensitive) in title
    2. Begins with (case-insensitive) in title
    3. Contains (case-insensitive) in title
    4. Exact match in description or GSI5SK
    5. Begins with in description or GSI5SK
    6. Contains in description or GSI5SK
    
    Args:
        articles: List of article items
        keyword: Search keyword
    
    Returns:
        Sorted list of articles by match priority
    """
    keyword_lower = keyword.lower()
    
    exact_title = []
    begins_title = []
    contains_title = []
    exact_other = []
    begins_other = []
    contains_other = []
    
    for article in articles:
        title = (article.get('title') or '').lower()
        description = (article.get('description') or '').lower()
        gsi5sk = (article.get('GSI5SK') or '').lower()
        
        # Check title matches
        if title == keyword_lower:
            exact_title.append(article)
        elif title.startswith(keyword_lower):
            begins_title.append(article)
        elif keyword_lower in title:
            contains_title.append(article)
        # Check description/GSI5SK matches
        elif description == keyword_lower or gsi5sk == keyword_lower:
            exact_other.append(article)
        elif description.startswith(keyword_lower) or gsi5sk.startswith(keyword_lower):
            begins_other.append(article)
        elif keyword_lower in description or keyword_lower in gsi5sk:
            contains_other.append(article)
    
    # Combine in priority order, maintaining date sort within each group
    return exact_title + begins_title + contains_title + exact_other + begins_other + contains_other


def search_by_keyword(keyword: str, date_filter: Optional[tuple], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Search articles by keyword using table Scan with case-insensitive contains filter.
    Continues scanning until enough matches found or table exhausted.
    Results are prioritized: exact match > begins_with > contains.
    
    Args:
        keyword: Search keyword
        date_filter: Optional tuple of (start_date, end_date) in ISO format strings
        limit: Maximum number of results to return
        last_evaluated_key: DynamoDB LastEvaluatedKey for pagination
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    try:
        from boto3.dynamodb.conditions import Attr
        
        keyword_lower = keyword.lower()
        
        logger.info(f"🔍 Scanning table for keyword: '{keyword}' (date_filter: {date_filter}, limit: {limit})")
        
        # Collect matching articles by scanning until we have enough or exhausted table
        matching_articles = []
        scan_cursor = convert_to_dynamodb_format(last_evaluated_key) if last_evaluated_key else None
        total_scanned = 0
        
        # Continue scanning until we have enough matches or no more items
        while len(matching_articles) < limit:
            scan_params = {
                'Limit': 1000  # Scan in large batches
            }
            
            # Add date filter if provided
            if date_filter:
                start_date, end_date = date_filter
                filter_conditions = []
                if start_date:
                    filter_conditions.append(Attr('published_date').gte(start_date))
                if end_date:
                    filter_conditions.append(Attr('published_date').lte(end_date))
                
                if filter_conditions:
                    combined = filter_conditions[0]
                    for cond in filter_conditions[1:]:
                        combined = combined & cond
                    scan_params['FilterExpression'] = combined
            
            # Use cursor if provided
            if scan_cursor:
                scan_params['ExclusiveStartKey'] = scan_cursor
            
            # Execute scan
            response = table.scan(**scan_params)
            batch_articles = response.get('Items', [])
            total_scanned += len(batch_articles)
            
            # Client-side filter for case-insensitive keyword matching
            for article in batch_articles:
                title = (article.get('title') or '').lower()
                description = (article.get('description') or '').lower()
                gsi5sk = (article.get('GSI5SK') or '').lower()
                
                if keyword_lower in title or keyword_lower in description or keyword_lower in gsi5sk:
                    matching_articles.append(article)
                    
                    # Stop if we have enough
                    if len(matching_articles) >= limit * 2:  # Get extra for prioritization
                        break
            
            # Check if there are more items to scan
            if 'LastEvaluatedKey' not in response:
                # No more items in table
                scan_cursor = None
                break
            else:
                scan_cursor = response['LastEvaluatedKey']
        
        # Sort by published_date descending (most recent first)
        matching_articles.sort(key=lambda x: x.get('published_date', ''), reverse=True)
        
        # Prioritize by match quality
        prioritized_articles = prioritize_keyword_matches(matching_articles, keyword)
        
        # Apply limit
        limited_articles = prioritized_articles[:limit]
        
        # has_more is true only if we have more matched articles OR more to scan
        has_more = len(prioritized_articles) > limit or scan_cursor is not None
        
        logger.info(f"✅ Found {len(limited_articles)} articles for keyword '{keyword}' (scanned {total_scanned}, matched {len(matching_articles)}, has_more: {has_more})")
        
        return {
            'articles': limited_articles,
            'last_evaluated_key': convert_from_dynamodb_format(scan_cursor) if scan_cursor else None,
            'has_more': has_more
        }
        
    except Exception as e:
        logger.error(f"❌ Error searching by keyword '{keyword}': {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'articles': [],
            'last_evaluated_key': None,
            'has_more': False
        }


def search_multiple_keywords(keywords: List[str], date_filter: Optional[tuple], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Search articles across multiple keywords using table scan.
    Continues scanning until enough matches found or table exhausted.
    Client-side filtering with priority: exact > begins_with > contains.
    
    Args:
        keywords: List of keywords to search for
        date_filter: Optional tuple of (start_date, end_date) in ISO format strings
        limit: Maximum number of results to return
        last_evaluated_key: Cursor for pagination
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    try:
        from boto3.dynamodb.conditions import Attr
        
        logger.info(f"🔄 Starting multi-keyword search for {len(keywords)} keywords: {keywords}")
        
        # Collect matching articles by scanning until we have enough or exhausted table
        matching_articles = []
        seen_ids = set()
        scan_cursor = convert_to_dynamodb_format(last_evaluated_key) if last_evaluated_key else None
        total_scanned = 0
        
        # Continue scanning until we have enough matches or no more items
        while len(matching_articles) < limit:
            scan_params = {
                'Limit': 1000  # Scan in large batches
            }
            
            # Add date filter if provided
            if date_filter:
                start_date, end_date = date_filter
                filter_conditions = []
                if start_date:
                    filter_conditions.append(Attr('published_date').gte(start_date))
                if end_date:
                    filter_conditions.append(Attr('published_date').lte(end_date))
                
                if filter_conditions:
                    combined = filter_conditions[0]
                    for cond in filter_conditions[1:]:
                        combined = combined & cond
                    scan_params['FilterExpression'] = combined
            
            # Use cursor if provided
            if scan_cursor:
                scan_params['ExclusiveStartKey'] = scan_cursor
            
            logger.info(f"🔍 Scanning batch (cursor: {scan_cursor is not None})")
            
            # Execute scan
            response = table.scan(**scan_params)
            batch_articles = response.get('Items', [])
            total_scanned += len(batch_articles)
            
            # Client-side filter for all keywords (OR logic, case-insensitive)
            for article in batch_articles:
                title = (article.get('title') or '').lower()
                description = (article.get('description') or '').lower()
                gsi5sk = (article.get('GSI5SK') or '').lower()
                article_id = article.get('SK')
                
                # Check if any keyword matches
                for keyword in keywords:
                    keyword_lower = keyword.lower()
                    if keyword_lower in title or keyword_lower in description or keyword_lower in gsi5sk:
                        if article_id not in seen_ids:
                            seen_ids.add(article_id)
                            matching_articles.append(article)
                        break
                
                # Stop if we have enough
                if len(matching_articles) >= limit * 2:  # Get extra for prioritization
                    break
            
            # Check if there are more items to scan
            if 'LastEvaluatedKey' not in response:
                # No more items in table
                scan_cursor = None
                break
            else:
                scan_cursor = response['LastEvaluatedKey']
        
        # Sort by published_date descending
        matching_articles.sort(key=lambda x: x.get('published_date', ''), reverse=True)
        
        # Prioritize by match quality for first keyword (primary keyword)
        if keywords:
            matching_articles = prioritize_keyword_matches(matching_articles, keywords[0])
        
        # Apply limit
        limited_articles = matching_articles[:limit]
        
        # has_more is true only if we have more matched articles OR more to scan
        has_more = len(matching_articles) > limit or scan_cursor is not None
    
        # Convert from DynamoDB format
        converted_articles = [convert_from_dynamodb_format(item) for item in limited_articles]
        
        logger.info(f"✅ Multi-keyword search complete - results_count: {len(converted_articles)}, total_scanned: {total_scanned}, matched: {len(matching_articles)}, has_more: {has_more}")
        
        return {
            'articles': converted_articles,
            'last_evaluated_key': convert_from_dynamodb_format(scan_cursor) if scan_cursor else None,
            'has_more': has_more
        }
        
    except Exception as e:
        logger.error(f"❌ Error in multi-keyword search: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'articles': [],
            'last_evaluated_key': None,
            'has_more': False
        }


def scan_all_articles(date_filter: Optional[tuple], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Fetch articles by date range using PK queries (NEWS#{date}).
    More efficient than scanning when no keywords provided.
    
    Args:
        date_filter: Tuple of (start_date, end_date) in ISO format strings (YYYY-MM-DD...)
        limit: Maximum number of results to return
        last_evaluated_key: Custom cursor with 'current_date' for date iteration
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    try:
        from boto3.dynamodb.conditions import Key
        from datetime import datetime, timedelta
        
        # Parse date filter
        start_date_str, end_date_str = date_filter if date_filter else (None, None)
        
        # Default to today if no end date
        if end_date_str:
            end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00')).date()
        else:
            end_date = datetime.utcnow().date()
        
        # Default to 30 days ago if no start date
        if start_date_str:
            start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00')).date()
        else:
            start_date = end_date - timedelta(days=30)
        
        # Resume from cursor if provided
        if last_evaluated_key and 'current_date' in last_evaluated_key:
            current_date_str = last_evaluated_key['current_date']
            current_date = datetime.strptime(current_date_str, '%Y-%m-%d').date()
        else:
            current_date = end_date
        
        logger.info(f"📅 Querying by date range: {start_date} to {end_date}, current: {current_date}")
        
        all_articles = []
        
        # Query each date starting from current_date and going backwards
        while current_date >= start_date and len(all_articles) < limit:
            date_str = current_date.strftime('%Y-%m-%d')
            pk = f"NEWS#{date_str}"
            
            logger.info(f"🔍 Querying PK: {pk}")
            
            # Query for this specific date
            response = table.query(
                KeyConditionExpression=Key('PK').eq(pk),
                ScanIndexForward=False  # Most recent first within the day
            )
            
            items = response.get('Items', [])
            logger.info(f"📊 Found {len(items)} articles for {date_str}")
            
            all_articles.extend(items)
            
            # Move to previous day
            current_date -= timedelta(days=1)
            
            # Stop if we've collected enough
            if len(all_articles) >= limit:
                break
        
        # Apply limit
        limited_articles = all_articles[:limit]
        
        # Check if there are more dates to query
        has_more = current_date >= start_date
        
        # Generate cursor for next batch
        next_cursor = None
        if has_more:
            next_cursor = {
                'current_date': current_date.strftime('%Y-%m-%d')
            }
        
        # Convert from DynamoDB format
        converted_articles = [convert_from_dynamodb_format(item) for item in limited_articles]
        
        logger.info(f"✅ Date range query complete - results_count: {len(converted_articles)}, has_more: {has_more}")
        
        return {
            'articles': converted_articles,
            'last_evaluated_key': next_cursor,
            'has_more': has_more
        }
    
    except Exception as e:
        logger.error(f"❌ Error querying articles by date: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'articles': [],
            'last_evaluated_key': None,
            'has_more': False
        }


def extract_keywords_from_query(query_filters: Dict[str, Any]) -> List[str]:
    """
    Extract keywords from query filters.
    Simplified version - just extracts keywords as a list of strings.
    Handles both new format (keywords as list) and old format (complex query structure).
    """
    keywords = []
    
    if not query_filters:
        return keywords
    
    # Handle case where query_filters might be a list (shouldn't happen, but be defensive)
    if isinstance(query_filters, list):
        logger.warning(f"⚠️ query_filters is a list, not a dict: {query_filters}")
        # If it's a list of strings, treat them as keywords
        keywords = [str(k).strip().lower() for k in query_filters if k and str(k).strip()]
        return keywords
    
    # Ensure query_filters is a dict
    if not isinstance(query_filters, dict):
        logger.warning(f"⚠️ query_filters is not a dict: {type(query_filters)}")
        return keywords
    
    # Extract keywords - handle both simple list and complex query structure
    keywords_query = query_filters.get('keywords')
    if keywords_query:
        if isinstance(keywords_query, list):
            # Simple list of keywords (new format)
            keywords = [str(k).strip().lower() for k in keywords_query if k and str(k).strip()]
        elif isinstance(keywords_query, dict):
            # Complex query structure (old format) - extract terms recursively
            keywords = extract_terms_from_query_node(keywords_query)
        elif isinstance(keywords_query, str):
            # Single keyword as string
            keywords = [keywords_query.strip().lower()] if keywords_query.strip() else []
    
    return keywords


def extract_terms_from_query_node(node: Any) -> List[str]:
    """Recursively extract terms from query tree node (old complex format)"""
    if not node:
        return []
    
    # Handle string directly
    if isinstance(node, str):
        return [node.strip().lower()] if node.strip() else []
    
    # Handle list - extract terms from each item
    if isinstance(node, list):
        terms = []
        for item in node:
            terms.extend(extract_terms_from_query_node(item))
        return terms
    
    # Must be a dict to continue
    if not isinstance(node, dict):
        logger.warning(f"⚠️ extract_terms_from_query_node received non-dict, non-list, non-string: {type(node)}")
        return []
    
    node_type = node.get('type')
    
    if node_type == 'term':
        value = node.get('value', '')
        if isinstance(value, str):
            value = value.strip()
            return [value.lower()] if value else []
        elif isinstance(value, list):
            # Handle list of values
            return [str(v).strip().lower() for v in value if v and str(v).strip()]
        return []
    
    elif node_type == 'group' or node_type == 'expression':
        children = node.get('children', [])
        if isinstance(children, list):
            terms = []
            for child in children:
                terms.extend(extract_terms_from_query_node(child))
            return terms
        elif isinstance(children, dict):
            return extract_terms_from_query_node(children)
    
    # If no recognized type, try to extract 'value' field directly
    if 'value' in node:
        value = node.get('value')
        return extract_terms_from_query_node(value)
    
    return []


def search_articles(
    query_filters: Dict[str, Any],
    date_from: str = None,
    date_to: str = None,
    limit: int = 200,
    last_evaluated_key: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Search articles based on query filters.
    
    Args:
        query_filters: Dictionary with 'keywords' key (list of strings)
        date_from: Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)
        date_to: End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)
        limit: Maximum number of results to return
        last_evaluated_key: Cursor for pagination
    
    Returns:
        Dictionary with 'articles', 'total', 'has_more', 'last_evaluated_key'
    """
    # Ensure query_filters is a dict
    if not isinstance(query_filters, dict):
        logger.error(f"❌ query_filters must be a dict, got {type(query_filters)}: {query_filters}")
        return {
            'success': False,
            'error': f'Invalid query_filters type: {type(query_filters)}',
            'articles': [],
            'total': 0
        }
    """
    Search news articles based on filters.
    Similar to search_trades in politician trades search.
    
    Args:
        query_filters: Dictionary of filter criteria (keywords, sources, categories, countries)
        date_range: Date range string ('12h', '24h', '7d', '30d', 'all')
        limit: Number of results per page
        last_evaluated_key: DynamoDB LastEvaluatedKey for cursor-based pagination
    
    Returns:
        Dictionary with results and metadata including last_evaluated_key for next page
    """
    try:
        logger.info(f"🔍 Starting search_articles with filters: {json.dumps(query_filters, default=str)}, date_from: {date_from}, date_to: {date_to}, limit: {limit}")
        
        # Calculate date filter (returns tuple of (start_date, end_date))
        date_filter = calculate_date_filter(date_from=date_from, date_to=date_to)
        
        # Extract keywords from filters
        keywords = extract_keywords_from_query(query_filters)
        
        # If we have keywords, use multi-keyword search
        if keywords and len(keywords) > 0:
            logger.info(f"🔄 Detected keywords search: {keywords}")
            logger.info("✅ Using multi-keyword search (GSI queries and union results)")
            
            result = search_multiple_keywords(keywords, date_filter, limit, last_evaluated_key)
            
            return {
                'success': True,
                'articles': result.get('articles', []),
                'total': len(result.get('articles', [])),  # Approximate total
                'limit': limit,
                'has_more': result.get('has_more', False),
                'last_evaluated_key': result.get('last_evaluated_key')  # Cursor for next "load more" request
            }
        
        # No keywords - scan all articles with date filter
        else:
            logger.info("⚠️ No keywords provided, using scan operation")
            
            result = scan_all_articles(date_filter, limit, last_evaluated_key)
            
            return {
                'success': True,
                'articles': result.get('articles', []),
                'total': len(result.get('articles', [])),  # Approximate for scan
                'limit': limit,
                'has_more': result.get('has_more', False),
                'last_evaluated_key': result.get('last_evaluated_key')  # Cursor for next "load more" request
            }
    
    except Exception as e:
        logger.error(f"❌ Error searching articles: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        logger.error(f"❌ Filters that caused error: {json.dumps(query_filters, default=str)}")
        return {
            'success': False,
            'error': str(e),
            'articles': [],
            'total': 0
        }


def lambda_handler(event, context):
    """
    Lambda handler for news search
    
    Handles both:
    1. API Gateway events (direct invocation)
    2. SQS events (from wrapper Lambda when worker is at concurrency)
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "POST",
        "body": "{\"query\": {...}, \"dateRange\": \"12h\", \"limit\": 200, ...}"
    }
    
    Expected event structure (SQS):
    {
        "Records": [{
            "eventSource": "aws:sqs",
            "body": "{\"request_id\": \"...\", \"job_id\": \"...\", \"api_gateway_event\": {...}}"
        }]
    }
    """
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('NEWS_SEARCH_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            is_sqs_event = True
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract job_id, request_id, and API Gateway event
                job_id = message_body.get('job_id')
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', {})
                
                logger.info(f"📬 Processing SQS message - job_id: {job_id}, request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    # Get origin from headers for CORS validation
    headers = event.get('headers', {})
    origin = headers.get('Origin') or headers.get('origin')
    
    # Get CORS headers - only allows whitelisted origins
    cors_headers = {
        'Content-Type': 'application/json',
        **get_cors_headers(origin)
    }
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    try:
        logger.info(f"📥 Received event: httpMethod={event.get('httpMethod')}, has_body={bool(event.get('body'))}")
        
        # Parse request body
        body_str = event.get('body', '{}')
        if isinstance(body_str, str):
            body = json.loads(body_str) if body_str else {}
        else:
            body = body_str or {}
        
        logger.info(f"📋 Parsed request body: {json.dumps(body, default=str)}")
        
        # Extract query parameters
        query_filters = body.get('query', {})
        
        # Ensure query_filters is a dict (defensive check)
        if not isinstance(query_filters, dict):
            logger.warning(f"⚠️ query is not a dict, got {type(query_filters)}: {query_filters}")
            query_filters = {}
        
        date_from = body.get('dateFrom') or body.get('date_from')  # Support both camelCase and snake_case
        date_to = body.get('dateTo') or body.get('date_to')  # Support both camelCase and snake_case
        limit = min(int(body.get('limit', 200)), MAX_RESULTS)
        last_evaluated_key = body.get('lastEvaluatedKey')  # Cursor for "load more" pagination
        
        logger.info(f"📄 Pagination - limit: {limit}, has_cursor: {last_evaluated_key is not None}")
        logger.info(f"📋 Query filters type: {type(query_filters)}, value: {json.dumps(query_filters, default=str)}")
        logger.info(f"📅 Date filters - date_from: {date_from}, date_to: {date_to}")
        
        # Perform search
        result = search_articles(query_filters, date_from, date_to, limit, last_evaluated_key)
        
        logger.info(f"✅ Search complete - success: {result.get('success')}, results_count: {len(result.get('articles', []))}, total: {result.get('total', 0)}")
        
        # Return response
        response_body = json.dumps(result, cls=DecimalEncoder)
        logger.info(f"📤 Returning response with {len(result.get('articles', []))} articles")
        
        # If this was from SQS, publish completion notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                completion_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 200,
                    'body': result,
                    'status': 'completed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(completion_message, cls=DecimalEncoder),
                    Subject=f'News Search Completion: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published completion notification for job {job_id}")
            except Exception as e:
                logger.error(f"Error publishing completion notification: {e}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (results sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'Processed from SQS', 'job_id': job_id})
            }
        
        # For direct API Gateway calls, return full response
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': response_body
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        error_response = {
            'success': False,
            'error': str(e)
        }
        
        # If this was from SQS, publish failure notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                failure_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 500,
                    'body': error_response,
                    'status': 'failed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(failure_message, cls=DecimalEncoder),
                    Subject=f'News Search Failure: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published failure notification for job {job_id}")
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {e2}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (error sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 500,
                'body': json.dumps({'message': 'Search failed', 'job_id': job_id, 'error': str(e)})
            }
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps(error_response, cls=DecimalEncoder)
        }
