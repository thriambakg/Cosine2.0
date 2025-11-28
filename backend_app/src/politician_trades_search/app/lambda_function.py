"""
Politician Trades Search Lambda Function
Provides search functionality for politician trades stored in DynamoDB
Supports filtering by various fields using GSIs
"""

import json
import os
import logging
import boto3
from typing import Dict, List, Any, Optional
from datetime import datetime
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'cosine-politician-trades-production')
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '100'))

# GSI names from table definition
GSI_NAMES = {
    'politicianName': 'PoliticianTradeDateIndex',
    'position': 'PositionTradeDateIndex',
    'party': 'PartyTradeDateIndex',
    'securitySymbol': 'SecurityTradeDateIndex',
    'formType': 'FormTypeTradeDateIndex',
    'transactionType': 'TransactionTypeTradeDateIndex',
    'amountMin': 'AmountRangeTradeDateIndex',
    'stateDistrict': 'StateDistrictTradeDateIndex',
}


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder for Decimal types"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def convert_to_dynamodb_format(value: Any) -> Any:
    """Convert Python types to DynamoDB-compatible types"""
    if isinstance(value, float):
        return Decimal(str(value))
    elif isinstance(value, int):
        return value
    elif isinstance(value, list):
        return [convert_to_dynamodb_format(item) for item in value]
    elif isinstance(value, dict):
        return {k: convert_to_dynamodb_format(v) for k, v in value.items()}
    return value


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


def build_query_params(
    table,
    filters: Dict[str, Any],
    page: int = 1,
    page_size: int = 50
) -> tuple[Optional[str], Optional[Dict[str, Any]], Optional[str]]:
    """
    Build DynamoDB query parameters based on filters.
    Returns (index_name, key_condition, filter_expression)
    """
    # Determine which GSI to use based on provided filters
    # Priority order: politicianName > position > party > securitySymbol > formType > transactionType > amountMin > stateDistrict
    
    index_name = None
    key_condition = None
    filter_expression = None
    filter_conditions = []
    
    # Check for GSI hash key filters
    if filters.get('politicianName'):
        index_name = GSI_NAMES['politicianName']
        key_condition = Key('politicianName').eq(filters['politicianName'])
    elif filters.get('position'):
        index_name = GSI_NAMES['position']
        key_condition = Key('position').eq(filters['position'])
    elif filters.get('party'):
        index_name = GSI_NAMES['party']
        key_condition = Key('party').eq(filters['party'])
    elif filters.get('securitySymbol'):
        index_name = GSI_NAMES['securitySymbol']
        key_condition = Key('securitySymbol').eq(filters['securitySymbol'])
    elif filters.get('formType'):
        index_name = GSI_NAMES['formType']
        key_condition = Key('formType').eq(filters['formType'])
    elif filters.get('transactionType'):
        index_name = GSI_NAMES['transactionType']
        key_condition = Key('transactionType').eq(filters['transactionType'])
    elif filters.get('amountMin'):
        # For amount range, we need to handle range queries
        index_name = GSI_NAMES['amountMin']
        amount_min = filters.get('amountMin')
        amount_max = filters.get('amountMax')
        if amount_min is not None and amount_max is not None:
            key_condition = Key('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max)))
        elif amount_min is not None:
            key_condition = Key('amountMin').gte(Decimal(str(amount_min)))
        else:
            key_condition = Key('amountMin').lte(Decimal(str(amount_max)))
    elif filters.get('stateDistrict'):
        index_name = GSI_NAMES['stateDistrict']
        key_condition = Key('stateDistrict').eq(filters['stateDistrict'])
    
    # Add transactionDate range filter if using a GSI (all GSIs have transactionDate as range key)
    if index_name and filters.get('dateFrom') or filters.get('dateTo'):
        date_from = filters.get('dateFrom')
        date_to = filters.get('dateTo')
        
        if date_from and date_to:
            # Convert date strings to timestamps
            try:
                date_from_ts = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp())
                date_to_ts = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp())
                key_condition = key_condition & Key('transactionDate').between(date_from_ts, date_to_ts)
            except ValueError:
                logger.warning(f"Invalid date format: {date_from} or {date_to}")
        elif date_from:
            try:
                date_from_ts = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp())
                key_condition = key_condition & Key('transactionDate').gte(date_from_ts)
            except ValueError:
                logger.warning(f"Invalid date format: {date_from}")
        elif date_to:
            try:
                date_to_ts = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp())
                key_condition = key_condition & Key('transactionDate').lte(date_to_ts)
            except ValueError:
                logger.warning(f"Invalid date format: {date_to}")
    
    # Build filter expression for non-key attributes
    if filters.get('owner'):
        filter_conditions.append(Attr('owner').contains(filters['owner']))
    
    if filters.get('securityName'):
        filter_conditions.append(Attr('securityName').contains(filters['securityName']))
    
    if filters.get('requiresManualReview') is not None:
        filter_conditions.append(Attr('requiresManualReview').eq(filters['requiresManualReview']))
    
    if filters.get('isUnparsed') is not None:
        filter_conditions.append(Attr('isUnparsed').eq(filters['isUnparsed']))
    
    if filters.get('matchConfidence'):
        filter_conditions.append(Attr('matchConfidence').gte(Decimal(str(filters['matchConfidence']))))
    
    if filter_conditions:
        filter_expression = filter_conditions[0]
        for condition in filter_conditions[1:]:
            filter_expression = filter_expression & condition
    
    return index_name, key_condition, filter_expression


def search_trades(filters: Dict[str, Any], page: int = 1, page_size: int = 50) -> Dict[str, Any]:
    """
    Search politician trades based on filters
    
    Args:
        filters: Dictionary of filter criteria
        page: Page number (1-indexed)
        page_size: Number of results per page
    
    Returns:
        Dictionary with results and metadata
    """
    try:
        table = dynamodb.Table(DYNAMODB_TABLE_NAME)
        
        # Build query parameters
        index_name, key_condition, filter_expression = build_query_params(table, filters, page, page_size)
        
        # If no GSI filter is provided, use scan (less efficient but necessary)
        if not index_name:
            logger.info("No GSI filter provided, using scan operation")
            scan_kwargs = {
                'Limit': page_size
            }
            
            # Build filter expression for scan
            if filter_expression:
                scan_kwargs['FilterExpression'] = filter_expression
            
            # Add attribute filters
            if filters.get('politicianName'):
                scan_kwargs['FilterExpression'] = (scan_kwargs.get('FilterExpression', Attr('tradeId').exists()) & 
                                                   Attr('politicianName').contains(filters['politicianName']))
            
            if filters.get('securitySymbol'):
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                scan_kwargs['FilterExpression'] = existing_filter & Attr('securitySymbol').eq(filters['securitySymbol'])
            
            if filters.get('dateFrom') or filters.get('dateTo'):
                date_from = filters.get('dateFrom')
                date_to = filters.get('dateTo')
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                
                if date_from and date_to:
                    try:
                        date_from_ts = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp())
                        date_to_ts = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp())
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').between(date_from_ts, date_to_ts)
                    except ValueError:
                        logger.warning(f"Invalid date format in scan")
                elif date_from:
                    try:
                        date_from_ts = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp())
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').gte(date_from_ts)
                    except ValueError:
                        logger.warning(f"Invalid date format in scan")
                elif date_to:
                    try:
                        date_to_ts = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp())
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').lte(date_to_ts)
                    except ValueError:
                        logger.warning(f"Invalid date format in scan")
            
            # Execute scan
            response = table.scan(**scan_kwargs)
            items = response.get('Items', [])
            
            # Handle pagination
            total_scanned = response.get('ScannedCount', 0)
            last_evaluated_key = response.get('LastEvaluatedKey')
            
            # Convert items
            results = [convert_from_dynamodb_format(item) for item in items]
            
            return {
                'success': True,
                'results': results,
                'total_found': len(results),
                'page': page,
                'page_size': page_size,
                'has_more': last_evaluated_key is not None,
                'last_evaluated_key': last_evaluated_key
            }
        else:
            # Use GSI query (more efficient)
            logger.info(f"Using GSI: {index_name}")
            query_kwargs = {
                'IndexName': index_name,
                'KeyConditionExpression': key_condition,
                'Limit': page_size,
                'ScanIndexForward': False  # Sort by transactionDate descending
            }
            
            if filter_expression:
                query_kwargs['FilterExpression'] = filter_expression
            
            # Handle pagination
            if page > 1:
                # For simplicity, we'll fetch all pages up to the requested page
                # In production, you'd want to store LastEvaluatedKey client-side
                for _ in range(page - 1):
                    response = table.query(**query_kwargs)
                    if 'LastEvaluatedKey' not in response:
                        break
                    query_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
            
            response = table.query(**query_kwargs)
            items = response.get('Items', [])
            
            # Convert items
            results = [convert_from_dynamodb_format(item) for item in items]
            
            return {
                'success': True,
                'results': results,
                'total_found': response.get('Count', len(results)),
                'page': page,
                'page_size': page_size,
                'has_more': 'LastEvaluatedKey' in response,
                'last_evaluated_key': response.get('LastEvaluatedKey')
            }
    
    except Exception as e:
        logger.error(f"Error searching trades: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'total_found': 0
        }


def lambda_handler(event, context):
    """
    Lambda handler for politician trades search
    
    Expected event structure:
    {
        "httpMethod": "POST",
        "body": "{\"politicianName\": \"...\", \"dateFrom\": \"2024-01-01\", ...}"
    }
    """
    try:
        # Parse request
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        # Extract query parameters
        filters = {
            'politicianName': body.get('politicianName'),
            'position': body.get('position'),
            'party': body.get('party'),
            'securitySymbol': body.get('securitySymbol'),
            'securityName': body.get('securityName'),
            'formType': body.get('formType'),
            'transactionType': body.get('transactionType'),
            'owner': body.get('owner'),
            'stateDistrict': body.get('stateDistrict'),
            'dateFrom': body.get('dateFrom'),
            'dateTo': body.get('dateTo'),
            'amountMin': body.get('amountMin'),
            'amountMax': body.get('amountMax'),
            'requiresManualReview': body.get('requiresManualReview'),
            'isUnparsed': body.get('isUnparsed'),
            'matchConfidence': body.get('matchConfidence'),
        }
        
        # Remove None values
        filters = {k: v for k, v in filters.items() if v is not None and v != ''}
        
        page = int(body.get('page', 1))
        page_size = min(int(body.get('pageSize', 50)), MAX_RESULTS)
        
        # Perform search
        result = search_trades(filters, page, page_size)
        
        # Return response
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            'body': json.dumps(result, cls=DecimalEncoder)
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            'body': json.dumps({
                'success': False,
                'error': str(e)
            }, cls=DecimalEncoder)
        }

