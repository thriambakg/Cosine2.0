"""
Roll call search helper: queries SEARCH#VOTE and SEARCH#ROLL indices.
Returns full table rows, 100 items per page.
Supports resolving bill IDs to projections (title, etc.) and computing vote summaries from members.
"""

import logging
from typing import Dict, List, Any, Optional
from collections import defaultdict

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

# Page size for roll call search results
ROLL_CALL_PAGE_LIMIT = 100

# Attributes to project when resolving bills (filterable/display only)
BILL_PROJECTION_ATTRS = ['bill_id', 'bill_title', 'short_title', 'latest_action_text', 'latest_action_date']


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


def _normalize_vote_cast(vote_cast: Any) -> str:
    """Map Congress.gov voteCast to display bucket: Yea, Nay, Present, Not Voting."""
    if vote_cast is None:
        return 'Not Voting'
    v = str(vote_cast).strip().lower()
    if v in ('yea', 'yes'):
        return 'Yea'
    if v in ('nay', 'no'):
        return 'Nay'
    if v in ('present', 'present (not voting)'):
        return 'Present'
    if v in ('not voting', 'not voting (present)'):
        return 'Not Voting'
    # Fallback: capitalize first letter
    return str(vote_cast).strip() or 'Not Voting'


def compute_vote_summary(members: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compute aggregate vote counts from a list of member vote dicts (from SEARCH#ROLL).
    Each member can have: voteCast, voteParty/party, state/stateCode, name/firstName/lastName.
    Returns: { total: { yea, nay, present, not_voting }, by_party: { D: { yea, nay, present, not_voting }, R: {}, I: {} } }
    """
    total = defaultdict(int)
    by_party: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for m in members or []:
        if not isinstance(m, dict):
            continue
        vote = _normalize_vote_cast(m.get('voteCast'))
        party_raw = (m.get('voteParty') or m.get('party') or '').strip().upper()
        party = party_raw[0] if party_raw else 'I'  # D, R, or I
        if party not in ('D', 'R'):
            party = 'I'
        key = vote.lower().replace(' ', '_')
        if key == 'yea':
            total['yea'] += 1
            by_party[party]['yea'] += 1
        elif key == 'nay':
            total['nay'] += 1
            by_party[party]['nay'] += 1
        elif key == 'present':
            total['present'] += 1
            by_party[party]['present'] += 1
        else:
            total['not_voting'] += 1
            by_party[party]['not_voting'] += 1
    return {
        'total': dict(total),
        'by_party': {p: dict(counts) for p, counts in by_party.items()},
    }


def fetch_bill_projections(table, bill_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Batch fetch minimal bill attributes for display/filtering.
    Returns dict: bill_id -> { bill_id, bill_title, short_title, latest_action_text, latest_action_date }.
    Only includes bills that exist and are not search index items.
    """
    if not table or not bill_ids:
        return {}
    unique_ids = list(dict.fromkeys(str(bid).strip() for bid in bill_ids if bid and str(bid).strip()))
    if not unique_ids:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    batch_size = 100
    for i in range(0, len(unique_ids), batch_size):
        batch = unique_ids[i:i + batch_size]
        keys = [{'bill_id': str(bid), 'search_index_sk': str(bid)} for bid in batch]
        try:
            response = table.meta.client.batch_get_item(
                RequestItems={
                    table.name: {
                        'Keys': keys,
                        'ProjectionExpression': ','.join(BILL_PROJECTION_ATTRS),
                    }
                }
            )
            items = response.get('Responses', {}).get(table.name, [])
            for item in items:
                bid = item.get('bill_id')
                if not bid or str(bid).startswith('SEARCH#'):
                    continue
                out[str(bid)] = _convert_decimal({
                    'bill_id': bid,
                    'bill_title': item.get('bill_title') or item.get('title') or '',
                    'short_title': item.get('short_title') or '',
                    'latest_action_text': item.get('latest_action_text') or item.get('latest_action') or '',
                    'latest_action_date': item.get('latest_action_date') or '',
                })
        except Exception as e:
            logger.warning(f"fetch_bill_projections batch error: {e}")
    return out


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


def get_roll_call_item(
    table,
    congress: int,
    session: int,
    roll: int,
) -> Optional[Dict[str, Any]]:
    """
    Fetch a single SEARCH#ROLL item by congress, session, roll.
    Returns the raw item (members may be in members_oversize_s3_key).
    """
    if not table or congress is None or session is None or roll is None:
        return None
    sk = f"{congress}#{session}#{roll}"
    try:
        response = table.get_item(
            Key={'bill_id': 'SEARCH#ROLL', 'search_index_sk': sk}
        )
        item = response.get('Item')
        if item:
            return _convert_decimal(item)
        return None
    except Exception as e:
        logger.error(f"Error in get_roll_call_item: {e}", exc_info=True)
        return None
