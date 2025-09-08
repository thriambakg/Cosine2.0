"""
AWS Lambda handler for Cosine Financial Analysis Agent
Focused on API Gateway integration and business logic only
Resource configuration handled by Terraform
Updated for layer v8 compatibility
"""

import json
import os
import logging
import sys
from typing import Dict, Any

# Fix OpenTelemetry context issue in Lambda environment
os.environ.setdefault('OTEL_SDK_DISABLED', 'true')
os.environ.setdefault('OTEL_PYTHON_DISABLED_INSTRUMENTATIONS', 'all')
os.environ.setdefault('OTEL_PYTHON_CONTEXT', 'contextvars_context')

# Configure logging for Lambda
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Log Python path and layer accessibility
logger.info(f"Python executable: {sys.executable}")
logger.info(f"Python path: {sys.path}")
logger.info(f"Current working directory: {os.getcwd()}")

# Enhanced layer debugging
logger.info("🔍 LAYER DEBUGGING START")
logger.info(f"Current sys.path: {sys.path}")

# Check all possible layer paths
layer_paths = [
    '/opt/python', 
    '/opt/python/lib/python3.11/site-packages', 
    '/opt/python/lib/python3.11/dist-packages',
    '/opt/python/lib/python3.11',
    '/opt/python/lib'
]

logger.info("🔍 Checking layer paths:")
for path in layer_paths:
    if os.path.exists(path):
        logger.info(f"✅ Layer path exists: {path}")
        try:
            contents = os.listdir(path)
            logger.info(f"   Contents ({len(contents)} items): {contents[:10]}...")
            # Check specifically for requests module
            if 'requests' in contents:
                logger.info(f"   ✅ requests module found in {path}")
            else:
                logger.warning(f"   ❌ requests module NOT found in {path}")
        except Exception as e:
            logger.warning(f"   ❌ Could not list contents of {path}: {e}")
    else:
        logger.warning(f"❌ Layer path not found: {path}")

# Check if any layer paths are in sys.path
logger.info("🔍 Checking sys.path for layer paths:")
for path in sys.path:
    if '/opt/python' in path:
        logger.info(f"✅ Layer path in sys.path: {path}")
        if os.path.exists(path):
            logger.info(f"   ✅ Path exists and is accessible")
        else:
            logger.warning(f"   ❌ Path in sys.path but doesn't exist: {path}")

# Try to import requests directly to test layer accessibility
logger.info("🔍 Testing requests import:")
try:
    import requests
    logger.info("✅ Successfully imported requests from layer")
    logger.info(f"   requests version: {requests.__version__}")
    logger.info(f"   requests location: {requests.__file__}")
except ImportError as e:
    logger.error(f"❌ Failed to import requests: {e}")
    
    # Try to add layer paths to sys.path
    logger.info("🔍 Attempting to add layer paths to sys.path:")
    for path in layer_paths:
        if os.path.exists(path) and path not in sys.path:
            sys.path.insert(0, path)
            logger.info(f"   Added {path} to sys.path")
    
    # Try importing again
    logger.info("🔍 Retrying requests import after path adjustment:")
    try:
        import requests
        logger.info("✅ Successfully imported requests after adding layer paths")
        logger.info(f"   requests version: {requests.__version__}")
        logger.info(f"   requests location: {requests.__file__}")
    except ImportError as e2:
        logger.error(f"❌ Still failed to import requests after path adjustment: {e2}")
        
        # Final attempt - check if we can find any Python packages at all
        logger.info("🔍 Final check - looking for any Python packages:")
        for path in sys.path:
            if os.path.exists(path):
                try:
                    contents = os.listdir(path)
                    python_packages = [item for item in contents if os.path.isdir(os.path.join(path, item)) and not item.startswith('.')]
                    if python_packages:
                        logger.info(f"   Found packages in {path}: {python_packages[:5]}...")
                    else:
                        logger.info(f"   No packages found in {path}")
                except Exception as e3:
                    logger.warning(f"   Could not list {path}: {e3}")

logger.info("🔍 LAYER DEBUGGING END")

# Global variables for lazy loading and connection pooling
_financial_agent = None
_analyze_stock = None
_financial_tools = None

def get_financial_agent():
    """Lazy load the financial agent to improve cold start performance"""
    global _financial_agent, _analyze_stock, _financial_tools
    
    if _financial_agent is None:
        logger.info("Loading financial agent (first time)")
        try:
            from agent import financial_agent, analyze_stock, FinancialTools
            _financial_agent = financial_agent
            _analyze_stock = analyze_stock
            _financial_tools = FinancialTools
            logger.info("Financial agent loaded successfully")
        except Exception as e:
            logger.error(f"Error loading financial agent: {str(e)}")
            raise
    
    return _financial_agent, _analyze_stock, _financial_tools

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main AWS Lambda handler function for API Gateway integration
    Routes requests to appropriate handlers based on the action parameter
    
    Args:
        event: AWS Lambda event object from API Gateway
        context: AWS Lambda context object
        
    Returns:
        HTTP response with CORS headers for API Gateway
    """
    
    # CORS headers for API Gateway responses
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    try:
        # Debug logging to see the full event structure
        logger.info(f"🔍 DEBUG: Full event received: {json.dumps(event, default=str)}")
        logger.info(f"🔍 DEBUG: Event keys: {list(event.keys())}")
        
        # Handle OPTIONS request for CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps({'message': 'CORS preflight successful'})
            }
        
        # Parse request body
        try:
            logger.info(f"🔍 DEBUG: Raw event body: {event.get('body')}")
            logger.info(f"🔍 DEBUG: Body type: {type(event.get('body'))}")
            
            if 'body' in event and event['body']:
                if isinstance(event['body'], str):
                    event_body = json.loads(event['body'])
                else:
                    event_body = event['body']
            else:
                event_body = {}
                
            logger.info(f"🔍 DEBUG: Parsed event_body: {event_body}")
        except json.JSONDecodeError as e:
            logger.error(f"🔍 DEBUG: JSON decode error: {e}")
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Invalid JSON in request body',
                    'message': 'Please provide valid JSON in the request body'
                })
            }
        
        # Extract action from request
        action = event_body.get('action', event.get('pathParameters', {}).get('action', 'chat'))
        
        logger.info(f"Processing action: {action}")
        
        # Route to appropriate handler
        if action == 'analyze_stock':
            result = handle_stock_analysis(event_body)
        elif action == 'chat':
            result = handle_chat_message(event_body)
        elif action == 'analyze_portfolio':
            result = handle_portfolio_analysis(event_body)
        elif action == 'calculate_correlation':
            result = handle_correlation_analysis(event_body)
        elif action == 'health':
            # Lazy load for health check
            _, _, FinancialTools = get_financial_agent()
            result = {
                'statusCode': 200,
                'body': {
                    'status': 'healthy',
                    'service': 'Cosine Financial Analysis Agent',
                    'version': '1.0.0',
                    'timestamp': FinancialTools.get_current_timestamp()
                }
            }
        else:
            result = {
                'statusCode': 400,
                'body': {
                    'error': 'Invalid action',
                    'message': f'Action "{action}" is not supported. Available actions: analyze_stock, chat, analyze_portfolio, calculate_correlation, health'
                }
            }
        
        # Format response for API Gateway
        return {
            'statusCode': result['statusCode'],
            'headers': cors_headers,
            'body': json.dumps(result['body'])
        }
        
    except Exception as e:
        logger.error(f"Unexpected error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'An unexpected error occurred while processing your request'
            })
        }

def handle_stock_analysis(event_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle stock analysis requests
    
    Args:
        event_body: Request body containing stock symbol and optional question
        
    Returns:
        Analysis results with proper error handling
    """
    try:
        # Lazy load the financial agent
        _, analyze_stock, FinancialTools = get_financial_agent()
        
        stock_symbol = event_body.get('symbol', '').upper()
        user_question = event_body.get('question', '')
        
        if not stock_symbol:
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Stock symbol is required',
                    'message': 'Please provide a valid stock symbol in the request body'
                }
            }
        
        # Validate stock symbol format
        if not stock_symbol.isalpha() or len(stock_symbol) > 5:
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Invalid stock symbol format',
                    'message': 'Stock symbol must be 1-5 alphabetic characters'
                }
            }
        
        # Perform stock analysis using the existing agent
        logger.info(f"Analyzing stock: {stock_symbol}")
        analysis_result = analyze_stock(stock_symbol, user_question)
        
        return {
            'statusCode': 200,
            'body': {
                'symbol': stock_symbol,
                'analysis': analysis_result,
                'question': user_question if user_question else None,
                'timestamp': FinancialTools.get_current_timestamp()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in stock analysis: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': 'Analysis failed',
                'message': str(e)
            }
        }

def handle_chat_message(event_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle general chat messages with the financial agent
    
    Args:
        event_body: Request body containing the user message
        
    Returns: --
        Agent response with proper formatting
    """
    try:
        # Debug logging to see what we're receiving
        logger.info(f"🔍 DEBUG: event_body received: {event_body}")
        logger.info(f"🔍 DEBUG: event_body type: {type(event_body)}")
        logger.info(f"🔍 DEBUG: event_body keys: {list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict'}")
        
        # Lazy load the financial agent
        financial_agent, _, FinancialTools = get_financial_agent()
        
        user_message = event_body.get('message', '').strip()
        session_id = event_body.get('session_id', 'default')
        
        logger.info(f"🔍 DEBUG: extracted user_message: '{user_message}'")
        logger.info(f"🔍 DEBUG: extracted session_id: '{session_id}'")
        
        if not user_message:
            logger.error(f"🔍 DEBUG: No message found in event_body: {event_body}")
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Message is required',
                    'message': 'Please provide a message in the request body'
                }
            }
        
        # Process message with the existing financial agent
        logger.info(f"Processing chat message for session: {session_id}")
        agent_response = financial_agent(user_message)
        
        return {
            'statusCode': 200,
            'body': {
                'response': agent_response,
                'session_id': session_id,
                'timestamp': FinancialTools.get_current_timestamp()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in chat processing: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': 'Chat processing failed',
                'message': str(e)
            }
        }

def handle_portfolio_analysis(event_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle portfolio analysis requests
    
    Args:
        event_body: Request body containing portfolio data
        
    Returns:
        Portfolio analysis results
    """
    try:
        # Lazy load the financial tools
        _, _, FinancialTools = get_financial_agent()
        
        portfolio_data = event_body.get('portfolio', [])
        period = event_body.get('period', '1y')
        
        if not portfolio_data:
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Portfolio data is required',
                    'message': 'Please provide portfolio data in the format: [{"ticker": "AAPL", "shares": 100, "price": 150.0}]'
                }
            }
        
        # Validate portfolio data structure
        for holding in portfolio_data:
            if not all(key in holding for key in ['ticker', 'shares', 'price']):
                return {
                    'statusCode': 400,
                    'body': {
                        'error': 'Invalid portfolio data format',
                        'message': 'Each holding must have ticker, shares, and price fields'
                    }
                }
        
        # Perform portfolio analysis using existing tools
        logger.info(f"Analyzing portfolio with {len(portfolio_data)} holdings")
        portfolio_metrics = FinancialTools.calculate_portfolio_metrics(
            json.dumps(portfolio_data), period
        )
        
        return {
            'statusCode': 200,
            'body': {
                'portfolio_analysis': portfolio_metrics,
                'period': period,
                'timestamp': FinancialTools.get_current_timestamp()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in portfolio analysis: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': 'Portfolio analysis failed',
                'message': str(e)
            }
        }

def handle_correlation_analysis(event_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle stock correlation analysis requests
    
    Args:
        event_body: Request body containing list of stock tickers
        
    Returns:
        Correlation analysis results
    """
    try:
        # Lazy load the financial tools
        _, _, FinancialTools = get_financial_agent()
        
        tickers = event_body.get('tickers', [])
        period = event_body.get('period', '1y')
        
        if not tickers or len(tickers) < 2:
            return {
                'statusCode': 400,
                'body': {
                    'error': 'At least 2 stock tickers are required',
                    'message': 'Please provide an array of stock tickers for correlation analysis'
                }
            }
        
        # Validate ticker format
        for ticker in tickers:
            if not isinstance(ticker, str) or not ticker.isalpha():
                return {
                    'statusCode': 400,
                    'body': {
                        'error': 'Invalid ticker format',
                        'message': 'All tickers must be alphabetic strings'
                    }
                }
        
        # Perform correlation analysis using existing tools
        logger.info(f"Calculating correlation for tickers: {tickers}")
        correlation_result = FinancialTools.calculate_correlation(tickers, period)
        
        return {
            'statusCode': 200,
            'body': {
                'correlation_analysis': correlation_result,
                'tickers': tickers,
                'period': period,
                'timestamp': FinancialTools.get_current_timestamp()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in correlation analysis: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': 'Correlation analysis failed',
                'message': str(e)
            }
        }

# Local testing utility
def test_lambda_locally():
    """Test function for local development"""
    test_events = [
        {
            'body': json.dumps({
                'action': 'analyze_stock',
                'symbol': 'AAPL',
                'question': 'Should I buy this stock?'
            })
        },
        {
            'body': json.dumps({
                'action': 'chat',
                'message': 'What are the best tech stocks to invest in?'
            })
        },
        {
            'body': json.dumps({
                'action': 'health'
            })
        }
    ]
    
    print("🧪 Testing Lambda handler locally...")
    for i, test_event in enumerate(test_events, 1):
        print(f"\n--- Test {i} ---")
        result = lambda_handler(test_event, None)
        print(f"Status: {result['statusCode']}")
        print(f"Response: {result['body']}")

if __name__ == "__main__":
    test_lambda_locally()
