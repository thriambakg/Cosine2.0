"""
Congress Bills Search tool for the chat agent
Searches congressional bills by invoking the Congress Bills Search Lambda function
The Lambda function handles all DynamoDB queries, filtering, and pagination logic
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime
import sys

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
s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')

# Environment variables
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'staging')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'cosine')

# Lambda function name for congress bills search
CONGRESS_BILLS_SEARCH_LAMBDA_NAME = f"{PROJECT_NAME}-congress-bills-search-{ENVIRONMENT}"


def _congress_for_date(date_str: Optional[str]) -> Optional[int]:
    """
    Return the Congress number (e.g. 119) that was in session on the given date.
    date_str: YYYY-MM-DD. Uses current date if None or invalid.
    Formula: Congress N runs from year 1789+2*(N-1) through 1789+2*N-1; congress = ((year - 1789) // 2) + 1.
    """
    if date_str:
        try:
            parts = str(date_str).strip()[:10].split('-')
            if len(parts) >= 1 and parts[0].isdigit():
                year = int(parts[0])
                if 1789 <= year <= 2100:
                    return ((year - 1789) // 2) + 1
        except (ValueError, TypeError):
            pass
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return ((now.year - 1789) // 2) + 1


def _normalize_filters_for_lambda(filters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize filter types to match DynamoDB schema (BillNumberDateIndex expects bill_number as number).
    The Lambda/GSI fails with ValidationException if bill_number is sent as string.
    """
    out = dict(filters)
    if 'bill_number' in out:
        v = out['bill_number']
        if isinstance(v, str) and v.isdigit():
            out['bill_number'] = int(v)
        elif isinstance(v, (list, tuple)):
            out['bill_number'] = [int(x) if isinstance(x, str) and str(x).isdigit() else x for x in v]
    if 'congress' in out:
        v = out['congress']
        if isinstance(v, str) and v.isdigit():
            out['congress'] = int(v)
        elif isinstance(v, (list, tuple)):
            out['congress'] = [int(x) if isinstance(x, str) and str(x).isdigit() else x for x in v]
    return out


def invoke_congress_bills_search_lambda(
    filters: Dict[str, Any],
    limit: int = 10,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Invoke the Congress Bills Search Lambda function directly (bill search).
    """
    try:
        filters = _normalize_filters_for_lambda(filters)
        body = {
            'filters': filters,
            'limit': limit,
            'last_evaluated_key': last_evaluated_key
        }
        return _invoke_lambda_with_body(body)
    except Exception as e:
        logger.error(f"Error invoking Congress Bills Search Lambda: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f"Failed to invoke search Lambda: {str(e)}"
        }


def invoke_roll_call_search_lambda(roll_call_search: Dict[str, Any]) -> Dict[str, Any]:
    """
    Invoke the Congress Bills Search Lambda with roll_call_search body (SEARCH#VOTE or SEARCH#ROLL).
    """
    try:
        body = {'roll_call_search': roll_call_search}
        return _invoke_lambda_with_body(body)
    except Exception as e:
        logger.error(f"Error invoking roll call search Lambda: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'count': 0,
            'has_more': False,
        }


def _invoke_lambda_with_body(body: Dict[str, Any]) -> Dict[str, Any]:
    """Send POST body to Congress Bills Search Lambda and return parsed response."""
    try:
        lambda_event = {
            'httpMethod': 'POST',
            'body': json.dumps(body),
            'headers': {},
            'requestContext': {'http': {'method': 'POST'}},
        }
        logger.info(f"Invoking Congress Bills Search Lambda: {CONGRESS_BILLS_SEARCH_LAMBDA_NAME}")
        response = lambda_client.invoke(
            FunctionName=CONGRESS_BILLS_SEARCH_LAMBDA_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps(lambda_event)
        )
        if 'FunctionError' in response:
            error_payload = json.loads(response['Payload'].read())
            logger.error(f"Lambda function error: {error_payload}")
            return {
                'success': False,
                'error': error_payload.get('errorMessage', 'Lambda function error')
            }
        response_payload = json.loads(response['Payload'].read())
        if response_payload.get('statusCode') == 200:
            result = json.loads(response_payload.get('body', '{}'))
            logger.info(f"Lambda completed: count={result.get('count', 0)}, has_more={result.get('has_more', False)}")
            return result
        error_body = json.loads(response_payload.get('body', '{}'))
        logger.error(f"Lambda error status {response_payload.get('statusCode')}: {error_body}")
        return {
            'success': False,
            'error': error_body.get('error', f"Lambda returned status {response_payload.get('statusCode')}")
        }
    except Exception as e:
        logger.error(f"Error invoking Lambda: {str(e)}", exc_info=True)
        return {'success': False, 'error': str(e)}


class CongressBillsSearcher:
    """
    Searches congressional bills by invoking the Lambda function
    Handles S3 passthrough for large result sets
    """
    
    @staticmethod
    def search_bills_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 10,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search bills by invoking Lambda and store large results in S3 if needed
        
        Args:
            filters: Search filters dictionary
            limit: Maximum number of results
            last_evaluated_key: Pagination token
        
        Returns:
            Search results dictionary (or S3 reference for large datasets)
        """
        try:
            # Invoke Lambda function to perform search
            result = invoke_congress_bills_search_lambda(filters, limit, last_evaluated_key)
            
            # Check if Lambda returned an error
            if not result.get('success', True):
                return result
            
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
                    # SECURITY: Get user_id from secure source
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
                        "method": result.get('method', 'query'),
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
    last_evaluated_key: str = None,
    roll_call_search: str = None,
    question_date: str = None
) -> str:
    """
    Search for congressional bills OR roll call votes by invoking the Congress Bills Search Lambda.
    
    **Two modes:**
    1. **Bill search** (default): Pass filters (and optionally limit, last_evaluated_key). Use for bills by sponsor, policy area, congress, etc.
    2. **Roll call search**: Pass roll_call_search (JSON) to search roll call votes. Use question_date to default congress to the most recent congress for that date (e.g. question date "2025-02-01" -> congress 119).
    
    **Roll call search (roll_call_search parameter):**
    - **SEARCH#VOTE** (by politician): Use when the user asks for a politician's votes or roll call record.
      - ALWAYS use search_autocomplete(query, "congress_legislator", limit=10) first to get politician_id (bioguide_id).
      - Pass politician_ids from the autocomplete result (use the "politician_id" field from matches).
      - Example: roll_call_search = '{"search_index": "SEARCH#VOTE", "politician_ids": ["C000127", "K000367"], "limit": 50}'
    - **SEARCH#ROLL** (by congress/session/roll): Use when listing roll calls for a congress or looking up a specific roll.
      - If congress is omitted, it is defaulted from question_date (or today). Pass question_date (YYYY-MM-DD) so "current" or "recent" means the congress in session on that date.
      - Example: roll_call_search = '{"search_index": "SEARCH#ROLL", "congress": 119, "session": 1, "limit": 20}' or omit congress and set question_date to default it.
    
    **Autocomplete for roll call (politician votes):**
    - Call search_autocomplete("Senator Name", "congress_legislator", limit=10) first.
    - Use the returned "politician_id" (bioguide_id) from matches in roll_call_search.politician_ids.
    
    **Default congress for roll calls:**
    - When question_date is provided and roll_call_search does not include congress (SEARCH#ROLL), congress is set to the congress in session on question_date (e.g. 2025-02-14 -> 119).
    
    **IMPORTANT: Use autocomplete before bill searches:**
    For sponsor_name, cosponsor_name, and policy_area, use search_autocomplete to find exact values.
    For roll call by politician, use search_autocomplete to get politician_id for roll_call_search.politician_ids.
    
    Args:
        filters: JSON string of filter fields for BILL search (ignored if roll_call_search is provided). Supported: sponsor_name, politician_name, cosponsor_name, politician_role, bill_title, bill_type, sponsor_party, sponsor_state, policy_area, bipartisan, bill_number, congress, introduced_date_from/to, latest_action_date_from/to.
        limit: Max results for bill search (default 5, max 1000). For roll call search, limit is inside roll_call_search JSON.
        last_evaluated_key: Pagination token for bill search (optional).
        roll_call_search: Optional JSON string for roll call search. Must include "search_index": "SEARCH#VOTE" or "SEARCH#ROLL". For SEARCH#VOTE include "politician_ids" (list of bioguide_id from search_autocomplete). For SEARCH#ROLL include "congress" (optional if question_date set), optional "session", "roll", "limit", "last_evaluated_key".
        question_date: Optional YYYY-MM-DD. Used to default roll call congress when not specified (most recent congress for that date).
    
    Returns:
        JSON string: bill search returns results/s3_key; roll call search returns results array with vote/roll data, bill_details, roll_dates when applicable.
    """
    try:
        # --- Roll call search path ---
        if roll_call_search:
            if isinstance(roll_call_search, str):
                rcs = json.loads(roll_call_search)
            else:
                rcs = dict(roll_call_search)
            search_index = (rcs.get('search_index') or '').strip().upper()
            if search_index not in ('SEARCH#VOTE', 'SEARCH#ROLL'):
                return json.dumps({
                    'success': False,
                    'error': 'roll_call_search must include "search_index": "SEARCH#VOTE" or "SEARCH#ROLL"',
                    'results': [], 'count': 0, 'has_more': False
                })
            # Default congress from question_date when doing SEARCH#ROLL and congress not set
            if search_index == 'SEARCH#ROLL' and rcs.get('congress') is None and (question_date or True):
                congress_val = _congress_for_date(question_date)
                if congress_val is not None:
                    rcs['congress'] = congress_val
                    agent_logger.info(f"Defaulted roll call congress to {congress_val} from question_date={question_date}")
            limit_rc = rcs.get('limit', 100)
            limit_rc = max(1, min(int(limit_rc) if limit_rc else 100, 100))
            rcs['limit'] = limit_rc
            agent_logger.info(f"🔍 search_congress_bills roll_call_search: search_index={search_index}, question_date={question_date}")
            result = invoke_roll_call_search_lambda(rcs)
            return json.dumps(result, default=str)
        
        # --- Bill search path ---
        agent_logger.info(f"🔍 search_congress_bills called with filters: {filters}, limit: {limit}")
        if isinstance(filters, str):
            filters_dict = json.loads(filters)
        else:
            filters_dict = filters
        agent_logger.info(f"📋 Parsed filters: {filters_dict}")
        last_key = None
        if last_evaluated_key:
            last_key = json.loads(last_evaluated_key) if isinstance(last_evaluated_key, str) else last_evaluated_key
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 5
        result = CongressBillsSearcher.search_bills_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, method={result.get('method', 'unknown')}")
        return json.dumps(result, default=str)
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON: {str(e)}"
        logger.error(error_msg)
        return json.dumps({"success": False, "error": error_msg})
    except Exception as e:
        error_msg = f"Error searching congress bills: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({"success": False, "error": error_msg})
