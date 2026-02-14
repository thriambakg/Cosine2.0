"""
Congress Bills Search Lambda Function - Query-Based Approach
Uses Boto3 query method efficiently with union/intersection logic
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional, Set
from decimal import Decimal
from datetime import datetime, timedelta
from collections import defaultdict
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer
from cors_helper import get_cors_headers, validate_origin

from roll_call_search_helper import search_roll_call_vote, search_roll_call_rolls


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
BILLS_TABLE_NAME = os.environ.get('BILLS_TABLE_NAME', 'congress-bills')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-congress-bills-data-production')

# Get DynamoDB table
bills_table = dynamodb.Table(BILLS_TABLE_NAME) if BILLS_TABLE_NAME else None


def build_cors_headers(origin: str = None):
    """Build CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def convert_decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal values to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def is_search_index_item(item: Dict[str, Any]) -> bool:
    """Check if an item is a search index item (should be filtered out)"""
    if not item:
        return False
    bill_id = str(item.get('bill_id', ''))
    return bill_id.startswith('SEARCH#') or item.get('is_search_index') is True or item.get('search_type') is not None


def fetch_oversized_bill_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized bill details from S3"""
    try:
        if not s3_key:
            return None
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        return json.loads(decompressed_content.decode('utf-8'))
    except Exception as e:
        logger.error(f"Error fetching oversized bill from S3 ({s3_key}): {str(e)}", exc_info=True)
        return None


def enrich_bill_with_details(bill: Dict[str, Any]) -> Dict[str, Any]:
    """Enrich bill with S3 data if needed"""
    oversize_s3_key = bill.get('oversize_s3_key')
    if oversize_s3_key:
        s3_details = fetch_oversized_bill_from_s3(oversize_s3_key)
        if s3_details:
            bill = {**bill, **s3_details}
            logger.info(f"Enriched bill {bill.get('bill_id')} with S3 data")
    return bill


def query_gsi(index_name: str, hash_key_name: str, hash_key_value: Any,
              date_from: Optional[str] = None, date_to: Optional[str] = None,
              limit: int = 100, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """
    Query a GSI and return bill_ids
    
    Args:
        index_name: Name of the GSI
        hash_key_name: Hash key attribute name
        hash_key_value: Hash key value
        date_from: Optional date filter (YYYY-MM-DD) - uses introduced_date range key for GSIs with range keys
        date_to: Optional date filter (YYYY-MM-DD) - uses introduced_date range key for GSIs with range keys
        limit: Maximum number of items to return
        exclusive_start_key: Pagination token
    
    Returns:
        Tuple of (list of bill_ids, last_evaluated_key)
    """
    try:
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        # GSIs with introduced_date as range key (can use range conditions)
        gsis_with_date_range = [
            'SponsorNameDateIndex', 'SponsorPartyDateIndex', 'BillTitleDateIndex',
            'BillTypeDateIndex', 'BillNumberDateIndex', 'BipartisanDateIndex',
            'PolicyAreaDateIndex', 'HasRollCallIndex'
        ]
        
        # GSIs without range keys (hash key only - no range query support)
        gsis_without_range = ['IntroducedDateIndex', 'LatestActionDateIndex']
        
        # Add date range condition only for GSIs that have introduced_date as range key
        if index_name in gsis_with_date_range:
            # Make date_to inclusive by appending time if needed
            date_to_inclusive = None
            if date_to:
                # If date_to doesn't already have a time component, append end of day
                if 'T' not in date_to and ' ' not in date_to:
                    date_to_inclusive = f"{date_to}T23:59:59.999Z"
                else:
                    date_to_inclusive = date_to
            
            if date_from and date_to_inclusive:
                key_condition = key_condition & Key('introduced_date').between(date_from, date_to_inclusive)
            elif date_from:
                key_condition = key_condition & Key('introduced_date').gte(date_from)
            elif date_to_inclusive:
                key_condition = key_condition & Key('introduced_date').lte(date_to_inclusive)
        
        # Build projection expression based on GSI type
        # For KEYS_ONLY GSIs, only hash key and bill_id are projected
        if index_name in gsis_without_range:
            # For GSIs without range keys, only project hash key and bill_id
            # (introduced_date/latest_action_date is the hash key, so it's automatically included)
            projection_expr = f'{hash_key_name}, bill_id'
        elif index_name in gsis_with_date_range:
            # For GSIs with introduced_date as range key, project hash key, bill_id, and introduced_date
            projection_expr = f'{hash_key_name}, bill_id, introduced_date'
        else:
            # Default: project hash key and bill_id
            projection_expr = f'{hash_key_name}, bill_id'
        
        params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': projection_expr,
            'Limit': limit
        }
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = bills_table.query(**params)
        items = response.get('Items', [])
        bill_ids = [item.get('bill_id') for item in items if item.get('bill_id') and not is_search_index_item(item)]
        return bill_ids, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying {index_name}: {e}", exc_info=True)
        return [], None


def query_cosponsor_search_index(cosponsor_name: str, date_from: Optional[str] = None,
                                  date_to: Optional[str] = None, limit: int = 100,
                                  exclusive_start_key: Optional[Dict] = None) -> tuple:
    """
    Query cosponsor search index (SEARCH#COSPONSOR# pattern)
    
    Structure:
    - bill_id = SEARCH#COSPONSOR#<name> (hash key)
    - search_index_sk = INTRODUCED_DATE#<date>#<bill_id> (range key)
    """
    try:
        if not cosponsor_name:
            return [], None
        
        normalized_name = str(cosponsor_name).strip()
        search_bill_id = f"SEARCH#COSPONSOR#{normalized_name}"
        
        # Build key condition
        key_condition = Key('bill_id').eq(search_bill_id)
        
        # Handle date range by querying each day if needed
        if date_from and date_to:
            # Extract just the date part
            date_from_str = date_from.split('T')[0].split(' ')[0][:10] if 'T' in date_from or ' ' in date_from else date_from[:10]
            date_to_str = date_to.split('T')[0].split(' ')[0][:10] if 'T' in date_to or ' ' in date_to else date_to[:10]
            
            try:
                from_date_obj = datetime.strptime(date_from_str, '%Y-%m-%d').date()
                to_date_obj = datetime.strptime(date_to_str, '%Y-%m-%d').date()
                
                # Query up to 30 days per request to avoid timeout
                all_bill_ids = set()
                current_date = from_date_obj
                days_queried = 0
                max_days = 30
                
                while current_date <= to_date_obj and days_queried < max_days:
                    date_str = current_date.strftime('%Y-%m-%d')
                    sk_prefix = f"INTRODUCED_DATE#{date_str}#"
                    date_key_condition = key_condition & Key('search_index_sk').begins_with(sk_prefix)
                    
                    params = {
                        'KeyConditionExpression': date_key_condition,
                        'ProjectionExpression': 'entity_bill_id, search_index_sk',
                        'Limit': 1000
                    }
                    
                    if exclusive_start_key and exclusive_start_key.get('current_date') == date_str:
                        params['ExclusiveStartKey'] = exclusive_start_key.get('last_evaluated_key')
                    
                    response = bills_table.query(**params)
                    items = response.get('Items', [])
                    
                    for item in items:
                        entity_bill_id = item.get('entity_bill_id')
                        if entity_bill_id:
                            all_bill_ids.add(entity_bill_id)
                        else:
                            # Fallback: extract from search_index_sk
                            sk = item.get('search_index_sk', '')
                            if sk and '#' in sk:
                                parts = sk.split('#')
                                if len(parts) >= 3:
                                    all_bill_ids.add(parts[2])
                    
                    if response.get('LastEvaluatedKey'):
                        # More items for this date
                        last_eval_key = {
                            'current_date': date_str,
                            'last_evaluated_key': response['LastEvaluatedKey']
                        }
                        break
                    
                    current_date += timedelta(days=1)
                    days_queried += 1
                
                bill_ids = list(all_bill_ids)
                last_eval = {'current_date': current_date.strftime('%Y-%m-%d')} if current_date <= to_date_obj else None
                return bill_ids, last_eval
            except Exception as e:
                logger.error(f"Error parsing dates for cosponsor search: {e}", exc_info=True)
                return [], None
        else:
            # No date range - query all
            sk_prefix = f"INTRODUCED_DATE#"
            key_condition = key_condition & Key('search_index_sk').begins_with(sk_prefix)
            
            params = {
                'KeyConditionExpression': key_condition,
                'ProjectionExpression': 'entity_bill_id, search_index_sk',
                'Limit': limit
            }
            
            if exclusive_start_key:
                params['ExclusiveStartKey'] = exclusive_start_key
            
            response = bills_table.query(**params)
            items = response.get('Items', [])
            bill_ids = []
            seen = set()
            
            for item in items:
                entity_bill_id = item.get('entity_bill_id')
                if entity_bill_id and entity_bill_id not in seen:
                    bill_ids.append(entity_bill_id)
                    seen.add(entity_bill_id)
                else:
                    sk = item.get('search_index_sk', '')
                    if sk and '#' in sk:
                        parts = sk.split('#')
                        if len(parts) >= 3 and parts[2] not in seen:
                            bill_ids.append(parts[2])
                            seen.add(parts[2])
            
            return bill_ids, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying cosponsor search index: {e}", exc_info=True)
        return [], None


def get_all_from_gsi(query_func, *args, **kwargs) -> List[str]:
    """Get all items from a GSI using internal pagination"""
    all_bill_ids = set()
    exclusive_start_key = kwargs.pop('exclusive_start_key', None)
    max_items = kwargs.pop('max_items', 50000)
    
    while len(all_bill_ids) < max_items:
        kwargs['exclusive_start_key'] = exclusive_start_key
        kwargs['limit'] = 100  # Fetch in batches
        
        bill_ids, last_key = query_func(*args, **kwargs)
        all_bill_ids.update(bill_ids)
        
        if not last_key or len(bill_ids) == 0:
            break
        exclusive_start_key = last_key
    
    return list(all_bill_ids)[:max_items]


def identify_queries(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify all GSI queries needed based on filters
    
    Returns list of query configs grouped by filter type
    """
    queries = []
    
    # Extract date filters
    date_from = filters.get('introduced_date_from')
    date_to = filters.get('introduced_date_to')
    
    # Normalize politician role - handle both string and list formats
    politician_role_raw = filters.get('politician_role', 'both')
    if isinstance(politician_role_raw, list):
        # Extract first non-empty value from list, or use 'both' if list is empty
        politician_role_raw = next((str(r).strip() for r in politician_role_raw if r and str(r).strip()), 'both')
    elif politician_role_raw:
        politician_role_raw = str(politician_role_raw).strip()
    else:
        politician_role_raw = 'both'
    
    politician_role = politician_role_raw if politician_role_raw in ['sponsor', 'cosponsor', 'both'] else 'both'
    
    logger.info(f"Normalized politician_role: '{politician_role}' (from {filters.get('politician_role')})")
    
    # Politician name - searches both sponsor (GSI) and cosponsor (search index)
    politician_names = filters.get('politician_name') or filters.get('sponsor_name')
    if politician_names:
        if not isinstance(politician_names, list):
            politician_names = [politician_names]
        
        for name in politician_names:
            if name and str(name).strip():
                name = str(name).strip()
                
                # Sponsor GSI query
                if politician_role in ['sponsor', 'both']:
                    queries.append({
                        'filter_type': 'politician_name',
                        'index_name': 'SponsorNameDateIndex',
                        'hash_key': 'sponsor_full_name',
                        'hash_value': name,
                        'query_func': query_gsi,
                        'role': 'sponsor',
                        'politician_name': name  # Store for grouping
                    })
                
                # Cosponsor search index query
                if politician_role in ['cosponsor', 'both']:
                    queries.append({
                        'filter_type': 'politician_name',
                        'query_type': 'cosponsor_search',
                        'cosponsor_name': name,
                        'query_func': query_cosponsor_search_index,
                        'role': 'cosponsor',
                        'politician_name': name  # Store for grouping
                    })
    
    # Sponsor party
    if filters.get('sponsor_party'):
        parties = filters.get('sponsor_party') if isinstance(filters.get('sponsor_party'), list) else [filters.get('sponsor_party')]
        for party in parties:
            if party and str(party).strip():
                queries.append({
                    'filter_type': 'sponsor_party',
                    'index_name': 'SponsorPartyDateIndex',
                    'hash_key': 'sponsor_party',
                    'hash_value': str(party).strip(),
                    'query_func': query_gsi
                })
    
    # Bill title
    if filters.get('bill_title'):
        titles = filters.get('bill_title') if isinstance(filters.get('bill_title'), list) else [filters.get('bill_title')]
        if titles and titles[0]:
            queries.append({
                'filter_type': 'bill_title',
                'index_name': 'BillTitleDateIndex',
                'hash_key': 'bill_title',
                'hash_value': str(titles[0]).strip(),
                'query_func': query_gsi
            })
    
    # Bill type
    if filters.get('bill_type'):
        types = filters.get('bill_type') if isinstance(filters.get('bill_type'), list) else [filters.get('bill_type')]
        if types and types[0]:
            queries.append({
                'filter_type': 'bill_type',
                'index_name': 'BillTypeDateIndex',
                'hash_key': 'bill_type',
                'hash_value': str(types[0]).strip(),
                'query_func': query_gsi
            })
    
    # Bill number
    if filters.get('bill_number') is not None:
        queries.append({
            'filter_type': 'bill_number',
            'index_name': 'BillNumberDateIndex',
            'hash_key': 'bill_number',
            'hash_value': filters.get('bill_number'),
            'query_func': query_gsi
        })
    
    # Bipartisan
    if filters.get('bipartisan') is not None:
        queries.append({
            'filter_type': 'bipartisan',
            'index_name': 'BipartisanDateIndex',
            'hash_key': 'bipartisan',
            'hash_value': filters.get('bipartisan'),
            'query_func': query_gsi
        })
    
    # Policy area
    if filters.get('policy_area'):
        areas = filters.get('policy_area') if isinstance(filters.get('policy_area'), list) else [filters.get('policy_area')]
        if areas and areas[0]:
            queries.append({
                'filter_type': 'policy_area',
                'index_name': 'PolicyAreaDateIndex',
                'hash_key': 'policy_area',
                'hash_value': str(areas[0]).strip(),
                'query_func': query_gsi
            })
    
    # Bills that have roll call votes (GSI: has_roll_call = 1)
    if filters.get('has_roll_call') is not None and filters.get('has_roll_call') != 0:
        queries.append({
            'filter_type': 'has_roll_call',
            'index_name': 'HasRollCallIndex',
            'hash_key': 'has_roll_call',
            'hash_value': 1,
            'query_func': query_gsi
        })

    # Congress
    if filters.get('congress'):
        congresses = filters.get('congress') if isinstance(filters.get('congress'), list) else [filters.get('congress')]
        if congresses and congresses[0] is not None:
            bill_type = None
            if filters.get('bill_type'):
                types = filters.get('bill_type') if isinstance(filters.get('bill_type'), list) else [filters.get('bill_type')]
                if types and types[0]:
                    bill_type = str(types[0]).strip()
            
            queries.append({
                'filter_type': 'congress',
                'index_name': 'CongressBillTypeIndex',
                'hash_key': 'congress',
                'hash_value': congresses[0],
                'query_func': query_gsi,
                'range_key': 'bill_type' if bill_type else None,
                'range_value': bill_type
            })
    
    # Introduced date queries - note: IntroducedDateIndex has no range key, so range queries not supported
    # Date filtering will be done in Python after fetching items
    # We skip GSI queries for introduced_date since IntroducedDateIndex doesn't support range queries efficiently
    
    # Latest action date queries - note: LatestActionDateIndex has no range key, so range queries not supported
    # Date filtering will be done in Python after fetching items
    # We skip GSI queries for latest_action_date since LatestActionDateIndex doesn't support range queries efficiently
    
    # Cosponsor name (separate from politician_name)
    if filters.get('cosponsor_name'):
        cosponsor_names = filters.get('cosponsor_name') if isinstance(filters.get('cosponsor_name'), list) else [filters.get('cosponsor_name')]
        for name in cosponsor_names:
            if name and str(name).strip():
                queries.append({
                    'filter_type': 'cosponsor_name',
                    'query_type': 'cosponsor_search',
                    'cosponsor_name': str(name).strip(),
                    'query_func': query_cosponsor_search_index
                })
    
    return queries


def get_bill_by_id(bill_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single bill by bill_id directly from DynamoDB"""
    if not bills_table or not bill_id:
        return None
    
    try:
        # For regular bills, search_index_sk equals bill_id
        response = bills_table.get_item(
            Key={
                'bill_id': str(bill_id),
                'search_index_sk': str(bill_id)
            }
        )
        
        if 'Item' in response:
            item = response['Item']
            # Filter out search index items
            if not is_search_index_item(item):
                return item
            else:
                logger.warning(f"Bill {bill_id} is a search index item, skipping")
                return None
        else:
            logger.info(f"Bill {bill_id} not found in DynamoDB")
            return None
    except Exception as e:
        logger.error(f"Error fetching bill {bill_id}: {str(e)}", exc_info=True)
        return None


def fetch_full_bills_batch(bill_ids: List[str]) -> List[Dict[str, Any]]:
    """Fetch full bill items using BatchGetItem"""
    if not bill_ids:
        return []
    
    all_items = []
    batch_size = 100
    
    for i in range(0, len(bill_ids), batch_size):
        batch_ids = bill_ids[i:i + batch_size]
        # Deduplicate to avoid ValidationException
        batch_ids = list(dict.fromkeys(batch_ids))
        
        try:
            request_items = {
                BILLS_TABLE_NAME: {
                    'Keys': [
                        {
                            'bill_id': {'S': str(bid)},
                            'search_index_sk': {'S': str(bid)}  # For regular bills, search_index_sk equals bill_id
                        }
                        for bid in batch_ids
                    ]
                }
            }
            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
            batch_items = batch_response.get('Responses', {}).get(BILLS_TABLE_NAME, [])
            
            deserializer = TypeDeserializer()
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                # Filter out search index items
                if not is_search_index_item(converted_item):
                    all_items.append(converted_item)
            
            logger.info(f"Fetched {len(batch_items)} items from BatchGetItem, {len([i for i in batch_items if not is_search_index_item({k: deserializer.deserialize(v) for k, v in i.items()})])} after filtering")
        except Exception as e:
            logger.error(f"Error fetching batch: {str(e)}", exc_info=True)
            continue
    
    logger.info(f"Total items fetched: {len(all_items)} from {len(bill_ids)} bill_ids")
    return all_items


def normalize_date_for_comparison(date_str: str) -> str:
    """Normalize date string to YYYY-MM-DD format for comparison"""
    if not date_str:
        return ''
    # Extract just the date part (YYYY-MM-DD)
    if 'T' in date_str:
        return date_str.split('T')[0]
    elif ' ' in date_str:
        return date_str.split(' ')[0]
    return date_str[:10] if len(date_str) >= 10 else date_str


def scan_table_with_date_filters(
    introduced_date_from: Optional[str] = None,
    introduced_date_to: Optional[str] = None,
    latest_action_date_from: Optional[str] = None,
    latest_action_date_to: Optional[str] = None,
    max_items: int = 10000,
    exclusive_start_key: Optional[Dict] = None
) -> tuple:
    """Scan table with date filters when no hash key filters are provided"""
    try:
        filter_conditions = []
        
        # Introduced date filters
        if introduced_date_from:
            filter_conditions.append(Attr('introduced_date').gte(introduced_date_from))
        if introduced_date_to:
            # Make date_to inclusive by appending time if needed
            date_to_inclusive = introduced_date_to
            if 'T' not in date_to_inclusive and ' ' not in date_to_inclusive:
                date_to_inclusive = f"{date_to_inclusive}T23:59:59.999Z"
            filter_conditions.append(Attr('introduced_date').lte(date_to_inclusive))
        
        # Latest action date filters
        if latest_action_date_from:
            filter_conditions.append(Attr('latest_action_date').gte(latest_action_date_from))
        if latest_action_date_to:
            # Make date_to inclusive by appending time if needed
            date_to_inclusive = latest_action_date_to
            if 'T' not in date_to_inclusive and ' ' not in date_to_inclusive:
                date_to_inclusive = f"{date_to_inclusive}T23:59:59.999Z"
            filter_conditions.append(Attr('latest_action_date').lte(date_to_inclusive))
        
        # Combine filter conditions with AND
        filter_expression = None
        if filter_conditions:
            filter_expression = filter_conditions[0]
            for condition in filter_conditions[1:]:
                filter_expression = filter_expression & condition
        
        params = {
            'Limit': 1000
        }
        
        if filter_expression:
            params['FilterExpression'] = filter_expression
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = bills_table.scan(**params)
        items = response.get('Items', [])
        # Filter out search index items
        filtered_items = [item for item in items if not is_search_index_item(item)]
        return filtered_items, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error scanning table with date filters: {e}", exc_info=True)
        return [], None


def search_bills_with_scan(filters: Dict[str, Any], limit: int = 100,
                          last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """Search bills using table scan when only date filters are provided"""
    try:
        logger.info(f"Searching bills with scan (date-only filters)")
        
        # Extract offset from pagination token
        offset = 0
        if last_evaluated_key and isinstance(last_evaluated_key, dict):
            offset = last_evaluated_key.get('offset', 0)
            if not isinstance(offset, int) or offset < 0:
                offset = 0
        
        # Extract date filters
        introduced_date_from = filters.get('introduced_date_from')
        introduced_date_to = filters.get('introduced_date_to')
        latest_action_date_from = filters.get('latest_action_date_from')
        latest_action_date_to = filters.get('latest_action_date_to')
        
        # Scan table with date filters
        all_items = []
        exclusive_start_key = last_evaluated_key.get('exclusive_start_key') if last_evaluated_key else None
        
        while len(all_items) < 10000:
            items, last_key = scan_table_with_date_filters(
                introduced_date_from=introduced_date_from,
                introduced_date_to=introduced_date_to,
                latest_action_date_from=latest_action_date_from,
                latest_action_date_to=latest_action_date_to,
                max_items=10000,
                exclusive_start_key=exclusive_start_key
            )
            all_items.extend(items)
            if not last_key:
                break
            exclusive_start_key = last_key
        
        logger.info(f"Scanned {len(all_items)} items from table")
        
        # Apply additional Python filters (if any)
        filtered_items = [item for item in all_items if apply_python_filters(item, filters)]
        logger.info(f"After Python filters: {len(filtered_items)} items")
        
        # Sort by introduced_date descending (most recent first)
        filtered_items.sort(key=lambda x: (
            x.get('introduced_date') or '',
            x.get('bill_id') or ''
        ), reverse=True)
        
        # Apply pagination
        paginated_items = filtered_items[offset:offset + limit]
        results = [convert_decimal_to_float(item) for item in paginated_items]
        
        has_more = offset + limit < len(filtered_items)
        next_last_evaluated_key = None
        if has_more:
            next_last_evaluated_key = {
                'offset': offset + len(results),
                'exclusive_start_key': exclusive_start_key,
                'method': 'scan'
            }
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': next_last_evaluated_key,
            'method': 'scan'
        }
    except Exception as e:
        logger.error(f"Error in search_bills_with_scan: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'count': 0
        }


def apply_python_filters(bill: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """Apply filters that can't be handled by GSIs"""
    # Filter out search index items
    if is_search_index_item(bill):
        return False
    
    # Date range filters (handled in Python since IntroducedDateIndex and LatestActionDateIndex have no range keys)
    if filters.get('introduced_date_from'):
        introduced_date = normalize_date_for_comparison(bill.get('introduced_date', ''))
        date_from = normalize_date_for_comparison(filters.get('introduced_date_from', ''))
        if not introduced_date or introduced_date < date_from:
            return False
    
    if filters.get('introduced_date_to'):
        introduced_date = normalize_date_for_comparison(bill.get('introduced_date', ''))
        date_to = normalize_date_for_comparison(filters.get('introduced_date_to', ''))
        # Make date_to inclusive: compare normalized dates (YYYY-MM-DD format)
        if not introduced_date or introduced_date > date_to:
            return False
    
    if filters.get('latest_action_date_from'):
        latest_action_date = normalize_date_for_comparison(bill.get('latest_action_date', ''))
        date_from = normalize_date_for_comparison(filters.get('latest_action_date_from', ''))
        if not latest_action_date or latest_action_date < date_from:
            return False
    
    if filters.get('latest_action_date_to'):
        latest_action_date = normalize_date_for_comparison(bill.get('latest_action_date', ''))
        date_to = normalize_date_for_comparison(filters.get('latest_action_date_to', ''))
        # Make date_to inclusive: compare normalized dates (YYYY-MM-DD format)
        if not latest_action_date or latest_action_date > date_to:
            return False
    
    # Apply any remaining filters that weren't handled by GSIs
    return True


def search_bills(filters: Dict[str, Any], limit: int = 100,
                 last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search bills using union/intersection logic
    
    Strategy:
    1. UNION within same field (e.g., multiple politician names)
    2. INTERSECT across different fields
    3. Fetch full items using BatchGetItem
    4. Apply post-query filters
    5. Sort and paginate
    """
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")
    
    logger.info(f"Search bills with filters: {json.dumps(filters, default=str)}, limit: {limit}")
    
    # Extract offset from pagination token
    offset = 0
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        offset = last_evaluated_key.get('offset', 0)
        if not isinstance(offset, int) or offset < 0:
            offset = 0
    
    # Identify all queries
    all_queries = identify_queries(filters)
    
    # Check if we have date-only filters (no hash key filters)
    has_date_filters = bool(
        filters.get('introduced_date_from') or filters.get('introduced_date_to') or
        filters.get('latest_action_date_from') or filters.get('latest_action_date_to')
    )
    
    # If no queries but we have date filters, use table scan
    if not all_queries and has_date_filters:
        logger.info("No hash key filters provided, but date filters exist - using table scan")
        return search_bills_with_scan(filters, limit, last_evaluated_key)
    
    if not all_queries:
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'method': 'query'
        }
    
    # Extract date filters for queries
    date_from = filters.get('introduced_date_from')
    date_to = filters.get('introduced_date_to')
    
    # Group queries by filter_type (field) for UNION within field, INTERSECT across fields
    # For politician_name: special handling - union sponsor + cosponsor for each name, then union across names
    queries_by_field = defaultdict(list)
    politician_name_queries = defaultdict(list)  # Group by politician name
    
    for query in all_queries:
        if query['filter_type'] == 'politician_name':
            # Group by politician name for proper union
            pol_name = query.get('politician_name') or query.get('cosponsor_name')
            if pol_name:
                politician_name_queries[pol_name].append(query)
        else:
            queries_by_field[query['filter_type']].append(query)
    
    # Step 1: UNION within each field (e.g., multiple politician names, multiple parties, etc.)
    # Step 2: INTERSECT across different fields (e.g., politician_name AND bipartisan)
    field_result_sets = {}
    
    # Handle politician_name queries: union sponsor + cosponsor for each name, then union across names
    if politician_name_queries:
        politician_name_union_ids = set()
        
        for pol_name, pol_queries in politician_name_queries.items():
            pol_bill_ids = set()
            
            logger.info(f"  UNION queries for politician '{pol_name}': {len(pol_queries)} queries (sponsor + cosponsor)")
            
            for query in pol_queries:
                query_func = query['query_func']
                
                if query.get('query_type') == 'cosponsor_search':
                    bill_ids, _ = query_func(
                        cosponsor_name=query['cosponsor_name'],
                        date_from=date_from,
                        date_to=date_to,
                        limit=50000
                    )
                    logger.info(f"    Cosponsor query returned {len(bill_ids)} bill_ids")
                else:
                    bill_ids, _ = query_func(
                        index_name=query['index_name'],
                        hash_key_name=query['hash_key'],
                        hash_key_value=query['hash_value'],
                        date_from=date_from,
                        date_to=date_to,
                        limit=50000
                    )
                    logger.info(f"    Sponsor query returned {len(bill_ids)} bill_ids")
                
                pol_bill_ids.update(bill_ids)  # UNION sponsor + cosponsor for this name
            
            logger.info(f"  UNION for '{pol_name}' (sponsor + cosponsor): {len(pol_bill_ids)} bill_ids")
            politician_name_union_ids.update(pol_bill_ids)  # UNION across different politician names
        
        field_result_sets['politician_name'] = politician_name_union_ids
        logger.info(f"Field 'politician_name' UNION complete: {len(politician_name_union_ids)} unique bill_ids")
    
    # Handle other field queries - UNION within each field
    for filter_type, field_queries in queries_by_field.items():
        field_bill_ids = set()
        
        logger.info(f"UNION queries for field '{filter_type}': {len(field_queries)} queries")
        
        for query in field_queries:
            query_func = query['query_func']
            
            if query.get('query_type') == 'cosponsor_search':
                bill_ids, _ = query_func(
                    cosponsor_name=query['cosponsor_name'],
                    date_from=date_from,
                    date_to=date_to,
                    limit=50000
                )
            else:
                bill_ids, _ = query_func(
                    index_name=query['index_name'],
                    hash_key_name=query['hash_key'],
                    hash_key_value=query['hash_value'],
                    date_from=date_from,
                    date_to=date_to,
                    limit=50000
                )
            
            field_bill_ids.update(bill_ids)  # UNION within field
            logger.info(f"  Query returned {len(bill_ids)} bill_ids, field total: {len(field_bill_ids)}")
        
        field_result_sets[filter_type] = field_bill_ids
        logger.info(f"Field '{filter_type}' UNION complete: {len(field_bill_ids)} unique bill_ids")
    
    # Step 2: INTERSECT results across different fields (different fields = AND)
    all_bill_ids: Optional[Set[str]] = None
    
    if field_result_sets:
        for filter_type, field_ids in field_result_sets.items():
            if all_bill_ids is None:
                # First field: use its results as starting point
                all_bill_ids = field_ids.copy()
                logger.info(f"Starting with field '{filter_type}': {len(all_bill_ids)} bill_ids")
            else:
                # Subsequent fields: INTERSECT with existing results
                before_count = len(all_bill_ids)
                all_bill_ids &= field_ids  # INTERSECT: keep only IDs in both sets
                logger.info(f"INTERSECT with field '{filter_type}': {before_count} -> {len(all_bill_ids)} bill_ids")
    
    if all_bill_ids is None:
        all_bill_ids = set()
    
    logger.info(f"Total unique bill_ids after union/intersection: {len(all_bill_ids)}")
    
    # Step 2: Convert to sorted list for consistent pagination
    # IMPORTANT: Sort bill_ids consistently (by bill_id string) so pagination works correctly
    # This ensures the same bill_ids appear in the same order across page requests
    bill_ids_list = sorted(list(all_bill_ids))
    logger.info(f"Sorted bill_ids list: {len(bill_ids_list)} total bill_ids (offset: {offset}, limit: {limit})")
    
    # Step 3: Fetch full items for ALL bill_ids (we need to filter and sort before pagination)
    # Fetch in batches to avoid memory issues, but we need all items for consistent sorting
    logger.info(f"Fetching full items for all {len(bill_ids_list)} bill_ids")
    full_items = fetch_full_bills_batch(bill_ids_list)
    
    logger.info(f"Fetched {len(full_items)} full items from DynamoDB")
    
    # Step 4: Apply post-query filters (date filters, etc.)
    filtered_items = [item for item in full_items if apply_python_filters(item, filters)]
    logger.info(f"After Python filters: {len(filtered_items)} items")
    
    # Step 5: Create a mapping of bill_id -> item for consistent lookup
    bill_id_to_item = {item.get('bill_id'): item for item in filtered_items}
    
    # Step 6: Build result list in the same order as bill_ids_list (consistent sorting)
    # This ensures pagination works correctly across page requests
    ordered_results = []
    for bill_id in bill_ids_list:
        if bill_id in bill_id_to_item:
            ordered_results.append(bill_id_to_item[bill_id])
    
    logger.info(f"Ordered results: {len(ordered_results)} items (maintaining bill_ids_list order)")
    
    # Step 7: Sort by introduced_date descending (most recent first) while maintaining stable sort
    # Use bill_id as secondary key to ensure consistent ordering
    ordered_results.sort(key=lambda x: (
        x.get('introduced_date') or '',  # Primary: introduced_date (descending)
        x.get('bill_id') or ''  # Secondary: bill_id for stable sort
    ), reverse=True)
    
    logger.info(f"Sorted results by introduced_date: {len(ordered_results)} items")
    
    # Step 8: Apply offset and limit to sorted results
    paginated_items = ordered_results[offset:offset + limit]
    results = [convert_decimal_to_float(item) for item in paginated_items]
    
    logger.info(f"Paginated results: {len(results)} items (offset: {offset}, limit: {limit})")
    
    # Step 9: Determine pagination
    next_offset = offset + len(results)
    has_more = next_offset < len(ordered_results)
    
    next_last_evaluated_key = None
    if has_more:
        next_last_evaluated_key = {
            'offset': next_offset,
            'total_items': len(all_bill_ids),
            'method': 'query'
        }
    
    logger.info(f"Returning {len(results)} results, offset: {offset}, next_offset: {next_offset}, total: {len(all_bill_ids)}, has_more: {has_more}")
    
    return {
        'success': True,
        'results': results,
        'count': len(results),
        'has_more': has_more,
        'last_evaluated_key': next_last_evaluated_key,
        'method': 'query'
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for query-based bill search"""
    try:
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
        
        # Roll call search: SEARCH#VOTE or SEARCH#ROLL (returns full rows, 100 per page)
        roll_call_search = body.get('roll_call_search')
        if roll_call_search and bills_table:
            search_index = (roll_call_search.get('search_index') or '').strip().upper()
            limit = min(int(roll_call_search.get('limit', 100) or 100), 100)
            limit = max(1, limit)
            last_ev = roll_call_search.get('last_evaluated_key')
            if search_index == 'SEARCH#VOTE':
                politician_ids = roll_call_search.get('politician_ids') or roll_call_search.get('politician_id')
                if isinstance(politician_ids, str):
                    politician_ids = [politician_ids]
                if not isinstance(politician_ids, list):
                    politician_ids = []
                result = search_roll_call_vote(
                    table=bills_table,
                    politician_ids=politician_ids,
                    limit=limit,
                    last_evaluated_key=last_ev,
                )
            elif search_index == 'SEARCH#ROLL':
                congress = roll_call_search.get('congress')
                session = roll_call_search.get('session')
                roll = roll_call_search.get('roll')
                if congress is not None:
                    try:
                        congress = int(congress)
                    except (TypeError, ValueError):
                        congress = None
                if session is not None:
                    try:
                        session = int(session)
                    except (TypeError, ValueError):
                        session = None
                if roll is not None:
                    try:
                        roll = int(roll)
                    except (TypeError, ValueError):
                        roll = None
                result = search_roll_call_rolls(
                    table=bills_table,
                    congress=congress,
                    session=session,
                    roll=roll,
                    limit=limit,
                    last_evaluated_key=last_ev,
                )
            else:
                result = {
                    'success': False,
                    'error': f'Invalid roll_call_search.search_index: use SEARCH#VOTE or SEARCH#ROLL',
                    'results': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
                }
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps(result, default=str)
            }

        # Check if this is a direct bill_id query (similar to getAward for contracts)
        bill_id = body.get('bill_id')
        if bill_id:
            # Direct bill fetch by bill_id
            try:
                logger.info(f"Fetching bill directly by bill_id: {bill_id}")
                bill = get_bill_by_id(bill_id)
                if bill:
                    # Enrich with S3 data if needed
                    bill = enrich_bill_with_details(bill)
                    result = {
                        'success': True,
                        'result': convert_decimal_to_float(bill),
                        'count': 1
                    }
                else:
                    result = {
                        'success': False,
                        'error': f'Bill not found: {bill_id}',
                        'result': None,
                        'count': 0
                    }
            except Exception as e:
                logger.error(f"Error fetching bill by ID: {str(e)}", exc_info=True)
                result = {
                    'success': False,
                    'error': str(e),
                    'result': None,
                    'count': 0
                }
        else:
            # Extract search parameters
            filters = body.get('filters', {})
            limit = body.get('limit', 100)
            last_evaluated_key = body.get('last_evaluated_key')
            
            # Perform search
            result = search_bills(filters=filters, limit=limit, last_evaluated_key=last_evaluated_key)
        
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

