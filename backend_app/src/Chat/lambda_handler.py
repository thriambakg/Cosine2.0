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
from typing import Dict, Any

# Import context builder for handling context-aware messages
try:
    from context_builder import build_context_prompt, extract_context_summary
    logger = logging.getLogger()
    logger.info("✅ Successfully imported context_builder")
except ImportError as e:
    logger = logging.getLogger()
    logger.warning(f"⚠️ Could not import context_builder: {e}")
    # Fallback functions if import fails
    def build_context_prompt(user_message, context_items):
        return user_message
    def extract_context_summary(context_items):
        return {'total_items': len(context_items) if context_items else 0}

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
        original_message = None  # For context-aware messages, store original for display
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
        
        # Check if there's an originalMessage (for context-aware messages)
        if 'originalMessage' in event_body:
            original_message = event_body.get('originalMessage', '').strip()
            logger.info(f"📌 Found originalMessage field for frontend display: '{original_message}'")
        
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
        model = 'claude-3-sonnet'  # Default model
        if 'model' in event_body:
            model = event_body.get('model', 'claude-3-sonnet').strip()
            logger.info(f"🔍 DEBUG: Found model in 'model' field: '{model}'")
        else:
            logger.info(f"🔍 DEBUG: No model found in event_body, using default: '{model}'")
        
        logger.info(f"🔍 DEBUG: Final extracted user_message: '{user_message}'")
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
            session_context = session_manager.get_session_context(session_id, user_id)
            
            if not session_context:
                logger.error(f"❌ Session {session_id} not found for user {user_id} - this should not happen if frontend is working correctly")
                # DO NOT create a new session here - this would break continuity
                # Return an error instead
                return {
                    'statusCode': 404,
                    'body': {
                        'error': 'Session not found',
                        'message': f'Session {session_id} not found for user {user_id}',
                        'session_id': session_id,
                        'user_id': user_id
                    }
                }
            
            # Check for kill signal before processing
            if session_context.get('killed_at'):
                logger.warning(f"🔴 KILL: Session {session_id} has been killed (killed_at: {session_context.get('killed_at')}, reason: {session_context.get('kill_reason', 'unknown')})")
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
                session_context = session_manager.get_session_context(session_id, user_id or 'default')
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
        
        # Context handling is now done in WebSocket message processor
        # (message_text is already enriched if context was present)
        # Fallback: If contextItems are in event_body, handle them here
        context_items = event_body.get('contextItems', [])
        has_context = len(context_items) > 0
        
        if has_context:
            logger.info(f"📌 FALLBACK: Context items detected in chat lambda (should be handled by WebSocket processor)")
            logger.info(f"📌 Context-aware message with {len(context_items)} items")
            
            # Build enriched prompt with context (fallback only)
            user_message = build_context_prompt(user_message, context_items)
            logger.info(f"📌 FALLBACK: Enhanced message with context (length: {len(user_message)})")
        
        # Process message with session-aware agent
        logger.info(f"🔍 DEBUG: About to process message with session-aware agent")
        logger.info(f"🔍 DEBUG: Message: '{user_message[:200] if len(user_message) > 200 else user_message}...'")  # Truncate for logging
        logger.info(f"🔍 DEBUG: Session ID: '{session_id}'")
        
        # Create enhanced message with session context for the agent
        # Note: user_message may already be enriched with context data from WebSocket processor
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
        
        try:
            # Final kill signal check before calling agent
            logger.info("🔍 DEBUG: Final kill signal check before agent call...")
            session_context_check = session_manager.get_session_context(session_id, user_id)
            if session_context_check and session_context_check.get('killed_at'):
                logger.warning(f"🔴 KILL: Session {session_id} killed before agent call (killed_at: {session_context_check.get('killed_at')})")
                return {
                    'statusCode': 410,  # Gone status code
                    'body': {
                        'error': 'Session terminated',
                        'message': f'Session {session_id} was terminated before processing',
                        'session_id': session_id,
                        'user_id': user_id,
                        'killed_at': session_context_check.get('killed_at')
                    }
                }
            logger.info("✅ KILL CHECK: Session active, proceeding with agent call")
            
            logger.info("🔍 DEBUG: Calling session-aware agent...")
            agent_response = agent(enhanced_message)
            logger.info(f"🔍 DEBUG: Agent response received: {agent_response}")
            logger.info(f"🔍 DEBUG: Agent response type: {type(agent_response)}")
            if hasattr(agent_response, 'message'):
                logger.info(f"🔍 DEBUG: Agent response message: {agent_response.message}")
                if hasattr(agent_response.message, 'content'):
                    logger.info(f"🔍 DEBUG: Agent response content type: {type(agent_response.message.content)}")
                    logger.info(f"🔍 DEBUG: Agent response content: {agent_response.message.content}")
            
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
            
            # Update session context with new conversation
            # Use original_message for display if available (for context-aware messages)
            message_for_display = original_message if original_message else user_message
            
            if session_context and user_id:
                logger.info(f"🔍 DEBUG: Updating session context for session {session_id}")
                logger.info(f"📌 Using message for display: '{message_for_display[:100]}...'")
                update_success = session_manager.update_session_context(
                    session_id, user_id, message_for_display, response_content, model=model
                )
                if update_success:
                    logger.info(f"✅ Successfully updated session context for session {session_id}")
                else:
                    logger.error(f"❌ Failed to update session context for session {session_id}")
            else:
                logger.warning(f"⚠️ Cannot update session context - session_context: {session_context is not None}, user_id: {user_id is not None}")
            
            response_body = {
                'response': response_content,
                'session_id': session_id,
                'user_id': user_id,
                'timestamp': int(time.time())
            }
            
            logger.info(f"🔍 DEBUG: Response body being returned: {response_body}")
            logger.info(f"🔍 DEBUG: Response body type: {type(response_body)}")
            
            return {
                'statusCode': 200,
                'body': response_body
            }
        except Exception as agent_error:
            logger.error(f"🔍 DEBUG: Error in session-aware agent(): {str(agent_error)}")
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