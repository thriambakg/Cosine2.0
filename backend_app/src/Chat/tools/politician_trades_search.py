"""
Politician Trades Search tool for the chat agent
Searches DynamoDB for politician stock trades with various filters
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime
import sys

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'politician_trades_search', 'app'))

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
    from lambda_function import search_trades
except ImportError:
    logger.error("Could not import search_trades from politician_trades_search lambda_function")
    search_trades = None

# AWS clients
s3_client = boto3.client('s3')


class PoliticianTradesSearcher:
    """
    Searches politician trades in DynamoDB
    """
    
    @staticmethod
    def search_trades_with_s3_passthrough(
        filters: Dict[str, Any],
        page: int = 1,
        page_size: int = 50,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search trades and store large results in S3 if needed
        
        Args:
            filters: Dictionary of filter fields
            page: Page number (default: 1)
            page_size: Number of results per page (default: 50)
            last_evaluated_key: Pagination token from previous request
            
        Returns:
            Dictionary with search results or S3 key reference
        """
        if not search_trades:
            return {
                "success": False,
                "error": "Politician trades search function not available"
            }
        
        try:
            # Perform search
            result = search_trades(filters, page, page_size, last_evaluated_key)
            
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
                    filename = f"politician_trades_search_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=result_json,
                        ContentType='application/json'
                    )
                    
                    agent_logger.info(f"Stored politician trades search results in S3: {s3_key} ({result_size} bytes, {result.get('count', 0)} results)")
                    
                    # Return reference with S3 key
                    return {
                        "status": "success",
                        "s3_key": s3_key,
                        "data_size_bytes": result_size,
                        "count": result.get('count', 0),
                        "has_more": result.get('has_more', False),
                        "last_evaluated_key": result.get('last_evaluated_key'),
                        "page": result.get('page', page),
                        "page_size": result.get('page_size', page_size),
                        "total_pages": result.get('total_pages', 1),
                        "message": f"Large dataset stored in S3. Use read_s3_file_tool to access: {s3_key}",
                        "summary": {
                            "total_results": result.get('count', 0),
                            "has_more": result.get('has_more', False),
                            "page": result.get('page', page),
                            "total_pages": result.get('total_pages', 1)
                        }
                    }
                except Exception as s3_error:
                    logger.error(f"Error storing results in S3: {str(s3_error)}")
                    # Fall back to returning result directly
                    return result
            
            # Return result directly for small datasets
            return result
            
        except Exception as e:
            logger.error(f"Error searching politician trades: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@tool
def search_politician_trades(
    filters: str,
    page: int = 1,
    page_size: int = 50,
    last_evaluated_key: str = None
) -> str:
    """
    Search for politician stock trades in DynamoDB using various filters.
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - politicianName: List or string of politician names (exact match)
            - position: List or string of positions (e.g., "Senator", "Representative")
            - party: List or string of parties (e.g., "R", "D", "I")
            - security: List or string of security symbols or names (searches both symbol and name)
            - securitySymbol: List or string of security symbols (exact match)
            - securityName: List or string of security names (exact match)
            - transactionType: List or string of transaction types (e.g., "Purchase", "Sale", "Exchange")
            - amountRange: List or string of amount ranges (e.g., "$1,001-$15,000", "$50,000,001+")
            - stateDistrict: List or string of state/district codes (e.g., "CA", "TX-01")
            - dateFrom: Start date in YYYY-MM-DD format
            - dateTo: End date in YYYY-MM-DD format
            - filingDateFrom: Start filing date in YYYY-MM-DD format
            - filingDateTo: End filing date in YYYY-MM-DD format
            - requiresManualReview: Boolean
            - isUnparsed: Boolean
            - matchConfidence: Minimum match confidence (decimal)
        page: Page number (default: 1)
        page_size: Number of results per page (default: 50, max: 100)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        Result structure:
        {
            "success": true,
            "results": [...],  // Array of trade objects
            "count": 10,  // Number of results
            "page": 1,  // Current page
            "page_size": 50,  // Results per page
            "total_pages": 1,  // Total number of pages
            "has_more": false,  // Whether more results are available
            "last_evaluated_key": {...}  // Pagination token (if has_more is true)
        }
        
        For large results stored in S3:
        {
            "status": "success",
            "s3_key": "users/.../data-files/politician_trades_search_...json",
            "count": 100,
            "has_more": true,
            "summary": {...}
        }
    
    Example:
        search_politician_trades(
            '{"politicianName": "Nancy Pelosi", "dateFrom": "2023-01-01"}',
            page=1,
            page_size=50
        )
    """
    try:
        agent_logger.info(f"Searching politician trades with filters: {filters}")
        
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
        
        # Validate page_size
        if page_size > 100:
            page_size = 100
        if page_size < 1:
            page_size = 50
        
        # Validate page
        if page < 1:
            page = 1
        
        # Perform search
        result = PoliticianTradesSearcher.search_trades_with_s3_passthrough(
            filters=filters_dict,
            page=page,
            page_size=page_size,
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
        error_msg = f"Error searching politician trades: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })

