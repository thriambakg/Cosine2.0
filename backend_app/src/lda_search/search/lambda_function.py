"""
LDA Search Lambda Function - Query-Based Approach
Uses Boto3 query method efficiently with union/intersection logic
"""

import json
import os
import logging
import boto3
from typing import Dict, List, Any, Optional, Set
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeDeserializer
from cors_helper import get_cors_headers


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')

# Environment variables
FILINGS_TABLE_NAME = os.environ.get('FILINGS_TABLE_NAME', 'lda-filings')

# Get DynamoDB table
filings_table = dynamodb.Table(FILINGS_TABLE_NAME) if FILINGS_TABLE_NAME else None


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


def clean_quotes(value: str) -> str:
    """Remove surrounding double quotes from a string value"""
    if not value:
        return value
    return str(value).strip().strip('"').strip()


def query_gsi(index_name: str, hash_key_name: str, hash_key_value: Any,
              date_from: Optional[str] = None, date_to: Optional[str] = None,
              limit: int = 100, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """
    Query a GSI and return filing PKs (FILING#uuid or CONTRIBUTION#uuid)
    
    Args:
        index_name: Name of the GSI
        hash_key_name: Hash key attribute name
        hash_key_value: Hash key value
        date_from: Optional date filter (YYYY-MM-DD) - uses dt_posted range key
        date_to: Optional date filter (YYYY-MM-DD) - uses dt_posted range key (inclusive of entire day)
        limit: Maximum number of items to return
        exclusive_start_key: Pagination token
    
    Returns:
        Tuple of (list of PK strings, last_evaluated_key)
    """
    try:
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        # Add date range condition if dt_posted is the range key
        # For date_to, append time to make it inclusive of the entire day
        if date_from or date_to:
            # Make date_to inclusive of entire day by appending T23:59:59.999Z
            date_to_inclusive = None
            if date_to:
                # If date_to doesn't already have a time component, append end of day
                if 'T' not in date_to and ' ' not in date_to:
                    date_to_inclusive = f"{date_to}T23:59:59.999Z"
                else:
                    date_to_inclusive = date_to
            
            if date_from and date_to_inclusive:
                key_condition = key_condition & Key('dt_posted').between(date_from, date_to_inclusive)
            elif date_from:
                key_condition = key_condition & Key('dt_posted').gte(date_from)
            elif date_to_inclusive:
                key_condition = key_condition & Key('dt_posted').lte(date_to_inclusive)
        
        params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'PK, SK',  # KEYS_ONLY GSIs project PK and SK
            'Limit': limit
        }
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = filings_table.query(**params)
        items = response.get('Items', [])
        
        # Extract PK values (FILING#uuid or CONTRIBUTION#uuid)
        # DynamoDB resource API returns PK as a string directly
        pks = []
        for item in items:
            pk = item.get('PK')
            if pk:
                # Ensure it's a string
                pk_str = str(pk) if not isinstance(pk, str) else pk
                pks.append(pk_str)
        
        return pks, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying GSI {index_name}: {e}", exc_info=True)
        return [], None


def query_search_index(search_type: str, search_value: str,
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      limit: int = 100, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """
    Query search index items to get entity PKs
    Structure: PK = "SEARCH#<search_type>#<value>", SK = "DT_POSTED#<date>#<entityPK>"
    
    Returns:
        Tuple of (list of entity PKs, last_evaluated_key)
    """
    try:
        cleaned_value = clean_quotes(str(search_value).strip())
        if not cleaned_value:
            return [], None
        
        search_pk = f"SEARCH#{search_type}#{cleaned_value}"
        key_condition = Key('PK').eq(search_pk)
        
        # Build SK range condition for date filtering
        if date_from or date_to:
            def extract_date(date_str):
                if not date_str:
                    return None
                if 'T' in date_str:
                    return date_str.split('T')[0]
                elif ' ' in date_str:
                    return date_str.split(' ')[0]
                return date_str[:10]
            
            date_from_part = extract_date(date_from) if date_from else None
            date_to_part = extract_date(date_to) if date_to else None
            
            if date_from_part and date_to_part:
                sk_start = f"DT_POSTED#{date_from_part}#"
                # Make date_to inclusive by using the next day's prefix (exclusive) or appending max time
                # Since SK format is "DT_POSTED#YYYY-MM-DD#...", we need to include all items on that date
                # Use the next day's date with "#" to ensure we get all items up to and including date_to
                from datetime import datetime, timedelta
                try:
                    date_obj = datetime.strptime(date_to_part, '%Y-%m-%d')
                    next_day = (date_obj + timedelta(days=1)).strftime('%Y-%m-%d')
                    sk_end = f"DT_POSTED#{next_day}#"  # Exclusive of next day = inclusive of date_to
                except ValueError:
                    # Fallback: use date_to with max suffix
                    sk_end = f"DT_POSTED#{date_to_part}#~"
                key_condition = key_condition & Key('SK').between(sk_start, sk_end)
            elif date_from_part:
                sk_start = f"DT_POSTED#{date_from_part}#"
                key_condition = key_condition & Key('SK').gte(sk_start)
            elif date_to_part:
                # Make date_to inclusive by using the next day's prefix
                from datetime import datetime, timedelta
                try:
                    date_obj = datetime.strptime(date_to_part, '%Y-%m-%d')
                    next_day = (date_obj + timedelta(days=1)).strftime('%Y-%m-%d')
                    sk_end = f"DT_POSTED#{next_day}#"  # Exclusive of next day = inclusive of date_to
                except ValueError:
                    # Fallback: use date_to with max suffix
                    sk_end = f"DT_POSTED#{date_to_part}#~"
                key_condition = key_condition & Key('SK').lte(sk_end)
        
        params = {
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'entity_pk, SK',
            'Limit': limit
        }
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = filings_table.query(**params)
        items = response.get('Items', [])
        
        # Extract entity PKs
        entity_pks = [item.get('entity_pk') for item in items if item.get('entity_pk')]
        
        return entity_pks, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying search index {search_type}: {e}", exc_info=True)
        return [], None


def query_parameter_mappings(parameter_type: str, parameter_value: str,
                            limit: int = 100, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """
    Query parameter-filing mappings to get filing UUIDs
    Structure: PK = "PARAMETER_TYPE#VALUE", SK = "FILING#<uuid>" or "CONTRIBUTION#<uuid>"
    
    Returns:
        Tuple of (list of filing UUIDs, last_evaluated_key)
    """
    try:
        cleaned_value = clean_quotes(parameter_value)
        if not cleaned_value:
            return [], None
        
        pk = f"{parameter_type}#{cleaned_value}"
        key_condition = Key('PK').eq(pk)
        
        params = {
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'SK',  # SK contains FILING#<uuid>
            'Limit': limit
        }
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = filings_table.query(**params)
        items = response.get('Items', [])
        
        # Extract filing UUIDs from SK
        filing_uuids = []
        for item in items:
            sk = item.get('SK', '')
            if sk and sk.startswith('FILING#'):
                filing_uuid = sk.replace('FILING#', '')
                filing_uuids.append(filing_uuid)
        
        return filing_uuids, response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying parameter mappings {parameter_type}: {e}", exc_info=True)
        return [], None


def get_all_from_gsi(query_func, *args, max_items: int = 50000, **kwargs) -> Set[str]:
    """Get all items from a GSI using internal pagination"""
    all_ids = set()
    exclusive_start_key = kwargs.pop('exclusive_start_key', None)
    
    while len(all_ids) < max_items:
        kwargs['exclusive_start_key'] = exclusive_start_key
        kwargs['limit'] = 100
        
        ids, last_key = query_func(*args, **kwargs)
        all_ids.update(ids)
        
        if not last_key or len(ids) == 0:
                        break
        exclusive_start_key = last_key
    
    return all_ids


def identify_queries(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify all queries needed based on filters
    
    Returns list of query configs
    """
    queries = []
    # Handle empty strings as None
    date_from = filters.get('date_from')
    if date_from == '':
        date_from = None
    date_to = filters.get('date_to')
    if date_to == '':
        date_to = None
    
    # Item type filter
    if filters.get('item_type'):
        item_types = filters['item_type'] if isinstance(filters['item_type'], list) else [filters['item_type']]
        item_types = [t.upper() for t in item_types if t and str(t).strip()]
        if item_types:
            queries.append({
                'filter_type': 'item_type',
                'index_name': 'ItemTypePostedDateIndex',
                'hash_key': 'item_type',
                'hash_value': item_types[0],
                'query_func': query_gsi,
                'date_from': date_from,
                'date_to': date_to
            })
    
    # Date range filter (only if no item_type with date)
    if (date_from or date_to) and not any(q.get('filter_type') == 'item_type' for q in queries):
        try:
            from datetime import datetime
            if date_from and date_to:
                year_from = int(date_from.split('-')[0])
                year_to = int(date_to.split('-')[0])
                years_to_query = list(range(year_from, year_to + 1))
            elif date_from:
                year_from = int(date_from.split('-')[0])
                years_to_query = [year_from]
            elif date_to:
                year_to = int(date_to.split('-')[0])
                years_to_query = [year_to]
            else:
                years_to_query = []
            
            for year in years_to_query:
                range_value = None
                range_condition = None
                if len(years_to_query) == 1:
                    if date_from and date_to:
                        range_value = (date_from, date_to)
                        range_condition = 'between'
                    elif date_from:
                        range_value = date_from
                        range_condition = 'gte'
                    elif date_to:
                        range_value = date_to
                        range_condition = 'lte'
                else:
                    if year == years_to_query[0] and date_from:
                        range_value = date_from
                        range_condition = 'gte'
                    elif year == years_to_query[-1] and date_to:
                        range_value = date_to
                        range_condition = 'lte'
                
                queries.append({
                    'filter_type': 'date_range',
                    'index_name': 'YearPostedDateIndex',
                    'hash_key': 'filing_year',
                    'hash_value': year,
                    'query_func': query_gsi,
                    'date_from': date_from if range_condition == 'gte' or range_condition == 'between' else None,
                    'date_to': date_to if range_condition == 'lte' or range_condition == 'between' else None
                })
        except (ValueError, IndexError) as e:
            logger.warning(f"Error parsing date range: {e}")
    
    # General text search fields
    general_text_search_fields = filters.get('general_text_search_fields', {})
    if general_text_search_fields:
        # Registrant
        if general_text_search_fields.get('registrant'):
            registrant_terms = general_text_search_fields['registrant']
            if isinstance(registrant_terms, list) and registrant_terms:
                for term in registrant_terms:
                    normalized = clean_quotes(str(term).strip())
                    if normalized:
                        queries.append({
                            'filter_type': 'registrant_name',
                            'index_name': 'RegistrantPostedDateIndex',
                            'hash_key': 'registrant_name',
                            'hash_value': normalized,
                            'query_func': query_gsi,
                            'date_from': date_from,
                            'date_to': date_to,
                            'category': 'registrant',
                            'search_source': 'general_search'  # Mark as general search
                        })
        
        # Client
        if general_text_search_fields.get('client'):
            client_terms = general_text_search_fields['client']
            if isinstance(client_terms, list) and client_terms:
                for term in client_terms:
                    normalized = clean_quotes(str(term).strip())
                    if normalized:
                        queries.append({
                            'filter_type': 'client_name',
                            'index_name': 'ClientPostedDateIndex',
                            'hash_key': 'client_name',
                            'hash_value': normalized,
                            'query_func': query_gsi,
                            'date_from': date_from,
                            'date_to': date_to,
                            'category': 'client',
                            'search_source': 'general_search'  # Mark as general search
                        })
        
        # Lobbyist (uses search index)
        if general_text_search_fields.get('lobbyist'):
            lobbyist_terms = general_text_search_fields['lobbyist']
            if isinstance(lobbyist_terms, list) and lobbyist_terms:
                for term in lobbyist_terms:
                    if term and str(term).strip():
                        queries.append({
                            'filter_type': 'lobbyist',
                        'query_type': 'search_index',
                        'search_type': 'LOBBYIST',
                            'search_value': str(term).strip(),
                            'query_func': query_search_index,
                            'date_from': date_from,
                            'date_to': date_to,
                            'category': 'lobbyist',
                            'search_source': 'general_search'  # Mark as general search
                        })
        
        # PAC (uses search index)
        if general_text_search_fields.get('pac'):
            pac_terms = general_text_search_fields['pac']
            if isinstance(pac_terms, list) and pac_terms:
                for term in pac_terms:
                    if term and str(term).strip():
                        queries.append({
                            'filter_type': 'pac',
                        'query_type': 'search_index',
                        'search_type': 'PAC',
                            'search_value': str(term).strip(),
                            'query_func': query_search_index,
                            'date_from': date_from,
                            'date_to': date_to,
                            'category': 'pac',
                            'search_source': 'general_search'  # Mark as general search
                        })
        
        # Foreign entity (uses search index)
        if general_text_search_fields.get('foreign'):
            foreign_terms = general_text_search_fields['foreign']
            if isinstance(foreign_terms, list) and foreign_terms:
                for term in foreign_terms:
                    if term and str(term).strip():
                        queries.append({
                            'filter_type': 'foreign',
                            'query_type': 'search_index',
                            'search_type': 'FOREIGN_COUNTRY',
                            'search_value': str(term).strip(),
                            'query_func': query_search_index,
                            'date_from': date_from,
                            'date_to': date_to,
                            'category': 'foreign',
                            'search_source': 'general_search'  # Mark as general search
                        })
    
    # Advanced search fields
    if filters.get('registrant_name'):
        registrant_names = filters['registrant_name'] if isinstance(filters['registrant_name'], list) else [filters['registrant_name']]
        for name in registrant_names:
            normalized = clean_quotes(str(name).strip())
            if normalized:
                queries.append({
                    'filter_type': 'registrant_name',
                        'index_name': 'RegistrantPostedDateIndex',
                        'hash_key': 'registrant_name',
                    'hash_value': normalized,
                    'query_func': query_gsi,
                    'date_from': date_from,
                    'date_to': date_to,
                    'category': 'registrant_name',
                    'search_source': 'advanced_search'  # Mark as advanced search
                })
    
    if filters.get('client_name'):
        client_names = filters['client_name'] if isinstance(filters['client_name'], list) else [filters['client_name']]
        for name in client_names:
            normalized = clean_quotes(str(name).strip())
            if normalized:
                queries.append({
                    'filter_type': 'client_name',
                        'index_name': 'ClientPostedDateIndex',
                        'hash_key': 'client_name',
                    'hash_value': normalized,
                    'query_func': query_gsi,
                    'date_from': date_from,
                    'date_to': date_to,
                    'category': 'client_name',
                    'search_source': 'advanced_search'  # Mark as advanced search
                })
    
    if filters.get('lobbyist_name'):
        lobbyist_names = filters['lobbyist_name'] if isinstance(filters['lobbyist_name'], list) else [filters['lobbyist_name']]
        for name in lobbyist_names:
            if name and str(name).strip():
                queries.append({
                    'filter_type': 'lobbyist_name',
                    'query_type': 'search_index',
                    'search_type': 'LOBBYIST',
                    'search_value': str(name).strip(),
                    'query_func': query_search_index,
                    'date_from': date_from,
                    'date_to': date_to,
                    'category': 'lobbyist_name',
                    'search_source': 'advanced_search'  # Mark as advanced search
                })
    
    # Foreign entity name filter (uses search index)
    if filters.get('foreign_entity_name'):
        foreign_names = filters['foreign_entity_name'] if isinstance(filters['foreign_entity_name'], list) else [filters['foreign_entity_name']]
        for name in foreign_names:
            if name and str(name).strip():
                queries.append({
                    'filter_type': 'foreign_entity_name',
                    'query_type': 'search_index',
                    'search_type': 'FOREIGN_COUNTRY',
                    'search_value': str(name).strip(),
                    'query_func': query_search_index,
                    'date_from': date_from,
                    'date_to': date_to,
                    'category': 'foreign_entity_name',
                    'search_source': 'advanced_search'  # Mark as advanced search
                })
    
    # State filter
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        if states:
            queries.append({
                'filter_type': 'state',
                'index_name': 'StatePostedDateIndex',
                'hash_key': 'state',
                'hash_value': states[0],
                'query_func': query_gsi,
                'date_from': date_from,
                'date_to': date_to
            })
    
    # Foreign entity filter
    if filters.get('is_foreign') is not None:
        is_foreign = bool(filters['is_foreign'])
        queries.append({
            'filter_type': 'is_foreign',
            'index_name': 'ForeignEntityPostedDateIndex',
            'hash_key': 'is_foreign',
            'hash_value': 1 if is_foreign else 0,
            'query_func': query_gsi,
            'date_from': date_from,
            'date_to': date_to
        })
    
    # PAC filter
    if filters.get('pac') is not None:
        pac = bool(filters['pac'])
        queries.append({
            'filter_type': 'pac',
            'index_name': 'PACPostedDateIndex',
            'hash_key': 'pac',
            'hash_value': 1 if pac else 0,
            'query_func': query_gsi,
            'date_from': date_from,
            'date_to': date_to
        })
    
    # General issue code (uses parameter mappings)
    if filters.get('general_issue_code'):
        issue_names = filters['general_issue_code'] if isinstance(filters['general_issue_code'], list) else [filters['general_issue_code']]
        cleaned_issues = [clean_quotes(name) for name in issue_names if clean_quotes(name)]
        for issue_name in cleaned_issues:
            queries.append({
                'filter_type': 'general_issue_code',
                'query_type': 'parameter_mapping',
                'parameter_type': 'GENERAL_ISSUE',
                'parameter_value': issue_name,
                'query_func': query_parameter_mappings,
                'category': 'general_issue_code'
            })
    
    # Amount filter
    amount_min = filters.get('amount_min')
    if amount_min is not None and amount_min > 0:
        amount_bucket = int(amount_min)
        queries.append({
            'filter_type': 'amount',
            'index_name': 'AmountReportedIndex',
            'hash_key': 'amount_bucket',
            'hash_value': amount_bucket,
            'query_func': query_gsi,
            'amount_min': amount_min,
            'amount_max': filters.get('amount_max') if filters.get('amount_max') and filters.get('amount_max') > 0 else None
        })
    
    return queries


def apply_python_filters(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """Apply filters that need Python-side filtering (amount ranges, state, etc.)"""
    # Amount range filter
    if filters.get('amount_min') is not None:
        amount_min = float(filters['amount_min'])
        if amount_min > 0:  # Only apply filter if amount_min > 0
            item_amount = float(item.get('amount_reported', 0) or 0)
            if item_amount < amount_min:
                return False
    
    if filters.get('amount_max') is not None:
        amount_max = float(filters['amount_max'])
        if amount_max > 0:  # Only apply filter if amount_max > 0
            item_amount = float(item.get('amount_reported', 0) or 0)
            if item_amount > amount_max:
                return False
    
    # State filter (OR logic within field)
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        states = [s for s in states if s and str(s).strip()]
        if states:
            item_state = str(item.get('state') or '').strip()
            if item_state not in states:
                return False
    
    return True


def fetch_minimal_filings_batch(filing_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Fetch minimal filing fields using BatchGetItem with ProjectionExpression
    Only fetches fields needed for search results table display and filtering
    This significantly reduces data transfer and improves performance
    """
    if not filing_ids:
        return []
    
    # Essential fields for search results table and filtering
    # Includes: Filing Type, Filing Period, Registrant, Client, Amount, Date Posted, State
    # Plus fields needed for filtering: registrant_name, client_name, lobbyist_name, 
    # state, amount_reported, general_issue_code, report_type
    # Plus fields needed for sorting: dt_posted
    # Plus ID fields: PK, SK, id, filing_uuid
    projection_expression = (
        'PK, '
        'SK, '
        'id, '
        'filing_uuid, '
        'report_type, '
        'report_type_display, '
        'filing_type, '
        'filing_type_display, '
        'filing_period, '
        'filing_period_display, '
        'registrant_name, '
        'client_name, '
        'lobbyist_name, '
        'amount_reported, '
        'dt_posted, '
        'state, '
        'general_issue_code'
    )
    
    items = []
    batch_size = 50  # Reduced to 50 since we're trying both formats (effectively 100 keys per batch)
    
    for i in range(0, len(filing_ids), batch_size):
        batch_ids = filing_ids[i:i + batch_size]
        
        # Try both FILING# and CONTRIBUTION# formats
        keys = []
        for fid in batch_ids:
            keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
            keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
        
        request_items = {
            FILINGS_TABLE_NAME: {
                'Keys': keys,
                'ProjectionExpression': projection_expression
            }
        }
        
        try:
            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
            batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
            deserializer = TypeDeserializer()
            
            for item in batch_items:
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                items.append(converted_item)
        except Exception as e:
            logger.error(f"Error fetching batch: {str(e)}", exc_info=True)
            continue
    
    return items


def fetch_full_items(filing_ids: List[str]) -> List[Dict[str, Any]]:
    """Fetch full items from DynamoDB using batch_get_item (for individual filing lookups)"""
    if not filing_ids:
        return []
    
    items = []
    batch_size = 50  # Reduced to 50 since we're trying both formats (effectively 100 keys per batch)
    
    for i in range(0, len(filing_ids), batch_size):
        batch_ids = filing_ids[i:i + batch_size]
        
        # Try both FILING# and CONTRIBUTION# formats
        keys = []
        for fid in batch_ids:
            keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
            keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
        
        request_items = {
            FILINGS_TABLE_NAME: {
                'Keys': keys
            }
        }
        
        batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
        batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
        deserializer = TypeDeserializer()
        
        for item in batch_items:
            converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
            items.append(converted_item)
    
    return items


def get_filing_by_id(filing_id: str) -> Optional[Dict[str, Any]]:
    """Get a single filing by ID directly from DynamoDB (fetches full details)"""
    try:
        if not filing_id:
            return None
        
        # Try both FILING# and CONTRIBUTION# formats
        filing_key = {'PK': {'S': f'FILING#{filing_id}'}, 'SK': {'S': f'FILING#{filing_id}'}}
        contribution_key = {'PK': {'S': f'CONTRIBUTION#{filing_id}'}, 'SK': {'S': f'CONTRIBUTION#{filing_id}'}}
        
        # Try FILING# first
        try:
            response = dynamodb_client.get_item(
                TableName=FILINGS_TABLE_NAME,
                Key=filing_key
            )
            item = response.get('Item')
            if item:
                deserializer = TypeDeserializer()
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                logger.info(f"Found filing {filing_id} as FILING#")
                return converted_item
        except Exception as e:
            logger.warning(f"Error fetching FILING#{filing_id}: {str(e)}")
        
        # Try CONTRIBUTION# if FILING# didn't work
        try:
            response = dynamodb_client.get_item(
                TableName=FILINGS_TABLE_NAME,
                Key=contribution_key
            )
            item = response.get('Item')
            if item:
                deserializer = TypeDeserializer()
                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                logger.info(f"Found filing {filing_id} as CONTRIBUTION#")
                return converted_item
        except Exception as e:
            logger.warning(f"Error fetching CONTRIBUTION#{filing_id}: {str(e)}")
        
        logger.warning(f"Filing {filing_id} not found in either FILING# or CONTRIBUTION# format")
        return None
        
    except Exception as e:
        logger.error(f"Error fetching filing {filing_id}: {str(e)}", exc_info=True)
        return None


def search_filings(filters: Dict[str, Any], limit: int = 100,
                   last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search filings using union/intersection logic based on search source
    
    Strategy:
    1. UNION queries within same field (category) - multiple terms in same field are OR'd
    2. GENERAL SEARCH (general_text_search_fields): UNION across different fields (OR logic)
       - e.g., registrant=["TESLA"] OR client=["TESLA"] → returns filings matching either
    3. ADVANCED SEARCH (registrant_name, client_name, etc.): INTERSECT across different fields (AND logic)
       - e.g., registrant_name=["TESLA"] AND client_name=["TESLA"] → returns filings matching both
    4. If both general_search and advanced_search exist: INTERSECT them (AND logic)
    5. Fetch full items
    6. Apply Python-side filters (amount ranges, state, etc.)
    7. Sort and paginate
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    logger.info(f"Search filings with filters: {json.dumps(filters, default=str)}, limit: {limit}")
    
    all_queries = identify_queries(filters)
    
    if not all_queries:
                return {
                    'success': True,
                    'results': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
            'method': 'query'
        }
    
    # Separate amount filters from other filters (amount filters use buckets, so we apply in Python)
    amount_queries = []
    non_amount_queries = []
    
    for query in all_queries:
        if query.get('filter_type') == 'amount':
            amount_queries.append(query)
        else:
            non_amount_queries.append(query)
    
    # Separate queries by search source: general_search (UNION) vs advanced_search (INTERSECT)
    general_search_queries = []
    advanced_search_queries = []
    other_queries = []  # Filters like state, item_type, etc.
    
    for query in non_amount_queries:
        search_source = query.get('search_source')
        if search_source == 'general_search':
            general_search_queries.append(query)
        elif search_source == 'advanced_search':
            advanced_search_queries.append(query)
        else:
            other_queries.append(query)
    
    # Helper function to execute queries and get filing IDs for a category
    def execute_queries_for_category(field_queries):
        field_ids = set()
        for query in field_queries:
            query_func = query['query_func']
            
            if query.get('query_type') == 'search_index':
                # Fetch all items using pagination
                entity_pks = list(get_all_from_gsi(
                    query_func,
                    search_type=query['search_type'],
                    search_value=query['search_value'],
                    date_from=query.get('date_from'),
                    date_to=query.get('date_to'),
                    max_items=50000
                ))
                # Convert entity PKs to filing IDs
                filing_ids = []
                for pk in entity_pks:
                    if pk and isinstance(pk, str):
                        if pk.startswith('FILING#'):
                            filing_ids.append(pk.replace('FILING#', ''))
                        elif pk.startswith('CONTRIBUTION#'):
                            filing_ids.append(pk.replace('CONTRIBUTION#', ''))
                field_ids.update(filing_ids)
            elif query.get('query_type') == 'parameter_mapping':
                # Fetch all items using pagination
                filing_uuids = list(get_all_from_gsi(
                    query_func,
                    parameter_type=query['parameter_type'],
                    parameter_value=query['parameter_value'],
                    max_items=50000
                ))
                field_ids.update(filing_uuids)
            else:
                # GSI query - fetch all items using pagination
                pks = list(get_all_from_gsi(
                    query_func,
                    index_name=query['index_name'],
                    hash_key_name=query['hash_key'],
                    hash_key_value=query['hash_value'],
                    date_from=query.get('date_from'),
                    date_to=query.get('date_to'),
                    max_items=50000
                ))
                # Convert PKs to filing IDs
                filing_ids = []
                for pk in pks:
                    if pk:
                        pk_str = str(pk) if not isinstance(pk, str) else pk
                        if pk_str.startswith('FILING#'):
                            filing_id = pk_str.replace('FILING#', '')
                            filing_ids.append(filing_id)
                        elif pk_str.startswith('CONTRIBUTION#'):
                            filing_id = pk_str.replace('CONTRIBUTION#', '')
                            filing_ids.append(filing_id)
                field_ids.update(filing_ids)
                if field_queries[0].get('hash_key') == 'client_name':
                    logger.info(f"Sample client PKs: {pks[:3] if len(pks) >= 3 else pks}, converted to IDs: {filing_ids[:3] if len(filing_ids) >= 3 else filing_ids}")
        return field_ids
    
    # Step 1: Process GENERAL SEARCH queries - UNION within each category, then UNION across categories
    general_search_result = None
    if general_search_queries:
        # Group by category for UNION within field
        general_queries_by_field = defaultdict(list)
        for query in general_search_queries:
            category = query.get('category', query.get('filter_type'))
            general_queries_by_field[category].append(query)
        
        # UNION within each category
        general_field_results = {}
        for category, field_queries in general_queries_by_field.items():
            field_ids = execute_queries_for_category(field_queries)
            general_field_results[category] = field_ids
            logger.info(f"General search field '{category}' UNION complete: {len(field_ids)} unique filing IDs")
        
        # UNION across all general search categories
        general_search_result = set()
        for category, field_ids in general_field_results.items():
            general_search_result.update(field_ids)
            logger.info(f"General search field '{category}' added to union: {len(field_ids)} IDs, total so far: {len(general_search_result)}")
        
        logger.info(f"General search UNION complete: {len(general_search_result)} total unique filing IDs")
    
    # Step 2: Process ADVANCED SEARCH queries - UNION within each category, then INTERSECT across categories
    advanced_search_result = None
    if advanced_search_queries:
        # Group by category for UNION within field
        advanced_queries_by_field = defaultdict(list)
        for query in advanced_search_queries:
            category = query.get('category', query.get('filter_type'))
            advanced_queries_by_field[category].append(query)
        
        # UNION within each category
        advanced_field_results = {}
        for category, field_queries in advanced_queries_by_field.items():
            field_ids = execute_queries_for_category(field_queries)
            advanced_field_results[category] = field_ids
            logger.info(f"Advanced search field '{category}' UNION complete: {len(field_ids)} unique filing IDs")
        
        # INTERSECT across all advanced search categories (AND logic)
        if advanced_field_results:
            # Start with the first field's results
            sorted_fields = sorted(advanced_field_results.items(), key=lambda x: len(x[1]))
            smallest_category, smallest_ids = sorted_fields[0]
            advanced_search_result = smallest_ids.copy()
            logger.info(f"Advanced search: Using smallest field '{smallest_category}' as source: {len(advanced_search_result)} filing IDs")
            
            # Intersect with remaining fields
            for category, field_ids in sorted_fields[1:]:
                before_size = len(advanced_search_result)
                advanced_search_result = advanced_search_result.intersection(field_ids)
                after_size = len(advanced_search_result)
                logger.info(f"Advanced search: Intersected with '{category}' ({len(field_ids)} IDs): {before_size} -> {after_size} filing IDs")
            
            logger.info(f"Advanced search INTERSECT complete: {len(advanced_search_result)} total unique filing IDs")
    
    # Step 3: Combine general_search and advanced_search results
    # If both exist, INTERSECT them (AND logic: must match general_search AND advanced_search)
    # If only one exists, use it directly
    if general_search_result is not None and advanced_search_result is not None:
        # Both exist - INTERSECT them
        before_size = len(general_search_result)
        all_filing_ids = general_search_result.intersection(advanced_search_result)
        logger.info(f"Combined general_search ({before_size} IDs) AND advanced_search ({len(advanced_search_result)} IDs): {len(all_filing_ids)} total unique filing IDs")
    elif general_search_result is not None:
        all_filing_ids = general_search_result
    elif advanced_search_result is not None:
        all_filing_ids = advanced_search_result
    else:
        all_filing_ids = set()
    
    # Step 4: Handle other filters (item_type, is_foreign, pac, state, date_range, etc.)
    # Execute GSI-based filters (item_type, is_foreign, pac, date_range) and intersect with results
    # State filter will be applied via Python filters later
    if other_queries:
        other_gsi_queries = [q for q in other_queries if q.get('filter_type') in ['item_type', 'is_foreign', 'pac', 'date_range']]
        other_python_filters = [q for q in other_queries if q.get('filter_type') not in ['item_type', 'is_foreign', 'pac', 'date_range']]
        
        # Check if we have date_range queries and no other search results
        date_range_queries = [q for q in other_gsi_queries if q.get('filter_type') == 'date_range']
        if date_range_queries and len(all_filing_ids) == 0 and not general_search_queries and not advanced_search_queries:
            # Only date_range queries exist - use them as primary source (UNION across years)
            logger.info(f"Only date_range queries found ({len(date_range_queries)} queries) - using as primary source")
            date_range_ids = set()
            for query in date_range_queries:
                query_func = query['query_func']
                pks = list(get_all_from_gsi(
                    query_func,
                    index_name=query['index_name'],
                    hash_key_name=query['hash_key'],
                    hash_key_value=query['hash_value'],
                    date_from=query.get('date_from'),
                    date_to=query.get('date_to'),
                    max_items=50000
                ))
                # Convert PKs to filing IDs
                filing_ids = []
                for pk in pks:
                    if pk:
                        pk_str = str(pk) if not isinstance(pk, str) else pk
                        if pk_str.startswith('FILING#'):
                            filing_ids.append(pk_str.replace('FILING#', ''))
                        elif pk_str.startswith('CONTRIBUTION#'):
                            filing_ids.append(pk_str.replace('CONTRIBUTION#', ''))
                date_range_ids.update(filing_ids)
                logger.info(f"Date range query for year {query['hash_value']} returned {len(filing_ids)} filing IDs")
            all_filing_ids = date_range_ids
            logger.info(f"Date range UNION complete: {len(all_filing_ids)} total unique filing IDs")
            # Remove date_range queries from other_gsi_queries since we've already processed them
            other_gsi_queries = [q for q in other_gsi_queries if q.get('filter_type') != 'date_range']
        
        if other_gsi_queries:
            logger.info(f"Found {len(other_gsi_queries)} GSI-based other filter(s) - will intersect with search results")
            for query in other_gsi_queries:
                query_func = query['query_func']
                pks = list(get_all_from_gsi(
                    query_func,
                    index_name=query['index_name'],
                    hash_key_name=query['hash_key'],
                    hash_key_value=query['hash_value'],
                    date_from=query.get('date_from'),
                    date_to=query.get('date_to'),
                    max_items=50000
                ))
                # Convert PKs to filing IDs
                filing_ids = []
                for pk in pks:
                    if pk:
                        pk_str = str(pk) if not isinstance(pk, str) else pk
                        if pk_str.startswith('FILING#'):
                            filing_ids.append(pk_str.replace('FILING#', ''))
                        elif pk_str.startswith('CONTRIBUTION#'):
                            filing_ids.append(pk_str.replace('CONTRIBUTION#', ''))
                
                filter_ids = set(filing_ids)
                before_size = len(all_filing_ids)
                all_filing_ids = all_filing_ids.intersection(filter_ids)
                after_size = len(all_filing_ids)
                logger.info(f"Intersected with {query.get('filter_type')} filter ({len(filter_ids)} IDs): {before_size} -> {after_size} filing IDs")
        
        if other_python_filters:
            logger.info(f"Found {len(other_python_filters)} Python-based other filter(s) - will be applied in Python filtering step")
    
    # Step 5: Handle amount filters
    # If amount filters are combined with other filters, use non-amount filters as source
    # (amount filters will be applied in Python since buckets are ranges)
    # If only amount filters, use amount filters as source
    if amount_queries and all_filing_ids is not None:
        # Amount filters combined with other filters - use non-amount as source, apply amount in Python
        logger.info(f"Amount filters combined with other filters - using non-amount filters as source ({len(all_filing_ids)} IDs), will apply amount filter in Python")
    elif amount_queries:
        # Only amount filters - use amount as source
        all_filing_ids = set()
        for query in amount_queries:
            query_func = query['query_func']
            pks = list(get_all_from_gsi(
                query_func,
                index_name=query['index_name'],
                hash_key_name=query['hash_key'],
                hash_key_value=query['hash_value'],
                max_items=50000
            ))
            filing_ids = []
            for pk in pks:
                if pk and isinstance(pk, str):
                    if pk.startswith('FILING#'):
                        filing_ids.append(pk.replace('FILING#', ''))
                    elif pk.startswith('CONTRIBUTION#'):
                        filing_ids.append(pk.replace('CONTRIBUTION#', ''))
            all_filing_ids.update(filing_ids)
        logger.info(f"Amount-only query - using amount filters as source: {len(all_filing_ids)} filing IDs")
    
    if all_filing_ids is None:
        all_filing_ids = set()
    
    logger.info(f"Total unique filing IDs after union/intersection: {len(all_filing_ids)}")
    
    # Handle pagination offset (offset is in filtered results, not raw results)
    offset = 0
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        offset = last_evaluated_key.get('offset', 0)
        logger.info(f"Using pagination offset: {offset}")
    
    # OPTIMIZATION: Only fetch a reasonable buffer of items instead of all items
    # This prevents timeouts on large result sets (e.g., 13,370 filing IDs)
    # 
    # Strategy: Fetch only what we need for the current page
    # Since filtering happens after fetching, we use a small buffer (2-3x) to account for filtering
    filing_ids_list = sorted(list(all_filing_ids))
    total_filing_ids = len(filing_ids_list)
    
    # Use a conservative buffer multiplier of 2-3x to account for filtering
    # Most filters don't filter out many items, so 2-3x should be sufficient
    buffer_multiplier = 3
    
    # Calculate how many items to fetch
    # For first page (offset=0): fetch limit * buffer_multiplier
    # For later pages: fetch offset + limit * buffer_multiplier (to cover offset + limit filtered items)
    if offset == 0:
        items_to_fetch = limit * buffer_multiplier
    else:
        # For offset > 0, we need to fetch enough to cover:
        # - Items to skip (offset filtered items) - estimate as offset * buffer_multiplier
        # - Items to return (limit filtered items) - estimate as limit * buffer_multiplier
        items_to_fetch = offset * buffer_multiplier + limit * buffer_multiplier
    
    # Cap at total available items
    items_to_fetch = min(items_to_fetch, total_filing_ids)
    
    # Ensure we fetch at least limit items (for edge cases)
    items_to_fetch = max(limit, items_to_fetch)
    
    logger.info(f"Fetching full items for {items_to_fetch} filing IDs (offset: {offset}, limit: {limit}, total: {total_filing_ids}, buffer_multiplier: {buffer_multiplier})")
    
    # Only fetch the subset we need
    filing_ids_to_fetch = filing_ids_list[:items_to_fetch]
    # Use minimal fetch to only get fields needed for search results (much faster)
    full_items = fetch_minimal_filings_batch(filing_ids_to_fetch)
    logger.info(f"Fetched {len(full_items)} minimal filing items from DynamoDB")
    
    # Apply Python-side filters
    filtered_items = [item for item in full_items if apply_python_filters(item, filters)]
    logger.info(f"After Python filters: {len(filtered_items)} items")
    
    # Sort by date (most recent first)
    filtered_items.sort(key=lambda x: x.get('dt_posted', ''), reverse=True)
    
    # Check if we have enough filtered items for the requested offset
    if offset >= len(filtered_items):
        # We don't have enough filtered items - need to fetch more
        # This can happen if filtering is very aggressive
        # For now, return empty results but indicate there might be more
        logger.warning(f"Offset {offset} exceeds filtered items {len(filtered_items)}. May need to fetch more items.")
        results = []
        has_more = items_to_fetch < total_filing_ids
        next_last_evaluated_key = {
            'offset': offset,  # Keep same offset, will fetch more next time
            'total_items': total_filing_ids,
            'method': 'query'
        } if has_more else None
    else:
        # Paginate using offset
        end_offset = offset + limit
        paginated_items = filtered_items[offset:end_offset]
        results = [convert_decimal_to_float(item) for item in paginated_items]
        
        # Determine if there are more results
        fetched_all_items = items_to_fetch >= total_filing_ids
        has_more_filtered = end_offset < len(filtered_items)
        has_more = has_more_filtered or (not fetched_all_items and len(filtered_items) > 0)
        
        next_last_evaluated_key = None
        if has_more:
            if not fetched_all_items and end_offset >= len(filtered_items):
                # We've exhausted filtered items but haven't fetched all raw items
                # Next request should continue from where we left off in raw items
                # But offset should be based on filtered items we've seen so far
                next_offset = len(filtered_items)  # Continue from current filtered count
            else:
                # We have more filtered items in current batch
                next_offset = end_offset
            
            next_last_evaluated_key = {
                'offset': next_offset,
                'total_items': total_filing_ids,
                'method': 'query'
            }
    
    logger.info(f"Returning {len(results)} results, has_more: {has_more}")
    
    return {
        'success': True,
        'results': results,
        'count': len(results),
        'has_more': has_more,
        'last_evaluated_key': next_last_evaluated_key,
        'method': 'query'
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for LDA search API"""
    headers = event.get('headers', {})
    origin = headers.get('Origin') or headers.get('origin')
    
    cors_headers = build_cors_headers(origin)
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
            }
    
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            try:
                request_body = json.loads(event['body'])
            except json.JSONDecodeError:
                request_body = {}
        else:
            request_body = event.get('body', {})
        
        # Check if this is a direct filing_id lookup (getFiling request)
        filing_id = request_body.get('filing_id')
        if filing_id:
            logger.info(f"Direct filing lookup requested for filing_id: {filing_id}")
            filing = get_filing_by_id(filing_id)
            
            if filing:
                # Convert to response format matching search results
                result = convert_decimal_to_float(filing)
                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps({
                        'success': True,
                        'result': result,
                        'count': 1
                    }, default=str)
                }
            else:
                # Filing not found
                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps({
                        'success': True,
                        'result': None,
                        'count': 0,
                        'error': f'Filing {filing_id} not found'
                    }, default=str)
                }
        
        # Extract search parameters (regular search)
        filters = request_body.get('filters', {})
        last_evaluated_key = request_body.get('last_evaluated_key')
        limit = request_body.get('limit', 100)
        
        if limit is not None:
            try:
                limit = int(limit)
            except (ValueError, TypeError):
                limit = 100
        
        logger.info(f"Search request - filters: {json.dumps(filters, default=str)}, limit: {limit}")
        
        result = search_filings(filters, limit, last_evaluated_key)
        logger.info(f"Search complete - found {result.get('count', 0)} results, has_more: {result.get('has_more', False)}")
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result, default=str)
        }
    
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'message': str(e)
            })
        }

