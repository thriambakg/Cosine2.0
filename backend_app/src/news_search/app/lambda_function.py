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

    try:
        # Parse request body
        body = json.loads(event['body'])
        query_filters = body.get('query', {})
        date_range = body.get('dateRange', '12h')
        limit = body.get('limit', 50)
        offset = body.get('offset', 0)

        # Build DynamoDB query parameters
        query_params = build_dynamodb_query_params(query_filters, date_range, limit)

        # Execute DynamoDB query
        response = execute_dynamodb_query(query_params)
        articles = response.get('Items', [])

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
        'ScanIndexForward': False,  # Newest first
        'FilterExpression': '',
        'ExpressionAttributeValues': {},
        'ExpressionAttributeNames': {}
    }

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

    if date_range != 'all':
        params['FilterExpression'] += '#pd BETWEEN :start_date AND :end_date'
        params['ExpressionAttributeNames']['#pd'] = 'published_date'
        params['ExpressionAttributeValues'][':start_date'] = start_date.isoformat(timespec='seconds') + 'Z'
        params['ExpressionAttributeValues'][':end_date'] = end_date.isoformat(timespec='seconds') + 'Z'

    # Example: Prioritize GSI for source if a simple source term is present
    source_query = query_filters.get('sources')
    if source_query and source_query.get('type') == 'term':
        params['IndexName'] = 'GSI5'  # Source-based GSI
        params['KeyConditionExpression'] = 'GSI5PK = :gsi5pk'
        params['ExpressionAttributeValues'][':gsi5pk'] = f"SOURCE#{source_query['value']}"
        logger.info(f"Using GSI5 for source: {source_query['value']}")
        return params  # Return early for simple GSI query

    # Fallback to main table scan or more complex GSI queries
    # For complex keyword/category/country expressions, a full scan with client-side filtering
    # or multiple GSI queries combined might be necessary.
    logger.info("Falling back to main table scan or complex filtering.")
    params['TableName'] = news_table_name  # Ensure table name is set for scan
    return params

def execute_dynamodb_query(params):
    """Execute DynamoDB query or scan based on parameters."""
    if 'KeyConditionExpression' in params:
        # It's a query operation
        return table.query(**params)
    else:
        # It's a scan operation (less efficient, used for complex filters or no GSI match)
        return table.scan(**params)

def apply_client_side_filters(articles, query_filters):
    """
    Apply filters that couldn't be handled by DynamoDB's query/scan.
    This is a placeholder for complex AND/OR/group logic.
    """
    logger.info("Applying client-side filters (placeholder).")
    # TODO: Implement complex filtering logic based on query_filters structure
    return articles

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
