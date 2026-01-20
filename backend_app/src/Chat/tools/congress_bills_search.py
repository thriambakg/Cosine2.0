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
BILLS_TABLE_NAME = os.environ.get('BILLS_TABLE_NAME')
if not BILLS_TABLE_NAME:
    raise ValueError("BILLS_TABLE_NAME environment variable is required")
S3_BUCKET_NAME = os.environ.get('CONGRESS_BILLS_DATA_S3_BUCKET_NAME') or os.environ.get('S3_BUCKET_NAME')
if not S3_BUCKET_NAME:
    raise ValueError("CONGRESS_BILLS_DATA_S3_BUCKET_NAME or S3_BUCKET_NAME environment variable is required")

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
    
    # Normalize politician_role - handle both string and list formats
    politician_role_raw = filters.get('politician_role', 'both')
    if isinstance(politician_role_raw, list):
        politician_role_raw = next((str(r).strip() for r in politician_role_raw if r and str(r).strip()), 'both')
    elif politician_role_raw:
        politician_role_raw = str(politician_role_raw).strip()
    else:
        politician_role_raw = 'both'
    
    politician_role = politician_role_raw if politician_role_raw in ['sponsor', 'cosponsor', 'both'] else 'both'
    
    # SponsorNameDateIndex: hash_key=sponsor_full_name, range_key=introduced_date
    # Also check for politician_name (alias for sponsor_name)
    politician_names = filters.get('politician_name') or filters.get('sponsor_name')
    if politician_names:
        if not isinstance(politician_names, list):
            politician_names = [politician_names]
        
        politician_names = [n for n in politician_names if n and str(n).strip()]
        if politician_names:
            # Use first politician name
            politician_name = politician_names[0].strip()
            introduced_date = None
            date_from = filters.get('introduced_date_from')
            date_to = filters.get('introduced_date_to')
            
            if date_from:
                introduced_date = date_from
            
            # Sponsor GSI query (if politician_role is 'sponsor' or 'both')
            if politician_role in ['sponsor', 'both']:
                query_configs.append({
                    'filter_key': 'sponsor_name',
                    'index_name': 'SponsorNameDateIndex',
                    'hash_key': 'sponsor_full_name',
                    'hash_value': politician_name,
                    'range_key': 'introduced_date' if introduced_date else None,
                    'range_value': introduced_date,
                    'range_condition': 'gte' if introduced_date else None,
                    'query_type': 'gsi',
                    'role': 'sponsor'
                })
            
            # Cosponsor search index query (if politician_role is 'cosponsor' or 'both')
            if politician_role in ['cosponsor', 'both']:
                query_configs.append({
                    'filter_key': 'cosponsor_name',
                    'query_type': 'cosponsor_search',
                    'cosponsor_name': politician_name,
                    'date_from': date_from,
                    'date_to': date_to,
                    'role': 'cosponsor'
                })
    
    # Cosponsor name (separate from politician_name)
    if filters.get('cosponsor_name'):
        cosponsor_names = filters.get('cosponsor_name') if isinstance(filters.get('cosponsor_name'), list) else [filters.get('cosponsor_name')]
        for cosponsor_name in cosponsor_names:
            if cosponsor_name and str(cosponsor_name).strip():
                date_from = filters.get('introduced_date_from')
                date_to = filters.get('introduced_date_to')
                query_configs.append({
                    'filter_key': 'cosponsor_name',
                    'query_type': 'cosponsor_search',
                    'cosponsor_name': str(cosponsor_name).strip(),
                    'date_from': date_from,
                    'date_to': date_to,
                    'role': 'cosponsor'
                })
    
    # SponsorPartyDateIndex: hash_key=sponsor_party, range_key=introduced_date
    if filters.get('sponsor_party'):
        parties = filters['sponsor_party'] if isinstance(filters['sponsor_party'], list) else [filters['sponsor_party']]
        parties = [p for p in parties if p and str(p).strip()]
        if parties:
            # Use first party for hash key (exact match)
            sponsor_party = parties[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'sponsor_party',
                'index_name': 'SponsorPartyDateIndex',
                'hash_key': 'sponsor_party',
                'hash_value': sponsor_party,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
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


def query_cosponsor_search_index(cosponsor_name: str, date_from: Optional[str] = None,
                                  date_to: Optional[str] = None, limit: int = 1000,
                                  exclusive_start_key: Optional[Dict] = None) -> tuple[List[str], Optional[Dict]]:
    """
    Query cosponsor search index (SEARCH#COSPONSOR# pattern)
    
    Structure:
    - bill_id = SEARCH#COSPONSOR#<name> (hash key)
    - search_index_sk = INTRODUCED_DATE#<date>#<bill_id> (range key)
    """
    if not cosponsor_name:
        return [], None
    
    normalized_name = str(cosponsor_name).strip()
    search_bill_id = f"SEARCH#COSPONSOR#{normalized_name}"
    
    try:
        # Build key condition
        key_condition = Key('bill_id').eq(search_bill_id)
        
        # Build range key condition for date filtering
        if date_from or date_to:
            if date_from and date_to:
                # Extract date part
                date_from_str = date_from.split('T')[0].split(' ')[0][:10] if 'T' in date_from or ' ' in date_from else date_from[:10]
                date_to_str = date_to.split('T')[0].split(' ')[0][:10] if 'T' in date_to or ' ' in date_to else date_to[:10]
                # Use begins_with for date range (query each date in range)
                sk_prefix = f"INTRODUCED_DATE#{date_from_str}#"
                key_condition = key_condition & Key('search_index_sk').begins_with(sk_prefix)
            elif date_from:
                date_from_str = date_from.split('T')[0].split(' ')[0][:10] if 'T' in date_from or ' ' in date_from else date_from[:10]
                sk_prefix = f"INTRODUCED_DATE#{date_from_str}#"
                key_condition = key_condition & Key('search_index_sk').gte(sk_prefix)
            else:
                date_to_str = date_to.split('T')[0].split(' ')[0][:10] if 'T' in date_to or ' ' in date_to else date_to[:10]
                sk_prefix = f"INTRODUCED_DATE#{date_to_str}#"
                key_condition = key_condition & Key('search_index_sk').lte(sk_prefix + '~')  # Use tilde for lexicographic comparison
        else:
            # No date filter - query all dates
            key_condition = key_condition & Key('search_index_sk').begins_with('INTRODUCED_DATE#')
        
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
                # Fallback: extract from search_index_sk
                sk = item.get('search_index_sk', '')
                if sk and '#' in sk:
                    parts = sk.split('#')
                    if len(parts) >= 3 and parts[2] not in seen:
                        bill_ids.append(parts[2])
                        seen.add(parts[2])
        
        return bill_ids[:limit], response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying cosponsor search index: {e}", exc_info=True)
        return [], None


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
    
    # Group queries by filter_key for UNION within field, INTERSECT across fields
    # Special handling: sponsor_name + cosponsor_name should UNION (same politician)
    queries_by_field = {}
    politician_name_queries = []  # Track politician name queries (sponsor + cosponsor)
    
    for config in query_configs:
        filter_key = config.get('filter_key')
        query_type = config.get('query_type', 'gsi')
        
        # Group politician name queries (sponsor_name and cosponsor_name for same politician)
        if filter_key in ['sponsor_name', 'cosponsor_name']:
            politician_name = config.get('hash_value') or config.get('cosponsor_name')
            if politician_name:
                # Find existing politician name group or create new one
                found_group = False
                for group in politician_name_queries:
                    if group.get('politician_name') == politician_name:
                        group['queries'].append(config)
                        found_group = True
                        break
                if not found_group:
                    politician_name_queries.append({
                        'politician_name': politician_name,
                        'filter_key': 'politician_name',  # Unified filter key
                        'queries': [config]
                    })
        else:
            # Group other queries by filter_key
            if filter_key not in queries_by_field:
                queries_by_field[filter_key] = []
            queries_by_field[filter_key].append(config)
    
    # Convert politician_name_queries to field groups
    if politician_name_queries:
        # For each politician name, union sponsor + cosponsor results
        for pol_group in politician_name_queries:
            queries_by_field['politician_name'] = queries_by_field.get('politician_name', [])
            queries_by_field['politician_name'].append(pol_group)
    
    # Count total unique filter types (not total queries)
    unique_filter_types = len(queries_by_field)
    
    # If we have multiple queryable filter types, use intersection approach
    if unique_filter_types > 1:
        logger.info(f"Using multi-query intersection approach with {unique_filter_types} filter types")
        
        # Query each filter type to get initial batch of bill_ids (to determine shortest list)
        field_results = {}
        for filter_key, field_queries in queries_by_field.items():
            field_bill_ids = set()
            
            for query_config in field_queries:
                if isinstance(query_config, dict) and 'queries' in query_config:
                    # Politician name group (union sponsor + cosponsor)
                    for sub_query in query_config['queries']:
                        query_type = sub_query.get('query_type', 'gsi')
                        if query_type == 'cosponsor_search':
                            bill_ids, _ = query_cosponsor_search_index(
                                cosponsor_name=sub_query['cosponsor_name'],
                                date_from=sub_query.get('date_from'),
                                date_to=sub_query.get('date_to'),
                                limit=1000
                            )
                            logger.info(f"  Cosponsor query returned {len(bill_ids)} bill_ids")
                        else:
                            bill_ids, _ = query_gsi_for_bill_ids(
                                index_name=sub_query['index_name'],
                                hash_key_name=sub_query['hash_key'],
                                hash_key_value=sub_query['hash_value'],
                                range_key_name=sub_query.get('range_key'),
                                range_key_value=sub_query.get('range_value'),
                                range_key_condition=sub_query.get('range_condition'),
                                limit=1000,
                                get_all=False
                            )
                            logger.info(f"  Sponsor query returned {len(bill_ids)} bill_ids")
                        field_bill_ids.update(bill_ids)  # UNION sponsor + cosponsor
                    
                    field_results[filter_key] = {
                        'bill_ids': field_bill_ids,
                        'queries': query_config['queries'],
                        'total_count': len(field_bill_ids),
                        'last_eval_key': None
                    }
                    logger.info(f"Field '{filter_key}' UNION complete: {len(field_bill_ids)} bill_ids")
                else:
                    # Regular query config
                    query_type = query_config.get('query_type', 'gsi')
                    if query_type == 'cosponsor_search':
                        bill_ids, _ = query_cosponsor_search_index(
                            cosponsor_name=query_config['cosponsor_name'],
                            date_from=query_config.get('date_from'),
                            date_to=query_config.get('date_to'),
                            limit=1000
                        )
                        logger.info(f"Querying cosponsor search index for {filter_key}={query_config['cosponsor_name']}")
                    else:
                        bill_ids, _ = query_gsi_for_bill_ids(
                            index_name=query_config['index_name'],
                            hash_key_name=query_config['hash_key'],
                            hash_key_value=query_config['hash_value'],
                            range_key_name=query_config.get('range_key'),
                            range_key_value=query_config.get('range_value'),
                            range_key_condition=query_config.get('range_condition'),
                            limit=1000,
                            get_all=False
                        )
                        logger.info(f"Querying {query_config.get('index_name', 'GSI')} for {filter_key}={query_config.get('hash_value')}")
                    field_bill_ids.update(bill_ids)
            
            if filter_key not in field_results:
                field_results[filter_key] = {
                    'bill_ids': field_bill_ids,
                    'queries': field_queries if filter_key != 'politician_name' else field_queries,
                    'total_count': len(field_bill_ids),
                    'last_eval_key': None
                }
                logger.info(f"Found {len(field_bill_ids)} bill_ids from {filter_key} (first batch)")
        
        # INTERSECT results across different filter types
        all_bill_ids = None
        for filter_key, field_result in field_results.items():
            if all_bill_ids is None:
                all_bill_ids = field_result['bill_ids'].copy()
                logger.info(f"Starting with field '{filter_key}': {len(all_bill_ids)} bill_ids")
            else:
                before_count = len(all_bill_ids)
                all_bill_ids &= field_result['bill_ids']  # INTERSECT
                logger.info(f"INTERSECT with field '{filter_key}': {before_count} -> {len(all_bill_ids)} bill_ids")
        
        if all_bill_ids is None:
            all_bill_ids = set()
        
        logger.info(f"Total unique bill_ids after intersection: {len(all_bill_ids)}")
        
        # Find the shortest field list (most restrictive filter) - this is our source of truth for pagination
        shortest_key = min(field_results.keys(), key=lambda k: len(field_results[k]['bill_ids']))
        source_field_result = field_results[shortest_key]
        source_bill_ids = list(all_bill_ids)
        
        logger.info(f"Using {shortest_key} as source of truth for pagination ({len(source_bill_ids)} bill_ids after intersection)")
        
        # Remove the source filter from filters (we've already applied it via query)
        remaining_filters = filters.copy()
        if shortest_key == 'politician_name':
            # Remove both sponsor_name and cosponsor_name if they were used
            for key_to_remove in ['sponsor_name', 'politician_name', 'cosponsor_name']:
                if key_to_remove in remaining_filters:
                    if isinstance(remaining_filters[key_to_remove], list):
                        remaining_filters[key_to_remove] = remaining_filters[key_to_remove][1:]
                        if not remaining_filters[key_to_remove]:
                            del remaining_filters[key_to_remove]
                    else:
                        del remaining_filters[key_to_remove]
        elif shortest_key in remaining_filters:
            if isinstance(remaining_filters[shortest_key], list):
                remaining_filters[shortest_key] = remaining_filters[shortest_key][1:]
                if not remaining_filters[shortest_key]:
                    del remaining_filters[shortest_key]
            else:
                del remaining_filters[shortest_key]
        
        logger.info(f"Remaining filters to apply in Python: {list(remaining_filters.keys())}")
        
        # Use the intersected bill_ids directly for pagination (no need to query again)
        # Paginate through the intersected results
        all_matching_items = []
        bill_ids_list = sorted(list(all_bill_ids))[:limit * 10]  # Get enough for pagination
        
        logger.info(f"Using intersected bill_ids for pagination: {len(bill_ids_list)} bill_ids")
        
        # Fetch full items for paginated batch using BatchGetItem
        batch_size = min(limit * 2, 100)  # Cap at 100 for DynamoDB BatchGetItem limit
        bill_ids_to_fetch = bill_ids_list[:batch_size]  # Fetch enough for filtering
        
        items_batch = []
        if bill_ids_to_fetch:
            # Deduplicate to avoid ValidationException
            batch_ids = list(dict.fromkeys(bill_ids_to_fetch))
            
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
        
        # Apply remaining filters in Python
        for item in items_batch:
            if apply_python_filter(item, remaining_filters):
                all_matching_items.append(item)
        
        logger.info(f"Multi-query intersection complete: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
        
        # Use the collected items directly
        items = all_matching_items[:limit]
        
        logger.info(f"Multi-query intersection complete: {len(items)} items matching all filters")
        method = 'multi_query_intersection'
        index_name = f"{unique_filter_types}_filter_types"
        
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
        # For multi-query intersection, use offset-based pagination
        has_more = len(bill_ids_list) > len(bill_ids_to_fetch)
        serializable_last_key = None
        if has_more:
            try:
                serializable_last_key = {
                    'offset': len(bill_ids_to_fetch),
                    'total_items': len(all_bill_ids),
                    'method': 'multi_query_intersection'
                }
            except Exception as e:
                logger.warning(f"Error creating last_evaluated_key: {e}")
                serializable_last_key = None
        
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,
            'method': method,
            'index_used': index_name
        }
    
    # If no queryable filters, return error (should use autocomplete first)
    if not query_configs:
        logger.warning("No queryable filters found - scan is not allowed. Please use search_autocomplete first.")
        return {
            'success': False,
            'error': 'No queryable filters found. Please use search_autocomplete to find exact values for sponsor_name, policy_area, etc., then provide at least one queryable filter (sponsor_name, policy_area, congress, bill_type, bill_title, bipartisan, bill_number, or introduced_date_from).',
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'method': 'error',
            'index_used': None
        }
    
    # Use first query config for single query (GSI or cosponsor search)
    # NOTE: If politician_role is 'both', we'll have 2 configs (sponsor + cosponsor) and go to multi-query path
    # So single query path only handles one config at a time
    config = query_configs[0]
    query_type = config.get('query_type', 'gsi')
    
    bill_ids = []
    last_eval_key = None
    
    if query_type == 'cosponsor_search':
        logger.info(f"Using single cosponsor search query for {config['cosponsor_name']}")
        bill_ids, last_eval_key = query_cosponsor_search_index(
            cosponsor_name=config['cosponsor_name'],
            date_from=config.get('date_from'),
            date_to=config.get('date_to'),
            limit=limit * 5,  # Fetch more to account for filtering
            exclusive_start_key=last_evaluated_key
        )
    else:
        logger.info(f"Using single GSI query: {config.get('index_name', 'GSI')}")
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
    
    # If GSI returned no results for bill_title (which requires exact match),
    # return empty results (user should use autocomplete to find exact titles)
    if not bill_ids and config['filter_key'] == 'bill_title':
        logger.info(f"GSI query returned 0 results for exact bill_title match. BillTitleDateIndex requires exact title match.")
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'method': 'query',
            'index_used': config['index_name'],
            'message': 'No results found for exact bill_title match. BillTitleDateIndex requires exact title match. Consider using other queryable filters (congress, bill_type, sponsor_name, policy_area, etc.) or use search_autocomplete to find exact bill titles.'
        }
    
    # Fetch full items using BatchGetItem
    items = []
    if bill_ids:
        batch_size = 100
        for i in range(0, len(bill_ids), batch_size):
            batch_ids = bill_ids[i:i + batch_size]
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
                    items.append(converted_item)
    
    # Apply remaining filters (exact matching for queryable filters, substring for non-queryable)
    # IMPORTANT: Queryable filters (sponsor_name, bill_title, policy_area, etc.) require exact match from autocomplete
    # For sponsor_name, remove the first value that was used in GSI (exact match), keep others for Python filtering
    remaining_filters = filters.copy()
    if config['filter_key'] in remaining_filters:
        if isinstance(remaining_filters[config['filter_key']], list):
            # For lists, remove the first value that was used in GSI, keep others for Python filtering
            remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
            if not remaining_filters[config['filter_key']]:
                del remaining_filters[config['filter_key']]
        else:
            # For exact match filters (sponsor_name, sponsor_party, bill_title, policy_area), remove since GSI already applied exact match
            # Non-queryable filters (sponsor_state, etc.) can still apply substring matching
            if config['filter_key'] in ['sponsor_name', 'sponsor_party', 'bill_title', 'policy_area']:
                # Remove exact match filter - GSI already applied it
                del remaining_filters[config['filter_key']]
            else:
                # For other queryable filters (congress, bill_type, bipartisan, etc.), remove since GSI already applied exact match
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
    
    index_used = config.get('index_name')
    if not index_used and query_type == 'cosponsor_search':
        index_used = 'cosponsor_search_index'
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': last_eval_key is not None,
        'last_evaluated_key': serializable_last_key,
        'method': 'query',
        'index_used': index_used or 'gsi'
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
    For sponsor_name, cosponsor_name, and policy_area searches, use search_autocomplete to find exact values.
    - For sponsor_name: Use search_autocomplete(query, "congress_legislator", limit=10)
    - For cosponsor_name: Use search_autocomplete(query, "congress_legislator", limit=10)
    - For policy_area: Use search_autocomplete(query, "policy_area", limit=10)
    If multiple matches, ask user to clarify OR if very similar, run searches for all matches.
    
    **Politician Role Filter:**
    - Use politician_role filter with sponsor_name to search both sponsor and cosponsor roles
    - politician_role can be: "sponsor", "cosponsor", or "both" (default: "both")
    - When politician_role is "both", searches both SponsorNameDateIndex (sponsor) and cosponsor search index, then unions results
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - sponsor_name: List or string of sponsor names (use autocomplete first for exact match)
            - politician_name: Alias for sponsor_name (use autocomplete first)
            - cosponsor_name: List or string of cosponsor names (use autocomplete first for exact match)
            - politician_role: "sponsor", "cosponsor", or "both" (default: "both") - used with sponsor_name/politician_name
            - bill_title: List or string of bill titles (exact match required via BillTitleDateIndex GSI)
            - bill_type: List or string of bill types (e.g., "HR", "S", "HJR", "SJR")
            - sponsor_party: List or string of sponsor parties (e.g., "R", "D", "I")
            - sponsor_state: List or string of sponsor states (2-letter codes) - non-queryable, filtered in Python
            - policy_area: List or string of policy areas (use autocomplete first for exact match)
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
        agent_logger.info(f"🔍 search_congress_bills called with filters: {filters}, limit: {limit}")
        
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
            limit = 5  # Default to 5 for compute efficiency
        
        agent_logger.info(f"📊 Search parameters: limit={limit}, pagination={'enabled' if last_key else 'disabled'}")
        
        # Perform search
        result = CongressBillsSearcher.search_bills_with_s3_passthrough(
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
        error_msg = f"Error searching congress bills: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })