"""
USAspending Getter Lambda Function
Retrieves award details, transactions, and subawards from DynamoDB and S3
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, Any, Optional
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def fetch_award_from_dynamodb(award_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch award metadata from DynamoDB
    
    Args:
        award_id: Award ID to fetch
    
    Returns:
        Award item from DynamoDB or None if not found
    """
    try:
        if not awards_table:
            logger.error("DynamoDB awards table not initialized")
            return None
        
        response = awards_table.get_item(Key={'award_id': award_id})
        item = response.get('Item')
        
        if not item:
            logger.warning(f"Award {award_id} not found in DynamoDB")
            return None
        
        logger.info(f"Found award {award_id} in DynamoDB")
        return item
        
    except Exception as e:
        logger.error(f"Error fetching award from DynamoDB: {str(e)}", exc_info=True)
        return None


def fetch_award_details_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch and decompress award details (transactions and subawards) from S3
    
    Args:
        s3_key: S3 key for the award details file
    
    Returns:
        Dictionary with 'transactions' and 'subawards' arrays, or None if error
    """
    try:
        logger.info(f"Fetching award details from S3: {s3_key}")
        
        # Get object from S3
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        
        # Read and decompress gzipped content
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        
        # Parse JSON
        details = json.loads(decompressed_content.decode('utf-8'))
        
        logger.info(f"Successfully fetched award details: {details.get('transaction_count', 0)} transactions, {details.get('subaward_count', 0)} subawards")
        return details
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"Award details file not found in S3: {s3_key}")
        return None
    except Exception as e:
        logger.error(f"Error fetching award details from S3: {str(e)}", exc_info=True)
        return None


def convert_decimal_to_float(obj: Any) -> Any:
    """
    Recursively convert Decimal values to float for JSON serialization
    """
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def get_award_details(award_id: str, include_transactions: bool = True, include_subawards: bool = True) -> Dict[str, Any]:
    """
    Get full award details including transactions and subawards
    
    Args:
        award_id: Award ID to fetch
        include_transactions: Whether to include transactions in response
        include_subawards: Whether to include subawards in response
    
    Returns:
        Dictionary with award details, transactions, and subawards
    """
    # Fetch award metadata from DynamoDB
    award = fetch_award_from_dynamodb(award_id)
    
    if not award:
        return {
            'success': False,
            'error': 'Award not found',
            'award_id': award_id
        }
    
    # Extract S3 key
    s3_key = award.get('award_details_s3_key')
    
    # Build response with award metadata (transactions and subawards will be nested inside)
    response = {
        'success': True,
        'award_id': award_id,
        'award': {
            'award_id': award.get('award_id'),
            'award_type': award.get('award_type'),
            'total_obligation': award.get('total_obligation'),
            'period_start_date': award.get('period_start_date'),
            'period_end_date': award.get('period_end_date'),
            'fiscal_year': award.get('fiscal_year'),
            'description': award.get('description'),
            'awarding_agency': {
                'id': award.get('awarding_agency_id'),
                'code': award.get('awarding_agency_code'),
                'name': award.get('awarding_agency_name')
            },
            'funding_agency': {
                'id': award.get('funding_agency_id'),
                'code': award.get('funding_agency_code'),
                'name': award.get('funding_agency_name')
            },
            'recipient': {
                'id': award.get('recipient_id'),
                'name': award.get('recipient_name'),
                'unique_id': award.get('recipient_unique_id'),
                'location': {
                    'state': award.get('recipient_location_state'),
                    'country': award.get('recipient_location_country')
                }
            },
            'naics': {
                'code': award.get('naics_code'),
                'description': award.get('naics_description')
            },
            'psc': {
                'code': award.get('psc_code'),
                'description': award.get('psc_description')
            },
            'cfda_number': award.get('cfda_number'),
            'def_codes': award.get('def_codes', []),
            'full_response': award.get('full_response'),
            'indexed_at': award.get('indexed_at'),
            'last_updated': award.get('last_updated'),
            # Transactions and subawards will be nested here
            'transactions': [],
            'subawards': []
        },
        'metadata': {
            'transaction_count': award.get('transaction_count', 0),
            'subaward_count': award.get('subaward_count', 0),
            'award_details_indexed': award.get('award_details_indexed', False),
            'full_indexing_complete': award.get('full_indexing_complete', False)
        }
    }
    
    # Fetch transactions and subawards from S3 if requested and S3 key exists
    if s3_key and (include_transactions or include_subawards):
        details = fetch_award_details_from_s3(s3_key)
        
        if details:
            if include_transactions:
                response['award']['transactions'] = details.get('transactions', [])
            if include_subawards:
                response['award']['subawards'] = details.get('subawards', [])
        else:
            # S3 file not found or error - return what we have
            logger.warning(f"Could not fetch award details from S3 for {award_id}, returning metadata only")
    elif not s3_key:
        logger.warning(f"No S3 key found for award {award_id}, award may not be fully indexed")
    
    # Convert Decimal to float for JSON serialization
    response = convert_decimal_to_float(response)
    
    return response


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for retrieving award details
    """
    try:
        headers = get_cors_headers()
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'message': 'CORS pre-flight response'})
            }
        
        # Parse request
        if event.get('httpMethod'):
            # API Gateway event
            # Get award_id from query parameters (e.g., /usaspending-award?award_id=CONT_AWD_123)
            query_params = event.get('queryStringParameters') or {}
            award_id = query_params.get('award_id')
            
            # Also check path parameters in case it's passed there
            path_params = event.get('pathParameters') or {}
            if not award_id:
                award_id = path_params.get('award_id') or path_params.get('proxy', '')
                # If proxy contains slashes, get the last part
                if '/' in award_id:
                    award_id = award_id.split('/')[-1]
            
            # Parse query string parameters for options
            include_transactions = query_params.get('include_transactions', 'true').lower() == 'true'
            include_subawards = query_params.get('include_subawards', 'true').lower() == 'true'
        else:
            # Direct Lambda invocation
            award_id = event.get('award_id')
            include_transactions = event.get('include_transactions', True)
            include_subawards = event.get('include_subawards', True)
        
        # Validate award_id
        if not award_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Missing award_id',
                    'message': 'Please provide award_id in path or request body'
                })
            }
        
        logger.info(f"Fetching award details for: {award_id} (transactions: {include_transactions}, subawards: {include_subawards})")
        
        # Get award details
        result = get_award_details(award_id, include_transactions=include_transactions, include_subawards=include_subawards)
        
        if not result.get('success'):
            return {
                'statusCode': 404,
                'headers': headers,
                'body': json.dumps(result)
            }
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error processing getter request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

