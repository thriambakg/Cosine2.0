"""
USAspending Search Lambda Function
Queries DynamoDB awards table using GSIs and filters to return matching awards
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def convert_decimal_to_float(obj: Any) -> Any:
    """
    Recursively convert Decimal values to float for JSON serialization
    """
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def fetch_award_details_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch award details (transactions and subawards) from S3
    
    Args:
        s3_key: S3 key for the award details file (gzipped JSON)
    
    Returns:
        Dictionary with 'transactions' and 'subawards' keys, or None if error
    """
    try:
        if not s3_key:
            return None
        
        # Fetch object from S3
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        
        # Decompress gzipped content
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        
        # Parse JSON
        award_details = json.loads(decompressed_content.decode('utf-8'))
        
        return award_details
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"Award details not found in S3: {s3_key}")
        return None
    except Exception as e:
        logger.error(f"Error fetching award details from S3 ({s3_key}): {str(e)}", exc_info=True)
        return None


def build_filter_expression(filters: Dict[str, Any]) -> Optional[Any]:
    """
    Build DynamoDB filter expression from user filters
    
    Args:
        filters: Dictionary of filter fields
    
    Returns:
        DynamoDB ConditionExpression or None
    """
    conditions = []
    
    # Award type filter
    if filters.get('award_type'):
        award_types = filters['award_type'] if isinstance(filters['award_type'], list) else [filters['award_type']]
        if len(award_types) == 1:
            conditions.append(Attr('award_type').eq(award_types[0]))
        else:
            conditions.append(Attr('award_type').is_in(award_types))
    
    # Agency filters
    if filters.get('awarding_agency_code'):
        codes = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        if len(codes) == 1:
            conditions.append(Attr('awarding_agency_code').eq(codes[0]))
        else:
            conditions.append(Attr('awarding_agency_code').is_in(codes))
    
    if filters.get('funding_agency_code'):
        codes = filters['funding_agency_code'] if isinstance(filters['funding_agency_code'], list) else [filters['funding_agency_code']]
        if len(codes) == 1:
            conditions.append(Attr('funding_agency_code').eq(codes[0]))
        else:
            conditions.append(Attr('funding_agency_code').is_in(codes))
    
    # Recipient filters
    if filters.get('recipient_id'):
        recipient_ids = filters['recipient_id'] if isinstance(filters['recipient_id'], list) else [filters['recipient_id']]
        if len(recipient_ids) == 1:
            conditions.append(Attr('recipient_id').eq(recipient_ids[0]))
        else:
            conditions.append(Attr('recipient_id').is_in(recipient_ids))
    
    if filters.get('recipient_name'):
        # Use contains for partial name matching (case-insensitive via normalized field)
        recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        name_conditions = []
        for name in recipient_names:
            normalized = name.lower().strip()
            name_conditions.append(Attr('recipient_name_normalized').contains(normalized))
        if name_conditions:
            # OR condition for multiple names
            combined = name_conditions[0]
            for cond in name_conditions[1:]:
                combined = combined | cond
            conditions.append(combined)
    
    # Location filters
    if filters.get('recipient_location_state'):
        states = filters['recipient_location_state'] if isinstance(filters['recipient_location_state'], list) else [filters['recipient_location_state']]
        if len(states) == 1:
            conditions.append(Attr('recipient_location_state').eq(states[0]))
        else:
            conditions.append(Attr('recipient_location_state').is_in(states))
    
    if filters.get('recipient_location_country'):
        countries = filters['recipient_location_country'] if isinstance(filters['recipient_location_country'], list) else [filters['recipient_location_country']]
        if len(countries) == 1:
            conditions.append(Attr('recipient_location_country').eq(countries[0]))
        else:
            conditions.append(Attr('recipient_location_country').is_in(countries))
    
    # Reference code filters
    if filters.get('naics_code'):
        codes = filters['naics_code'] if isinstance(filters['naics_code'], list) else [filters['naics_code']]
        if len(codes) == 1:
            conditions.append(Attr('naics_code').eq(codes[0]))
        else:
            conditions.append(Attr('naics_code').is_in(codes))
    
    if filters.get('psc_code'):
        codes = filters['psc_code'] if isinstance(filters['psc_code'], list) else [filters['psc_code']]
        if len(codes) == 1:
            conditions.append(Attr('psc_code').eq(codes[0]))
        else:
            conditions.append(Attr('psc_code').is_in(codes))
    
    if filters.get('cfda_number'):
        numbers = filters['cfda_number'] if isinstance(filters['cfda_number'], list) else [filters['cfda_number']]
        if len(numbers) == 1:
            conditions.append(Attr('cfda_number').eq(numbers[0]))
        else:
            conditions.append(Attr('cfda_number').is_in(numbers))
    
    # Amount filters
    if filters.get('min_obligation') is not None:
        conditions.append(Attr('total_obligation').gte(Decimal(str(filters['min_obligation']))))
    
    if filters.get('max_obligation') is not None:
        conditions.append(Attr('total_obligation').lte(Decimal(str(filters['max_obligation']))))
    
    # Date filters
    if filters.get('date_from'):
        conditions.append(Attr('period_start_date').gte(filters['date_from']))
    
    if filters.get('date_to'):
        conditions.append(Attr('period_start_date').lte(filters['date_to']))
    
    # Fiscal year filter
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if len(fiscal_years) == 1:
            conditions.append(Attr('fiscal_year').eq(fiscal_years[0]))
        else:
            conditions.append(Attr('fiscal_year').is_in(fiscal_years))
    
    # Description/keywords filter (text search)
    if filters.get('keywords') or filters.get('description'):
        keywords = filters.get('keywords', []) + (filters.get('description', []) if isinstance(filters.get('description'), list) else [filters.get('description')] if filters.get('description') else [])
        if keywords:
            keyword_conditions = []
            for keyword in keywords:
                if keyword:
                    keyword_conditions.append(Attr('description').contains(keyword))
            if keyword_conditions:
                # OR condition for multiple keywords
                combined = keyword_conditions[0]
                for cond in keyword_conditions[1:]:
                    combined = combined | cond
                conditions.append(combined)
    
    # Combine all conditions with AND
    if conditions:
        filter_expr = conditions[0]
        for cond in conditions[1:]:
            filter_expr = filter_expr & cond
        return filter_expr
    
    return None


def determine_query_method(filters: Dict[str, Any]) -> tuple[str, Optional[str], Optional[Dict]]:
    """
    Determine the best query method based on available filters
    
    Returns:
        Tuple of (method, index_name, key_condition_dict)
        method: 'query' or 'scan'
        index_name: GSI name if using query, None if scan
        key_condition: Dict with hash_key and range_key conditions
    """
    # Check for GSI-optimized queries
    
    # StateFiscalYearIndex: hash_key=recipient_location_state, range_key=fiscal_year
    if filters.get('recipient_location_state') and filters.get('fiscal_year'):
        state = filters['recipient_location_state']
        if isinstance(state, list):
            state = state[0]  # Use first state for hash key
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]  # Use first fiscal year for range key
        
        key_condition = {
            'hash_key': ('recipient_location_state', state),
            'range_key': ('fiscal_year', fiscal_year)
        }
        return ('query', 'StateFiscalYearIndex', key_condition)
    
    # AwardTypeFiscalYearIndex: hash_key=award_type, range_key=fiscal_year
    if filters.get('award_type') and filters.get('fiscal_year'):
        award_type = filters['award_type']
        if isinstance(award_type, list):
            award_type = award_type[0]  # Use first award type for hash key
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]  # Use first fiscal year for range key
        
        key_condition = {
            'hash_key': ('award_type', award_type),
            'range_key': ('fiscal_year', fiscal_year)
        }
        return ('query', 'AwardTypeFiscalYearIndex', key_condition)
    
    # AwardTypeFiscalYearIndex with just award_type (no fiscal_year filter)
    if filters.get('award_type') and not filters.get('fiscal_year'):
        award_type = filters['award_type']
        if isinstance(award_type, list):
            award_type = award_type[0]
        
        key_condition = {
            'hash_key': ('award_type', award_type),
            'range_key': None  # No range key filter
        }
        return ('query', 'AwardTypeFiscalYearIndex', key_condition)
    
    # StateFiscalYearIndex with just state (no fiscal_year filter)
    if filters.get('recipient_location_state') and not filters.get('fiscal_year'):
        state = filters['recipient_location_state']
        if isinstance(state, list):
            state = state[0]
        
        key_condition = {
            'hash_key': ('recipient_location_state', state),
            'range_key': None  # No range key filter
        }
        return ('query', 'StateFiscalYearIndex', key_condition)
    
    # Default to scan if no GSI-optimized query available
    return ('scan', None, None)


def search_awards(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB using filters
    
    Args:
        filters: Dictionary of filter fields
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token from previous request
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    # Determine query method
    method, index_name, key_condition = determine_query_method(filters)
    
    # Build filter expression
    filter_expr = build_filter_expression(filters)
    
    # Build query/scan parameters
    params = {
        'Limit': limit
    }
    
    if method == 'query' and index_name:
        # Use GSI query
        hash_key_name, hash_key_value = key_condition['hash_key']
        params['IndexName'] = index_name
        params['KeyConditionExpression'] = Key(hash_key_name).eq(hash_key_value)
        
        # Add range key condition if provided
        if key_condition.get('range_key'):
            range_key_name, range_key_value = key_condition['range_key']
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).eq(range_key_value)
        
        # Add filter expression if we have additional filters
        if filter_expr:
            # Remove conditions that are already in KeyConditionExpression
            # (hash_key and range_key are already handled)
            params['FilterExpression'] = filter_expr
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Querying {index_name} with hash_key={hash_key_name}={hash_key_value}")
        response = awards_table.query(**params)
    
    else:
        # Use table scan
        if filter_expr:
            params['FilterExpression'] = filter_expr
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Scanning awards table with filters")
        response = awards_table.scan(**params)
    
    # Extract results
    items = response.get('Items', [])
    last_eval_key = response.get('LastEvaluatedKey')
    
    # Convert Decimal to float for JSON serialization
    results = [convert_decimal_to_float(item) for item in items]
    
    # Enrich results with S3 award details (transactions and subawards)
    enriched_results = []
    for award in results:
        # Fetch award details from S3 if s3_key exists
        s3_key = award.get('award_details_s3_key')
        if s3_key:
            award_details = fetch_award_details_from_s3(s3_key)
            if award_details:
                # Add transactions and subawards to the award record
                award['transactions'] = award_details.get('transactions', [])
                award['subawards'] = award_details.get('subawards', [])
            else:
                # If fetch failed, initialize empty arrays
                award['transactions'] = []
                award['subawards'] = []
        else:
            # No S3 key, initialize empty arrays
            award['transactions'] = []
            award['subawards'] = []
        
        enriched_results.append(award)
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': last_eval_key is not None,
        'last_evaluated_key': last_eval_key,
        'method': method,
        'index_used': index_name
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for searching awards
    """
    try:
        headers = get_cors_headers()
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'message': 'CORS pre-flight response'})
            }
        
        # Parse request
        if event.get('httpMethod'):
            # API Gateway event
            try:
                body = json.loads(event.get('body', '{}'))
            except json.JSONDecodeError:
                body = {}
            
            # Also check query parameters
            query_params = event.get('queryStringParameters') or {}
            if query_params:
                body.update(query_params)
        else:
            # Direct Lambda invocation
            body = event
        
        # Extract parameters
        filters = body.get('filters', {})
        limit = int(body.get('limit', 100))
        last_evaluated_key = body.get('last_evaluated_key')
        
        # Validate limit
        if limit > 1000:
            limit = 1000  # Cap at 1000
        if limit < 1:
            limit = 100
        
        logger.info(f"Searching awards with filters: {json.dumps(filters, default=str)}, limit: {limit}")
        
        # Search awards
        result = search_awards(filters, limit=limit, last_evaluated_key=last_evaluated_key)
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

