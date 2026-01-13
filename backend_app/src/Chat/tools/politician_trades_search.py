"""
Politician Trades Search tool for the chat agent
Searches DynamoDB for politician stock trades with various filters
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from decimal import Decimal
from datetime import datetime
import sys
from boto3.dynamodb.conditions import Key, Attr

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

# Environment variables
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME')
if not DYNAMODB_TABLE_NAME:
    raise ValueError("DYNAMODB_TABLE_NAME environment variable is required")

# Get DynamoDB table
trades_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if DYNAMODB_TABLE_NAME else None


def convert_from_dynamodb_format(item: Dict[str, Any]) -> Dict[str, Any]:
    """Convert DynamoDB item to Python dict with proper types"""
    result = {}
    for key, value in item.items():
        if isinstance(value, Decimal):
            result[key] = int(value) if value % 1 == 0 else float(value)
        elif isinstance(value, dict):
            result[key] = convert_from_dynamodb_format(value)
        elif isinstance(value, list):
            result[key] = [
                convert_from_dynamodb_format(v) if isinstance(v, dict) else
                (int(v) if isinstance(v, Decimal) and v % 1 == 0 else float(v) if isinstance(v, Decimal) else v)
                for v in value
            ]
        else:
            result[key] = value
    return result


def search_trades_direct(
    filters: Dict[str, Any],
    page: int = 1,
    page_size: int = 50,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Search trades in DynamoDB directly
    """
    if not trades_table:
        raise Exception("DynamoDB trades table not initialized")
    
    try:
        # Try to use PoliticianTradeDateIndex if politician name filter is present
        if filters.get('politicianName'):
            politician_names = filters['politicianName'] if isinstance(filters['politicianName'], list) else [filters['politicianName']]
            politician_name = politician_names[0] if politician_names else None
            
            if politician_name:
                params = {
                    'IndexName': 'PoliticianTradeDateIndex',
                    'KeyConditionExpression': Key('politicianName').eq(politician_name),
                    'Limit': page_size * 2,  # Fetch more to account for filtering
                    'ScanIndexForward': False  # Most recent first
                }
                
                # Add date range if provided
                date_from = filters.get('dateFrom')
                date_to = filters.get('dateTo')
                
                if date_from and date_to:
                    try:
                        date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                        date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                        date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                        date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key('transactionDate').between(date_from_num, date_to_num)
                    except ValueError as e:
                        logger.warning(f"Invalid date format: {e}")
                elif date_from:
                    try:
                        date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                        date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key('transactionDate').gte(date_from_num)
                    except ValueError as e:
                        logger.warning(f"Invalid date format: {e}")
                elif date_to:
                    try:
                        date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                        date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key('transactionDate').lte(date_to_num)
                    except ValueError as e:
                        logger.warning(f"Invalid date format: {e}")
                
                if last_evaluated_key:
                    params['ExclusiveStartKey'] = last_evaluated_key
                
                response = trades_table.query(**params)
                items = response.get('Items', [])
                last_eval_key = response.get('LastEvaluatedKey')
            else:
                # Fall back to scan
                scan_params = {'Limit': page_size * 10}
                if last_evaluated_key:
                    scan_params['ExclusiveStartKey'] = last_evaluated_key
                response = trades_table.scan(**scan_params)
                items = response.get('Items', [])
                last_eval_key = response.get('LastEvaluatedKey')
        else:
            # Fall back to scan
            scan_params = {'Limit': page_size * 10}
            if last_evaluated_key:
                scan_params['ExclusiveStartKey'] = last_evaluated_key
            response = trades_table.scan(**scan_params)
            items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
        
        # Convert from DynamoDB format
        converted_items = [convert_from_dynamodb_format(item) for item in items]
        
        # Apply pagination
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = converted_items[start_idx:end_idx]
        
        # Convert last_evaluated_key
        serializable_last_key = None
        if last_eval_key:
            try:
                # Convert Decimal values in last_eval_key
                serializable_last_key = {}
                for k, v in last_eval_key.items():
                    if isinstance(v, Decimal):
                        serializable_last_key[k] = int(v) if v % 1 == 0 else float(v)
                    else:
                        serializable_last_key[k] = v
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
        
        total_count = len(converted_items)
        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1
        
        return {
            'success': True,
            'results': paginated_items,
            'count': len(paginated_items),
            'total_found': total_count,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
            'has_more': last_eval_key is not None or end_idx < total_count,
            'last_evaluated_key': serializable_last_key
        }
        
    except Exception as e:
        logger.error(f"Error searching trades: {str(e)}", exc_info=True)
        raise


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
        """
        try:
            # Perform search
            result = search_trades_direct(filters, page, page_size, last_evaluated_key)
            
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
                    # SECURITY: Get user_id from secure source (set by lambda_handler from authorizer/headers)
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
                    s3_client = boto3.client('s3')
                    
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
    page_size: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for politician stock trades in DynamoDB using various filters.
    
    **Pagination:**
    - Default page_size is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results (page=1, page_size=5)
    - For "more" queries, increment page number or use last_evaluated_key from previous response
    - For specific items, if within first 5 results, return as-is
    
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
        page_size: Number of results per page (default: 5 for compute efficiency, max: 100)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        
    Example:
        search_politician_trades(
            '{"politicianName": "Nancy Pelosi", "dateFrom": "2023-01-01"}',
            page=1,
            page_size=5
        )
    """
    try:
        agent_logger.info(f"🔍 search_politician_trades called with filters: {filters}, page: {page}, page_size: {page_size}")
        
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
        
        # Validate page_size
        if page_size > 100:
            page_size = 100
        if page_size < 1:
            page_size = 5  # Default to 5 for compute efficiency
        
        # Validate page
        if page < 1:
            page = 1
        
        agent_logger.info(f"📊 Search parameters: page={page}, page_size={page_size}, pagination={'enabled' if last_key else 'disabled'}")
        
        # Perform search
        result = PoliticianTradesSearcher.search_trades_with_s3_passthrough(
            filters=filters_dict,
            page=page,
            page_size=page_size,
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
        error_msg = f"Error searching politician trades: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
        # Perform search
        result = PoliticianTradesSearcher.search_trades_with_s3_passthrough(
            filters=filters_dict,
            page=page,
            page_size=page_size,
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
        error_msg = f"Error searching politician trades: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })