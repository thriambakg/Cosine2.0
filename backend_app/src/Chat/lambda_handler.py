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
import time
import uuid
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
_session_manager = None
_context_aware_agent = None

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

def get_session_manager():
    """Lazy load the session manager"""
    global _session_manager
    
    if _session_manager is None:
        logger.info("🔍 DEBUG: Loading session manager (first time)")
        try:
            from session_manager import session_manager
            _session_manager = session_manager
            logger.info("🔍 DEBUG: Session manager loaded successfully")
        except ImportError as e:
            logger.error(f"🔍 DEBUG: Import error loading session manager: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"🔍 DEBUG: General error loading session manager: {str(e)}")
            raise
    else:
        logger.info("🔍 DEBUG: Session manager already loaded, returning cached version")
    
    return _session_manager

def get_context_aware_agent():
    """Lazy load the context-aware agent system"""
    global _context_aware_agent
    
    if _context_aware_agent is None:
        logger.info("🔍 DEBUG: Loading context-aware agent (first time)")
        try:
            from context_aware_agent import context_aware_agent
            _context_aware_agent = context_aware_agent
            logger.info("🔍 DEBUG: Context-aware agent loaded successfully")
        except ImportError as e:
            logger.error(f"🔍 DEBUG: Import error loading context-aware agent: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"🔍 DEBUG: General error loading context-aware agent: {str(e)}")
            raise
    else:
        logger.info("🔍 DEBUG: Context-aware agent already loaded, returning cached version")
    
    return _context_aware_agent

def process_with_kill_monitoring(agent, enhanced_message, session_id, user_id, session_context):
    """
    Process agent with periodic kill signal monitoring
    
    Args:
        agent: The agent to process with
        enhanced_message: The message to process
        session_id: Session ID for kill signal checking
        user_id: User ID for kill signal checking
        session_context: Session context for kill signal checking
        
    Returns:
        Agent response or kill signal response
    """
    import time
    import threading
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
    
    # Check if session is already killed
    if session_context and session_context.get('killed_at'):
        logger.warning(f"🔴 KILL: Session {session_id} already killed before processing")
        raise Exception("Session has been terminated")
    
    # Create a flag to track if processing should stop
    kill_flag = threading.Event()
    
    def check_kill_signal():
        """Periodically check for kill signal"""
        session_manager = get_session_manager()
        check_interval = 30.0  # Check every 30 seconds (much less frequent to reduce polling)
        max_checks = 30  # Maximum 30 checks (15 minutes total)
        check_count = 0
        
        while not kill_flag.is_set() and check_count < max_checks:
            try:
                # Get fresh session context to check for kill signal
                fresh_context = session_manager.get_session_context(session_id, user_id, include_conversation_history=False)
                if fresh_context and fresh_context.get('killed_at'):
                    logger.warning(f"🔴 KILL: Kill signal detected during processing for session {session_id}")
                    logger.warning(f"🔴 KILL: Kill reason: {fresh_context.get('kill_reason', 'unknown')}")
                    logger.warning(f"🔴 KILL: Killed at: {fresh_context.get('killed_at')}")
                    kill_flag.set()
                    break
            except Exception as e:
                logger.error(f"❌ Error checking kill signal: {str(e)}")
            
            check_count += 1
            if check_count < max_checks:
                time.sleep(check_interval)
    
    # Start kill signal monitoring in background thread
    monitor_thread = threading.Thread(target=check_kill_signal, daemon=True)
    monitor_thread.start()
    
    try:
        # Process with timeout and kill signal monitoring
        with ThreadPoolExecutor(max_workers=1) as executor:
            # Submit the agent processing task
            future = executor.submit(agent, enhanced_message)
            
            # Set maximum timeout for the entire operation (12 minutes)
            max_timeout = 720  # 12 minutes in seconds
            start_time = time.time()
            
            # Wait for completion with periodic kill signal checks
            while not future.done():
                if kill_flag.is_set():
                    logger.warning(f"🔴 KILL: Kill signal received, stopping agent processing for session {session_id}")
                    # Cancel the future if possible
                    future.cancel()
                    raise Exception("Session has been terminated")
                
                # Check if we've exceeded the maximum timeout
                if time.time() - start_time > max_timeout:
                    logger.error(f"⏰ TIMEOUT: Maximum processing time exceeded for session {session_id}")
                    future.cancel()
                    raise Exception("Request timed out after 12 minutes. Please try again.")
                
                time.sleep(5.0)  # Check every 5 seconds (less frequent to reduce CPU usage)
            
            # Get the result
            if future.cancelled():
                raise Exception("Session has been terminated")
            
            return future.result()
            
    except Exception as e:
        if "Session has been terminated" in str(e):
            logger.warning(f"🔴 KILL: Agent processing terminated for session {session_id}")
            raise e
        elif "Read timed out" in str(e) or "TimeoutError" in str(e):
            logger.error(f"⏰ TIMEOUT: Network timeout during agent processing for session {session_id}")
            logger.error(f"⏰ TIMEOUT: This may be due to AWS Bedrock connectivity issues")
            raise Exception(f"Request timed out due to network connectivity issues. Please try again.")
        else:
            logger.error(f"❌ Error in kill-monitored processing: {str(e)}")
            raise e
    finally:
        # Signal the monitor thread to stop
        kill_flag.set()
        monitor_thread.join(timeout=1.0)  # Wait up to 1 second for thread to finish

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
    
    print("🔍 DEBUG: lambda_handler function called")
    logger.info("🔍 DEBUG: lambda_handler function called")
    print(f"🔍 DEBUG: event type: {type(event)}")
    logger.info(f"🔍 DEBUG: event type: {type(event)}")
    print(f"🔍 DEBUG: event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
    logger.info(f"🔍 DEBUG: event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
    
    # CORS headers for API Gateway responses
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    print("🔍 DEBUG: About to start event processing")
    logger.info("🔍 DEBUG: About to start event processing")
    
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
                logger.info("🔍 DEBUG: About to call handle_chat_message function")
                result = handle_chat_message(event_body)
                logger.info("🔍 DEBUG: handle_chat_message function returned")
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
        logger.info(f"🔍 DEBUG: About to serialize result body: {result['body']}")
        logger.info(f"🔍 DEBUG: Result body type: {type(result['body'])}")
        
        try:
            serialized_body = json.dumps(result['body'])
            logger.info(f"🔍 DEBUG: Successfully serialized body: {serialized_body}")
        except Exception as serialization_error:
            logger.error(f"🔍 DEBUG: JSON serialization error: {str(serialization_error)}")
            logger.error(f"🔍 DEBUG: Serialization error type: {type(serialization_error)}")
            # Try to identify which field is causing the issue
            for key, value in result['body'].items():
                try:
                    json.dumps(value)
                    logger.info(f"🔍 DEBUG: Field '{key}' serializes successfully")
                except Exception as field_error:
                    logger.error(f"🔍 DEBUG: Field '{key}' serialization error: {str(field_error)}")
                    logger.error(f"🔍 DEBUG: Field '{key}' value type: {type(value)}")
                    logger.error(f"🔍 DEBUG: Field '{key}' value: {value}")
            raise serialization_error
        
        return {
            'statusCode': result['statusCode'],
            'headers': cors_headers,
            'body': serialized_body
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
    Handle general chat messages with session-aware financial agent
    
    Args:
        event_body: Request body containing the user message and session info
        
    Returns:
        Agent response with proper formatting
    """
    logger.info("🔍 DEBUG: handle_chat_message function called")
    try:
        # Debug logging to see what we're receiving
        logger.info(f"🔍 DEBUG: handle_chat_message called with event_body: {event_body}")
        logger.info(f"🔍 DEBUG: event_body type: {type(event_body)}")
        logger.info(f"🔍 DEBUG: event_body keys: {list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict'}")
        
        # Lazy load session management components
        logger.info("🔍 DEBUG: About to call get_session_manager()")
        session_manager = get_session_manager()
        logger.info("🔍 DEBUG: Successfully got session manager")
        
        logger.info("🔍 DEBUG: About to call get_context_aware_agent()")
        context_aware_agent = get_context_aware_agent()
        logger.info("🔍 DEBUG: Successfully got context-aware agent")
        
        # Extract message from various possible locations
        logger.info("🔍 DEBUG: Starting message extraction")
        user_message = None
        session_id = 'default'
        
        # Try different possible message locations
        logger.info("🔍 DEBUG: Checking for message in various fields...")
        
        if 'message' in event_body:
            user_message = event_body.get('message', '').strip()
            logger.info(f"🔍 DEBUG: Found message in 'message' field: '{user_message}'")
        elif 'prompt' in event_body:
            user_message = event_body.get('prompt', '').strip()
            logger.info(f"🔍 DEBUG: Found message in 'prompt' field: '{user_message}'")
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
                elif 'prompt' in nested_body:
                    user_message = nested_body.get('prompt', '').strip()
                    logger.info(f"🔍 DEBUG: Found message in nested 'body.prompt' field: '{user_message}'")
                else:
                    logger.info("🔍 DEBUG: No 'message' or 'prompt' field in nested body")
            else:
                logger.info("🔍 DEBUG: No 'body' field or body is not a dict")
        
        # Extract session_id and user_id from various possible locations
        logger.info("🔍 DEBUG: Checking for session_id and user_id in various fields...")
        logger.info(f"🔍 DEBUG: Full event_body keys: {list(event_body.keys()) if isinstance(event_body, dict) else 'Not a dict'}")
        logger.info(f"🔍 DEBUG: Full event_body: {event_body}")
        session_id = None
        user_id = None
        
        if 'session_id' in event_body:
            session_id = event_body.get('session_id', '').strip()
            logger.info(f"🔍 DEBUG: Found session_id in 'session_id' field: '{session_id}'")
        elif 'sessionId' in event_body:
            session_id = event_body.get('sessionId', '').strip()
            logger.info(f"🔍 DEBUG: Found session_id in 'sessionId' field: '{session_id}'")
        elif 'context' in event_body and isinstance(event_body['context'], dict):
            context = event_body['context']
            logger.info(f"🔍 DEBUG: Found 'context' field, checking for sessionId...")
            if 'sessionId' in context:
                session_id = context.get('sessionId', '').strip()
                logger.info(f"🔍 DEBUG: Found session_id in 'context.sessionId' field: '{session_id}'")
        
        # Extract user_id
        if 'userId' in event_body:
            user_id = event_body.get('userId', '').strip()
            logger.info(f"🔍 DEBUG: Found user_id in 'userId' field: '{user_id}'")
        elif 'user_id' in event_body:
            user_id = event_body.get('user_id', '').strip()
            logger.info(f"🔍 DEBUG: Found user_id in 'user_id' field: '{user_id}'")
        elif 'context' in event_body and isinstance(event_body['context'], dict):
            context = event_body['context']
            if 'userId' in context:
                user_id = context.get('userId', '').strip()
                logger.info(f"🔍 DEBUG: Found user_id in 'context.userId' field: '{user_id}'")
        
        # Extract model
        model = 'claude-sonnet-4'  # Default model
        if 'model' in event_body:
            model = event_body.get('model', 'claude-sonnet-4').strip()
            logger.info(f"🔍 DEBUG: Found model in 'model' field: '{model}'")
        else:
            logger.info(f"🔍 DEBUG: No model found in event_body, using default: '{model}'")
        
        # Extract context items
        context_items = event_body.get('contextItems', [])
        if context_items:
            logger.info(f"🔍 DEBUG: Found {len(context_items)} context items in payload")
            logger.info(f"🔍 DEBUG: Context items preview: {context_items[:1] if context_items else 'None'}")
        else:
            logger.info(f"🔍 DEBUG: No context items found in payload")
        
        # Check for originalMessage (used when context is enriched)
        original_user_message = event_body.get('originalMessage')
        if original_user_message:
            logger.info(f"📌 Using originalMessage for display: '{original_user_message[:100]}...'")
            logger.info(f"📌 Enriched message for AI: '{user_message[:100]}...'")
        
        logger.info(f"🔍 DEBUG: Final extracted user_message: '{user_message[:100] if user_message else None}...'")
        logger.info(f"🔍 DEBUG: Final extracted session_id: '{session_id}'")
        logger.info(f"🔍 DEBUG: Final extracted user_id: '{user_id}'")
        logger.info(f"🔍 DEBUG: Final extracted model: '{model}'")
        
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
        
        # Handle session management
        session_context = None
        is_new_session = False
        if session_id and user_id:
            # Get existing session context
            logger.info(f"🔍 DEBUG: Retrieving session context for session {session_id}")
            session_context = session_manager.get_session_context(session_id, user_id, include_conversation_history=False)
            
            if not session_context:
                logger.warning(f"⚠️ Session {session_id} not found for user {user_id} - waiting for WebSocket processor to create it")
                # Wait briefly for WebSocket processor to create session (handles race condition)
                max_retries = 3
                retry_delay = 0.5  # 500ms
                
                for attempt in range(max_retries):
                    logger.info(f"🔍 Retry {attempt + 1}/{max_retries}: Waiting for session creation...")
                    time.sleep(retry_delay)
                    session_context = session_manager.get_session_context(session_id, user_id, include_conversation_history=False)
                    
                    if session_context:
                        logger.info(f"✅ Session {session_id} found after retry {attempt + 1}")
                        break
                
                if not session_context:
                    logger.error(f"❌ Session {session_id} still not found after {max_retries} retries - WebSocket processor may have failed")
                    return {
                        'statusCode': 404,
                        'body': {
                            'error': 'Session not found',
                            'message': f'Session {session_id} not found for user {user_id} after retries',
                            'session_id': session_id,
                            'user_id': user_id
                        }
                    }
            
            # Check for kill signal before processing
            if session_context.get('killed_at'):
                logger.warning(f"🔴 KILL: Session {session_id} has been killed")
                logger.warning(f"🔴 KILL: Kill reason: {session_context.get('kill_reason', 'unknown')}")
                logger.warning(f"🔴 KILL: Killed at: {session_context.get('killed_at')}")
                return {
                    'statusCode': 410,  # Gone status code
                    'body': {
                        'error': 'Session terminated',
                        'message': f'Session {session_id} has been terminated',
                        'session_id': session_id,
                        'user_id': user_id,
                        'killed_at': session_context.get('killed_at'),
                        'kill_reason': session_context.get('kill_reason', 'unknown')
                    }
                }
        else:
            # Only create a new session if no session_id was provided
            if not session_id:
                logger.info("🔍 DEBUG: No session_id provided, creating new session")
                page_context = event_body.get('context', {})
                session_id = session_manager.create_session(user_id or 'default', page_context, model)
                session_context = session_manager.get_session_context(session_id, user_id or 'default', include_conversation_history=False)
                is_new_session = True
            else:
                logger.error(f"❌ Missing user_id for session {session_id}")
                return {
                    'statusCode': 400,
                    'body': {
                        'error': 'Missing user_id',
                        'message': f'user_id is required for session {session_id}',
                        'session_id': session_id
                    }
                }
        
        # Get session-aware agent with the specified model
        if session_context:
            logger.info(f"🔍 DEBUG: Getting session-aware agent for session {session_id} with model {model}")
            agent = context_aware_agent.get_session_agent(session_context, model)
        else:
            # Fallback to base agent with specified model
            logger.info(f"🔍 DEBUG: Using base financial agent as fallback with model {model}")
            from agent import create_financial_agent
            agent = create_financial_agent(model)
        
        # No automatic welcome message - let the user start the conversation
        
        # Process message with session-aware agent
        logger.info(f"🔍 DEBUG: About to process message with session-aware agent")
        logger.info(f"🔍 DEBUG: Message: '{user_message}'")
        logger.info(f"🔍 DEBUG: Session ID: '{session_id}'")
        
        # Set environment variables for tools to access session and user info
        os.environ['CURRENT_SESSION_ID'] = session_id
        os.environ['CURRENT_USER_ID'] = user_id
        os.environ['SESSION_ID'] = session_id
        os.environ['USER_ID'] = user_id
        
        # Initialize agent logger with session context for WebSocket streaming
        from agent_logger import get_agent_logger
        import agent as agent_module  # Import with alias to avoid shadowing the agent instance variable
        message_id = event_body.get('messageId') or f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        agent_logger = get_agent_logger(session_id, user_id, message_id)
        
        # Update the global agent_logger instance in agent.py module
        agent_module.agent_logger = agent_logger
        
        # Create enhanced message with session context for the agent
        enhanced_message = f"""
User Message: {user_message}

Session Context:
- Session ID: {session_id}
- User ID: {user_id}
- Model: {model}
- Mode: CHATTING MODE
- SECURITY: You have access to the full conversation history through the CONVERSATION HISTORY section in your system prompt
- Use the conversation history in your system prompt to reference previous messages in THIS conversation
"""

        # Add context items to the enhanced message if present
        if context_items:
            context_items_json = json.dumps(context_items)
            enhanced_message += f"""
Context Items Available: {len(context_items)} items
- Use process_chat_session_context_tool(session_id="{session_id}", user_id="{user_id}", context_items='{context_items_json}') to process these context items
- Use analyze_chat_session_context_tool(session_id="{session_id}", user_id="{user_id}", context_items='{context_items_json}', analysis_type="summary") to analyze these context items
- Context items contain chat session data that was added from the history sidebar
- The context_items parameter should be passed as a JSON string
"""
        
        try:
            logger.info("🔍 DEBUG: Calling session-aware agent...")
            
            # Check for kill signal before processing
            if session_context and session_context.get('killed_at'):
                logger.warning(f"🔴 KILL: Session {session_id} has been killed before agent processing")
                logger.warning(f"🔴 KILL: Kill reason: {session_context.get('kill_reason', 'unknown')}")
                logger.warning(f"🔴 KILL: Killed at: {session_context.get('killed_at')}")
                return {
                    'statusCode': 410,
                    'body': {
                        'error': 'Session terminated',
                        'message': f'Session {session_id} has been terminated',
                        'session_id': session_id,
                        'user_id': user_id,
                        'killed_at': session_context.get('killed_at'),
                        'kill_reason': session_context.get('kill_reason', 'unknown')
                    }
                }
            
            # Process with kill signal monitoring
            agent_response = process_with_kill_monitoring(agent, enhanced_message, session_id, user_id, session_context)
            
            # Flush any remaining logs to WebSocket before returning
            try:
                import agent as agent_module  # Import with alias to avoid shadowing
                if hasattr(agent_module, 'agent_logger'):
                    agent_module.agent_logger.flush()
            except Exception as flush_error:
                logger.warning(f"Failed to flush agent logs: {str(flush_error)}")
            
            logger.info(f"🔍 DEBUG: Agent response received: {agent_response}")
            logger.info(f"🔍 DEBUG: Agent response type: {type(agent_response)}")
            if hasattr(agent_response, 'message'):
                logger.info(f"🔍 DEBUG: Agent response message: {agent_response.message}")
                if hasattr(agent_response.message, 'content'):
                    logger.info(f"🔍 DEBUG: Agent response content type: {type(agent_response.message.content)}")
                    logger.info(f"🔍 DEBUG: Agent response content: {agent_response.message.content}")
        except Exception as e:
            # Handle other exceptions
            logger.error(f"❌ Error in agent processing: {str(e)}")
            raise
        
        # Extract the actual response content from AgentResult
        response_content = ""
        if hasattr(agent_response, 'message') and hasattr(agent_response.message, 'content'):
            # Handle structured content (list of content blocks)
            if isinstance(agent_response.message.content, list):
                for content_block in agent_response.message.content:
                    if hasattr(content_block, 'text'):
                        response_content += content_block.text
                    elif isinstance(content_block, str):
                        response_content += content_block
            else:
                response_content = str(agent_response.message.content)
        else:
            # Fallback: convert to string
            response_content = str(agent_response)
            
            # Clean up response content by removing metadata
            def clean_response_content(content):
                """Remove metadata tags from agent response"""
                import re
                
                # Remove search_quality_reflection blocks
                content = re.sub(r'<search_quality_reflection>.*?</search_quality_reflection>', '', content, flags=re.DOTALL)
                
                # Remove search_quality_score blocks
                content = re.sub(r'<search_quality_score>\d+</search_quality_score>', '', content)
                
                # Remove result tags
                content = re.sub(r'<result>', '', content)
                content = re.sub(r'</result>', '', content)
                
                # Clean up extra whitespace
                content = content.strip()
                
                return content
            
            response_content = clean_response_content(response_content)
            
            logger.info(f"🔍 DEBUG: Extracted and cleaned response content: {response_content}")
            logger.info(f"🔍 DEBUG: Response content type: {type(response_content)}")
            
            # WebSocket processor now handles all user message saving
            # Chat agent only processes and generates responses - no message saving needed
            is_edit = event_body.get('is_edit', False)
            edited_message_id = event_body.get('edited_message_id')
            
            if is_edit:
                logger.info(f"✏️ EDIT: This is an edit message - user message already saved by WebSocket processor")
                logger.info(f"✏️ EDIT: Edited message ID: {edited_message_id}")
            else:
                logger.info(f"📌 Normal message - user message already saved by WebSocket processor")
                logger.info(f"📌 Chat agent only processes and generates response (no message saving)")
            
            # Publish response to SNS for async delivery
            try:
                sns_topic_arn = os.environ.get('CHAT_RESPONSE_SNS_TOPIC_ARN')
                if sns_topic_arn:
                    import boto3
                    sns_client = boto3.client('sns')
                    
                    # Create SNS message
                    sns_message = {
                        'session_id': session_id,
                        'user_id': user_id,
                        'response': response_content,
                        'message_id': f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}",
                        'timestamp': int(time.time()),
                        'message_type': 'ai_response'
                    }
                    
                    # Publish to SNS
                    response = sns_client.publish(
                        TopicArn=sns_topic_arn,
                        Message=json.dumps(sns_message),
                        Subject=f"Chat Response for Session {session_id}"
                    )
                    
                    logger.info(f"✅ Published response to SNS: {response['MessageId']}")
                    
                    # Return acknowledgment
                    return {
                        'statusCode': 200,
                        'body': {
                            'message': 'Response published for async delivery',
                            'session_id': session_id,
                            'user_id': user_id,
                            'sns_message_id': response['MessageId']
                        }
                    }
                else:
                    logger.warning("⚠️ CHAT_RESPONSE_SNS_TOPIC_ARN not configured, falling back to direct response")
                    # Fallback to direct response if SNS not configured
                    response_body = {
                        'response': response_content,
                        'session_id': session_id,
                        'user_id': user_id,
                        'timestamp': int(time.time())
                    }
                    return {
                        'statusCode': 200,
                        'body': response_body
                    }
                    
            except Exception as sns_error:
                logger.error(f"❌ Error publishing to SNS: {str(sns_error)}")
                # Fallback to direct response on SNS error
                response_body = {
                    'response': response_content,
                    'session_id': session_id,
                    'user_id': user_id,
                    'timestamp': int(time.time())
                }
                return {
                    'statusCode': 200,
                    'body': response_body
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
                'model': 'claude-sonnet-4',
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
        "model": "claude-sonnet-4",
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