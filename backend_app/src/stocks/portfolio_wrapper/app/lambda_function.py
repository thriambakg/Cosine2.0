"""
Portfolio Analysis Wrapper Lambda
Simple wrapper that receives frontend requests and invokes the portfolio analysis lambda directly
"""

import json
import os
import boto3
import logging
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for portfolio analysis wrapper
    
    Args:
        event: API Gateway event containing portfolio data
        context: Lambda context object
        
    Returns:
        dict: HTTP response with portfolio analysis results
    """
    logger.info("=== Portfolio Wrapper Lambda Handler Started ===")
    logger.info(f"Event keys: {list(event.keys())}")
    logger.info(f"HTTP Method: {event.get('httpMethod', 'Unknown')}")
    logger.info(f"Headers: {event.get('headers', {})}")
    
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        # CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        # Handle preflight requests
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': ''
            }
        
        # Validate input
        portfolio_data = body.get('portfolio_data')
        period = body.get('period', '1y')
        
        if not portfolio_data:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data is required',
                    'details': 'Provide portfolio_data as list of [ticker, shares, price] tuples'
                })
            }
        
        # Get portfolio analysis function name from environment
        portfolio_function_name = os.environ.get('PORTFOLIO_ANALYSIS_FUNCTION_NAME')
        if not portfolio_function_name:
            raise Exception('PORTFOLIO_ANALYSIS_FUNCTION_NAME environment variable not set')
        
        # Invoke portfolio analysis lambda directly
        lambda_client = boto3.client('lambda')
        
        # Create API Gateway event format for the portfolio analysis lambda
        api_gateway_event = {
            'httpMethod': 'POST',
            'body': json.dumps({
                'portfolio_data': portfolio_data,
                'period': period,
                'analysis_type': 'standalone'
            }),
            'headers': {
                'Content-Type': 'application/json'
            }
        }
        
        logger.info(f"Invoking portfolio analysis lambda '{portfolio_function_name}' with {len(portfolio_data)} positions")
        
        response = lambda_client.invoke(
            FunctionName=portfolio_function_name,
            InvocationType='RequestResponse',
            Payload=json.dumps(api_gateway_event)
        )
        
        # Parse response
        response_payload = json.loads(response['Payload'].read())
        logger.info(f"Portfolio analysis lambda response: {json.dumps(response_payload, indent=2)}")
        
        if response_payload.get('statusCode') == 200:
            # Parse the response body from the portfolio analysis lambda
            try:
                portfolio_response = json.loads(response_payload['body'])
                logger.info(f"Portfolio analysis response keys: {list(portfolio_response.keys())}")
                
                # Return the complete response from the portfolio analysis lambda
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': response_payload['body']  # Return the original body as-is
                }
            except Exception as parse_error:
                logger.error(f"Error parsing portfolio response body: {parse_error}")
                logger.error(f"Raw response body: {response_payload.get('body', 'No body')}")
                return {
                    'statusCode': 500,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Failed to parse portfolio analysis response',
                        'details': str(parse_error)
                    })
                }
        else:
            logger.error(f"Portfolio analysis lambda returned non-200 status: {response_payload.get('statusCode')}")
            return {
                'statusCode': response_payload.get('statusCode', 500),
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio analysis failed',
                    'details': response_payload.get('body', 'Unknown error')
                })
            }
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Invalid JSON in request body',
                'details': str(e)
            })
        }
    except Exception as e:
        logger.error(f"Lambda handler error: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error details: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e),
                'error_type': type(e).__name__
            })
        }

# For local testing
if __name__ == "__main__":
    test_event = {
        'httpMethod': 'POST',
        'body': json.dumps({
            'portfolio_data': [
                ['AAPL', 10, 190.50],
                ['GOOGL', 5, 125.75],
                ['MSFT', 7, 340.20]
            ],
            'period': '1y'
        })
    }
    
    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2))
