"""
USAspending Search Lambda Function - Union-Based Approach
Queries DynamoDB awards table using GSIs with UNION logic (any filter matches)
Only uses intersection for range queries (obligation, fiscal year ranges)
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional, Set
from decimal import Decimal
from datetime import datetime
from collections import defaultdict
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer
from cors_helper import get_cors_headers, validate_origin


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def build_cors_headers(origin: str = None):
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def convert_decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal values to float for JSON serialization"""
    try:
        from boto3.dynamodb.types import Binary
        if isinstance(obj, Binary):
            obj = obj.value
    except ImportError:
        pass
    
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, bytes):
        if len(obj) == 1:
            return bool(obj[0])
        else:
            import base64
            return base64.b64encode(obj).decode('utf-8')
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def fetch_oversized_award_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized award details from S3"""
    try:
        if not s3_key:
            return None
        
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        award_details = json.loads(decompressed_content.decode('utf-8'))
        return award_details
    except Exception as e:
        logger.error(f"Error fetching oversized award from S3 ({s3_key}): {str(e)}", exc_info=True)
        return None


def enrich_award_with_details(award: Dict[str, Any]) -> Dict[str, Any]:
    """Enrich award with S3 data if needed"""
    oversize_s3_key = award.get('oversize_s3_key')
    if oversize_s3_key:
        s3_details = fetch_oversized_award_from_s3(oversize_s3_key)
        if s3_details:
            # Merge S3 details into award (S3 data takes precedence)
            award = {**award, **s3_details}
            logger.info(f"Enriched award {award.get('award_id')} with S3 data")
    return award


def query_gsi_union(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_condition: Optional[str] = None,
    range_key_value: Any = None,
    limit: int = 100,
    exclusive_start_key: Optional[Dict] = None
) -> tuple[List[Dict[str, Any]], Optional[Dict], bool]:
    """
    Query a GSI using paginator and return all matching items
    
    Args:
        index_name: GSI name
        hash_key_name: Hash key attribute
        hash_key_value: Hash key value
        range_key_name: Optional range key attribute
        range_key_condition: Optional range condition ('gte', 'lte', 'between', 'eq')
        range_key_value: Range key value (or tuple for 'between')
        limit: Maximum number of items to return per page
        exclusive_start_key: Pagination token
    
    Returns:
        Tuple of (items list, last_evaluated_key, has_more)
    """
    try:
        # Build key condition expression
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if range_key_name and range_key_value is not None:
            if range_key_condition == 'between' and isinstance(range_key_value, tuple):
                key_condition = key_condition & Key(range_key_name).between(range_key_value[0], range_key_value[1])
            elif range_key_condition == 'gte':
                key_condition = key_condition & Key(range_key_name).gte(range_key_value)
            elif range_key_condition == 'lte':
                key_condition = key_condition & Key(range_key_name).lte(range_key_value)
            elif range_key_condition == 'eq' or range_key_condition is None:
                key_condition = key_condition & Key(range_key_name).eq(range_key_value)
        
        # Build query parameters
        query_params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'Limit': limit
        }
        
        if exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key
        
        # Use table resource query
        response = awards_table.query(**query_params)
        
        items = response.get('Items', [])
        last_evaluated_key = response.get('LastEvaluatedKey')
        has_more = last_evaluated_key is not None
        
        # Convert last_evaluated_key to serializable format
        serializable_last_key = None
        if last_evaluated_key:
            serializable_last_key = convert_decimal_to_float(last_evaluated_key)
        
        logger.info(f"Query {index_name} ({hash_key_name}={hash_key_value}): Found {len(items)} items, has_more={has_more}")
        
        return items, serializable_last_key, has_more
        
    except Exception as e:
        logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
        return [], None, False


def get_all_items_from_gsi(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_condition: Optional[str] = None,
    range_key_value: Any = None,
    max_items: int = 50000,
    filter_expression: Optional[Any] = None,
    expression_attribute_values: Optional[Dict[str, Any]] = None,
    scan_index_forward: bool = True
) -> List[Dict[str, Any]]:
    """
    Get ALL items from a GSI using Boto3 paginator (automatically handles pagination)
    Uses get_paginator('query') which simplifies pagination logic
    
    Args:
        index_name: GSI name
        hash_key_name: Hash key attribute
        hash_key_value: Hash key value
        range_key_name: Optional range key attribute
        range_key_condition: Optional range condition
        range_key_value: Range key value
        max_items: Maximum items to fetch (safety limit)
    
    Returns:
        List of all items from the GSI
    """
    try:
        # Build key condition expression using boto3.dynamodb.conditions.Key
        # Key is already imported at the top of the file
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if range_key_name and range_key_value is not None:
            if range_key_condition == 'between' and isinstance(range_key_value, tuple):
                key_condition = key_condition & Key(range_key_name).between(range_key_value[0], range_key_value[1])
            elif range_key_condition == 'gte':
                key_condition = key_condition & Key(range_key_name).gte(range_key_value)
            elif range_key_condition == 'lte':
                key_condition = key_condition & Key(range_key_name).lte(range_key_value)
            elif range_key_condition == 'eq' or range_key_condition is None:
                key_condition = key_condition & Key(range_key_name).eq(range_key_value)
        
        # Use the resource table.query() which handles Key() expressions properly
        # with manual pagination to get all results
        query_params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'Limit': 1000  # Fetch large batches per page for efficiency
        }
        if filter_expression is not None:
            query_params['FilterExpression'] = filter_expression
        if expression_attribute_values is not None:
            query_params['ExpressionAttributeValues'] = expression_attribute_values
        query_params['ScanIndexForward'] = scan_index_forward

        # Use table resource query with manual pagination (simpler than converting to client format)
        all_items = []
        exclusive_start_key = None
        page_count = 0
        max_pages = 200  # Increased safety limit
        
        while page_count < max_pages:
            page_count += 1
            
            # Build params for this page
            page_params = query_params.copy()
            if exclusive_start_key:
                page_params['ExclusiveStartKey'] = exclusive_start_key
            
            # Query using resource table (handles Key() expressions automatically)
            response = awards_table.query(**page_params)
            items = response.get('Items', [])
            last_evaluated_key = response.get('LastEvaluatedKey')
            
            all_items.extend(items)
            
            # Stop if no more pages or reached max items
            if not last_evaluated_key or len(all_items) >= max_items:
                break
            
            exclusive_start_key = last_evaluated_key
        
        logger.info(f"Fetched {len(all_items)} total items from {index_name} ({hash_key_name}={hash_key_value})")
        return all_items
        
    except Exception as e:
        logger.error(f"Error fetching all items from GSI {index_name}: {str(e)}", exc_info=True)
        return []


def fetch_minimal_awards_batch(award_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Fetch minimal award fields using BatchGetItem with ProjectionExpression
    Only fetches fields needed for search results table display
    """
    if not award_ids:
        return []
    
    # Essential fields for search results table and filtering
    # Includes all columns: Recipient, Awarding Agency, Funding Agency, 
    # Recipient Location, Amount, Period Start/End Dates, NAICS Code, PSC Code, Last Updated
    # Plus fields needed for filtering: recipient_id, cfda_number
    projection_expression = (
        'award_id, '
        'award_type, '
        'total_obligation, '
        'total_obligated_amount, '
        'fiscal_year, '
        'awarding_agency_name, '
        'awarding_agency_code, '
        'funding_agency_name, '
        'funding_agency_code, '
        'recipient_id, '
        'recipient_name, '
        'recipient_location_state, '
        'recipient_location_country, '
        'recipient_zip_code, '
        'period_of_performance_start_date, '
        'period_of_performance_current_end_date, '
        'naics_code, '
        'psc_code, '
        'cfda_number, '
        'last_modified_date'
    )
    
    all_items = []
    batch_size = 100
    
    for i in range(0, len(award_ids), batch_size):
        batch_ids = award_ids[i:i + batch_size]
        try:
            request_items = {
                AWARDS_TABLE_NAME: {
                    'Keys': [{'award_id': {'S': str(aid)}} for aid in batch_ids],
                    'ProjectionExpression': projection_expression
                }
            }
            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
            batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
            
            deserializer = TypeDeserializer()
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                all_items.append(converted_item)
        except Exception as e:
            logger.error(f"Error fetching batch: {str(e)}", exc_info=True)
            continue
    
    return all_items


def fetch_full_awards_batch(award_ids: List[str]) -> List[Dict[str, Any]]:
    """Fetch full award items using BatchGetItem (for individual award lookups)"""
    if not award_ids:
        return []
    
    all_items = []
    batch_size = 100
    
    for i in range(0, len(award_ids), batch_size):
        batch_ids = award_ids[i:i + batch_size]
        try:
            request_items = {
                AWARDS_TABLE_NAME: {
                    'Keys': [{'award_id': {'S': str(aid)}} for aid in batch_ids]
                }
            }
            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
            batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
            
            deserializer = TypeDeserializer()
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                all_items.append(converted_item)
        except Exception as e:
            logger.error(f"Error fetching batch: {str(e)}", exc_info=True)
            continue
    
    return all_items


def _build_last_modified_date_filter(updated_date_from: Optional[str], updated_date_to: Optional[str]):
    """
    Build FilterExpression for last_modified_date date range.
    last_modified_date comes from USAspending bulk file (YYYY-MM-DD or similar).
    """
    if not updated_date_from and not updated_date_to:
        return None, None
    start_val = (updated_date_from or '0001-01-01')[:10]
    end_val = (updated_date_to or '9999-12-31')[:10]
    return Attr('last_modified_date').between(start_val, end_val), None


def identify_union_queries(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify all GSI queries needed for union approach
    
    Returns list of query configs for each filter that has a GSI
    """
    queries = []

    # Extract "recently updated" date range (contracts updated within date range)
    updated_date_from = filters.get('updated_date_from') or filters.get('date_from')
    updated_date_to = filters.get('updated_date_to') or filters.get('date_to')
    if updated_date_from is not None:
        updated_date_from = str(updated_date_from).strip()[:10]
    if updated_date_to is not None:
        updated_date_to = str(updated_date_to).strip()[:10]
    has_updated_date_range = bool(updated_date_from or updated_date_to)
    last_modified_date_filter, last_modified_date_attr_vals = _build_last_modified_date_filter(updated_date_from, updated_date_to)
    
    # Convert date_year to fiscal_year FIRST, before processing other filters
    # This ensures that GSIs with fiscal_year can use it
    if filters.get('date_year') and not filters.get('fiscal_year'):
        try:
            fiscal_year = int(filters['date_year'])
            filters['fiscal_year'] = fiscal_year
            logger.info(f"Converted date_year={filters['date_year']} to fiscal_year={fiscal_year}")
        except (ValueError, TypeError) as e:
            logger.warning(f"Error parsing date_year: {e}")
    
    # Extract obligation range filters (these will be intersected, not unioned)
    min_obligation = filters.get('min_obligation')
    max_obligation = filters.get('max_obligation')
    has_obligation_range = min_obligation is not None or max_obligation is not None
    
    # Extract fiscal year filters (after date_year conversion)
    fiscal_years = filters.get('fiscal_year')
    if fiscal_years and not isinstance(fiscal_years, list):
        fiscal_years = [fiscal_years]
    
    # Build obligation range condition if present (used for ObligationIndex GSIs)
    obligation_range_condition = None
    obligation_range_value = None
    if has_obligation_range:
        if min_obligation is not None and max_obligation is not None:
            obligation_range_condition = 'between'
            obligation_range_value = (Decimal(str(min_obligation)), Decimal(str(max_obligation)))
        elif min_obligation is not None:
            obligation_range_condition = 'gte'
            obligation_range_value = Decimal(str(min_obligation))
        elif max_obligation is not None:
            obligation_range_condition = 'lte'
            obligation_range_value = Decimal(str(max_obligation))
    
    # AwardingAgencyCode - always use ObligationIndex (fiscal_year filtering done in Python if needed)
    if filters.get('awarding_agency_code'):
        values = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        for value in values:
            if value and str(value).strip():
                queries.append({
                    'index_name': 'AwardingAgencyCodeObligationIndex',
                    'hash_key_name': 'awarding_agency_code',
                    'hash_key_value': str(value).strip(),
                    'range_key_name': 'total_obligated_amount' if has_obligation_range else None,
                    'range_key_value': obligation_range_value if has_obligation_range else None,
                    'range_key_condition': obligation_range_condition if has_obligation_range else None,
                    'filter_type': 'awarding_agency_code'
                })
    
    # AwardingAgencyName - always use ObligationIndex (fiscal_year filtering done in Python if needed)
    if filters.get('awarding_agency_name'):
        values = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
        for value in values:
            if value and str(value).strip():
                queries.append({
                    'index_name': 'AwardingAgencyNameObligationIndex',
                    'hash_key_name': 'awarding_agency_name',
                    'hash_key_value': str(value).strip(),
                    'range_key_name': 'total_obligated_amount' if has_obligation_range else None,
                    'range_key_value': obligation_range_value if has_obligation_range else None,
                    'range_key_condition': obligation_range_condition if has_obligation_range else None,
                    'filter_type': 'awarding_agency_name'
                })
    
    # ZipCode - always use ObligationIndex (fiscal_year filtering done in Python if needed)
    if filters.get('recipient_zip_code'):
        values = filters['recipient_zip_code'] if isinstance(filters['recipient_zip_code'], list) else [filters['recipient_zip_code']]
        for value in values:
            if value and str(value).strip():
                queries.append({
                    'index_name': 'ZipCodeObligationIndex',
                    'hash_key_name': 'recipient_zip_code',
                    'hash_key_value': str(value).strip(),
                    'range_key_name': 'total_obligated_amount' if has_obligation_range else None,
                    'range_key_value': obligation_range_value if has_obligation_range else None,
                    'range_key_condition': obligation_range_condition if has_obligation_range else None,
                    'filter_type': 'recipient_zip_code'
                })
    
    # RecipientName - always use ObligationIndex (fiscal_year filtering done in Python if needed)
    if filters.get('recipient_name'):
        values = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        for value in values:
            if value and str(value).strip():
                # Normalize recipient name
                normalized = str(value).lower().strip()
                queries.append({
                    'index_name': 'RecipientNameObligationIndex',
                    'hash_key_name': 'recipient_name_normalized',
                    'hash_key_value': normalized,
                    'range_key_name': 'total_obligated_amount' if has_obligation_range else None,
                    'range_key_value': obligation_range_value if has_obligation_range else None,
                    'range_key_condition': obligation_range_condition if has_obligation_range else None,
                    'filter_type': 'recipient_name'
                })
    
    # State - always use ObligationIndex (fiscal_year filtering done in Python if needed)
    if filters.get('recipient_location_state'):
        values = filters['recipient_location_state'] if isinstance(filters['recipient_location_state'], list) else [filters['recipient_location_state']]
        for value in values:
            if value and str(value).strip():
                queries.append({
                    'index_name': 'StateObligationIndex',
                    'hash_key_name': 'recipient_location_state',
                    'hash_key_value': str(value).strip().upper(),
                    'range_key_name': 'total_obligated_amount' if has_obligation_range else None,
                    'range_key_value': obligation_range_value if has_obligation_range else None,
                    'range_key_condition': obligation_range_condition if has_obligation_range else None,
                    'filter_type': 'recipient_location_state'
                })
    
    # AwardTypeFiscalYearIndex
    if filters.get('award_type'):
        values = filters['award_type'] if isinstance(filters['award_type'], list) else [filters['award_type']]
        for value in values:
            if value and str(value).strip():
                queries.append({
                'index_name': 'AwardTypeFiscalYearIndex',
                    'hash_key_name': 'award_type',
                    'hash_key_value': str(value).strip(),
                    'range_key_name': 'fiscal_year',
                    'range_key_value': fiscal_years[0] if fiscal_years else None,
                    'range_key_condition': 'eq' if fiscal_years else None,
                    'filter_type': 'award_type'
                })
    
    # FiscalYearObligationIndex - for obligation ranges (intersection, not union)
    # Only create separate obligation queries if we're NOT using ObligationIndex GSIs for field filters
    # Check if any of the queries we've already added use ObligationIndex GSIs
    using_obligation_index = any(
        q.get('index_name', '').endswith('ObligationIndex') 
        for q in queries
    )
    
    if has_obligation_range and not using_obligation_index:
        # No ObligationIndex GSIs used - need separate FiscalYearObligationIndex queries
        # Build range condition for obligation
        range_condition = None
        range_value = None
        
        if min_obligation is not None and max_obligation is not None:
            range_condition = 'between'
            range_value = (Decimal(str(min_obligation)), Decimal(str(max_obligation)))
        elif min_obligation is not None:
            range_condition = 'gte'
            range_value = Decimal(str(min_obligation))
        elif max_obligation is not None:
            range_condition = 'lte'
            range_value = Decimal(str(max_obligation))
        
        # If fiscal_year is provided, query those specific years
        if fiscal_years:
            for fiscal_year in fiscal_years:
                queries.append({
                    'index_name': 'FiscalYearObligationIndex',
                    'hash_key_name': 'fiscal_year',
                    'hash_key_value': fiscal_year,
                    'range_key_name': 'total_obligated_amount',  # FIXED: Use total_obligated_amount (matches GSI structure)
                    'range_key_value': range_value,
                    'range_key_condition': range_condition,
                    'filter_type': 'obligation_range',
                    'is_intersection': True  # Mark this as intersection query
                })
        else:
            # If fiscal_year is NOT provided, check if we have other field filters
            has_other_filters = any([
                filters.get('awarding_agency_code'),
                filters.get('awarding_agency_name'),
                filters.get('recipient_name'),
                filters.get('recipient_location_state'),
                filters.get('recipient_zip_code'),
                filters.get('award_type')
            ])
            
            if has_other_filters:
                # When combining with other filters, query 3 most recent fiscal years
                # The intersection will naturally limit results, so we don't need all years
                current_year = datetime.now().year
                fiscal_years_to_query = list(range(current_year, current_year - 3, -1))  # Only 3 most recent years
                logger.info(f"Obligation range filter without fiscal_year (with other filters): querying {len(fiscal_years_to_query)} fiscal years ({fiscal_years_to_query[-1]}-{fiscal_years_to_query[0]}) for performance")
                
                for fiscal_year in fiscal_years_to_query:
                    queries.append({
                        'index_name': 'FiscalYearObligationIndex',
                        'hash_key_name': 'fiscal_year',
                        'hash_key_value': fiscal_year,
                        'range_key_name': 'total_obligated_amount',
                        'range_key_value': range_value,
                        'range_key_condition': range_condition,
                        'filter_type': 'obligation_range',
                        'is_intersection': True  # Mark this as intersection query
                    })
            else:
                # Obligation-only search: mark for sequential year-by-year querying
                # We'll query years one at a time starting with current year, stopping when we have enough
                queries.append({
                    'index_name': 'FiscalYearObligationIndex',
                    'hash_key_name': 'fiscal_year',
                    'hash_key_value': None,  # Special marker: query years sequentially
                    'range_key_name': 'total_obligated_amount',
                    'range_key_value': range_value,
                    'range_key_condition': range_condition,
                    'filter_type': 'obligation_range',
                    'is_intersection': True,
                    'sequential_years': True  # Flag to indicate sequential year querying
                })
    elif has_obligation_range and using_obligation_index:
        logger.info("Obligation range already included in ObligationIndex GSIs - skipping separate FiscalYearObligationIndex queries")
    
    # FiscalYearObligationIndex - for fiscal_year queries (no obligation range)
    # Always create FiscalYearObligationIndex queries when fiscal_year is provided (without obligation range)
    # This will be intersected with other field queries using normal intersection logic
    if fiscal_years and not has_obligation_range:
        for fiscal_year in fiscal_years:
            queries.append({
                'index_name': 'FiscalYearObligationIndex',
                'hash_key_name': 'fiscal_year',
                'hash_key_value': fiscal_year,
                'range_key_name': None,
                'range_key_value': None,
                'range_key_condition': None,
                'filter_type': 'fiscal_year',
                'is_intersection': False,
                'filter_expression': last_modified_date_filter,
                'expression_attribute_values': last_modified_date_attr_vals
            })
    
    # LastModifiedDateIndex - for "recently updated" date range (uses last_modified_date from USAspending bulk file)
    # Both is_assistance=0 and is_assistance=1 are field queries (UNION), NOT intersection - we want contracts OR assistance
    if has_updated_date_range and last_modified_date_filter is not None:
        start_val = (updated_date_from or '0001-01-01')[:10]
        end_val = (updated_date_to or '9999-12-31')[:10]
        for is_assistance_val in [0, 1]:
            queries.append({
                'index_name': 'LastModifiedDateIndex',
                'hash_key_name': 'is_assistance',
                'hash_key_value': is_assistance_val,
                'range_key_name': 'last_modified_date',
                'range_key_value': (start_val, end_val),
                'range_key_condition': 'between',
                'filter_type': 'updated_date_range',
                'is_intersection': False,  # Always field query - UNION contracts + assistance, never intersect
                'filter_expression': None,
                'expression_attribute_values': None,
                'scan_index_forward': False  # Newest first, paginate backwards in time
            })
    
    # Do NOT attach last_modified_date FilterExpression to other GSIs - they don't project that attribute.
    # Date filtering is done via LastModifiedDateIndex; we intersect those results with other field results.

    return queries


def search_awards_union(
    filters: Dict[str, Any],
    limit: int = 100,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Search awards using UNION approach: query each filter's GSI separately and combine results
    Uses offset-based pagination for union searches
    
    Args:
        filters: Dictionary of filter fields
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token with offset info: {"offset": int, "total_items": int} (optional)
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    # Extract offset from pagination token
    offset = 0
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        offset = last_evaluated_key.get('offset', 0)
        if not isinstance(offset, int) or offset < 0:
            offset = 0
    
    logger.info(f"Union search with filters: {json.dumps(filters, default=str)}, limit: {limit}, offset: {offset}")
    
    # Handle award_id filter separately (exact match, direct lookup)
    award_ids_filter = filters.get('award_id')
    award_id_set: Optional[Set[str]] = None
    if award_ids_filter:
        award_ids = award_ids_filter if isinstance(award_ids_filter, list) else [award_ids_filter]
        award_ids = [str(aid).strip() for aid in award_ids if aid and str(aid).strip()]
        if award_ids:
            award_id_set = set(award_ids)
            logger.info(f"Direct award_id filter: {len(award_id_set)} award IDs")
    
    # If only award_id filter is provided, fetch directly without GSI queries
    has_other_filters = any(
        key != 'award_id' and filters.get(key) 
        for key in filters.keys()
    )
    
    if award_id_set and not has_other_filters:
        # Only award_id filter - direct lookup
        logger.info(f"Direct award_id lookup only: fetching {len(award_id_set)} awards")
        award_ids_list = sorted(list(award_id_set))
        
        # Apply pagination
        end_offset = offset + limit
        paginated_ids = award_ids_list[offset:end_offset]
        
        # Fetch minimal award fields for search results
        full_items = fetch_minimal_awards_batch(paginated_ids)
        
        # Skip S3 enrichment for search results to keep response size manageable
        # Enrichment is only done for individual award lookups (get_award_by_id)
        
        # Convert decimals to floats
        results = [convert_decimal_to_float(item) for item in full_items]
        
        has_more = end_offset < len(award_ids_list)
        next_offset = end_offset if has_more else None
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': {
                'offset': next_offset,
                'total_items': len(award_ids_list),
                'method': 'union'
            } if next_offset is not None else None,
            'method': 'union',
            'index_used': 'direct_lookup'
        }
    
    # Identify all GSI queries needed (excluding award_id which is handled separately)
    filters_for_queries = {k: v for k, v in filters.items() if k != 'award_id'}
    has_updated_date_range = bool(
        filters.get('updated_date_from') or filters.get('updated_date_to') or
        filters.get('date_from') or filters.get('date_to')
    )
    union_queries = identify_union_queries(filters_for_queries)
    
    if not union_queries and not award_id_set:
        # No GSI queries available and no award_id filter - return empty results
        logger.warning("No GSI queries available for filters")
        return {
            'success': True,
            'results': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
            'method': 'union',
            'index_used': 'none'
        }
    
    # Separate intersection queries (obligation ranges) from field-based queries
    intersection_queries = [q for q in union_queries if q.get('is_intersection')]
    field_queries = [q for q in union_queries if not q.get('is_intersection')]
    
    # Group queries by filter_type (same field)
    # Within each field, we UNION results (multiple values = OR)
    # Across different fields, we INTERSECT results (different fields = AND)
    queries_by_field: Dict[str, List[Dict]] = defaultdict(list)
    
    for query_config in field_queries:
        filter_type = query_config.get('filter_type', 'unknown')
        queries_by_field[filter_type].append(query_config)
    
    logger.info(f"Grouped queries by field: {dict((k, len(v)) for k, v in queries_by_field.items())}")
    
    # Step 1: For each field, UNION all queries within that field
    # When updated_date_range: collect (award_id, last_modified_date) for chronological sort (newest first)
    field_result_sets: Dict[str, Set[str]] = {}
    field_query_counts: Dict[str, int] = {}
    last_updated_ordered_ids: List[str] = []
    
    for filter_type, query_configs in queries_by_field.items():
        field_award_ids: Set[str] = set()
        total_items_queried = 0
        date_range_pairs: List[tuple] = []
        
        logger.info(f"UNION queries for field '{filter_type}': {len(query_configs)} queries")
        
        for query_config in query_configs:
            logger.info(f"  Executing query: {query_config['index_name']} ({query_config['hash_key_name']}={query_config['hash_key_value']})")
            
            # Get all items from this GSI (KEYS_ONLY projection - only award_id + GSI keys, no full item data)
            # This is efficient - we only get award_ids, not full items
            gsi_items = get_all_items_from_gsi(
                index_name=query_config['index_name'],
                hash_key_name=query_config['hash_key_name'],
                hash_key_value=query_config['hash_key_value'],
                range_key_name=query_config.get('range_key_name'),
                range_key_condition=query_config.get('range_key_condition'),
                range_key_value=query_config.get('range_key_value'),
                max_items=50000,
                filter_expression=query_config.get('filter_expression'),
                expression_attribute_values=query_config.get('expression_attribute_values'),
                scan_index_forward=query_config.get('scan_index_forward', True)
            )
            
            # Extract ONLY award_ids from GSI items (KEYS_ONLY projection)
            query_award_ids = {item.get('award_id') for item in gsi_items if item.get('award_id')}
            field_award_ids.update(query_award_ids)
            total_items_queried += len(gsi_items)
            # For updated_date_range: collect (award_id, last_modified_date) - GSI returns newest first
            if filter_type == 'updated_date_range':
                for item in gsi_items:
                    aid = item.get('award_id')
                    lmd = item.get('last_modified_date') or ''
                    if aid:
                        date_range_pairs.append((aid, lmd))
            
            logger.info(f"    Query returned {len(query_award_ids)} items, field total: {len(field_award_ids)}")
        
        if filter_type == 'updated_date_range' and date_range_pairs:
            date_range_pairs.sort(key=lambda x: x[1], reverse=True)
            seen = set()
            for aid, _ in date_range_pairs:
                if aid not in seen:
                    seen.add(aid)
                    last_updated_ordered_ids.append(aid)
        
        field_result_sets[filter_type] = field_award_ids
        field_query_counts[filter_type] = total_items_queried
        logger.info(f"Field '{filter_type}' UNION complete: {len(field_award_ids)} unique award_ids (queried {total_items_queried} total items)")
    
    # Step 2: INTERSECT results across different fields (different fields = AND)
    # IMPORTANT: We only intersect award_id strings (Set[str]), NOT full items
    # All field_result_sets contain only award_id strings extracted from KEYS_ONLY GSI projections
    # No full item data is fetched until later (Step 3) when we need to display results
    # If award_id filter is present, start with it; otherwise start with first field
    all_award_ids: Set[str] = None
    cached_filtered_items: Dict[str, Dict[str, Any]] = {}  # Cache for filtered items from reverse filtering
    
    if award_id_set:
        # Start with award_id set if present
        all_award_ids = award_id_set.copy()
        logger.info(f"Starting with award_id filter: {len(all_award_ids)} award IDs")
    
    # Track if we have incomplete intersection (both queries hit limit)
    incomplete_intersection = False
    
    if field_result_sets:
        # OPTIMIZATION: Use reverse filtering when at least one query hit the 50k limit
        # This ensures we get complete results when queries are truncated
        # Strategy: Pick the smaller field set, fetch its items, filter for the larger field
        if len(field_result_sets) == 2:
            field_list = list(field_result_sets.items())
            field1_type, field1_ids = field_list[0]
            field2_type, field2_ids = field_list[1]
            field1_count = field_query_counts.get(field1_type, 0)
            field2_count = field_query_counts.get(field2_type, 0)
            
            # Check if queries hit the limit (50k)
            field1_hit_limit = field1_count >= 50000
            field2_hit_limit = field2_count >= 50000
            
            # Determine which field is smaller (use for reverse filtering)
            # When both hit limit, use the one with fewer unique IDs
            field1_size = len(field1_ids)
            field2_size = len(field2_ids)
            
            # Use reverse filtering if:
            # 1. One hit limit and other is small (< 10k)
            # NOTE: When both hit limit, we use normal intersection and set has_more=True
            # (fetching 50k items for reverse filtering would timeout)
            use_reverse_filtering = (
                (field1_hit_limit and field2_size < 10000) or 
                (field2_hit_limit and field1_size < 10000)
            )
            
            # Track if we have incomplete results (both hit limit)
            both_hit_limit = field1_hit_limit and field2_hit_limit
            if both_hit_limit:
                incomplete_intersection = True  # Mark that intersection may be incomplete
            
            if use_reverse_filtering:
                # Determine which field to use for fetching (smaller one)
                if field1_size <= field2_size:
                    small_field_type = field1_type
                    small_field_ids = field1_ids
                    large_field_type = field2_type
                    large_field_queries = queries_by_field[field2_type]
                else:
                    small_field_type = field2_type
                    small_field_ids = field2_ids
                    large_field_type = field1_type
                    large_field_queries = queries_by_field[field1_type]
                
                # Safety check: don't fetch more than 50k items (even if smaller field is larger)
                max_items_to_fetch = 50000
                if len(small_field_ids) > max_items_to_fetch:
                    logger.warning(f"Smaller field has {len(small_field_ids)} items, limiting to {max_items_to_fetch} for reverse filtering")
                    small_field_ids = set(list(small_field_ids)[:max_items_to_fetch])
                
                logger.info(f"OPTIMIZATION: Using reverse filtering - {small_field_type} ({len(small_field_ids)} IDs) will be fetched and filtered for {large_field_type} ({field_query_counts.get(large_field_type, 0)} items queried)")
                logger.info(f"  {small_field_type} hit limit: {field1_hit_limit if small_field_type == field1_type else field2_hit_limit}, {large_field_type} hit limit: {field2_hit_limit if large_field_type == field2_type else field1_hit_limit}")
                
                # Fetch minimal items for the smaller field (use minimal fetch to avoid timeout)
                # When both hit limit, we still fetch the smaller one and filter for the larger one
                # This ensures complete results even when both queries are truncated
                small_field_ids_list = list(small_field_ids)
                small_field_items = fetch_minimal_awards_batch(small_field_ids_list)
                
                logger.info(f"  Fetched {len(small_field_items)} minimal items for {small_field_type}")
                
                # Get large field filter values
                large_field_values = set()
                large_field_attr_name = None
                for query_config in large_field_queries:
                    hash_key_name = query_config.get('hash_key_name')
                    hash_key_value = query_config.get('hash_key_value')
                    if hash_key_name and hash_key_value:
                        large_field_attr_name = hash_key_name
                        large_field_values.add(str(hash_key_value).strip())
                
                # Filter small field items for large field values
                if large_field_attr_name and large_field_values:
                    # Handle attribute name mapping
                    item_attr_name = large_field_attr_name
                    if large_field_attr_name == 'recipient_name_normalized':
                        item_attr_name = 'recipient_name'
                    elif large_field_attr_name == 'recipient_location_state':
                        large_field_values = {v.upper() for v in large_field_values}
                    elif large_field_attr_name == 'awarding_agency_name':
                        # Normalize agency names for case-insensitive comparison
                        large_field_values = {v.strip() for v in large_field_values}
                    
                    filtered_items = []
                    for item in small_field_items:
                        item_value = item.get(item_attr_name) or item.get(large_field_attr_name)
                        if item_value:
                            item_value_str = str(item_value).strip()
                            # Normalize for comparison
                            if large_field_attr_name == 'recipient_name_normalized':
                                item_value_str = item_value_str.lower()
                            elif large_field_attr_name == 'recipient_location_state':
                                item_value_str = item_value_str.upper()
                            elif large_field_attr_name == 'awarding_agency_name':
                                # Case-insensitive comparison for agency names
                                item_value_str = item_value_str.strip()
                                # Check if any search value matches (case-insensitive)
                                item_value_lower = item_value_str.lower()
                                for search_value in large_field_values:
                                    if item_value_lower == search_value.lower() or item_value_str == search_value:
                                        filtered_items.append(item)
                                        break
                                continue
                            elif large_field_attr_name == 'recipient_zip_code':
                                # Handle zip+4 format
                                item_value_str = item_value_str.strip()
                                if item_value_str in large_field_values:
                                    filtered_items.append(item)
                                    continue
                                # Check prefix match for zip+4
                                for search_value in large_field_values:
                                    if item_value_str.startswith(search_value) or search_value.startswith(item_value_str.split('-')[0]):
                                        filtered_items.append(item)
                                        break
                                continue
                            
                            if item_value_str in large_field_values:
                                filtered_items.append(item)
                    
                    # Extract award_ids from filtered items and cache the items
                    filtered_award_ids = {item.get('award_id') for item in filtered_items if item.get('award_id')}
                    # Cache filtered items for reuse (avoid re-fetching)
                    for item in filtered_items:
                        award_id = item.get('award_id')
                        if award_id:
                            cached_filtered_items[award_id] = item
                    
                    if all_award_ids is None:
                        all_award_ids = filtered_award_ids
                    else:
                        all_award_ids &= filtered_award_ids
                    logger.info(f"  Filtered to {len(filtered_award_ids)} award_ids matching both fields (cached {len(cached_filtered_items)} items)")
                else:
                    # Fallback to normal intersection
                    if all_award_ids is None:
                        all_award_ids = small_field_ids.copy()
                    else:
                        all_award_ids &= small_field_ids
                    logger.warning(f"Could not determine {large_field_type} filter, using {small_field_type} results only")
            else:
                # Normal intersection: both queries are reasonable size or both hit limit
                # NOTE: This is set intersection of award_id strings only (Set[str] & Set[str])
                # No full items are fetched - we only intersect the award_id strings from GSI queries
                # If both hit limit, intersection may be incomplete - we'll set has_more=True later
                if both_hit_limit:
                    incomplete_intersection = True
                    logger.warning(f"Both queries hit 50k limit - intersection may be incomplete. Will set has_more=True to indicate more results may exist.")
                
                sorted_fields = sorted(field_result_sets.items(), key=lambda x: len(x[1]))
                
                for filter_type, field_ids in sorted_fields:
                    if all_award_ids is None:
                        all_award_ids = field_ids.copy()  # Copy set of award_id strings
                        logger.info(f"Starting with field '{filter_type}': {len(all_award_ids)} award_ids (smallest set)")
                    else:
                        before_count = len(all_award_ids)
                        all_award_ids &= field_ids  # Set intersection: award_id strings only, no item data
                        logger.info(f"INTERSECT with field '{filter_type}': {before_count} -> {len(all_award_ids)} award_ids")
        else:
            # More than 2 fields: use normal intersection
            sorted_fields = sorted(field_result_sets.items(), key=lambda x: len(x[1]))
            
            for filter_type, field_ids in sorted_fields:
                if all_award_ids is None:
                    all_award_ids = field_ids.copy()
                    logger.info(f"Starting with field '{filter_type}': {len(all_award_ids)} award_ids (smallest set)")
                else:
                    before_count = len(all_award_ids)
                    all_award_ids &= field_ids
                    logger.info(f"INTERSECT with field '{filter_type}': {before_count} -> {len(all_award_ids)} award_ids")
    
    if all_award_ids is None:
        all_award_ids = set()
    
    # Step 3: If we have intersection queries (obligation ranges), intersect with field results
    # Note: Multiple fiscal year queries for obligation ranges should be UNIONed (match in ANY fiscal year)
    # Then the unioned result should be INTERSECTed with other field results
    # OPTIMIZATION: When combining with other filters, limit items per fiscal year to avoid timeout
    if intersection_queries:
        # Group obligation range queries by filter_type (in case there are multiple types in future)
        obligation_queries_by_field = defaultdict(list)
        for query_config in intersection_queries:
            filter_type = query_config.get('filter_type', 'unknown')
            obligation_queries_by_field[filter_type].append(query_config)
        
        # Determine max_items per fiscal year query based on whether we have other field filters
        # If we have other field filters, the intersection will naturally limit results, so we can query fewer items
        has_other_field_filters = len(field_result_sets) > 0
        if has_other_field_filters:
            # When combining with other filters, limit to 10k items per fiscal year
            # The intersection with field results will naturally limit final results
            obligation_max_items = 10000
            logger.info(f"Obligation range queries combined with other filters: limiting to {obligation_max_items} items per fiscal year for performance")
        else:
            # Obligation-only search: can query more items
            obligation_max_items = 50000
        
        # For each obligation field type, UNION all queries (e.g., union across fiscal years)
        # Then INTERSECT all obligation field results together
        all_obligation_award_ids: Set[str] = None
        
        for filter_type, query_configs in obligation_queries_by_field.items():
            field_obligation_ids: Set[str] = set()
            
            # Check if this is a sequential year query (obligation-only, no fiscal_year specified)
            sequential_query = any(q.get('sequential_years') for q in query_configs)
            
            if sequential_query:
                # Obligation-only search: query years sequentially, starting with current year
                # Stop when we have enough results (offset + limit + buffer) or all years exhausted
                current_year = datetime.now().year
                max_years_to_query = 10  # Safety limit: query up to 10 years back
                items_needed = offset + limit * 5  # Fetch enough for offset + limit + buffer
                
                logger.info(f"Sequential year querying for obligation-only search: need {items_needed} items (offset: {offset}, limit: {limit})")
                
                query_config = query_configs[0]  # Use the first config as template
                for year_offset in range(max_years_to_query):
                    fiscal_year = current_year - year_offset
                    
                    logger.info(f"  Executing obligation query: {query_config['index_name']} (fiscal_year={fiscal_year})")
                    
                    gsi_items = get_all_items_from_gsi(
                        index_name=query_config['index_name'],
                        hash_key_name='fiscal_year',
                        hash_key_value=fiscal_year,
                        range_key_name=query_config.get('range_key_name'),
                        range_key_condition=query_config.get('range_key_condition'),
                        range_key_value=query_config.get('range_key_value'),
                        max_items=50000,
                        filter_expression=query_config.get('filter_expression'),
                        expression_attribute_values=query_config.get('expression_attribute_values'),
                        scan_index_forward=query_config.get('scan_index_forward', True)
                    )
                    
                    query_ids = {item.get('award_id') for item in gsi_items if item.get('award_id')}
                    field_obligation_ids.update(query_ids)  # UNION: add all IDs from this year
                    
                    logger.info(f"    Fiscal year {fiscal_year} returned {len(query_ids)} items, total so far: {len(field_obligation_ids)}")
                    
                    # Stop if we have enough items or if this year returned fewer than max_items (year exhausted)
                    if len(field_obligation_ids) >= items_needed:
                        logger.info(f"    Have enough items ({len(field_obligation_ids)} >= {items_needed}), stopping year queries")
                        break
                    if len(gsi_items) < 50000:
                        # This year is exhausted (returned fewer than max), but continue to next year
                        # in case we still need more items
                        if len(field_obligation_ids) >= items_needed:
                            break
            else:
                # Normal processing: execute all queries (fiscal years specified or combined with other filters)
                logger.info(f"UNION obligation queries for field '{filter_type}': {len(query_configs)} queries")
                
                for query_config in query_configs:
                    logger.info(f"  Executing obligation query: {query_config['index_name']} ({query_config['hash_key_name']}={query_config['hash_key_value']})")
                    
                    gsi_items = get_all_items_from_gsi(
                        index_name=query_config['index_name'],
                        hash_key_name=query_config['hash_key_name'],
                        hash_key_value=query_config['hash_key_value'],
                        range_key_name=query_config.get('range_key_name'),
                        range_key_condition=query_config.get('range_key_condition'),
                        range_key_value=query_config.get('range_key_value'),
                        max_items=obligation_max_items,
                        filter_expression=query_config.get('filter_expression'),
                        expression_attribute_values=query_config.get('expression_attribute_values'),
                        scan_index_forward=query_config.get('scan_index_forward', True)
                    )
                    
                    query_ids = {item.get('award_id') for item in gsi_items if item.get('award_id')}
                    field_obligation_ids.update(query_ids)  # UNION: add all IDs from this query
                    
                    logger.info(f"    Obligation query returned {len(query_ids)} items, field total: {len(field_obligation_ids)}")
            
            logger.info(f"Field '{filter_type}' obligation UNION complete: {len(field_obligation_ids)} unique award_ids")
            
            # Intersect this field's obligation results with previous obligation results
            if all_obligation_award_ids is None:
                all_obligation_award_ids = field_obligation_ids
            else:
                before_count = len(all_obligation_award_ids)
                all_obligation_award_ids &= field_obligation_ids  # INTERSECT across obligation field types
                logger.info(f"INTERSECT obligation field '{filter_type}': {before_count} -> {len(all_obligation_award_ids)} award_ids")
        
        # Intersect field results with obligation results (or use obligation results directly if no field results)
        if all_obligation_award_ids is not None:
            if all_award_ids is None or len(all_award_ids) == 0:
                # Obligation-only search: use obligation results directly
                all_award_ids = all_obligation_award_ids
                logger.info(f"Obligation-only search: using {len(all_award_ids)} award_ids from obligation queries")
            else:
                # Combine with field filters: intersect
                before_count = len(all_award_ids)
                all_award_ids &= all_obligation_award_ids
                logger.info(f"After obligation range intersection: {before_count} -> {len(all_award_ids)} unique award_ids")
    
    # Ensure all_award_ids is not None
    if all_award_ids is None:
        all_award_ids = set()
    
    total_unique_award_ids = len(all_award_ids)
    
    # Step 3: Optimize fetching strategy based on query type
    # For single-field queries: fetch only what we need (offset + limit + buffer) for performance
    # For multi-field queries: fetch all items to ensure correct pagination (intersections can cause duplicates)
    is_single_field_query = len(queries_by_field) == 1 and not intersection_queries
    
    # Use chronological order (newest first) when date range; else by award_id for consistency
    if last_updated_ordered_ids:
        all_award_ids_sorted = [aid for aid in last_updated_ordered_ids if aid in all_award_ids]
    else:
        all_award_ids_sorted = sorted(list(all_award_ids))
    
    # Check if we have cached items from reverse filtering optimization
    # Use cache if we have items and all needed award_ids are in the cache
    cached_ids_set = set(cached_filtered_items.keys())
    use_cached_items = len(cached_filtered_items) > 0 and all(aid in cached_ids_set for aid in all_award_ids_sorted)
    
    if use_cached_items:
        # Use cached items from reverse filtering (already fetched minimal fields)
        logger.info(f"Using {len(cached_filtered_items)} cached minimal items from reverse filtering optimization (no re-fetch needed)")
        full_items = [cached_filtered_items[aid] for aid in all_award_ids_sorted if aid in cached_filtered_items]
        has_more_estimated = False
    elif is_single_field_query:
        # Single-field query: fetch only what we need for pagination (much faster)
        # Calculate how many items we need: offset + limit + buffer for sorting consistency
        items_to_fetch = min(offset + limit * 3, total_unique_award_ids)  # Buffer of 3x limit for sorting
        award_ids_to_fetch = all_award_ids_sorted[:items_to_fetch]
        logger.info(f"Single-field query: Fetching {items_to_fetch} minimal items (offset: {offset}, limit: {limit}, total: {total_unique_award_ids})")
        full_items = fetch_minimal_awards_batch(award_ids_to_fetch)
        
        # For single-field queries, we can estimate has_more based on total count
        # If we fetched less than total, there are more items
        has_more_estimated = items_to_fetch < total_unique_award_ids
    else:
        # Multi-field query: fetch all items to ensure correct pagination
        # Safety limit: Don't fetch more than 100k items to avoid timeouts
        MAX_ITEMS_TO_FETCH = 100000
        if total_unique_award_ids > MAX_ITEMS_TO_FETCH:
            logger.warning(f"Result set is very large ({total_unique_award_ids} items). Limiting to {MAX_ITEMS_TO_FETCH} for performance.")
            all_award_ids_sorted = all_award_ids_sorted[:MAX_ITEMS_TO_FETCH]
            total_unique_award_ids = MAX_ITEMS_TO_FETCH
        
        logger.info(f"Multi-field query: Fetching all {total_unique_award_ids} minimal award items for consistent sorting and pagination")
        full_items = fetch_minimal_awards_batch(all_award_ids_sorted)
        has_more_estimated = False  # Will be calculated from actual fetched items
    
    # Step 5: Sort - when date range: newest first (last_modified_date desc); else fiscal_year then obligation
    if has_updated_date_range:
        full_items.sort(key=lambda x: (x.get('last_modified_date') or '', x.get('award_id', '')), reverse=True)
    else:
        full_items.sort(key=lambda x: (
            x.get('fiscal_year', 0) or 0,
            x.get('total_obligation', 0) or 0,
            x.get('award_id', '')
        ), reverse=True)
    
    # Step 6: Apply offset and limit for pagination
    paginated_items = full_items[offset:offset + limit]
    results = [convert_decimal_to_float(item) for item in paginated_items]
    
    # Step 7: Determine pagination info
    next_offset = offset + len(results)
    if is_single_field_query:
        # For single-field queries, use estimated has_more
        has_more = has_more_estimated or (next_offset < len(full_items))
    else:
        # For multi-field queries, check actual fetched items
        has_more = next_offset < len(full_items)
    
    # If we detected an incomplete intersection (both queries hit limit):
    # - Only set has_more=True if there are actually more items in the current result set
    # - If we've already returned all items, set has_more=False (can't paginate incomplete intersections)
    if incomplete_intersection:
        if next_offset < len(full_items):
            # There are more items in the current incomplete intersection
            has_more = True
            logger.info(f"Incomplete intersection detected (both queries hit 50k limit) - {len(full_items)} items available, {next_offset} returned, has_more=True")
        else:
            # We've returned all items from the incomplete intersection
            # Can't paginate further since intersection is incomplete
            has_more = False
            logger.warning(f"Incomplete intersection detected (both queries hit 50k limit) - all {len(full_items)} items returned, has_more=False (cannot paginate incomplete intersections)")
    
    # Create pagination token for next page
    next_last_evaluated_key = None
    if has_more:
        next_last_evaluated_key = {
            'offset': next_offset,
            'total_items': total_unique_award_ids,
            'method': 'union'  # Indicate this is union-based pagination
        }
    
    logger.info(f"Returning {len(results)} results (union search), offset: {offset}, next_offset: {next_offset}, total: {total_unique_award_ids}, has_more: {has_more}")
    
    return {
        'success': True,
        'results': results,
        'count': len(results),
        'has_more': has_more,
        'last_evaluated_key': next_last_evaluated_key,
        'method': 'union',
        'index_used': f"{len(union_queries)}_GSIs"
    }


def get_award_by_id(award_id: str) -> Optional[Dict[str, Any]]:
    """Get a single award by ID directly from DynamoDB"""
    try:
        if not award_id:
            return None
        
        response = awards_table.get_item(Key={'award_id': award_id})
        item = response.get('Item')
        
        if item:
            # Enrich with S3 data if needed
            enriched = enrich_award_with_details(item)
            return enriched
        
        return None
    except Exception as e:
        logger.error(f"Error fetching award {award_id}: {str(e)}", exc_info=True)
        return None


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for union-based award search"""
    try:
        # Parse request
        http_method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'POST'))
        origin = event.get('headers', {}).get('Origin') or event.get('headers', {}).get('origin')
        
        # Handle OPTIONS request
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': ''
            }
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        # Check if this is a direct award_id lookup (getAward request)
        award_id = body.get('award_id')
        if award_id:
            logger.info(f"Direct award lookup requested for award_id: {award_id}")
            award = get_award_by_id(award_id)
            
            if award:
                # Convert to response format matching search results
                result = convert_decimal_to_float(award)
                return {
                    'statusCode': 200,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({
                        'success': True,
                        'result': result,
                        'count': 1
                    }, default=str)
                }
            else:
                # Award not found
                return {
                    'statusCode': 200,
                        'headers': build_cors_headers(origin),
                        'body': json.dumps({
                            'success': True,
                            'result': None,
                            'count': 0,
                            'error': f'Award {award_id} not found'
                        }, default=str)
                    }
            
        # Extract search parameters (regular search)
        filters = body.get('filters', {})
        limit = body.get('limit', 100)
        last_evaluated_key = body.get('last_evaluated_key')
            
        # Perform union search
        result = search_awards_union(filters=filters, limit=limit, last_evaluated_key=last_evaluated_key)
        
        # Return response
        return {
            'statusCode': 200,
            'headers': build_cors_headers(origin),
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': build_cors_headers(event.get('headers', {}).get('Origin')),
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }


    
    logger.info(f"Returning {len(results)} results (union search), offset: {offset}, next_offset: {next_offset}, total: {total_unique_award_ids}, has_more: {has_more}")
    
    return {
        'success': True,
        'results': results,
        'count': len(results),
        'has_more': has_more,
        'last_evaluated_key': next_last_evaluated_key,
        'method': 'union',
        'index_used': f"{len(union_queries)}_GSIs"
    }


def get_award_by_id(award_id: str) -> Optional[Dict[str, Any]]:
    """Get a single award by ID directly from DynamoDB"""
    try:
        if not award_id:
            return None
        
        response = awards_table.get_item(Key={'award_id': award_id})
        item = response.get('Item')
        
        if item:
            # Enrich with S3 data if needed
            enriched = enrich_award_with_details(item)
            return enriched
        
        return None
    except Exception as e:
        logger.error(f"Error fetching award {award_id}: {str(e)}", exc_info=True)
        return None


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for union-based award search"""
    try:
        # Parse request
        http_method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'POST'))
        origin = event.get('headers', {}).get('Origin') or event.get('headers', {}).get('origin')
        
        # Handle OPTIONS request
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': ''
            }
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        # Check if this is a direct award_id lookup (getAward request)
        award_id = body.get('award_id')
        if award_id:
            logger.info(f"Direct award lookup requested for award_id: {award_id}")
            award = get_award_by_id(award_id)
            
            if award:
                # Convert to response format matching search results
                result = convert_decimal_to_float(award)
                return {
                    'statusCode': 200,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({
                        'success': True,
                        'result': result,
                        'count': 1
                    }, default=str)
                }
            else:
                # Award not found
                return {
                    'statusCode': 200,
                        'headers': build_cors_headers(origin),
                        'body': json.dumps({
                            'success': True,
                            'result': None,
                            'count': 0,
                            'error': f'Award {award_id} not found'
                        }, default=str)
                    }
            
        # Extract search parameters (regular search)
        filters = body.get('filters', {})
        limit = body.get('limit', 100)
        last_evaluated_key = body.get('last_evaluated_key')
            
        # Perform union search
        result = search_awards_union(filters=filters, limit=limit, last_evaluated_key=last_evaluated_key)
        
        # Return response
        return {
            'statusCode': 200,
            'headers': build_cors_headers(origin),
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': build_cors_headers(event.get('headers', {}).get('Origin')),
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }

