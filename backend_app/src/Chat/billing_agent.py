"""
Enhanced Chat Agent with Usage Tracking and Billing
Modifies the existing agent to track Bedrock usage and tool calls
"""

import json
import logging
import os
import time
from typing import Dict, Any, List, Optional

# Import the original agent components
from agent import (
    FinancialTools, 
    get_financial_data, 
    search_financial_news,
    get_technical_analysis,
    analyze_portfolio,
    calculate_stock_correlation,
    get_volatility_surface,
    python_financial_calculator,
    http_request,
    model,
    FINANCIAL_ANALYSIS_PROMPT
)

# Import usage tracking
from billing.usage_tracker import UsageTracker, InsufficientCreditsError

logger = logging.getLogger(__name__)

class BillingAwareAgent:
    """Chat agent that tracks usage for billing purposes"""
    
    def __init__(self):
        self.usage_tracker = UsageTracker()
        self.original_tools = [
            get_financial_data,
            search_financial_news, 
            get_technical_analysis,
            analyze_portfolio,
            calculate_stock_correlation,
            get_volatility_surface,
            python_financial_calculator,
            http_request
        ]
        
        # Create billing-aware tool wrappers
        self.billing_tools = self._create_billing_tools()
    
    def _create_billing_tools(self):
        """Create tool wrappers that track usage"""
        
        @tool
        def get_financial_data_billing(symbol: str, user_id: str) -> str:
            """Get current stock price, market cap, and financial metrics for a given stock symbol."""
            try:
                # Track tool usage
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'stock_data_fetch', 
                    {'symbol': symbol}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                # Call original tool
                response = get_financial_data(symbol)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in get_financial_data_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def search_financial_news_billing(query: str, user_id: str) -> str:
            """Search for recent financial news and developments about a stock or financial topic."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'news_search', 
                    {'query': query}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = search_financial_news(query)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in search_financial_news_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def get_technical_analysis_billing(symbol: str, user_id: str) -> str:
            """Get technical indicators like RSI, moving averages, MACD, and Bollinger Bands for a stock."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'technical_analysis', 
                    {'symbol': symbol}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = get_technical_analysis(symbol)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in get_technical_analysis_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def analyze_portfolio_billing(portfolio_data: str, period: str, user_id: str) -> str:
            """Analyze a portfolio of stocks with risk metrics, returns, and correlations."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'portfolio_analysis', 
                    {'portfolio_size': len(json.loads(portfolio_data)) if portfolio_data else 0}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = analyze_portfolio(portfolio_data, period)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in analyze_portfolio_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def calculate_stock_correlation_billing(tickers: str, period: str, user_id: str) -> str:
            """Calculate correlation matrix between multiple stocks."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'correlation_analysis', 
                    {'ticker_count': len(tickers.split(','))}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = calculate_stock_correlation(tickers, period)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in calculate_stock_correlation_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def get_volatility_surface_billing(symbol: str, user_id: str) -> str:
            """Calculate implied volatility surface and historical volatility patterns."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'volatility_analysis', 
                    {'symbol': symbol}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = get_volatility_surface(symbol)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in get_volatility_surface_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def python_financial_calculator_billing(calculation: str, user_id: str) -> str:
            """Execute advanced financial calculations including Fama-French analysis."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'advanced_calculations', 
                    {'calculation_type': calculation[:50]}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = python_financial_calculator(calculation)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in python_financial_calculator_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        @tool
        def http_request_billing(url: str, method: str, user_id: str) -> str:
            """Make HTTP requests for additional context."""
            try:
                result = self.usage_tracker.track_tool_usage(
                    user_id, 
                    'http_request', 
                    {'url': url, 'method': method}
                )
                
                if not result['success']:
                    return f"Error tracking usage: {result.get('error', 'Unknown error')}"
                
                response = http_request(url, method)
                return response
                
            except InsufficientCreditsError as e:
                return f"❌ Insufficient credits: {str(e)}. Please add credits to continue."
            except Exception as e:
                logger.error(f"Error in http_request_billing: {str(e)}")
                return f"Error: {str(e)}"
        
        return [
            get_financial_data_billing,
            search_financial_news_billing,
            get_technical_analysis_billing,
            analyze_portfolio_billing,
            calculate_stock_correlation_billing,
            get_volatility_surface_billing,
            python_financial_calculator_billing,
            http_request_billing
        ]
    
    def process_message(self, user_message: str, user_id: str) -> Dict[str, Any]:
        """Process a user message with usage tracking"""
        try:
            # Track chat message usage
            chat_result = self.usage_tracker.track_chat_message(user_id, 'user_message')
            if not chat_result['success']:
                return {
                    'success': False,
                    'error': f"Error tracking chat message: {chat_result.get('error', 'Unknown error')}"
                }
            
            # Get user's current credits
            credits_info = self.usage_tracker.get_user_credits(user_id)
            if not credits_info['success']:
                return {
                    'success': False,
                    'error': f"Error getting user credits: {credits_info.get('error', 'Unknown error')}"
                }
            
            # Check if user has sufficient credits for a basic response
            if credits_info['credits'] < 0.01:  # Minimum cost for a response
                return {
                    'success': False,
                    'error': 'Insufficient credits. Please add credits to continue.',
                    'credits_remaining': credits_info['credits']
                }
            
            # Create billing-aware system prompt
            billing_prompt = f"""
            {FINANCIAL_ANALYSIS_PROMPT}
            
            💰 BILLING INFORMATION:
            - User ID: {user_id}
            - Current Credits: ${credits_info['credits']:.4f}
            - All tool calls will be charged according to usage
            - If user runs out of credits, inform them politely
            
            🔧 AVAILABLE TOOLS (with billing):
            All tools now require user_id parameter for billing tracking.
            """
            
            # Create billing-aware agent
            from strands import Agent
            billing_agent = Agent(
                system_prompt=billing_prompt,
                tools=self.billing_tools,
                model=model
            )
            
            # Process the message
            response = billing_agent(user_message)
            
            # Track Bedrock usage (this would need to be extracted from the agent response)
            # For now, we'll estimate based on message length
            estimated_input_tokens = len(user_message.split()) * 1.3  # Rough estimate
            estimated_output_tokens = len(response.split()) * 1.3
            
            bedrock_result = self.usage_tracker.track_bedrock_usage(
                user_id, 
                int(estimated_input_tokens), 
                int(estimated_output_tokens)
            )
            
            return {
                'success': True,
                'response': response,
                'credits_remaining': credits_info['credits'],
                'usage_tracked': {
                    'chat_message': chat_result['cost'],
                    'bedrock_usage': bedrock_result.get('cost', 0)
                }
            }
            
        except InsufficientCreditsError as e:
            return {
                'success': False,
                'error': str(e),
                'credits_remaining': 0
            }
        except Exception as e:
            logger.error(f"Error processing message: {str(e)}")
            return {
                'success': False,
                'error': f"Processing error: {str(e)}"
            }

# Global instance
billing_agent = BillingAwareAgent()

def lambda_handler(event, context):
    """Lambda handler for billing-aware chat agent"""
    try:
        # Extract user message and user ID from event
        user_message = event.get('message', '')
        user_id = event.get('user_id', '')
        
        if not user_id:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'user_id is required'})
            }
        
        if not user_message:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'message is required'})
            }
        
        # Process message with billing
        result = billing_agent.process_message(user_message, user_id)
        
        if result['success']:
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'response': result['response'],
                    'credits_remaining': result['credits_remaining'],
                    'usage_tracked': result['usage_tracked']
                })
            }
        else:
            return {
                'statusCode': 402,  # Payment Required
                'body': json.dumps({
                    'error': result['error'],
                    'credits_remaining': result.get('credits_remaining', 0)
                })
            }
    
    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }
