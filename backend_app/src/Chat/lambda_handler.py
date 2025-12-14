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
            # Note: financial_agent and analyze_stock are not used by planner
            # Planner uses context_aware_agent instead
            from planner.agent import FinancialTools
            logger.info("🔍 DEBUG: Successfully imported agent module")
            
            _financial_agent = None  # Not used - planner uses context_aware_agent
            _analyze_stock = None  # Not used - planner uses context_aware_agent
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
            from planner.context_aware_agent import context_aware_agent
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
    Process agent with periodic kill signal monitoring (non-streaming version)
    
    Args:
        agent: The agent to process with
        enhanced_message: The message to process
        session_id: Session ID for kill signal checking
        user_id: User ID for kill signal checking
        session_context: Session context for kill signal checking
        
    Returns:
        Agent response or kill signal response
    """
    # For non-streaming, pass None for streaming-related parameters
    from websocket_handler import WebSocketHandler
    ws_handler = WebSocketHandler()
    streaming_used = {'value': False}
    accumulated_streaming_content = {'value': ''}
    return process_with_kill_monitoring_and_streaming(
        agent, enhanced_message, session_id, user_id, session_context, 
        None, ws_handler, streaming_used, accumulated_streaming_content
    )

def process_with_kill_monitoring_and_streaming(agent, enhanced_message, session_id, user_id, session_context, ai_message_id, ws_handler, streaming_used, accumulated_streaming_content):
    """
    Process agent with periodic kill signal monitoring and streaming support
    
    Args:
        agent: The agent to process with
        enhanced_message: The message to process
        session_id: Session ID for kill signal checking
        user_id: User ID for kill signal checking
        session_context: Session context for kill signal checking
        ai_message_id: Message ID for streaming chunks
        ws_handler: WebSocket handler for sending streaming chunks
        streaming_used: Dict to track if streaming was actually used
        accumulated_streaming_content: Dict to accumulate streaming content
        
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
    
    # Accumulated content for streaming
    accumulated_content = ""
    last_sent_length = 0
    
    try:
        # Process with timeout and kill signal monitoring
        with ThreadPoolExecutor(max_workers=1) as executor:
            # For streaming, we need to intercept the agent's output
            # Strands Agent with streaming=True should stream tokens, but we need to capture them
            # We'll use a wrapper that monitors the agent's response as it's generated
            
            def agent_with_streaming_wrapper():
                """Wrapper to capture streaming output from agent"""
                try:
                    # Check if agent has a stream method (Strands may support this)
                    if hasattr(agent, 'stream'):
                        # Use streaming method if available
                        full_response = ""
                        for chunk in agent.stream(enhanced_message):
                            if kill_flag.is_set():
                                break
                            if chunk:
                                chunk_text = str(chunk)
                                full_response += chunk_text
                                accumulated_streaming_content['value'] = full_response
                                
                                # Send incremental chunk (only new content)
                                if ai_message_id and ws_handler and len(full_response) > last_sent_length:
                                    new_chunk = full_response[last_sent_length:]
                                    last_sent_length = len(full_response)
                                    try:
                                        ws_handler.send_chat_response(
                                            user_id, session_id, new_chunk, ai_message_id,
                                            is_streaming=True, is_complete=False
                                        )
                                        streaming_used['value'] = True
                                    except Exception as e:
                                        logger.warning(f"Failed to send streaming chunk: {str(e)}")
                        return full_response
                    else:
                        # Fallback: Try to access underlying model's streaming if available
                        # Check if agent's model has streaming capabilities
                        if hasattr(agent, 'model') and hasattr(agent.model, 'stream'):
                            # Use model's stream method directly
                            full_response = ""
                            try:
                                # Get the conversation history for the model
                                # For now, we'll use a simplified approach
                                for chunk in agent.model.stream(enhanced_message):
                                    if kill_flag.is_set():
                                        break
                                    if chunk:
                                        chunk_text = str(chunk)
                                        full_response += chunk_text
                                        accumulated_streaming_content['value'] = full_response
                                        
                                        # Send incremental chunk (only new content)
                                        if ai_message_id and ws_handler and len(full_response) > last_sent_length:
                                            new_chunk = full_response[last_sent_length:]
                                            last_sent_length = len(full_response)
                                            try:
                                                ws_handler.send_chat_response(
                                                    user_id, session_id, new_chunk, ai_message_id,
                                                    is_streaming=True, is_complete=False
                                                )
                                                streaming_used['value'] = True
                                            except Exception as e:
                                                logger.warning(f"Failed to send streaming chunk: {str(e)}")
                                
                                # Create agent response object from streamed content
                                from strands.types import AgentResult, Message
                                return AgentResult(message=Message(content=full_response))
                            except Exception as stream_error:
                                logger.warning(f"Model streaming failed, falling back to regular invocation: {str(stream_error)}")
                                # Fall through to regular invocation
                        
                        # Final fallback: Use regular invocation and chunk the response
                        # This simulates streaming by sending response in small chunks
                        response = agent(enhanced_message)
                        response_str = ""
                        if hasattr(response, 'message') and hasattr(response.message, 'content'):
                            if isinstance(response.message.content, list):
                                response_str = "".join(str(block) for block in response.message.content)
                            else:
                                response_str = str(response.message.content)
                        else:
                            response_str = str(response)
                        
                        # Send response in small chunks to simulate streaming
                        chunk_size = 20  # Send 20 characters at a time for smoother appearance
                        for i in range(0, len(response_str), chunk_size):
                            if kill_flag.is_set():
                                break
                            chunk = response_str[i:i+chunk_size]
                            accumulated_streaming_content['value'] += chunk
                            
                            if ai_message_id and ws_handler:
                                try:
                                    is_final = (i+chunk_size >= len(response_str))
                                    ws_handler.send_chat_response(
                                        user_id, session_id, chunk, ai_message_id,
                                        is_streaming=True, is_complete=is_final
                                    )
                                    streaming_used['value'] = True
                                    if not is_final:
                                        time.sleep(0.02)  # Small delay between chunks (20ms)
                                except Exception as e:
                                    logger.warning(f"Failed to send streaming chunk: {str(e)}")
                        
                        return response
                except Exception as e:
                    logger.error(f"Error in streaming wrapper: {str(e)}")
                    raise
            
            # Submit the agent processing task with streaming wrapper
            future = executor.submit(agent_with_streaming_wrapper)
            
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
                
                time.sleep(0.5)  # Check more frequently for streaming (every 0.5 seconds)
            
            # Get the result
            if future.cancelled():
                raise Exception("Session has been terminated")
            
            result = future.result()
            
            # Send final completion signal if streaming was used
            if ai_message_id and ws_handler and accumulated_streaming_content.get('value'):
                try:
                    ws_handler.send_chat_response(
                        user_id, session_id, "", ai_message_id,
                        is_streaming=True, is_complete=True
                    )
                    streaming_used['value'] = True
                except Exception as e:
                    logger.warning(f"Failed to send final streaming chunk: {str(e)}")
            
            return result
            
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
    Main AWS Lambda handler function - handles WebSocket, REST API, and SQS events
    Routes requests to appropriate handlers based on event type
    
    Args:
        event: AWS Lambda event object (WebSocket, REST API, or SQS)
        context: AWS Lambda context object
        
    Returns:
        Response appropriate for event type
    """
    
    # CORS headers for REST API responses (defined at top level for use in exception handler)
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    logger.debug("lambda_handler called")
    logger.debug(f"Event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
    
    # Detect event type and route accordingly
    try:
        # 1. WebSocket API Gateway event (has requestContext with routeKey)
        if 'requestContext' in event and 'routeKey' in event.get('requestContext', {}):
            logger.info("Detected WebSocket API Gateway event")
            from websocket_handler import WebSocketHandler
            ws_handler = WebSocketHandler()
            return ws_handler.process_websocket_message(event)
        
        # 2. SQS event (has Records array)
        elif 'Records' in event and isinstance(event.get('Records'), list):
            logger.info("Detected SQS event")
            # Check if it's an SQS record
            first_record = event['Records'][0]
            if 'eventSource' in first_record and first_record.get('eventSource') == 'aws:sqs':
                logger.info("Processing SQS event (backward compatibility - should not be used)")
                # For backward compatibility, but we don't use SQS anymore
                # This could be removed in future
                return {
                    'statusCode': 200,
                    'body': json.dumps({'message': 'SQS events no longer processed - use direct WebSocket'})
                }
        
        # 3. REST API Gateway event (has httpMethod or path)
        elif 'httpMethod' in event or 'path' in event:
            logger.info("Detected REST API Gateway event")
            logger.debug(f"REST API event structure: httpMethod={event.get('httpMethod')}, path={event.get('path')}, resource={event.get('resource')}, pathParameters={event.get('pathParameters')}")
            
            # Use CORS headers defined at top of function
            
            # Handle OPTIONS request for CORS preflight
            if event.get('httpMethod') == 'OPTIONS':
                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps({'message': 'CORS preflight successful'})
                }
            
            # Check if this is the /files endpoint (file upload)
            # Check multiple possible path formats
            path = event.get('path', '')
            resource = event.get('resource', '')
            path_parameters = event.get('pathParameters') or {}
            
            # Log path detection for debugging
            logger.debug(f"Path detection: path='{path}', resource='{resource}', pathParameters={path_parameters}")
            
            is_files_endpoint = (
                '/files' in path or 
                resource.endswith('/files') or 
                path.endswith('/files') or
                'files' in path_parameters.values()
            )
            
            if is_files_endpoint:
                logger.info(f"Processing file upload request - path: {path}, resource: {resource}")
                logger.debug(f"Event body type: {type(event.get('body'))}, body length: {len(str(event.get('body', '')))}")
                try:
                    from file_upload_handler import FileUploadHandler
                    file_handler = FileUploadHandler()
                    result = file_handler.handle_file_upload(event)
                    
                    # Ensure result is a valid dict
                    if not isinstance(result, dict):
                        logger.error(f"File upload handler returned invalid result type: {type(result)}")
                        result = {
                            'statusCode': 500,
                            'headers': cors_headers,
                            'body': json.dumps({'error': 'Invalid response from file upload handler'})
                        }
                    
                    # Ensure CORS headers are always present
                    if 'headers' not in result:
                        result['headers'] = cors_headers.copy()
                    elif 'Access-Control-Allow-Origin' not in result.get('headers', {}):
                        result['headers'] = {**result.get('headers', {}), **cors_headers}
                    
                    # Ensure statusCode is present
                    if 'statusCode' not in result:
                        result['statusCode'] = 200
                    
                    logger.info(f"File upload handler returned: statusCode={result.get('statusCode')}")
                    return result
                except Exception as e:
                    logger.error(f"Error in file upload handler: {str(e)}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                    return {
                        'statusCode': 500,
                        'headers': cors_headers,
                        'body': json.dumps({
                            'error': 'Internal server error',
                            'message': str(e)
                        })
                    }
            
            # Otherwise, process as regular REST API request
            return handle_rest_api_request(event, cors_headers)
        
        # 4. Direct invocation (for testing or internal calls, including session_update from agent_files_processor)
        else:
            logger.info("Detected direct invocation event")
            
            # Check if this is a session_update from agent_files_processor
            if event.get('type') == 'session_update':
                logger.info("Processing session_update from agent_files_processor")
                from websocket_handler import WebSocketHandler
                ws_handler = WebSocketHandler()
                
                user_id = event.get('user_id')
                session_id = event.get('session_id')
                session_variables = event.get('session_variables', {})
                
                if user_id and session_id:
                    # Send session update to WebSocket connections
                    ws_handler._send_session_update_with_variables(user_id, session_id, session_variables)
                    logger.info(f"✅ Sent session_update to WebSocket for session {session_id}")
                    return {
                        'statusCode': 200,
                        'body': json.dumps({'message': 'Session update sent to WebSocket'})
                    }
                else:
                    logger.error("session_update missing user_id or session_id")
                    return {
                        'statusCode': 400,
                        'body': json.dumps({'error': 'Missing user_id or session_id'})
                    }
            
            return handle_rest_api_request(event, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Content-Type': 'application/json'
            })
            
    except Exception as e:
        logger.error(f"Unexpected error in lambda_handler: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Check if this is a REST API event - if so, return CORS headers
        if 'httpMethod' in event or 'path' in event:
            # This is a REST API event - return error with CORS headers
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Internal server error',
                    'message': str(e)
                })
            }
        
        # For WebSocket or other events, return appropriate error format
        # Use the cors_headers defined at the top of the function
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'An unexpected error occurred while processing your request'
            })
        }


def handle_rest_api_request(event: Dict[str, Any], cors_headers: Dict[str, str]) -> Dict[str, Any]:
    """
    Handle REST API Gateway requests (original logic)
    
    Args:
        event: REST API Gateway event
        cors_headers: CORS headers to include in response
        
    Returns:
        HTTP response with CORS headers
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
            from planner import agent as agent_module
            agent_module.agent_logger = agent_logger
        except:
            pass
    else:
        # Use default logger for early logs without session context
        agent_logger = get_agent_logger()
    
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
            from planner import agent as agent_module
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
                from planner import agent as agent_module
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
        
        # Set environment variables for tools to access session and user info
        os.environ['CURRENT_SESSION_ID'] = session_id
        os.environ['CURRENT_USER_ID'] = user_id
        os.environ['SESSION_ID'] = session_id
        os.environ['USER_ID'] = user_id
        
        # Generate UNIQUE message ID for AI response (don't reuse user's message_id!)
        ai_message_id = f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        
        # Re-initialize agent logger with message_id for this specific message
        agent_logger = get_agent_logger(session_id, user_id, ai_message_id)
        
        # Update the global agent_logger instance in planner.agent module
        from planner import agent as agent_module
        agent_module.agent_logger = agent_logger
        
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
        
        # NEW FLOW: Always route through Planner → Orchestrator → Reasoning LLM
        try:
            from planner import Planner
            from orchestrator import Orchestrator, ToolExecutor, DataStorage, StatusReporter
            from reasoning import ReasoningLLM
            from websocket_handler import WebSocketHandler
            
            logger.info(f"Routing message through Planner → Orchestrator → Reasoning LLM")
            
            # Step 1: Create plan using Planner
            planner = Planner(context_aware_agent)
            plan = planner.create_plan(user_message, session_context, model)
            
            # Check if planner needs more information from user
            if plan.get('need_info', False):
                logger.info("Planner needs more information from user")
                # Route to Reasoning LLM to format the question nicely
                reasoning_llm = ReasoningLLM(context_aware_agent)
                missing_info = plan.get('missing_info', 'additional information')
                question = plan.get('question', f'Could you please provide {missing_info}?')
                
                # Create a chat payload for the reasoning LLM
                chat_payload = {
                    'task_completed': f"Need {missing_info} to proceed",
                    'file_references': [],
                    'key_results': {},
                    'table': [],
                    'notes': [f"Planner needs: {missing_info}", f"Question: {question}"]
                }
                
                # Format the question using Reasoning LLM
                response_content = reasoning_llm.format_response(
                    user_message,
                    chat_payload,
                    session_context,
                    model
                )
                
                # Send response via WebSocket
                ws_handler = WebSocketHandler()
                ws_handler.send_chat_response(
                    user_id=user_id,
                    session_id=session_id,
                    message_id=ai_message_id,
                    response_content=response_content
                )
                
                # Save to DynamoDB
                try:
                    session_manager.save_message(
                        session_id=session_id,
                        user_id=user_id,
                        message_id=ai_message_id,
                        sender='ai',
                        content=response_content,
                        timestamp=int(time.time() * 1000)
                    )
                    logger.info(f"✅ Saved AI response to DynamoDB: {ai_message_id} (length: {len(response_content)})")
                except Exception as db_error:
                    logger.error(f"Error saving AI response to DynamoDB: {str(db_error)}")
                
                return {
                    'statusCode': 200,
                    'body': {
                        'message': 'Response sent',
                        'session_id': session_id,
                        'user_id': user_id,
                        'message_id': ai_message_id,
                        'response_type': 'need_info'
                    }
                }
            
            if not plan or 'steps' not in plan or len(plan.get('steps', [])) == 0:
                logger.error("Planner did not return a valid plan")
                return {
                    'statusCode': 500,
                    'body': {
                        'error': 'Planning failed',
                        'message': 'Planner did not generate a valid execution plan',
                        'session_id': session_id,
                        'user_id': user_id
                    }
                }
            
            logger.info(f"Planner created plan with {len(plan['steps'])} steps")
            
            # Step 2: Execute plan using Orchestrator
            ws_handler = WebSocketHandler()
            tool_executor = ToolExecutor()
            data_storage = DataStorage()
            status_reporter = StatusReporter(ws_handler)
            orchestrator = Orchestrator(tool_executor, data_storage, status_reporter)
            
            execution_results = orchestrator.execute_plan(plan, session_id, user_id, ai_message_id)
            
            if execution_results.get('status') == 'failed' and execution_results.get('steps_completed', 0) == 0:
                logger.error("Orchestrator execution failed completely")
                return {
                    'statusCode': 500,
                    'body': {
                        'error': 'Execution failed',
                        'message': 'All plan steps failed during execution',
                        'session_id': session_id,
                        'user_id': user_id
                    }
                }
            
            # Step 3: Format response using Reasoning LLM
            chat_payload = execution_results.get('summary', {})
            reasoning_llm = ReasoningLLM(context_aware_agent)
            
            # Use streaming for Reasoning LLM response
            streaming_used = {'value': False}
            accumulated_streaming_content = {'value': ''}
            
            # Get reasoning response (this will be natural language explanation)
            response_content = reasoning_llm.format_response(
                user_message, 
                chat_payload, 
                session_context, 
                model
            )
            
            # Note: File references and data outputs are already handled by orchestrator
            # and will be available to the user through the file system
            
        except Exception as e:
            logger.error(f"Error in Planner → Orchestrator → Reasoning LLM flow: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'statusCode': 500,
                'body': {
                    'error': 'Processing failed',
                    'message': f'Error in processing pipeline: {str(e)}',
                    'session_id': session_id,
                    'user_id': user_id
                }
            }
        
        # WebSocket processor now handles all user message saving
        # Chat agent only processes and generates responses - no message saving needed
        is_edit = event_body.get('is_edit', False)
        edited_message_id = event_body.get('edited_message_id')
        
        # Send response directly to WebSocket
        try:
            from websocket_handler import WebSocketHandler
            ws_handler = WebSocketHandler()
            
            # Send Reasoning LLM response to user
            ws_handler.send_chat_response(user_id, session_id, response_content, ai_message_id)
            
            logger.info(f"✅ Sent reasoning response to WebSocket (session: {session_id}, user: {user_id})")
            
            # Save AI response to DynamoDB
            if response_content and response_content.strip():
                try:
                    import boto3
                    from decimal import Decimal
                    dynamodb = boto3.resource('dynamodb')
                    chat_sessions_table = dynamodb.Table(os.environ['CHAT_SESSIONS_TABLE_NAME'])
                    
                    # Get current messages
                    session_response = chat_sessions_table.get_item(
                        Key={'user_id': user_id, 'session_id': session_id},
                        ConsistentRead=True
                    )
                    
                    if 'Item' in session_response:
                        messages = session_response['Item'].get('messages', [])
                        timestamp = int(time.time())
                        
                        # Check for duplicates BEFORE creating the message object
                        # Check by ID first (most reliable)
                        existing_by_id = any(m.get('id') == ai_message_id for m in messages)
                        if existing_by_id:
                            logger.warning(f"⚠️ AI message {ai_message_id} already exists in DynamoDB (duplicate by ID), skipping save")
                        else:
                            # Also check by content for bot messages (in case ID differs but content is identical)
                            # Only check content if it's a bot message to avoid false positives
                            existing_by_content = any(
                                m.get('sender') == 'bot' and 
                                m.get('text') == response_content and 
                                m.get('id') != ai_message_id  # Different ID but same content
                                for m in messages
                            )
                            if existing_by_content:
                                logger.warning(f"⚠️ AI message with identical content already exists in DynamoDB (duplicate by content), skipping save")
                            else:
                                # Add AI response message with unique ID
                                ai_message = {
                                    'id': ai_message_id,
                                    'text': response_content,
                                    'sender': 'bot',
                                    'timestamp': timestamp,
                                    'message_type': 'text'
                                }
                                
                                messages.append(ai_message)
                                
                                chat_sessions_table.update_item(
                                    Key={'user_id': user_id, 'session_id': session_id},
                                    UpdateExpression='SET messages = :messages, message_count = :count, last_updated = :timestamp',
                                    ExpressionAttributeValues={
                                        ':messages': messages,
                                        ':count': len(messages),
                                        ':timestamp': timestamp
                                    }
                                )
                                logger.info(f"✅ Saved AI response to DynamoDB: {ai_message_id} (length: {len(response_content)})")
                except Exception as db_error:
                    logger.warning(f"Failed to save AI response to DynamoDB: {str(db_error)}")
                    # Continue - response was sent via WebSocket
            else:
                logger.warning(f"⚠️ No content to save for AI message {ai_message_id}, skipping DynamoDB save")
            
            # Return acknowledgment
            return {
                'statusCode': 200,
                'body': {
                    'message': 'Response sent directly to WebSocket',
                    'session_id': session_id,
                    'user_id': user_id,
                    'message_id': ai_message_id  # Return the AI message ID, not user's message_id
                }
            }
        except Exception as ws_error:
            logger.error(f"Error sending to WebSocket: {str(ws_error)}")
            # Fallback to direct response on WebSocket error
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