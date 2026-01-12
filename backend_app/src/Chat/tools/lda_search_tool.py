"""
LDA Search tool for the chat agent
Searches DynamoDB for LDA filings and contributions with various filters
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional, Set
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
s3_client = boto3.client('s3')

# Environment variables
FILINGS_TABLE_NAME = os.environ.get('FILINGS_TABLE_NAME', 'lda-filings')
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')

# Get DynamoDB table
filings_table = dynamodb.Table(FILINGS_TABLE_NAME) if FILINGS_TABLE_NAME else None


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
    """Remove surrounding quotes from a string"""
    if not value:
        return value
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def query_gsi_for_filing_ids(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_value: Optional[Any] = None,
    range_key_condition: Optional[str] = None,
    limit: int = 1000,
    exclusive_start_key: Optional[Dict] = None
) -> tuple[List[str], Optional[Dict]]:
    """
    Query a GSI to get filing IDs
    
    Returns:
        Tuple of (list of filing IDs, last_evaluated_key)
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    try:
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if range_key_name and range_key_value:
            if range_key_condition == 'gte':
                key_condition = key_condition & Key(range_key_name).gte(range_key_value)
            elif range_key_condition == 'lte':
                key_condition = key_condition & Key(range_key_name).lte(range_key_value)
            elif range_key_condition == 'between':
                # Assuming range_key_value is a tuple (start, end)
                if isinstance(range_key_value, (list, tuple)) and len(range_key_value) == 2:
                    key_condition = key_condition & Key(range_key_name).between(range_key_value[0], range_key_value[1])
        
        query_params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'PK, SK',
            'Limit': limit
        }
        
        if exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key
        
        response = filings_table.query(**query_params)
        
        filing_ids = []
        for item in response.get('Items', []):
            pk = item.get('PK', '')
            if pk.startswith('FILING#'):
                filing_id = pk.replace('FILING#', '')
                filing_ids.append(filing_id)
            elif pk.startswith('CONTRIBUTION#'):
                filing_id = pk.replace('CONTRIBUTION#', '')
                filing_ids.append(filing_id)
        
        last_eval_key = response.get('LastEvaluatedKey')
        return filing_ids, last_eval_key
        
    except Exception as e:
        logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
        raise


def get_all_from_gsi(query_func, *args, max_items: int = 50000, **kwargs) -> Set[str]:
    """Get all items from a GSI using internal pagination"""
    all_ids = set()
    exclusive_start_key = kwargs.pop('exclusive_start_key', None)
    
    while len(all_ids) < max_items:
        kwargs['exclusive_start_key'] = exclusive_start_key
        kwargs['limit'] = 1000  # Use larger limit for efficiency
        
        ids, last_key = query_func(*args, **kwargs)
        all_ids.update(ids)
        
        if not last_key or len(ids) == 0:
            break
        exclusive_start_key = last_key
    
    return all_ids


def query_search_index(
    search_type: str,
    search_values: List[str],
    limit: int = 1000,
    exclusive_start_key: Optional[Dict] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
) -> tuple[List[str], Optional[Dict]]:
    """
    Query materialized search index items to get entity PKs
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    if not search_values:
        return [], None
    
    search_value = clean_quotes(str(search_values[0]).strip())
    if not search_value:
        return [], None
    
    search_pk = f"SEARCH#{search_type}#{search_value}"
    key_condition = Key('PK').eq(search_pk)
    
    # Add date filtering if provided
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
            sk_end = f"DT_POSTED#{date_to_part}#~"
            key_condition = Key('PK').eq(search_pk) & Key('SK').between(sk_start, sk_end)
        elif date_from_part:
            sk_start = f"DT_POSTED#{date_from_part}#"
            key_condition = Key('PK').eq(search_pk) & Key('SK').gte(sk_start)
        elif date_to_part:
            sk_end = f"DT_POSTED#{date_to_part}#~"
            key_condition = Key('PK').eq(search_pk) & Key('SK').lte(sk_end)
    
    query_params = {
        'KeyConditionExpression': key_condition,
        'ProjectionExpression': 'entity_pk, SK',
        'Limit': limit
    }
    
    if exclusive_start_key:
        if isinstance(exclusive_start_key, dict) and 'search_index_key' in exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key['search_index_key']
        else:
            query_params['ExclusiveStartKey'] = exclusive_start_key
    
    response = filings_table.query(**query_params)
    
    entity_pks = []
    for item in response.get('Items', []):
        entity_pk = item.get('entity_pk')
        if entity_pk:
            entity_pks.append(str(entity_pk))
    
    last_eval_key = response.get('LastEvaluatedKey')
    return entity_pks, last_eval_key


def batch_get_filings(entity_pks: List[str], limit: int = 100) -> List[Dict[str, Any]]:
    """
    Batch get filing/contribution items from DynamoDB using entity PKs
    
    Args:
        entity_pks: List of entity PKs in format "FILING#uuid" or "CONTRIBUTION#uuid"
        limit: Maximum number of items to fetch
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    results = []
    entity_pks = entity_pks[:limit]  # Limit the number of PKs
    
    # DynamoDB BatchGetItem can handle up to 100 items
    for i in range(0, len(entity_pks), 100):
        batch_pks = entity_pks[i:i+100]
        
        # Build request items - entity_pks are already in correct format (FILING#uuid or CONTRIBUTION#uuid)
        request_items = {
            FILINGS_TABLE_NAME: {
                'Keys': [
                    {'PK': pk, 'SK': pk}  # PK and SK are the same for filings/contributions
                    for pk in batch_pks
                ]
            }
        }
        
        try:
            response = dynamodb.batch_get_item(RequestItems=request_items)
            items = response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
            results.extend(items)
        except Exception as e:
            logger.error(f"Error in batch_get_item: {str(e)}", exc_info=True)
            continue
    
    return results


def search_filings_simplified(
    filters: Dict[str, Any],
    limit: int = 5,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Simplified search filings function for agent tool
    
    Default limit is 5 to prevent massive searches without explicit user request.
    Users can request pagination or narrow their search as needed.
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    try:
        # Extract search parameters
        registrant_name = filters.get('registrant_name')
        client_name = filters.get('client_name')
        lobbyist_name = filters.get('lobbyist_name')
        pac_name = filters.get('pac_name')
        general_issue_code = filters.get('general_issue_code')
        government_entity = filters.get('government_entity')
        foreign_entity_name = filters.get('foreign_entity_name')
        date_from = filters.get('date_from')
        date_to = filters.get('date_to')
        filing_year = filters.get('filing_year')
        item_type = filters.get('item_type')
        
        # Collect entity PKs (FILING#uuid or CONTRIBUTION#uuid) from different sources
        # Use intersection logic: if multiple filters, only return filings that match ALL filters
        entity_pk_sets = []
        last_eval_keys = {}
        
        # Query registrant if provided
        if registrant_name:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(registrant_name, list):
                registrant_name = registrant_name[0] if registrant_name else None
            if registrant_name:
                registrant_name = clean_quotes(str(registrant_name).strip())
                if registrant_name:
                    # Get all filing IDs using pagination helper
                    filing_ids_set = get_all_from_gsi(
                        query_gsi_for_filing_ids,
                        index_name='RegistrantPostedDateIndex',
                        hash_key_name='registrant_name',
                        hash_key_value=registrant_name,
                        range_key_name='dt_posted',
                        range_key_value=date_from if date_from else None,
                        range_key_condition='gte' if date_from else None,
                        max_items=50000
                    )
                    # Convert filing IDs to entity PKs (assume FILING# for GSI queries)
                    entity_pks = {f'FILING#{fid}' if not fid.startswith('FILING#') and not fid.startswith('CONTRIBUTION#') else fid for fid in filing_ids_set}
                    entity_pk_sets.append(entity_pks)
                    logger.info(f"Registrant '{registrant_name}': Found {len(entity_pks)} entity PKs")
        
        # Query client if provided
        if client_name:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(client_name, list):
                client_name = client_name[0] if client_name else None
            if client_name:
                client_name = clean_quotes(str(client_name).strip())
                if client_name:
                    # Get all filing IDs using pagination helper
                    filing_ids_set = get_all_from_gsi(
                        query_gsi_for_filing_ids,
                        index_name='ClientPostedDateIndex',
                        hash_key_name='client_name',
                        hash_key_value=client_name,
                        range_key_name='dt_posted',
                        range_key_value=date_from if date_from else None,
                        range_key_condition='gte' if date_from else None,
                        max_items=50000
                    )
                    # Convert filing IDs to entity PKs (assume FILING# for GSI queries)
                    entity_pks = {f'FILING#{fid}' if not fid.startswith('FILING#') and not fid.startswith('CONTRIBUTION#') else fid for fid in filing_ids_set}
                    entity_pk_sets.append(entity_pks)
                    logger.info(f"Client '{client_name}': Found {len(entity_pks)} entity PKs")
        
        # Query lobbyist using search index if provided
        if lobbyist_name:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(lobbyist_name, list):
                lobbyist_name = lobbyist_name[0] if lobbyist_name else None
            if lobbyist_name:
                lobbyist_name = clean_quotes(str(lobbyist_name).strip())
                if lobbyist_name:
                    # Get all entity PKs using pagination - need to implement pagination for search_index
                    all_entity_pks_list = []
                    exclusive_start_key = None
                    while len(all_entity_pks_list) < 50000:
                        entity_pks, last_key = query_search_index(
                            search_type='LOBBYIST',
                            search_values=[lobbyist_name],
                            limit=1000,
                            exclusive_start_key=exclusive_start_key,
                            date_from=date_from,
                            date_to=date_to
                        )
                        all_entity_pks_list.extend(entity_pks)
                        if not last_key or len(entity_pks) == 0:
                            break
                        exclusive_start_key = last_key
                    # Keep entity PKs as-is (already in FILING#uuid or CONTRIBUTION#uuid format)
                    entity_pk_sets.append(set(all_entity_pks_list))
                    logger.info(f"Lobbyist '{lobbyist_name}': Found {len(all_entity_pks_list)} entity PKs")
        
        # Query PAC using search index if provided
        if pac_name:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(pac_name, list):
                pac_name = pac_name[0] if pac_name else None
            if pac_name:
                pac_name = clean_quotes(str(pac_name).strip())
                if pac_name:
                    # Get all entity PKs using pagination
                    all_entity_pks_list = []
                    exclusive_start_key = None
                    while len(all_entity_pks_list) < 50000:
                        entity_pks, last_key = query_search_index(
                            search_type='PAC',
                            search_values=[pac_name],
                            limit=1000,
                            exclusive_start_key=exclusive_start_key,
                            date_from=date_from,
                            date_to=date_to
                        )
                        all_entity_pks_list.extend(entity_pks)
                        if not last_key or len(entity_pks) == 0:
                            break
                        exclusive_start_key = last_key
                    # Keep entity PKs as-is (already in FILING#uuid or CONTRIBUTION#uuid format)
                    entity_pk_sets.append(set(all_entity_pks_list))
                    logger.info(f"PAC '{pac_name}': Found {len(all_entity_pks_list)} entity PKs")
        
        # Query general issue code using search index if provided
        if general_issue_code:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(general_issue_code, list):
                general_issue_code = general_issue_code[0] if general_issue_code else None
            if general_issue_code:
                general_issue_code = clean_quotes(str(general_issue_code).strip())
                if general_issue_code:
                    # Get all entity PKs using pagination
                    all_entity_pks_list = []
                    exclusive_start_key = None
                    while len(all_entity_pks_list) < 50000:
                        entity_pks, last_key = query_search_index(
                            search_type='GENERAL_ISSUE',
                            search_values=[general_issue_code],
                            limit=1000,
                            exclusive_start_key=exclusive_start_key,
                            date_from=date_from,
                            date_to=date_to
                        )
                        all_entity_pks_list.extend(entity_pks)
                        if not last_key or len(entity_pks) == 0:
                            break
                        exclusive_start_key = last_key
                    entity_pk_sets.append(set(all_entity_pks_list))
                    logger.info(f"General issue '{general_issue_code}': Found {len(all_entity_pks_list)} entity PKs")
        
        # Query government entity using search index if provided
        if government_entity:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(government_entity, list):
                government_entity = government_entity[0] if government_entity else None
            if government_entity:
                government_entity = clean_quotes(str(government_entity).strip())
                if government_entity:
                    # Get all entity PKs using pagination
                    all_entity_pks_list = []
                    exclusive_start_key = None
                    while len(all_entity_pks_list) < 50000:
                        entity_pks, last_key = query_search_index(
                            search_type='GOVERNMENT_ENTITY',
                            search_values=[government_entity],
                            limit=1000,
                            exclusive_start_key=exclusive_start_key,
                            date_from=date_from,
                            date_to=date_to
                        )
                        all_entity_pks_list.extend(entity_pks)
                        if not last_key or len(entity_pks) == 0:
                            break
                        exclusive_start_key = last_key
                    entity_pk_sets.append(set(all_entity_pks_list))
                    logger.info(f"Government entity '{government_entity}': Found {len(all_entity_pks_list)} entity PKs")
        
        # Query foreign entity using search index if provided
        if foreign_entity_name:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(foreign_entity_name, list):
                foreign_entity_name = foreign_entity_name[0] if foreign_entity_name else None
            if foreign_entity_name:
                foreign_entity_name = clean_quotes(str(foreign_entity_name).strip())
                if foreign_entity_name:
                    # Get all entity PKs using pagination
                    all_entity_pks_list = []
                    exclusive_start_key = None
                    while len(all_entity_pks_list) < 50000:
                        entity_pks, last_key = query_search_index(
                            search_type='FOREIGN_COUNTRY',
                            search_values=[foreign_entity_name],
                            limit=1000,
                            exclusive_start_key=exclusive_start_key,
                            date_from=date_from,
                            date_to=date_to
                        )
                        all_entity_pks_list.extend(entity_pks)
                        if not last_key or len(entity_pks) == 0:
                            break
                        exclusive_start_key = last_key
                    entity_pk_sets.append(set(all_entity_pks_list))
                    logger.info(f"Foreign entity '{foreign_entity_name}': Found {len(all_entity_pks_list)} entity PKs")
        
        # Query by filing year if provided
        if filing_year:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(filing_year, list):
                filing_year = filing_year[0] if filing_year else None
            if filing_year:
                try:
                    filing_year_int = int(filing_year) if isinstance(filing_year, (int, str)) else filing_year
                    # Get all filing IDs using pagination helper
                    filing_ids_set = get_all_from_gsi(
                        query_gsi_for_filing_ids,
                        index_name='YearPostedDateIndex',
                        hash_key_name='filing_year',
                        hash_key_value=filing_year_int,
                        range_key_name='dt_posted',
                        range_key_value=date_from if date_from else None,
                        range_key_condition='gte' if date_from else None,
                        max_items=50000
                    )
                    # Convert filing IDs to entity PKs (assume FILING# for GSI queries)
                    entity_pks = {f'FILING#{fid}' if not fid.startswith('FILING#') and not fid.startswith('CONTRIBUTION#') else fid for fid in filing_ids_set}
                    entity_pk_sets.append(entity_pks)
                    logger.info(f"Filing year '{filing_year}': Found {len(entity_pks)} entity PKs")
                except (ValueError, TypeError) as e:
                    logger.warning(f"Error parsing filing_year: {e}")
        
        # Query by item type if provided
        if item_type:
            # Extract first value if list (combinatorial logic handled by agent)
            if isinstance(item_type, list):
                item_type = item_type[0] if item_type else None
            if item_type:
                item_type_upper = str(item_type).upper().strip()
                # Get all filing IDs using pagination helper
                filing_ids_set = get_all_from_gsi(
                    query_gsi_for_filing_ids,
                    index_name='ItemTypePostedDateIndex',
                    hash_key_name='item_type',
                    hash_key_value=item_type_upper,
                    range_key_name='dt_posted',
                    range_key_value=date_from if date_from else None,
                    range_key_condition='gte' if date_from else None,
                    max_items=50000
                )
                # Convert filing IDs to entity PKs (assume FILING# for GSI queries, but item_type filter will handle CONTRIBUTION#)
                entity_pks = {f'FILING#{fid}' if not fid.startswith('FILING#') and not fid.startswith('CONTRIBUTION#') else fid for fid in filing_ids_set}
                entity_pk_sets.append(entity_pks)
                logger.info(f"Item type '{item_type_upper}': Found {len(entity_pks)} entity PKs")
        
        # Intersect all entity PK sets (AND logic across filters)
        if entity_pk_sets:
            all_entity_pks = entity_pk_sets[0]
            for entity_pk_set in entity_pk_sets[1:]:
                all_entity_pks = all_entity_pks.intersection(entity_pk_set)
        else:
            all_entity_pks = set()
        
        # If no specific filters, return empty
        if not all_entity_pks:
            return {
                'success': True,
                'results': [],
                'count': 0,
                'has_more': False
            }
        
        # Fetch full items (limited to requested limit)
        # Convert entity PKs to format expected by batch_get_filings
        entity_pks_list = list(all_entity_pks)[:limit]
        items = batch_get_filings(entity_pks_list, limit=limit)
        
        # Convert items
        results = [convert_decimal_to_float(item) for item in items]
        
        # Determine if there are more results
        has_more = len(all_entity_pks) > len(results)
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'total_matched': len(all_entity_pks),
            'has_more': has_more,
            'last_evaluated_keys': last_eval_keys if last_eval_keys else None
        }
        
    except Exception as e:
        logger.error(f"Error searching filings: {str(e)}", exc_info=True)
        raise


def store_results_in_s3(results: Dict[str, Any], user_id: str, session_id: str) -> str:
    """
    Store search results in S3 and return the S3 key
    """
    try:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"lda_search_{timestamp}.json.gz"
        s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
        
        # Compress results
        results_json = json.dumps(results, default=str)
        compressed = gzip.compress(results_json.encode('utf-8'))
        
        s3_client.put_object(
            Bucket=CHAT_FILES_BUCKET_NAME,
            Key=s3_key,
            Body=compressed,
            ContentType='application/gzip',
            ContentEncoding='gzip'
        )
        
        logger.info(f"Stored LDA search results in S3: {s3_key} ({len(compressed)} bytes compressed, {len(results.get('results', []))} results)")
        
        return s3_key
        
    except Exception as e:
        logger.error(f"Error storing results in S3: {str(e)}", exc_info=True)
        raise


@tool
def lda_search(
    filters: str,
    limit: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for LDA (Lobbying Disclosure Act) filings and contributions.
    
    **IMPORTANT: Use autocomplete before searching:**
    Before using this tool, you should first use lda_autocomplete to find the exact names of registrants, clients,
    lobbyists, or PACs, especially if the user provides a generic name like "Apple" or "Microsoft".
    
    **Workflow for generic names:**
    1. User asks for contracts/filings on "X company"
    2. First use lda_autocomplete("X company") to find all matches (limit: 10)
    3. If multiple types have matches (e.g., "Apple" as both client and registrant),
       ask the user to clarify which type they want, OR if matches are very similar, run searches for all matches
    4. User selects or agent proceeds with autocompleted value(s)
    5. Use lda_search with the exact autocompleted name(s)
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - registrant_name: Name of the registrant (lobbying firm)
            - client_name: Name of the client (entity being lobbied for)
            - lobbyist_name: Name of the lobbyist
            - pac_name: Name of the PAC (Political Action Committee)
            - general_issue_code: General issue code name (e.g., "Foreign Relations")
            - government_entity: Government entity name (e.g., "State, Dept of (DOS)")
            - foreign_entity_name: Foreign country/entity name
            - date_from: Start date in YYYY-MM-DD format
            - date_to: End date in YYYY-MM-DD format
            - filing_year: Filing year (integer, e.g., 2023)
            - item_type: Item type - "FILING" or "CONTRIBUTION" (default: both)
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
        
    Note: Multiple filters use AND logic (intersection) - results must match ALL specified filters.
    
    Returns:
        JSON string with search results. For large results (>50 items or >50KB), returns S3 key reference.
        Results include filing details such as registrant, client, filing dates, amounts, and lobbying activities.
        
    Example:
        # Search for Apple as a client
        lda_search('{"client_name": "APPLE INC.", "date_from": "2020-01-01"}')
        
        # Search for a specific lobbyist
        lda_search('{"lobbyist_name": "JOHN SMITH"}')
        
        # Search for PAC contributions
        lda_search('{"pac_name": "American Israel Public Affairs Committee"}')
    """
    try:
        agent_logger.info(f"🔍 lda_search called with filters: {filters}, limit: {limit}")
        
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
        result = search_filings_simplified(filters_dict, limit=limit, last_evaluated_key=last_key)
        
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, total_matched={result.get('total_matched', 'N/A')}, has_more={result.get('has_more', False)}")
        
        if not result.get('success'):
            return json.dumps(result, default=str)
        
        # Check if result is large enough to store in S3
        result_json = json.dumps(result)
        result_size = len(result_json)
        result_count = result.get('count', 0)
        
        LARGE_DATA_THRESHOLD = 50000  # 50KB
        LARGE_RESULTS_THRESHOLD = 50  # 50 results
        
        should_store_in_s3 = (
            result_size > LARGE_DATA_THRESHOLD or 
            result_count > LARGE_RESULTS_THRESHOLD
        )
        
        if should_store_in_s3:
            # Store in S3
            try:
                user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID', 'default')
                session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                
                s3_key = store_results_in_s3(result, user_id, session_id)
                
                agent_logger.info(f"Stored LDA search results in S3: {s3_key} ({result_size} bytes, {result_count} results)")
                
                # Create summary
                results_list = result.get('results', [])
                summary = {
                    "status": "success",
                    "s3_key": s3_key,
                    "data_size_bytes": result_size,
                    "count": result_count,
                    "total_matched": result.get('total_matched', result_count),
                    "has_more": result.get('has_more', False),
                    "message": f"Large dataset ({result_count} results) stored in S3. Use read_s3_file_tool to access: {s3_key}",
                    "summary": {
                        "total_results": result_count,
                        "total_matched": result.get('total_matched', result_count),
                        "has_more": result.get('has_more', False),
                        "sample_results": results_list[:5] if results_list else []  # Include first 5 as sample
                    }
                }
                
                return json.dumps(summary, default=str)
                
            except Exception as s3_error:
                logger.error(f"Error storing results in S3: {str(s3_error)}")
                # Fall back to returning result directly (may be truncated)
                return json.dumps(result, default=str)
        
        # Return result directly for small datasets
        return json.dumps(result, default=str)
        
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON in filters: {str(e)}"
        logger.error(error_msg)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
    except Exception as e:
        error_msg = f"Error searching LDA filings: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
