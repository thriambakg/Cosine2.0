"""
Roll call search helper: queries SEARCH#VOTE and SEARCH#ROLL indices.
Returns full table rows, 100 items per page.
"""

import logging
from typing import Dict, List, Any, Optional

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

# Page size for roll call search results
ROLL_CALL_PAGE_LIMIT = 100


def _convert_decimal(obj: Any) -> Any:
    """Recursively convert Decimal to float for JSON."""
    from decimal import Decimal
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimal(v) for v in obj]
    return obj


def search_roll_call_vote(
    table,
    politician_ids: List[str],
    limit: int = ROLL_CALL_PAGE_LIMIT,
    last_evaluated_key: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Fetch SEARCH#VOTE items for the given politician IDs.
    Each item is PK=SEARCH#VOTE#<politician_id>, SK=VOTE.
    Returns full item per row, up to `limit` (default 100) per page.

    Pagination: pass offset in last_evaluated_key as {'offset': N} to skip first N ids.
    """
    if not table or not politician_ids:
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#VOTE',
        }

    offset = 0
    if last_evaluated_key and isinstance(last_evaluated_key, dict):
        offset = last_evaluated_key.get('offset', 0)
        if not isinstance(offset, int) or offset < 0:
            offset = 0

    # Deduplicate and order
    ids_ordered = list(dict.fromkeys(str(p).strip() for p in politician_ids if p and str(p).strip()))
    slice_ids = ids_ordered[offset:offset + limit]
    if not slice_ids:
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#VOTE',
        }

    keys = [{'bill_id': f'SEARCH#VOTE#{pid}', 'search_index_sk': 'VOTE'} for pid in slice_ids]
    try:
        response = table.meta.client.batch_get_item(
            RequestItems={
                table.name: {'Keys': keys}
            }
        )
        items = response.get('Responses', {}).get(table.name, [])
        # Preserve order by politician_id
        by_key = {(item.get('bill_id'), item.get('search_index_sk')): item for item in items}
        results = []
        for pid in slice_ids:
            key = (f'SEARCH#VOTE#{pid}', 'VOTE')
            if key in by_key:
                results.append(_convert_decimal(by_key[key]))
        next_offset = offset + len(slice_ids)
        has_more = next_offset < len(ids_ordered)
        next_key = {'offset': next_offset} if has_more else None
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': next_key,
            'search_index': 'SEARCH#VOTE',
        }
    except Exception as e:
        logger.error(f"Error in search_roll_call_vote: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#VOTE',
        }


def search_roll_call_rolls(
    table,
    congress: Optional[int] = None,
    session: Optional[int] = None,
    roll: Optional[int] = None,
    limit: int = ROLL_CALL_PAGE_LIMIT,
    last_evaluated_key: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Query SEARCH#ROLL index. PK=SEARCH#ROLL, SK={congress}#{session}#{roll}.
    Optional filters: congress, session, roll (exact SK if all three given; otherwise prefix).
    Returns full item per row, up to `limit` (default 100) per page.
    """
    if not table:
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#ROLL',
        }

    key_condition = Key('bill_id').eq('SEARCH#ROLL')
    if congress is not None and session is not None and roll is not None:
        sk = f"{congress}#{session}#{roll}"
        key_condition = key_condition & Key('search_index_sk').eq(sk)
    elif congress is not None and session is not None:
        sk_prefix = f"{congress}#{session}#"
        key_condition = key_condition & Key('search_index_sk').begins_with(sk_prefix)
    elif congress is not None:
        sk_prefix = f"{congress}#"
        key_condition = key_condition & Key('search_index_sk').begins_with(sk_prefix)

    params = {
        'KeyConditionExpression': key_condition,
        'Limit': limit,
    }
    if last_evaluated_key and isinstance(last_evaluated_key, dict) and last_evaluated_key.get('search_index_sk'):
        params['ExclusiveStartKey'] = last_evaluated_key

    try:
        response = table.query(**params)
        items = response.get('Items', [])
        lek = response.get('LastEvaluatedKey')
        return {
            'success': True,
            'results': [_convert_decimal(item) for item in items],
            'count': len(items),
            'has_more': bool(lek),
            'last_evaluated_key': _convert_decimal(lek) if lek else None,
            'search_index': 'SEARCH#ROLL',
        }
    except Exception as e:
        logger.error(f"Error in search_roll_call_rolls: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#ROLL',
        }
