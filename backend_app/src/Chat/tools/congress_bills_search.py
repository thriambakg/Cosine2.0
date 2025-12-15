"""
Congress Bills Search tool for the chat agent
Searches DynamoDB for congressional bills with various filters
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, Any, Optional, List
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
BILLS_TABLE_NAME = os.environ.get('BILLS_TABLE_NAME', 'cosine-congress-bills-production')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-congress-bills-data-production')

# Get DynamoDB table
bills_table = dynamodb.Table(BILLS_TABLE_NAME) if BILLS_TABLE_NAME else None


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


def fetch_oversized_bill_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized bill details from S3 (when oversize_s3_key exists)"""
    try:
        if not s3_key:
            return None
        
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        bill_details = json.loads(decompressed_content.decode('utf-8'))
        return bill_details
        
    except Exception as e:
        logger.warning(f"Error fetching oversized bill from S3 ({s3_key}): {str(e)}")
        return None


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """Apply filters to an item in Python"""
    # Bill title filter (case-insensitive substring match)
    if filters.get('bill_title'):
        bill_titles = filters['bill_title'] if isinstance(filters['bill_title'], list) else [filters['bill_title']]
        bill_titles = [t for t in bill_titles if t and str(t).strip()]
        if bill_titles:
            item_title = str(item.get('bill_title') or '').strip()
            matches = False
            for title in bill_titles:
                title_str = str(title).strip()
                if item_title and title_str.lower() in item_title.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Bipartisan filter
    if filters.get('bipartisan') is not None:
        bipartisan_value = filters['bipartisan']
        item_bipartisan = item.get('bipartisan')
        if isinstance(item_bipartisan, bool):
            item_bipartisan = 1 if item_bipartisan else 0
        if item_bipartisan != bipartisan_value:
            return False
    
    # Date filters
    if filters.get('introduced_date_from'):
        item_date = item.get('introduced_date')
        if not item_date or item_date < filters['introduced_date_from']:
            return False
    
    if filters.get('introduced_date_to'):
        item_date = item.get('introduced_date')
        if not item_date or item_date > filters['introduced_date_to']:
            return False
    
    return True


def search_bills_direct(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search bills in DynamoDB directly
    """
    if not bills_table:
        raise Exception("DynamoDB bills table not initialized")
    
    try:
        # Try to use BipartisanDateIndex if bipartisan filter is present
        if filters.get('bipartisan') is not None:
            bipartisan_value = filters['bipartisan']
            introduced_date = filters.get('introduced_date_from')
            
            params = {
                'IndexName': 'BipartisanDateIndex',
                'KeyConditionExpression': Key('bipartisan').eq(bipartisan_value),
                'Limit': limit * 5  # Fetch more to account for filtering
            }
            
            if introduced_date:
                params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key('introduced_date').gte(introduced_date)
            
            if last_evaluated_key:
                params['ExclusiveStartKey'] = last_evaluated_key
            
            response = bills_table.query(**params)
            items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
        else:
            # Fall back to scan with filters
            scan_params = {
                'Limit': limit * 10
            }
            
            if last_evaluated_key:
                scan_params['ExclusiveStartKey'] = last_evaluated_key
            
            response = bills_table.scan(**scan_params)
            items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
        
        # Apply Python filters
        filtered_items = [item for item in items if apply_python_filter(item, filters)]
        filtered_items = filtered_items[:limit]
        
        # Convert and enrich
        results = [convert_decimal_to_float(item) for item in filtered_items]
        enriched_results = []
        for bill in results:
            oversize_s3_key = bill.get('oversize_s3_key')
            if oversize_s3_key:
                full_bill = fetch_oversized_bill_from_s3(oversize_s3_key)
                if full_bill:
                    bill = convert_decimal_to_float(full_bill)
            enriched_results.append(bill)
        
        # Convert last_evaluated_key
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
        
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': last_eval_key is not None,
            'last_evaluated_key': serializable_last_key,
            'method': 'query' if filters.get('bipartisan') is not None else 'scan'
        }
        
    except Exception as e:
        logger.error(f"Error searching bills: {str(e)}", exc_info=True)
        raise


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
        """
        try:
            # Perform search
            result = search_bills_direct(filters, limit, last_evaluated_key)
            
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
            - bipartisan: Integer (1 for bipartisan, 0 for non-bipartisan)
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
        
    Example:
        search_congress_bills(
            '{"bipartisan": 1, "bill_title": "israel", "introduced_date_from": "2024-10-15"}',
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
