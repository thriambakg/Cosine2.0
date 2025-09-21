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
            model_name: Name of the model to use:
                       - 'claude-3-sonnet': Claude 3 Sonnet (default)
                       - 'claude-3-haiku': Claude 3 Haiku (faster, cheaper)
                       - 'gpt-4': Maps to Claude 3 Sonnet (until proper GPT-4 access is configured)
                       - 'gpt-3.5-turbo': Maps to Claude 3 Haiku (until proper GPT-3.5 access is configured)
            
        Returns:
            agent: Context-aware agent instance
        """
        try:
            session_id = session_context['session_id']
            agent_key = f"{session_id}_{model_name}"  # Include model in cache key
            
            logger.info(f"🔍 DEBUG: Getting session agent for session {session_id} with model {model_name}")
            logger.info(f"🔍 DEBUG: Agent key: {agent_key}")
            logger.info(f"🔍 DEBUG: Current cached agents: {list(self.session_agents.keys())}")
            
            # Check if we already have a cached agent for this session and model
            if agent_key in self.session_agents:
                logger.info(f"🔍 DEBUG: Using cached agent for session {session_id} with model {model_name}")
                return self.session_agents[agent_key]
            
            # Check if we're switching models for the same session
            existing_agent_keys = [key for key in self.session_agents.keys() if key.startswith(f"{session_id}_")]
            logger.info(f"🔍 DEBUG: Existing agent keys for session {session_id}: {existing_agent_keys}")
            
            if existing_agent_keys and not any(key.endswith(f"_{model_name}") for key in existing_agent_keys):
                logger.info(f"🔍 DEBUG: Model switch detected for session {session_id}, clearing old agent cache")
                logger.info(f"🔍 DEBUG: Switching from {existing_agent_keys} to {model_name}")
                # Clear old agents for this session to ensure fresh context
                for old_key in existing_agent_keys:
                    logger.info(f"🔍 DEBUG: Clearing old agent: {old_key}")
                    del self.session_agents[old_key]
            
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
            
            # Create agent with conversation history
            logger.info(f"🔍 DEBUG: Creating new agent with model {model_name}")
            session_agent = Agent(
                system_prompt=system_prompt,
                tools=session_tools,
                model=selected_model
            )
            logger.info(f"🔍 DEBUG: Agent created, initial message count: {len(session_agent.messages)}")
            logger.info(f"🔍 DEBUG: Agent tools: {[tool.__name__ if hasattr(tool, '__name__') else str(tool) for tool in session_tools]}")
            
            # Inject conversation history into system prompt for model switching
            system_prompt = self._add_conversation_history_to_prompt(system_prompt, session_context)
            logger.info(f"🔍 DEBUG: Agent created with conversation history in system prompt")
            
            # Add session memory if available
            if session_context.get('agent_memory'):
                session_agent.memory = session_context['agent_memory']
            
            return session_agent
            
        except Exception as e:
            logger.error(f"Error creating session agent: {str(e)}")
            raise
    
    def _add_conversation_history_to_prompt(self, system_prompt: str, session_context: Dict[str, Any]) -> str:
        """
        Add conversation history to the system prompt for model switching.
        This ensures the new model has full context without relying on tool calls or message injection.
        
        Args:
            system_prompt: The base system prompt
            session_context: Complete session context with conversation_history
            
        Returns:
            Enhanced system prompt with conversation history
        """
        try:
            # Get conversation history from session context
            conversation_history = session_context.get('conversation_history', [])
            
            if not conversation_history:
                logger.info("🔍 DEBUG: No conversation history to add to system prompt")
                return system_prompt
            
            logger.info(f"🔍 DEBUG: Adding {len(conversation_history)} conversations to system prompt for model switching")
            
            # Build conversation history section
            history_section = "\n\n📚 CONVERSATION HISTORY FOR CONTEXT:\n"
            history_section += "The following is the conversation history from this session. Use this information to answer questions about previous statements:\n\n"
            
            for i, conv in enumerate(conversation_history, 1):
                user_message = conv.get('user_message', '').strip()
                agent_response = conv.get('agent_response', '').strip()
                
                if user_message:
                    history_section += f"User Message {i}: \"{user_message}\"\n"
                
                if agent_response:
                    history_section += f"Agent Response {i}: \"{agent_response[:200]}...\"\n"
                
                history_section += "---\n"
            
            history_section += "\n🎯 IMPORTANT: If the user asks about their holdings or previous statements, refer to the conversation history above.\n"
            history_section += "For example, if the user previously said 'I have 2 shares of AAPL', then they HAVE 2 shares of AAPL.\n"
            
            logger.info(f"🔍 DEBUG: Added conversation history to system prompt: {len(history_section)} characters")
            
            return system_prompt + history_section
            
        except Exception as e:
            logger.error(f"🔍 DEBUG: Error adding conversation history to prompt: {str(e)}")
            # Return original prompt if there's an error
            return system_prompt
    
    def _generate_session_prompt(self, session_context: Dict[str, Any]) -> str:
        """
        Generate a session-aware system prompt with conversation history
        
        Args:
            session_context: Complete session context including conversation history
            
        Returns:
            prompt: Session-specific system prompt with context
        """
        base_prompt = """You are a helpful financial assistant specialized in providing accurate, data-driven financial analysis and recommendations.

🚨 RESPONSE RULES:
- Only respond to actual user questions and messages
- Do NOT send automatic welcome messages or follow-up messages
- Do NOT generate any greeting messages like "Hello! I'm Cosine..."
- Wait for user input before responding

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
- Conversational context awareness (CHATTING MODE only)

🔄 MODES:
- CHATTING MODE: General conversation with context from previous messages
- ANALYSIS MODE: Financial analysis and research (focus on current data tools)
- Other modes will be implemented in future updates

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
         2. FOR PERSONAL QUESTIONS: Check the CONVERSATION HISTORY section in your system prompt for previous user statements
         3. FOR STOCK ANALYSIS: ALWAYS start with get_financial_data(symbol) for stock questions
         4. USE multiple tools per query for comprehensive analysis
         5. SYNTHESIZE real tool data into actionable insights

         💬 CONVERSATION HISTORY RULES:
         - You have access to the full conversation history through the CONVERSATION HISTORY section in your system prompt
         - When user asks about personal holdings ("How many shares do I have?"), check the CONVERSATION HISTORY section for previous statements
         - If the conversation history shows a user message like "I have 2 shares of AAPL", then the user HAS 2 shares of AAPL
         - NEVER say "I don't have any record" when the conversation history clearly shows user's holdings
         - BE DIRECT: If conversation history shows the user has 2 shares of AAPL, respond "You have 2 shares of AAPL"

         EXAMPLE USAGE:
         User: "How many shares of AAPL do I have?"
         Agent: [Checks CONVERSATION HISTORY section in system prompt for previous user statements about AAPL]
         Agent: [If history shows user said "I have 2 shares of aapl", respond directly: "You have 2 shares of AAPL"]

🔴 NEVER SAY:
- "I don't have access to real data"
- "This is sample data"
- "I cannot access live market data"
- "Hello! I'm Cosine, your AI financial analyst"
- Any greeting or welcome messages
- "I don't have any record of your holdings" when the conversation history clearly shows user's holdings
- "I'm unable to determine" when you can clearly see the user's holdings in the conversation history

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
