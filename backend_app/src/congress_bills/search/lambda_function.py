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
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin


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


def build_cors_headers(origin: str = None):
    """Build CORS headers for API responses using cors_helper for origin validation"""
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
    
    bill_id = str(item.get('bill_id', ''))
    if bill_id.startswith('SEARCH#'):
        return True
    
    if item.get('is_search_index') is True:
        return True
    
    if item.get('search_type'):
        return True
    
    return False


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
    # CRITICAL: Remove duplicate sponsor_name if politician_name is present to prevent double filtering
    politician_name_filter = filters.get('politician_name')
    if politician_name_filter and filters.get('sponsor_name'):
        # Both fields present - remove sponsor_name to prevent double filtering
        filters = filters.copy()  # Don't modify original
        del filters['sponsor_name']
    
    politician_name_filter = politician_name_filter or filters.get('sponsor_name')
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
    # CRITICAL: Remove duplicate sponsor_name if politician_name is present to prevent double filtering
    politician_name_filter = filters.get('politician_name')
    if politician_name_filter and filters.get('sponsor_name'):
        # Both fields present - remove sponsor_name to prevent double filtering
        logger.info("Both politician_name and sponsor_name present - removing sponsor_name to prevent duplicate filtering")
        filters = filters.copy()  # Don't modify original
        del filters['sponsor_name']
    
    politician_name_filter = politician_name_filter or filters.get('sponsor_name')
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
            introduced_date_from = filters.get('introduced_date_from')
            introduced_date_to = filters.get('introduced_date_to')
            
            # Use BETWEEN if we have both dates, otherwise use gte for from date
            range_condition = None
            range_value = None
            if introduced_date_from and introduced_date_to:
                range_condition = 'between'
                range_value = (introduced_date_from, introduced_date_to)
            elif introduced_date_from:
                range_condition = 'gte'
                range_value = introduced_date_from
            
            query_configs.append({
                'filter_key': 'sponsor_party',
                'index_name': 'SponsorPartyDateIndex',
                'hash_key': 'sponsor_party',
                'hash_value': party,
                'range_key': 'introduced_date' if range_value else None,
                'range_value': range_value,
                'range_condition': range_condition
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
        introduced_date_from = filters.get('introduced_date_from')
        introduced_date_to = filters.get('introduced_date_to')
        
        # Use BETWEEN if we have both dates, otherwise use gte for from date
        if introduced_date_from and introduced_date_to:
            query_configs.append({
                'filter_key': 'bill_number',
                'index_name': 'BillNumberDateIndex',
                'hash_key': 'bill_number',
                'hash_value': bill_number,
                'range_key': 'introduced_date',
                'range_value': introduced_date_from,  # Start of range
                'range_value_to': introduced_date_to,  # End of range
                'range_condition': 'between'
            })
        elif introduced_date_from:
            query_configs.append({
                'filter_key': 'bill_number',
                'index_name': 'BillNumberDateIndex',
                'hash_key': 'bill_number',
                'hash_value': bill_number,
                'range_key': 'introduced_date' if introduced_date_from else None,
                'range_value': introduced_date_from,
                'range_condition': 'gte' if introduced_date_from else None
            })
        else:
            query_configs.append({
                'filter_key': 'bill_number',
                'index_name': 'BillNumberDateIndex',
                'hash_key': 'bill_number',
                'hash_value': bill_number,
                'range_key': None,
                'range_value': None,
                'range_condition': None
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
    
    For date ranges, queries each day individually using begins_with to ensure all dates are covered.
    
    Args:
        cosponsor_name: Name of the cosponsor
        limit: Maximum number of bill IDs to return
        exclusive_start_key: Pagination token from previous query (can contain date_offset for date range queries)
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
        
        # Helper to extract date from string
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
        
        # If we have a date range, query each day individually for better coverage
        if date_from_part and date_to_part:
            try:
                from datetime import datetime, timedelta
                
                # Parse dates
                date_from_obj = datetime.strptime(date_from_part, '%Y-%m-%d').date()
                date_to_obj = datetime.strptime(date_to_part, '%Y-%m-%d').date()
                
                # Handle pagination - continue from where we left off
                date_offset = 0
                if exclusive_start_key and isinstance(exclusive_start_key, dict):
                    if exclusive_start_key.get('query_type') == 'cosponsor_date_range':
                        date_offset = exclusive_start_key.get('date_offset', 0)
                        logger.info(f"Continuing cosponsor date range search from offset: {date_offset}")
                
                # If the offset is already past the end date, return no more results
                if date_from_obj + timedelta(days=date_offset) > date_to_obj:
                    logger.info(f"📅 Cosponsor date range offset {date_offset} is past end date {date_to_obj} - no more days to query.")
                    return [], None
                
                # Generate list of dates to query (skip dates we've already queried)
                current_date_obj = date_from_obj + timedelta(days=date_offset)
                dates_to_query_batch = []
                while current_date_obj <= date_to_obj:
                    dates_to_query_batch.append(current_date_obj)
                    current_date_obj += timedelta(days=1)
                    # Limit number of days to query per request to avoid timeout
                    if len(dates_to_query_batch) >= 30:  # Query max 30 days per request
                        break
                
                if not dates_to_query_batch:
                    logger.info(f"📅 No more days to query in cosponsor search (offset: {date_offset}, end date: {date_to_obj})")
                    return [], None
                
                logger.info(f"📅 Querying cosponsor search index for {len(dates_to_query_batch)} days from {dates_to_query_batch[0]} to {dates_to_query_batch[-1]} (offset: {date_offset})")
                
                # Query each day and collect bill_ids
                all_bill_ids = set()
                seen_bill_ids = set()
                
                for query_date in dates_to_query_batch:
                    date_str = query_date.strftime('%Y-%m-%d')
                    try:
                        # Use begins_with to match INTRODUCED_DATE#YYYY-MM-DD# pattern
                        sk_prefix = f"INTRODUCED_DATE#{date_str}#"
                        key_condition = Key('bill_id').eq(search_bill_id) & Key('search_index_sk').begins_with(sk_prefix)
                        
                        query_params = {
                            'KeyConditionExpression': key_condition,
                            'ProjectionExpression': 'entity_bill_id, search_index_sk',
                            'Limit': 1000,  # Get up to 1000 per day
                        }
                        
                        response = bills_table.query(**query_params)
                        items_from_day = response.get('Items', [])
                        
                        # Extract bill_ids
                        bill_ids_for_date = []
                        for item in items_from_day:
                            entity_bill_id = item.get('entity_bill_id')
                            if entity_bill_id and entity_bill_id not in seen_bill_ids:
                                seen_bill_ids.add(entity_bill_id)
                                all_bill_ids.add(entity_bill_id)
                                bill_ids_for_date.append(entity_bill_id)
                            elif not entity_bill_id:
                                # Fallback: extract from search_index_sk
                                search_index_sk = item.get('search_index_sk', '')
                                if search_index_sk and '#' in search_index_sk:
                                    parts = search_index_sk.split('#')
                                    if len(parts) >= 3:
                                        fallback_bill_id = parts[2]
                                        if fallback_bill_id not in seen_bill_ids:
                                            seen_bill_ids.add(fallback_bill_id)
                                            all_bill_ids.add(fallback_bill_id)
                                            bill_ids_for_date.append(fallback_bill_id)
                        
                        if bill_ids_for_date:
                            logger.debug(f"📅 Cosponsor date {date_str}: fetched {len(items_from_day)} items, extracted {len(bill_ids_for_date)} unique bill_ids")
                    
                    except Exception as e:
                        logger.warning(f"⚠️ Error querying cosponsor date {date_str}: {e}")
                        continue
                
                bill_ids = list(all_bill_ids)
                logger.info(f"✅ Cosponsor date range query complete: {len(bill_ids)} unique bill_ids from {len(dates_to_query_batch)} days")
                
                # Determine if there are more days to query
                last_queried_date = date_from_obj + timedelta(days=date_offset + len(dates_to_query_batch) - 1)
                has_more = last_queried_date < date_to_obj
                
                if has_more:
                    # Return pagination token with next date offset
                    last_eval_key = {
                        'query_type': 'cosponsor_date_range',
                        'date_offset': date_offset + len(dates_to_query_batch),
                        'cosponsor_name': normalized_name,
                        'date_from': date_from_part,
                        'date_to': date_to_part,
                    }
                    logger.info(f"📅 More days available in cosponsor search: last queried {last_queried_date}, end date {date_to_obj}, next offset {date_offset + len(dates_to_query_batch)}")
                else:
                    last_eval_key = None
                    logger.info(f"📅 Cosponsor date range query complete: queried all days from {date_from_obj} to {date_to_obj}")
                
                return bill_ids[:limit], last_eval_key
                
            except ValueError as e:
                logger.error(f"❌ Invalid date format in cosponsor search: {e}")
                # Fall back to between query
                pass
        
        # Fallback: use between query for single date or no date range
        # Build query parameters
        # search_index_sk format: INTRODUCED_DATE#YYYY-MM-DD#<bill_id>
        key_condition = Key('bill_id').eq(search_bill_id)
        
        if date_from_part or date_to_part:
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
        items_fetched = response.get('Items', [])
        logger.info(f"Query cosponsor search index '{normalized_name}': fetched {len(items_fetched)} items from DynamoDB")
        
        for item in items_fetched:
            entity_bill_id = item.get('entity_bill_id')
            if entity_bill_id:
                bill_ids.append(entity_bill_id)
            else:
                # Fallback: try to extract from search_index_sk if entity_bill_id is missing
                search_index_sk = item.get('search_index_sk', '')
                if search_index_sk and '#' in search_index_sk:
                    # Format: INTRODUCED_DATE#YYYY-MM-DD#<bill_id>
                    parts = search_index_sk.split('#')
                    if len(parts) >= 3:
                        fallback_bill_id = parts[2]
                        logger.warning(f"Cosponsor search index item missing entity_bill_id, extracted from search_index_sk: {fallback_bill_id}")
                        bill_ids.append(fallback_bill_id)
                    else:
                        logger.warning(f"Cosponsor search index item missing entity_bill_id and invalid search_index_sk format: {search_index_sk}")
                else:
                    logger.warning(f"Cosponsor search index item missing entity_bill_id and search_index_sk: {item}")
        
        last_eval_key = response.get('LastEvaluatedKey')
        
        logger.info(f"Query cosponsor search index '{normalized_name}': extracted {len(bill_ids)} bill IDs from {len(items_fetched)} items, has_more: {last_eval_key is not None}")
        
        return bill_ids, last_eval_key
        
    except Exception as e:
        logger.error(f"Error querying cosponsor search index '{cosponsor_name}': {str(e)}", exc_info=True)
        raise


def prepare_range_key_value_for_query(config: Dict[str, Any]) -> tuple[Any, Optional[str]]:
    """
    Helper function to prepare range_key_value and range_key_condition for query_gsi_for_bill_ids.
    Handles BETWEEN condition by converting range_value and range_value_to to a tuple.
    
    Args:
        config: Query config dictionary with range_key, range_value, range_condition, and optionally range_value_to
    
    Returns:
        Tuple of (range_key_value, range_key_condition) ready for query_gsi_for_bill_ids
    """
    range_key_condition = config.get('range_condition')
    range_key_value = config.get('range_value')
    
    if range_key_condition == 'between' and config.get('range_value_to'):
        # For BETWEEN, pass tuple of (start, end)
        range_key_value = (config.get('range_value'), config.get('range_value_to'))
    
    return range_key_value, range_key_condition


def query_gsi_for_bill_ids(index_name: str, hash_key_name: str, hash_key_value: Any,
                           range_key_name: Optional[str] = None, range_key_value: Any = None,
                           range_key_condition: Optional[str] = None, limit: int = 1000,
                           exclusive_start_key: Optional[Dict] = None, get_all: bool = False) -> tuple[List[str], Optional[Dict], Dict[str, Dict]]:
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
        Tuple of (bill_ids list, last_evaluated_key for pagination, bill_id_to_gsi_item mapping)
        The bill_id_to_gsi_item mapping allows us to create pagination keys from the last returned item
    """
    bill_ids = []
    bill_id_to_gsi_item = {}  # Map bill_id to GSI item (for pagination key creation)
    last_eval_key = exclusive_start_key
    
    params = {
        'IndexName': index_name,
        'KeyConditionExpression': Key(hash_key_name).eq(hash_key_value),
        'Limit': limit,
        # CRITICAL: Project hash_key, range_key (if present), and bill_id for pagination key creation
        # We need these keys to create valid pagination keys from the last returned item
        # DynamoDB requires hash_key, range_key (if GSI has one), and primary key for ExclusiveStartKey
    }
    
    # Build ProjectionExpression to include hash_key, range_key (if present), and bill_id
    # CRITICAL: Some GSIs always have a range key even if we're not filtering by it
    # We need to include it in the projection for pagination key creation
    projection_attrs = [hash_key_name, 'bill_id']
    if range_key_name:
        projection_attrs.append(range_key_name)
    else:
        # Determine range key from index name if not in config
        # All "*DateIndex" GSIs (except IntroducedDateIndex and LatestActionDateIndex) have introduced_date as range key
        gsis_with_date_range_key = [
            'SponsorPartyDateIndex', 'PolicyAreaDateIndex',
            'SponsorNameDateIndex', 'BillTitleDateIndex', 'BillTypeDateIndex',
            'BipartisanDateIndex', 'BillNumberDateIndex'
        ]
        if index_name in gsis_with_date_range_key:
            projection_attrs.append('introduced_date')
    params['ProjectionExpression'] = ', '.join(projection_attrs)
    
    # Note: Cannot use FilterExpression on is_search_index here because GSIs don't project it
    # Search index items will be filtered out after BatchGetItem using is_search_index_item()
    
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
                # Log the pagination key before using it
                logger.info(f"Using ExclusiveStartKey for GSI {index_name}: {json.dumps(last_eval_key, default=str)}")
                params['ExclusiveStartKey'] = last_eval_key
            
            response = bills_table.query(**params)
            gsi_items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
            
            # Extract bill_ids and store GSI items for pagination key creation
            for item in gsi_items:
                bill_id = item.get('bill_id')
                if bill_id:
                    bill_ids.append(bill_id)
                    # Store GSI item for this bill_id (contains hash key, range key, and bill_id)
                    bill_id_to_gsi_item[bill_id] = item
            
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
    
    return bill_ids[:limit], last_eval_key, bill_id_to_gsi_item


def search_by_introduced_date_range(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search for bills by introduced date range using day-by-day GSI queries.
    This is more efficient than scanning when we have a date range.
    
    For each day in the date range, we query IntroducedDateIndex and union the results.
    Then we apply other filters in Python.
    
    Args:
        filters: Filters including introduced_date_from and introduced_date_to
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token (contains date_offset for continuing through date range)
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")
    
    date_from = filters.get('introduced_date_from')
    date_to = filters.get('introduced_date_to')
    
    if not date_from and not date_to:
        logger.warning("⚠️ search_by_introduced_date_range called without date filters")
        return {'success': False, 'error': 'Date range required'}
    
    # Parse dates
    try:
        if date_from:
            date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
        else:
            date_from_obj = datetime(2000, 1, 1).date()
        
        if date_to:
            date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
        else:
            date_to_obj = datetime.now().date()
    except ValueError as e:
        logger.error(f"❌ Invalid date format: {e}")
        return {'success': False, 'error': f'Invalid date format: {e}'}
    
    # Handle pagination - continue from where we left off
    date_offset = 0
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        if last_evaluated_key.get('query_type') == 'date_range':
            date_offset = last_evaluated_key.get('date_offset', 0)
            logger.info(f"Continuing date range search from offset: {date_offset}")
    
    # Generate list of dates to query (skip dates we've already queried)
    current_date = date_from_obj + timedelta(days=date_offset)
    dates_to_query = []
    while current_date <= date_to_obj:
        dates_to_query.append(current_date)
        current_date += timedelta(days=1)
        # Limit number of days to query per request to avoid timeout
        if len(dates_to_query) >= 30:  # Query max 30 days per request
            break
    
    if not dates_to_query:
        logger.info(f"📅 No more days to query (offset: {date_offset}, end date: {date_to_obj})")
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'method': 'date_range_query',
            'index_used': 'IntroducedDateIndex'
        }
    
    logger.info(f"📅 Querying {len(dates_to_query)} days from {dates_to_query[0]} to {dates_to_query[-1]} (offset: {date_offset})")
    logger.info(f"📅 Date range is INCLUSIVE: includes {dates_to_query[0]} (start) and {dates_to_query[-1]} (end)")
    
    # Query each day and collect bill_ids
    all_bill_ids = set()
    seen_bill_ids = set()
    
    for query_date in dates_to_query:
        date_str = query_date.strftime('%Y-%m-%d')
        try:
            key_condition = Key('introduced_date').eq(date_str)
            
            query_kwargs = {
                'IndexName': 'IntroducedDateIndex',
                'KeyConditionExpression': key_condition,
                'ProjectionExpression': 'bill_id',
                'Limit': 1000,  # Get up to 1000 per day
            }
            
            response = bills_table.query(**query_kwargs)
            items = response.get('Items', [])
            
            # Extract bill_ids
            bill_ids_for_date = []
            for item in items:
                bill_id = item.get('bill_id')
                if bill_id and bill_id not in seen_bill_ids:
                    seen_bill_ids.add(bill_id)
                    all_bill_ids.add(bill_id)
                    bill_ids_for_date.append(bill_id)
            
            if bill_ids_for_date:
                logger.debug(f"📅 Date {date_str}: found {len(bill_ids_for_date)} bill_ids (total so far: {len(all_bill_ids)})")
            
            # Don't stop early - we need to query all days in the range to ensure we get all matching bills
            # The filtering will happen after we fetch all items
                
        except Exception as e:
            logger.warning(f"⚠️ Error querying date {date_str}: {e}")
            continue
    
    bill_ids = list(all_bill_ids)
    logger.info(f"✅ Date range query complete: {len(bill_ids)} unique bill_ids from {len(dates_to_query)} days")
    
    # Fetch full items using BatchGetItem
    items = []
    if bill_ids:
        batch_size = 100
        for i in range(0, len(bill_ids), batch_size):
            batch_ids = bill_ids[i:i + batch_size]
            # Deduplicate batch_ids to avoid ValidationException for duplicate keys
            batch_ids = list(dict.fromkeys(batch_ids))
            
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
            
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                # Filter out search index items
                if not is_search_index_item(converted_item):
                    items.append(converted_item)
    
    # Apply remaining filters in Python
    remaining_filters = filters.copy()
    if 'introduced_date_from' in remaining_filters:
        del remaining_filters['introduced_date_from']
    if 'introduced_date_to' in remaining_filters:
        del remaining_filters['introduced_date_to']
    
    filtered_items = [item for item in items if apply_python_filter(item, remaining_filters)]
    
    # Continue querying more days until we have enough results or exhaust the date range
    all_filtered_items = filtered_items.copy()
    current_date_offset = date_offset + len(dates_to_query)
    
    # Keep querying more days if we don't have enough results
    while len(all_filtered_items) < limit:
        # Check if we've exhausted the date range
        next_date = date_from_obj + timedelta(days=current_date_offset)
        if next_date > date_to_obj:
            # No more days to query
            break
        
        # Query next batch of days
        next_dates = []
        current_date = next_date
        while current_date <= date_to_obj and len(next_dates) < 30:
            next_dates.append(current_date)
            current_date += timedelta(days=1)
        
        if not next_dates:
            break
        
        logger.info(f"📅 Querying additional {len(next_dates)} days (offset: {current_date_offset}) to reach limit of {limit}")
        
        # Query these days
        next_bill_ids = set()
        for query_date in next_dates:
            date_str = query_date.strftime('%Y-%m-%d')
            try:
                key_condition = Key('introduced_date').eq(date_str)
                query_kwargs = {
                    'IndexName': 'IntroducedDateIndex',
                    'KeyConditionExpression': key_condition,
                    'ProjectionExpression': 'bill_id',
                    'Limit': 1000,
                }
                response = bills_table.query(**query_kwargs)
                for item in response.get('Items', []):
                    bill_id = item.get('bill_id')
                    if bill_id and bill_id not in seen_bill_ids:
                        seen_bill_ids.add(bill_id)
                        next_bill_ids.add(bill_id)
            except Exception as e:
                logger.warning(f"⚠️ Error querying date {date_str}: {e}")
                continue
        
        if not next_bill_ids:
            current_date_offset += len(next_dates)
            continue
        
        # Fetch full items for these bill_ids
        next_items = []
        batch_size = 100
        next_bill_ids_list = list(next_bill_ids)
        for i in range(0, len(next_bill_ids_list), batch_size):
            batch_ids = next_bill_ids_list[i:i + batch_size]
            batch_ids = list(dict.fromkeys(batch_ids))
            
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
            
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                if not is_search_index_item(converted_item):
                    next_items.append(converted_item)
        
        # Apply filters and add to results
        next_filtered = [item for item in next_items if apply_python_filter(item, remaining_filters)]
        all_filtered_items.extend(next_filtered)
        
        current_date_offset += len(next_dates)
        
        # Stop if we've exhausted the date range
        if next_dates[-1] >= date_to_obj:
            break
    
    # Trim to limit
    filtered_items = all_filtered_items[:limit]
    
    # Calculate the last date we actually queried
    # current_date_offset is the next offset (after the last queried day)
    # So the last queried day is at offset current_date_offset - 1
    if current_date_offset > date_offset + len(dates_to_query):
        # We queried additional days beyond the initial batch
        last_queried_date = date_from_obj + timedelta(days=current_date_offset - 1)
    else:
        # We only queried the initial batch
        last_queried_date = dates_to_query[-1] if dates_to_query else date_from_obj
    
    logger.info(f"✅ Date range search complete: {len(filtered_items)} items matched all filters (queried up to {last_queried_date}, next offset: {current_date_offset})")
    
    # Determine if there are more results
    has_more = False
    last_eval_key = None
    
    # Check if there are more days to query
    if last_queried_date < date_to_obj:
        # More days to query
        has_more = True
        last_eval_key = {
            'query_type': 'date_range',
            'date_offset': current_date_offset,
            'introduced_date_from': date_from,
            'introduced_date_to': date_to,
        }
        logger.info(f"📅 More days available: last queried {last_queried_date}, end date {date_to_obj}, next offset {current_date_offset}")
    elif len(all_filtered_items) > len(filtered_items):
        # We have more filtered items but hit the limit - shouldn't happen with current logic
        has_more = True
        last_eval_key = {
            'query_type': 'date_range',
            'date_offset': current_date_offset,
            'introduced_date_from': date_from,
            'introduced_date_to': date_to,
        }
        logger.info(f"📅 More items available: {len(all_filtered_items)} total, returning {len(filtered_items)}")
    
    # Convert and enrich
    results = [convert_decimal_to_float(item) for item in filtered_items]
    enriched_results = []
    for bill in results:
        if is_search_index_item(bill):
            continue
        
        oversize_s3_key = bill.get('oversize_s3_key')
        if oversize_s3_key:
            full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
            if full_bill:
                bill = convert_decimal_to_float(full_bill)
        enriched_results.append(bill)
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': has_more,
        'last_evaluated_key': last_eval_key,
        'method': 'date_range_query',
        'index_used': 'IntroducedDateIndex'
    }


def search_bills(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None, is_restoration: bool = False) -> Dict[str, Any]:
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
    logger.info(f"🔍 search_bills called: limit={limit}, is_restoration={is_restoration}")
    if last_evaluated_key:
        logger.info(f"🔍 last_evaluated_key: {last_evaluated_key}")
        
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")

    # Check for union_offset pagination BEFORE identifying queryable filters
    # This allows us to continue union queries even if filters are empty
    union_offset = None
    union_offset_metadata = None
    filtered_offset = None
    filtered_offset_metadata = None
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        query_type = last_evaluated_key.get('query_type')
        if query_type == 'union_offset':
            union_offset = last_evaluated_key.get('offset', 0)
            union_offset_metadata = last_evaluated_key  # Store full metadata for reconstruction
            logger.info(f"Detected union_offset pagination: offset={union_offset}")
            # If we have union_offset, we need to ensure we have query configs
            # The filters should contain the politician_name to reconstruct the query
        elif query_type == 'union_politician_filtered_offset':
            filtered_offset = last_evaluated_key.get('offset', 0)
            filtered_offset_metadata = last_evaluated_key  # Store full metadata for reconstruction
            logger.info(f"Detected union_politician_filtered_offset pagination: offset={filtered_offset}, total_filtered={last_evaluated_key.get('total_filtered_count')}")
            # For filtered offset, we need to re-run the query and slice the results
    
    # Check if this is a date-only query (or date + filters that work well with date range query)
    # For date range queries, use the efficient day-by-day approach
    has_date_range = filters.get('introduced_date_from') and filters.get('introduced_date_to')
    has_date_from_only = filters.get('introduced_date_from') and not filters.get('introduced_date_to')
    
    # Check if we should use date range query approach
    # Use it when:
    # 1. We have a date range (from and to)
    # 2. The last_evaluated_key indicates we're in a date range query
    # 3. OR we have date range + other filters that can be applied in Python (like sponsor_party)
    use_date_range_query = False
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        if last_evaluated_key.get('query_type') == 'date_range':
            use_date_range_query = True
            logger.info("✅ Continuing date range query from pagination token")
    
    # For new queries, use date range approach if we have date range and it's the most efficient option
    # This is especially good when combined with filters that can be applied in Python
    if not use_date_range_query and has_date_range:
        # Check if we have other GSI-queryable filters
        query_configs = identify_queryable_filters(filters)
        
        # Check if we have search_index queries (cosponsor searches) - these should NOT use date range query
        # Search index queries can handle date ranges efficiently themselves
        has_search_index_query = any(
            config.get('query_type') == 'search_index'
            for config in query_configs
        )
        
        # Check if we have union queries (politician_name with sponsor/cosponsor) - these should NOT use date range query
        has_union_query = any(
            config.get('query_type') in ['union_politician', 'union_all_politicians']
            for config in query_configs
        )
        
        # If we have IntroducedDateIndex in the configs, it means we're only using the from date
        # In this case, use date range query for better pagination
        has_introduced_date_index = any(
            config.get('index_name') == 'IntroducedDateIndex' 
            for config in query_configs
        )
        
        # Check if other GSIs can handle the date range efficiently (using BETWEEN)
        has_date_range_aware_gsi = any(
            config.get('range_condition') == 'between' and config.get('range_key') == 'introduced_date'
            for config in query_configs
        )
        
        # Use date range query if:
        # - We have IntroducedDateIndex (which only uses from date, not range) - this prevents pagination issues
        # - AND we don't have search_index or union queries (which handle date ranges themselves)
        # - OR we have date range + no other efficient GSIs (single filter or filters that work well with Python filtering)
        if has_introduced_date_index and not has_search_index_query and not has_union_query:
            use_date_range_query = True
            logger.info("✅ Using date range query approach - IntroducedDateIndex detected (prevents pagination issues)")
        elif len(query_configs) <= 1 and has_date_range and not has_search_index_query and not has_union_query:
            use_date_range_query = True
            logger.info("✅ Using date range query approach for date-only or simple queries")
        elif has_search_index_query or has_union_query:
            logger.info("✅ Using search index/union query approach - these handle date ranges efficiently")
    
    if use_date_range_query:
        return search_by_introduced_date_range(filters, limit, last_evaluated_key)
    
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
                                # For date ranges, query_cosponsor_search_index will query each day
                                # and return a pagination token if there are more days
                                cosponsor_bill_ids = []
                                cosponsor_last_key = None
                                max_cosponsor_iterations = 50  # Limit iterations
                                cosponsor_iteration = 0
                                
                                while cosponsor_iteration < max_cosponsor_iterations:
                                    cosponsor_iteration += 1
                                    batch_bill_ids, cosponsor_last_key = query_cosponsor_search_index(
                                        cosponsor_name=union_config['search_value'],
                                        limit=1000,
                                        exclusive_start_key=cosponsor_last_key,
                                        date_from=filters.get('introduced_date_from'),
                                        date_to=filters.get('introduced_date_to')
                                    )
                                    
                                    if not batch_bill_ids:
                                        break
                                    
                                    cosponsor_bill_ids.extend(batch_bill_ids)
                                    logger.info(f"Initial union cosponsor query iteration {cosponsor_iteration}: fetched {len(batch_bill_ids)} bill IDs (total: {len(cosponsor_bill_ids)})")
                                    
                                    if not cosponsor_last_key:
                                        break
                                
                                all_bill_ids.update(cosponsor_bill_ids)
                                logger.info(f"Initial union cosponsor query complete: {len(cosponsor_bill_ids)} total bill IDs")
                            elif union_config.get('index_name'):
                                bill_ids, _, _ = query_gsi_for_bill_ids(
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
                        # For date ranges, query_cosponsor_search_index will query each day
                        # and return a pagination token if there are more days
                        cosponsor_bill_ids = []
                        cosponsor_last_key = None
                        max_cosponsor_iterations = 50  # Limit iterations
                        cosponsor_iteration = 0
                        
                        while cosponsor_iteration < max_cosponsor_iterations:
                            cosponsor_iteration += 1
                            batch_bill_ids, cosponsor_last_key = query_cosponsor_search_index(
                                cosponsor_name=politician_config['search_value'],
                                limit=1000,
                                exclusive_start_key=cosponsor_last_key,
                                date_from=filters.get('introduced_date_from'),
                                date_to=filters.get('introduced_date_to')
                            )
                            
                            if not batch_bill_ids:
                                break
                            
                            cosponsor_bill_ids.extend(batch_bill_ids)
                            logger.info(f"Initial cosponsor query iteration {cosponsor_iteration}: fetched {len(batch_bill_ids)} bill IDs (total: {len(cosponsor_bill_ids)})")
                            
                            if not cosponsor_last_key:
                                break
                        
                        all_bill_ids.update(cosponsor_bill_ids)
                        logger.info(f"Initial cosponsor query complete: {len(cosponsor_bill_ids)} total bill IDs")
                    elif politician_config.get('index_name'):
                        # Single sponsor GSI query
                        bill_ids, _, _ = query_gsi_for_bill_ids(
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
                        bill_ids, _, _ = query_gsi_for_bill_ids(
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
                
                # Prepare range key value (handles BETWEEN condition)
                range_key_value, range_key_condition = prepare_range_key_value_for_query(config)
                
                bill_ids, _, _ = query_gsi_for_bill_ids(
                    index_name=index_name,
                    hash_key_name=config['hash_key'],
                    hash_key_value=config['hash_value'],
                    range_key_name=config.get('range_key'),
                    range_key_value=range_key_value,
                    range_key_condition=range_key_condition,
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
        
        # Priority-based source selection
        # Priority order (lower number = higher priority):
        # 1. Exact matches (bill_number, bill_title) - most specific, should be source
        # 2. Single-value filters (sponsor_party, policy_area, bipartisan, bill_type, congress) - moderately specific
        # 3. Search indices (cosponsor, sponsor via politician_name) - can have many results, need to continue querying
        # 4. Date ranges (introduced_date, latest_action_date) - least specific, should be applied as filters, not as source
        
        def get_query_priority(key, config):
            """Return priority for source selection (lower number = higher priority)"""
            filter_key = config.get('filter_key', '')
            query_type = config.get('query_type', '')
            index_name = config.get('index_name', '')
            
            # Priority 1: Exact matches (most specific)
            if filter_key in ['bill_number', 'bill_title']:
                return 1
            
            # Priority 2: Single-value filters (moderately specific)
            # Note: bipartisan moved to priority 3 because it can return many results
            if filter_key in ['sponsor_party', 'policy_area', 'bill_type', 'congress']:
                return 2
            
            # Priority 3: Search indices (cosponsor, sponsor via politician_name) and bipartisan
            # bipartisan is here because it can return many results (1000+), similar to search indices
            if query_type == 'search_index' or filter_key == 'politician_name' or filter_key == 'bipartisan':
                return 3
            
            # Priority 4: Date ranges (least specific, should be filters)
            if filter_key in ['introduced_date', 'latest_action_date'] or index_name in ['IntroducedDateIndex', 'LatestActionDateIndex']:
                return 4
            
            # Default: medium priority
            return 5
        
        # Select source based on priority (lower priority number = higher priority)
        # Among same priority, prefer shorter result sets
        def get_source_score(key):
            priority = get_query_priority(key, gsi_results[key]['config'])
            result_count = len(gsi_results[key]['bill_ids'])
            # Return tuple: (priority, result_count) - lower is better
            return (priority, result_count)
        
        shortest_key = min(gsi_results.keys(), key=get_source_score)
        source_priority = get_query_priority(shortest_key, gsi_results[shortest_key]['config'])
        logger.info(f"Using {shortest_key} as source of truth (priority: {source_priority}, {len(gsi_results[shortest_key]['bill_ids'])} bill_ids)")
        
        source_bill_ids = list(gsi_results[shortest_key]['bill_ids'])
        source_config = gsi_results[shortest_key]['config']
        
        logger.info(f"Source config: index={source_config.get('index_name')}, range_condition={source_config.get('range_condition')}")
        
        # Remove the source filter from filters (we've already applied it via GSI)
        remaining_filters = filters.copy()
        # Remove politician_role since it's handled at query level
        if 'politician_role' in remaining_filters:
            del remaining_filters['politician_role']
        
        # Check if we have a cosponsor search index query that we should cross-reference with the source
        # For high-priority sources (priority 1-2), if we have a cosponsor search index, use intersection
        cosponsor_search_config = None
        cosponsor_search_key = None
        for key, result in gsi_results.items():
            config = result['config']
            if config.get('query_type') == 'search_index' and config.get('search_type') == 'COSPONSOR':
                cosponsor_search_config = config
                cosponsor_search_key = key
                break
        
        # If we have a high-priority source and a cosponsor search index, use intersection
        # Store cosponsor search config for use in pagination loop
        use_cosponsor_intersection = False
        all_cosponsor_bill_ids = None
        if source_priority <= 2 and cosponsor_search_config:
            use_cosponsor_intersection = True
            logger.info(f"High-priority source ({shortest_key}) detected with cosponsor search index - using intersection approach")
            # Get all cosponsor bill_ids by querying across all days in date range
            cosponsor_bill_ids = gsi_results[cosponsor_search_key]['bill_ids']
            all_cosponsor_bill_ids = set(cosponsor_bill_ids)
            
            # Continue querying cosponsor search index across all days in date range
            # to ensure we get all possible matches
            cosponsor_last_key = gsi_results[cosponsor_search_key].get('last_eval_key')
            max_cosponsor_iterations = 50
            cosponsor_iteration = 0
            
            while cosponsor_last_key is not None and cosponsor_iteration < max_cosponsor_iterations:
                cosponsor_iteration += 1
                batch_cosponsor_ids, cosponsor_last_key = query_cosponsor_search_index(
                    cosponsor_name=cosponsor_search_config['search_value'],
                    limit=1000,
                    exclusive_start_key=cosponsor_last_key,
                    date_from=filters.get('introduced_date_from'),
                    date_to=filters.get('introduced_date_to')
                )
                
                if not batch_cosponsor_ids:
                    break
                
                # Add to all cosponsor bill_ids (union for collecting all, then we'll intersect)
                all_cosponsor_bill_ids.update(batch_cosponsor_ids)
                logger.info(f"Cosponsor search iteration {cosponsor_iteration}: collected {len(all_cosponsor_bill_ids)} total cosponsor bill_ids")
                
                if not cosponsor_last_key:
                    break
            
            logger.info(f"Collected all cosponsor bill_ids: {len(all_cosponsor_bill_ids)} total")
            # Get initial intersection with source
            source_bill_ids = list(set(source_bill_ids) & all_cosponsor_bill_ids)
            logger.info(f"Initial intersection: {len(source_bill_ids)} bill_ids from {len(gsi_results[shortest_key]['bill_ids'])} source × {len(all_cosponsor_bill_ids)} cosponsor")
            
            # Remove politician_name from remaining_filters since we've applied it via intersection
            if 'politician_name' in remaining_filters:
                del remaining_filters['politician_name']
            if 'sponsor_name' in remaining_filters:
                del remaining_filters['sponsor_name']
        
        # Handle politician_name filter removal (if not already removed by intersection logic)
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
        
        # Handle offset-based pagination if last_evaluated_key contains an offset
        offset = 0
        initial_source_last_eval_key = None
        total_matching_items_from_previous = None
        # For union_politician queries, we need separate tokens for sponsor and cosponsor
        initial_sponsor_last_key = None
        initial_cosponsor_last_key = None
        # Initialize re_query_from_beginning early so it's available when needed
        re_query_from_beginning = False
        if last_evaluated_key and isinstance(last_evaluated_key, dict):
            if last_evaluated_key.get('query_type') == 'multi_gsi_intersection_offset':
                offset = last_evaluated_key.get('offset', 0)
                # If the offset token contains a source_last_eval_key, use it to continue querying
                # This allows us to continue querying the source even when we have items in memory
                initial_source_last_eval_key = last_evaluated_key.get('source_last_eval_key')
                # Store total matching items count from previous request
                total_matching_items_from_previous = last_evaluated_key.get('total_matching_items')
                # For union_politician queries, extract separate tokens
                initial_sponsor_last_key = last_evaluated_key.get('sponsor_last_key')
                initial_cosponsor_last_key = last_evaluated_key.get('cosponsor_last_key')
                logger.info(f"Multi-GSI intersection: applying offset {offset} to skip first {offset} items, source_last_eval_key: {initial_source_last_eval_key is not None}, total_matching_items: {total_matching_items_from_previous}")
                if initial_sponsor_last_key or initial_cosponsor_last_key:
                    logger.info(f"Union politician tokens: sponsor={initial_sponsor_last_key is not None}, cosponsor={initial_cosponsor_last_key is not None}")
            elif last_evaluated_key.get('query_type') == 'union_politician_pagination':
                # Direct union_politician pagination token (when not using offset)
                initial_source_last_eval_key = last_evaluated_key  # Store the whole token
                initial_sponsor_last_key = last_evaluated_key.get('sponsor_last_key')
                initial_cosponsor_last_key = last_evaluated_key.get('cosponsor_last_key')
                logger.info(f"Union politician pagination: sponsor={initial_sponsor_last_key is not None}, cosponsor={initial_cosponsor_last_key is not None}")
        
        # Don't do early return check - we'll fetch the whole batch, apply filters, then apply offset
        # This ensures we follow the correct order: fetch -> filter -> paginate
        
        # Paginate through source GSI until we have enough results or it runs out
        all_matching_items = []
        # Use initial_source_last_eval_key if provided (from offset token), otherwise start fresh
        # For union_politician queries, we may have separate tokens from the offset token or directly
        # If re_query_from_beginning is True, start from None to re-query from the beginning
        source_last_eval_key = None if re_query_from_beginning else initial_source_last_eval_key
        # If initial_source_last_eval_key is a union_politician_pagination token, extract the separate tokens
        # (This handles the case where the token comes directly, not from an offset token)
        if isinstance(initial_source_last_eval_key, dict) and initial_source_last_eval_key.get('query_type') == 'union_politician_pagination':
            # Override the separate tokens if they weren't already set from offset token
            if initial_sponsor_last_key is None:
                initial_sponsor_last_key = initial_source_last_eval_key.get('sponsor_last_key')
            if initial_cosponsor_last_key is None:
                initial_cosponsor_last_key = initial_source_last_eval_key.get('cosponsor_last_key')
            logger.info(f"Extracted union politician tokens from source_last_eval_key: sponsor={initial_sponsor_last_key is not None}, cosponsor={initial_cosponsor_last_key is not None}")
        max_pagination_rounds = 50
        pagination_round = 0
        
        # CRITICAL FIX: If source is exhausted (initial_source_last_eval_key is None) and we have an offset,
        # we need to re-query from the beginning to collect items again, then apply the offset.
        # This is necessary because we can't store items between Lambda invocations.
        # We'll re-query the source GSI from the beginning (no pagination key) to rebuild the collection.
        should_query_source = True
        if initial_source_last_eval_key is None and offset > 0:
            # Source is exhausted and we have an offset - we need to re-query from the beginning
            # to collect items again, then apply the offset to get the right items.
            # This is safe because we know the source is exhausted (no more items), so we'll get
            # the same items as before, which is what we need to apply the offset correctly.
            should_query_source = True
            re_query_from_beginning = True
            logger.info(f"Source exhausted with offset {offset} - re-querying from beginning to collect items for offset application")
        
        # Paginate through source GSI until we have enough results or it runs out
        all_matching_items = []
        # Use initial_source_last_eval_key if provided (from offset token), otherwise start fresh
        # For union_politician queries, we may have separate tokens from the offset token or directly
        # If re_query_from_beginning is True, start from None to re-query from the beginning
        source_last_eval_key = None if re_query_from_beginning else initial_source_last_eval_key
        # If initial_source_last_eval_key is a union_politician_pagination token, extract the separate tokens
        # (This handles the case where the token comes directly, not from an offset token)
        if isinstance(initial_source_last_eval_key, dict) and initial_source_last_eval_key.get('query_type') == 'union_politician_pagination':
            # Override the separate tokens if they weren't already set from offset token
            if initial_sponsor_last_key is None:
                initial_sponsor_last_key = initial_source_last_eval_key.get('sponsor_last_key')
            if initial_cosponsor_last_key is None:
                initial_cosponsor_last_key = initial_source_last_eval_key.get('cosponsor_last_key')
            logger.info(f"Extracted union politician tokens from source_last_eval_key: sponsor={initial_sponsor_last_key is not None}, cosponsor={initial_cosponsor_last_key is not None}")
        max_pagination_rounds = 50
        pagination_round = 0
        
        # For multi-GSI intersection, fetch all items from source GSI first, then filter, then apply offset
        # This ensures we follow the correct order: fetch -> filter -> paginate
        # We'll fetch all items (or up to 3000) in one go, then filter them, then apply offset
        while should_query_source and pagination_round < max_pagination_rounds:
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
                                bill_ids_batch, sponsor_last_key, _ = query_gsi_for_bill_ids(
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
                        bill_ids_batch, sponsor_last_key, _ = query_gsi_for_bill_ids(
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
                # CRITICAL: Maintain separate pagination tokens for each query
                union_configs = source_config['union_configs']
                all_bill_ids_batch = set()
                
                # Determine how many bill_ids to fetch from each query
                # Target: fetch enough to get (offset + limit) filtered items
                # Strategy: fetch batch_size/2 from each, then fetch more from the one that has more if needed
                target_bill_ids_per_query = max(limit, (offset + limit) // 2)  # At least limit/2 from each
                
                sponsor_bill_ids = []
                cosponsor_bill_ids = []
                sponsor_last_key = initial_sponsor_last_key if initial_sponsor_last_key is not None else source_last_eval_key
                cosponsor_last_key = initial_cosponsor_last_key if initial_cosponsor_last_key is not None else source_last_eval_key
                
                # Track which queries are exhausted
                sponsor_exhausted = False
                cosponsor_exhausted = False
                
                # Fetch from sponsor GSI
                sponsor_config = None
                for union_config in union_configs:
                    if union_config.get('query_type') != 'search_index' and union_config.get('index_name'):
                        sponsor_config = union_config
                        break
                
                if sponsor_config:
                    try:
                        bill_ids_batch, sponsor_last_key, _ = query_gsi_for_bill_ids(
                            index_name=sponsor_config['index_name'],
                            hash_key_name=sponsor_config['hash_key'],
                            hash_key_value=sponsor_config['hash_value'],
                            range_key_name=sponsor_config.get('range_key'),
                            range_key_value=sponsor_config.get('range_value'),
                            range_key_condition=sponsor_config.get('range_condition'),
                            limit=target_bill_ids_per_query,
                            exclusive_start_key=sponsor_last_key,
                            get_all=False
                        )
                        sponsor_bill_ids = bill_ids_batch
                        if not sponsor_last_key:
                            sponsor_exhausted = True
                        logger.info(f"Union politician: fetched {len(sponsor_bill_ids)} bill_ids from sponsor GSI (exhausted: {sponsor_exhausted})")
                    except Exception as e:
                        logger.warning(f"Error querying sponsor GSI: {e}")
                        sponsor_exhausted = True
                
                # Fetch from cosponsor search index
                cosponsor_config = None
                for union_config in union_configs:
                    if union_config.get('query_type') == 'search_index':
                        cosponsor_config = union_config
                        break
                
                if cosponsor_config:
                    try:
                        bill_ids_batch, cosponsor_last_key = query_cosponsor_search_index(
                            cosponsor_name=cosponsor_config['search_value'],
                            limit=target_bill_ids_per_query,
                            exclusive_start_key=cosponsor_last_key,
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        cosponsor_bill_ids = bill_ids_batch
                        if not cosponsor_last_key:
                            cosponsor_exhausted = True
                        logger.info(f"Union politician: fetched {len(cosponsor_bill_ids)} bill_ids from cosponsor search index (exhausted: {cosponsor_exhausted})")
                    except Exception as e:
                        logger.warning(f"Error querying cosponsor search index: {e}")
                        cosponsor_exhausted = True
                
                # Union the results
                all_bill_ids_batch.update(sponsor_bill_ids)
                all_bill_ids_batch.update(cosponsor_bill_ids)
                
                # If one query is exhausted and we need more results, fetch more from the other
                total_fetched = len(all_bill_ids_batch)
                min_needed = offset + limit
                additional_needed = max(0, min_needed - total_fetched)
                
                if additional_needed > 0:
                    if sponsor_exhausted and not cosponsor_exhausted:
                        # Fetch more from cosponsor
                        logger.info(f"Sponsor exhausted, fetching {additional_needed} more from cosponsor")
                        more_bill_ids, cosponsor_last_key = query_cosponsor_search_index(
                            cosponsor_name=cosponsor_config['search_value'],
                            limit=additional_needed,
                            exclusive_start_key=cosponsor_last_key,
                            date_from=filters.get('introduced_date_from'),
                            date_to=filters.get('introduced_date_to')
                        )
                        all_bill_ids_batch.update(more_bill_ids)
                        if not cosponsor_last_key:
                            cosponsor_exhausted = True
                        logger.info(f"Fetched {len(more_bill_ids)} additional bill_ids from cosponsor")
                    elif cosponsor_exhausted and not sponsor_exhausted:
                        # Fetch more from sponsor
                        logger.info(f"Cosponsor exhausted, fetching {additional_needed} more from sponsor")
                        more_bill_ids, sponsor_last_key, _ = query_gsi_for_bill_ids(
                            index_name=sponsor_config['index_name'],
                            hash_key_name=sponsor_config['hash_key'],
                            hash_key_value=sponsor_config['hash_value'],
                            range_key_name=sponsor_config.get('range_key'),
                            range_key_value=sponsor_config.get('range_value'),
                            range_key_condition=sponsor_config.get('range_condition'),
                            limit=additional_needed,
                            exclusive_start_key=sponsor_last_key,
                            get_all=False
                        )
                        all_bill_ids_batch.update(more_bill_ids)
                        if not sponsor_last_key:
                            sponsor_exhausted = True
                        logger.info(f"Fetched {len(more_bill_ids)} additional bill_ids from sponsor")
                
                source_bill_ids_batch = list(all_bill_ids_batch)
                
                # Store both tokens separately for next pagination
                # If both are exhausted, new_last_eval_key is None
                # Otherwise, we'll create a union_politician_pagination token
                if sponsor_exhausted and cosponsor_exhausted:
                    new_last_eval_key = None
                else:
                    # Create a composite token that stores both keys
                    new_last_eval_key = {
                        'query_type': 'union_politician_pagination',
                        'sponsor_last_key': sponsor_last_key if not sponsor_exhausted else None,
                        'cosponsor_last_key': cosponsor_last_key if not cosponsor_exhausted else None,
                        'politician_name': source_config.get('politician_name'),
                        'union_configs': union_configs  # Store configs for reconstruction
                    }
                logger.info(f"Union politician pagination: {len(source_bill_ids_batch)} total bill_ids, sponsor_exhausted={sponsor_exhausted}, cosponsor_exhausted={cosponsor_exhausted}")
            elif source_config.get('query_type') == 'search_index':
                # Use search index query for cosponsors
                # For date ranges, we need to continue querying more days until we have enough filtered results
                # or exhaust the date range. Don't fetch all bill_ids upfront - fetch in batches and filter as we go.
                all_source_bill_ids = []
                current_search_key = source_last_eval_key
                max_search_iterations = 50  # Limit iterations to avoid infinite loops
                search_iteration = 0
                
                # For date ranges, we need to continue querying until we have enough filtered results
                # For non-date-range queries, fetch up to limit * 10 to account for filtering
                target_bill_ids = limit * 10 if not (filters.get('introduced_date_from') and filters.get('introduced_date_to')) else limit * 20
                
                while len(all_source_bill_ids) < target_bill_ids and search_iteration < max_search_iterations:
                    search_iteration += 1
                    batch_limit = min(1000, target_bill_ids - len(all_source_bill_ids))
                    batch_bill_ids, current_search_key = query_cosponsor_search_index(
                        cosponsor_name=source_config['search_value'],
                        limit=batch_limit,
                        exclusive_start_key=current_search_key,
                        date_from=filters.get('introduced_date_from'),
                        date_to=filters.get('introduced_date_to')
                    )
                    
                    if not batch_bill_ids:
                        break
                    
                    all_source_bill_ids.extend(batch_bill_ids)
                    logger.info(f"Search index pagination iteration {search_iteration}: fetched {len(batch_bill_ids)} bill IDs (total: {len(all_source_bill_ids)})")
                    
                    if not current_search_key:
                        # No more items in search index (or no more days in date range)
                        break
                
                source_bill_ids_batch = all_source_bill_ids
                new_last_eval_key = current_search_key
                logger.info(f"Search index pagination complete: {len(source_bill_ids_batch)} total bill IDs, has_more: {new_last_eval_key is not None}")
            else:
                # Use GSI query
                # For multi-GSI intersection, fetch all items from source GSI first, then filter, then apply offset
                # This ensures we follow the correct order: fetch -> filter -> paginate
                # Prepare range key value (handles BETWEEN condition)
                range_key_value, range_key_condition = prepare_range_key_value_for_query(source_config)
                
                # If re-querying from beginning (source exhausted with offset), fetch all items
                # Otherwise, if we have a pagination key, continue from where we left off
                # Use get_all=True to fetch all items from the source GSI (up to 3000)
                source_bill_ids_batch, new_last_eval_key, _ = query_gsi_for_bill_ids(
                    index_name=source_config['index_name'],
                    hash_key_name=source_config['hash_key'],
                    hash_key_value=source_config['hash_value'],
                    range_key_name=source_config.get('range_key'),
                    range_key_value=range_key_value,
                    range_key_condition=range_key_condition,
                    limit=3000,  # Fetch large batch
                    exclusive_start_key=source_last_eval_key,
                    get_all=True  # Fetch all items from source GSI
                )
            source_last_eval_key = new_last_eval_key
            
            # If we're using cosponsor intersection, intersect the new batch with cosponsor results
            if use_cosponsor_intersection and all_cosponsor_bill_ids is not None:
                original_count = len(source_bill_ids_batch)
                source_bill_ids_batch = list(set(source_bill_ids_batch) & all_cosponsor_bill_ids)
                logger.info(f"Intersected source batch with cosponsor results: {original_count} → {len(source_bill_ids_batch)} bill_ids")
            
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
            
            # CRITICAL: Fetch FULL bill items from the table using BatchGetItem
            # We query GSIs (KEYS_ONLY projection) to get bill_ids, then fetch complete bill data from the table
            # Never return GSI projection results - always fetch full items
            items_batch = []
            if source_bill_ids_batch:
                batch_size = limit  # Use limit (page size) for batch size
                logger.info(f"Fetching FULL bill items from table for {len(source_bill_ids_batch)} bill_ids (not returning GSI projection)")
                for i in range(0, len(source_bill_ids_batch), batch_size):
                    batch_ids = source_bill_ids_batch[i:i + batch_size]
                    # Deduplicate batch_ids to avoid ValidationException for duplicate keys
                    batch_ids = list(dict.fromkeys(batch_ids))  # Preserves order while removing duplicates
                    
                    dynamodb_client = boto3.client('dynamodb')
                    # Include both bill_id (hash key) and search_index_sk (range key)
                    # For regular bill items, search_index_sk = bill_id
                    # This fetches FULL items from the table, not just GSI projection
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
                        # Filter out search index items
                        if not is_search_index_item(converted_item):
                            items_batch.append(converted_item)
                
                logger.info(f"Fetched {len(items_batch)} FULL bill items from table (not GSI projection)")
            
            # Apply remaining filters in Python
            for item in items_batch:
                if apply_python_filter(item, remaining_filters):
                    all_matching_items.append(item)
            
            logger.info(f"Pagination round {pagination_round}: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
            
            # For multi-GSI intersection, we fetch all items from source GSI first (get_all=True)
            # Then we'll filter them and apply offset. So we stop when source is exhausted.
            if not source_last_eval_key:
                # Source query ran out of items - we've fetched all items
                logger.info(f"Source GSI exhausted - fetched all items, will filter and apply offset")
                break
            # For regular GSI queries (not get_all), we might continue paginating
            # But for multi-GSI intersection with get_all=True, we fetch all in one go
            # So we only need one pagination round for regular GSI queries
            if pagination_round >= 1 and source_config.get('index_name') and not source_config.get('query_type'):
                # We've fetched all items (or up to 3000), now filter and apply offset
                break
        
        # Use the collected items directly, applying offset if needed
        # OPTIMIZATION: If source is exhausted and we have all matching items in memory,
        # return all remaining items (after offset) instead of limiting to `limit`.
        # This saves compute by avoiding unnecessary pagination when we already have everything.
        if offset > 0 and initial_source_last_eval_key is not None and not re_query_from_beginning:
            # Source is NOT exhausted and we have an offset - we're continuing from where we left off
            # The new items we collected are items we haven't returned yet, so return them directly (up to limit)
            # Don't apply offset because these are new items, not items we've already seen
            items = all_matching_items[:limit]
            logger.info(f"Continuing query with offset {offset} - returning {len(items)} new items (not applying offset to new batch)")
        elif re_query_from_beginning or (initial_source_last_eval_key is None and offset > 0):
            # Source is exhausted and we re-queried from beginning, or source was exhausted with offset
            # We have all matching items in memory - return all remaining items (after offset) instead of limiting
            # This saves compute by avoiding unnecessary pagination
            items = all_matching_items[offset:]  # Return all remaining items, not just up to limit
            logger.info(f"Source exhausted - returning all {len(items)} remaining items after offset {offset} (total: {len(all_matching_items)} items)")
        else:
            # No offset, first request - apply offset and limit normally
            items = all_matching_items[offset:offset + limit]
        
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
            # Filter out search index items
            if is_search_index_item(bill):
                continue
            
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
        
        # Determine if there are more results
        # If source is exhausted and we returned all remaining items, there are no more results
        # Otherwise, we have more if: (1) there are more items in all_matching_items than returned, OR (2) source query has more items
        if re_query_from_beginning or (initial_source_last_eval_key is None and offset > 0):
            # Source is exhausted and we returned all remaining items - no more results
            has_more = False
            has_more_items = False
            has_more_source = False
        else:
            has_more_items = len(all_matching_items) > len(enriched_results)
            has_more_source = source_last_eval_key is not None
            has_more = has_more_items or has_more_source
        
        # Convert last_evaluated_key to JSON-serializable format
        serializable_last_key = None
        if has_more:
            # CRITICAL FIX: Priority should be:
            # 1. If we have more items in memory (has_more_items), use offset-based pagination FIRST
            #    This prevents re-querying and returning duplicate items
            # 2. If source has more items but we don't have items in memory, continue querying source
            # This ensures we return all items in memory before querying for more
            if has_more_items:
                # We have more items in memory - use offset-based pagination to return them
                # Store the source_last_eval_key so we can continue querying after exhausting items in memory
                serializable_last_key = {
                    'query_type': 'multi_gsi_intersection_offset',
                    'offset': offset + len(enriched_results),  # Total offset (previous offset + new items returned)
                    'source_config': source_config,
                    'query_configs': query_configs,
                    'source_last_eval_key': source_last_eval_key,  # Store current source token (may be None if exhausted)
                    'total_matching_items': len(all_matching_items)  # Store total count for offset validation
                }
                logger.info(f"Using offset-based pagination: {len(enriched_results)} items returned, {len(all_matching_items)} total in memory, offset: {offset + len(enriched_results)}")
            elif has_more_source:
                # Source query has more items but no items in memory - use the source pagination token
                # This allows continuing to query more items from the source
                try:
                    if isinstance(source_last_eval_key, dict):
                        # Already a dict (e.g., cosponsor_date_range token, union_politician_pagination token), use as-is
                        serializable_last_key = source_last_eval_key
                        if source_last_eval_key.get('query_type') == 'union_politician_pagination':
                            logger.info(f"Using union politician pagination token: sponsor={source_last_eval_key.get('sponsor_last_key') is not None}, cosponsor={source_last_eval_key.get('cosponsor_last_key') is not None}")
                    else:
                        serializable_last_key = convert_decimal_to_float(source_last_eval_key)
                except Exception as e:
                    logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                    serializable_last_key = None
                logger.info(f"Using source pagination token: continuing to query source GSI")
        
        logger.info(f"Multi-GSI intersection pagination: {len(enriched_results)} items returned, {len(all_matching_items)} total matching items, has_more_items: {has_more_items}, has_more_source: {has_more_source}, has_more: {has_more}")
        
        # Return results for multi-GSI intersection
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,
            'method': method,
            'index_used': index_name
        }
    
    # Fall back to single GSI query or scan
    # If no queryable filters, use table scan to return first page
    if not query_configs:
        logger.info("No queryable filters found, using table scan to return requested amount")
        
        # Build base filter expression
        filter_expr = Attr('is_search_index').not_exists()  # Exclude search index items
        
        # Add date range filters if present
        if filters.get('introduced_date_from') or filters.get('introduced_date_to'):
            introduced_date_from = filters.get('introduced_date_from')
            introduced_date_to = filters.get('introduced_date_to')
            if introduced_date_from and introduced_date_to:
                filter_expr = filter_expr & Attr('introduced_date').between(introduced_date_from, introduced_date_to)
            elif introduced_date_from:
                filter_expr = filter_expr & Attr('introduced_date').gte(introduced_date_from)
            elif introduced_date_to:
                filter_expr = filter_expr & Attr('introduced_date').lte(introduced_date_to)
        
        if filters.get('latest_action_date_from') or filters.get('latest_action_date_to'):
            latest_action_date_from = filters.get('latest_action_date_from')
            latest_action_date_to = filters.get('latest_action_date_to')
            if latest_action_date_from and latest_action_date_to:
                filter_expr = filter_expr & Attr('latest_action_date').between(latest_action_date_from, latest_action_date_to)
            elif latest_action_date_from:
                filter_expr = filter_expr & Attr('latest_action_date').gte(latest_action_date_from)
            elif latest_action_date_to:
                filter_expr = filter_expr & Attr('latest_action_date').lte(latest_action_date_to)
        
        # Build scan parameters
        scan_limit = max(limit * 5, 500)  # Scan more items to account for potential filtering
        params = {
            'Limit': scan_limit,
            'FilterExpression': filter_expr
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
        
        logger.info(f"Scanning bills table with Limit={scan_limit} (result limit={limit}) to find {limit} filtered items")
        
        # Continue scanning until we have enough filtered items or exhaust the table
        all_filtered_items = []
        last_eval_key = None
        max_scan_iterations = 20  # Limit iterations to avoid infinite loops
        scan_iteration = 0
        
        while len(all_filtered_items) < limit and scan_iteration < max_scan_iterations:
            scan_iteration += 1
            response = bills_table.scan(**params)
            
            # Extract items from scan
            scanned_items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
            scanned_count = response.get('ScannedCount', 0)
            
            logger.info(f"Scan iteration {scan_iteration}: found {len(scanned_items)} items (scanned {scanned_count} total), have {len(all_filtered_items)} filtered items so far (need {limit})")
            
            # Apply any remaining filters in Python
            filtered_items = [item for item in scanned_items if apply_python_filter(item, filters)]
            all_filtered_items.extend(filtered_items)
            
            # Stop if we have enough filtered items or no more items to scan
            if len(all_filtered_items) >= limit or not last_eval_key:
                break
            
            # Continue scanning from where we left off
            params['ExclusiveStartKey'] = last_eval_key
        
        # Trim to requested limit
        filtered_items = all_filtered_items[:limit]
        
        logger.info(f"Scan complete: found {len(filtered_items)} filtered items after scanning (iteration {scan_iteration})")
        
        # Convert and enrich
        results = [convert_decimal_to_float(item) for item in filtered_items]
        enriched_results = []
        for bill in results:
            # Filter out search index items
            if is_search_index_item(bill):
                continue
            
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
        # Calculate fetch limit - for filtered offset queries, we need to fetch enough IDs to get the required filtered results
        if filtered_offset is not None:
            # For filtered offset pagination, we need enough IDs to get filtered_offset + limit filtered results
            # Since filtering ratio varies, fetch more to be safe
            target_filtered_results = (filtered_offset if filtered_offset > 0 else 0) + limit
            fetch_limit = max(target_filtered_results * 3, 1000)  # 3x safety factor
            logger.info(f"Union all politicians filtered offset: target {target_filtered_results} filtered results, fetching {fetch_limit} IDs")
        else:
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
                        batch_ids, _, _ = query_gsi_for_bill_ids(
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
                batch_ids, _, _ = query_gsi_for_bill_ids(
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
        total_filtered_count = 0  # Initialize for has_more calculation
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
        # Calculate fetch limit - for filtered offset queries, we need to fetch enough IDs to get the required filtered results
        if filtered_offset is not None:
            # For filtered offset pagination, we need enough IDs to get filtered_offset + limit filtered results
            # Since filtering ratio varies, fetch more to be safe
            target_filtered_results = (filtered_offset if filtered_offset > 0 else 0) + limit
            fetch_limit = max(target_filtered_results * 3, 1000)  # 3x safety factor
            logger.info(f"Union politician filtered offset: target {target_filtered_results} filtered results, fetching {fetch_limit} IDs")
        else:
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
                    batch_ids, sponsor_last_key, _ = query_gsi_for_bill_ids(
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
                # Update has_more flag based on actual query result
                # CRITICAL: When re-fetching with union_offset, we should use the CURRENT query result,
                # not preserve the old flag. The old flag might be stale if we're re-fetching from the beginning.
                current_sponsor_has_more = sponsor_last_key is not None
                # Always use the current query result when re-fetching
                sponsor_has_more = current_sponsor_has_more
                logger.info(f"Fetched {len(sponsor_bill_ids)} bill IDs from sponsor GSI (has_more: {sponsor_has_more}, last_key: {sponsor_last_key is not None})")
        
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
        # Continue querying until we have enough filtered results or exhaust the search index
        logger.info(f"Using single cosponsor search index query: {config['search_value']}")
        all_bill_ids = []
        current_last_key = last_evaluated_key
        max_query_iterations = 20  # Limit iterations to avoid infinite loops
        query_iteration = 0
        
        while len(all_bill_ids) < limit * 10 and query_iteration < max_query_iterations:
            query_iteration += 1
            batch_limit = min(1000, (limit * 10) - len(all_bill_ids))
            batch_bill_ids, current_last_key = query_cosponsor_search_index(
                cosponsor_name=config['search_value'],
                limit=batch_limit,
                exclusive_start_key=current_last_key,
                date_from=filters.get('introduced_date_from'),
                date_to=filters.get('introduced_date_to')
            )
            
            if not batch_bill_ids:
                break
            
            all_bill_ids.extend(batch_bill_ids)
            logger.info(f"Search index query iteration {query_iteration}: fetched {len(batch_bill_ids)} bill IDs (total: {len(all_bill_ids)})")
            
            if not current_last_key:
                # No more items in search index
                break
        
        bill_ids = all_bill_ids
        last_eval_key = current_last_key
        index_name = f"SearchIndex({config['search_type']})"
        logger.info(f"Search index query complete: {len(bill_ids)} total bill IDs, has_more: {last_eval_key is not None}")
    else:
        # Use GSI query
        # SIMPLIFIED: For single GSI queries, fetch entire batch (up to 3000) and filter
        # This avoids complex internal pagination logic
        logger.info(f"Using single GSI query: {config['index_name']}")
        
        # For single GSI queries, check if we're continuing from an offset-based pagination
        single_gsi_offset = None
        if last_evaluated_key and isinstance(last_evaluated_key, dict) and last_evaluated_key.get('query_type') == 'single_gsi_offset':
            single_gsi_offset = last_evaluated_key.get('offset', 0)
            logger.info(f"Single GSI query: continuing from offset {single_gsi_offset}")
        
        # For single GSI queries, fetch a large batch (up to 3000) to get all results
        # Then filter and return up to 300 items per page
        max_batch_size = 3000
        bill_ids, last_eval_key, bill_id_to_gsi_item = query_gsi_for_bill_ids(
            index_name=config['index_name'],
            hash_key_name=config['hash_key'],
            hash_key_value=config['hash_value'],
            range_key_name=config.get('range_key'),
            range_key_value=config.get('range_value'),
            range_key_condition=config.get('range_condition'),
            limit=max_batch_size,  # Fetch large batch
            exclusive_start_key=None,  # Always start from beginning for single GSI queries
            get_all=True  # Get all items up to limit
        )
        index_name = config['index_name']
        # Track GSI items for pagination key creation
        # This mapping allows us to create pagination keys from the last returned item
        logger.info(f"Single GSI query fetched {len(bill_ids)} bill IDs (has_more: {last_eval_key is not None})")
    
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
                # Deduplicate batch_ids to avoid ValidationException for duplicate keys
                batch_ids = list(dict.fromkeys(batch_ids))  # Preserves order while removing duplicates
                
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
                    # Filter out search index items
                    if is_search_index_item(converted_item):
                        continue
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
            
            # Check if this is a filtered_offset continuation (we have all results, just need to slice)
            if filtered_offset is not None and filtered_offset_metadata:
                logger.info(f"Union politician filtered offset: re-processing all IDs and slicing from offset {filtered_offset}")
            
            # Fetch and filter items in batches - process ALL IDs to get accurate filtered count
            # Then return up to limit, but correctly track if there are more IDs to process
            i = 0
            filtered_count = 0
            all_filtered_items = []  # Store all filtered items, then slice to limit
            
            while i < len(bill_ids):
                batch_ids = bill_ids[i:i + batch_size]
                # Deduplicate batch_ids to avoid ValidationException for duplicate keys
                batch_ids = list(dict.fromkeys(batch_ids))  # Preserves order while removing duplicates
                
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
                    # Filter out search index items
                    if is_search_index_item(converted_item):
                        continue
                    if apply_python_filter(converted_item, remaining_filters_for_fetch):
                        all_filtered_items.append(converted_item)
                        filtered_count += 1
                
                # Update last_processed_index to track how many IDs we've processed
                last_processed_index = start_index + i + len(batch_ids)
                
                i += batch_size
                
                logger.info(f"Union politician pagination: processed {i} IDs, {filtered_count} filtered items so far")
            
            # Handle filtered offset pagination - slice from the complete filtered results
            if filtered_offset is not None and filtered_offset > 0:
                logger.info(f"Union politician filtered offset processing: filtered_offset={filtered_offset}, limit={limit}, is_restoration={is_restoration}, total_filtered={len(all_filtered_items)}")
                # Always slice from offset, regardless of restoration or continuation
                # The difference is only in how we calculate the next offset
                items = all_filtered_items[filtered_offset:filtered_offset + limit]
                logger.info(f"Union politician filtered offset: sliced {len(items)} items from offset {filtered_offset} (total filtered: {len(all_filtered_items)})")
            else:
                # Return up to limit items from the beginning
                items = all_filtered_items[:limit]
            
            # Store total filtered count for has_more calculation
            total_filtered_count = len(all_filtered_items)
            logger.info(f"Union politician: processed all {len(bill_ids)} IDs, got {total_filtered_count} filtered items, returning {len(items)} items (limit: {limit})")
        else:
            # For single queries (including search_index), fetch items and filter
            remaining_filters_for_fetch = filters.copy()
            if config.get('query_type') == 'search_index':
                # For search_index queries, remove politician_name and politician_role since they're handled by the search index
                if 'politician_name' in remaining_filters_for_fetch:
                    del remaining_filters_for_fetch['politician_name']
                if 'sponsor_name' in remaining_filters_for_fetch:
                    del remaining_filters_for_fetch['sponsor_name']
                if 'politician_role' in remaining_filters_for_fetch:
                    del remaining_filters_for_fetch['politician_role']
            elif config.get('filter_key') in remaining_filters_for_fetch:
                # Remove the filter that was used in the query
                if isinstance(remaining_filters_for_fetch[config['filter_key']], list):
                    remaining_filters_for_fetch[config['filter_key']] = remaining_filters_for_fetch[config['filter_key']][1:]
                    if not remaining_filters_for_fetch[config['filter_key']]:
                        del remaining_filters_for_fetch[config['filter_key']]
                else:
                    del remaining_filters_for_fetch[config['filter_key']]
            
            # SIMPLIFIED: For single GSI queries, fetch all items at once, filter, and return up to limit
            # This avoids complex internal pagination logic
            if config.get('query_type') != 'search_index' and config.get('index_name'):
                # Single GSI query - fetch all items, filter, return up to limit
                # CRITICAL: We query GSIs (KEYS_ONLY projection) to get bill_ids, then fetch FULL bill data from the table
                # Never return GSI projection results - always fetch full items
                logger.info(f"Single GSI query: fetching FULL bill items from table for {len(bill_ids)} bill_ids (not returning GSI projection)")
                
                # Fetch all items in batches using BatchGetItem to get FULL bill data
                batch_size = 100
                all_fetched_items = []
                for i in range(0, len(bill_ids), batch_size):
                    batch_ids = bill_ids[i:i + batch_size]
                    batch_ids = list(dict.fromkeys(batch_ids))  # Deduplicate
                    
                    if not batch_ids:
                        break
                    
                    dynamodb_client = boto3.client('dynamodb')
                    # This fetches FULL items from the table, not just GSI projection
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
                    
                    for item in batch_items:
                        converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                        if not is_search_index_item(converted_item):
                            all_fetched_items.append(converted_item)
                
                logger.info(f"Single GSI query: fetched {len(all_fetched_items)} FULL bill items from table (not GSI projection)")
                
                # Filter all items
                filtered_items = [item for item in all_fetched_items if apply_python_filter(item, remaining_filters_for_fetch)]
                total_filtered_count = len(filtered_items)  # Store total before applying offset
                logger.info(f"Single GSI query: fetched {len(all_fetched_items)} items, filtered to {total_filtered_count} items")
                
                # Apply offset if continuing from a previous request
                if single_gsi_offset is not None and single_gsi_offset > 0:
                    filtered_items = filtered_items[single_gsi_offset:]
                    logger.info(f"Single GSI query: applied offset {single_gsi_offset}, {len(filtered_items)} items remaining (total filtered: {total_filtered_count})")
                
                # Return up to limit
                items = filtered_items[:limit]
                filtered_count = len(items)
                processed_bill_ids = len(bill_ids)  # Mark all as processed
                
                # Skip all the complex internal pagination logic for single GSI queries
                # We've already fetched and filtered all items
            else:
                # For search_index queries, use the existing complex logic
                # Fetch items in batches and filter as we go
                filtered_count = 0
                processed_bill_ids = 0
                current_bill_ids = bill_ids.copy()
                # For search_index queries, track the pagination key separately
                # Initialize with the last_eval_key from the initial query
                current_search_last_key = last_eval_key if config.get('query_type') == 'search_index' else None
                if config.get('query_type') == 'search_index':
                    logger.info(f"Search index: starting with {len(current_bill_ids)} bill IDs, last_key: {current_search_last_key is not None}")
                
                while filtered_count < limit and processed_bill_ids < len(current_bill_ids):
                    # Fetch next batch of items
                    batch_start = processed_bill_ids
                    batch_end = min(processed_bill_ids + batch_size, len(current_bill_ids))
                    batch_ids = current_bill_ids[batch_start:batch_end]
                    batch_ids = list(dict.fromkeys(batch_ids))  # Deduplicate
                    
                    if not batch_ids:
                        break
                    
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
                    
                    for item in batch_items:
                        converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                        if not is_search_index_item(converted_item):
                            if apply_python_filter(converted_item, remaining_filters_for_fetch):
                                items.append(converted_item)
                                filtered_count += 1
                                if filtered_count >= limit:
                                    break
                    
                    processed_bill_ids = batch_end
                    
                    # If we have enough filtered items, stop
                    if filtered_count >= limit:
                        break
                    
                    # If we've processed all current bill_ids and don't have enough results,
                    # continue querying more bill_ids from the GSI/search index
                    if processed_bill_ids >= len(current_bill_ids) and filtered_count < limit:
                        if config.get('query_type') == 'search_index':
                            # For search_index queries, continue querying more bill_ids
                            if current_search_last_key:
                                logger.info(f"Search index: need more results ({filtered_count}/{limit}), querying more bill_ids...")
                                more_bill_ids, current_search_last_key = query_cosponsor_search_index(
                                cosponsor_name=config['search_value'],
                                limit=1000,
                                exclusive_start_key=current_search_last_key,
                                date_from=filters.get('introduced_date_from'),
                                date_to=filters.get('introduced_date_to')
                            )
                                if more_bill_ids:
                                    current_bill_ids.extend(more_bill_ids)
                                    logger.info(f"Search index: fetched {len(more_bill_ids)} more bill IDs (total: {len(current_bill_ids)})")
                                else:
                                    # No more items in search index
                                    current_search_last_key = None
                                    break
                            else:
                                # No more items in search index
                                break
                    elif last_eval_key:
                        # For regular GSI queries, continue querying more bill_ids if we have a last_eval_key
                        # NOTE: This should not happen for single GSI queries (they fetch all upfront)
                        # This is only for search_index queries that need more results
                        # CRITICAL: Continue internal pagination until we have enough filtered items or GSI is exhausted
                        # This ensures we don't stop early when filtering reduces the number of results
                        logger.info(f"GSI query: need more results ({filtered_count}/{limit}), querying more bill_ids from {config.get('index_name')}...")
                        
                        # Continue querying in batches until we have enough or GSI is exhausted
                        max_internal_pagination_rounds = 50  # Prevent infinite loops
                        internal_round = 0
                        current_internal_last_key = last_eval_key
                        
                        while filtered_count < limit and internal_round < max_internal_pagination_rounds:
                            internal_round += 1
                            
                            if not current_internal_last_key:
                                logger.info(f"GSI query: no more items in GSI after {internal_round} internal pagination rounds")
                                break
                            
                            more_bill_ids, new_last_eval_key, more_bill_id_to_gsi_item = query_gsi_for_bill_ids(
                                index_name=config['index_name'],
                                hash_key_name=config['hash_key'],
                                hash_key_value=config['hash_value'],
                                range_key_name=config.get('range_key'),
                                range_key_value=config.get('range_value'),
                                range_key_condition=config.get('range_condition'),
                                limit=1000,  # Fetch a large batch to reduce round trips
                                exclusive_start_key=current_internal_last_key,
                                get_all=False
                            )
                            
                            if more_bill_ids:
                                current_bill_ids.extend(more_bill_ids)
                                # Merge GSI item mappings for pagination key creation
                                bill_id_to_gsi_item.update(more_bill_id_to_gsi_item)
                                
                                # Fetch and filter the new batch
                                batch_start = len(current_bill_ids) - len(more_bill_ids)
                                batch_end = len(current_bill_ids)
                                batch_ids = current_bill_ids[batch_start:batch_end]
                                batch_ids = list(dict.fromkeys(batch_ids))  # Deduplicate
                                
                                if batch_ids:
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
                                    
                                    for item in batch_items:
                                        converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                                        if not is_search_index_item(converted_item):
                                            if apply_python_filter(converted_item, remaining_filters_for_fetch):
                                                items.append(converted_item)
                                                filtered_count += 1
                                                if filtered_count >= limit:
                                                    break
                                
                                logger.info(f"GSI query internal round {internal_round}: fetched {len(more_bill_ids)} bill IDs, filtered {filtered_count}/{limit} items so far")
                                
                                # Update for next round
                                current_internal_last_key = new_last_eval_key
                                
                                # Stop if we have enough filtered items
                                if filtered_count >= limit:
                                    logger.info(f"GSI query: have enough filtered items ({filtered_count} >= {limit}), stopping internal pagination")
                                    break
                            else:
                                # No more items in GSI
                                logger.info(f"GSI query: no more items in GSI after {internal_round} internal pagination rounds")
                                current_internal_last_key = None
                                break
                        
                        # Update last_eval_key for external pagination (next API request)
                        last_eval_key = current_internal_last_key
                        logger.info(f"GSI query: internal pagination complete, filtered {filtered_count}/{limit} items, has_more: {last_eval_key is not None}")
                        
                        # If we have enough filtered items, we can stop
                        if filtered_count >= limit:
                            break
                    else:
                        # No more items in GSI
                        break
            
            # Update last_eval_key for search_index queries
            if config.get('query_type') == 'search_index':
                # We have more if: (1) we haven't processed all bill_ids, OR (2) the search index has more items
                has_more_bill_ids = processed_bill_ids < len(current_bill_ids)
                has_more_search_index = current_search_last_key is not None
                if has_more_bill_ids or has_more_search_index:
                    # Store the current search index pagination key
                    last_eval_key = current_search_last_key
                else:
                    last_eval_key = None
                logger.info(f"Search index pagination: processed {processed_bill_ids}/{len(current_bill_ids)} bill IDs, filtered {filtered_count} items, has_more: {has_more_bill_ids or has_more_search_index}")
    
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
        # For restoration, items already contains the full set (don't apply limit again)
        # For continuation, items is already sliced correctly
        filtered_items = items  # Already filtered and sliced
        logger.info(f"Union query: using items directly (len={len(filtered_items)}) without additional limit")
    else:
        filtered_items = [item for item in items if apply_python_filter(item, remaining_filters)]
        filtered_items = filtered_items[:limit]
    
    # For union queries, calculate next offset for pagination
    if config.get('query_type') == 'union_all_politicians':
        # For union_all_politicians, check if there are more filtered items than we returned
        # We process all IDs upfront, so we know the total filtered count
        items_returned = len(filtered_items)
        # Check if we have more filtered items than we returned (or if we haven't processed all IDs yet)
        # total_filtered_count is set in the union_all_politicians block above
        has_more_union = (total_filtered_count > items_returned) if 'total_filtered_count' in locals() and total_filtered_count > 0 else (last_processed_index < original_bill_ids_count)
        
        logger.info(f"Union all politicians pagination check - last_processed_index: {last_processed_index}, original_bill_ids_count: {original_bill_ids_count}, total_filtered: {total_filtered_count if 'total_filtered_count' in locals() else 'N/A'}, items_returned: {items_returned}, limit: {limit}, has_more_union: {has_more_union}")
        
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
        
        # CRITICAL FIX: If we've processed all fetched IDs but got fewer items than the limit,
        # we should still check if either source has more items. However, if both sources are exhausted
        # AND we've processed all fetched IDs, then there are no more items.
        # Also, if we got fewer items than the limit AND we've processed all IDs AND both sources are exhausted,
        # we should return has_more=False to prevent infinite pagination loops.
        # IMPORTANT: Check if we have more filtered items than we returned (same as union_all_politicians)
        has_more_union = False
        
        # For filtered_offset pagination, check remaining items from the complete filtered set
        if filtered_offset is not None:
            current_offset = filtered_offset if filtered_offset > 0 else 0
            # For both restoration and continuation: len(items) is the items returned THIS request
            items_returned_this_request = len(items)
            items_returned_so_far = current_offset + items_returned_this_request
            
            logger.info(f"Union politician filtered offset: current_offset={current_offset}, items_returned_this_request={items_returned_this_request}, items_returned_so_far={items_returned_so_far}, total_filtered={total_filtered_count}")
            
            # Check if there are more items in the current filtered batch
            has_more_from_current_batch = items_returned_so_far < total_filtered_count
            
            # Also check if there are more items available from the underlying sources
            has_more_from_sources = cosponsor_has_more or sponsor_has_more
            
            # We have more if either condition is true
            if has_more_from_current_batch or has_more_from_sources:
                has_more_union = True
                logger.info(f"Union politician filtered offset: has_more=True because items_returned_so_far ({items_returned_so_far}) < total_filtered_count ({total_filtered_count}) OR sources_have_more (cosponsor: {cosponsor_has_more}, sponsor: {sponsor_has_more})")
            else:
                logger.info(f"Union politician filtered offset: has_more=False because items_returned_so_far ({items_returned_so_far}) >= total_filtered_count ({total_filtered_count}) AND no_more_sources (cosponsor: {cosponsor_has_more}, sponsor: {sponsor_has_more})")
        else:
            # Standard pagination logic
            # First check: Do we have more filtered items than we returned?
            if 'total_filtered_count' in locals() and total_filtered_count > items_returned:
                has_more_union = True
                logger.info(f"Union politician: has_more=True because total_filtered_count ({total_filtered_count}) > items_returned ({items_returned})")
            # Second check: Have we not processed all fetched IDs yet?
            elif last_processed_index < original_bill_ids_count:
                # We haven't processed all fetched IDs yet
                has_more_union = True
                logger.info(f"Union politician: has_more=True because last_processed_index ({last_processed_index}) < original_bill_ids_count ({original_bill_ids_count})")
            # Third check: Do either source still have more items to fetch?
            elif cosponsor_has_more or sponsor_has_more:
                # One or both sources still have more items to fetch
                has_more_union = True
                logger.info(f"Union politician: has_more=True because cosponsor_has_more ({cosponsor_has_more}) or sponsor_has_more ({sponsor_has_more})")
            else:
                logger.info(f"Union politician: has_more=False because all conditions failed - total_filtered: {total_filtered_count if 'total_filtered_count' in locals() else 'N/A'}, items_returned: {items_returned}, processed: {last_processed_index}/{original_bill_ids_count}, sources_exhausted: {not cosponsor_has_more and not sponsor_has_more}")
        # If we've processed all IDs AND both sources are exhausted AND returned all items, has_more_union stays False
        
        logger.info(f"Union pagination check - last_processed_index: {last_processed_index}, original_bill_ids_count: {original_bill_ids_count}, items_returned: {items_returned}, limit: {limit}, cosponsor_has_more: {cosponsor_has_more}, sponsor_has_more: {sponsor_has_more}, has_more_union: {has_more_union}")
        
        if has_more_union:
            # CRITICAL: For union_politician queries, we need different pagination strategies based on the state
            
            if filtered_offset is not None:
                # For both restoration and continuation: next offset = current offset + items returned
                current_offset = filtered_offset if filtered_offset > 0 else 0
                next_offset = current_offset + len(items)
                
                last_eval_key = {
                    'offset': next_offset,
                    'query_type': 'union_politician_filtered_offset',
                    'total_filtered_count': total_filtered_count,
                    'politician_name': config.get('politician_name'),
                    'politician_role': config.get('role', 'both'),
                }
                logger.info(f"Union politician filtered pagination - next offset: {next_offset} (current {current_offset} + returned {len(items)}), total filtered: {total_filtered_count}")
            elif 'total_filtered_count' in locals() and total_filtered_count > items_returned and last_processed_index >= original_bill_ids_count and not cosponsor_has_more and not sponsor_has_more:
                # Case 1: We processed ALL IDs, have ALL filtered results in memory, but need to return them in pages
                # Use simple offset-based pagination through the complete filtered result set
                next_offset = items_returned  # Next page starts after the items we returned
                last_eval_key = {
                    'offset': next_offset,
                    'query_type': 'union_politician_filtered_offset',  # Special type for filtered result pagination
                    'total_filtered_count': total_filtered_count,
                    'politician_name': config.get('politician_name'),
                    'politician_role': config.get('role', 'both'),
                    # Don't need ID processing metadata since we have all results
                }
                logger.info(f"Union politician filtered pagination (new) - next offset: {next_offset}, total filtered: {total_filtered_count}, returned: {items_returned}")
            else:
                # Case 2: We haven't processed all IDs yet, or sources have more items -> use ID offset pagination
                next_offset = last_processed_index
                last_eval_key = {
                    'offset': next_offset,
                    'query_type': 'union_offset',
                    'total_ids': original_bill_ids_count,
                    'cosponsor_has_more': cosponsor_has_more,
                    'sponsor_has_more': sponsor_has_more,
                    'politician_name': config.get('politician_name'),
                    'politician_role': config.get('role', 'both'),
                    'total_filtered_count': total_filtered_count if 'total_filtered_count' in locals() else None
                }
                logger.info(f"Union politician ID pagination - next offset: {next_offset}, total IDs: {original_bill_ids_count}, processed: {last_processed_index}, sources exhausted: {not cosponsor_has_more and not sponsor_has_more}")
        else:
            last_eval_key = None
            logger.info(f"Union pagination complete - processed all {last_processed_index} of {original_bill_ids_count} fetched IDs, both sources exhausted, no more items available")
    # For non-union queries, last_eval_key is already set from the query above
    
    # Convert and enrich
    results = [convert_decimal_to_float(item) for item in filtered_items]
    enriched_results = []
    for bill in results:
        # Filter out search index items
        if is_search_index_item(bill):
            continue
        
        oversize_s3_key = bill.get('oversize_s3_key')
        if oversize_s3_key:
            full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
            if full_bill:
                bill = convert_decimal_to_float(full_bill)
        enriched_results.append(bill)
    
    # CRITICAL: For GSI queries (non-union, non-search_index), we need to handle pagination carefully.
    # DynamoDB's LastEvaluatedKey points to after the last queried bill_id, not after the last returned item.
    # We need to create a custom pagination key from the last returned item to ensure we continue from exactly
    # where we left off, not from a later position in the GSI.
    #
    # Store the original DynamoDB LastEvaluatedKey
    dynamodb_last_eval_key = last_eval_key
    
    # For single GSI queries that fetched all items upfront, we need to check if we have more filtered items
    # than the limit, and create a pagination key from the last returned item
    if (config.get('index_name') and 
        config.get('query_type') not in ['union_politician', 'union_all_politicians', 'search_index'] and
        len(enriched_results) > 0):
        
        # Check if we have more filtered items than we returned
        # For single GSI queries, filtered_items contains all filtered items
        if 'filtered_items' in locals() and len(filtered_items) > len(enriched_results):
            # We have more items - need to create pagination key from last returned item
            # Set last_eval_key to a placeholder so the pagination key creation logic runs
            if last_eval_key is None:
                # Create a dummy key to trigger pagination key creation
                last_eval_key = {'trigger_custom_key': True}
                logger.info(f"Single GSI query: have {len(filtered_items)} filtered items but only returned {len(enriched_results)}, will create pagination key from last returned item")
    
    # CRITICAL: Always create custom pagination key from last returned item
    # Using DynamoDB's LastEvaluatedKey directly causes the "64 results" issue because:
    # - DynamoDB's LastEvaluatedKey points to after the last QUERIED item (e.g., 1000th item)
    # - But we might only RETURN a subset (e.g., 64 items after filtering or limiting)
    # - This causes us to skip all items between the last returned and last queried
    # 
    # By creating a custom key from the last RETURNED item, we ensure we continue from exactly
    # where we left off, not from a later position in the GSI.
    #
    # For single GSI queries that fetched all items upfront, we need to create a pagination key
    # if we have more filtered items than we returned, even if last_eval_key is None
    should_create_pagination_key = (
        config.get('query_type') not in ['union_politician', 'union_all_politicians', 'search_index'] and
        len(enriched_results) > 0 and
        (
            last_eval_key is not None or  # Normal case: DynamoDB provided a LastEvaluatedKey
            ('filtered_items' in locals() and len(filtered_items) > len(enriched_results))  # Single GSI: have more filtered items
        ) and
        'bill_id_to_gsi_item' in locals() and bill_id_to_gsi_item
    )
    
    if should_create_pagination_key:
        
        # Get the last returned item's bill_id
        last_returned_item = enriched_results[-1]
        last_returned_bill_id = last_returned_item.get('bill_id')
        
        if last_returned_bill_id and last_returned_bill_id in bill_id_to_gsi_item:
            # Get the GSI item for this bill_id - this contains the exact key structure from DynamoDB
            gsi_item = bill_id_to_gsi_item[last_returned_bill_id]
            
            # CRITICAL: Verify the GSI item matches the last returned item
            # This ensures we're using the correct item when multiple bills share the same introduced_date
            gsi_introduced_date = gsi_item.get('introduced_date')
            last_returned_introduced_date = last_returned_item.get('introduced_date')
            if gsi_introduced_date and last_returned_introduced_date:
                if str(gsi_introduced_date) != str(last_returned_introduced_date):
                    logger.warning(f"GSI item has different introduced_date ({gsi_introduced_date} vs {last_returned_introduced_date}) for bill_id {last_returned_bill_id}, using last returned item values")
                    # Use values from last returned item to ensure correctness
                    gsi_item = gsi_item.copy()
                    gsi_item['introduced_date'] = last_returned_introduced_date
            
            logger.info(f"GSI item for bill_id {last_returned_bill_id}: {json.dumps(gsi_item, default=str)}")
            
            # Create pagination key from the GSI item
            # CRITICAL: We use bill_id (unique) as the primary identifier, not introduced_date (not unique)
            # The GSI item from DynamoDB has the correct format and types
            pagination_key = {}
            
            # First, set bill_id as the primary identifier (it's unique, unlike introduced_date)
            # This ensures we continue from exactly the right item even when multiple bills share the same date
            pagination_key['bill_id'] = last_returned_bill_id
            
            # Copy other keys from the GSI item - this ensures we have the exact format DynamoDB expects
            # GSI items from KEYS_ONLY projection contain: hash_key, range_key (if present), and bill_id
            for key, value in gsi_item.items():
                # Skip bill_id since we already set it above (ensures we use the exact value from last_returned_item)
                if key == 'bill_id':
                    continue
                # Convert Decimal to int/float if needed for JSON serialization
                from decimal import Decimal as DecimalType
                if isinstance(value, DecimalType):
                    # For integers, convert to int; for floats, convert to float
                    if value == int(value):
                        pagination_key[key] = int(value)
                    else:
                        pagination_key[key] = float(value)
                else:
                    pagination_key[key] = value
            
            # CRITICAL: If the GSI item doesn't have the hash key or range key, we need to add them
            # This can happen if the GSI projection doesn't include them, but they're required for pagination
            hash_key_name = config.get('hash_key')
            range_key_name = config.get('range_key')
            
            # If range_key is not in config, determine it from the index name
            # Some GSIs always have a range key even if we're not filtering by it
            if not range_key_name:
                index_name = config.get('index_name', '')
                # These GSIs always have introduced_date as range key, even if we're not filtering by date
                # All "*DateIndex" GSIs (except IntroducedDateIndex and LatestActionDateIndex which use date as hash key)
                # have introduced_date as the range key
                gsis_with_date_range_key = [
                    'SponsorPartyDateIndex', 'PolicyAreaDateIndex',
                    'SponsorNameDateIndex', 'BillTitleDateIndex', 'BillTypeDateIndex',
                    'BipartisanDateIndex', 'BillNumberDateIndex'
                ]
                if index_name in gsis_with_date_range_key:
                    range_key_name = 'introduced_date'
                    logger.info(f"Determined range key {range_key_name} from index name {index_name}")
            
            # Add hash key if missing (use value from config)
            if hash_key_name and hash_key_name not in pagination_key:
                hash_key_value = config.get('hash_value')
                if hash_key_value is not None:
                    pagination_key[hash_key_name] = hash_key_value
                    logger.info(f"Added hash key {hash_key_name}={hash_key_value} to pagination key")
            
            # Add range key if missing (get from last returned item or GSI item)
            if range_key_name and range_key_name not in pagination_key:
                # Try to get from last returned item first (full item has all attributes)
                range_value = last_returned_item.get(range_key_name)
                if range_value is None:
                    # Fallback: try to get from GSI item
                    range_value = gsi_item.get(range_key_name)
                
                logger.info(f"Attempting to add range key {range_key_name}: value from last_returned_item={last_returned_item.get(range_key_name)}, from gsi_item={gsi_item.get(range_key_name) if range_key_name in gsi_item else 'N/A'}, final={range_value}")
                
                if range_value is not None:
                    # Convert Decimal to int/float if needed
                    from decimal import Decimal as DecimalType
                    if isinstance(range_value, DecimalType):
                        range_value = int(range_value) if range_value == int(range_value) else float(range_value)
                    pagination_key[range_key_name] = range_value
                    logger.info(f"Added range key {range_key_name}={range_value} to pagination key")
                else:
                    logger.warning(f"Range key {range_key_name} is None in both last_returned_item and gsi_item, cannot add to pagination key")
            elif range_key_name:
                logger.info(f"Range key {range_key_name} already in pagination key: {pagination_key.get(range_key_name)}")
            else:
                logger.info(f"No range key configured for this GSI")
            
            # CRITICAL: Use bill_id as the primary identifier for pagination (it's unique)
            # This ensures we don't skip items when multiple bills share the same introduced_date
            # bill_id is the table's primary hash key, so it's always unique
            pagination_key['bill_id'] = last_returned_bill_id
            
            # CRITICAL: Include search_index_sk (table's range key) - DynamoDB requires this for ExclusiveStartKey
            # For regular bills, search_index_sk = bill_id, which ensures uniqueness
            search_index_sk = last_returned_item.get('search_index_sk')
            if not search_index_sk:
                # Fallback: for regular bills, search_index_sk equals bill_id
                search_index_sk = last_returned_bill_id
            pagination_key['search_index_sk'] = search_index_sk
            
            # Note: We still include introduced_date (GSI range key) because DynamoDB requires it for the GSI query,
            # but bill_id + search_index_sk together provide the unique identifier to ensure we continue from
            # exactly the right position, even when multiple bills share the same introduced_date
            
            if pagination_key:
                # Verify the pagination key has all required components
                has_hash_key = hash_key_name and hash_key_name in pagination_key
                has_range_key = (not range_key_name) or (range_key_name and range_key_name in pagination_key)
                has_bill_id = 'bill_id' in pagination_key
                has_search_index_sk = 'search_index_sk' in pagination_key
                
                if has_hash_key and has_range_key and has_bill_id and has_search_index_sk:
                    logger.info(f"Created custom pagination key from last returned item GSI (bill_id={last_returned_bill_id}): {json.dumps(pagination_key, default=str)}")
                    # Use our custom pagination key instead of DynamoDB's LastEvaluatedKey
                    # This ensures we continue from the last returned item, not from after the last queried item
                    # NOTE: Using DynamoDB's LastEvaluatedKey directly causes the "64 results" issue because
                    # it points to after the last queried item, skipping items between last returned and last queried
                    last_eval_key = pagination_key
                else:
                    logger.warning(f"Pagination key missing required components (hash_key: {has_hash_key}, range_key: {has_range_key}, bill_id: {has_bill_id}, search_index_sk: {has_search_index_sk}), using DynamoDB's LastEvaluatedKey")
                    logger.warning(f"Pagination key contents: {json.dumps(pagination_key, default=str)}")
                    # Fall back to DynamoDB's LastEvaluatedKey if our custom key is invalid
                    # This may cause some items to be skipped, but it's better than an error
                    last_eval_key = dynamodb_last_eval_key
            else:
                logger.warning(f"Could not create pagination key from GSI item (bill_id={last_returned_bill_id}), using DynamoDB's LastEvaluatedKey")
                last_eval_key = dynamodb_last_eval_key
        elif last_returned_bill_id:
            logger.warning(f"Could not find GSI item for last returned bill_id: {last_returned_bill_id}, using DynamoDB's LastEvaluatedKey")
            last_eval_key = dynamodb_last_eval_key
        else:
            logger.warning(f"Could not find bill_id in last returned item, using DynamoDB's LastEvaluatedKey")
            last_eval_key = dynamodb_last_eval_key
    
    # Convert last_evaluated_key to JSON-serializable format
    serializable_last_key = None
    if last_eval_key:
        if isinstance(last_eval_key, dict) and last_eval_key.get('query_type') == 'union_offset':
            # Union offset pagination key is already serializable
            serializable_last_key = last_eval_key
        elif isinstance(last_eval_key, dict) and last_eval_key.get('trigger_custom_key'):
            # This was a placeholder - don't use it, but check if we have more filtered items
            serializable_last_key = None
        else:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                serializable_last_key = None
    
    # For single GSI queries that fetched all items upfront, use offset-based pagination
    # Check if we have more filtered items than we returned
    has_more = serializable_last_key is not None
    if config.get('index_name') and config.get('query_type') not in ['union_politician', 'union_all_politicians', 'search_index']:
        # For single GSI queries, check if we have more filtered items than we returned
        if 'total_filtered_count' in locals() or 'filtered_items' in locals():
            # Use total_filtered_count if available (before offset was applied), otherwise use filtered_items length
            if 'total_filtered_count' in locals():
                total_filtered = total_filtered_count
            else:
                # If offset was applied, we need to add it back
                total_filtered = len(filtered_items) + (single_gsi_offset if single_gsi_offset is not None else 0)
            
            current_offset = single_gsi_offset if single_gsi_offset is not None else 0
            items_returned_so_far = current_offset + len(enriched_results)
            
            if items_returned_so_far < total_filtered:
                has_more = True
                # Create offset-based pagination key
                next_offset = items_returned_so_far
                serializable_last_key = {
                    'query_type': 'single_gsi_offset',
                    'offset': next_offset,
                    'index_name': config['index_name'],
                    'hash_key': config['hash_key'],
                    'hash_value': config['hash_value']
                }
                logger.info(f"Single GSI query: total filtered={total_filtered}, returned so far={items_returned_so_far}, setting has_more=True with offset {next_offset}")
            else:
                has_more = False
                serializable_last_key = None
                logger.info(f"Single GSI query: returned all {items_returned_so_far} of {total_filtered} filtered items, setting has_more=False")
    
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
        # Extract origin from request headers for CORS validation
        headers = event.get('headers', {})
        origin = headers.get('Origin') or headers.get('origin')
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
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
        is_restoration = body.get('is_restoration', False)  # Flag for restoration vs continuation
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 100
        
        # For efficient queries, automatically increase limit to 300 for better pagination
        # This applies to single GSI queries and union politician queries (both fetch efficiently)
        # Check if this will be an efficient query type
        query_configs = identify_queryable_filters(filters)
        is_efficient_query = (
            (len(query_configs) == 1 and query_configs[0].get('index_name')) or  # Single GSI query
            (len(query_configs) == 1 and query_configs[0].get('query_type') in ['union_politician', 'union_all_politicians'])  # Union politician query
        )
        
        if is_efficient_query and limit < 300:
            logger.info(f"Efficient query detected, increasing limit from {limit} to 300 for better pagination")
            limit = 300
        
        # Perform search
        result = search_bills(filters, limit, last_evaluated_key, is_restoration)
        
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
            'headers': build_cors_headers(origin),
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
            'headers': build_cors_headers(origin),
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }

