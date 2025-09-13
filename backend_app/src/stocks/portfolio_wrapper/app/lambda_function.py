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
    print("[DEBUG] === Portfolio Wrapper Lambda Handler Started ===")
    print(f"[DEBUG] Event keys: {list(event.keys())}")
    print(f"[DEBUG] HTTP Method: {event.get('httpMethod', 'Unknown')}")
    print(f"[DEBUG] Headers: {event.get('headers', {})}")
    
    logger.info("=== Portfolio Wrapper Lambda Handler Started ===")
    logger.info(f"Event keys: {list(event.keys())}")
    logger.info(f"HTTP Method: {event.get('httpMethod', 'Unknown')}")
    logger.info(f"Headers: {event.get('headers', {})}")
    
    try:
        # Parse request body
        print("[DEBUG] Parsing request body")
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
            print("[DEBUG] Successfully parsed JSON body")
        else:
            body = event.get('body', {})
            print("[DEBUG] Using body as-is (not JSON string)")
        
        print(f"[DEBUG] Request body keys: {list(body.keys())}")
        
        # CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        # Handle preflight requests
        if event.get('httpMethod') == 'OPTIONS':
            print("[DEBUG] Handling OPTIONS preflight request")
            return {
                'statusCode': 200,
                'headers': headers,
                'body': ''
            }
        
        # Validate input
        print("[DEBUG] Validating input")
        portfolio_data = body.get('portfolio_data')
        period = body.get('period', '1y')
        analysis_type = body.get('analysis_type', 'standalone')
        
        # Validate period
        valid_periods = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']
        if period not in valid_periods:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': f'Invalid period: {period}',
                    'details': f'Supported periods: {", ".join(valid_periods)}'
                })
            }
        
        print(f"[DEBUG] Portfolio data: {portfolio_data}")
        print(f"[DEBUG] Period: {period}")
        print(f"[DEBUG] Analysis type: {analysis_type}")
        
        if not portfolio_data:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data is required',
                    'details': 'Provide portfolio_data as list of [ticker, shares, price] tuples'
                })
            }
        
        # Validate portfolio data format and values (now expects [ticker, shares] format)
        print("[DEBUG] Validating portfolio data format and values")
        validated_portfolio = []
        
        for i, position in enumerate(portfolio_data):
            # Support both [ticker, shares] and [ticker, shares, price] formats
            if not isinstance(position, list) or len(position) < 2 or len(position) > 3:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Invalid portfolio data format',
                        'details': f'Position {i} must be [ticker, shares] or [ticker, shares, price]. Got: {position}'
                    })
                }
            
            ticker = position[0]
            shares = position[1]
            
            if not ticker or not isinstance(ticker, str):
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Invalid ticker symbol',
                        'details': f'Position {i}: ticker must be a non-empty string. Got: {ticker}'
                    })
                }
            
            if not isinstance(shares, (int, float)) or shares <= 0:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Invalid shares',
                        'details': f'Position {i}: shares must be a positive number. Got: {shares}'
                    })
                }
            
            # Convert to new format: [ticker, shares] (price will be fetched automatically)
            validated_portfolio.append([ticker, shares])
            print(f"[DEBUG] Validated position {i}: {ticker} - {shares} shares (price will be fetched automatically)")
        
        print("[DEBUG] Portfolio data validation passed - converting to new format")
        
        # Get portfolio analysis function name from environment
        print("[DEBUG] Getting portfolio analysis function name from environment")
        portfolio_function_name = os.environ.get('PORTFOLIO_ANALYSIS_FUNCTION_NAME')
        print(f"[DEBUG] Portfolio function name: {portfolio_function_name}")
        if not portfolio_function_name:
            raise Exception('PORTFOLIO_ANALYSIS_FUNCTION_NAME environment variable not set')
        
        # Invoke portfolio analysis lambda directly
        print("[DEBUG] Creating boto3 lambda client")
        lambda_client = boto3.client('lambda')
        
        # Create API Gateway event format for the portfolio analysis lambda
        api_gateway_event = {
            'httpMethod': 'POST',
            'body': json.dumps({
                'portfolio_data': validated_portfolio,  # Use validated portfolio in new format
                'period': period,
                'analysis_type': analysis_type
            }),
            'headers': {
                'Content-Type': 'application/json'
            }
        }
        
        print(f"[DEBUG] Invoking portfolio analysis lambda '{portfolio_function_name}' with {len(portfolio_data)} positions")
        logger.info(f"Invoking portfolio analysis lambda '{portfolio_function_name}' with {len(portfolio_data)} positions")
        
        response = lambda_client.invoke(
            FunctionName=portfolio_function_name,
            InvocationType='RequestResponse',
            Payload=json.dumps(api_gateway_event)
        )
        print(f"[DEBUG] Lambda invoke response status code: {response.get('StatusCode', 'Unknown')}")
        
        # Parse response
        print("[DEBUG] Parsing portfolio analysis lambda response")
        response_payload = json.loads(response['Payload'].read())
        print(f"[DEBUG] Response payload keys: {list(response_payload.keys())}")
        print(f"[DEBUG] Response status code: {response_payload.get('statusCode', 'Unknown')}")
        logger.info(f"Portfolio analysis lambda response: {json.dumps(response_payload, indent=2)}")
        
        if response_payload.get('statusCode') == 200:
            print("[DEBUG] Portfolio analysis lambda returned 200, processing response")
            # Parse the response body from the portfolio analysis lambda
            try:
                portfolio_response = json.loads(response_payload['body'])
                logger.info(f"Portfolio analysis response keys: {list(portfolio_response.keys())}")
                
                # Return the complete response from the portfolio analysis lambda
                print("[DEBUG] Returning successful response to frontend")
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': response_payload['body']  # Return the original body as-is
                }
            except Exception as parse_error:
                print(f"[DEBUG] Error parsing portfolio response body: {parse_error}")
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
            print(f"[DEBUG] Portfolio analysis lambda returned non-200 status: {response_payload.get('statusCode')}")
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
        print(f"[DEBUG] JSON decode error: {e}")
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
        print(f"[DEBUG] Lambda handler error: {e}")
        print(f"[DEBUG] Error type: {type(e).__name__}")
        print(f"[DEBUG] Error details: {str(e)}")
        import traceback
        print(f"[DEBUG] Traceback: {traceback.format_exc()}")
        
        logger.error(f"Lambda handler error: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error details: {str(e)}")
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
