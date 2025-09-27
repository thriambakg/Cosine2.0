import json
import boto3
import os
from datetime import datetime, timedelta
import logging

logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

dynamodb = boto3.resource('dynamodb')
news_table_name = os.environ['NEWS_TABLE_NAME']
table = dynamodb.Table(news_table_name)

def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")

    # Handle CORS preflight requests
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({'message': 'CORS preflight'})
        }

    try:
        # Parse request body
        body = json.loads(event['body'])
        query_filters = body.get('query', {})
        date_range = body.get('dateRange', '12h')
        limit = body.get('limit', 50)
        offset = body.get('offset', 0)

        # Build DynamoDB query parameters
        query_params = build_dynamodb_query_params(query_filters, date_range, limit)
        print(f"🔧 Built query params: {json.dumps(query_params, default=str)}")

        # Execute DynamoDB query
        print(f"📊 Executing DynamoDB query on table: {news_table_name}")
        response = execute_dynamodb_query(query_params)
        print(f"📥 DynamoDB response: {json.dumps(response, default=str)}")
        articles = response.get('Items', [])
        print(f"📰 Retrieved {len(articles)} articles from DynamoDB")

        # Apply client-side filtering for complex keyword/country expressions if needed
        filtered_articles = apply_client_side_filters(articles, query_filters)

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({
                'articles': format_articles_for_frontend(filtered_articles),
                'total': len(filtered_articles),
                'limit': limit,
                'offset': offset,
                'query': query_filters,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })
        }
    except Exception as e:
        logger.error(f"Error processing news search request: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({'message': 'Failed to search news articles', 'error': str(e)})
        }

def build_dynamodb_query_params(query_filters, date_range, limit):
    """
    Build DynamoDB query parameters based on frontend query structure.
    Prioritizes GSI usage where possible (source, category, keyword).
    For complex AND/OR logic, uses scan with client-side filtering.
    """
    params = {
        'Limit': limit,
        'ExpressionAttributeValues': {}
    }
    
    # Only add ExpressionAttributeNames if we have attribute names to define
    expression_attribute_names = {}

    # Determine date range for filtering
    end_date = datetime.utcnow()
    if date_range == '12h':
        start_date = end_date - timedelta(hours=12)
    elif date_range == '24h':
        start_date = end_date - timedelta(hours=24)
    elif date_range == '7d':
        start_date = end_date - timedelta(days=7)
    elif date_range == '30d':
        start_date = end_date - timedelta(days=30)
    else:  # 'all' or invalid
        start_date = datetime.min  # No date filtering

    # Try to use appropriate GSI for simple queries
    # Priority: Source > Category > Keywords > AI Tag
    
    # 1. Check for simple source query (GSI5)
    source_query = query_filters.get('sources')
    if source_query and source_query.get('type') == 'term' and source_query.get('value'):
        params['IndexName'] = 'GSI5'  # Source-based GSI
        params['KeyConditionExpression'] = 'GSI5PK = :gsi5pk'
        params['ExpressionAttributeValues'][':gsi5pk'] = f"SOURCE#{source_query['value']}"
        params['ScanIndexForward'] = False  # Newest first
        print(f"🎯 Using GSI5 for source: {source_query['value']}")
        return params
    elif source_query and source_query.get('type') == 'expression':
        print("🔄 Complex source expression detected - falling back to scan with client-side filtering")
        # Will be handled by client-side filtering
    
    # 2. Check for simple category query (GSI1)
    category_query = query_filters.get('categories')
    if category_query and category_query.get('type') == 'term' and category_query.get('value'):
        params['IndexName'] = 'GSI1'  # Category-based GSI
        params['KeyConditionExpression'] = 'GSI1PK = :gsi1pk'
        params['ExpressionAttributeValues'][':gsi1pk'] = f"CATEGORY#{category_query['value']}"
        params['ScanIndexForward'] = False  # Newest first
        print(f"🎯 Using GSI1 for category: {category_query['value']}")
        return params
    elif category_query and category_query.get('type') == 'expression':
        print("🔄 Complex category expression detected - falling back to scan with client-side filtering")
        # Will be handled by client-side filtering
    
    # 3. Check for keyword queries (always use scan with FilterExpression)
    keyword_query = query_filters.get('keywords')
    if keyword_query:
        print("🔄 Keyword query detected - using table scan with FilterExpression for comprehensive keyword matching")
        # Will be handled by client-side filtering after scan
    
    # 4. Check for simple AI tag query (GSI3)
    ai_tag_query = query_filters.get('ai_tag')
    if ai_tag_query and ai_tag_query.get('type') == 'term' and ai_tag_query.get('value'):
        params['IndexName'] = 'GSI3'  # AI Tag-based GSI
        params['KeyConditionExpression'] = 'GSI3PK = :gsi3pk'
        params['ExpressionAttributeValues'][':gsi3pk'] = f"AITAG#{ai_tag_query['value']}"
        params['ScanIndexForward'] = False  # Newest first
        print(f"🎯 Using GSI3 for AI tag: {ai_tag_query['value']}")
        return params

    # Fallback to main table scan for complex queries or no specific filters
    # Add date filtering to scan if specified
    filter_expressions = []
    if date_range != 'all':
        filter_expressions.append('#pd BETWEEN :start_date AND :end_date')
        expression_attribute_names['#pd'] = 'published_date'
        params['ExpressionAttributeValues'][':start_date'] = start_date.isoformat(timespec='seconds') + 'Z'
        params['ExpressionAttributeValues'][':end_date'] = end_date.isoformat(timespec='seconds') + 'Z'
    
    # Only add FilterExpression and ExpressionAttributeNames if we have filters
    if filter_expressions:
        params['FilterExpression'] = ' AND '.join(filter_expressions)
        if expression_attribute_names:
            params['ExpressionAttributeNames'] = expression_attribute_names
    
    print("🔄 Falling back to main table scan for complex filtering.")
    return params

def execute_dynamodb_query(params):
    """Execute DynamoDB query or scan based on parameters."""
    try:
        if 'KeyConditionExpression' in params:
            # It's a query operation
            print(f"🔍 Executing DynamoDB query with params: {json.dumps(params, default=str)}")
            result = table.query(**params)
            print(f"✅ Query completed successfully. Items count: {len(result.get('Items', []))}")
            return result
        else:
            # It's a scan operation (less efficient, used for complex filters or no GSI match)
            print(f"🔍 Executing DynamoDB scan with params: {json.dumps(params, default=str)}")
            result = table.scan(**params)
            print(f"✅ Scan completed successfully. Items count: {len(result.get('Items', []))}")
            return result
    except Exception as e:
        print(f"❌ DynamoDB operation failed: {str(e)}")
        print(f"❌ Parameters that caused the error: {json.dumps(params, default=str)}")
        raise

def apply_client_side_filters(articles, query_filters):
    """
    Apply filters that couldn't be handled by DynamoDB's query/scan.
    Handles complex AND/OR/group logic for keywords, sources, categories, and countries.
    """
    print("🔧 Applying client-side filters.")
    
    if not articles:
        return articles
    
    # Handle complex keyword expressions
    keyword_query = query_filters.get('keywords')
    if keyword_query and keyword_query.get('type') == 'expression':
        print(f"🔍 Processing complex keyword expression: {json.dumps(keyword_query)}")
        articles = filter_by_expression(articles, keyword_query, 'keywords')
    
    # Handle complex source expressions
    source_query = query_filters.get('sources')
    if source_query and source_query.get('type') == 'expression':
        print(f"🔍 Processing complex source expression: {json.dumps(source_query)}")
        articles = filter_by_expression(articles, source_query, 'source_name')
    
    # Handle complex category expressions
    category_query = query_filters.get('categories')
    if category_query and category_query.get('type') == 'expression':
        print(f"🔍 Processing complex category expression: {json.dumps(category_query)}")
        articles = filter_by_expression(articles, category_query, 'category')
    
    # Handle complex country expressions
    country_query = query_filters.get('countries')
    if country_query and country_query.get('type') == 'expression':
        print(f"🔍 Processing complex country expression: {json.dumps(country_query)}")
        articles = filter_by_expression(articles, country_query, 'country')
    
    print(f"✅ Client-side filtering complete. {len(articles)} articles remaining.")
    return articles

def filter_by_expression(articles, expression, field_name):
    """
    Filter articles based on a complex expression (AND/OR/group logic).
    """
    if not expression or not expression.get('children'):
        return articles
    
    def evaluate_expression(items, expr):
        """Recursively evaluate expression tree."""
        if not expr or not expr.get('children'):
            return items
        
        children = expr.get('children', [])
        if len(children) == 0:
            return items
        elif len(children) == 1:
            return filter_by_term(items, children[0], field_name)
        
        # Handle multiple children with operators
        result_items = set()
        current_items = items
        
        for i, child in enumerate(children):
            if child.get('type') == 'term':
                filtered = filter_by_term(current_items, child, field_name)
                if i == 0:
                    # First item - start with these results
                    result_items = set(filtered)
                else:
                    # Apply operator to previous results
                    prev_operator = children[i-1].get('operator', 'AND')
                    if prev_operator == 'OR':
                        result_items.update(filtered)
                    else:  # AND
                        result_items = result_items.intersection(set(filtered))
                current_items = list(result_items)
            elif child.get('type') == 'group':
                group_filtered = filter_by_expression(items, child)
                if i == 0:
                    result_items = set(group_filtered)
                else:
                    prev_operator = children[i-1].get('operator', 'AND')
                    if prev_operator == 'OR':
                        result_items.update(group_filtered)
                    else:  # AND
                        result_items = result_items.intersection(set(group_filtered))
                current_items = list(result_items)
        
        return list(result_items)
    
    return evaluate_expression(articles, expression)

def filter_by_term(articles, term, field_name):
    """
    Filter articles by a single term.
    """
    if not term or term.get('type') != 'term':
        return articles
    
    value = term.get('value', '').lower()
    if not value:
        return articles
    
    filtered = []
    for article in articles:
        field_value = article.get(field_name, '')
        if isinstance(field_value, str):
            field_value = field_value.lower()
        elif isinstance(field_value, list):
            field_value = ' '.join(str(item).lower() for item in field_value)
        else:
            field_value = str(field_value).lower()
        
        # For keywords field, check if the term appears as a whole keyword (comma-separated)
        if field_name == 'keywords':
            # Split by comma and check if any keyword matches exactly or contains the search term
            keywords_list = [kw.strip() for kw in field_value.split(',')]
            if any(value in kw for kw in keywords_list):
                filtered.append(article)
        else:
            # For other fields, use substring matching
            if value in field_value:
                filtered.append(article)
    
    return filtered

def format_articles_for_frontend(articles):
    """Convert DynamoDB items to frontend-friendly format."""
    formatted = []
    for article in articles:
        formatted.append({
            'id': article.get('SK'),  # SK is article_id
            'title': article.get('title'),
            'description': article.get('description'),
            'source_url': article.get('source_url'),
            'source_name': article.get('source_name'),
            'published_date': article.get('published_date'),
            'keywords': article.get('keywords'),
            'category': article.get('category'),
            'sentiment': article.get('sentiment'),
            'ai_tag': article.get('ai_tag'),
            'image_url': article.get('image_url'),
            'creator': article.get('creator'),
            'country': article.get('country'),
            'language': article.get('language'),
        })
    return formatted
