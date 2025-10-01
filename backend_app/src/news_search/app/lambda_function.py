import json
import boto3
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any
from decimal import Decimal
import csv

dynamodb = boto3.resource('dynamodb')
news_table_name = os.environ['NEWS_TABLE_NAME']
table = dynamodb.Table(news_table_name)

# Global cache for stock symbol mappings
_stock_symbol_cache = None

def load_stock_symbol_mappings():
    """Load stock symbol mappings from CSV files"""
    global _stock_symbol_cache
    
    if _stock_symbol_cache is not None:
        return _stock_symbol_cache
    
    print("Loading stock symbol mappings from CSV files")
    _stock_symbol_cache = {}
    
    try:
        # Load NASDAQ listings
        nasdaq_file = os.path.join(os.path.dirname(__file__), 'nasdaq-listed.csv')
        if os.path.exists(nasdaq_file):
            with open(nasdaq_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    symbol = row.get('Symbol', '').strip().upper()
                    company_name = row.get('Security Name', '').strip()
                    if symbol and company_name:
                        _stock_symbol_cache[symbol] = company_name
        
        # Load NYSE listings
        nyse_file = os.path.join(os.path.dirname(__file__), 'nyse-listed.csv')
        if os.path.exists(nyse_file):
            with open(nyse_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    symbol = row.get('ACT Symbol', '').strip().upper()
                    company_name = row.get('Company Name', '').strip()
                    if symbol and company_name:
                        # NYSE takes precedence if symbol exists in both
                        _stock_symbol_cache[symbol] = company_name
        
        print(f"Loaded {len(_stock_symbol_cache)} stock symbol mappings")
        
    except Exception as e:
        print(f"ERROR loading stock symbol mappings: {e}")
        _stock_symbol_cache = {}
    
    return _stock_symbol_cache

def get_company_name_for_symbol(symbol):
    """Get company name for a stock symbol"""
    if not symbol or not isinstance(symbol, str):
        return None
    
    symbol = symbol.strip().upper()
    mappings = load_stock_symbol_mappings()
    return mappings.get(symbol)

def expand_stock_symbols(search_terms):
    """Expand stock symbols to include company names"""
    if not search_terms:
        return search_terms
    
    expanded_terms = []
    
    for term in search_terms:
        # Always include the original term
        expanded_terms.append(term.lower())
        
        # Check if term is a stock symbol (all caps, 1-5 letters)
        if term.isupper() and len(term) <= 5:
            company_name = get_company_name_for_symbol(term)
            if company_name:
                print(f"Expanding stock symbol '{term}' to company name '{company_name}'")
                
                # Add the full company name
                expanded_terms.append(company_name.lower())
                
                # Extract meaningful words from company name (filter out common words)
                common_words = {'inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 
                               'plc', 'llc', 'the', 'group', 'holdings', 'international'}
                words = company_name.lower().split()
                for word in words:
                    clean_word = word.strip('.,')
                    if clean_word and clean_word not in common_words and len(clean_word) > 2:
                        expanded_terms.append(clean_word)
    
    # Remove duplicates while preserving order
    seen = set()
    unique_terms = []
    for term in expanded_terms:
        if term not in seen:
            seen.add(term)
            unique_terms.append(term)
    
    return unique_terms

def lambda_handler(event, context):
    """
    Handle news search requests using title-based search with GSI5
    """
    
    # CORS headers for API Gateway
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET,DELETE,PUT',
        'Access-Control-Allow-Credentials': 'true'
    }
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }

    try:
        # Parse request body
        body = json.loads(event.get('body', '{}'))
        print(f"Received search request: {json.dumps(body)}")
        
        query_filters = body.get('query', {})
        date_range = body.get('dateRange', '12h')
        limit = body.get('limit', 50)
        offset = body.get('offset', 0)

        # Extract search terms from filters
        search_terms = extract_search_terms(query_filters)
        
        # Expand stock symbols to company names
        expanded_terms = expand_stock_symbols(search_terms)
        print(f"Expanded search terms: {expanded_terms}")
        
        # Perform title-based search
        articles = perform_title_based_search(
            search_terms=expanded_terms,
            query_filters=query_filters,
            date_range=date_range,
            limit=limit
        )
        
        # Apply offset and limit for pagination
        total_count = len(articles)
        paginated_articles = articles[offset:offset + limit]
        
        # Convert Decimal types for JSON serialization
        serializable_articles = convert_decimals(paginated_articles)
        
        print(f"Returning {len(serializable_articles)} articles out of {total_count} total")

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'articles': serializable_articles,
                'total': total_count,
                'limit': limit,
                'offset': offset
            })
        }
        
    except Exception as e:
        print(f"ERROR processing search request: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

def extract_search_terms(query_filters):
    """Extract all search terms from query filters"""
    search_terms = []
    
    if not query_filters:
        return search_terms
    
    # Extract keywords
    keywords_query = query_filters.get('keywords')
    if keywords_query:
        terms = extract_terms_from_query(keywords_query)
        search_terms.extend(terms)
    
    return search_terms

def extract_terms_from_query(query_node):
    """Recursively extract terms from query tree"""
    if not query_node:
        return []
    
    node_type = query_node.get('type')
    
    if node_type == 'term':
        value = query_node.get('value', '').strip()
        return [value] if value else []
    
    elif node_type == 'group':
        children = query_node.get('children')
        if isinstance(children, list):
            terms = []
            for child in children:
                terms.extend(extract_terms_from_query(child))
            return terms
        elif isinstance(children, dict):
            return extract_terms_from_query(children)
        return []
    
    elif node_type == 'expression':
        children = query_node.get('children', [])
        terms = []
        for child in children:
            terms.extend(extract_terms_from_query(child))
        return terms
    
    return []

def perform_title_based_search(search_terms, query_filters, date_range, limit):
    """
    Perform title-based search using GSI5 with contains() filter
    """
    
    # Calculate date range
    date_filter = calculate_date_filter(date_range)
    
    all_articles = []
    
    if not search_terms:
        # No keyword filters - scan all recent articles
        print("No search terms provided, fetching all recent articles")
        all_articles = scan_all_articles(date_filter, limit)
    else:
        # Search for each term in titles using GSI5
        print(f"Searching for terms in titles: {search_terms}")
        
        # Use a set to track unique article IDs
        seen_ids = set()
        
        for term in search_terms:
            articles = search_by_title(term, date_filter)
            
            # Add unique articles
            for article in articles:
                article_id = article.get('SK')
                if article_id not in seen_ids:
                    seen_ids.add(article_id)
                    all_articles.append(article)
    
    # Apply additional filters (source, category, country)
    filtered_articles = apply_additional_filters(all_articles, query_filters)
    
    # Sort by published date (newest first)
    filtered_articles.sort(key=lambda x: x.get('published_date', ''), reverse=True)
    
    return filtered_articles[:limit * 2]  # Return extra for pagination

def search_by_title(search_term, date_filter):
    """
    Search articles by title using GSI5 query with client-side filtering.
    GSI5PK = 'TITLE_SEARCH' for all articles, so we query by that and filter.
    """
    
    try:
        # Convert search term to lowercase for case-insensitive search
        search_term_lower = search_term.lower()
        
        # Query GSI5 using the partition key (GSI5PK = 'TITLE_SEARCH')
        # This is much more efficient than a scan
        query_params = {
            'IndexName': 'GSI5',
            'KeyConditionExpression': 'GSI5PK = :pk',
            'ExpressionAttributeValues': {
                ':pk': 'TITLE_SEARCH'
            },
            'Limit': 200  # Fetch items to filter client-side
        }
        
        # Add date filter if provided (as FilterExpression, not KeyCondition)
        if date_filter:
            query_params['FilterExpression'] = 'published_date >= :start_date'
            query_params['ExpressionAttributeValues'][':start_date'] = date_filter
        
        print(f"Querying GSI5 for term: {search_term} (date_filter: {date_filter})")
        print(f"Query params: {query_params}")
        
        # Fetch all articles from GSI5 and filter client-side
        all_articles = []
        response = table.query(**query_params)
        all_articles.extend(response.get('Items', []))
        
        print(f"First query returned {len(response.get('Items', []))} items, Count: {response.get('Count', 0)}")
        
        # Handle pagination - fetch up to 1000 articles
        page_count = 1
        while 'LastEvaluatedKey' in response and len(all_articles) < 1000:
            query_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = table.query(**query_params)
            all_articles.extend(response.get('Items', []))
            page_count += 1
            print(f"Page {page_count}: fetched {len(response.get('Items', []))} more items")
        
        print(f"Total queried: {len(all_articles)} articles from GSI5")
        
        # Filter client-side for case-insensitive title matching
        matching_articles = []
        for article in all_articles:
            # Handle None values properly
            title = (article.get('title') or '').lower()
            description = (article.get('description') or '').lower()
            gsi5sk = (article.get('GSI5SK') or '').lower()
            
            # Check if search term is in title, description, or GSI5SK
            if search_term_lower in title or search_term_lower in description or search_term_lower in gsi5sk:
                matching_articles.append(article)
                print(f"Match found in: {article.get('title', 'No title')[:50]}...")
        
        print(f"Found {len(matching_articles)} articles for term '{search_term}' (queried {len(all_articles)} total)")
        return matching_articles
                    
    except Exception as e:
        print(f"ERROR searching by title for '{search_term}': {e}")
        import traceback
        traceback.print_exc()
        return []

def scan_all_articles(date_filter, limit):
    """Scan all articles with date filter"""
    
    try:
        scan_params = {
            'Limit': limit
        }
        
        if date_filter:
            scan_params['FilterExpression'] = 'published_date >= :start_date AND attribute_exists(PK)'
            scan_params['ExpressionAttributeValues'] = {
                ':start_date': date_filter
            }
        else:
            scan_params['FilterExpression'] = 'attribute_exists(PK)'
        
        response = table.scan(**scan_params)
        articles = response.get('Items', [])
        
        print(f"Scanned {len(articles)} articles")
        return articles
    
    except Exception as e:
        print(f"Error scanning articles: {e}")
        return []

def apply_additional_filters(articles, query_filters):
    """Apply source, category, and country filters"""
    
    if not query_filters:
        return articles
    
    filtered = articles
    
    # Apply source filter - freeform text search (case-insensitive contains)
    sources_query = query_filters.get('sources')
    if sources_query:
        source_terms = extract_terms_from_query(sources_query)
        if source_terms:
            # Filter articles where ANY source term is contained in source_name (case-insensitive)
            filtered = [
                a for a in filtered 
                if any(term.lower() in (a.get('source_name') or '').lower() for term in source_terms)
            ]
    
    # Apply category filter
    categories_query = query_filters.get('categories')
    if categories_query:
        category_terms = extract_terms_from_query(categories_query)
        if category_terms:
            filtered = [a for a in filtered if any(cat in a.get('category', '') for cat in category_terms)]
    
    # Apply country filter
    countries_query = query_filters.get('countries')
    if countries_query:
        country_terms = extract_terms_from_query(countries_query)
        if country_terms:
            filtered = [a for a in filtered if any(country in a.get('country', '') for country in country_terms)]
    
    return filtered

def calculate_date_filter(date_range):
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

def convert_decimals(obj):
    """Convert DynamoDB Decimal types to int/float for JSON serialization"""
    
    if isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: convert_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        else:
            return float(obj)
    else:
        return obj

