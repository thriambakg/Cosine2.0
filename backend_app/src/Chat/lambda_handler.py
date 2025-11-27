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

# Configure logging for Lambda (fallback for early initialization)
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Import agent_logger - will be initialized with session context when available
from agent_logger import get_agent_logger


# Simple import test - consolidated logging
try:
    import requests
    import numpy
    import pandas
    logger.debug("All required imports loaded successfully")
except ImportError as e:
    logger.error(f"Failed to import required libraries: {e}")

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
        logger.warning(f"Session {session_id} already killed before processing")
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
                    logger.warning(f"Kill signal detected for session {session_id}: {fresh_context.get('kill_reason', 'unknown')}")
                    kill_flag.set()
                    break
            except Exception as e:
                logger.error(f"Error checking kill signal: {str(e)}")
            
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
                    logger.warning(f"Kill signal received, stopping agent processing for session {session_id}")
                    # Cancel the future if possible
                    future.cancel()
                    raise Exception("Session has been terminated")
                
                # Check if we've exceeded the maximum timeout
                if time.time() - start_time > max_timeout:
                    logger.error(f"Maximum processing time exceeded for session {session_id}")
                    future.cancel()
                    raise Exception("Request timed out after 12 minutes. Please try again.")
                
                time.sleep(5.0)  # Check every 5 seconds (less frequent to reduce CPU usage)
            
            # Get the result
            if future.cancelled():
                raise Exception("Session has been terminated")
            
            return future.result()
            
    except Exception as e:
        if "Session has been terminated" in str(e):
            logger.warning(f"Agent processing terminated for session {session_id}")
            raise e
        elif "Read timed out" in str(e) or "TimeoutError" in str(e):
            logger.error(f"Network timeout during agent processing for session {session_id}")
            raise Exception(f"Request timed out due to network connectivity issues. Please try again.")
        else:
            logger.error(f"Error in kill-monitored processing: {str(e)}")
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
    
    # Try to extract session context early for agent_logger initialization
    session_id = None
    user_id = None
    
    # Try to extract from event early
    try:
        if isinstance(event, dict):
            # Check direct fields
            session_id = event.get('sessionId') or event.get('session_id')
            user_id = event.get('userId') or event.get('user_id')
            
            # Check nested body
            if not session_id and 'body' in event:
                body = event.get('body')
                if isinstance(body, str):
                    try:
                        body = json.loads(body)
                    except:
                        pass
                if isinstance(body, dict):
                    session_id = body.get('sessionId') or body.get('session_id')
                    user_id = body.get('userId') or body.get('user_id')
    except:
        pass
    
    # Initialize agent_logger early if we have context, otherwise use default
    if session_id and user_id:
        agent_logger = get_agent_logger(session_id, user_id)
        # Update agent module's logger
        try:
            import agent as agent_module
            agent_module.agent_logger = agent_logger
        except:
            pass
    else:
        # Use default logger for early logs without session context
        agent_logger = get_agent_logger()
    
    logger.debug("lambda_handler called")
    
    # CORS headers for API Gateway responses
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    try:
        logger.debug(f"Event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
        
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
            event_body = event
        elif 'body' in event and event['body']:
            try:
                if isinstance(event['body'], str):
                    event_body = json.loads(event['body'])
                else:
                    event_body = event['body']
            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Invalid JSON in request body',
                    'message': 'Please provide valid JSON in the request body'
                })
            }
        else:
            logger.warning("No body or action found in event")
            event_body = event
        
        # Re-initialize agent_logger with session context from event_body if available
        session_id_from_body = event_body.get('sessionId') or event_body.get('session_id')
        user_id_from_body = event_body.get('userId') or event_body.get('user_id')
        if session_id_from_body and user_id_from_body and (not session_id or not user_id):
            agent_logger = get_agent_logger(session_id_from_body, user_id_from_body)
            session_id = session_id_from_body
            user_id = user_id_from_body
            # Update agent module's logger
            try:
                import agent as agent_module
                agent_module.agent_logger = agent_logger
            except:
                pass
        
        # Extract action from request
        action = event_body.get('action', event.get('pathParameters', {}).get('action', 'chat'))
        
        logger.info(f"Processing action: {action}")
        
        try:
            if action == 'analyze_stock':
                logger.info("🔍 DEBUG: Routing to stock analysis handler")
                result = handle_stock_analysis(event_body)
            elif action == 'chat':
                logger.debug("Routing to chat message handler")
                result = handle_chat_message(event_body, agent_logger)
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
                logger.warning(f"Invalid action: {action}")
                result = {
                    'statusCode': 400,
                    'body': {
                        'error': 'Invalid action',
                        'message': f'Action "{action}" is not supported. Available actions: analyze_stock, chat, analyze_portfolio, calculate_correlation, health'
                    }
                }
            
            logger.debug("Handler completed successfully")
            
        except Exception as handler_error:
            logger.error(f"Error in handler routing: {str(handler_error)}")
            import traceback
            logger.debug(f"Handler error traceback: {traceback.format_exc()}")
            result = {
                'statusCode': 500,
                'body': {
                    'error': 'Handler execution failed',
                    'message': str(handler_error)
                }
            }
        
        # Format response for API Gateway
        try:
            serialized_body = json.dumps(result['body'])
        except Exception as serialization_error:
            logger.error(f"JSON serialization error: {str(serialization_error)}")
            # Try to identify which field is causing the issue
            for key, value in result['body'].items():
                try:
                    json.dumps(value)
                except Exception as field_error:
                    logger.error(f"Field '{key}' serialization error: {str(field_error)}")
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

def handle_chat_message(event_body: Dict[str, Any], agent_logger=None) -> Dict[str, Any]:
    """
    Handle general chat messages with session-aware financial agent
    
    Args:
        event_body: Request body containing the user message and session info
        agent_logger: AgentLogger instance (will be initialized if not provided)
        
    Returns:
        Agent response with proper formatting
    """
    # Initialize agent_logger if not provided
    if agent_logger is None:
        # Extract session context from event_body
        session_id = event_body.get('sessionId') or event_body.get('session_id')
        user_id = event_body.get('userId') or event_body.get('user_id')
        if session_id and user_id:
            agent_logger = get_agent_logger(session_id, user_id)
        else:
            agent_logger = get_agent_logger()
    
    logger.debug("handle_chat_message called")
    try:
        # Lazy load session management components
        session_manager = get_session_manager()
        context_aware_agent = get_context_aware_agent()
        
        # Extract message from various possible locations
        user_message = None
        session_id = 'default'
        
        if 'message' in event_body:
            user_message = event_body.get('message', '').strip()
        elif 'prompt' in event_body:
            user_message = event_body.get('prompt', '').strip()
        elif 'text' in event_body:
            user_message = event_body.get('text', '').strip()
        elif 'content' in event_body:
            user_message = event_body.get('content', '').strip()
        else:
            # Check if there's a nested structure
            if 'body' in event_body and isinstance(event_body['body'], dict):
                nested_body = event_body['body']
                if 'message' in nested_body:
                    user_message = nested_body.get('message', '').strip()
                elif 'prompt' in nested_body:
                    user_message = nested_body.get('prompt', '').strip()
        
        # Extract session_id and user_id from various possible locations
        session_id = None
        user_id = None
        
        if 'session_id' in event_body:
            session_id = event_body.get('session_id', '').strip()
        elif 'sessionId' in event_body:
            session_id = event_body.get('sessionId', '').strip()
        elif 'context' in event_body and isinstance(event_body['context'], dict):
            context = event_body['context']
            if 'sessionId' in context:
                session_id = context.get('sessionId', '').strip()
        
        # Extract user_id
        if 'userId' in event_body:
            user_id = event_body.get('userId', '').strip()
        elif 'user_id' in event_body:
            user_id = event_body.get('user_id', '').strip()
        elif 'context' in event_body and isinstance(event_body['context'], dict):
            context = event_body['context']
            if 'userId' in context:
                user_id = context.get('userId', '').strip()
        
        # Extract model
        model = 'claude-sonnet-4'  # Default model
        if 'model' in event_body:
            model = event_body.get('model', 'claude-sonnet-4').strip()
        
        # Extract context items
        context_items = event_body.get('contextItems', [])
        
        # Check for originalMessage (used when context is enriched)
        original_user_message = event_body.get('originalMessage')
        
        logger.debug(f"Processing message for session {session_id}, user {user_id}, model {model}")
        
        if not user_message:
            logger.error(f"No message found in event_body")
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
        
        # Re-initialize agent_logger with extracted session_id and user_id if we have them
        if session_id and user_id:
            agent_logger = get_agent_logger(session_id, user_id)
            # Update agent module's logger
            try:
                import agent as agent_module
                agent_module.agent_logger = agent_logger
            except:
                pass
        
        # Handle session management
        session_context = None
        is_new_session = False
        if session_id and user_id:
            # Get existing session context
            session_context = session_manager.get_session_context(session_id, user_id, include_conversation_history=False)
            
            if not session_context:
                logger.warning(f"Session {session_id} not found for user {user_id} - waiting for WebSocket processor to create it")
                # Wait briefly for WebSocket processor to create session (handles race condition)
                max_retries = 3
                retry_delay = 0.5  # 500ms
                
                for attempt in range(max_retries):
                    logger.debug(f"Retry {attempt + 1}/{max_retries}: Waiting for session creation...")
                    time.sleep(retry_delay)
                    session_context = session_manager.get_session_context(session_id, user_id, include_conversation_history=False)
                    
                    if session_context:
                        logger.info(f"Session {session_id} found after retry {attempt + 1}")
                        break
                
                if not session_context:
                    logger.error(f"Session {session_id} still not found after {max_retries} retries")
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
                logger.warning(f"Session {session_id} has been killed: {session_context.get('kill_reason', 'unknown')}")
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
                logger.info("No session_id provided, creating new session")
                page_context = event_body.get('context', {})
                session_id = session_manager.create_session(user_id or 'default', page_context, model)
                session_context = session_manager.get_session_context(session_id, user_id or 'default', include_conversation_history=False)
                is_new_session = True
            else:
                logger.error(f"Missing user_id for session {session_id}")
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
            logger.debug(f"Getting session-aware agent for session {session_id} with model {model}")
            agent = context_aware_agent.get_session_agent(session_context, model)
        else:
            # Fallback to base agent with specified model
            logger.debug(f"Using base financial agent as fallback with model {model}")
            from agent import create_financial_agent
            agent = create_financial_agent(model)
        
        # No automatic welcome message - let the user start the conversation
        
        # Set environment variables for tools to access session and user info
        os.environ['CURRENT_SESSION_ID'] = session_id
        os.environ['CURRENT_USER_ID'] = user_id
        os.environ['SESSION_ID'] = session_id
        os.environ['USER_ID'] = user_id
        
        # Re-initialize agent logger with message_id for this specific message
        message_id = event_body.get('messageId') or f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        agent_logger = get_agent_logger(session_id, user_id, message_id)
        
        # Update the global agent_logger instance in agent.py module
        import agent as agent_module  # Import with alias to avoid shadowing the agent instance variable
        agent_module.agent_logger = agent_logger
        
        # Check if new context items were added (flag from WebSocket processor)
        has_new_context_items = event_body.get('hasNewContextItems', False)
        
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
        
        # Add note about new context items if present
        if has_new_context_items:
            enhanced_message += f"""
🚨 IMPORTANT: NEW CONTEXT ITEMS DETECTED
========================================
The user has just added new context items to this session (articles, stock tiles, etc.).
You MUST call get_session_context_tool(session_id="{session_id}", user_id="{user_id}") immediately 
to discover and access these new context items before responding to the user's question.

The user's question "{user_message}" likely references these newly added context items.
Do NOT respond without first checking what context items are available in the session.

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
            logger.debug("Calling session-aware agent...")
            
            # Check for kill signal before processing
            if session_context and session_context.get('killed_at'):
                logger.warning(f"Session {session_id} has been killed before agent processing")
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
            
            logger.debug(f"Agent response received: {type(agent_response)}")
        except Exception as e:
            # Handle other exceptions
            logger.error(f"Error in agent processing: {str(e)}")
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
            
            logger.debug(f"Extracted response content: {len(response_content)} chars")
            
            # WebSocket processor now handles all user message saving
            # Chat agent only processes and generates responses - no message saving needed
            is_edit = event_body.get('is_edit', False)
            edited_message_id = event_body.get('edited_message_id')
            
            # Send response to SQS for async delivery
            try:
                sqs_queue_url = os.environ.get('CHAT_RESPONSE_SQS_QUEUE_URL')
                if sqs_queue_url:
                    import boto3
                    sqs_client = boto3.client('sqs')
                    
                    # Create SQS message
                    message_id = f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
                    sqs_message = {
                        'type': 'chat_response',
                        'session_id': session_id,
                        'user_id': user_id,
                        'payload': {
                            'session_id': session_id,
                            'user_id': user_id,
                            'response': response_content,
                            'message_id': message_id,
                            'timestamp': int(time.time()),
                            'message_type': 'ai_response'
                        }
                    }
                    
                    # Send to SQS
                    response = sqs_client.send_message(
                        QueueUrl=sqs_queue_url,
                        MessageBody=json.dumps(sqs_message),
                        MessageAttributes={
                            'session_id': {'StringValue': session_id, 'DataType': 'String'},
                            'user_id': {'StringValue': user_id, 'DataType': 'String'},
                            'message_type': {'StringValue': 'chat_response', 'DataType': 'String'}
                        }
                    )
                    
                    logger.info(f"✅ Sent chat response to SQS queue: {response['MessageId']} (session: {session_id}, user: {user_id})")
                    
                    # Return acknowledgment
                    return {
                        'statusCode': 200,
                        'body': {
                            'message': 'Response sent for async delivery',
                            'session_id': session_id,
                            'user_id': user_id,
                            'sqs_message_id': response['MessageId']
                        }
                    }
                else:
                    logger.warning("CHAT_RESPONSE_SQS_QUEUE_URL not configured, falling back to direct response")
                    # Fallback to direct response if SQS not configured
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
                    
            except Exception as sqs_error:
                logger.error(f"Error sending to SQS: {str(sqs_error)}")
                # Fallback to direct response on SQS error
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
        logger.error(f"Error in chat processing: {str(e)}")
        import traceback
        logger.debug(f"Error traceback: {traceback.format_exc()}")
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