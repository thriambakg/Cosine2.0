"""
Congress Bills Search Lambda Function
Queries DynamoDB congress-bills table using GSIs and filters to return matching bills
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
BILLS_TABLE_NAME = os.environ.get('BILLS_TABLE_NAME', 'congress-bills')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-congress-bills-data-production')

# Get DynamoDB table
bills_table = dynamodb.Table(BILLS_TABLE_NAME) if BILLS_TABLE_NAME else None


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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


def fetch_oversized_bill_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch oversized bill details from S3 (when oversize_s3_key exists)
    
    Args:
        s3_key: S3 key for the oversized bill file (gzipped JSON)
    
    Returns:
        Full bill dictionary, or None if error
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
        bill_details = json.loads(decompressed_content.decode('utf-8'))
        
        return bill_details
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"Oversized bill not found in S3: {s3_key}")
        return None
    except Exception as e:
        logger.error(f"Error fetching oversized bill from S3 ({s3_key}): {str(e)}", exc_info=True)
        return None


def normalize_politician_role(politician_role: Any) -> str:
    """
    Normalize politician_role from various formats to a single string.
    
    Handles:
    - Array: [] (empty) -> 'both' (search both sponsor and cosponsor)
    - Array: ['sponsor'] -> 'sponsor' (sponsor only)
    - Array: ['cosponsor'] -> 'cosponsor' (cosponsor only)
    - Array: ['sponsor', 'cosponsor'] -> 'both' (both selected, search both)
    - String: 'sponsor', 'cosponsor', 'both' -> as-is (for backward compatibility)
    - None/undefined -> 'both'
    
    Returns:
        'sponsor', 'cosponsor', or 'both'
    """
    if politician_role is None:
        return 'both'
    
    if isinstance(politician_role, list):
        if len(politician_role) == 0:
            # Empty array means search both sponsor and cosponsor
            return 'both'
        elif len(politician_role) == 1:
            # Single option selected
            role = politician_role[0]
            if role in ['sponsor', 'cosponsor']:
                return role
            elif role == 'both':
                # If array contains 'both', treat as 'both'
                return 'both'
            else:
                # Unknown value, default to 'both'
                return 'both'
        elif len(politician_role) == 2:
            # Both options selected means 'both'
            return 'both'
        else:
            # More than 2 options shouldn't happen, but default to 'both'
            return 'both'
    
    if isinstance(politician_role, str):
        if politician_role in ['sponsor', 'cosponsor', 'both']:
            return politician_role
        else:
            return 'both'
    
    # Fallback to 'both' for any other type
    return 'both'


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """
    Apply filters to an item in Python (for post-BatchGetItem filtering with KEYS_ONLY GSIs)
    
    Args:
        item: Bill item to filter
        filters: Dictionary of filter fields
    
    Returns:
        True if item matches all filters, False otherwise
    """
    # Politician name filter (OR logic within field) - checks both sponsor and cosponsor
    politician_name_filter = filters.get('politician_name') or filters.get('sponsor_name')
    politician_role = normalize_politician_role(filters.get('politician_role'))
    
    if politician_name_filter:
        politician_names = politician_name_filter if isinstance(politician_name_filter, list) else [politician_name_filter]
        politician_names = [n for n in politician_names if n and str(n).strip()]
        if politician_names:
            matches = False
            for name in politician_names:
                name_str = str(name).strip()
                
                # Check sponsor name
                if politician_role in ['sponsor', 'both']:
                    item_sponsor_name = str(item.get('sponsor_full_name') or '').strip()
                    if item_sponsor_name:
                        if name_str.lower() in item_sponsor_name.lower() or item_sponsor_name.lower() in name_str.lower():
                            matches = True
                            break
                
                # Check cosponsor names
                if politician_role in ['cosponsor', 'both']:
                    cosponsors_json = item.get('cosponsors')
                    if cosponsors_json:
                        try:
                            import json
                            cosponsors = json.loads(cosponsors_json) if isinstance(cosponsors_json, str) else cosponsors_json
                            if isinstance(cosponsors, list):
                                for cosponsor in cosponsors:
                                    cosponsor_name = str(cosponsor.get('name') or '').strip()
                                    if cosponsor_name:
                                        if name_str.lower() in cosponsor_name.lower() or cosponsor_name.lower() in name_str.lower():
                                            matches = True
                                            break
                                if matches:
                                    break
                        except (json.JSONDecodeError, TypeError):
                            pass
            
            if not matches:
                return False
    
    # Legacy sponsor_name filter (for backward compatibility)
    if not politician_name_filter and filters.get('sponsor_name'):
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
    
    # Bill title filter (OR logic within field)
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
        # Convert to int for comparison
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
    """
    Identify which filters can use GSIs and return query configurations
    
    Returns:
        List of query configs, each with: filter_key, index_name, hash_key, hash_value, range_key, range_value
    """
    query_configs = []
    
    # Politician name: searches both sponsor and cosponsor
    # Support both politician_name (new) and sponsor_name (legacy) for backward compatibility
    politician_name_filter = filters.get('politician_name') or filters.get('sponsor_name')
    politician_role = normalize_politician_role(filters.get('politician_role'))  # Normalize to 'sponsor', 'cosponsor', or 'both'
    
    if politician_name_filter:
        politician_names = politician_name_filter if isinstance(politician_name_filter, list) else [politician_name_filter]
        politician_names = [n for n in politician_names if n and str(n).strip()]
        if politician_names:
            # For each politician name, create queries for sponsor and/or cosponsor based on politician_role
            for politician_name in politician_names:
                politician_name = politician_name.strip()
                introduced_date = None
                if filters.get('introduced_date_from'):
                    introduced_date = filters['introduced_date_from']
                
                # Query sponsor GSI if role is 'sponsor' or 'both'
                if politician_role in ['sponsor', 'both']:
                    query_configs.append({
                        'filter_key': 'politician_name',
                        'politician_name': politician_name,
                        'role': 'sponsor',
                        'index_name': 'SponsorNameDateIndex',
                        'hash_key': 'sponsor_full_name',
                        'hash_value': politician_name,
                        'range_key': 'introduced_date' if introduced_date else None,
                        'range_value': introduced_date,
                        'range_condition': 'gte' if introduced_date else None
                    })
                
                # Query cosponsor search index if role is 'cosponsor' or 'both'
                if politician_role in ['cosponsor', 'both']:
                    query_configs.append({
                        'filter_key': 'politician_name',
                        'politician_name': politician_name,
                        'role': 'cosponsor',
                        'index_name': None,  # No GSI, uses search index pattern
                        'query_type': 'search_index',  # Mark as search index query
                        'search_type': 'COSPONSOR',
                        'search_value': politician_name,
                        'hash_key': None,
                        'hash_value': None,
                        'range_key': None,
                        'range_value': None,
                        'range_condition': None
                    })
    
    # Legacy sponsor_name support (if politician_name not provided)
    if not politician_name_filter and filters.get('sponsor_name'):
        sponsor_names = filters['sponsor_name'] if isinstance(filters['sponsor_name'], list) else [filters['sponsor_name']]
        sponsor_names = [n for n in sponsor_names if n and str(n).strip()]
        if sponsor_names:
            # Use first sponsor name for hash key
            sponsor_name = sponsor_names[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'sponsor_name',
                'index_name': 'SponsorNameDateIndex',
                'hash_key': 'sponsor_full_name',
                'hash_value': sponsor_name,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # BillTitleDateIndex: hash_key=bill_title, range_key=introduced_date
    if filters.get('bill_title'):
        bill_titles = filters['bill_title'] if isinstance(filters['bill_title'], list) else [filters['bill_title']]
        bill_titles = [t for t in bill_titles if t and str(t).strip()]
        if bill_titles:
            # Use first bill title for hash key
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
    
    # BillTypeDateIndex: hash_key=bill_type, range_key=introduced_date
    if filters.get('bill_type'):
        bill_types = filters['bill_type'] if isinstance(filters['bill_type'], list) else [filters['bill_type']]
        bill_types = [t for t in bill_types if t and str(t).strip()]
        if bill_types:
            # Use first bill type for hash key
            bill_type = bill_types[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'bill_type',
                'index_name': 'BillTypeDateIndex',
                'hash_key': 'bill_type',
                'hash_value': bill_type,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # SponsorPartyDateIndex: hash_key=sponsor_party, range_key=introduced_date
    if filters.get('sponsor_party'):
        parties = filters['sponsor_party'] if isinstance(filters['sponsor_party'], list) else [filters['sponsor_party']]
        parties = [p for p in parties if p and str(p).strip()]
        if parties:
            # Use first party for hash key
            party = parties[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'sponsor_party',
                'index_name': 'SponsorPartyDateIndex',
                'hash_key': 'sponsor_party',
                'hash_value': party,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # SponsorStateDateIndex: hash_key=sponsor_state, range_key=introduced_date
    if filters.get('sponsor_state'):
        states = filters['sponsor_state'] if isinstance(filters['sponsor_state'], list) else [filters['sponsor_state']]
        states = [s for s in states if s and str(s).strip()]
        if states:
            # Use first state for hash key
            state = states[0].strip()
            introduced_date = None
            if filters.get('introduced_date_from'):
                introduced_date = filters['introduced_date_from']
            
            query_configs.append({
                'filter_key': 'sponsor_state',
                'index_name': 'SponsorStateDateIndex',
                'hash_key': 'sponsor_state',
                'hash_value': state,
                'range_key': 'introduced_date' if introduced_date else None,
                'range_value': introduced_date,
                'range_condition': 'gte' if introduced_date else None
            })
    
    # PolicyAreaDateIndex: hash_key=policy_area, range_key=introduced_date
    if filters.get('policy_area'):
        policy_areas = filters['policy_area'] if isinstance(filters['policy_area'], list) else [filters['policy_area']]
        policy_areas = [p for p in policy_areas if p and str(p).strip()]
        if policy_areas:
            # Use first policy area for hash key
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
    
    # BillNumberDateIndex: hash_key=bill_number, range_key=introduced_date
    if filters.get('bill_number') is not None:
        bill_number = filters['bill_number']
        introduced_date = None
        if filters.get('introduced_date_from'):
            introduced_date = filters['introduced_date_from']
        
        query_configs.append({
            'filter_key': 'bill_number',
            'index_name': 'BillNumberDateIndex',
            'hash_key': 'bill_number',
            'hash_value': bill_number,
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
    
    # LatestActionDateIndex: hash_key=latest_action_date, range_key=null
    if filters.get('latest_action_date_from'):
        latest_action_date = filters['latest_action_date_from']
        query_configs.append({
            'filter_key': 'latest_action_date',
            'index_name': 'LatestActionDateIndex',
            'hash_key': 'latest_action_date',
            'hash_value': latest_action_date,
            'range_key': None,
            'range_value': None,
            'range_condition': None
        })
    
    # Cosponsor search index (many-to-many relationship)
    # Uses search index pattern: PK = SEARCH#COSPONSOR#<name>, SK = INTRODUCED_DATE#<date>#<bill_id>
    if filters.get('cosponsor_name'):
        cosponsor_names = filters['cosponsor_name'] if isinstance(filters['cosponsor_name'], list) else [filters['cosponsor_name']]
        cosponsor_names = [n for n in cosponsor_names if n and str(n).strip()]
        if cosponsor_names:
            # Use first cosponsor name for search index query
            cosponsor_name = cosponsor_names[0].strip()
            query_configs.append({
                'filter_key': 'cosponsor_name',
                'index_name': None,  # No GSI, uses search index pattern
                'query_type': 'search_index',  # Mark as search index query
                'search_type': 'COSPONSOR',
                'search_value': cosponsor_name,
                'hash_key': None,
                'hash_value': None,
                'range_key': None,
                'range_value': None,
                'range_condition': None
            })
    
    return query_configs


def query_cosponsor_search_index(
    cosponsor_name: str,
    limit: int = 1000,
    exclusive_start_key: Optional[Dict] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
) -> tuple[List[str], Optional[Dict]]:
    """
    Query cosponsor search index to get bill IDs.
    
    Structure:
    - bill_id = SEARCH#COSPONSOR#<cosponsor_name> (hash key)
    - search_index_sk = INTRODUCED_DATE#<date>#<original_bill_id> (range key)
    
    Args:
        cosponsor_name: Name of the cosponsor
        limit: Maximum number of bill IDs to return
        exclusive_start_key: Pagination token from previous query
        date_from: Optional date filter (YYYY-MM-DD)
        date_to: Optional date filter (YYYY-MM-DD)
    
    Returns:
        Tuple of (list of bill_ids, last_evaluated_key for pagination)
    """
    if not bills_table or not cosponsor_name:
        return [], None
    
    try:
        # Normalize cosponsor name
        normalized_name = str(cosponsor_name).strip()
        if not normalized_name:
            return [], None
        
        # Construct hash key for search index: SEARCH#COSPONSOR#<name>
        search_bill_id = f"SEARCH#COSPONSOR#{normalized_name}"
        
        # Build query parameters
        # search_index_sk format: INTRODUCED_DATE#YYYY-MM-DD#<bill_id>
        # We can use range key conditions for date filtering
        key_condition = Key('bill_id').eq(search_bill_id)
        
        if date_from or date_to:
            def extract_date(date_str):
                if not date_str:
                    return None
                if 'T' in date_str:
                    return date_str.split('T')[0]
                elif ' ' in date_str:
                    return date_str.split(' ')[0]
                return date_str[:10] if len(date_str) >= 10 else date_str
            
            date_from_part = extract_date(date_from) if date_from else None
            date_to_part = extract_date(date_to) if date_to else None
            
            if date_from_part and date_to_part:
                sk_start = f"INTRODUCED_DATE#{date_from_part}#"
                sk_end = f"INTRODUCED_DATE#{date_to_part}#~"  # ~ ensures we get all items on that date
                key_condition = Key('bill_id').eq(search_bill_id) & Key('search_index_sk').between(sk_start, sk_end)
            elif date_from_part:
                sk_start = f"INTRODUCED_DATE#{date_from_part}#"
                key_condition = Key('bill_id').eq(search_bill_id) & Key('search_index_sk').gte(sk_start)
            elif date_to_part:
                sk_end = f"INTRODUCED_DATE#{date_to_part}#~"
                key_condition = Key('bill_id').eq(search_bill_id) & Key('search_index_sk').lte(sk_end)
        
        query_params = {
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'entity_bill_id, search_index_sk',
            'Limit': limit
        }
        
        if exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key
        
        response = bills_table.query(**query_params)
        
        # Extract bill_ids from entity_bill_id field
        bill_ids = []
        for item in response.get('Items', []):
            entity_bill_id = item.get('entity_bill_id')
            if entity_bill_id:
                bill_ids.append(entity_bill_id)
        
        last_eval_key = response.get('LastEvaluatedKey')
        
        logger.info(f"Query cosponsor search index '{normalized_name}': found {len(bill_ids)} bill IDs, has_more: {last_eval_key is not None}")
        
        return bill_ids, last_eval_key
        
    except Exception as e:
        logger.error(f"Error querying cosponsor search index '{cosponsor_name}': {str(e)}", exc_info=True)
        raise


def query_gsi_for_bill_ids(index_name: str, hash_key_name: str, hash_key_value: Any,
                           range_key_name: Optional[str] = None, range_key_value: Any = None,
                           range_key_condition: Optional[str] = None, limit: int = 1000,
                           exclusive_start_key: Optional[Dict] = None, get_all: bool = False) -> tuple[List[str], Optional[Dict]]:
    """
    Query a GSI and return bill_ids (for KEYS_ONLY GSIs)
    
    Args:
        index_name: Name of the GSI to query
        hash_key_name: Hash key attribute name
        hash_key_value: Hash key value
        range_key_name: Optional range key attribute name
        range_key_value: Optional range key value (for exact match)
        range_key_condition: Optional range key condition ('gte', 'lte', 'between')
        limit: Maximum number of bill_ids to return per batch
        exclusive_start_key: Pagination token to continue from
        get_all: If True, paginate to get all items (up to limit). If False, return single batch.
    
    Returns:
        Tuple of (bill_ids list, last_evaluated_key for pagination)
    """
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


def search_bills(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search bills in DynamoDB using filters with multi-GSI intersection approach
    
    Strategy:
    1. Query each filter's GSI separately to get bill_ids
    2. Use the shortest list as source of truth (most restrictive filter)
    3. Fetch full items for that list
    4. Apply remaining filters in Python
    5. Paginate until one query runs out of items
    
    Args:
        filters: Dictionary of filter fields
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token from previous request
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")
    
    # Check for union_offset pagination BEFORE identifying queryable filters
    # This allows us to continue union queries even if filters are empty
    union_offset = None
    union_offset_metadata = None
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        query_type = last_evaluated_key.get('query_type')
        if query_type == 'union_offset':
            union_offset = last_evaluated_key.get('offset', 0)
            union_offset_metadata = last_evaluated_key  # Store full metadata for reconstruction
            logger.info(f"Detected union_offset pagination: offset={union_offset}")
            # If we have union_offset, we need to ensure we have query configs
            # The filters should contain the politician_name to reconstruct the query
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # If we have union_offset but no query configs, try to reconstruct from metadata or filters
    # This handles the case where "load more" is called with union_offset but filters might be minimal
    if union_offset is not None and not query_configs:
        # Check if this is a union_all_politicians query (multiple names)
        politician_names = None
        politician_role = 'both'
        
        if union_offset_metadata:
            politician_names = union_offset_metadata.get('politician_names')
            politician_name = union_offset_metadata.get('politician_name')  # Single name for union_politician
            politician_role = normalize_politician_role(union_offset_metadata.get('politician_role'))
            
            if politician_names:
                logger.info(f"Reconstructing union_all_politicians from union_offset metadata: {len(politician_names)} names, role={politician_role}")
            elif politician_name:
                logger.info(f"Reconstructing union_politician from union_offset metadata: politician_name={politician_name}, role={politician_role}")
        
        # Fallback to filters if not in metadata
        if not politician_names and not politician_name:
            politician_name_filter = filters.get('politician_name') or filters.get('sponsor_name')
            if politician_name_filter:
                politician_names = politician_name_filter if isinstance(politician_name_filter, list) else [politician_name_filter]
                politician_role = normalize_politician_role(filters.get('politician_role'))
                logger.info(f"Reconstructing from filters: {len(politician_names)} names, role={politician_role}")
        
        # Reconstruct the union query config(s)
        if politician_names and len(politician_names) > 1:
            # Multiple politician names - create union_all_politicians config
            politician_configs = []
            for pol_name in politician_names:
                union_configs = []
                
                # Add sponsor GSI config
                if politician_role == 'both' or politician_role == 'sponsor':
                    union_configs.append({
                        'filter_key': 'politician_name',
                        'index_name': 'SponsorNameDateIndex',
                        'hash_key': 'sponsor_full_name',
                        'hash_value': pol_name,
                        'range_key': 'introduced_date',
                        'range_value': filters.get('introduced_date_from'),
                        'range_condition': 'gte' if filters.get('introduced_date_from') else None
                    })
                
                # Add cosponsor search index config
                if politician_role == 'both' or politician_role == 'cosponsor':
                    union_configs.append({
                        'filter_key': 'politician_name',
                        'query_type': 'search_index',
                        'search_type': 'COSPONSOR',
                        'search_value': pol_name
                    })
                
                if len(union_configs) > 1:
                    politician_configs.append({
                        'filter_key': 'politician_name',
                        'politician_name': pol_name,
                        'role': politician_role,
                        'union_configs': union_configs,
                        'query_type': 'union_politician'
                    })
                elif len(union_configs) == 1:
                    politician_configs.append(union_configs[0])
            
            if politician_configs:
                query_configs.append({
                    'filter_key': 'politician_name',
                    'query_type': 'union_all_politicians',
                    'politician_configs': politician_configs,
                    'politician_names': politician_names
                })
                logger.info(f"Reconstructed union_all_politicians query config for {len(politician_names)} names")
        elif (politician_name or (politician_names and len(politician_names) == 1)):
            # Single politician name - create union_politician config
            single_name = politician_name or (politician_names[0] if politician_names else None)
            if single_name:
                union_configs = []
                
                # Add sponsor GSI config
                if politician_role == 'both' or politician_role == 'sponsor':
                    union_configs.append({
                        'filter_key': 'politician_name',
                        'index_name': 'SponsorNameDateIndex',
                        'hash_key': 'sponsor_full_name',
                        'hash_value': single_name,
                        'range_key': 'introduced_date',
                        'range_value': filters.get('introduced_date_from'),
                        'range_condition': 'gte' if filters.get('introduced_date_from') else None
                    })
                
                # Add cosponsor search index config
                if politician_role == 'both' or politician_role == 'cosponsor':
                    union_configs.append({
                        'filter_key': 'politician_name',
                        'query_type': 'search_index',
                        'search_type': 'COSPONSOR',
                        'search_value': single_name
                    })
                
                if union_configs:
                    query_configs.append({
                        'filter_key': 'politician_name',
                        'politician_name': single_name,
                        'role': politician_role,
                        'union_configs': union_configs,
                        'query_type': 'union_politician'
                    })
                    logger.info(f"Reconstructed union query config for politician_name: {single_name}, role: {politician_role}")
    
    # Special handling for politician_name: 
    # 1. For each politician name, union sponsor and cosponsor queries (if role is 'both')
    # 2. For multiple politician names, union all politician name results together (OR logic)
    politician_role = normalize_politician_role(filters.get('politician_role'))
    politician_name_filter = filters.get('politician_name') or filters.get('sponsor_name')
    
    if politician_name_filter:
        # Group queries by politician_name
        politician_queries = {}
        other_queries = []
        
        for config in query_configs:
            if config.get('filter_key') == 'politician_name':
                politician_name = config.get('politician_name')
                if politician_name not in politician_queries:
                    politician_queries[politician_name] = []
                politician_queries[politician_name].append(config)
            else:
                other_queries.append(config)
        
        # For each politician_name, union sponsor and cosponsor queries (if role is 'both')
        if politician_queries:
            unioned_politician_configs = []
            for politician_name, configs in politician_queries.items():
                # If role is 'both', we need to union sponsor and cosponsor queries for this name
                if politician_role == 'both' and len(configs) > 1:
                    # Union the results from sponsor and cosponsor queries
                    unioned_politician_configs.append({
                        'filter_key': 'politician_name',
                        'politician_name': politician_name,
                        'role': 'both',
                        'union_configs': configs,  # Store both sponsor and cosponsor configs
                        'query_type': 'union_politician'
                    })
                elif len(configs) == 1:
                    # Single query (either sponsor or cosponsor only)
                    unioned_politician_configs.append(configs[0])
                else:
                    # Multiple configs but role is not 'both' - shouldn't happen, but handle it
                    unioned_politician_configs.append(configs[0])
            
            # If we have multiple politician names, we need to union them together
            # Create a special "union_all_politicians" config that will union all politician results
            if len(unioned_politician_configs) > 1:
                # Replace individual politician configs with a single union config
                query_configs = [{
                    'filter_key': 'politician_name',
                    'query_type': 'union_all_politicians',
                    'politician_configs': unioned_politician_configs,  # All individual politician configs
                    'politician_names': list(politician_queries.keys())
                }] + other_queries
            else:
                # Single politician name, use the unioned config directly
                query_configs = unioned_politician_configs + other_queries
    
    # If we have multiple queryable filters, use intersection approach
    if len(query_configs) > 1:
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} GSIs")
        
        # Query each GSI/search index to get initial batch of bill_ids (to determine shortest list)
        gsi_results = {}
        for config in query_configs:
            if config.get('query_type') == 'union_all_politicians':
                # Handle union of multiple politician names (OR logic)
                politician_configs = config.get('politician_configs', [])
                politician_names = config.get('politician_names', [])
                logger.info(f"Querying union of {len(politician_names)} politician names: {politician_names}")
                all_bill_ids = set()
                
                # Query each politician config and union the results
                for politician_config in politician_configs:
                    if politician_config.get('query_type') == 'union_politician':
                        # Union sponsor and cosponsor for this politician
                        union_configs = politician_config.get('union_configs', [])
                        for union_config in union_configs:
                            if union_config.get('query_type') == 'search_index':
                                bill_ids, _ = query_cosponsor_search_index(
                                    cosponsor_name=union_config['search_value'],
                                    limit=1000,
                                    date_from=filters.get('introduced_date_from'),
                                    date_to=filters.get('introduced_date_to')
                                )
                                all_bill_ids.update(bill_ids)
                            elif union_config.get('index_name'):
                                bill_ids, _ = query_gsi_for_bill_ids(
                                    index_name=union_config['index_name'],
                                    hash_key_name=union_config['hash_key'],
                                    hash_key_value=union_config['hash_value'],
                                    range_key_name=union_config.get('range_key'),
                                    range_key_value=union_config.get('range_value'),
                                    range_key_condition=union_config.get('range_condition'),
                                    limit=1000,
                                    get_all=False
                                )
                                all_bill_ids.update(bill_ids)
                    elif politician_config.get('query_type') == 'search_index':
                        # Single cosponsor query
                        bill_ids, _ = query_cosponsor_search_index(
                            cosponsor_name=politician_config['search_value'],
                            limit=1000,
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids.update(bill_ids)
                    elif politician_config.get('index_name'):
                        # Single sponsor GSI query
                        bill_ids, _ = query_gsi_for_bill_ids(
                            index_name=politician_config['index_name'],
                            hash_key_name=politician_config['hash_key'],
                            hash_key_value=politician_config['hash_value'],
                            range_key_name=politician_config.get('range_key'),
                            range_key_value=politician_config.get('range_value'),
                            range_key_condition=politician_config.get('range_condition'),
                            limit=1000,
                            get_all=False
                        )
                        all_bill_ids.update(bill_ids)
                
                bill_ids = list(all_bill_ids)
                index_name = f"UnionAllPoliticians({len(politician_names)} names)"
            elif config.get('query_type') == 'union_politician':
                # Handle union politician query (sponsor + cosponsor for single name)
                politician_name = config.get('politician_name', 'unknown')
                logger.info(f"Querying union politician query for {config['filter_key']}={politician_name}")
                all_bill_ids = set()
                
                # Query both sponsor GSI and cosponsor search index
                union_configs = config.get('union_configs', [])
                for union_config in union_configs:
                    if union_config.get('query_type') == 'search_index':
                        # Query cosponsor search index
                        bill_ids, _ = query_cosponsor_search_index(
                            cosponsor_name=union_config['search_value'],
                            limit=1000,  # Get first batch
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids.update(bill_ids)
                    elif union_config.get('index_name'):
                        # Query sponsor GSI
                        bill_ids, _ = query_gsi_for_bill_ids(
                            index_name=union_config['index_name'],
                            hash_key_name=union_config['hash_key'],
                            hash_key_value=union_config['hash_value'],
                            range_key_name=union_config.get('range_key'),
                            range_key_value=union_config.get('range_value'),
                            range_key_condition=union_config.get('range_condition'),
                            limit=1000,  # Get first batch
                            get_all=False
                        )
                        all_bill_ids.update(bill_ids)
                
                bill_ids = list(all_bill_ids)
                index_name = f"UnionPolitician({politician_name})"
            elif config.get('query_type') == 'search_index':
                # Use search index query for cosponsors
                logger.info(f"Querying cosponsor search index for {config['filter_key']}={config['search_value']}")
                bill_ids, _ = query_cosponsor_search_index(
                    cosponsor_name=config['search_value'],
                    limit=1000,  # Get first batch
                    date_from=filters.get('introduced_date_from'),
                    date_to=filters.get('introduced_date_to')
                )
                index_name = f"SearchIndex({config['search_type']})"
            else:
                # Use GSI query
                index_name = config.get('index_name', 'Unknown')
                logger.info(f"Querying {index_name} for {config['filter_key']}={config.get('hash_value', 'N/A')}")
                bill_ids, _ = query_gsi_for_bill_ids(
                    index_name=index_name,
                    hash_key_name=config['hash_key'],
                    hash_key_value=config['hash_value'],
                    range_key_name=config.get('range_key'),
                    range_key_value=config.get('range_value'),
                    range_key_condition=config.get('range_condition'),
                    limit=1000,  # Get first batch
                    get_all=False
                )
            
            # Use a unique key for each config (handle multiple politician names)
            result_key = config['filter_key']
            if config.get('politician_name'):
                result_key = f"{config['filter_key']}_{config['politician_name']}"
            
            gsi_results[result_key] = {
                'bill_ids': set(bill_ids),
                'config': config,
                'total_count': len(bill_ids),
                'last_eval_key': None
            }
            logger.info(f"Found {len(bill_ids)} bill_ids from {index_name} (first batch)")
        
        # Find the shortest list (most restrictive filter) - this is our source of truth
        shortest_key = min(gsi_results.keys(), key=lambda k: len(gsi_results[k]['bill_ids']))
        source_bill_ids = list(gsi_results[shortest_key]['bill_ids'])
        source_config = gsi_results[shortest_key]['config']
        
        logger.info(f"Using {shortest_key} as source of truth ({len(source_bill_ids)} bill_ids)")
        
        # Remove the source filter from filters (we've already applied it via GSI)
        remaining_filters = filters.copy()
        # Remove politician_role since it's handled at query level
        if 'politician_role' in remaining_filters:
            del remaining_filters['politician_role']
        
        # Handle politician_name filter removal
        if source_config.get('query_type') == 'union_all_politicians':
            # All politician names have been applied, remove them all
            if 'politician_name' in remaining_filters:
                del remaining_filters['politician_name']
            if 'sponsor_name' in remaining_filters:
                del remaining_filters['sponsor_name']
        elif shortest_key.startswith('politician_name_'):
            # Extract the politician name from the key
            politician_name = shortest_key.replace('politician_name_', '', 1)
            if 'politician_name' in remaining_filters:
                politician_names = remaining_filters['politician_name'] if isinstance(remaining_filters['politician_name'], list) else [remaining_filters['politician_name']]
                # Remove the politician name that was used in the query
                politician_names = [n for n in politician_names if str(n).strip() != politician_name]
                if politician_names:
                    remaining_filters['politician_name'] = politician_names
                else:
                    del remaining_filters['politician_name']
        elif shortest_key in remaining_filters:
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
        all_matching_items = []
        source_last_eval_key = None
        max_pagination_rounds = 50
        pagination_round = 0
        
        while len(all_matching_items) < limit and pagination_round < max_pagination_rounds:
            pagination_round += 1
            
            # Query source GSI/search index with pagination
            if source_config.get('query_type') == 'union_all_politicians':
                # Union all politician queries for pagination
                politician_configs = source_config.get('politician_configs', [])
                all_bill_ids_batch = set()
                new_last_eval_key = None
                
                for politician_config in politician_configs:
                    if politician_config.get('query_type') == 'union_politician':
                        # Union sponsor and cosponsor for this politician
                        union_configs = politician_config.get('union_configs', [])
                        for union_config in union_configs:
                            if union_config.get('query_type') == 'search_index':
                                bill_ids_batch, cosponsor_last_key = query_cosponsor_search_index(
                                    cosponsor_name=union_config['search_value'],
                                    limit=1000,
                                    exclusive_start_key=source_last_eval_key,
                                    date_from=filters.get('introduced_date_from'),
                                    date_to=filters.get('introduced_date_to')
                                )
                                all_bill_ids_batch.update(bill_ids_batch)
                                if cosponsor_last_key:
                                    new_last_eval_key = cosponsor_last_key
                            elif union_config.get('index_name'):
                                bill_ids_batch, sponsor_last_key = query_gsi_for_bill_ids(
                                    index_name=union_config['index_name'],
                                    hash_key_name=union_config['hash_key'],
                                    hash_key_value=union_config['hash_value'],
                                    range_key_name=union_config.get('range_key'),
                                    range_key_value=union_config.get('range_value'),
                                    range_key_condition=union_config.get('range_condition'),
                                    limit=1000,
                                    exclusive_start_key=source_last_eval_key,
                                    get_all=False
                                )
                                all_bill_ids_batch.update(bill_ids_batch)
                                if sponsor_last_key:
                                    new_last_eval_key = sponsor_last_key
                    elif politician_config.get('query_type') == 'search_index':
                        bill_ids_batch, cosponsor_last_key = query_cosponsor_search_index(
                            cosponsor_name=politician_config['search_value'],
                            limit=1000,
                            exclusive_start_key=source_last_eval_key,
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids_batch.update(bill_ids_batch)
                        if cosponsor_last_key:
                            new_last_eval_key = cosponsor_last_key
                    elif politician_config.get('index_name'):
                        bill_ids_batch, sponsor_last_key = query_gsi_for_bill_ids(
                            index_name=politician_config['index_name'],
                            hash_key_name=politician_config['hash_key'],
                            hash_key_value=politician_config['hash_value'],
                            range_key_name=politician_config.get('range_key'),
                            range_key_value=politician_config.get('range_value'),
                            range_key_condition=politician_config.get('range_condition'),
                            limit=1000,
                            exclusive_start_key=source_last_eval_key,
                            get_all=False
                        )
                        all_bill_ids_batch.update(bill_ids_batch)
                        if sponsor_last_key:
                            new_last_eval_key = sponsor_last_key
                
                source_bill_ids_batch = list(all_bill_ids_batch)
            elif source_config.get('query_type') == 'union_politician':
                # Union sponsor and cosponsor queries for pagination (single politician name)
                union_configs = source_config['union_configs']
                all_bill_ids_batch = set()
                new_last_eval_key = None
                
                for union_config in union_configs:
                    if union_config.get('query_type') == 'search_index':
                        # Cosponsor search index
                        bill_ids_batch, cosponsor_last_key = query_cosponsor_search_index(
                            cosponsor_name=union_config['search_value'],
                            limit=1000,
                            exclusive_start_key=source_last_eval_key,  # Note: this may need refinement for union pagination
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids_batch.update(bill_ids_batch)
                        if cosponsor_last_key:
                            new_last_eval_key = cosponsor_last_key  # Use last key from any query
                    else:
                        # Sponsor GSI
                        bill_ids_batch, sponsor_last_key = query_gsi_for_bill_ids(
                            index_name=union_config['index_name'],
                            hash_key_name=union_config['hash_key'],
                            hash_key_value=union_config['hash_value'],
                            range_key_name=union_config.get('range_key'),
                            range_key_value=union_config.get('range_value'),
                            range_key_condition=union_config.get('range_condition'),
                            limit=1000,
                            exclusive_start_key=source_last_eval_key,  # Note: this may need refinement for union pagination
                            get_all=False
                        )
                        all_bill_ids_batch.update(bill_ids_batch)
                        if sponsor_last_key:
                            new_last_eval_key = sponsor_last_key  # Use last key from any query
                
                source_bill_ids_batch = list(all_bill_ids_batch)
            elif source_config.get('query_type') == 'search_index':
                # Use search index query for cosponsors
                source_bill_ids_batch, new_last_eval_key = query_cosponsor_search_index(
                    cosponsor_name=source_config['search_value'],
                    limit=1000,
                    exclusive_start_key=source_last_eval_key,
                    date_from=filters.get('introduced_date_from'),
                    date_to=filters.get('introduced_date_to')
                )
            else:
                # Use GSI query
                source_bill_ids_batch, new_last_eval_key = query_gsi_for_bill_ids(
                    index_name=source_config['index_name'],
                    hash_key_name=source_config['hash_key'],
                    hash_key_value=source_config['hash_value'],
                    range_key_name=source_config.get('range_key'),
                    range_key_value=source_config.get('range_value'),
                    range_key_condition=source_config.get('range_condition'),
                    limit=1000,
                    exclusive_start_key=source_last_eval_key,
                    get_all=False
                )
            source_last_eval_key = new_last_eval_key
            
            if not source_bill_ids_batch:
                # Handle different query types for logging
                if source_config.get('query_type') == 'union_politician':
                    politician_name = source_config.get('politician_name', 'unknown')
                    logger.info(f"Source union politician query ({politician_name}) ran out of items")
                elif source_config.get('query_type') == 'search_index':
                    logger.info(f"Source search index query ran out of items")
                else:
                    index_name = source_config.get('index_name', 'Unknown')
                    logger.info(f"Source GSI {index_name} ran out of items")
                break
            
            logger.info(f"Pagination round {pagination_round}: Got {len(source_bill_ids_batch)} bill_ids from source GSI")
            
            # Fetch full items for this batch
            items_batch = []
            if source_bill_ids_batch:
                batch_size = limit  # Use limit (page size) for batch size
                for i in range(0, len(source_bill_ids_batch), batch_size):
                    batch_ids = source_bill_ids_batch[i:i + batch_size]
                    dynamodb_client = boto3.client('dynamodb')
                    # Include both bill_id (hash key) and search_index_sk (range key)
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
                        items_batch.append(converted_item)
            
            # Apply remaining filters in Python
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
        s3_fetch_success_count = 0
        s3_fetch_fail_count = 0
        for bill in results:
            # Check if this is an oversized item (full details in S3)
            oversize_s3_key = bill.get('oversize_s3_key')
            if oversize_s3_key:
                # Fetch full bill details from S3
                full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
                if full_bill:
                    # Replace bill with full details from S3
                    bill = convert_decimal_to_float(full_bill)
                    s3_fetch_success_count += 1
                else:
                    s3_fetch_fail_count += 1
            
            enriched_results.append(bill)
        
        if enriched_results:
            logger.info(f"Enriched {len(enriched_results)} bill(s). S3 fetch: {s3_fetch_success_count} success, {s3_fetch_fail_count} failed")
        
        # Convert last_evaluated_key to JSON-serializable format
        serializable_last_key = None
        if source_last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(source_last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                serializable_last_key = None
        
        # Return results for multi-GSI intersection
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
    # If no queryable filters, use table scan to return first page
    if not query_configs:
        logger.info("No queryable filters found, using table scan to return first page")
        
        # Build scan parameters
        scan_limit = max(limit * 10, 1000)  # Scan more items to account for potential filtering
        params = {
            'Limit': scan_limit
        }
        
        # Only use last_evaluated_key if it's a valid DynamoDB key format (not a custom format like union_offset)
        # Custom formats have 'query_type' field, DynamoDB keys are dicts with table key attributes
        if last_evaluated_key:
            # Check if it's a custom format (has 'query_type' field)
            if isinstance(last_evaluated_key, dict) and 'query_type' in last_evaluated_key:
                logger.warning(f"Ignoring custom last_evaluated_key format ({last_evaluated_key.get('query_type')}) for scan operation - starting fresh scan")
                # Don't use custom format keys for scan operations
            else:
                # It's a valid DynamoDB key format, use it
                params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Scanning bills table with Limit={scan_limit} (result limit={limit})")
        response = bills_table.scan(**params)
        
        # Extract items from scan
        scanned_items = response.get('Items', [])
        last_eval_key = response.get('LastEvaluatedKey')
        scanned_count = response.get('ScannedCount', 0)
        
        logger.info(f"Scan found {len(scanned_items)} items (scanned {scanned_count} total)")
        
        # Apply any filters in Python (even if no GSI filters, there might be non-GSI filters)
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
        
        # Convert last_evaluated_key to JSON-serializable format
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
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
    
    # Use first query config for single GSI/search index query
    config = query_configs[0]
    
    # union_offset is already extracted at the top of the function
    # Use it here for union queries
    if config.get('query_type') == 'union_all_politicians':
        # Union all politician names (multiple names OR'd together)
        politician_configs = config.get('politician_configs', [])
        politician_names = config.get('politician_names', [])
        logger.info(f"Using single union all politicians query: {len(politician_names)} names")
        all_bill_ids = set()
        
        # Fetch bill IDs from all politician configs and union them
        fetch_limit = (union_offset if union_offset is not None else 0) + (limit * 10)
        
        for politician_config in politician_configs:
            if politician_config.get('query_type') == 'union_politician':
                # Union sponsor and cosponsor for this politician
                union_configs = politician_config.get('union_configs', [])
                for union_config in union_configs:
                    if union_config.get('query_type') == 'search_index':
                        batch_ids, _ = query_cosponsor_search_index(
                            cosponsor_name=union_config['search_value'],
                            limit=fetch_limit,
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids.update(batch_ids)
                    elif union_config.get('index_name'):
                        batch_ids, _ = query_gsi_for_bill_ids(
                            index_name=union_config['index_name'],
                            hash_key_name=union_config['hash_key'],
                            hash_key_value=union_config['hash_value'],
                            range_key_name=union_config.get('range_key'),
                            range_key_value=union_config.get('range_value'),
                            range_key_condition=union_config.get('range_condition'),
                            limit=fetch_limit,
                            get_all=False
                        )
                        all_bill_ids.update(batch_ids)
            elif politician_config.get('query_type') == 'search_index':
                batch_ids, _ = query_cosponsor_search_index(
                    cosponsor_name=politician_config['search_value'],
                    limit=fetch_limit,
                    date_from=filters.get('introduced_date_from'),
                    date_to=filters.get('introduced_date_to')
                )
                all_bill_ids.update(batch_ids)
            elif politician_config.get('index_name'):
                batch_ids, _ = query_gsi_for_bill_ids(
                    index_name=politician_config['index_name'],
                    hash_key_name=politician_config['hash_key'],
                    hash_key_value=politician_config['hash_value'],
                    range_key_name=politician_config.get('range_key'),
                    range_key_value=politician_config.get('range_value'),
                    range_key_condition=politician_config.get('range_condition'),
                    limit=fetch_limit,
                    get_all=False
                )
                all_bill_ids.update(batch_ids)
        
        # Convert to sorted list for consistent pagination
        bill_ids = sorted(list(all_bill_ids))
        original_bill_ids_count = len(bill_ids)
        logger.info(f"Total unique bill IDs from union of all politicians: {original_bill_ids_count}")
        
        # Use union_offset to slice the list
        start_index = union_offset if union_offset is not None else 0
        bill_ids = bill_ids[start_index:]
        logger.info(f"Sliced bill IDs from index {start_index}: {len(bill_ids)} IDs remaining")
        
        index_name = f"UnionAllPoliticians({len(politician_names)} names)"
        last_eval_key = None
        last_processed_index = start_index
    elif config.get('query_type') == 'union_politician':
        # Union sponsor and cosponsor queries
        union_configs = config['union_configs']
        all_bill_ids = set()
        
        # For union queries, we need to fetch all IDs (or paginate through them)
        # Check if we're continuing from a union_offset
        if union_offset is not None:
            # We already have the full list from previous request, but we need to reconstruct it
            # For now, fetch all IDs again (in production, you might cache this)
            logger.info(f"Union offset pagination: fetching all IDs again from offset {union_offset}")
        
        # Fetch bill IDs from both queries
        # For union queries, we need to fetch enough IDs to cover offset + limit
        # Calculate how many we need: offset + (limit * multiplier for filtering)
        fetch_limit = (union_offset if union_offset is not None else 0) + (limit * 10)
        
        # If continuing from union_offset, preserve has_more flags from previous request
        if union_offset_metadata:
            cosponsor_has_more = union_offset_metadata.get('cosponsor_has_more', False)
            sponsor_has_more = union_offset_metadata.get('sponsor_has_more', False)
            logger.info(f"Preserving has_more flags from previous request: cosponsor={cosponsor_has_more}, sponsor={sponsor_has_more}")
        else:
            cosponsor_has_more = False
            sponsor_has_more = False
        
        for union_config in union_configs:
            if union_config.get('query_type') == 'search_index':
                # Cosponsor search index - fetch with pagination
                cosponsor_bill_ids = []
                cosponsor_last_key = None
                total_fetched = 0
                
                while total_fetched < fetch_limit:
                    batch_limit = min(1000, fetch_limit - total_fetched)
                    batch_ids, cosponsor_last_key = query_cosponsor_search_index(
                        cosponsor_name=union_config['search_value'],
                        limit=batch_limit,
                        exclusive_start_key=cosponsor_last_key,
                        date_from=filters.get('introduced_date_from'),
                        date_to=filters.get('introduced_date_to')
                    )
                    if not batch_ids:
                        break
                    cosponsor_bill_ids.extend(batch_ids)
                    all_bill_ids.update(batch_ids)
                    total_fetched += len(batch_ids)
                    if not cosponsor_last_key:
                        break
                # Update has_more flag based on actual query result (OR with preserved value if continuing)
                current_cosponsor_has_more = cosponsor_last_key is not None
                if union_offset_metadata:
                    # If we had more before and still have more, keep it true
                    cosponsor_has_more = cosponsor_has_more or current_cosponsor_has_more
                else:
                    cosponsor_has_more = current_cosponsor_has_more
                logger.info(f"Fetched {len(cosponsor_bill_ids)} bill IDs from cosponsor search index (has_more: {cosponsor_has_more})")
            else:
                # Sponsor GSI - fetch with pagination
                sponsor_bill_ids = []
                sponsor_last_key = None
                total_fetched = 0
                
                while total_fetched < fetch_limit:
                    batch_limit = min(1000, fetch_limit - total_fetched)
                    batch_ids, sponsor_last_key = query_gsi_for_bill_ids(
                        index_name=union_config['index_name'],
                        hash_key_name=union_config['hash_key'],
                        hash_key_value=union_config['hash_value'],
                        range_key_name=union_config.get('range_key'),
                        range_key_value=union_config.get('range_value'),
                        range_key_condition=union_config.get('range_condition'),
                        limit=batch_limit,
                        exclusive_start_key=sponsor_last_key,
                        get_all=False
                    )
                    if not batch_ids:
                        break
                    sponsor_bill_ids.extend(batch_ids)
                    all_bill_ids.update(batch_ids)
                    total_fetched += len(batch_ids)
                    if not sponsor_last_key:
                        break
                # Update has_more flag based on actual query result (OR with preserved value if continuing)
                current_sponsor_has_more = sponsor_last_key is not None
                if union_offset_metadata:
                    # If we had more before and still have more, keep it true
                    sponsor_has_more = sponsor_has_more or current_sponsor_has_more
                else:
                    sponsor_has_more = current_sponsor_has_more
                logger.info(f"Fetched {len(sponsor_bill_ids)} bill IDs from sponsor GSI (has_more: {sponsor_has_more})")
        
        # Convert to sorted list for consistent pagination
        bill_ids = sorted(list(all_bill_ids))
        original_bill_ids_count = len(bill_ids)  # Store original count before slicing
        logger.info(f"Total unique bill IDs from union: {original_bill_ids_count}")
        
        # Use union_offset to slice the list
        start_index = union_offset if union_offset is not None else 0
        bill_ids = bill_ids[start_index:]
        logger.info(f"Sliced bill IDs from index {start_index}: {len(bill_ids)} IDs remaining")
        
        index_name = f"PoliticianNameUnion({config['politician_name']})"
        last_eval_key = None  # Will be set after fetching items if more are available
    elif config.get('query_type') == 'search_index':
        # Use search index query for cosponsors
        logger.info(f"Using single cosponsor search index query: {config['search_value']}")
        bill_ids, last_eval_key = query_cosponsor_search_index(
            cosponsor_name=config['search_value'],
            limit=limit * 5,  # Fetch more to account for filtering
            exclusive_start_key=last_evaluated_key,
            date_from=filters.get('introduced_date_from'),
            date_to=filters.get('introduced_date_to')
        )
        index_name = f"SearchIndex({config['search_type']})"
    else:
        # Use GSI query
        logger.info(f"Using single GSI query: {config['index_name']}")
        bill_ids, last_eval_key = query_gsi_for_bill_ids(
            index_name=config['index_name'],
            hash_key_name=config['hash_key'],
            hash_key_value=config['hash_value'],
            range_key_name=config.get('range_key'),
            range_key_value=config.get('range_value'),
            range_key_condition=config.get('range_condition'),
            limit=limit * 5,  # Fetch more to account for filtering
            exclusive_start_key=last_evaluated_key,  # Support pagination
            get_all=False
        )
        index_name = config['index_name']
    
    # Fetch full items
    items = []
    last_processed_index = 0
    if config.get('query_type') == 'union_all_politicians':
        last_processed_index = start_index
    elif config.get('query_type') == 'union_politician':
        last_processed_index = start_index
    
    if bill_ids:
        batch_size = limit  # Use limit (page size) for batch size
        # For union queries, fetch in batches until we have enough filtered items
        if config.get('query_type') == 'union_all_politicians':
            # Prepare remaining filters for filtering during fetch
            remaining_filters_for_fetch = filters.copy()
            if 'politician_role' in remaining_filters_for_fetch:
                del remaining_filters_for_fetch['politician_role']
            # All politician names have been applied, remove them
            if 'politician_name' in remaining_filters_for_fetch:
                del remaining_filters_for_fetch['politician_name']
            if 'sponsor_name' in remaining_filters_for_fetch:
                del remaining_filters_for_fetch['sponsor_name']
            
            # Fetch and filter items in batches until we have enough filtered items or run out
            i = 0
            filtered_count = 0
            while i < len(bill_ids) and filtered_count < limit:
                batch_ids = bill_ids[i:i + batch_size]
                
                dynamodb_client = boto3.client('dynamodb')
                request_items = {
                    BILLS_TABLE_NAME: {
                        'Keys': [
                            {
                                'bill_id': {'S': str(bid)},
                                'search_index_sk': {'S': str(bid)}
                            }
                            for bid in batch_ids
                        ]
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(BILLS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                
                # Filter items as we fetch them
                for item in batch_items:
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    if apply_python_filter(converted_item, remaining_filters_for_fetch):
                        items.append(converted_item)
                        filtered_count += 1
                        if filtered_count >= limit:
                            break
                
                last_processed_index = start_index + i + len(batch_ids)
                if filtered_count >= limit:
                    break
                i += batch_size
                logger.info(f"Union all politicians pagination: processed {i} IDs, {filtered_count} filtered items (need {limit})")
        elif config.get('query_type') == 'union_politician':
            # Prepare remaining filters for filtering during fetch
            remaining_filters_for_fetch = filters.copy()
            if 'politician_role' in remaining_filters_for_fetch:
                del remaining_filters_for_fetch['politician_role']
            if config.get('filter_key') == 'politician_name' and config.get('politician_name'):
                politician_name = config['politician_name']
                if 'politician_name' in remaining_filters_for_fetch:
                    politician_names = remaining_filters_for_fetch['politician_name'] if isinstance(remaining_filters_for_fetch['politician_name'], list) else [remaining_filters_for_fetch['politician_name']]
                    politician_names = [n for n in politician_names if str(n).strip() != politician_name]
                    if politician_names:
                        remaining_filters_for_fetch['politician_name'] = politician_names
                    else:
                        del remaining_filters_for_fetch['politician_name']
            
            # Fetch and filter items in batches until we have enough filtered items or run out
            i = 0
            filtered_count = 0
            while i < len(bill_ids) and filtered_count < limit:
                batch_ids = bill_ids[i:i + batch_size]
                
                dynamodb_client = boto3.client('dynamodb')
                # Include both bill_id (hash key) and search_index_sk (range key)
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
                
                # Filter items as we fetch them
                for item in batch_items:
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    if apply_python_filter(converted_item, remaining_filters_for_fetch):
                        items.append(converted_item)
                        filtered_count += 1
                        if filtered_count >= limit:
                            # We have enough filtered items, stop processing
                            break
                
                # Update last_processed_index to the next index after this batch
                # This tracks how many IDs we've processed in the bill_ids list
                last_processed_index = start_index + i + len(batch_ids)
                
                # If we have enough filtered items, stop fetching more batches
                if filtered_count >= limit:
                    break
                
                i += batch_size
                
                logger.info(f"Union pagination: processed {i} IDs, {filtered_count} filtered items (need {limit}), last_processed_index: {last_processed_index}")
        else:
            # For single queries, fetch all items
            for i in range(0, len(bill_ids), batch_size):
                batch_ids = bill_ids[i:i + batch_size]
                dynamodb_client = boto3.client('dynamodb')
                # Include both bill_id (hash key) and search_index_sk (range key)
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
                    items.append(converted_item)
    
    # Apply remaining filters
    remaining_filters = filters.copy()
    # Remove politician_role since it's handled at query level
    if 'politician_role' in remaining_filters:
        del remaining_filters['politician_role']
    
    # Handle filter removal based on config
    if config.get('query_type') == 'union_all_politicians':
        # All politician names have been applied, remove them all
        if 'politician_name' in remaining_filters:
            del remaining_filters['politician_name']
        if 'sponsor_name' in remaining_filters:
            del remaining_filters['sponsor_name']
    elif config.get('filter_key') == 'politician_name' and config.get('politician_name'):
        # Remove the specific politician name that was queried
        politician_name = config['politician_name']
        if 'politician_name' in remaining_filters:
            politician_names = remaining_filters['politician_name'] if isinstance(remaining_filters['politician_name'], list) else [remaining_filters['politician_name']]
            politician_names = [n for n in politician_names if str(n).strip() != politician_name]
            if politician_names:
                remaining_filters['politician_name'] = politician_names
            else:
                del remaining_filters['politician_name']
    elif config.get('filter_key') in remaining_filters:
        if isinstance(remaining_filters[config['filter_key']], list):
            remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
            if not remaining_filters[config['filter_key']]:
                del remaining_filters[config['filter_key']]
        else:
            del remaining_filters[config['filter_key']]
    
    # For union queries, items are already filtered during fetch
    # For other queries, apply filters now
    if config.get('query_type') in ['union_politician', 'union_all_politicians']:
        filtered_items = items[:limit]  # Already filtered, just limit to requested count
    else:
        filtered_items = [item for item in items if apply_python_filter(item, remaining_filters)]
        filtered_items = filtered_items[:limit]
    
    # For union queries, calculate next offset for pagination
    if config.get('query_type') == 'union_all_politicians':
        # For union_all_politicians, we don't track individual has_more flags
        # We just check if we've processed all fetched IDs
        items_returned = len(filtered_items)
        has_more_union = last_processed_index < original_bill_ids_count
        
        logger.info(f"Union all politicians pagination check - last_processed_index: {last_processed_index}, original_bill_ids_count: {original_bill_ids_count}, items_returned: {items_returned}, limit: {limit}, has_more_union: {has_more_union}")
        
        if has_more_union:
            next_offset = last_processed_index
            politician_names = config.get('politician_names', [])
            last_eval_key = {
                'offset': next_offset,
                'query_type': 'union_offset',
                'total_ids': original_bill_ids_count,
                'politician_names': politician_names,  # Store all politician names for reconstruction
                'politician_role': filters.get('politician_role', 'both')
            }
            logger.info(f"Union all politicians offset pagination - next offset: {next_offset}, total IDs fetched: {original_bill_ids_count}, processed: {last_processed_index}, politician_names: {politician_names}")
        else:
            last_eval_key = None
            logger.info(f"Union all politicians pagination complete - processed all {last_processed_index} of {original_bill_ids_count} fetched IDs")
    elif config.get('query_type') == 'union_politician':
        # Check if we have more items to fetch
        # last_processed_index is the index we've processed up to (in the original full list)
        # original_bill_ids_count is the total number of IDs we fetched
        # We have more if: (1) we haven't processed all fetched IDs, OR (2) either query has more
        items_returned = len(filtered_items)
        
        # Calculate has_more: true if we haven't processed all IDs OR if either source query has more
        has_more_union = (last_processed_index < original_bill_ids_count) or cosponsor_has_more or sponsor_has_more
        
        logger.info(f"Union pagination check - last_processed_index: {last_processed_index}, original_bill_ids_count: {original_bill_ids_count}, items_returned: {items_returned}, limit: {limit}, cosponsor_has_more: {cosponsor_has_more}, sponsor_has_more: {sponsor_has_more}, has_more_union: {has_more_union}")
        
        if has_more_union:
            # Return union offset pagination key
            next_offset = last_processed_index
            last_eval_key = {
                'offset': next_offset,
                'query_type': 'union_offset',
                'total_ids': original_bill_ids_count,
                'cosponsor_has_more': cosponsor_has_more,
                'sponsor_has_more': sponsor_has_more,
                'politician_name': config.get('politician_name'),  # Store politician name for reconstruction
                'politician_role': config.get('role', 'both')  # Store role for reconstruction
            }
            logger.info(f"Union offset pagination - next offset: {next_offset}, total IDs fetched: {original_bill_ids_count}, processed: {last_processed_index}, cosponsor_has_more: {cosponsor_has_more}, sponsor_has_more: {sponsor_has_more}, politician_name: {config.get('politician_name')}")
        else:
            last_eval_key = None
            logger.info(f"Union pagination complete - processed all {last_processed_index} of {original_bill_ids_count} fetched IDs")
    # For non-union queries, last_eval_key is already set from the query above
    
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
    
    # Convert last_evaluated_key to JSON-serializable format
    serializable_last_key = None
    if last_eval_key:
        if isinstance(last_eval_key, dict) and last_eval_key.get('query_type') == 'union_offset':
            # Union offset pagination key is already serializable
            serializable_last_key = last_eval_key
        else:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                serializable_last_key = None
    
    has_more = serializable_last_key is not None
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': has_more,
        'last_evaluated_key': serializable_last_key,
        'method': 'query',
        'index_used': index_name
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for congress bills search API
    
    Handles both:
    1. API Gateway events (direct invocation)
    2. SQS events (from wrapper Lambda when worker is at concurrency)
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "POST",
        "body": "{\"filters\": {...}, \"limit\": 100}"
    }
    
    Expected event structure (SQS):
    {
        "Records": [{
            "eventSource": "aws:sqs",
            "body": "{\"request_id\": \"...\", \"job_id\": \"...\", \"api_gateway_event\": {...}}"
        }]
    }
    """
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('CONGRESS_BILLS_SEARCH_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            is_sqs_event = True
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract job_id, request_id, and API Gateway event
                job_id = message_body.get('job_id')
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', {})
                
                logger.info(f"📬 Processing SQS message - job_id: {job_id}, request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({})
            }
        
        # Parse request body
        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)
        
        # Extract filters and pagination
        filters = body.get('filters', {})
        limit = body.get('limit', 100)
        last_evaluated_key = body.get('last_evaluated_key')
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 100
        
        # Perform search
        result = search_bills(filters, limit, last_evaluated_key)
        
        # Ensure result is fully JSON-serializable (convert any remaining Decimals, etc.)
        def json_serializer(obj):
            """Custom JSON serializer for types that json.dumps doesn't handle"""
            if isinstance(obj, Decimal):
                return float(obj)
            elif isinstance(obj, (set, frozenset)):
                return list(obj)
            raise TypeError(f"Type {type(obj)} not serializable")
        
        # If this was from SQS, publish completion notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                completion_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 200,
                    'body': result,
                    'status': 'completed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(completion_message, default=json_serializer),
                    Subject=f'Congress Bills Search Completion: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published completion notification for job {job_id}")
            except Exception as e:
                logger.error(f"Error publishing completion notification: {e}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (results sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'Processed from SQS', 'job_id': job_id})
            }
        
        # For direct API Gateway calls, return full response
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(result, default=json_serializer)
        }
        
    except Exception as e:
        logger.error(f"Error in congress bills search: {str(e)}", exc_info=True)
        
        error_response = {
            'success': False,
            'error': str(e)
        }
        
        # If this was from SQS, publish failure notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                failure_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 500,
                    'body': error_response,
                    'status': 'failed'
                }
                # Define json_serializer for error case
                def json_serializer_error(obj):
                    """Custom JSON serializer for types that json.dumps doesn't handle"""
                    if isinstance(obj, Decimal):
                        return float(obj)
                    elif isinstance(obj, (set, frozenset)):
                        return list(obj)
                    raise TypeError(f"Type {type(obj)} not serializable")
                
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(failure_message, default=json_serializer_error),
                    Subject=f'Congress Bills Search Failure: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published failure notification for job {job_id}")
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {e2}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (error sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 500,
                'body': json.dumps({'message': 'Search failed', 'job_id': job_id, 'error': str(e)})
            }
        
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }

