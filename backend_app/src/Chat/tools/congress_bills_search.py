"""
Congress Bills Search tool for the chat agent
Searches DynamoDB for congressional bills with various filters
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime
import sys

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'congress_bills', 'search'))

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

# Import search function from lambda
try:
    from lambda_function import search_bills
except ImportError:
    logger.error("Could not import search_bills from congress_bills lambda_function")
    search_bills = None

# AWS clients
s3_client = boto3.client('s3')


class CongressBillsSearcher:
    """
    Searches congressional bills in DynamoDB
    """
    
    @staticmethod
    def search_bills_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 100,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search bills and store large results in S3 if needed
        
        Args:
            filters: Dictionary of filter fields
            limit: Maximum number of results to return
            last_evaluated_key: Pagination token from previous request
            
        Returns:
            Dictionary with search results or S3 key reference
        """
        if not search_bills:
            return {
                "success": False,
                "error": "Congress bills search function not available"
            }
        
        try:
            # Perform search
            result = search_bills(filters, limit, last_evaluated_key)
            
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
                    user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID', 'default')
                    session_id = os.environ.get('SESSION_ID') or os.environ.get('CURRENT_SESSION_ID', 'default')
                    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
                    
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
                        "method": result.get('method', 'unknown'),
                        "index_used": result.get('index_used'),
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
    limit: int = 100,
    last_evaluated_key: str = None
) -> str:
    """
    Search for congressional bills in DynamoDB using various filters.
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - sponsor_name: List or string of sponsor names (case-insensitive substring match)
            - bill_title: List or string of bill titles (case-insensitive substring match)
            - bill_type: List or string of bill types (e.g., "HR", "S", "HJR", "SJR")
            - sponsor_party: List or string of sponsor parties (e.g., "R", "D", "I")
            - sponsor_state: List or string of sponsor states (2-letter codes)
            - policy_area: List or string of policy areas (case-insensitive substring match)
            - bipartisan: Boolean (1 for bipartisan, 0 for non-bipartisan)
            - bill_number: Exact bill number
            - congress: Congress number (e.g., 118, 117)
            - introduced_date_from: Start date in YYYY-MM-DD format
            - introduced_date_to: End date in YYYY-MM-DD format
            - latest_action_date_from: Start date in YYYY-MM-DD format
            - latest_action_date_to: End date in YYYY-MM-DD format
        limit: Maximum number of results to return (default: 100, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        Result structure:
        {
            "success": true,
            "results": [...],  // Array of bill objects
            "count": 10,  // Number of results
            "has_more": false,  // Whether more results are available
            "last_evaluated_key": {...},  // Pagination token (if has_more is true)
            "method": "query",  // Query method used
            "index_used": "SponsorNameDateIndex"  // GSI used
        }
        
        For large results stored in S3:
        {
            "status": "success",
            "s3_key": "users/.../data-files/congress_bills_search_...json",
            "count": 100,
            "has_more": true,
            "summary": {...}
        }
    
    Example:
        search_congress_bills(
            '{"sponsor_name": "Pelosi", "introduced_date_from": "2023-01-01"}',
            limit=50
        )
    """
    try:
        agent_logger.info(f"Searching congress bills with filters: {filters}")
        
        # Parse filters JSON
        if isinstance(filters, str):
            filters_dict = json.loads(filters)
        else:
            filters_dict = filters
        
        # Parse last_evaluated_key if provided
        last_key = None
        if last_evaluated_key:
            if isinstance(last_evaluated_key, str):
                last_key = json.loads(last_evaluated_key)
            else:
                last_key = last_evaluated_key
        
        # Validate limit
        if limit > 1000:
            limit = 1000
        if limit < 1:
            limit = 100
        
        # Perform search
        result = CongressBillsSearcher.search_bills_with_s3_passthrough(
            filters=filters_dict,
            limit=limit,
            last_evaluated_key=last_key
        )
        
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

