"""
Government Contracts Search tool for the chat agent
Searches DynamoDB for government contracts/awards from USAspending with various filters
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, Any, Optional, List, Set
from decimal import Decimal
from datetime import datetime
from collections import defaultdict
import sys
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

# Configure logging
logger = logging.getLogger(__name__)

# Import agent_logger for WebSocket streaming
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands tool decorator
try:
    from strands import tool
except ImportError as e:
    logger.warning(f"Could not import Strands tool decorator: {e}")
    # Fallback decorator for local development
    def tool(func):
        return func

# AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME')
if not AWARDS_TABLE_NAME:
    raise ValueError("AWARDS_TABLE_NAME environment variable is required")
S3_BUCKET_NAME = os.environ.get('USASPENDING_DATA_S3_BUCKET_NAME') or os.environ.get('S3_BUCKET_NAME')
if not S3_BUCKET_NAME:
    raise ValueError("USASPENDING_DATA_S3_BUCKET_NAME or S3_BUCKET_NAME environment variable is required")

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


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
        logger.warning(f"Error fetching oversized award from S3 ({s3_key}): {str(e)}")
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


def get_all_items_from_gsi(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_condition: Optional[str] = None,
    range_key_value: Any = None,
    max_items: int = 50000
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


def fetch_full_awards_batch(award_ids: List[str]) -> List[Dict[str, Any]]:
    """Fetch full award items using BatchGetItem"""
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


def identify_union_queries(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify all GSI queries needed for union approach
    
    Returns list of query configs for each filter that has a GSI
    """
    queries = []
    
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
                    'range_key_name': 'total_obligated_amount',
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
                'is_intersection': False  # Fiscal_year is a field query, gets intersected with other fields
            })
    
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
    
    # Identify all GSI queries needed
    union_queries = identify_union_queries(filters)
    
    if not union_queries:
        # No GSI queries available - return empty results
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
    field_result_sets: Dict[str, Set[str]] = {}
    
    for filter_type, query_configs in queries_by_field.items():
        field_award_ids: Set[str] = set()
        
        logger.info(f"UNION queries for field '{filter_type}': {len(query_configs)} queries")
        
        for query_config in query_configs:
            logger.info(f"  Executing query: {query_config['index_name']} ({query_config['hash_key_name']}={query_config['hash_key_value']})")
            
            # Get all items from this GSI
            gsi_items = get_all_items_from_gsi(
                index_name=query_config['index_name'],
                hash_key_name=query_config['hash_key_name'],
                hash_key_value=query_config['hash_key_value'],
                range_key_name=query_config.get('range_key_name'),
                range_key_condition=query_config.get('range_key_condition'),
                range_key_value=query_config.get('range_key_value'),
                max_items=50000
            )
            
            # Extract award_ids and UNION them with other queries in this field
            query_award_ids = {item.get('award_id') for item in gsi_items if item.get('award_id')}
            field_award_ids.update(query_award_ids)  # UNION: add all IDs from this query
            
            logger.info(f"    Query returned {len(query_award_ids)} items, field total: {len(field_award_ids)}")
        
        field_result_sets[filter_type] = field_award_ids
        logger.info(f"Field '{filter_type}' UNION complete: {len(field_award_ids)} unique award_ids")
    
    # Step 2: INTERSECT results across different fields (different fields = AND)
    if field_result_sets:
        # Start with the first field's results
        all_award_ids: Set[str] = None
        
        for filter_type, field_ids in field_result_sets.items():
            if all_award_ids is None:
                # First field: use its results as starting point
                all_award_ids = field_ids.copy()
                logger.info(f"Starting with field '{filter_type}': {len(all_award_ids)} award_ids")
            else:
                # Subsequent fields: INTERSECT with existing results
                before_count = len(all_award_ids)
                all_award_ids &= field_ids  # INTERSECT: keep only IDs in both sets
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
                        max_items=50000  # Fetch all items from this year (within obligation range)
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
                        max_items=obligation_max_items  # Use optimized limit
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
    
    # Step 3: Fetch full award items for the items we need (considering offset)
    # Calculate how many items we need to fetch (offset + limit + buffer for enrichment)
    items_to_fetch = min(offset + limit * 5, total_unique_award_ids)  # Fetch enough for offset + limit + buffer
    
    logger.info(f"Fetching full items for {items_to_fetch} award_ids (offset: {offset}, limit: {limit}, total: {total_unique_award_ids})")
    
    # Convert set to sorted list for consistent ordering
    award_ids_list = sorted(list(all_award_ids))[:items_to_fetch]
    full_items = fetch_full_awards_batch(award_ids_list)
    
    # Step 4: Enrich items with S3 data if needed
    enriched_items = []
    for item in full_items:
        try:
            enriched = enrich_award_with_details(item)
            enriched_items.append(enriched)
        except Exception as e:
            logger.error(f"Error enriching award {item.get('award_id')}: {str(e)}")
            enriched_items.append(item)
    
    # Step 5: Sort by fiscal_year descending (most recent first), then by total_obligation descending
    enriched_items.sort(key=lambda x: (
        x.get('fiscal_year', 0) or 0,
        x.get('total_obligation', 0) or 0
    ), reverse=True)
    
    # Step 6: Apply offset and limit for pagination
    paginated_items = enriched_items[offset:offset + limit]
    results = [convert_decimal_to_float(item) for item in paginated_items]
    
    # Step 7: Determine pagination info
    next_offset = offset + len(results)
    has_more = next_offset < len(enriched_items) or next_offset < total_unique_award_ids
    
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


def search_awards_direct(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB using the same union-based approach as the Lambda function
    Uses proper GSI queries for all filter types (zip code, recipient name, agency, etc.)
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    logger.info(f"🔍 search_awards_direct called with filters: {filters}, limit: {limit}")
    logger.info(f"📋 Active filters: {list(filters.keys())}")
    
    # Use the union-based search directly (no import needed)
    return search_awards_union(filters=filters, limit=limit, last_evaluated_key=last_evaluated_key)


class GovtContractsSearcher:
    """
    Searches government contracts/awards in DynamoDB
    """
    
    @staticmethod
    def search_awards_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 100,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search awards and store large results in S3 if needed
        """
        try:
            logger.info(f"🔍 search_awards_with_s3_passthrough: filters={filters}, limit={limit}")
            # Perform search
            result = search_awards_direct(filters, limit, last_evaluated_key)
            logger.info(f"📊 Search result: count={result.get('count', 0)}, method={result.get('method', 'unknown')}, has_more={result.get('has_more', False)}")
            
            # Check if result is large enough to store in S3
            result_json = json.dumps(result)
            result_size = len(result_json)
            logger.info(f"📦 Result size: {result_size} bytes, count: {result.get('count', 0)}")
            
            LARGE_DATA_THRESHOLD = 50000  # 50KB
            LARGE_RESULTS_THRESHOLD = 50  # 50 results
            
            should_store_in_s3 = (
                result_size > LARGE_DATA_THRESHOLD or 
                result.get('count', 0) > LARGE_RESULTS_THRESHOLD
            )
            
            if should_store_in_s3:
                # Store in data-files and return S3 key
                try:
                    # SECURITY: Get user_id from secure source (set by lambda_handler from authorizer/headers)
                    try:
                        from utils.auth_helper import get_secure_user_id
                        user_id = get_secure_user_id({}, fallback_to_env=True)
                        if not user_id:
                            raise ValueError("User ID not available from secure authentication source")
                    except ImportError:
                        user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                        if not user_id:
                            raise ValueError("User ID not available - authentication required")
                        logger.warning("⚠️ Using user_id from environment (auth_helper not available)")
                    session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
                    if not bucket_name:
                        raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    filename = f"govt_contracts_search_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=result_json,
                        ContentType='application/json'
                    )
                    
                    agent_logger.info(f"Stored government contracts search results in S3: {s3_key} ({result_size} bytes, {result.get('count', 0)} results)")
                    
                    # Return reference with S3 key
                    return {
                        "status": "success",
                        "s3_key": s3_key,
                        "data_size_bytes": result_size,
                        "count": result.get('count', 0),
                        "has_more": result.get('has_more', False),
                        "last_evaluated_key": result.get('last_evaluated_key'),
                        "method": result.get('method', 'unknown'),
                        "message": f"Large dataset stored in S3. Use read_s3_file_tool to access: {s3_key}",
                        "summary": {
                            "total_results": result.get('count', 0),
                            "has_more": result.get('has_more', False),
                            "method": result.get('method', 'unknown')
                        }
                    }
                except Exception as s3_error:
                    logger.error(f"Error storing results in S3: {str(s3_error)}")
                    # Fall back to returning result directly
            return result
            
            # Return result directly for small datasets
            return result
            
        except Exception as e:
            logger.error(f"Error searching government contracts: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@tool
def search_govt_contracts(
    filters: str,
    limit: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for government contracts/awards in DynamoDB using various filters.
    
    **IMPORTANT: Use autocomplete before searching:**
    For recipient_name searches, consider using autocomplete if the user provides a generic name.
    The search tool uses substring matching, but autocomplete can help find exact company names.
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - awarding_agency_name: List or string of awarding agency names (case-insensitive substring match)
            - awarding_agency_code: List or string of awarding agency codes (e.g., "012", "020")
            - funding_agency_name: List or string of funding agency names
            - funding_agency_code: List or string of funding agency codes
            - recipient_name: List or string of recipient names (case-insensitive substring match)
            - recipient_location_state: List or string of recipient states (2-letter codes)
            - recipient_location_country: List or string of recipient countries
            - recipient_zip_code: List or string of recipient zip codes (e.g., "61704")
            - award_type: List or string of award types (e.g., "A", "B", "C", "D", "IDV")
            - naics_code: List or string of NAICS codes
            - psc_code: List or string of PSC codes
            - cfda_number: List or string of CFDA numbers
            - fiscal_year: List or integer of fiscal years
            - date_from: Start date in YYYY-MM-DD format
            - date_to: End date in YYYY-MM-DD format
            - min_obligation: Minimum obligation amount (decimal)
            - max_obligation: Maximum obligation amount (decimal)
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        
    Example:
        search_govt_contracts(
            '{"awarding_agency_name": "Department of Defense", "fiscal_year": 2023}',
            limit=5
        )
    """
    try:
        agent_logger.info(f"🔍 search_govt_contracts called with filters: {filters}, limit: {limit}")
        
        # Parse filters JSON
        if isinstance(filters, str):
            filters_dict = json.loads(filters)
        else:
            filters_dict = filters
        
        agent_logger.info(f"📋 Parsed filters: {filters_dict}")
        agent_logger.info(f"🔑 Filter keys: {list(filters_dict.keys())}")
        
        # Parse last_evaluated_key if provided
        last_key = None
        if last_evaluated_key:
            if isinstance(last_evaluated_key, str):
                last_key = json.loads(last_evaluated_key)
            else:
                last_key = last_evaluated_key
            agent_logger.info(f"📄 Pagination: Using last_evaluated_key for continuation")
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 5
        
        agent_logger.info(f"📊 Search parameters: limit={limit}, pagination={'enabled' if last_key else 'disabled'}")
        
        # Perform search
        result = GovtContractsSearcher.search_awards_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, method={result.get('method', 'unknown')}")
        
        # Return as JSON string
        return json.dumps(result, default=str)
        
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON in filters: {str(e)}"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
                except Exception as e:
        error_msg = f"Error searching government contracts: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
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
                    'range_key_name': 'total_obligated_amount',
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
                'is_intersection': False  # Fiscal_year is a field query, gets intersected with other fields
            })
    
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
    
    # Identify all GSI queries needed
    union_queries = identify_union_queries(filters)
    
    if not union_queries:
        # No GSI queries available - return empty results
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
    field_result_sets: Dict[str, Set[str]] = {}
    
    for filter_type, query_configs in queries_by_field.items():
        field_award_ids: Set[str] = set()
        
        logger.info(f"UNION queries for field '{filter_type}': {len(query_configs)} queries")
        
        for query_config in query_configs:
            logger.info(f"  Executing query: {query_config['index_name']} ({query_config['hash_key_name']}={query_config['hash_key_value']})")
            
            # Get all items from this GSI
            gsi_items = get_all_items_from_gsi(
                index_name=query_config['index_name'],
                hash_key_name=query_config['hash_key_name'],
                hash_key_value=query_config['hash_key_value'],
                range_key_name=query_config.get('range_key_name'),
                range_key_condition=query_config.get('range_key_condition'),
                range_key_value=query_config.get('range_key_value'),
                max_items=50000
            )
            
            # Extract award_ids and UNION them with other queries in this field
            query_award_ids = {item.get('award_id') for item in gsi_items if item.get('award_id')}
            field_award_ids.update(query_award_ids)  # UNION: add all IDs from this query
            
            logger.info(f"    Query returned {len(query_award_ids)} items, field total: {len(field_award_ids)}")
        
        field_result_sets[filter_type] = field_award_ids
        logger.info(f"Field '{filter_type}' UNION complete: {len(field_award_ids)} unique award_ids")
    
    # Step 2: INTERSECT results across different fields (different fields = AND)
    if field_result_sets:
        # Start with the first field's results
        all_award_ids: Set[str] = None
        
        for filter_type, field_ids in field_result_sets.items():
            if all_award_ids is None:
                # First field: use its results as starting point
                all_award_ids = field_ids.copy()
                logger.info(f"Starting with field '{filter_type}': {len(all_award_ids)} award_ids")
            else:
                # Subsequent fields: INTERSECT with existing results
                before_count = len(all_award_ids)
                all_award_ids &= field_ids  # INTERSECT: keep only IDs in both sets
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
                        max_items=50000  # Fetch all items from this year (within obligation range)
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
                        max_items=obligation_max_items  # Use optimized limit
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
    
    # Step 3: Fetch full award items for the items we need (considering offset)
    # Calculate how many items we need to fetch (offset + limit + buffer for enrichment)
    items_to_fetch = min(offset + limit * 5, total_unique_award_ids)  # Fetch enough for offset + limit + buffer
    
    logger.info(f"Fetching full items for {items_to_fetch} award_ids (offset: {offset}, limit: {limit}, total: {total_unique_award_ids})")
    
    # Convert set to sorted list for consistent ordering
    award_ids_list = sorted(list(all_award_ids))[:items_to_fetch]
    full_items = fetch_full_awards_batch(award_ids_list)
    
    # Step 4: Enrich items with S3 data if needed
    enriched_items = []
    for item in full_items:
        try:
            enriched = enrich_award_with_details(item)
            enriched_items.append(enriched)
    except Exception as e:
            logger.error(f"Error enriching award {item.get('award_id')}: {str(e)}")
            enriched_items.append(item)
    
    # Step 5: Sort by fiscal_year descending (most recent first), then by total_obligation descending
    enriched_items.sort(key=lambda x: (
        x.get('fiscal_year', 0) or 0,
        x.get('total_obligation', 0) or 0
    ), reverse=True)
    
    # Step 6: Apply offset and limit for pagination
    paginated_items = enriched_items[offset:offset + limit]
    results = [convert_decimal_to_float(item) for item in paginated_items]
    
    # Step 7: Determine pagination info
    next_offset = offset + len(results)
    has_more = next_offset < len(enriched_items) or next_offset < total_unique_award_ids
    
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


def search_awards_direct(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB using the same union-based approach as the Lambda function
    Uses proper GSI queries for all filter types (zip code, recipient name, agency, etc.)
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    logger.info(f"🔍 search_awards_direct called with filters: {filters}, limit: {limit}")
    logger.info(f"📋 Active filters: {list(filters.keys())}")
    
    # Use the union-based search directly (no import needed)
    return search_awards_union(filters=filters, limit=limit, last_evaluated_key=last_evaluated_key)


class GovtContractsSearcher:
    """
    Searches government contracts/awards in DynamoDB
    """
    
    @staticmethod
    def search_awards_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 100,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search awards and store large results in S3 if needed
        """
        try:
            logger.info(f"🔍 search_awards_with_s3_passthrough: filters={filters}, limit={limit}")
            # Perform search
            result = search_awards_direct(filters, limit, last_evaluated_key)
            logger.info(f"📊 Search result: count={result.get('count', 0)}, method={result.get('method', 'unknown')}, has_more={result.get('has_more', False)}")
            
            # Check if result is large enough to store in S3
            result_json = json.dumps(result)
            result_size = len(result_json)
            logger.info(f"📦 Result size: {result_size} bytes, count: {result.get('count', 0)}")
            
            LARGE_DATA_THRESHOLD = 50000  # 50KB
            LARGE_RESULTS_THRESHOLD = 50  # 50 results
            
            should_store_in_s3 = (
                result_size > LARGE_DATA_THRESHOLD or 
                result.get('count', 0) > LARGE_RESULTS_THRESHOLD
            )
            
            if should_store_in_s3:
                # Store in data-files and return S3 key
                try:
                    # SECURITY: Get user_id from secure source (set by lambda_handler from authorizer/headers)
                    try:
                        from utils.auth_helper import get_secure_user_id
                        user_id = get_secure_user_id({}, fallback_to_env=True)
                        if not user_id:
                            raise ValueError("User ID not available from secure authentication source")
                    except ImportError:
                        user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                        if not user_id:
                            raise ValueError("User ID not available - authentication required")
                        logger.warning("⚠️ Using user_id from environment (auth_helper not available)")
                    session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
                    if not bucket_name:
                        raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    filename = f"govt_contracts_search_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=result_json,
                        ContentType='application/json'
                    )
                    
                    agent_logger.info(f"Stored government contracts search results in S3: {s3_key} ({result_size} bytes, {result.get('count', 0)} results)")
                    
                    # Return reference with S3 key
                    return {
                        "status": "success",
                        "s3_key": s3_key,
                        "data_size_bytes": result_size,
                        "count": result.get('count', 0),
                        "has_more": result.get('has_more', False),
                        "last_evaluated_key": result.get('last_evaluated_key'),
                        "method": result.get('method', 'unknown'),
                        "message": f"Large dataset stored in S3. Use read_s3_file_tool to access: {s3_key}",
                        "summary": {
                            "total_results": result.get('count', 0),
                            "has_more": result.get('has_more', False),
                            "method": result.get('method', 'unknown')
                        }
                    }
                except Exception as s3_error:
                    logger.error(f"Error storing results in S3: {str(s3_error)}")
                    # Fall back to returning result directly
                    return result
            
            # Return result directly for small datasets
            return result
            
        except Exception as e:
            logger.error(f"Error searching government contracts: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@tool
def search_govt_contracts(
    filters: str,
    limit: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for government contracts/awards in DynamoDB using various filters.
    
    **IMPORTANT: Use autocomplete before searching:**
    For recipient_name searches, consider using autocomplete if the user provides a generic name.
    The search tool uses substring matching, but autocomplete can help find exact company names.
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - awarding_agency_name: List or string of awarding agency names (case-insensitive substring match)
            - awarding_agency_code: List or string of awarding agency codes (e.g., "012", "020")
            - funding_agency_name: List or string of funding agency names
            - funding_agency_code: List or string of funding agency codes
            - recipient_name: List or string of recipient names (case-insensitive substring match)
            - recipient_location_state: List or string of recipient states (2-letter codes)
            - recipient_location_country: List or string of recipient countries
            - recipient_zip_code: List or string of recipient zip codes (e.g., "61704")
            - award_type: List or string of award types (e.g., "A", "B", "C", "D", "IDV")
            - naics_code: List or string of NAICS codes
            - psc_code: List or string of PSC codes
            - cfda_number: List or string of CFDA numbers
            - fiscal_year: List or integer of fiscal years
            - date_from: Start date in YYYY-MM-DD format
            - date_to: End date in YYYY-MM-DD format
            - min_obligation: Minimum obligation amount (decimal)
            - max_obligation: Maximum obligation amount (decimal)
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        
    Example:
        search_govt_contracts(
            '{"awarding_agency_name": "Department of Defense", "fiscal_year": 2023}',
            limit=5
        )
    """
    try:
        agent_logger.info(f"🔍 search_govt_contracts called with filters: {filters}, limit: {limit}")
        
        # Parse filters JSON
        if isinstance(filters, str):
            filters_dict = json.loads(filters)
        else:
            filters_dict = filters
        
        agent_logger.info(f"📋 Parsed filters: {filters_dict}")
        agent_logger.info(f"🔑 Filter keys: {list(filters_dict.keys())}")
        
        # Parse last_evaluated_key if provided
        last_key = None
        if last_evaluated_key:
            if isinstance(last_evaluated_key, str):
                last_key = json.loads(last_evaluated_key)
            else:
                last_key = last_evaluated_key
            agent_logger.info(f"📄 Pagination: Using last_evaluated_key for continuation")
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 5
        
        agent_logger.info(f"📊 Search parameters: limit={limit}, pagination={'enabled' if last_key else 'disabled'}")
        
        # Perform search
        result = GovtContractsSearcher.search_awards_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, method={result.get('method', 'unknown')}")
        
        # Return as JSON string
        return json.dumps(result, default=str)
        
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON in filters: {str(e)}"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
    except Exception as e:
        error_msg = f"Error searching government contracts: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })