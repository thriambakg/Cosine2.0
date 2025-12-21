"""
LDA Search Lambda Function
Queries DynamoDB LDA filings table using GSIs and filters to return matching filings
"""

import json
import os
import logging
import boto3
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
FILINGS_TABLE_NAME = os.environ.get('FILINGS_TABLE_NAME', 'lda-filings')

# Get DynamoDB table
filings_table = dynamodb.Table(FILINGS_TABLE_NAME) if FILINGS_TABLE_NAME else None


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


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """
    Apply filters to an item in Python (for post-BatchGetItem filtering with KEYS_ONLY GSIs)
    
    Args:
        item: Filing item to filter
        filters: Dictionary of filter fields
    
    Returns:
        True if item matches all filters, False otherwise
    """
    # General text search (searches across multiple fields)
    if filters.get('general_text_search'):
        search_terms = filters['general_text_search'] if isinstance(filters['general_text_search'], list) else [filters['general_text_search']]
        search_terms = [t for t in search_terms if t and str(t).strip()]
        if search_terms:
            matches = False
            for term in search_terms:
                term_lower = str(term).strip().lower()
                # Search across registrant_name, client_name, lobbyist_name
                registrant = str(item.get('registrant_name') or '').lower()
                client = str(item.get('client_name') or '').lower()
                lobbyist = str(item.get('lobbyist_name') or '').lower()
                if term_lower in registrant or term_lower in client or term_lower in lobbyist:
                    matches = True
                    break
            if not matches:
                return False
    
    # Registrant name filter (OR logic within field)
    if filters.get('registrant_name'):
        registrant_names = filters['registrant_name'] if isinstance(filters['registrant_name'], list) else [filters['registrant_name']]
        registrant_names = [n for n in registrant_names if n and str(n).strip()]
        if registrant_names:
            item_name = str(item.get('registrant_name') or '').strip()
            matches = False
            for name in registrant_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Client name filter (OR logic within field)
    if filters.get('client_name'):
        client_names = filters['client_name'] if isinstance(filters['client_name'], list) else [filters['client_name']]
        client_names = [n for n in client_names if n and str(n).strip()]
        if client_names:
            item_name = str(item.get('client_name') or '').strip()
            matches = False
            for name in client_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Lobbyist name filter (OR logic within field)
    if filters.get('lobbyist_name'):
        lobbyist_names = filters['lobbyist_name'] if isinstance(filters['lobbyist_name'], list) else [filters['lobbyist_name']]
        lobbyist_names = [n for n in lobbyist_names if n and str(n).strip()]
        if lobbyist_names:
            item_name = str(item.get('lobbyist_name') or '').strip()
            matches = False
            for name in lobbyist_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Foreign entity name filter (OR logic within field)
    if filters.get('foreign_entity_name'):
        foreign_names = filters['foreign_entity_name'] if isinstance(filters['foreign_entity_name'], list) else [filters['foreign_entity_name']]
        foreign_names = [n for n in foreign_names if n and str(n).strip()]
        if foreign_names:
            # Check if item has foreign entity information
            is_foreign = item.get('is_foreign', 0)
            if not is_foreign:
                return False
            # Additional name matching could be added here if foreign_entity_name field exists
    
    # Report type filter (OR logic within field)
    if filters.get('report_type'):
        report_types = filters['report_type'] if isinstance(filters['report_type'], list) else [filters['report_type']]
        report_types = [t for t in report_types if t and str(t).strip()]
        if report_types:
            item_type = str(item.get('report_type') or '').strip()
            if item_type not in report_types:
                return False
    
    # Amount range filter
    if filters.get('amount_min') is not None:
        amount_min = float(filters['amount_min'])
        item_amount = float(item.get('amount_reported', 0) or 0)
        if item_amount < amount_min:
            return False
    
    if filters.get('amount_max') is not None:
        amount_max = float(filters['amount_max'])
        item_amount = float(item.get('amount_reported', 0) or 0)
        if item_amount > amount_max:
            return False
    
    # General issue code filter (OR logic within field)
    if filters.get('general_issue_code'):
        issue_codes = filters['general_issue_code'] if isinstance(filters['general_issue_code'], list) else [filters['general_issue_code']]
        issue_codes = [c for c in issue_codes if c and str(c).strip()]
        if issue_codes:
            item_code = str(item.get('general_issue_code') or '').strip()
            if item_code not in issue_codes:
                return False
    
    # State filter (OR logic within field)
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        states = [s for s in states if s and str(s).strip()]
        if states:
            item_state = str(item.get('state') or '').strip()
            if item_state not in states:
                return False
    
    # Foreign entity boolean filter
    if filters.get('is_foreign') is not None:
        is_foreign = bool(filters['is_foreign'])
        item_foreign = bool(item.get('is_foreign', 0))
        if item_foreign != is_foreign:
            return False
    
    # PAC boolean filter
    if filters.get('pac') is not None:
        pac = bool(filters['pac'])
        item_pac = bool(item.get('pac', 0))
        if item_pac != pac:
            return False
    
    # Filer type filter (OR logic within field)
    if filters.get('filer_type'):
        filer_types = filters['filer_type'] if isinstance(filters['filer_type'], list) else [filters['filer_type']]
        filer_types = [t for t in filer_types if t and str(t).strip()]
        if filer_types:
            item_type = str(item.get('filer_type') or '').strip()
            if item_type not in filer_types:
                return False
    
    return True


def identify_queryable_filters(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify which filters can use GSIs for efficient querying
    
    Returns:
        List of query configurations for each filter that can use a GSI
    """
    query_configs = []
    
    # Date range filter - use YearPostedDateIndex or PeriodPostedDateIndex
    date_from = filters.get('date_from')
    date_to = filters.get('date_to')
    if date_from or date_to:
        # Extract year from date_from or date_to
        date_str = date_from or date_to
        if date_str:
            try:
                year = int(date_str.split('-')[0])
                query_configs.append({
                    'filter_key': 'date_from' if date_from else 'date_to',
                    'index_name': 'YearPostedDateIndex',
                    'hash_key': 'filing_year',
                    'hash_value': year,
                    'range_key': 'dt_posted',
                    'range_value': date_from if date_from else date_to,
                    'range_condition': 'gte' if date_from else 'lte'
                })
            except (ValueError, IndexError):
                pass
    
    # Report type filter - use ReportTypePostedDateIndex
    if filters.get('report_type'):
        report_types = filters['report_type'] if isinstance(filters['report_type'], list) else [filters['report_type']]
        if report_types:
            # Use first report type for GSI query
            query_configs.append({
                'filter_key': 'report_type',
                'index_name': 'ReportTypePostedDateIndex',
                'hash_key': 'report_type',
                'hash_value': report_types[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # Registrant name filter - use RegistrantPostedDateIndex
    if filters.get('registrant_name'):
        registrant_names = filters['registrant_name'] if isinstance(filters['registrant_name'], list) else [filters['registrant_name']]
        if registrant_names:
            query_configs.append({
                'filter_key': 'registrant_name',
                'index_name': 'RegistrantPostedDateIndex',
                'hash_key': 'registrant_name',
                'hash_value': registrant_names[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # Client name filter - use ClientPostedDateIndex
    if filters.get('client_name'):
        client_names = filters['client_name'] if isinstance(filters['client_name'], list) else [filters['client_name']]
        if client_names:
            query_configs.append({
                'filter_key': 'client_name',
                'index_name': 'ClientPostedDateIndex',
                'hash_key': 'client_name',
                'hash_value': client_names[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # Lobbyist name filter - use LobbyistPostedDateIndex
    if filters.get('lobbyist_name'):
        lobbyist_names = filters['lobbyist_name'] if isinstance(filters['lobbyist_name'], list) else [filters['lobbyist_name']]
        if lobbyist_names:
            query_configs.append({
                'filter_key': 'lobbyist_name',
                'index_name': 'LobbyistPostedDateIndex',
                'hash_key': 'lobbyist_name',
                'hash_value': lobbyist_names[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # State filter - use StatePostedDateIndex
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        if states:
            query_configs.append({
                'filter_key': 'state',
                'index_name': 'StatePostedDateIndex',
                'hash_key': 'state',
                'hash_value': states[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # General issue code filter - use GeneralIssueCodePostedDateIndex
    if filters.get('general_issue_code'):
        issue_codes = filters['general_issue_code'] if isinstance(filters['general_issue_code'], list) else [filters['general_issue_code']]
        if issue_codes:
            query_configs.append({
                'filter_key': 'general_issue_code',
                'index_name': 'GeneralIssueCodePostedDateIndex',
                'hash_key': 'general_issue_code',
                'hash_value': issue_codes[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # Foreign entity filter - use ForeignEntityPostedDateIndex
    if filters.get('is_foreign') is not None:
        is_foreign = bool(filters['is_foreign'])
        query_configs.append({
            'filter_key': 'is_foreign',
            'index_name': 'ForeignEntityPostedDateIndex',
            'hash_key': 'is_foreign',
            'hash_value': 1 if is_foreign else 0,
            'range_key': 'dt_posted',
            'range_value': date_from if date_from else None,
            'range_condition': 'gte' if date_from else None
        })
    
    # PAC filter - use PACPostedDateIndex
    if filters.get('pac') is not None:
        pac = bool(filters['pac'])
        query_configs.append({
            'filter_key': 'pac',
            'index_name': 'PACPostedDateIndex',
            'hash_key': 'pac',
            'hash_value': 1 if pac else 0,
            'range_key': 'dt_posted',
            'range_value': date_from if date_from else None,
            'range_condition': 'gte' if date_from else None
        })
    
    return query_configs


def query_gsi_for_filing_ids(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_value: Optional[str] = None,
    range_key_condition: Optional[str] = None,
    limit: int = 1000,
    exclusive_start_key: Optional[Dict] = None,
    get_all: bool = False
) -> tuple[List[str], Optional[Dict]]:
    """
    Query a GSI to get filing IDs (PK values)
    
    Returns:
        Tuple of (list of filing IDs, last_evaluated_key)
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    filing_ids = []
    last_eval_key = exclusive_start_key
    
    try:
        # Build key condition expression
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if range_key_name and range_key_value:
            if range_key_condition == 'gte':
                key_condition = key_condition & Key(range_key_name).gte(range_key_value)
            elif range_key_condition == 'lte':
                key_condition = key_condition & Key(range_key_name).lte(range_key_value)
            elif range_key_condition == 'between':
                # For between, range_key_value should be a tuple (start, end)
                if isinstance(range_key_value, tuple) and len(range_key_value) == 2:
                    key_condition = key_condition & Key(range_key_name).between(range_key_value[0], range_key_value[1])
        
        # Query the GSI
        query_params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'PK, SK',
            'Limit': limit
        }
        
        if last_eval_key:
            query_params['ExclusiveStartKey'] = last_eval_key
        
        response = filings_table.query(**query_params)
        
        # Extract filing IDs from PK (format: FILING#{filing_uuid})
        for item in response.get('Items', []):
            pk = item.get('PK', '')
            if pk.startswith('FILING#'):
                filing_id = pk.replace('FILING#', '')
                filing_ids.append(filing_id)
        
        last_eval_key = response.get('LastEvaluatedKey')
        
        # Continue paginating if needed
        if get_all and last_eval_key:
            while last_eval_key and len(filing_ids) < limit:
                query_params['ExclusiveStartKey'] = last_eval_key
                response = filings_table.query(**query_params)
                
                for item in response.get('Items', []):
                    pk = item.get('PK', '')
                    if pk.startswith('FILING#'):
                        filing_id = pk.replace('FILING#', '')
                        if filing_id not in filing_ids:  # Avoid duplicates
                            filing_ids.append(filing_id)
                
                last_eval_key = response.get('LastEvaluatedKey')
                if not last_eval_key:
                    break
                if len(filing_ids) >= limit:
                    break
        
    except Exception as e:
        logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
        raise
    
    return filing_ids, last_eval_key


def search_filings(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search filings in DynamoDB using filters with multi-GSI intersection approach
    
    Strategy:
    1. Query each filter's GSI separately to get filing IDs
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
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # If we have multiple queryable filters, use intersection approach
    if len(query_configs) > 1:
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} GSIs")
        
        # Query each GSI to get initial batch of filing IDs
        gsi_results = {}
        for config in query_configs:
            logger.info(f"Querying {config['index_name']} for {config['filter_key']}={config['hash_value']}")
            filing_ids, _ = query_gsi_for_filing_ids(
                index_name=config['index_name'],
                hash_key_name=config['hash_key'],
                hash_key_value=config['hash_value'],
                range_key_name=config.get('range_key'),
                range_key_value=config.get('range_value'),
                range_key_condition=config.get('range_condition'),
                limit=1000,
                get_all=False
            )
            gsi_results[config['filter_key']] = {
                'filing_ids': set(filing_ids),
                'config': config,
                'total_count': len(filing_ids),
                'last_eval_key': None
            }
            logger.info(f"Found {len(filing_ids)} filing IDs from {config['index_name']} (first batch)")
        
        # Find the shortest list (most restrictive filter) - this is our source of truth
        shortest_key = min(gsi_results.keys(), key=lambda k: len(gsi_results[k]['filing_ids']))
        source_filing_ids = list(gsi_results[shortest_key]['filing_ids'])
        source_config = gsi_results[shortest_key]['config']
        
        logger.info(f"Using {shortest_key} as source of truth ({len(source_filing_ids)} filing IDs)")
        
        # Remove the source filter from filters (we've already applied it via GSI)
        remaining_filters = filters.copy()
        if shortest_key in remaining_filters:
            if isinstance(remaining_filters[shortest_key], list):
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
            
            # Query source GSI with pagination
            source_filing_ids_batch, new_last_eval_key = query_gsi_for_filing_ids(
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
            
            if not source_filing_ids_batch:
                logger.info(f"Source GSI {source_config['index_name']} ran out of items")
                break
            
            logger.info(f"Pagination round {pagination_round}: Got {len(source_filing_ids_batch)} filing IDs from source GSI")
            
            # Fetch full items for this batch
            items_batch = []
            if source_filing_ids_batch:
                batch_size = 100
                dynamodb_client = boto3.client('dynamodb')
                for i in range(0, len(source_filing_ids_batch), batch_size):
                    batch_ids = source_filing_ids_batch[i:i + batch_size]
                    request_items = {
                        FILINGS_TABLE_NAME: {
                            'Keys': [
                                {'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}}
                                for fid in batch_ids
                            ]
                        }
                    }
                    batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                    batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
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
        
        # Convert last_evaluated_key to JSON-serializable format
        serializable_last_key = None
        if source_last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(source_last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                serializable_last_key = None
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': source_last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': method,
            'index_used': index_name
        }
    
    # Fall back to single GSI query or scan
    elif len(query_configs) == 1:
        logger.info(f"Using single GSI query: {query_configs[0]['index_name']}")
        config = query_configs[0]
        
        # Query GSI to get filing IDs
        filing_ids, last_eval_key = query_gsi_for_filing_ids(
            index_name=config['index_name'],
            hash_key_name=config['hash_key'],
            hash_key_value=config['hash_value'],
            range_key_name=config.get('range_key'),
            range_key_value=config.get('range_value'),
            range_key_condition=config.get('range_condition'),
            limit=limit * 2,  # Get more IDs to account for filtering
            exclusive_start_key=last_evaluated_key,
            get_all=False
        )
        
        # Fetch full items
        items = []
        if filing_ids:
            batch_size = 100
            dynamodb_client = boto3.client('dynamodb')
            for i in range(0, len(filing_ids), batch_size):
                batch_ids = filing_ids[i:i + batch_size]
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': [
                            {'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}}
                            for fid in batch_ids
                        ]
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                for item in batch_items:
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
        
        # Apply remaining filters
        remaining_filters = filters.copy()
        if config['filter_key'] in remaining_filters:
            if isinstance(remaining_filters[config['filter_key']], list):
                remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
                if not remaining_filters[config['filter_key']]:
                    del remaining_filters[config['filter_key']]
            else:
                del remaining_filters[config['filter_key']]
        
        filtered_items = [item for item in items if apply_python_filter(item, remaining_filters)]
        filtered_items = filtered_items[:limit]
        
        results = [convert_decimal_to_float(item) for item in filtered_items]
        
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': 'single_gsi_query',
            'index_used': config['index_name']
        }
    
    else:
        # No GSI-queryable filters - use default GSI query for recent years
        # This avoids scan operations by querying YearPostedDateIndex for recent years
        logger.info("No GSI-queryable filters found, using default YearPostedDateIndex query for recent years")
        
        # Use current year and previous year as default to get recent filings
        from datetime import datetime
        current_year = datetime.now().year
        years_to_query = [current_year, current_year - 1]
        
        all_filing_ids = []
        all_last_eval_keys = {}
        
        # Query each year's GSI to get filing IDs
        for year in years_to_query:
            filing_ids, last_eval_key = query_gsi_for_filing_ids(
                index_name='YearPostedDateIndex',
                hash_key_name='filing_year',
                hash_key_value=year,
                limit=limit * 10,  # Get more IDs to account for filtering
                exclusive_start_key=last_evaluated_key if year == years_to_query[0] else None,
                get_all=False
            )
            all_filing_ids.extend(filing_ids)
            if last_eval_key:
                all_last_eval_keys[year] = last_eval_key
        
        logger.info(f"Found {len(all_filing_ids)} filing IDs from recent years")
        
        # Fetch full items using batch get
        items = []
        if all_filing_ids:
            batch_size = 100
            dynamodb_client = boto3.client('dynamodb')
            for i in range(0, len(all_filing_ids), batch_size):
                batch_ids = all_filing_ids[i:i + batch_size]
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': [
                            {'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}}
                            for fid in batch_ids
                        ]
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                for item in batch_items:
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
        
        # Apply all filters in Python
        filtered_items = [item for item in items if apply_python_filter(item, filters)]
        logger.info(f"After filtering: {len(filtered_items)} items match filters")
        filtered_items = filtered_items[:limit]
        
        results = [convert_decimal_to_float(item) for item in filtered_items]
        
        # Use the last evaluated key from the most recent year queried
        serializable_last_key = None
        if all_last_eval_keys:
            try:
                # Use the last evaluated key from the first year (most recent)
                serializable_last_key = convert_decimal_to_float(all_last_eval_keys.get(years_to_query[0]))
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': serializable_last_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': 'default_gsi_query',
            'index_used': 'YearPostedDateIndex'
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for LDA search API
    
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
    cors_headers = get_cors_headers()
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('LDA_SEARCH_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and len(event.get('Records', [])) > 0:
        is_sqs_event = True
        try:
            record = event['Records'][0]
            message_body = json.loads(record.get('body', '{}'))
            request_id = message_body.get('request_id')
            job_id = message_body.get('job_id')
            api_gateway_event = message_body.get('api_gateway_event', {})
            event = api_gateway_event
        except Exception as e:
            logger.error(f"Error parsing SQS event: {str(e)}", exc_info=True)
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'Invalid SQS event format'})
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
        
        # Extract filters and limit
        filters = request_body.get('filters', {})
        limit = request_body.get('limit', 100)
        last_evaluated_key = request_body.get('last_evaluated_key')
        
        # Log filters for debugging
        logger.info(f"Search request - filters: {json.dumps(filters)}, limit: {limit}, last_evaluated_key: {last_evaluated_key is not None}")
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 100
        
        # Perform search
        result = search_filings(filters, limit, last_evaluated_key)
        logger.info(f"Search complete - found {result.get('count', 0)} results, has_more: {result.get('has_more', False)}")
        
        # If this is from SQS, publish completion notification
        if is_sqs_event and completion_sns_topic:
            import boto3
            sns_client = boto3.client('sns')
            try:
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps({
                        'request_id': request_id,
                        'job_id': job_id,
                        'status': 'completed',
                        'response': result
                    }),
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': str(request_id)
                        }
                    }
                )
            except Exception as e:
                logger.error(f"Error publishing completion notification: {str(e)}", exc_info=True)
        
        # Return API Gateway response
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result)
        }
    
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        
        # If this is from SQS, publish failure notification
        if is_sqs_event and completion_sns_topic:
            import boto3
            sns_client = boto3.client('sns')
            try:
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps({
                        'request_id': request_id,
                        'job_id': job_id,
                        'status': 'failed',
                        'error': str(e)
                    }),
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': str(request_id)
                        }
                    }
                )
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {str(e2)}", exc_info=True)
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'message': str(e)
            })
        }

