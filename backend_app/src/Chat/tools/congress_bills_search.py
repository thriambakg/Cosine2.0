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
    Invoke the Congress Bills Search Lambda function directly
    
    Args:
        filters: Search filters dictionary
        limit: Maximum number of results
        last_evaluated_key: Pagination token
    
    Returns:
        Search results dictionary
    """
    try:
        filters = _normalize_filters_for_lambda(filters)
        # Prepare Lambda event (mimics API Gateway event structure)
        lambda_event = {
            'httpMethod': 'POST',
            'body': json.dumps({
                'filters': filters,
                'limit': limit,
                'last_evaluated_key': last_evaluated_key
            }),
            'headers': {},
            'requestContext': {
                'http': {
                    'method': 'POST'
                }
            }
        }
        
        # Invoke Lambda function
        logger.info(f"Invoking Congress Bills Search Lambda: {CONGRESS_BILLS_SEARCH_LAMBDA_NAME}")
        response = lambda_client.invoke(
            FunctionName=CONGRESS_BILLS_SEARCH_LAMBDA_NAME,
            InvocationType='RequestResponse',  # Synchronous invocation
            Payload=json.dumps(lambda_event)
        )
        
        # Check for Lambda errors
        if 'FunctionError' in response:
            error_payload = json.loads(response['Payload'].read())
            logger.error(f"Lambda function error: {error_payload}")
            return {
                'success': False,
                'error': error_payload.get('errorMessage', 'Lambda function error')
            }
        
        # Parse response
        response_payload = json.loads(response['Payload'].read())
        
        # Lambda returns API Gateway-style response with statusCode and body
        if response_payload.get('statusCode') == 200:
            body = json.loads(response_payload.get('body', '{}'))
            logger.info(f"Lambda search completed: {body.get('count', 0)} results, has_more={body.get('has_more', False)}")
            return body
        else:
            # Error response
            error_body = json.loads(response_payload.get('body', '{}'))
            logger.error(f"Lambda returned error status {response_payload.get('statusCode')}: {error_body}")
            return {
                'success': False,
                'error': error_body.get('error', f"Lambda returned status {response_payload.get('statusCode')}")
            }
            
    except Exception as e:
        logger.error(f"Error invoking Congress Bills Search Lambda: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f"Failed to invoke search Lambda: {str(e)}"
        }


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
    last_evaluated_key: str = None
) -> str:
    """
    Search for congressional bills by invoking the Congress Bills Search Lambda function.
    The Lambda handles all DynamoDB queries, filtering, and pagination.
    
    **IMPORTANT: Use autocomplete before searching:**
    For sponsor_name, cosponsor_name, and policy_area searches, use search_autocomplete to find exact values.
    - For sponsor_name: Use search_autocomplete(query, "congress_legislator", limit=10)
    - For cosponsor_name: Use search_autocomplete(query, "congress_legislator", limit=10)
    - For policy_area: Use search_autocomplete(query, "policy_area", limit=10)
    If multiple matches, ask user to clarify OR if very similar, run searches for all matches.
    
    **Politician Role Filter:**
    - Use politician_role filter with sponsor_name to search both sponsor and cosponsor roles
    - politician_role can be: "sponsor", "cosponsor", or "both" (default: "both")
    - When politician_role is "both", searches both SponsorNameDateIndex (sponsor) and cosponsor search index, then unions results
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - sponsor_name: List or string of sponsor names (use autocomplete first for exact match)
            - politician_name: Alias for sponsor_name (use autocomplete first)
            - cosponsor_name: List or string of cosponsor names (use autocomplete first for exact match)
            - politician_role: "sponsor", "cosponsor", or "both" (default: "both") - used with sponsor_name/politician_name
            - bill_title: List or string of bill titles (exact match required via BillTitleDateIndex GSI)
            - bill_type: List or string of bill types (e.g., "HR", "S", "HJR", "SJR")
            - sponsor_party: List or string of sponsor parties (e.g., "R", "D", "I")
            - sponsor_state: List or string of sponsor states (2-letter codes)
            - policy_area: List or string of policy areas (use autocomplete first for exact match)
            - bipartisan: Integer (1 for bipartisan, 0 for non-bipartisan)
            - bill_number: Exact bill number
            - congress: Congress number (e.g., 118, 119)
            - introduced_date_from: Start date in YYYY-MM-DD format
            - introduced_date_to: End date in YYYY-MM-DD format
            - latest_action_date_from: Start date in YYYY-MM-DD format
            - latest_action_date_to: End date in YYYY-MM-DD format
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. Each bill result includes:
        - bill_id: Unique bill identifier (e.g., "119-HR-5789")
        - bill_title: Title of the bill
        - bill_texts: array of { name, s3_key, type } for stored HTML bill text (e.g. billtext/119-HR-5789/1.html); empty [] if none
        - bill_text_html_s3_key: (legacy) single S3 key when bill_texts not yet populated
          * Use data.s3_key from context (first from bill_texts or legacy key) or read each bill_texts[].s3_key via read_s3_file_tool to get full bill text
        - summary_text: Brief summary of the bill (if available)
        - sponsor information, cosponsors, actions, etc.
        For large result sets (>50KB or >50 results), returns S3 key reference instead of results array.
        
    Example:
        search_congress_bills(
            '{"bipartisan": 1, "bill_title": "Defense Authorization", "congress": 119}',
            limit=50
        )
        
    To read full bill text:
        Use data.s3_key from the context item (from bill_texts[0].s3_key or legacy bill_text_html_s3_key),
        or read each bill_texts[].s3_key (e.g. billtext/119-HR-5789/1.html) via read_s3_file_tool.
    """
    try:
        agent_logger.info(f"🔍 search_congress_bills called with filters: {filters}, limit: {limit}")
        
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
            limit = 5  # Default to 5 for compute efficiency
        
        agent_logger.info(f"📊 Search parameters: limit={limit}, pagination={'enabled' if last_key else 'disabled'}")
        
        # Perform search
        result = CongressBillsSearcher.search_bills_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, method={result.get('method', 'unknown')}")
        
        # Return as JSON string
        return json.dumps(result, default=str)
        
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON in filters: {str(e)}"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
    except Exception as e:
        error_msg = f"Error searching congress bills: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
