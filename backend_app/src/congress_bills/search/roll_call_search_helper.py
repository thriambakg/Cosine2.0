"""
Roll call search helper: queries SEARCH#VOTE and SEARCH#ROLL indices.
Fetches all matching roll calls in one response (no pagination / load more).
Supports resolving bill IDs to projections (title, etc.) and computing vote summaries from members.
"""

import logging
from typing import Dict, List, Any, Optional
from collections import defaultdict

from boto3.dynamodb.conditions import Key, Attr

logger = logging.getLogger(__name__)

# Page size for roll call search results (used when resolving bill projections; roll call search fetches all)
ROLL_CALL_PAGE_LIMIT = 100

# Batch size for DynamoDB batch_get_item (max 100)
BATCH_GET_SIZE = 100

# Max items to fetch in one roll call search (fetch-all; avoid timeouts)
ROLL_CALL_VOTE_MAX_IDS = 5000
ROLL_CALL_ROLLS_MAX_ITEMS = 10000

# Attributes to project when resolving bills (match main bill search: filterable + display)
# Must include partition/sort keys; rest used by Refine filters and table columns
BILL_PROJECTION_ATTRS = [
    'bill_id',
    'search_index_sk',
    'bill_title',
    'bill_type',
    'bill_number',
    'sponsor_full_name',
    'sponsor_party',
    'sponsor_state',
    'introduced_date',
    'latest_action_date',
    'latest_action_text',
    'congress',
    'bipartisan',
    'policy_area',
]


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


def _parse_roll_sort_key_date(search_index_sk: Any) -> Optional[str]:
    """
    Parse latest_action_date from SEARCH#ROLL sort key when present.
    SK formats: {congress}#{date}#{session}#{roll} (4 parts; date at index 1) or legacy
    {congress}#{session}#{date}#{roll} (date at index 2). Returns YYYY-MM-DD or None.
    """
    if not search_index_sk:
        return None
    parts = str(search_index_sk).strip().split("#")
    if len(parts) < 4:
        return None
    for idx in (1, 2):
        if idx < len(parts):
            candidate = parts[idx].strip()
            if len(candidate) >= 10 and candidate.replace("-", "").isdigit():
                return candidate[:10]
    return None


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
    Batch fetch bill attributes for display and Refine filtering (same set as main bill search).
    Returns dict: bill_id -> { bill_id, bill_title, bill_type, bill_number, sponsor_full_name, ... }.
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
                    'bill_type': item.get('bill_type'),
                    'bill_number': item.get('bill_number'),
                    'sponsor_full_name': item.get('sponsor_full_name'),
                    'sponsor_party': item.get('sponsor_party'),
                    'sponsor_state': item.get('sponsor_state'),
                    'introduced_date': item.get('introduced_date'),
                    'congress': item.get('congress'),
                    'bipartisan': item.get('bipartisan'),
                    'policy_area': item.get('policy_area'),
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
    Fetch all SEARCH#VOTE items for the given politician IDs (batch get in chunks of 100).
    Each item is PK=SEARCH#VOTE#<politician_id>, SK=VOTE.
    Returns all matching items in one response; no pagination / load more.
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

    # Deduplicate and order; cap to avoid timeouts
    ids_ordered = list(dict.fromkeys(str(p).strip() for p in politician_ids if p and str(p).strip()))[:ROLL_CALL_VOTE_MAX_IDS]
    if not ids_ordered:
        return {
            'success': True,
            'results': [],
            'count': 0,
            'has_more': False,
            'last_evaluated_key': None,
            'search_index': 'SEARCH#VOTE',
        }

    by_key: Dict[tuple, Dict[str, Any]] = {}
    try:
        for i in range(0, len(ids_ordered), BATCH_GET_SIZE):
            batch_ids = ids_ordered[i:i + BATCH_GET_SIZE]
            keys = [{'bill_id': f'SEARCH#VOTE#{pid}', 'search_index_sk': 'VOTE'} for pid in batch_ids]
            response = table.meta.client.batch_get_item(
                RequestItems={table.name: {'Keys': keys}}
            )
            items = response.get('Responses', {}).get(table.name, [])
            for item in items:
                k = (item.get('bill_id'), item.get('search_index_sk'))
                by_key[k] = item
        # Preserve order by politician_id
        results = []
        for pid in ids_ordered:
            key = (f'SEARCH#VOTE#{pid}', 'VOTE')
            if key in by_key:
                results.append(_convert_decimal(by_key[key]))
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': False,
            'last_evaluated_key': None,
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


# Default congress when none provided (most recent); avoid querying entire SEARCH#ROLL partition
def _default_roll_congress() -> int:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return ((now.year - 1789) // 2) + 1


def search_roll_call_rolls(
    table,
    congress: Optional[int] = None,
    session: Optional[int] = None,
    roll: Optional[int] = None,
    limit: int = ROLL_CALL_PAGE_LIMIT,
    last_evaluated_key: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Query SEARCH#ROLL. PK=SEARCH#ROLL, SK=congress#date#session#roll (date-desc = newest first).
    DynamoDB returns items in sort-key order; no in-memory sort. Respects limit and last_evaluated_key
    for pagination: returns one page of results and has_more + last_evaluated_key when more exist.
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

    if congress is None:
        congress = _default_roll_congress()

    # SK = congress#date#session#roll → begins_with("119#") + ScanIndexForward=False = presorted newest first
    key_condition = Key('bill_id').eq('SEARCH#ROLL') & Key('search_index_sk').begins_with(f"{congress}#")
    filter_expr = None
    filter_attr_names: Dict[str, str] = {}
    if session is not None:
        filter_attr_names['#s'] = 'session'
        filter_expr = Attr('#s').eq(session)
    if roll is not None:
        filter_attr_names['#r'] = 'roll'
        filter_expr = Attr('#r').eq(roll) if filter_expr is None else filter_expr & Attr('#r').eq(roll)

    limit = max(1, min(int(limit), 500))  # batch size cap
    logger.info(f"search_roll_call_rolls: congress={congress}, session={session}, roll={roll}, limit={limit}, sk_prefix={congress!r}#")
    all_items: List[Dict[str, Any]] = []
    next_key = last_evaluated_key  # client sends this for "next page"
    page_limit = 300
    try:
        while len(all_items) < limit:
            params = {
                'KeyConditionExpression': key_condition,
                'Limit': min(page_limit, limit - len(all_items) + 50),
                'ScanIndexForward': False,
            }
            if filter_expr is not None:
                params['FilterExpression'] = filter_expr
                params['ExpressionAttributeNames'] = filter_attr_names
            if next_key:
                params['ExclusiveStartKey'] = next_key
            response = table.query(**params)
            items = response.get('Items', [])
            all_items.extend(items)
            next_key = response.get('LastEvaluatedKey')
            if not next_key or not items:
                break
        # Return exactly one page; preserve DynamoDB order (no sort)
        page = all_items[:limit]
        results = []
        for item in page:
            r = _convert_decimal(item)
            date_val = r.get('latest_action_date') or _parse_roll_sort_key_date(r.get('search_index_sk')) or ''
            r['latest_action_date'] = date_val
            r['project_update_date'] = date_val
            results.append(r)
        has_more = bool(next_key) or len(all_items) > limit
        last_key = None
        if page and has_more:
            last_key = {
                'bill_id': page[-1].get('bill_id', 'SEARCH#ROLL'),
                'search_index_sk': page[-1].get('search_index_sk'),
            }
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': last_key,
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
    SK = congress#date#session#roll; query begins_with(congress#) with FilterExpression session+roll.
    Returns the raw item (members may be in members_oversize_s3_key).
    """
    if not table or congress is None or session is None or roll is None:
        return None
    try:
        from decimal import Decimal
        key_condition = Key('bill_id').eq('SEARCH#ROLL') & Key('search_index_sk').begins_with(f"{congress}#")
        expr_names = {'#s': 'session', '#r': 'roll'}
        expr_vals = {':sval': Decimal(int(session)), ':rval': Decimal(int(roll))}
        next_key = None
        # ScanIndexForward=False: read newest first so session 2 (current) is in early pages
        for _ in range(20):
            params = {
                'KeyConditionExpression': key_condition,
                'FilterExpression': '#s = :sval AND #r = :rval',
                'ExpressionAttributeNames': expr_names,
                'ExpressionAttributeValues': expr_vals,
                'Limit': 500,
                'ScanIndexForward': False,
                'ProjectionExpression': 'bill_id, search_index_sk, #r',
            }
            if next_key:
                params['ExclusiveStartKey'] = next_key
            resp = table.query(**params)
            for it in resp.get('Items', []):
                rval = it.get('roll')
                if rval is not None and int(rval) == int(roll):
                    found_sk = it.get('search_index_sk')
                    if not found_sk:
                        continue
                    full = table.get_item(Key={'bill_id': 'SEARCH#ROLL', 'search_index_sk': found_sk})
                    full_item = full.get('Item')
                    if not full_item:
                        continue
                    out = _convert_decimal(full_item)
                    date_val = out.get('latest_action_date') or _parse_roll_sort_key_date(out.get('search_index_sk')) or ''
                    out['latest_action_date'] = date_val
                    out['project_update_date'] = date_val
                    return out
            next_key = resp.get('LastEvaluatedKey')
            if not next_key:
                break
        return None
    except Exception as e:
        logger.error(f"Error in get_roll_call_item: {e}", exc_info=True)
        return None


def get_roll_call_dates_for_keys(table, roll_keys: List[str]) -> Dict[str, str]:
    """
    Given roll keys in format "congress#session#roll", return a map key -> latest_action_date (YYYY-MM-DD).
    Used to attach update dates to SEARCH#VOTE flattened results. Queries SEARCH#ROLL by (congress, session).
    """
    if not table or not roll_keys:
        return {}
    seen: Dict[tuple, set] = {}  # (congress, session) -> set of roll numbers
    for raw in roll_keys[:2000]:  # cap
        parts = str(raw).strip().split("#")
        if len(parts) >= 3:
            try:
                c, s, r = int(parts[0]), int(parts[1]), int(parts[2])
                key = (c, s)
                if key not in seen:
                    seen[key] = set()
                seen[key].add(r)
            except (ValueError, TypeError):
                pass
    if not seen:
        return {}
    out: Dict[str, str] = {}
    for (congress, session), rolls in list(seen.items())[:80]:  # cap (congress, session) groups
        key_condition = Key('bill_id').eq('SEARCH#ROLL') & Key('search_index_sk').begins_with(f"{congress}#")
        filter_expr = Attr('#s').eq(session)  # session is reserved; use placeholder
        expr_names = {'#s': 'session', '#r': 'roll'}
        next_key = None
        for _ in range(20):  # pages per group
            params = {
                'KeyConditionExpression': key_condition,
                'FilterExpression': filter_expr,
                'ExpressionAttributeNames': expr_names,
                'Limit': 500,
                'ProjectionExpression': 'search_index_sk, #r',
            }
            if next_key:
                params['ExclusiveStartKey'] = next_key
            try:
                resp = table.query(**params)
            except Exception as e:
                logger.warning(f"get_roll_call_dates_for_keys query error: {e}")
                break
            for it in resp.get('Items', []):
                r = it.get('roll')
                if r is None:
                    continue
                rint = int(r)
                if rint not in rolls:
                    continue
                roll_key = f"{congress}#{session}#{rint}"
                date_val = _parse_roll_sort_key_date(it.get('search_index_sk')) or it.get('latest_action_date') or ''
                if date_val:
                    out[roll_key] = date_val[:10] if len(str(date_val)) >= 10 else str(date_val)
            next_key = resp.get('LastEvaluatedKey')
            if not next_key:
                break
    return out
