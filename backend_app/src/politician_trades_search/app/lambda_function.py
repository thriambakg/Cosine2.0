"""
Politician Trades Search Lambda - Query-Based Approach
Streamlined version using proper Boto3 query methods
"""

import json
import os
import logging
import boto3
import re
from typing import Dict, List, Any, Optional, Set
from datetime import datetime
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
from collections import defaultdict
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')

# Environment variables
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'cosine-politician-trades-production')
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '100'))

# GSI names
GSI_NAMES = {
    'politicianName': 'PoliticianTradeDateIndex',
    'position': 'PositionTradeDateIndex',
    'party': 'PartyTradeDateIndex',
    'securitySymbol': 'SecurityTradeDateIndex',
    'securityName': 'SecurityNameTradeDateIndex',
    'transactionType': 'TransactionTypeTradeDateIndex',
    'amountMin': 'AmountRangeTradeDateIndex',
    'stateDistrict': 'StateDistrictTradeDateIndex',
}

# Standard PTR ranges for amount queries
STANDARD_PTR_RANGES = [
    (0, 1000), (1001, 15000), (15001, 50000), (50001, 100000),
    (100001, 250000), (250001, 500000), (500001, 1000000),
    (1000001, 5000000), (5000001, 25000000), (25000001, 50000000),
    (50000001, None)
]

# Get table
trades_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if DYNAMODB_TABLE_NAME else None


def parse_amount_range(amount_range: str) -> Optional[tuple]:
    """Parse amount range string to (min, max) tuple"""
    if not amount_range:
        return None
    try:
        range_str = re.sub(r'[\$,\s]', '', amount_range)
        if '+' in range_str or 'over' in amount_range.lower():
            min_match = re.search(r'(\d+)', range_str)
            return (int(min_match.group(1)), None) if min_match else None
        range_match = re.search(r'(\d+)\s*[-–—]\s*(\d+)', range_str)
        if range_match:
            return (int(range_match.group(1)), int(range_match.group(2)))
        single_match = re.search(r'^(\d+)$', range_str)
        if single_match:
            val = int(single_match.group(1))
            return (val, val)
    except Exception as e:
        logger.warning(f"Error parsing amount range '{amount_range}': {e}")
    return None


def map_to_standard_ranges(user_min: int, user_max: Optional[int]) -> List[tuple]:
    """Map user amount range to overlapping standard ranges"""
    matching = []
    for std_min, std_max in STANDARD_PTR_RANGES:
        if user_max is None:
            if std_max is None or std_max >= user_min:
                matching.append((std_min, std_max))
        else:
            if std_min <= user_max and (std_max is None or std_max >= user_min):
                matching.append((std_min, std_max))
    return matching


def parse_date(date_str: str) -> Optional[int]:
    """Convert YYYY-MM-DD to YYYYMMDD integer"""
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        return int(date_obj.strftime('%Y%m%d'))
    except ValueError:
        return None


def query_gsi(index_name: str, hash_key_name: str, hash_key_value: Any,
              date_from: Optional[int] = None, date_to: Optional[int] = None,
              limit: int = 100, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """Query a single GSI with date range filter"""
    try:
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if date_from and date_to:
            key_condition = key_condition & Key('transactionDate').between(date_from, date_to)
        elif date_from:
            key_condition = key_condition & Key('transactionDate').gte(date_from)
        elif date_to:
            key_condition = key_condition & Key('transactionDate').lte(date_to)
        
        params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'Limit': limit
        }
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = trades_table.query(**params)
        return response.get('Items', []), response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error querying {index_name}: {e}", exc_info=True)
        return [], None


def get_all_from_gsi(index_name: str, hash_key_name: str, hash_key_value: Any,
                     date_from: Optional[int] = None, date_to: Optional[int] = None,
                     max_items: int = 10000) -> List[Dict]:
    """Get all items from GSI using pagination"""
    all_items = []
    exclusive_start_key = None
    
    while len(all_items) < max_items:
        items, last_key = query_gsi(index_name, hash_key_name, hash_key_value,
                                    date_from, date_to, limit=1000, exclusive_start_key=exclusive_start_key)
        all_items.extend(items)
        if not last_key:
            break
        exclusive_start_key = last_key
    
    return all_items[:max_items]


def identify_queries(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Identify GSI queries needed based on filters"""
    queries = []
    date_from = parse_date(filters.get('dateFrom', '')) if filters.get('dateFrom') else None
    date_to = parse_date(filters.get('dateTo', '')) if filters.get('dateTo') else None
    
    # Politician names
    politician_name = filters.get('politicianName')
    if politician_name:
        # Filter out empty lists and empty strings
        if isinstance(politician_name, list):
            names = [n for n in politician_name if n and str(n).strip()]
        else:
            names = [politician_name] if str(politician_name).strip() else []
        
        for name in names:
            if name and str(name).strip():
                queries.append({
                    'index_name': GSI_NAMES['politicianName'],
                    'hash_key_name': 'politicianName',
                    'hash_key_value': str(name).strip(),
                    'filter_type': 'politicianName',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # Position
    position = filters.get('position')
    if position:
        if isinstance(position, list):
            positions = [p for p in position if p and str(p).strip()]
        else:
            positions = [position] if str(position).strip() else []
        for pos in positions:
            if pos:
                queries.append({
                    'index_name': GSI_NAMES['position'],
                    'hash_key_name': 'position',
                    'hash_key_value': str(pos).strip(),
                    'filter_type': 'position',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # Party
    party = filters.get('party')
    if party:
        if isinstance(party, list):
            parties = [p for p in party if p and str(p).strip()]
        else:
            parties = [party] if str(party).strip() else []
        for p in parties:
            if p:
                queries.append({
                    'index_name': GSI_NAMES['party'],
                    'hash_key_name': 'party',
                    'hash_key_value': str(p).strip(),
                    'filter_type': 'party',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # Security symbol
    security = filters.get('security')
    if security:
        if isinstance(security, list):
            securities = [s for s in security if s and str(s).strip()]
        else:
            securities = [security] if str(security).strip() else []
        for sec in securities:
            if sec:
                sec_str = str(sec).strip()
                # Try symbol first
                queries.append({
                    'index_name': GSI_NAMES['securitySymbol'],
                    'hash_key_name': 'securitySymbol',
                    'hash_key_value': sec_str.upper(),
                    'filter_type': 'security',
                    'date_from': date_from,
                    'date_to': date_to
                })
                # Also try name
                queries.append({
                    'index_name': GSI_NAMES['securityName'],
                    'hash_key_name': 'securityName',
                    'hash_key_value': sec_str,
                    'filter_type': 'security',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # Transaction type
    transaction_type = filters.get('transactionType')
    if transaction_type:
        if isinstance(transaction_type, list):
            types = [t for t in transaction_type if t and str(t).strip()]
        else:
            types = [transaction_type] if str(transaction_type).strip() else []
        for ttype in types:
            if ttype:
                queries.append({
                    'index_name': GSI_NAMES['transactionType'],
                    'hash_key_name': 'transactionType',
                    'hash_key_value': str(ttype).strip(),
                    'filter_type': 'transactionType',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # State/District
    state_district = filters.get('stateDistrict')
    if state_district:
        if isinstance(state_district, list):
            districts = [d for d in state_district if d and str(d).strip()]
        else:
            districts = [state_district] if str(state_district).strip() else []
        for dist in districts:
            if dist:
                queries.append({
                    'index_name': GSI_NAMES['stateDistrict'],
                    'hash_key_name': 'stateDistrict',
                    'hash_key_value': str(dist).strip(),
                    'filter_type': 'stateDistrict',
                    'date_from': date_from,
                    'date_to': date_to
                })
    
    # Amount range - map to standard ranges
    if filters.get('amountRange'):
        ranges = filters['amountRange'] if isinstance(filters['amountRange'], list) else [filters['amountRange']]
        for range_str in ranges:
            if range_str:
                parsed = parse_amount_range(range_str)
                if parsed:
                    user_min, user_max = parsed
                    matching_ranges = map_to_standard_ranges(user_min, user_max)
                    for std_min, std_max in matching_ranges:
                        queries.append({
                            'index_name': GSI_NAMES['amountMin'],
                            'hash_key_name': 'amountMin',
                            'hash_key_value': std_min,
                            'filter_type': 'amountRange',
                            'date_from': date_from,
                            'date_to': date_to,
                            'user_amount_min': user_min,
                            'user_amount_max': user_max,
                            'std_range': (std_min, std_max)
                        })
    
    return queries


def scan_table_with_date_filter(date_from: Optional[int] = None, date_to: Optional[int] = None,
                                 max_items: int = 10000, exclusive_start_key: Optional[Dict] = None) -> tuple:
    """Scan table with date filter when no hash key filters are provided"""
    try:
        filter_expression = None
        if date_from and date_to:
            filter_expression = Attr('transactionDate').between(date_from, date_to)
        elif date_from:
            filter_expression = Attr('transactionDate').gte(date_from)
        elif date_to:
            filter_expression = Attr('transactionDate').lte(date_to)
        
        params = {
            'Limit': 1000
        }
        
        if filter_expression:
            params['FilterExpression'] = filter_expression
        
        if exclusive_start_key:
            params['ExclusiveStartKey'] = exclusive_start_key
        
        response = trades_table.scan(**params)
        return response.get('Items', []), response.get('LastEvaluatedKey')
    except Exception as e:
        logger.error(f"Error scanning table with date filter: {e}", exc_info=True)
        return [], None


def search_trades(filters: Dict[str, Any], limit: int = 50,
                 last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """Search trades using query-based approach"""
    try:
        logger.info(f"Search with filters: {json.dumps(filters, default=str)}, limit: {limit}")
        
        queries = identify_queries(filters)
        logger.info(f"Identified {len(queries)} queries to execute")
        
        # If no queries but we have date filters, use table scan
        date_from = parse_date(filters.get('dateFrom', '')) if filters.get('dateFrom') else None
        date_to = parse_date(filters.get('dateTo', '')) if filters.get('dateTo') else None
        
        if not queries and (date_from or date_to):
            logger.info("No hash key filters provided, but date filters exist - using table scan")
            all_items = []
            exclusive_start_key = last_evaluated_key if last_evaluated_key else None
            
            while len(all_items) < 10000:
                items, last_key = scan_table_with_date_filter(
                    date_from, date_to, max_items=10000, exclusive_start_key=exclusive_start_key
                )
                all_items.extend(items)
                if not last_key:
                    break
                exclusive_start_key = last_key
            
            # Apply additional filters (amount range, etc.)
            filtered_items = []
            for item in all_items:
                # Amount range filter
                if filters.get('amountRange'):
                    ranges = filters['amountRange'] if isinstance(filters['amountRange'], list) else [filters['amountRange']]
                    matches = False
                    for range_str in ranges:
                        parsed = parse_amount_range(range_str)
                        if parsed:
                            user_min, user_max = parsed
                            amount_min = item.get('amountMin')
                            if amount_min is not None:
                                amount_val = int(amount_min) if isinstance(amount_min, (Decimal, int, float)) else 0
                                if user_max is None:
                                    if amount_val >= user_min:
                                        matches = True
                                        break
                                else:
                                    if user_min <= amount_val <= user_max:
                                        matches = True
                                        break
                    if not matches:
                        continue
                
                # Other filters
                if filters.get('requiresManualReview') is not None:
                    if item.get('requiresManualReview') != filters['requiresManualReview']:
                        continue
                if filters.get('isUnparsed') is not None:
                    if item.get('isUnparsed') != filters['isUnparsed']:
                        continue
                if filters.get('matchConfidence'):
                    if item.get('matchConfidence') != filters['matchConfidence']:
                        continue
                
                filtered_items.append(item)
            
            # Sort by transactionDate descending
            filtered_items.sort(key=lambda x: (x.get('transactionDate', 0), x.get('tradeId', '')), reverse=True)
            
            # Apply pagination
            paginated_items = filtered_items[:limit]
            has_more = len(filtered_items) > limit
            
            # Determine next cursor
            next_key = None
            if paginated_items and has_more:
                last_item = paginated_items[-1]
                last_date = last_item.get('transactionDate')
                last_date_int = int(last_date) if last_date is not None else None
                next_key = {
                    'transactionDate': last_date_int,
                    'tradeId': str(last_item.get('tradeId', ''))
                }
            
            # Convert Decimal to int/float for JSON
            def convert_decimal(obj):
                if isinstance(obj, Decimal):
                    return int(obj) if obj % 1 == 0 else float(obj)
                elif isinstance(obj, dict):
                    return {k: convert_decimal(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [convert_decimal(v) for v in obj]
                return obj
            
            results = [convert_decimal(item) for item in paginated_items]
            
            return {
                'success': True,
                'results': results,
                'count': len(results),
                'total_found': len(filtered_items),
                'has_more': has_more,
                'last_evaluated_key': next_key
            }
        
        if not queries:
            logger.warning("No queries identified from filters - returning empty results")
            return {
                'success': True,
                'results': [],
                'count': 0,
                'has_more': False,
                'last_evaluated_key': None
            }
        
        # Group queries by filter_type (union within field, intersect across fields)
        queries_by_field = defaultdict(list)
        for q in queries:
            queries_by_field[q['filter_type']].append(q)
        
        # Union results within each field
        field_results = {}
        for filter_type, field_queries in queries_by_field.items():
            all_ids: Set[str] = set()
            for query_config in field_queries:
                logger.info(f"Executing {filter_type} query: {query_config['index_name']} (hash={query_config['hash_key_name']}={query_config['hash_key_value']}, date_from={query_config.get('date_from')}, date_to={query_config.get('date_to')})")
                items = get_all_from_gsi(
                    query_config['index_name'],
                    query_config['hash_key_name'],
                    query_config['hash_key_value'],
                    query_config.get('date_from'),
                    query_config.get('date_to'),
                    max_items=10000
                )
                ids = {item.get('tradeId') for item in items if item.get('tradeId')}
                all_ids.update(ids)
                logger.info(f"{filter_type} query returned: {len(items)} items, {len(ids)} unique IDs")
            field_results[filter_type] = all_ids
            logger.info(f"{filter_type} UNION complete: {len(all_ids)} unique IDs")
        
        # Intersect across different fields
        if len(field_results) > 1:
            result_ids = set.intersection(*field_results.values())
        else:
            result_ids = next(iter(field_results.values()), set())
        
        logger.info(f"After intersection: {len(result_ids)} unique IDs")
        
        # Fetch full items for result IDs
        all_items = []
        batch_size = 100
        result_ids_list = sorted(list(result_ids))
        
        for i in range(0, len(result_ids_list), batch_size):
            batch_ids = result_ids_list[i:i + batch_size]
            try:
                response = dynamodb_client.batch_get_item(
                    RequestItems={
                        DYNAMODB_TABLE_NAME: {
                            'Keys': [{'tradeId': {'S': tid}} for tid in batch_ids]
                        }
                    }
                )
                batch_items = response.get('Responses', {}).get(DYNAMODB_TABLE_NAME, [])
                from boto3.dynamodb.types import TypeDeserializer
                deserializer = TypeDeserializer()
                for item in batch_items:
                    all_items.append({k: deserializer.deserialize(v) for k, v in item.items()})
            except Exception as e:
                logger.error(f"Error fetching batch: {e}", exc_info=True)
        
        # Apply additional filters (security name matching, amount range, etc.)
        filtered_items = []
        for item in all_items:
            # Security filter (if searching by name/symbol)
            if filters.get('security') and 'security' in field_results:
                securities = filters['security'] if isinstance(filters['security'], list) else [filters['security']]
                matches = False
                for sec in securities:
                    sec_upper = sec.upper().strip()
                    if (item.get('securitySymbol', '').upper() == sec_upper or
                        sec_upper in item.get('securitySymbol', '').upper() or
                        sec in item.get('securityName', '') or
                        sec.lower() in item.get('securityName', '').lower()):
                        matches = True
                        break
                if not matches:
                    continue
            
            # Amount range filter (verify actual amountMin falls within user range)
            # Note: We query by standard ranges, but need to verify against actual user range
            if filters.get('amountRange'):
                ranges = filters['amountRange'] if isinstance(filters['amountRange'], list) else [filters['amountRange']]
                matches = False
                for range_str in ranges:
                    parsed = parse_amount_range(range_str)
                    if parsed:
                        user_min, user_max = parsed
                        amount_min = item.get('amountMin')
                        if amount_min is not None:
                            amount_val = int(amount_min) if isinstance(amount_min, (Decimal, int, float)) else 0
                            if user_max is None:
                                if amount_val >= user_min:
                                    matches = True
                                    break
                            else:
                                if user_min <= amount_val <= user_max:
                                    matches = True
                                    break
                if not matches:
                    continue
            
            # Other filters (requiresManualReview, isUnparsed, matchConfidence)
            if filters.get('requiresManualReview') is not None:
                if item.get('requiresManualReview') != filters['requiresManualReview']:
                    continue
            if filters.get('isUnparsed') is not None:
                if item.get('isUnparsed') != filters['isUnparsed']:
                    continue
            if filters.get('matchConfidence'):
                if item.get('matchConfidence') != filters['matchConfidence']:
                    continue
            
            filtered_items.append(item)
        
        # Sort by transactionDate descending
        filtered_items.sort(key=lambda x: (x.get('transactionDate', 0), x.get('tradeId', '')), reverse=True)
        
        # Apply offset-based pagination
        offset = 0
        if last_evaluated_key:
            # Find offset based on last_evaluated_key
            cursor_date = last_evaluated_key.get('transactionDate')
            cursor_trade_id = last_evaluated_key.get('tradeId')
            if cursor_date is not None:
                # Convert cursor_date to int for comparison (it might come as int from JSON)
                cursor_date_int = int(cursor_date) if cursor_date is not None else None
                for idx, item in enumerate(filtered_items):
                    # Convert item_date to int (DynamoDB returns Decimal)
                    item_date = item.get('transactionDate', 0)
                    item_date_int = int(item_date) if item_date is not None else 0
                    item_trade_id = str(item.get('tradeId', ''))
                    cursor_trade_id_str = str(cursor_trade_id) if cursor_trade_id else ''
                    
                    if item_date_int < cursor_date_int or (item_date_int == cursor_date_int and item_trade_id <= cursor_trade_id_str):
                        offset = idx + 1
                        break
        
        # Get page of results
        paginated_items = filtered_items[offset:offset + limit]
        has_more = offset + limit < len(filtered_items)
        
        # Determine next cursor (convert Decimal to int for JSON serialization)
        next_key = None
        if paginated_items and has_more:
            last_item = paginated_items[-1]
            last_date = last_item.get('transactionDate')
            # Convert Decimal to int for JSON serialization
            last_date_int = int(last_date) if last_date is not None else None
            next_key = {
                'transactionDate': last_date_int,
                'tradeId': str(last_item.get('tradeId', ''))
            }
        
        # Convert Decimal to int/float for JSON
        def convert_decimal(obj):
            if isinstance(obj, Decimal):
                return int(obj) if obj % 1 == 0 else float(obj)
            elif isinstance(obj, dict):
                return {k: convert_decimal(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimal(v) for v in obj]
            return obj
        
        results = [convert_decimal(item) for item in paginated_items]
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'total_found': len(filtered_items),
            'has_more': has_more,
            'last_evaluated_key': next_key
        }
        
    except Exception as e:
        logger.error(f"Error in search_trades: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'count': 0
        }


def lambda_handler(event, context):
    """Lambda handler"""
    global origin
    headers = event.get('headers', {}) if isinstance(event, dict) else {}
    origin = headers.get('Origin') or headers.get('origin')
    
    cors_headers = {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Credentials': 'true'
    }
    
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    try:
        body_str = event.get('body', '{}')
        body = json.loads(body_str) if isinstance(body_str, str) else body_str or {}
        
        filters = {
            'politicianName': body.get('politicianName'),
            'position': body.get('position'),
            'party': body.get('party'),
            'security': body.get('security'),
            'transactionType': body.get('transactionType'),
            'stateDistrict': body.get('stateDistrict'),
            'dateFrom': body.get('dateFrom'),
            'dateTo': body.get('dateTo'),
            'amountRange': body.get('amountRange'),
            'requiresManualReview': body.get('requiresManualReview'),
            'isUnparsed': body.get('isUnparsed'),
            'matchConfidence': body.get('matchConfidence'),
        }
        # Filter out None, empty strings, and empty lists
        filters = {
            k: v for k, v in filters.items() 
            if v is not None and v != '' and not (isinstance(v, list) and len(v) == 0)
        }
        
        limit = min(int(body.get('pageSize', 50)), MAX_RESULTS)
        last_evaluated_key = body.get('lastEvaluatedKey')
        
        result = search_trades(filters, limit, last_evaluated_key)
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result, default=str)
        }
    except Exception as e:
        logger.error(f"Error in lambda_handler: {e}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'success': False, 'error': str(e)})
        }

