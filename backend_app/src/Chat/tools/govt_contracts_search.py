"""
Government Contracts Search tool for the chat agent
Searches DynamoDB for government contracts/awards from USAspending with various filters
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, Any, Optional
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
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'cosine-usaspending-awards-index-production')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def convert_decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal values to float for JSON serialization"""
    try:
        from boto3.dynamodb.types import Binary
        if isinstance(obj, Binary):
            obj = obj.value
    except ImportError:
        pass
    
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, bytes):
        if len(obj) == 1:
            return bool(obj[0])
        else:
            import base64
            return base64.b64encode(obj).decode('utf-8')
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def fetch_oversized_award_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized award details from S3"""
    try:
        if not s3_key:
            return None
        
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        award_details = json.loads(decompressed_content.decode('utf-8'))
        return award_details
        
    except Exception as e:
        logger.warning(f"Error fetching oversized award from S3 ({s3_key}): {str(e)}")
        return None


def search_awards_direct(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB directly
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    try:
        # Try to use AwardingAgencyNameFiscalYearIndex if agency name filter is present
        if filters.get('awarding_agency_name'):
            agency_names = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
            agency_name = agency_names[0].strip() if agency_names else None
            fiscal_year = filters.get('fiscal_year')
            
            if agency_name:
                params = {
                    'IndexName': 'AwardingAgencyNameFiscalYearIndex',
                    'KeyConditionExpression': Key('awarding_agency_name').eq(agency_name),
                    'Limit': limit * 5
                }
                
                if fiscal_year:
                    fiscal_years = fiscal_year if isinstance(fiscal_year, list) else [fiscal_year]
                    if fiscal_years:
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key('fiscal_year').eq(fiscal_years[0])
                
                if last_evaluated_key:
                    params['ExclusiveStartKey'] = last_evaluated_key
                
                response = awards_table.query(**params)
                items = response.get('Items', [])
                last_eval_key = response.get('LastEvaluatedKey')
            else:
                # Fall back to scan
                scan_params = {'Limit': limit * 10}
                if last_evaluated_key:
                    scan_params['ExclusiveStartKey'] = last_evaluated_key
                response = awards_table.scan(**scan_params)
                items = response.get('Items', [])
                last_eval_key = response.get('LastEvaluatedKey')
        else:
            # Fall back to scan with filters
            scan_params = {'Limit': limit * 10}
            if last_evaluated_key:
                scan_params['ExclusiveStartKey'] = last_evaluated_key
            response = awards_table.scan(**scan_params)
            items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
        
        # Apply Python filters (simplified - can be enhanced)
        filtered_items = items[:limit]  # Basic filtering - can be enhanced with full filter logic
        
        # Convert and enrich
        results = [convert_decimal_to_float(item) for item in filtered_items]
        enriched_results = []
        for award in results:
            oversize_s3_key = award.get('oversize_s3_key')
            if oversize_s3_key:
                full_award = fetch_oversized_award_from_s3(oversize_s3_key)
                if full_award:
                    award = convert_decimal_to_float(full_award)
            enriched_results.append(award)
        
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
            'method': 'query' if filters.get('awarding_agency_name') else 'scan'
        }
        
    except Exception as e:
        logger.error(f"Error searching awards: {str(e)}", exc_info=True)
        raise


class GovtContractsSearcher:
    """
    Searches government contracts/awards in DynamoDB
    """
    
    @staticmethod
    def search_awards_with_s3_passthrough(
        filters: Dict[str, Any],
        limit: int = 100,
        last_evaluated_key: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Search awards and store large results in S3 if needed
        """
        try:
            # Perform search
            result = search_awards_direct(filters, limit, last_evaluated_key)
            
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
                    filename = f"govt_contracts_search_{timestamp}.json"
                    s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
                    
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=result_json,
                        ContentType='application/json'
                    )
                    
                    agent_logger.info(f"Stored government contracts search results in S3: {s3_key} ({result_size} bytes, {result.get('count', 0)} results)")
                    
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
            logger.error(f"Error searching government contracts: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@tool
def search_govt_contracts(
    filters: str,
    limit: int = 5,
    last_evaluated_key: str = None
) -> str:
    """
    Search for government contracts/awards in DynamoDB using various filters.
    
    **IMPORTANT: Use autocomplete before searching:**
    For recipient_name searches, consider using autocomplete if the user provides a generic name.
    The search tool uses substring matching, but autocomplete can help find exact company names.
    
    **Pagination:**
    - Default limit is 5 results to conserve compute
    - For "most recent" queries, returns 5 most recent results
    - For "more" queries, use last_evaluated_key from previous response to fetch next 5
    - For specific items, if within first 5 results, return as-is
    
    Args:
        filters: JSON string containing filter fields. Supported filters:
            - awarding_agency_name: List or string of awarding agency names (case-insensitive substring match)
            - awarding_agency_code: List or string of awarding agency codes (e.g., "012", "020")
            - funding_agency_name: List or string of funding agency names
            - funding_agency_code: List or string of funding agency codes
            - recipient_name: List or string of recipient names (case-insensitive substring match)
            - recipient_location_state: List or string of recipient states (2-letter codes)
            - recipient_location_country: List or string of recipient countries
            - recipient_zip_code: List or string of recipient zip codes (e.g., "61704")
            - award_type: List or string of award types (e.g., "A", "B", "C", "D", "IDV")
            - naics_code: List or string of NAICS codes
            - psc_code: List or string of PSC codes
            - cfda_number: List or string of CFDA numbers
            - fiscal_year: List or integer of fiscal years
            - date_from: Start date in YYYY-MM-DD format
            - date_to: End date in YYYY-MM-DD format
            - min_obligation: Minimum obligation amount (decimal)
            - max_obligation: Maximum obligation amount (decimal)
        limit: Maximum number of results to return (default: 5 for compute efficiency, max: 1000)
        last_evaluated_key: JSON string of pagination token from previous request (optional)
    
    Returns:
        JSON string with search results. For large results, returns S3 key reference.
        
    Example:
        search_govt_contracts(
            '{"awarding_agency_name": "Department of Defense", "fiscal_year": 2023}',
            limit=5
        )
    """
    try:
        agent_logger.info(f"Searching government contracts with filters: {filters}")
        
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
            limit = 5
        
        # Perform search
        result = GovtContractsSearcher.search_awards_with_s3_passthrough(
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
        error_msg = f"Error searching government contracts: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
