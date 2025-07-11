"""
Robinhood Portfolio Analysis Lambda Function
Integrates Robinhood account data with existing portfolio analysis tools
"""

import json
import logging
from typing import Dict, Any
from robinhood_service import robinhood_service
import sys
import os

# Add the parent directory to the path to import existing modules
sys.path.append(os.path.join(os.path.dirname(__file__), '../..', 'stock_statistics', 'app'))
from lambda_function import calculate_portfolio_metrics

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for Robinhood portfolio integration
    
    Args:
        event: API Gateway event containing authentication and request data
        context: Lambda context object
        
    Returns:
        dict: Response with portfolio analysis or error
    """
    try:
        # Parse the request body
        body = json.loads(event.get('body', '{}'))
        action = body.get('action')
        
        # CORS headers for frontend integration
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        if action == 'authenticate':
            return handle_authentication(body, headers)
        elif action == 'get_portfolio_analysis':
            return handle_portfolio_analysis(body, headers)
        elif action == 'get_account_info':
            return handle_account_info(headers)
        elif action == 'logout':
            return handle_logout(headers)
        else:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Invalid action. Supported actions: authenticate, get_portfolio_analysis, get_account_info, logout'
                })
            }
            
    except Exception as e:
        logger.error(f"Lambda handler error: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': f'Internal server error: {str(e)}'
            })
        }

def handle_authentication(body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    """Handle Robinhood authentication"""
    try:
        username = body.get('username')
        password = body.get('password')
        mfa_code = body.get('mfa_code')
        
        if not username or not password:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Username and password are required'
                })
            }
        
        # Authenticate with Robinhood
        auth_result = robinhood_service.authenticate(username, password, mfa_code)
        
        if auth_result['success']:
            # Get basic account info after successful authentication
            try:
                account_info = robinhood_service.get_account_info()
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'message': 'Authentication successful',
                        'account_info': account_info
                    })
                }
            except Exception as e:
                logger.warning(f"Authentication successful but failed to get account info: {e}")
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'message': 'Authentication successful',
                        'account_info': None
                    })
                }
        else:
            status_code = 401 if not auth_result.get('requires_mfa') else 202
            return {
                'statusCode': status_code,
                'headers': headers,
                'body': json.dumps(auth_result)
            }
            
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': f'Authentication failed: {str(e)}'
            })
        }

def handle_portfolio_analysis(body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    """Handle portfolio analysis using Robinhood data"""
    try:
        if not robinhood_service.is_authenticated:
            return {
                'statusCode': 401,
                'headers': headers,
                'body': json.dumps({
                    'error': 'User not authenticated with Robinhood'
                })
            }
        
        # Get portfolio positions from Robinhood
        portfolio_positions = robinhood_service.get_portfolio_positions()
        
        if not portfolio_positions:
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'message': 'No positions found in Robinhood account',
                    'portfolio_analysis': None
                })
            }
        
        # Get analysis period from request (default to 1 year)
        period = body.get('period', '1y')
        
        # Use existing portfolio analysis logic
        portfolio_analysis = calculate_portfolio_metrics(portfolio_positions, period)
        
        # Get account info for additional context
        account_info = robinhood_service.get_account_info()
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'portfolio_analysis': portfolio_analysis,
                'account_info': account_info,
                'positions_count': len(portfolio_positions),
                'analysis_period': period
            })
        }
        
    except Exception as e:
        logger.error(f"Portfolio analysis error: {e}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': f'Portfolio analysis failed: {str(e)}'
            })
        }

def handle_account_info(headers: Dict[str, str]) -> Dict[str, Any]:
    """Handle account info request"""
    try:
        if not robinhood_service.is_authenticated:
            return {
                'statusCode': 401,
                'headers': headers,
                'body': json.dumps({
                    'error': 'User not authenticated with Robinhood'
                })
            }
        
        account_info = robinhood_service.get_account_info()
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'account_info': account_info
            })
        }
        
    except Exception as e:
        logger.error(f"Account info error: {e}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': f'Failed to get account info: {str(e)}'
            })
        }

def handle_logout(headers: Dict[str, str]) -> Dict[str, Any]:
    """Handle logout request"""
    try:
        robinhood_service.logout()
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'message': 'Successfully logged out'
            })
        }
        
    except Exception as e:
        logger.error(f"Logout error: {e}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': f'Logout failed: {str(e)}'
            })
        }

# For local testing
if __name__ == "__main__":
    # Test event for authentication
    test_event = {
        'body': json.dumps({
            'action': 'authenticate',
            'username': 'your_username',
            'password': 'your_password'
        })
    }
    
    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2))
