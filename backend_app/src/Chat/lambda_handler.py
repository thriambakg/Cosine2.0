"""
AWS Lambda handler for Cosine Financial Analysis Agent
Focused on API Gateway integration and business logic only
Resource configuration handled by Terraform
Updated for container deployment
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

# Simple import test
logger.info("🔍 Testing imports...")
try:
    import requests
    logger.info("✅ requests imported successfully")
except ImportError as e:
    logger.error(f"❌ Failed to import requests: {e}")

try:
    import numpy
    logger.info("✅ numpy imported successfully")
except ImportError as e:
    logger.error(f"❌ Failed to import numpy: {e}")

try:
    import pandas
    logger.info("✅ pandas imported successfully")
except ImportError as e:
    logger.error(f"❌ Failed to import pandas: {e}")

logger.info("🔍 Import test completed")

# Global variables for lazy loading and connection pooling
_financial_agent = None
_analyze_stock = None
_financial_tools = None

def get_financial_agent():
    """Lazy load the financial agent to improve cold start performance"""
    global _financial_agent, _analyze_stock, _financial_tools
    
    if _financial_agent is None:
        logger.info("🔍 DEBUG: Loading financial agent (first time)")
        try:
            logger.info("🔍 DEBUG: Attempting to import agent module...")
            from agent import financial_agent, analyze_stock, FinancialTools
            logger.info("🔍 DEBUG: Successfully imported agent module")
            
            _financial_agent = financial_agent
            _analyze_stock = analyze_stock
            _financial_tools = FinancialTools
            logger.info("🔍 DEBUG: Financial agent loaded successfully")
        except ImportError as e:
            logger.error(f"🔍 DEBUG: Import error loading financial agent: {str(e)}")
            logger.error(f"🔍 DEBUG: Import error type: {type(e)}")
            import traceback
            logger.error(f"🔍 DEBUG: Import error traceback: {traceback.format_exc()}")
            raise
        except Exception as e:
            logger.error(f"🔍 DEBUG: General error loading financial agent: {str(e)}")
            logger.error(f"🔍 DEBUG: Error type: {type(e)}")
            import traceback
            logger.error(f"🔍 DEBUG: Error traceback: {traceback.format_exc()}")
            raise
    else:
        logger.info("🔍 DEBUG: Financial agent already loaded, returning cached version")
    
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
        
        # Parse request body - handle both direct event and nested body
        event_body = {}
        
        # Check if this is a direct event (no 'body' wrapper)
        if 'action' in event:
            logger.info("🔍 DEBUG: Direct event structure detected")
            event_body = event
        elif 'body' in event and event['body']:
            logger.info("🔍 DEBUG: Event with body wrapper detected")
            logger.info(f"🔍 DEBUG: Raw event body: {event.get('body')}")
            logger.info(f"🔍 DEBUG: Body type: {type(event.get('body'))}")
            
            try:
                if isinstance(event['body'], str):
                    event_body = json.loads(event['body'])
                else:
                    event_body = event['body']
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
        else:
            logger.warning("🔍 DEBUG: No body or action found in event")
            event_body = event
        
        # Extract action from request
        action = event_body.get('action', event.get('pathParameters', {}).get('action', 'chat'))
        
        logger.info(f"Processing action: {action}")
        logger.info(f"🔍 DEBUG: Final event_body structure: {json.dumps(event_body, default=str)}")
        logger.info(f"🔍 DEBUG: event_body keys: {list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict'}")
        
        # Route to appropriate handler
        logger.info(f"🔍 DEBUG: About to route to handler for action: {action}")
        
        try:
            if action == 'analyze_stock':
                logger.info("🔍 DEBUG: Routing to stock analysis handler")
                result = handle_stock_analysis(event_body)
            elif action == 'chat':
                logger.info("🔍 DEBUG: Routing to chat message handler")
                result = handle_chat_message(event_body)
            elif action == 'analyze_portfolio':
                logger.info("🔍 DEBUG: Routing to portfolio analysis handler")
                result = handle_portfolio_analysis(event_body)
            elif action == 'calculate_correlation':
                logger.info("🔍 DEBUG: Routing to correlation analysis handler")
                result = handle_correlation_analysis(event_body)
            elif action == 'health':
                logger.info("🔍 DEBUG: Routing to health check handler")
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
                logger.info(f"🔍 DEBUG: Invalid action: {action}")
                result = {
                    'statusCode': 400,
                    'body': {
                        'error': 'Invalid action',
                        'message': f'Action "{action}" is not supported. Available actions: analyze_stock, chat, analyze_portfolio, calculate_correlation, health'
                    }
                }
            
            logger.info(f"🔍 DEBUG: Handler completed, result: {result}")
            
        except Exception as handler_error:
            logger.error(f"🔍 DEBUG: Error in handler routing: {str(handler_error)}")
            logger.error(f"🔍 DEBUG: Handler error type: {type(handler_error)}")
            import traceback
            logger.error(f"🔍 DEBUG: Handler error traceback: {traceback.format_exc()}")
            result = {
                'statusCode': 500,
                'body': {
                    'error': 'Handler execution failed',
                    'message': str(handler_error)
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
        
    Returns:
        Agent response with proper formatting
    """
    logger.info("🔍 DEBUG: handle_chat_message function called")
    try:
        # Debug logging to see what we're receiving
        logger.info(f"🔍 DEBUG: handle_chat_message called with event_body: {event_body}")
        logger.info(f"🔍 DEBUG: event_body type: {type(event_body)}")
        logger.info(f"🔍 DEBUG: event_body keys: {list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict'}")
        
        # Lazy load the financial agent
        logger.info("🔍 DEBUG: About to call get_financial_agent()")
        financial_agent, _, FinancialTools = get_financial_agent()
        logger.info("🔍 DEBUG: Successfully got financial agent")
        
        # Extract message from various possible locations
        logger.info("🔍 DEBUG: Starting message extraction")
        user_message = None
        session_id = 'default'
        
        # Try different possible message locations
        logger.info("🔍 DEBUG: Checking for message in various fields...")
        
        if 'message' in event_body:
            user_message = event_body.get('message', '').strip()
            logger.info(f"🔍 DEBUG: Found message in 'message' field: '{user_message}'")
        elif 'text' in event_body:
            user_message = event_body.get('text', '').strip()
            logger.info(f"🔍 DEBUG: Found message in 'text' field: '{user_message}'")
        elif 'content' in event_body:
            user_message = event_body.get('content', '').strip()
            logger.info(f"🔍 DEBUG: Found message in 'content' field: '{user_message}'")
        else:
            # Check if there's a nested structure
            logger.info("🔍 DEBUG: No message in top-level fields, checking nested structure...")
            if 'body' in event_body and isinstance(event_body['body'], dict):
                nested_body = event_body['body']
                logger.info(f"🔍 DEBUG: Found 'body' field, checking nested fields: {list(nested_body.keys())}")
                if 'message' in nested_body:
                    user_message = nested_body.get('message', '').strip()
                    logger.info(f"🔍 DEBUG: Found message in nested 'body.message' field: '{user_message}'")
                else:
                    logger.info("🔍 DEBUG: No 'message' field in nested body")
            else:
                logger.info("🔍 DEBUG: No 'body' field or body is not a dict")
        
        # Extract session_id from various possible locations
        logger.info("🔍 DEBUG: Checking for session_id in various fields...")
        if 'session_id' in event_body:
            session_id = event_body.get('session_id', 'default')
            logger.info(f"🔍 DEBUG: Found session_id in 'session_id' field: '{session_id}'")
        elif 'sessionId' in event_body:
            session_id = event_body.get('sessionId', 'default')
            logger.info(f"🔍 DEBUG: Found session_id in 'sessionId' field: '{session_id}'")
        elif 'context' in event_body and isinstance(event_body['context'], dict):
            context = event_body['context']
            logger.info(f"🔍 DEBUG: Found 'context' field, checking for sessionId...")
            if 'sessionId' in context:
                session_id = context.get('sessionId', 'default')
                logger.info(f"🔍 DEBUG: Found session_id in 'context.sessionId' field: '{session_id}'")
            else:
                logger.info("🔍 DEBUG: No 'sessionId' field in context")
        else:
            logger.info("🔍 DEBUG: No session_id found, using default")
        
        logger.info(f"🔍 DEBUG: Final extracted user_message: '{user_message}'")
        logger.info(f"🔍 DEBUG: Final extracted session_id: '{session_id}'")
        
        if not user_message:
            logger.error(f"🔍 DEBUG: No message found in event_body: {event_body}")
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Message is required',
                    'message': 'Please provide a message in the request body',
                    'debug_info': {
                        'received_keys': list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict',
                        'event_body': event_body
                    }
                }
            }
        
        # Process message with the existing financial agent
        logger.info(f"🔍 DEBUG: About to process message with financial agent")
        logger.info(f"🔍 DEBUG: Message: '{user_message}'")
        logger.info(f"🔍 DEBUG: Session ID: '{session_id}'")
        
        try:
            logger.info("🔍 DEBUG: Calling financial_agent()...")
            agent_response = financial_agent(user_message)
            logger.info(f"🔍 DEBUG: Agent response received: {agent_response}")
            
            return {
                'statusCode': 200,
                'body': {
                    'response': agent_response,
                    'session_id': session_id,
                    'timestamp': FinancialTools.get_current_timestamp()
                }
            }
        except Exception as agent_error:
            logger.error(f"🔍 DEBUG: Error in financial_agent(): {str(agent_error)}")
            logger.error(f"🔍 DEBUG: Agent error type: {type(agent_error)}")
            import traceback
            logger.error(f"🔍 DEBUG: Agent error traceback: {traceback.format_exc()}")
            return {
                'statusCode': 500,
                'body': {
                    'error': 'Agent execution failed',
                    'message': str(agent_error)
                }
            }
        
    except Exception as e:
        logger.error(f"🔍 DEBUG: Error in chat processing: {str(e)}")
        logger.error(f"🔍 DEBUG: Error type: {type(e)}")
        import traceback
        logger.error(f"🔍 DEBUG: Error traceback: {traceback.format_exc()}")
        return {
            'statusCode': 500,
            'body': {
                'error': 'Chat processing failed',
                'message': str(e),
                'error_type': str(type(e))
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
        },
        # Test event that matches the WebSocket Lambda payload structure
        {
            'body': json.dumps({
                'action': 'chat',
                'message': 'Hello, this is a test message',
                'userId': 'test-user-123',
                'model': 'claude-3-sonnet',
                'files': [],
                'context': {
                    'currentPage': 'chat',
                    'sessionId': 'test-session-123'
                }
            })
        }
    ]
    
    print("🧪 Testing Lambda handler locally...")
    for i, test_event in enumerate(test_events, 1):
        print(f"\n--- Test {i} ---")
        result = lambda_handler(test_event, None)
        print(f"Status: {result['statusCode']}")
        print(f"Response: {result['body']}")

# Simple test for manual Lambda testing
def test_simple_event():
    """Simple test event for manual Lambda testing"""
    test_event = {
        "action": "chat",
        "message": "Hello, this is a test message",
        "userId": "test-user-123",
        "model": "claude-3-sonnet",
        "files": [],
        "context": {
            "currentPage": "chat",
            "sessionId": "test-session-123"
        }
    }
    
    print("🧪 Testing with simple event structure...")
    result = lambda_handler(test_event, None)
    print(f"Status: {result['statusCode']}")
    print(f"Response: {result['body']}")

if __name__ == "__main__":
    # Uncomment the line you want to test:
    test_lambda_locally()  # Test with body wrapper
    # test_simple_event()   # Test with direct event structure
