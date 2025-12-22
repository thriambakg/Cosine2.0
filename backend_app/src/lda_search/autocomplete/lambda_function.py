"""
LDA Autocomplete Lambda Function
Reads from S3 CSV files to provide autocomplete suggestions for LDA search fields
"""

import json
import os
import logging
import boto3
import csv
from typing import Dict, List, Any, Optional
from io import StringIO
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
s3_client = boto3.client('s3')

# Environment variables
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-lda-disclosures-production')
S3_PREFIX = os.environ.get('S3_PREFIX', 'lists/')

# Field type to S3 key mapping
FIELD_TYPE_TO_S3_KEY = {
    'registrant': f'{S3_PREFIX}registrant_names.csv',
    'client': f'{S3_PREFIX}client_names.csv',
    'lobbyist': f'{S3_PREFIX}lobbyist_names.csv',
    'pac': f'{S3_PREFIX}pacs.csv',
    'foreign': f'{S3_PREFIX}countries.csv',  # Foreign entities use countries CSV
    'country': f'{S3_PREFIX}countries.csv',
    'government_entity': f'{S3_PREFIX}government_entities.csv',  # Government entities from constants CSV
    'general_issue': f'{S3_PREFIX}general_issues.csv',  # General issue codes from constants CSV
}

# Cache for CSV data (in-memory, per Lambda instance)
_csv_cache: Dict[str, List[str]] = {}


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def load_csv_from_s3(field_type: str) -> List[str]:
    """
    Load CSV file or JSON file from S3 and return list of values
    
    Args:
        field_type: Type of field (e.g., 'registrant', 'client', 'lobbyist', 'government_entity')
    
    Returns:
        List of values from CSV or JSON file
    """
    # Check cache first
    if field_type in _csv_cache:
        return _csv_cache[field_type]
    
    s3_key = FIELD_TYPE_TO_S3_KEY.get(field_type)
    if not s3_key:
        logger.warning(f"Unknown field type: {field_type}")
        return []
    
    try:
        logger.info(f"Loading CSV from s3://{S3_BUCKET_NAME}/{s3_key} for field_type={field_type}")
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        content = response['Body'].read().decode('utf-8')
        
        # Handle CSV files (all constants are now single-column CSV format with names for autocomplete)
        reader = csv.reader(StringIO(content))
        values = []
        
        # Skip header row
        next(reader, None)
        
        # Read all values (single column) - these should be names, not codes/IDs
        for row in reader:
            if row and row[0]:
                value = row[0].strip()
                if value:
                    values.append(value)
        
        # Cache the results
        _csv_cache[field_type] = values
        
        logger.info(f"Loaded {len(values)} values from s3://{S3_BUCKET_NAME}/{s3_key}")
        if values:
            logger.info(f"Sample values (first 5): {values[:5]}")
        return values
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"File not found: s3://{S3_BUCKET_NAME}/{s3_key}")
        return []
    except Exception as e:
        logger.error(f"Error loading file from S3 ({s3_key}): {str(e)}", exc_info=True)
        return []


def search_csv_values(values: List[str], query: str, limit: int = 20) -> List[str]:
    """
    Search CSV values for matches using tiered approach (exact -> starts with -> contains)
    Similar to securities autocomplete logic
    
    Args:
        values: List of values to search
        query: Search query
        limit: Maximum number of results
    
    Returns:
        List of matching values in priority order
    """
    if not query:
        return values[:limit]
    
    query_lower = query.lower().strip()
    if not query_lower:
        return values[:limit]
    
    # Tiered search results
    exact_matches = []
    starts_with_matches = []
    contains_matches = []
    
    for value in values:
        value_lower = value.lower()
        
        # Exact match (highest priority)
        if value_lower == query_lower:
            exact_matches.append(value)
        # Starts with (second priority)
        elif value_lower.startswith(query_lower):
            starts_with_matches.append(value)
        # Contains (fallback)
        elif query_lower in value_lower:
            contains_matches.append(value)
    
    # Combine results in priority order
    all_matches = exact_matches + starts_with_matches + contains_matches
    
    return all_matches[:limit]


def handle_autocomplete_request(field_types: List[str], query: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
    """
    Handle autocomplete request for multiple field types with pagination
    
    Args:
        field_types: List of field types to search (e.g., ['registrant', 'client'])
        query: Search query
        limit: Maximum number of results to return
        offset: Number of results to skip (for pagination)
    
    Returns:
        Dictionary with autocomplete results
    """
    all_results = []
    
    # Get more matches than needed to allow for pagination
    # We'll search for limit * 10 to ensure we have enough results across all field types
    search_limit = max(limit * 10, 100)  # At least 100 per field type
    
    for field_type in field_types:
        # Load CSV for this field type
        values = load_csv_from_s3(field_type)
        
        if not values:
            logger.warning(f"No values loaded for field_type={field_type}")
            continue
        
        logger.info(f"Searching {len(values)} values for field_type={field_type} with query='{query}'")
        
        # Search for matches (get more than needed for pagination)
        matches = search_csv_values(values, query, search_limit)
        
        logger.info(f"Found {len(matches)} matches for field_type={field_type}")
        
        # Add field type indicator to results
        for match in matches:
            all_results.append({
                'value': match,
                'type': field_type,
                'label': f"{match} ({field_type})"
            })
    
    # Sort by value (alphabetically)
    all_results.sort(key=lambda x: x['value'].lower())
    
    # Apply pagination
    total_count = len(all_results)
    paginated_results = all_results[offset:offset + limit]
    has_more = (offset + limit) < total_count
    
    return {
        'success': True,
        'results': paginated_results,
        'count': len(paginated_results),
        'total_count': total_count,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
        'query': query,
        'field_types': field_types
    }


def process_autocomplete_request(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Process autocomplete request (extracted from lambda_handler for reuse)
    """
    cors_headers = get_cors_headers()
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    try:
        logger.info(f"Received autocomplete request: {json.dumps(event)}")
        
        # Parse request - handle both API Gateway and direct invocation
        if 'httpMethod' in event:
            # API Gateway event
            # Parse body
            if isinstance(event.get('body'), str):
                try:
                    request_body = json.loads(event['body'])
                except json.JSONDecodeError:
                    request_body = {}
            else:
                request_body = event.get('body', {})
        else:
            # Direct invocation
            request_body = event
        
        # Extract parameters
        query = request_body.get('query', '').strip()
        field_types = request_body.get('field_types', ['registrant', 'client', 'lobbyist', 'pac'])
        limit = min(request_body.get('limit', 20), 50)  # Cap at 50
        offset = max(request_body.get('offset', 0), 0)  # Offset for pagination
        
        # Validate field types
        if not isinstance(field_types, list):
            field_types = [field_types] if field_types else ['registrant', 'client', 'lobbyist', 'pac']
        
        # Filter out invalid field types
        valid_field_types = [ft for ft in field_types if ft in FIELD_TYPE_TO_S3_KEY]
        if not valid_field_types:
            valid_field_types = ['registrant', 'client', 'lobbyist', 'pac']  # Default
        
        # Handle autocomplete request
        result = handle_autocomplete_request(valid_field_types, query, limit, offset)
        
        # Return success response
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'results': result['results'],
                'count': result['count'],
                'total_count': result.get('total_count', result['count']),
                'has_more': result.get('has_more', False),
                'offset': offset,
                'limit': limit,
                'query': query,
                'field_types': valid_field_types,
                'metadata': {
                    'timestamp': datetime.utcnow().isoformat(),
                    'bucket': S3_BUCKET_NAME
                }
            })
        }
    
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Validation error',
                'message': str(e)
            })
        }
    
    except Exception as e:
        logger.error(f"Error processing autocomplete request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for LDA autocomplete requests
    
    Expected event structure:
    {
        "httpMethod": "POST",
        "body": "{\"query\": \"Microsoft\", \"field_types\": [\"registrant\", \"client\"], \"limit\": 20}"
    }
    
    Or from SQS:
    {
        "Records": [{
            "body": "{\"request_id\": \"...\", \"api_gateway_event\": {...}}"
        }]
    }
    """
    # Handle SQS events
    if 'Records' in event and len(event.get('Records', [])) > 0:
        # This is an SQS event
        try:
            record = event['Records'][0]
            message_body = json.loads(record.get('body', '{}'))
            request_id = message_body.get('request_id')
            api_gateway_event = message_body.get('api_gateway_event', {})
            
            # Get SNS topic ARN from environment
            sns_topic_arn = os.environ.get('LDA_AUTOCOMPLETE_COMPLETION_SNS_TOPIC_ARN')
            
            # Process the request
            try:
                result = process_autocomplete_request(api_gateway_event, context)
                
                # Publish completion notification
                if sns_topic_arn:
                    sns_client = boto3.client('sns')
                    sns_client.publish(
                        TopicArn=sns_topic_arn,
                        Message=json.dumps({
                            'request_id': request_id,
                            'status': 'completed',
                            'response': result
                        }),
                        MessageAttributes={
                            'request_id': {
                                'DataType': 'String',
                                'StringValue': request_id
                            }
                        }
                    )
                
                return result
            except Exception as e:
                logger.error(f"Error processing SQS event: {str(e)}", exc_info=True)
                
                # Publish failure notification
                if sns_topic_arn:
                    sns_client = boto3.client('sns')
                    sns_client.publish(
                        TopicArn=sns_topic_arn,
                        Message=json.dumps({
                            'request_id': request_id,
                            'status': 'failed',
                            'error': str(e)
                        }),
                        MessageAttributes={
                            'request_id': {
                                'DataType': 'String',
                                'StringValue': request_id
                            }
                        }
                    )
                
                raise
        except Exception as e:
            logger.error(f"Error processing SQS event: {str(e)}", exc_info=True)
            raise
    
    # Regular API Gateway or direct invocation
    return process_autocomplete_request(event, context)

