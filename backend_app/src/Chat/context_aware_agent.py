"""
Context-Aware Agent System
Creates session-specific agents with proper context isolation
"""

import json
import logging
from typing import Dict, Any, List, Optional
from session_manager import session_manager
from agent import financial_agent, enhanced_tools, create_financial_agent

# Configure logging
logger = logging.getLogger(__name__)

class ContextAwareAgent:
    """
    Creates and manages context-aware agents for different sessions
    Each agent instance is tailored to the specific session context
    """
    
    def __init__(self):
        """Initialize the context-aware agent system"""
        self.base_agent = financial_agent
        self.base_tools = enhanced_tools
        self.session_agents = {}  # Cache for session-specific agents
        
        logger.info("ContextAwareAgent system initialized")
    
    def get_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-3-sonnet') -> Any:
        """
        Get or create a session-specific agent with proper context and model
        
        Args:
            session_context: Complete session context from SessionManager
            model_name: Name of the model to use ('claude-3-sonnet', 'claude-3-haiku', 'gpt-4', 'gpt-3.5-turbo')
            
        Returns:
            agent: Context-aware agent instance
        """
        try:
            session_id = session_context['session_id']
            agent_key = f"{session_id}_{model_name}"  # Include model in cache key
            
            # Check if we already have a cached agent for this session and model
            if agent_key in self.session_agents:
                logger.info(f"Using cached agent for session {session_id} with model {model_name}")
                return self.session_agents[agent_key]
            
            # Create new session-specific agent with the specified model
            agent = self._create_session_agent(session_context, model_name)
            
            # Cache the agent
            self.session_agents[agent_key] = agent
            
            logger.info(f"Created new context-aware agent for session {session_id} with model {model_name}")
            return agent
            
        except Exception as e:
            logger.error(f"Error creating session agent: {str(e)}")
            # Fallback to base agent
            return self.base_agent
    
    def _create_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-3-sonnet') -> Any:
        """
        Create a new agent instance with session-specific context and model
        
        Args:
            session_context: Complete session context
            model_name: Name of the model to use
            
        Returns:
            agent: New agent instance with session context
        """
        try:
            # Generate session-aware system prompt
            system_prompt = self._generate_session_prompt(session_context)
            
            # Get session-specific tools
            session_tools = self._get_session_tools(session_context)
            
            # Create new agent instance with session context and specified model
            from strands import Agent
            from agent import MODELS
            
            if model_name not in MODELS:
                logger.warning(f"Unknown model '{model_name}', falling back to claude-3-sonnet")
                model_name = 'claude-3-sonnet'
            
            selected_model = MODELS[model_name]
            logger.info(f"Creating session agent with model: {model_name}")
            
            session_agent = Agent(
                system_prompt=system_prompt,
                tools=session_tools,
                model=selected_model
            )
            
            # Add session memory if available
            if session_context.get('agent_memory'):
                session_agent.memory = session_context['agent_memory']
            
            return session_agent
            
        except Exception as e:
            logger.error(f"Error creating session agent: {str(e)}")
            raise
    
    def _generate_session_prompt(self, session_context: Dict[str, Any]) -> str:
        """
        Generate a session-aware system prompt
        
        Args:
            session_context: Complete session context
            
        Returns:
            prompt: Session-specific system prompt
        """
        base_prompt = """You are a helpful financial assistant specialized in providing accurate, data-driven financial analysis and recommendations.

🚨 WELCOME MESSAGE RULES:
- Send ONLY ONE welcome message when a user starts a new chat session
- Welcome message: "Hello! I'm Cosine, your AI financial analyst. I can help you with stock analysis, portfolio optimization, market research, and investment insights using real-time data. What would you like to analyze today?"
- Do NOT send multiple welcome messages or follow-up messages automatically
- Only respond to actual user questions, not empty or generic prompts

🚨 SINGLE RESPONSE RULE:
- Provide ONLY ONE response per user message
- Do NOT generate multiple responses or follow-up messages
- Do NOT send additional messages after your initial response
- Complete your analysis in a single, comprehensive response
- Do NOT generate multiple separate messages or responses
- Do NOT provide follow-up analysis unless specifically asked
- End your response after providing the requested analysis

🎯 CORE CAPABILITIES:
- Real-time stock and cryptocurrency analysis
- Portfolio optimization and risk assessment
- Technical and fundamental analysis
- Market research and news analysis
- Quantitative financial calculations

🔧 AVAILABLE TOOLS:
You have access to powerful financial tools including:
- get_financial_data(): Real-time stock/crypto data from yfinance
- analyze_portfolio(): Portfolio analysis with live correlations
- get_technical_analysis(): Technical indicators (RSI, MACD, etc.)
- search_financial_news(): Recent financial news and developments
- calculate_stock_correlation(): Live correlation analysis
- get_volatility_surface(): Volatility analysis and options data
- python_financial_calculator(): Advanced financial calculations

📊 RESPONSE GUIDELINES:
- ALWAYS use tools for financial queries - never provide generic advice
- Start with get_financial_data() for any stock/crypto question
- Provide specific, actionable recommendations with confidence levels
- Include risk assessments and alternative scenarios
- Use current market data and real-time information
- Be transparent about data sources and limitations

⚡ WORKFLOW:
1. IMMEDIATELY call relevant tools (don't explain what you'll do)
2. ALWAYS start with get_financial_data(symbol) for stock questions
3. USE multiple tools per query for comprehensive analysis
4. SYNTHESIZE real tool data into actionable insights

🔴 NEVER SAY:
- "I don't have access to real data"
- "This is sample data"
- "I cannot access live market data"

✅ ALWAYS SAY:
- "Based on current market data from yfinance..."
- "Using live financial data..."
- "Current real-time analysis shows..."
- "Live correlation data indicates..."

"""
        
        # Add session-specific context
        session_info = self._format_session_context(session_context)
        
        return base_prompt + session_info
    
    def _format_session_context(self, session_context: Dict[str, Any]) -> str:
        """
        Format session context for the system prompt
        
        Args:
            session_context: Complete session context
            
        Returns:
            formatted_context: Formatted context string
        """
        try:
            session_id = session_context['session_id']
            metadata = session_context.get('metadata', {})
            context = session_context.get('context', {})
            session_variables = context.get('session_variables', {})
            conversation_history = context.get('conversation_history', [])
            
            # Format webpage information
            webpage_info = f"""
🌐 CURRENT SESSION CONTEXT:
===========================
Session ID: {session_id}
Webpage: {metadata.get('page_url', 'Unknown')}
Page Title: {metadata.get('page_title', 'Unknown')}
User Intent: {metadata.get('user_intent', 'general')}
Page Type: {session_variables.get('page_type', 'unknown')}

📄 WEBPAGE CONTENT:
==================
{context.get('webpage_content', 'No webpage content available')}

🎯 SESSION FOCUS:
================
Based on the current webpage and user intent, focus on:
- {self._get_focus_areas(session_variables)}
- Maintain context of: {metadata.get('user_intent', 'general inquiry')}
- Relevant tools for this session: {', '.join(session_variables.get('relevant_tools', []))}

"""
            
            # Add recent conversation context
            if conversation_history:
                recent_messages = conversation_history[-5:]  # Last 5 messages
                conversation_context = "\n💬 RECENT CONVERSATION:\n=====================\n"
                
                for msg in recent_messages:
                    conversation_context += f"User: {msg.get('user_message', '')}\n"
                    conversation_context += f"Assistant: {msg.get('agent_response', '')[:200]}...\n\n"
                
                webpage_info += conversation_context
            
            # Add session-specific instructions
            webpage_info += f"""
🎯 SESSION-SPECIFIC INSTRUCTIONS:
=================================
- Stay focused on the current session's context and webpage
- Reference webpage content when relevant to user questions
- Maintain conversation continuity within this session
- Don't mix contexts from other sessions or users
- Use session-relevant tools: {', '.join(session_variables.get('relevant_tools', []))}
- If user asks about something not related to current context, gently redirect to session focus

"""
            
            return webpage_info
            
        except Exception as e:
            logger.error(f"Error formatting session context: {str(e)}")
            return "\n🌐 SESSION CONTEXT: Unable to load session context\n"
    
    def _get_focus_areas(self, session_variables: Dict[str, Any]) -> str:
        """Get focus areas based on session variables"""
        page_type = session_variables.get('page_type', 'unknown')
        user_intent = session_variables.get('user_intent', 'general')
        
        focus_map = {
            'crypto': 'cryptocurrency analysis, market trends, and crypto-specific tools',
            'portfolio': 'portfolio optimization, risk assessment, and investment strategies',
            'stocks': 'stock analysis, technical indicators, and market research',
            'dashboard': 'overall financial overview and comprehensive analysis',
            'general': 'general financial inquiries and market analysis'
        }
        
        return focus_map.get(page_type, 'general financial analysis and market insights')
    
    def _get_session_tools(self, session_context: Dict[str, Any]) -> List:
        """
        Get session-specific tools based on context
        
        Args:
            session_context: Complete session context
            
        Returns:
            tools: List of relevant tools for the session
        """
        try:
            session_variables = session_context.get('context', {}).get('session_variables', {})
            relevant_tools = session_variables.get('relevant_tools', [])
            
            # Start with base tools
            session_tools = list(self.base_tools)
            
            # Add session-specific tools based on context
            page_type = session_variables.get('page_type', 'unknown')
            
            if page_type == 'crypto':
                # Add crypto-specific tools if available
                logger.info("Adding crypto-specific tools to session")
            elif page_type == 'portfolio':
                # Add portfolio-specific tools if available
                logger.info("Adding portfolio-specific tools to session")
            elif page_type == 'stocks':
                # Add stock-specific tools if available
                logger.info("Adding stock-specific tools to session")
            
            return session_tools
            
        except Exception as e:
            logger.error(f"Error getting session tools: {str(e)}")
            return self.base_tools
    
    def clear_session_cache(self, session_id: str) -> None:
        """
        Clear cached agent for a session
        
        Args:
            session_id: Session identifier
        """
        if session_id in self.session_agents:
            del self.session_agents[session_id]
            logger.info(f"Cleared cached agent for session {session_id}")
    
    def get_session_summary(self, session_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get a summary of the session for debugging/monitoring
        
        Args:
            session_context: Complete session context
            
        Returns:
            summary: Session summary information
        """
        try:
            metadata = session_context.get('metadata', {})
            context = session_context.get('context', {})
            session_variables = context.get('session_variables', {})
            
            return {
                'session_id': session_context['session_id'],
                'user_id': session_context['user_id'],
                'page_type': session_variables.get('page_type', 'unknown'),
                'user_intent': metadata.get('user_intent', 'general'),
                'conversation_count': metadata.get('conversation_count', 0),
                'last_activity': metadata.get('last_activity', 0),
                'relevant_tools': session_variables.get('relevant_tools', []),
                'webpage_url': metadata.get('page_url', ''),
                'has_webpage_content': bool(context.get('webpage_content', ''))
            }
            
        except Exception as e:
            logger.error(f"Error getting session summary: {str(e)}")
            return {'error': str(e)}

# Global context-aware agent instance
context_aware_agent = ContextAwareAgent()
