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


def calculate_date_filter(date_range: str) -> Optional[str]:
    """Calculate date filter based on date range string"""
    if not date_range or date_range == 'all':
        return None
    
    now = datetime.utcnow()
    
    if date_range == '1h':
        start_date = now - timedelta(hours=1)
    elif date_range == '12h':
        start_date = now - timedelta(hours=12)
    elif date_range == '24h':
        start_date = now - timedelta(days=1)
    elif date_range == '7d':
        start_date = now - timedelta(days=7)
    elif date_range == '30d':
        start_date = now - timedelta(days=30)
    else:
        return None
    
    return start_date.isoformat() + 'Z'


def search_by_keyword(keyword: str, date_filter: Optional[str], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Search articles by keyword using GSI5 query.
    GSI5PK = 'TITLE_SEARCH' for all articles.
    
    Args:
        keyword: Search keyword (lowercase)
        date_filter: Optional date filter (ISO format string)
        limit: Maximum number of results to return
        last_evaluated_key: DynamoDB LastEvaluatedKey for pagination
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    try:
        from boto3.dynamodb.conditions import Key, Attr
        
        keyword_lower = keyword.lower()
        
        # Query GSI5 using the partition key (GSI5PK = 'TITLE_SEARCH')
        query_params = {
            'IndexName': 'GSI5',
            'KeyConditionExpression': Key('GSI5PK').eq('TITLE_SEARCH'),
            'Limit': limit * 2,  # Fetch more to account for client-side filtering
            'ScanIndexForward': False  # Sort by published_date descending
        }
        
        # Add date filter if provided
        if date_filter:
            query_params['FilterExpression'] = Attr('published_date').gte(date_filter)
        
        # Use cursor if provided
        if last_evaluated_key:
            query_params['ExclusiveStartKey'] = convert_to_dynamodb_format(last_evaluated_key)
        
        logger.info(f"🔍 Querying GSI5 for keyword: '{keyword}' (date_filter: {date_filter}, limit: {limit})")
        
        # Execute query
        response = table.query(**query_params)
        all_articles = response.get('Items', [])
        
        # Check if there are more results
        has_more = 'LastEvaluatedKey' in response
        next_cursor = response.get('LastEvaluatedKey')
        
        # Filter client-side for case-insensitive title/description matching
        matching_articles = []
        for article in all_articles:
            title = (article.get('title') or '').lower()
            description = (article.get('description') or '').lower()
            gsi5sk = (article.get('GSI5SK') or '').lower()
            
            # Check if keyword is in title, description, or GSI5SK
            if keyword_lower in title or keyword_lower in description or keyword_lower in gsi5sk:
                matching_articles.append(article)
        
        # Apply limit to matching articles
        limited_articles = matching_articles[:limit]
        
        # Update cursor if we have more matching articles or more from DynamoDB
        final_cursor = None
        final_has_more = False
        
        if len(matching_articles) > limit or has_more:
            # If we filtered out articles, we might need to fetch more
            # For now, use the DynamoDB cursor
            final_cursor = next_cursor
            final_has_more = has_more or len(matching_articles) > limit
        
        logger.info(f"✅ Found {len(limited_articles)} articles for keyword '{keyword}' (queried {len(all_articles)} total, has_more: {final_has_more})")
        
        return {
            'articles': limited_articles,
            'last_evaluated_key': final_cursor,
            'has_more': final_has_more
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


def search_multiple_keywords(keywords: List[str], date_filter: Optional[str], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Search articles across multiple keywords using individual GSI queries and union results.
    Similar to search_multiple_politicians in politician trades search.
    
    Args:
        keywords: List of keywords to search for
        date_filter: Optional date filter (ISO format string)
        limit: Maximum number of results to return
        last_evaluated_key: Cursor for pagination (contains published_date and SK)
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    all_results = []
    seen_article_ids = set()
    
    logger.info(f"🔄 Starting multi-keyword search for {len(keywords)} keywords: {keywords}")
    
    # For cursor-based pagination, we need to fetch more results and filter
    fetch_limit = 1000 if not last_evaluated_key else 2000  # Fetch more if continuing
    
    for keyword in keywords:
        logger.info(f"🔍 Querying GSI5 for keyword: {keyword}")
        
        try:
            result = search_by_keyword(keyword, date_filter, fetch_limit, None)
            keyword_articles = result.get('articles', [])
            
            logger.info(f"📊 Found {len(keyword_articles)} results for keyword {keyword}")
            
            # Deduplicate by SK (article ID) and add to results
            for article in keyword_articles:
                article_id = article.get('SK')
                if article_id and article_id not in seen_article_ids:
                    seen_article_ids.add(article_id)
                    all_results.append(article)
                    
            # Stop if we've reached a reasonable limit
            if len(all_results) >= fetch_limit:
                logger.info(f"🛑 Reached fetch limit: {fetch_limit}")
                break
                
        except Exception as e:
            logger.error(f"❌ Error querying for keyword {keyword}: {str(e)}")
            continue
    
    # Sort by published_date descending (most recent first), then by SK for stability
    all_results.sort(key=lambda x: (x.get('published_date', ''), x.get('SK', '')), reverse=True)
    
    # Apply cursor-based pagination if cursor provided
    if last_evaluated_key:
        cursor_date = last_evaluated_key.get('published_date')
        cursor_sk = last_evaluated_key.get('SK')
        if cursor_date is not None:
            # Filter items that come AFTER the cursor in descending sort order
            filtered_items = []
            for item in all_results:
                item_date = item.get('published_date', '')
                item_sk = item.get('SK', '')
                # Include items that are strictly older than the cursor date
                if item_date < cursor_date:
                    filtered_items.append(item)
                # If dates are the same, include items with a SK lexicographically smaller than the cursor's SK
                elif item_date == cursor_date and item_sk < cursor_sk:
                    filtered_items.append(item)
                # Skip the cursor item itself and any items that come before it
                elif item_date == cursor_date and item_sk >= cursor_sk:
                    continue
                # Skip items that are strictly newer than the cursor date
                elif item_date > cursor_date:
                    continue
            all_results = filtered_items
            logger.info(f"📄 Applied cursor filter, {len(all_results)} items remaining after cursor")
    
    # Apply pagination (always take first limit items after cursor)
    paginated_items = all_results[:limit]
    
    # Convert from DynamoDB format
    converted_items = [convert_from_dynamodb_format(item) for item in paginated_items]
    
    # Generate cursor for next page if we have more items
    next_cursor = None
    if len(all_results) > limit:
        last_item = paginated_items[-1]
        next_cursor = {
            'published_date': last_item.get('published_date'),
            'SK': last_item.get('SK')
        }
    
    logger.info(f"✅ Multi-keyword search complete - results_count: {len(converted_items)}, total_found: {len(all_results)}, has_more: {next_cursor is not None}")
    return {
        'articles': converted_items,
        'last_evaluated_key': next_cursor,
        'has_more': next_cursor is not None
    }


def scan_all_articles(date_filter: Optional[str], limit: int, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Scan all articles with date filter, only fetching a limited batch for pagination.
    
    Args:
        date_filter: Optional date filter (ISO format string)
        limit: Maximum number of results to return
        last_evaluated_key: DynamoDB LastEvaluatedKey for pagination (must have PK and SK)
    
    Returns:
        dict with 'articles', 'last_evaluated_key', 'has_more'
    """
    try:
        from boto3.dynamodb.conditions import Attr
        
        scan_params = {
            'Limit': limit
            # Note: ScanIndexForward is only valid for query operations, not scan
            # Scans don't support ordering - results are returned in arbitrary order
        }
        
        if date_filter:
            scan_params['FilterExpression'] = Attr('published_date').gte(date_filter) & Attr('PK').exists()
        else:
            scan_params['FilterExpression'] = Attr('PK').exists()
        
        # Use cursor if provided - must be in table format (PK, SK)
        if last_evaluated_key:
            # If it's our custom format, extract the DynamoDB cursor
            if isinstance(last_evaluated_key, dict) and '_dynamodb_cursor' in last_evaluated_key:
                dynamodb_cursor = last_evaluated_key['_dynamodb_cursor']
                if dynamodb_cursor and isinstance(dynamodb_cursor, dict) and 'PK' in dynamodb_cursor and 'SK' in dynamodb_cursor:
                    if 'GSI5PK' not in dynamodb_cursor:
                        scan_params['ExclusiveStartKey'] = convert_to_dynamodb_format(dynamodb_cursor)
            # If it's already in DynamoDB table format (has PK and SK), use it directly
            elif isinstance(last_evaluated_key, dict) and 'PK' in last_evaluated_key and 'SK' in last_evaluated_key:
                if 'GSI5PK' not in last_evaluated_key:
                    scan_params['ExclusiveStartKey'] = convert_to_dynamodb_format(last_evaluated_key)
        
        # Scan limited batch
        response = table.scan(**scan_params)
        articles = response.get('Items', [])
        
        # Check if there are more results
        has_more = 'LastEvaluatedKey' in response
        next_cursor = response.get('LastEvaluatedKey')
        
        # Convert from DynamoDB format
        converted_articles = [convert_from_dynamodb_format(item) for item in articles]
        
        # Convert LastEvaluatedKey to JSON-serializable format
        serializable_cursor = None
        if next_cursor:
            serializable_cursor = convert_from_dynamodb_format(next_cursor)
        
        logger.info(f"📊 Scanned {len(converted_articles)} articles (has_more: {has_more})")
        
        return {
            'articles': converted_articles,
            'last_evaluated_key': serializable_cursor,
            'has_more': has_more
        }
    
    except Exception as e:
        logger.error(f"❌ Error scanning articles: {str(e)}")
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
    date_range: str = '12h',
    limit: int = 200,
    last_evaluated_key: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Search articles based on query filters.
    
    Args:
        query_filters: Dictionary with 'keywords' key (list of strings or complex query structure)
        date_range: Date range filter ('12h', '24h', '7d', '30d', 'all')
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
        logger.info(f"🔍 Starting search_articles with filters: {json.dumps(query_filters, default=str)}, date_range: {date_range}, limit: {limit}")
        
        # Calculate date filter
        date_filter = calculate_date_filter(date_range)
        
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
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "POST",
        "body": "{\"query\": {...}, \"dateRange\": \"12h\", \"limit\": 200, ...}"
    }
    """
    # CORS headers
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
        'Access-Control-Allow-Credentials': 'true'
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
        
        date_range = body.get('dateRange', '12h')
        limit = min(int(body.get('limit', 200)), MAX_RESULTS)
        last_evaluated_key = body.get('lastEvaluatedKey')  # Cursor for "load more" pagination
        
        logger.info(f"📄 Pagination - limit: {limit}, has_cursor: {last_evaluated_key is not None}")
        logger.info(f"📋 Query filters type: {type(query_filters)}, value: {json.dumps(query_filters, default=str)}")
        
        # Perform search
        result = search_articles(query_filters, date_range, limit, last_evaluated_key)
        
        logger.info(f"✅ Search complete - success: {result.get('success')}, results_count: {len(result.get('articles', []))}, total: {result.get('total', 0)}")
        
        # Return response
        response_body = json.dumps(result, cls=DecimalEncoder)
        logger.info(f"📤 Returning response with {len(result.get('articles', []))} articles")
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': response_body
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            }, cls=DecimalEncoder)
        }
