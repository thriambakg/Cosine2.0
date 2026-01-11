"""
Congress Bills Search tool for the chat agent
Searches DynamoDB for congressional bills with various filters
Replicates the full lambda function search logic
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, Any, Optional, List
from decimal import Decimal
from datetime import datetime
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
BILLS_TABLE_NAME = os.environ.get('BILLS_TABLE_NAME', 'cosine-congress-bills-production')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-congress-bills-data-production')

# Get DynamoDB table
bills_table = dynamodb.Table(BILLS_TABLE_NAME) if BILLS_TABLE_NAME else None


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


def fetch_oversized_bill_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized bill details from S3 (when oversize_s3_key exists)"""
    try:
        if not s3_key:
            return None
        
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        bill_details = json.loads(decompressed_content.decode('utf-8'))
        return bill_details
        
    except Exception as e:
        logger.warning(f"Error fetching oversized bill from S3 ({s3_key}): {str(e)}")
        return None


def is_search_index_item(item: Dict[str, Any]) -> bool:
    """
    Check if an item is a search index item (should be filtered out from results).
    
    Search index items have:
    - bill_id starting with "SEARCH#"
    - is_search_index: True flag
    - search_type field
    
    Args:
        item: DynamoDB item to check
    
    Returns:
        True if item is a search index item, False otherwise
    """
    if not item:
        return False
    
    bill_id = item.get('bill_id', '')
    if isinstance(bill_id, str) and bill_id.startswith('SEARCH#'):
        return True
    
    if item.get('is_search_index') is True:
        return True
    
    if 'search_type' in item and 'search_index_sk' in item:
        # Check if search_index_sk follows search index pattern (e.g., "INTRODUCED_DATE#YYYY-MM-DD#bill_id")
        search_index_sk = item.get('search_index_sk', '')
        if isinstance(search_index_sk, str) and ('#' in search_index_sk or search_index_sk.startswith('SEARCH#')):
            return True
    
    return False


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """Apply filters to an item in Python (for post-BatchGetItem filtering)"""
    # Sponsor name filter (OR logic within field)
    if filters.get('sponsor_name'):
        sponsor_names = filters['sponsor_name'] if isinstance(filters['sponsor_name'], list) else [filters['sponsor_name']]
        sponsor_names = [n for n in sponsor_names if n and str(n).strip()]
        if sponsor_names:
            item_name = str(item.get('sponsor_full_name') or '').strip()
            matches = False
            for name in sponsor_names:
                name_str = str(name).strip()
                # Case-insensitive substring match
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
                if item_name and item_name.lower() in name_str.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Bill title filter (OR logic within field) - SUBSTRING MATCHING
    if filters.get('bill_title'):
        bill_titles = filters['bill_title'] if isinstance(filters['bill_title'], list) else [filters['bill_title']]
        bill_titles = [t for t in bill_titles if t and str(t).strip()]
        if bill_titles:
            item_title = str(item.get('bill_title') or '').strip()
            matches = False
            for title in bill_titles:
                title_str = str(title).strip()
                # Case-insensitive substring match
                if item_title and title_str.lower() in item_title.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Bill type filter (OR logic within field)
    if filters.get('bill_type'):
        bill_types = filters['bill_type'] if isinstance(filters['bill_type'], list) else [filters['bill_type']]
        bill_types = [t for t in bill_types if t and str(t).strip()]
        if bill_types:
            item_type = str(item.get('bill_type') or '').strip()
            if item_type not in bill_types:
                return False
    
    # Sponsor party filter (OR logic within field)
    if filters.get('sponsor_party'):
        parties = filters['sponsor_party'] if isinstance(filters['sponsor_party'], list) else [filters['sponsor_party']]
        parties = [p for p in parties if p and str(p).strip()]
        if parties:
            item_party = str(item.get('sponsor_party') or '').strip()
            if item_party not in parties:
                return False
    
    # Sponsor state filter (OR logic within field)
    if filters.get('sponsor_state'):
        states = filters['sponsor_state'] if isinstance(filters['sponsor_state'], list) else [filters['sponsor_state']]
        states = [s for s in states if s and str(s).strip()]
        if states:
            item_state = str(item.get('sponsor_state') or '').strip()
            if item_state not in states:
                return False
    
    # Policy area filter (OR logic within field)
    if filters.get('policy_area'):
        policy_areas = filters['policy_area'] if isinstance(filters['policy_area'], list) else [filters['policy_area']]
        policy_areas = [p for p in policy_areas if p and str(p).strip()]
        if policy_areas:
            item_area = str(item.get('policy_area') or '').strip()
            matches = False
            for area in policy_areas:
                area_str = str(area).strip()
                # Case-insensitive substring match
                if item_area and area_str.lower() in item_area.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Bipartisan filter
    if filters.get('bipartisan') is not None:
        bipartisan_value = filters['bipartisan']
        item_bipartisan = item.get('bipartisan')
        if isinstance(item_bipartisan, bool):
            item_bipartisan = 1 if item_bipartisan else 0
        if item_bipartisan != bipartisan_value:
            return False
    
    # Bill number filter
    if filters.get('bill_number') is not None:
        bill_number = filters['bill_number']
        item_number = item.get('bill_number')
        if item_number != bill_number:
            return False
    
    # Congress filter
    if filters.get('congress') is not None:
        congresses = filters['congress'] if isinstance(filters['congress'], list) else [filters['congress']]
        congresses = [c for c in congresses if c is not None]
        if congresses:
            item_congress = item.get('congress')
            if item_congress not in congresses:
                return False
    
    # Date filters
    if filters.get('introduced_date_from'):
        item_date = item.get('introduced_date')
        if not item_date or item_date < filters['introduced_date_from']:
            return False
    
    if filters.get('introduced_date_to'):
        item_date = item.get('introduced_date')
        if not item_date or item_date > filters['introduced_date_to']:
            return False
    
    if filters.get('latest_action_date_from'):
        item_date = item.get('latest_action_date')
        if not item_date or item_date < filters['latest_action_date_from']:
            return False
    
    if filters.get('latest_action_date_to'):
        item_date = item.get('latest_action_date')
        if not item_date or item_date > filters['latest_action_date_to']:
            return False
    
    return True


def identify_queryable_filters(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Identify which filters can use GSIs and return query configurations"""
    query_configs = []
    
    # BillTitleDateIndex: hash_key=bill_title, range_key=introduced_date
    if filters.get('bill_title'):
        bill_titles = filters['bill_title'] if isinstance(filters['bill_title'], list) else [filters['bill_title']]
        bill_titles = [t for t in bill_titles if t and str(t).strip()]
        if bill_titles:
            # Use first bill title for hash key (exact match attempt)
            bill_title = bill_titles[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'bill_title',
                'index_name': 'BillTitleDateIndex',
                'hash_key': 'bill_title',
                'hash_value': bill_title,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # BipartisanDateIndex: hash_key=bipartisan, range_key=introduced_date
    if filters.get('bipartisan') is not None:
        bipartisan_value = filters['bipartisan']
        introduced_date = None
        if filters.get('introduced_date_from'):
            introduced_date = filters['introduced_date_from']
        
        query_configs.append({
            'filter_key': 'bipartisan',
            'index_name': 'BipartisanDateIndex',
            'hash_key': 'bipartisan',
            'hash_value': bipartisan_value,
            'range_key': 'introduced_date' if introduced_date else None,
            'range_value': introduced_date,
            'range_condition': 'gte' if introduced_date else None
        })
    
    # CongressBillTypeIndex: hash_key=congress, range_key=bill_type
    if filters.get('congress'):
        congresses = filters['congress'] if isinstance(filters['congress'], list) else [filters['congress']]
        congresses = [c for c in congresses if c is not None]
        if congresses:
            congress = congresses[0]
            bill_type = None
            if filters.get('bill_type'):
                bill_types = filters['bill_type'] if isinstance(filters['bill_type'], list) else [filters['bill_type']]
                if bill_types:
                    bill_type = bill_types[0].strip()
            
            query_configs.append({
                'filter_key': 'congress',
                'index_name': 'CongressBillTypeIndex',
                'hash_key': 'congress',
                'hash_value': congress,
                'range_key': 'bill_type' if bill_type else None,
                'range_value': bill_type,
                'range_condition': None
            })
    
    # PolicyAreaDateIndex: hash_key=policy_area, range_key=introduced_date
    if filters.get('policy_area'):
        policy_areas = filters['policy_area'] if isinstance(filters['policy_area'], list) else [filters['policy_area']]
        policy_areas = [p for p in policy_areas if p and str(p).strip()]
        if policy_areas:
            policy_area = policy_areas[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'policy_area',
                'index_name': 'PolicyAreaDateIndex',
                'hash_key': 'policy_area',
                'hash_value': policy_area,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # IntroducedDateIndex: hash_key=introduced_date, range_key=null
    if filters.get('introduced_date_from'):
        introduced_date = filters['introduced_date_from']
        query_configs.append({
            'filter_key': 'introduced_date',
            'index_name': 'IntroducedDateIndex',
            'hash_key': 'introduced_date',
            'hash_value': introduced_date,
            'range_key': None,
            'range_value': None,
            'range_condition': None
        })
    
    return query_configs


def query_gsi_for_bill_ids(index_name: str, hash_key_name: str, hash_key_value: Any,
                           range_key_name: Optional[str] = None, range_key_value: Any = None,
                           range_key_condition: Optional[str] = None, limit: int = 1000,
                           exclusive_start_key: Optional[Dict] = None, get_all: bool = False) -> tuple[List[str], Optional[Dict]]:
    """Query a GSI and return bill_ids (for KEYS_ONLY GSIs)"""
    bill_ids = []
    last_eval_key = exclusive_start_key
    
    params = {
        'IndexName': index_name,
        'KeyConditionExpression': Key(hash_key_name).eq(hash_key_value),
        'Limit': limit,
        'ProjectionExpression': 'bill_id'  # Only need bill_id from KEYS_ONLY GSI
    }
    
    # Add range key condition if provided
    if range_key_name:
        if range_key_condition == 'between' and isinstance(range_key_value, tuple):
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).between(range_key_value[0], range_key_value[1])
        elif range_key_condition == 'gte':
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).gte(range_key_value)
        elif range_key_condition == 'lte':
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).lte(range_key_value)
        elif range_key_value is not None:
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).eq(range_key_value)
    
    # Query GSI (with pagination if get_all=True)
    max_rounds = 100 if get_all else 1
    round_count = 0
    
    while round_count < max_rounds:
        round_count += 1
        try:
            if last_eval_key:
                params['ExclusiveStartKey'] = last_eval_key
            
            response = bills_table.query(**params)
            gsi_items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
            
            # Extract bill_ids
            for item in gsi_items:
                bill_id = item.get('bill_id')
                if bill_id:
                    bill_ids.append(bill_id)
            
            # Stop if no more items or we have enough (and not getting all)
            if not last_eval_key:
                break
            if not get_all:
                break
            if len(bill_ids) >= limit:
                break
                
        except Exception as e:
            logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
            break
    
    return bill_ids[:limit], last_eval_key


def search_bills_direct(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search bills in DynamoDB using filters with multi-GSI intersection approach
    Replicates the lambda function's search_bills logic
    """
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # If we have multiple queryable filters, use intersection approach
    if len(query_configs) > 1:
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} GSIs")
        
        # Query each GSI to get initial batch of bill_ids (to determine shortest list)
        gsi_results = {}
        for config in query_configs:
            logger.info(f"Querying {config['index_name']} for {config['filter_key']}={config['hash_value']}")
            # Get first batch to determine which is shortest
            bill_ids, _ = query_gsi_for_bill_ids(
                index_name=config['index_name'],
                hash_key_name=config['hash_key'],
                hash_key_value=config['hash_value'],
                range_key_name=config.get('range_key'),
                range_key_value=config.get('range_value'),
                range_key_condition=config.get('range_condition'),
                limit=1000,  # Get first batch
                get_all=False
            )
            gsi_results[config['filter_key']] = {
                'bill_ids': set(bill_ids),
                'config': config,
                'total_count': len(bill_ids),
                'last_eval_key': None
            }
            logger.info(f"Found {len(bill_ids)} bill_ids from {config['index_name']} (first batch)")
        
        # Find the shortest list (most restrictive filter) - this is our source of truth
        shortest_key = min(gsi_results.keys(), key=lambda k: len(gsi_results[k]['bill_ids']))
        source_bill_ids = list(gsi_results[shortest_key]['bill_ids'])
        source_config = gsi_results[shortest_key]['config']
        
        logger.info(f"Using {shortest_key} as source of truth ({len(source_bill_ids)} bill_ids)")
        
        # Remove the source filter from filters (we've already applied it via GSI)
        remaining_filters = filters.copy()
        if shortest_key in remaining_filters:
            # For list filters, we need to handle the first value being used in GSI
            if isinstance(remaining_filters[shortest_key], list):
                # Remove the first value that was used in GSI, keep others for Python filtering
                remaining_filters[shortest_key] = remaining_filters[shortest_key][1:]
                if not remaining_filters[shortest_key]:
                    del remaining_filters[shortest_key]
            else:
                del remaining_filters[shortest_key]
        
        logger.info(f"Remaining filters to apply in Python: {list(remaining_filters.keys())}")
        
        # Paginate through source GSI until we have enough results or it runs out
        # CRITICAL: For agent use, fetch incrementally (10 items at a time) and stop early
        # Don't fetch all items at once - let the agent check results and paginate if needed
        all_matching_items = []
        source_last_eval_key = None
        max_pagination_rounds = 5  # Reduced from 50 - only fetch a few batches initially
        pagination_round = 0
        
        while len(all_matching_items) < limit and pagination_round < max_pagination_rounds:
            pagination_round += 1
            
            # Query source GSI with pagination
            # CRITICAL: Only fetch enough bill_ids to meet the limit (don't fetch all 1000)
            # For agent use, fetch limit * 2 to account for filtering, but cap at reasonable amount
            query_limit = min(limit * 2, 50)  # Fetch 2x limit or max 50, whichever is smaller
            source_bill_ids_batch, new_last_eval_key = query_gsi_for_bill_ids(
                index_name=source_config['index_name'],
                hash_key_name=source_config['hash_key'],
                hash_key_value=source_config['hash_value'],
                range_key_name=source_config.get('range_key'),
                range_key_value=source_config.get('range_value'),
                range_key_condition=source_config.get('range_condition'),
                limit=query_limit,  # Use smaller limit for agent use
                exclusive_start_key=source_last_eval_key,
                get_all=False
            )
            source_last_eval_key = new_last_eval_key
            
            if not source_bill_ids_batch:
                logger.info(f"Source GSI {source_config['index_name']} ran out of items")
                break
            
            logger.info(f"Pagination round {pagination_round}: Got {len(source_bill_ids_batch)} bill_ids from source GSI (query_limit={query_limit})")
            
            # Fetch full items for this batch using BatchGetItem
            # CRITICAL: Only fetch enough items to meet the limit (default 10 for agent use)
            # Don't fetch all items at once - fetch incrementally and stop early
            items_batch = []
            if source_bill_ids_batch:
                # Use limit as batch size to fetch incrementally (default 10 for agent)
                # This prevents fetching all 94 items when we only need 10
                batch_size = min(limit, 100)  # Cap at 100 for DynamoDB BatchGetItem limit
                # Only fetch enough bill_ids to potentially meet the limit
                # Since we filter in Python, we might need more, but don't fetch all at once
                bill_ids_to_fetch = source_bill_ids_batch[:min(len(source_bill_ids_batch), limit * 2)]
                
                for i in range(0, len(bill_ids_to_fetch), batch_size):
                    batch_ids = bill_ids_to_fetch[i:i + batch_size]
                    # Deduplicate to avoid ValidationException
                    batch_ids = list(dict.fromkeys(batch_ids))
                    
                    # CRITICAL: Include both bill_id (hash key) and search_index_sk (range key)
                    # For regular bill items, search_index_sk = bill_id
                    request_items = {
                        BILLS_TABLE_NAME: {
                            'Keys': [
                                {
                                    'bill_id': {'S': str(bid)},
                                    'search_index_sk': {'S': str(bid)}  # For regular bills, search_index_sk = bill_id
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
                        # Filter out search index items (they have different search_index_sk patterns)
                        if not is_search_index_item(converted_item):
                            items_batch.append(converted_item)
                    
                    # Stop fetching if we have enough items to potentially meet the limit
                    if len(items_batch) >= limit * 2:
                        break
            
            # Apply remaining filters in Python (including substring matching for bill_title)
            for item in items_batch:
                if apply_python_filter(item, remaining_filters):
                    all_matching_items.append(item)
            
            logger.info(f"Pagination round {pagination_round}: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
            
            # Stop if source GSI ran out or we have enough results
            if not source_last_eval_key or len(all_matching_items) >= limit:
                break
        
        # Use the collected items directly
        items = all_matching_items[:limit]
        
        logger.info(f"Multi-GSI intersection complete: {len(items)} items matching all filters")
        method = 'multi_gsi_intersection'
        index_name = f"{len(query_configs)}_GSIs"
        
        # Convert Decimal to float for JSON serialization
        results = [convert_decimal_to_float(item) for item in items]
        
        # Enrich results - handle oversized items
        enriched_results = []
        for bill in results:
            oversize_s3_key = bill.get('oversize_s3_key')
            if oversize_s3_key:
                full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
                if full_bill:
                    bill = convert_decimal_to_float(full_bill)
            enriched_results.append(bill)
        
        # Convert last_evaluated_key to JSON-serializable format
        serializable_last_key = None
        if source_last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(source_last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
                serializable_last_key = None
        
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': source_last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': method,
            'index_used': index_name
        }
    
    # Fall back to single GSI query or scan
    # If no queryable filters, use table scan
    if not query_configs:
        logger.info("No queryable filters found, using table scan")
        
        scan_limit = max(limit * 10, 1000)  # Scan more items to account for potential filtering
        params = {
            'Limit': scan_limit
        }
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Scanning bills table with Limit={scan_limit} (result limit={limit})")
        response = bills_table.scan(**params)
        
        scanned_items = response.get('Items', [])
        last_eval_key = response.get('LastEvaluatedKey')
        
        logger.info(f"Scan found {len(scanned_items)} items")
        
        # Apply any filters in Python (including substring matching)
        filtered_items = [item for item in scanned_items if apply_python_filter(item, filters)]
        filtered_items = filtered_items[:limit]
        
        # Convert and enrich
        results = [convert_decimal_to_float(item) for item in filtered_items]
        enriched_results = []
        for bill in results:
            oversize_s3_key = bill.get('oversize_s3_key')
            if oversize_s3_key:
                full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
                if full_bill:
                    bill = convert_decimal_to_float(full_bill)
            enriched_results.append(bill)
        
        # Convert last_evaluated_key
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
                serializable_last_key = None
        
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': 'scan',
            'index_used': None
        }
    
    # Use first query config for single GSI query
    config = query_configs[0]
    logger.info(f"Using single GSI query: {config['index_name']}")
    
    # Query GSI with pagination support
    bill_ids, last_eval_key = query_gsi_for_bill_ids(
        index_name=config['index_name'],
        hash_key_name=config['hash_key'],
        hash_key_value=config['hash_value'],
        range_key_name=config.get('range_key'),
        range_key_value=config.get('range_value'),
        range_key_condition=config.get('range_condition'),
        limit=limit * 5,  # Fetch more to account for filtering
        exclusive_start_key=last_evaluated_key,
        get_all=False
    )
    
    # If GSI returned no results and we're searching by bill_title (which requires exact match),
    # fall back to scan for substring matching
    if not bill_ids and config['filter_key'] == 'bill_title':
        logger.info(f"GSI query returned 0 results for exact bill_title match. Falling back to scan for substring matching.")
        
        scan_limit = max(limit * 20, 5000)  # Scan more items for substring matching
        params = {
            'Limit': scan_limit
        }
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        response = bills_table.scan(**params)
        scanned_items = response.get('Items', [])
        last_eval_key = response.get('LastEvaluatedKey')
        
        logger.info(f"Scan found {len(scanned_items)} items, applying filters (including substring matching)")
        
        # Apply all filters in Python (including substring matching for bill_title)
        filtered_items = [item for item in scanned_items if apply_python_filter(item, filters)]
        filtered_items = filtered_items[:limit]
        
        # Convert and enrich
        results = [convert_decimal_to_float(item) for item in filtered_items]
        enriched_results = []
        for bill in results:
            oversize_s3_key = bill.get('oversize_s3_key')
            if oversize_s3_key:
                full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
                if full_bill:
                    bill = convert_decimal_to_float(full_bill)
            enriched_results.append(bill)
        
        # Convert last_evaluated_key
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
                serializable_last_key = None
        
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': 'scan_fallback',
            'index_used': f"{config['index_name']}_fallback"
        }
    
    # Fetch full items using BatchGetItem
    items = []
    if bill_ids:
        batch_size = 100
        for i in range(0, len(bill_ids), batch_size):
            batch_ids = bill_ids[i:i + batch_size]
            request_items = {
                BILLS_TABLE_NAME: {
                    'Keys': [{'bill_id': {'S': str(bid)}} for bid in batch_ids]
                }
            }
            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
            batch_items = batch_response.get('Responses', {}).get(BILLS_TABLE_NAME, [])
            deserializer = TypeDeserializer()
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                items.append(converted_item)
    
    # Apply remaining filters (including substring matching for bill_title)
    # IMPORTANT: For bill_title, the GSI only matches exact titles, but we need substring matching
    # So we keep bill_title in remaining_filters to apply substring matching in Python
    remaining_filters = filters.copy()
    if config['filter_key'] in remaining_filters:
        if isinstance(remaining_filters[config['filter_key']], list):
            # For lists, remove the first value that was used in GSI, keep others for Python filtering
            remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
            if not remaining_filters[config['filter_key']]:
                # If list is empty, but it's bill_title, we still want substring matching on the original value
                # So we restore it from the original filters
                if config['filter_key'] == 'bill_title' and filters.get('bill_title'):
                    remaining_filters[config['filter_key']] = filters['bill_title'] if isinstance(filters['bill_title'], list) else [filters['bill_title']]
                else:
                    del remaining_filters[config['filter_key']]
        else:
            # For bill_title, always keep it for substring matching (GSI only does exact match)
            if config['filter_key'] == 'bill_title':
                # Keep the filter for substring matching - don't remove it
                pass
            else:
                # For other filters, remove since GSI already applied exact match
                del remaining_filters[config['filter_key']]
    
    filtered_items = [item for item in items if apply_python_filter(item, remaining_filters)]
    filtered_items = filtered_items[:limit]
    
    # Convert and enrich
    results = [convert_decimal_to_float(item) for item in filtered_items]
    enriched_results = []
    for bill in results:
        oversize_s3_key = bill.get('oversize_s3_key')
        if oversize_s3_key:
            full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
            if full_bill:
                bill = convert_decimal_to_float(full_bill)
        enriched_results.append(bill)
    
    # Convert last_evaluated_key
    serializable_last_key = None
    if last_eval_key:
        try:
            serializable_last_key = convert_decimal_to_float(last_eval_key)
        except Exception as e:
            logger.warning(f"Error converting last_evaluated_key: {e}")
            serializable_last_key = None
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': last_eval_key is not None,
        'last_evaluated_key': serializable_last_key,
        'method': 'query',
        'index_used': config['index_name']
    }


class CongressBillsSearcher:
    """
    Searches congressional bills in DynamoDB
    """
    
    @staticmethod
    def search_bills_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 10,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search bills and store large results in S3 if needed
        """
        try:
            # Perform search
            result = search_bills_direct(filters, limit, last_evaluated_key)
            
            # Check if result is large enough to store in S3
            result_json = json.dumps(result)
            result_size = len(result_json)
            
            LARGE_DATA_THRESHOLD = 50000  # 50KB
            LARGE_RESULTS_THRESHOLD = 50  # 50 results
            
            should_store_in_s3 = (
                result_size > LARGE_DATA_THRESHOLD or 
                result.get('count', 0) > LARGE_RESULTS_THRESHOLD
            )
            
            if should_store_in_s3:
                # Store in data-files and return S3 key
                try:
                    user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID', 'default')
                    session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    filename = f"congress_bills_search_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=result_json,
                        ContentType='application/json'
                    )
                    
                    agent_logger.info(f"Stored congress bills search results in S3: {s3_key} ({result_size} bytes, {result.get('count', 0)} results)")
                    
                    # Return reference with S3 key
                    return {
                        "status": "success",
                        "s3_key": s3_key,
                        "data_size_bytes": result_size,
                        "count": result.get('count', 0),
                        "has_more": result.get('has_more', False),
                        "last_evaluated_key": result.get('last_evaluated_key'),
                        "method": result.get('method', 'unknown'),
                        "index_used": result.get('index_used'),
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
            logger.error(f"Error searching congress bills: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@tool
def search_congress_bills(
    filters: str,
    limit: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for congressional bills in DynamoDB using various filters.
    
    **IMPORTANT: Use autocomplete before searching:**
    For sponsor_name and policy_area searches, use search_autocomplete to find exact values.
    - For sponsor_name: Use search_autocomplete(query, "congress_legislator", limit=10)
    - For policy_area: Use search_autocomplete(query, "policy_area", limit=10)
    If multiple matches, ask user to clarify OR if very similar, run searches for all matches.
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - sponsor_name: List or string of sponsor names (case-insensitive substring match)
            - bill_title: List or string of bill titles (case-insensitive substring match)
            - bill_type: List or string of bill types (e.g., "HR", "S", "HJR", "SJR")
            - sponsor_party: List or string of sponsor parties (e.g., "R", "D", "I")
            - sponsor_state: List or string of sponsor states (2-letter codes)
            - policy_area: List or string of policy areas (case-insensitive substring match)
            - bipartisan: Integer (1 for bipartisan, 0 for non-bipartisan)
            - bill_number: Exact bill number
            - congress: Congress number (e.g., 118, 119)
            - introduced_date_from: Start date in YYYY-MM-DD format
            - introduced_date_to: End date in YYYY-MM-DD format
            - latest_action_date_from: Start date in YYYY-MM-DD format
            - latest_action_date_to: End date in YYYY-MM-DD format
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. Each bill result includes:
        - bill_id: Unique bill identifier (e.g., "119-HR-5789")
        - bill_title: Title of the bill
        - bill_text_html_s3_key: S3 key to the full HTML bill text (e.g., "billtext/119-HR-5789.html")
          * If present, use read_s3_file_tool(bill_text_html_s3_key) to read the complete bill text
          * The bill text is stored as HTML in S3 and contains the full legislative text
        - summary_text: Brief summary of the bill (if available)
        - sponsor information, cosponsors, actions, etc.
        For large result sets (>50KB or >50 results), returns S3 key reference instead of results array.
        
    Example:
        search_congress_bills(
            '{"bipartisan": 1, "bill_title": "Defense Authorization", "congress": 119}',
            limit=50
        )
        
    To read full bill text:
        If a bill has bill_text_html_s3_key="billtext/119-HR-5789.html", 
        call read_s3_file_tool("billtext/119-HR-5789.html") to get the complete bill text.
    """
    try:
        agent_logger.info(f"Searching congress bills with filters: {filters}")
        
        # Parse filters JSON
        if isinstance(filters, str):
            filters_dict = json.loads(filters)
        else:
            filters_dict = filters
        
        # Parse last_evaluated_key if provided
        last_key = None
        if last_evaluated_key:
            if isinstance(last_evaluated_key, str):
                last_key = json.loads(last_evaluated_key)
            else:
                last_key = last_evaluated_key
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 5  # Default to 5 for compute efficiency
        
        # Perform search
        result = CongressBillsSearcher.search_bills_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        
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
        error_msg = f"Error searching congress bills: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
