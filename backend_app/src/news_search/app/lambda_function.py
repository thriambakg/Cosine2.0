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

        # Check if we need comprehensive complex filtering
        if is_comprehensive_complex_query(query_filters):
            articles = handle_comprehensive_complex_query(query_filters, date_range, limit)
        elif query_params.get('_or_keywords'):
            articles = handle_or_keyword_query(query_params, query_filters, date_range, limit)
        else:
            # Execute single DynamoDB query
            print(f"📊 Executing DynamoDB query on table: {news_table_name}")
            response = execute_dynamodb_query(query_params)
            print(f"📥 DynamoDB response: {json.dumps(response, default=str)}")
            articles = response.get('Items', [])
        
        print(f"📰 Retrieved {len(articles)} articles from DynamoDB")

        # Apply client-side filtering for complex expressions if needed
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
        start_date = end_date - timedelta(hours=24)  # Use 24h to be more inclusive
    elif date_range == '24h':
        start_date = end_date - timedelta(hours=48)  # Use 48h to be more inclusive
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
    
    # 3. Check for keyword queries (use optimized GSI4 approach)
    keyword_query = query_filters.get('keywords')
    if keyword_query:
        # Check if this is a simple keyword search (single term)
        if keyword_query.get('type') == 'term':
            keyword_value = keyword_query.get('value', '').lower()
            if keyword_value:
                print(f"🎯 Simple keyword search using GSI4: {keyword_value}")
                # Use GSI4 for direct keyword lookup (much faster than scan)
                params['IndexName'] = 'GSI4'
                params['KeyConditionExpression'] = 'GSI4PK = :keyword'
                params['ExpressionAttributeValues'][':keyword'] = f"KEYWORD#{keyword_value}"
                params['ScanIndexForward'] = False  # Most recent first
                return params
            else:
                print("🔄 Empty keyword value - falling back to scan")
        elif keyword_query.get('type') == 'expression':
            # Handle OR expressions by making multiple GSI queries
            children = keyword_query.get('children', [])
            or_terms = []
            
            for child in children:
                if child.get('type') == 'term' and child.get('value'):
                    or_terms.append(child.get('value', '').lower())
            
            if or_terms:
                print(f"🎯 OR keyword search using multiple GSI4 queries: {or_terms}")
                # Return special marker for OR query handling
                params['_or_keywords'] = or_terms
                params['IndexName'] = 'GSI4'
                return params
        else:
            print("🔄 Complex keyword expression - using table scan with client-side filtering")
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

def is_comprehensive_complex_query(query_filters):
    """Check if this is a comprehensive complex query that needs special handling."""
    
    # Check for root-level mixed field expressions
    root_expression = query_filters.get('expression')
    if root_expression and root_expression.get('type') == 'expression':
        print(f"🎯 Detected root-level expression with mixed field logic")
        return True
    
    # Check for cross-field complex expressions (multiple fields with expressions)
    complex_fields = []
    for field in ['keywords', 'sources', 'categories', 'countries']:
        field_query = query_filters.get(field)
        if field_query and field_query.get('type') == 'expression':
            complex_fields.append(field)
    
    # If multiple fields have complex expressions, we need comprehensive handling
    if len(complex_fields) > 1:
        print(f"🎯 Detected comprehensive complex query with multiple complex fields: {complex_fields}")
        return True
    
    # Check for any field with complex expressions that can't be handled by GSI
    for field in ['sources', 'categories', 'countries']:  # keywords can use GSI4
        field_query = query_filters.get(field)
        if field_query and field_query.get('type') == 'expression':
            print(f"🎯 Detected complex {field} expression requiring comprehensive handling")
            return True
    
    return False

def handle_comprehensive_complex_query(query_filters, date_range, limit):
    """Handle comprehensive complex queries with cross-field logic."""
    print(f"🔄 Handling comprehensive complex query")
    
    # For now, use a broad table scan and apply comprehensive client-side filtering
    # This could be optimized further with query planning in the future
    params = {
        'TableName': news_table_name,
        'Limit': limit * 3,  # Get more items since we'll filter heavily
        'FilterExpression': 'attribute_exists(#pk)',
        'ExpressionAttributeNames': {
            '#pk': 'PK'
        }
    }
    
    print(f"📊 Executing comprehensive table scan")
    response = execute_dynamodb_query(params)
    articles = response.get('Items', [])
    
    print(f"📰 Retrieved {len(articles)} articles for comprehensive filtering")
    
    # Apply comprehensive client-side filtering
    filtered_articles = apply_comprehensive_filters(articles, query_filters)
    
    # Limit results to requested amount
    return filtered_articles[:limit]

def handle_or_keyword_query(params, query_filters, date_range, limit):
    """Handle OR keyword queries by making multiple GSI4 queries and combining results."""
    or_keywords = params.pop('_or_keywords')  # Remove the special marker
    all_articles = []
    seen_article_ids = set()
    
    print(f"🔄 Handling OR keyword query for: {or_keywords}")
    
    for keyword in or_keywords:
        # Create query params for this keyword
        keyword_params = {
            'IndexName': 'GSI4',
            'KeyConditionExpression': 'GSI4PK = :keyword',
            'ExpressionAttributeValues': {':keyword': f"KEYWORD#{keyword}"},
            'ScanIndexForward': False,
            'Limit': limit
        }
        
        print(f"🔍 Querying for keyword: {keyword}")
        
        try:
            response = execute_dynamodb_query(keyword_params)
            keyword_articles = response.get('Items', [])
            print(f"📰 Found {len(keyword_articles)} articles for keyword '{keyword}'")
            
            # Add unique articles to results
            for article in keyword_articles:
                # Use main_article_id or SK as unique identifier
                article_id = article.get('main_article_id') or article.get('SK', '')
                if article_id and article_id not in seen_article_ids:
                    all_articles.append(article)
                    seen_article_ids.add(article_id)
                    
        except Exception as e:
            print(f"❌ Error querying keyword '{keyword}': {str(e)}")
            continue
    
    print(f"✅ OR query complete. Total unique articles: {len(all_articles)}")
    return all_articles

def apply_client_side_filters(articles, query_filters):
    """
    Apply filters that couldn't be handled by DynamoDB's query/scan.
    Handles complex AND/OR/group logic for keywords, sources, categories, and countries.
    Cross-field filters are combined with AND logic (e.g., keyword AND source).
    Empty fields are treated as wildcards (*).
    """
    print("🔧 Applying client-side filters.")
    
    if not articles:
        return articles
    
    # Apply each field filter with AND logic between fields
    current_articles = articles
    
    # Handle keywords filter
    keyword_query = query_filters.get('keywords')
    if keyword_query:
        if keyword_query.get('type') == 'expression':
            print(f"🔍 Processing keyword expression: {json.dumps(keyword_query)}")
            current_articles = filter_by_expression(current_articles, keyword_query, 'keywords')
        elif keyword_query.get('type') == 'term':
            print(f"🔍 Processing keyword term: {keyword_query.get('value')}")
            current_articles = filter_by_term(current_articles, keyword_query, 'keywords')
    
    # Handle sources filter (AND with previous results)
    source_query = query_filters.get('sources')
    if source_query:
        if source_query.get('type') == 'expression':
            print(f"🔍 Processing source expression: {json.dumps(source_query)}")
            current_articles = filter_by_expression(current_articles, source_query, 'source_name')
        elif source_query.get('type') == 'term':
            print(f"🔍 Processing source term: {source_query.get('value')}")
            current_articles = filter_by_term(current_articles, source_query, 'source_name')
    
    # Handle categories filter (AND with previous results)
    category_query = query_filters.get('categories')
    if category_query:
        if category_query.get('type') == 'expression':
            print(f"🔍 Processing category expression: {json.dumps(category_query)}")
            current_articles = filter_by_expression(current_articles, category_query, 'category')
        elif category_query.get('type') == 'term':
            print(f"🔍 Processing category term: {category_query.get('value')}")
            current_articles = filter_by_term(current_articles, category_query, 'category')
    
    # Handle countries filter (AND with previous results)
    country_query = query_filters.get('countries')
    if country_query:
        if country_query.get('type') == 'expression':
            print(f"🔍 Processing country expression: {json.dumps(country_query)}")
            current_articles = filter_by_expression(current_articles, country_query, 'country')
        elif country_query.get('type') == 'term':
            print(f"🔍 Processing country term: {country_query.get('value')}")
            current_articles = filter_by_term(current_articles, country_query, 'country')
    
    print(f"✅ Client-side filtering complete. {len(current_articles)} articles remaining.")
    return current_articles

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
        result_articles = []
        result_article_ids = set()
        
        for i, child in enumerate(children):
            if child.get('type') == 'term':
                filtered = filter_by_term(items, child, field_name)
                if i == 0:
                    # First item - start with these results
                    result_articles = filtered
                    result_article_ids = {get_article_id(article) for article in filtered}
                else:
                    # Apply operator to previous results
                    prev_operator = children[i-1].get('operator', 'AND')
                    filtered_ids = {get_article_id(article) for article in filtered}
                    
                    if prev_operator == 'OR':
                        # Add new articles that aren't already in results
                        for article in filtered:
                            article_id = get_article_id(article)
                            if article_id not in result_article_ids:
                                result_articles.append(article)
                                result_article_ids.add(article_id)
                    else:  # AND
                        # Keep only articles that are in both result and filtered
                        result_articles = [article for article in result_articles 
                                         if get_article_id(article) in filtered_ids]
                        result_article_ids = result_article_ids.intersection(filtered_ids)
                        
            elif child.get('type') == 'group':
                group_filtered = filter_by_expression(items, child, field_name)
                if i == 0:
                    result_articles = group_filtered
                    result_article_ids = {get_article_id(article) for article in group_filtered}
                else:
                    prev_operator = children[i-1].get('operator', 'AND')
                    filtered_ids = {get_article_id(article) for article in group_filtered}
                    
                    if prev_operator == 'OR':
                        # Add new articles that aren't already in results
                        for article in group_filtered:
                            article_id = get_article_id(article)
                            if article_id not in result_article_ids:
                                result_articles.append(article)
                                result_article_ids.add(article_id)
                    else:  # AND
                        # Keep only articles that are in both result and filtered
                        result_articles = [article for article in result_articles 
                                         if get_article_id(article) in filtered_ids]
                        result_article_ids = result_article_ids.intersection(filtered_ids)
        
        return result_articles
    
    return evaluate_expression(articles, expression)

def apply_comprehensive_filters(articles, query_filters):
    """Apply comprehensive filtering for cross-field complex queries with proper AND logic."""
    print(f"🔧 Applying comprehensive filters")
    
    if not articles:
        return articles
    
    # Handle root-level mixed field expressions
    root_expression = query_filters.get('expression')
    if root_expression and root_expression.get('type') == 'expression':
        print(f"🎯 Processing root-level mixed field expression")
        return filter_by_mixed_field_expression(articles, root_expression)
    
    # Handle multiple field expressions with AND logic between fields
    current_articles = articles
    
    # Process each field filter with AND logic (same as client-side filtering)
    field_mappings = {
        'keywords': 'keywords',
        'sources': 'source_name', 
        'categories': 'category',
        'countries': 'country'
    }
    
    for field, field_name in field_mappings.items():
        field_query = query_filters.get(field)
        if field_query:
            if field_query.get('type') == 'expression':
                print(f"🔍 Processing complex {field} expression")
                current_articles = filter_by_expression(current_articles, field_query, field_name)
            elif field_query.get('type') == 'term':
                print(f"🔍 Processing {field} term: {field_query.get('value')}")
                current_articles = filter_by_term(current_articles, field_query, field_name)
    
    print(f"✅ Comprehensive filtering complete. {len(current_articles)} articles remaining.")
    return current_articles

def filter_by_mixed_field_expression(articles, expression):
    """Filter articles based on mixed field expressions (cross-field AND/OR logic)."""
    if not expression or not expression.get('children'):
        return articles
    
    def evaluate_mixed_expression(items, expr):
        """Recursively evaluate mixed field expression tree."""
        if not expr or not expr.get('children'):
            return items
        
        children = expr.get('children', [])
        if len(children) == 0:
            return items
        elif len(children) == 1:
            return evaluate_mixed_term(items, children[0])
        
        # Handle multiple children with operators
        result_articles = []
        result_article_ids = set()
        
        for i, child in enumerate(children):
            if child.get('type') == 'term':
                filtered = evaluate_mixed_term(items, child)
            elif child.get('type') == 'expression':
                filtered = evaluate_mixed_expression(items, child)
            else:
                continue
            
            if i == 0:
                # First item - start with these results
                result_articles = filtered
                result_article_ids = {get_article_id(article) for article in filtered}
            else:
                # Apply operator to previous results
                prev_operator = children[i-1].get('operator', 'AND')
                filtered_ids = {get_article_id(article) for article in filtered}
                
                if prev_operator == 'OR':
                    # Add new articles that aren't already in results
                    for article in filtered:
                        article_id = get_article_id(article)
                        if article_id not in result_article_ids:
                            result_articles.append(article)
                            result_article_ids.add(article_id)
                else:  # AND
                    # Keep only articles that are in both result and filtered
                    result_articles = [article for article in result_articles 
                                     if get_article_id(article) in filtered_ids]
                    result_article_ids = result_article_ids.intersection(filtered_ids)
        
        return result_articles
    
    return evaluate_mixed_expression(articles, expression)

def evaluate_mixed_term(articles, term):
    """Evaluate a mixed field term (e.g., keywords: "tesla", sources: "Reuters")."""
    if not term or term.get('type') != 'term':
        return articles
    
    field = term.get('field', '')
    value = term.get('value', '').lower()
    
    if not field or not value:
        return articles
    
    field_name = get_field_name(field)
    return filter_by_term(articles, term, field_name)

def get_field_name(field_key):
    """Map frontend field keys to DynamoDB field names."""
    field_mapping = {
        'keywords': 'keywords',
        'sources': 'source_name', 
        'categories': 'category',
        'countries': 'country'
    }
    return field_mapping.get(field_key, field_key)

def get_article_id(article):
    """Get a unique identifier for an article."""
    return article.get('main_article_id') or article.get('SK', '') or article.get('article_id', '')

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