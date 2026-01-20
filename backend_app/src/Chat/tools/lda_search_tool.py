"""
LDA Search tool for the chat agent
Searches LDA filings by invoking the LDA Search Lambda function
The Lambda function handles all DynamoDB queries, filtering, and pagination logic
"""

import json
import os
import logging
import boto3
import gzip
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
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME')
if not CHAT_FILES_BUCKET_NAME:
    raise ValueError("CHAT_FILES_BUCKET_NAME environment variable is required")

# Lambda function name for LDA search
LDA_SEARCH_LAMBDA_NAME = f"{PROJECT_NAME}-lda-search-{ENVIRONMENT}"


def invoke_lda_search_lambda(
    filters: Dict[str, Any],
    limit: int = 10,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Invoke the LDA Search Lambda function directly
    
    Args:
        filters: Search filters dictionary
        limit: Maximum number of results
        last_evaluated_key: Pagination token
    
    Returns:
        Search results dictionary
    """
    try:
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
        logger.info(f"Invoking LDA Search Lambda: {LDA_SEARCH_LAMBDA_NAME}")
        response = lambda_client.invoke(
            FunctionName=LDA_SEARCH_LAMBDA_NAME,
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
        logger.error(f"Error invoking LDA Search Lambda: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f"Failed to invoke search Lambda: {str(e)}"
        }


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
    Search for LDA (Lobbying Disclosure Act) filings and contributions by invoking the LDA Search Lambda function.
    The Lambda handles all DynamoDB queries, filtering, and pagination.
    
    **IMPORTANT: Use autocomplete before searching:**
    Before using this tool, you should first use lda_autocomplete to find the exact names of registrants, clients,
    lobbyists, or PACs, especially if the user provides a generic name like "Apple", "Microsoft", or "Tesla".
    
    **CRITICAL: When autocomplete returns multiple types, you MUST ask the user to select which one to use.**
    
    **Workflow for generic names:**
    1. User asks for lobbying documents from "X company" (e.g., "Tesla", "Apple")
    2. First use lda_autocomplete("X company") to find all matches (limit: 10)
    3. **If autocomplete returns "clarification_needed": true:**
       - You MUST ask the user: "I found [company] as both a [type1] and a [type2]. Which one would you like to search for?"
       - Wait for the user's response
       - Use the exact 'value' from the autocomplete results (e.g., "TESLA INC." not "Tesla")
    4. If only one type has matches, proceed directly with the exact autocompleted value
    5. Use lda_search with the exact autocompleted name(s) from the results
    
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
            - general_text_search_fields: Dict with fields to search (e.g., {"registrant": ["TESLA"], "client": ["TESLA"]})
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
        
    Note: Multiple filters use AND logic (intersection) - results must match ALL specified filters.
    Exception: general_text_search_fields uses OR logic within the field.
    
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
        
        # Invoke Lambda function to perform search
        result = invoke_lda_search_lambda(filters_dict, limit, last_key)
        
        # Check if Lambda returned an error
        if not result.get('success', True):
            agent_logger.error(f"❌ Lambda search failed: {result.get('error')}")
            return json.dumps(result, default=str)
        
        agent_logger.info(f"✅ Search completed: success={result.get('success')}, count={result.get('count', 0)}, has_more={result.get('has_more', False)}")
        
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
                # SECURITY: Get user_id from secure source
                try:
                    from utils.auth_helper import get_secure_user_id
                    user_id = get_secure_user_id({}, fallback_to_env=True)
                    if not user_id:
                        raise ValueError("User ID not available from secure authentication source")
                except ImportError:
                    # Fallback if auth_helper not available
                    user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                    if not user_id:
                        raise ValueError("User ID not available - authentication required")
                    logger.warning("⚠️ Using user_id from environment (auth_helper not available)")
                
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
                    "has_more": result.get('has_more', False),
                    "last_evaluated_key": result.get('last_evaluated_key'),
                    "method": result.get('method', 'query'),
                    "message": f"Large dataset ({result_count} results) stored in S3. Use read_s3_file_tool to access: {s3_key}",
                    "summary": {
                        "total_results": result_count,
                        "has_more": result.get('has_more', False),
                        "method": result.get('method', 'query'),
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
