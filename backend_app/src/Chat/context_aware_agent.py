"""
Context-Aware Agent System
Creates session-specific agents with proper context isolation
"""

# Disable Strands metrics/telemetry to prevent hanging during Agent initialization
import os
os.environ.setdefault('STRANDS_DISABLE_METRICS', 'true')
os.environ.setdefault('STRANDS_DISABLE_TELEMETRY', 'true')
os.environ.setdefault('STRANDS_METRICS_ENABLED', 'false')

import json
import logging
from typing import Dict, Any, List, Optional
from session_manager import session_manager
from agent import enhanced_tools, create_financial_agent

# Configure logging
logger = logging.getLogger(__name__)

class ContextAwareAgent:
    """
    Creates and manages context-aware agents for different sessions
    Each agent instance is tailored to the specific session context
    """
    
    def __init__(self):
        """Initialize the context-aware agent system"""
        self.base_agent = None  # Will be created on demand to avoid import-time creation
        self.base_tools = enhanced_tools
        self.session_agents = {}  # Cache for session-specific agents
        
        logger.debug("ContextAwareAgent system initialized")
    
    def get_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-sonnet-4') -> Any:
        """
        Get or create a session-specific agent with proper context and model
        
        Args:
            session_context: Complete session context from SessionManager
            model_name: Name of the model to use:
                       - 'claude-sonnet-4': Claude Sonnet 4 (default)
                       - 'claude-haiku-4-5': Claude Haiku 4.5 (faster, cheaper)
                       - 'gpt-4': Maps to Claude 3 Sonnet (until proper GPT-4 access is configured)
                       - 'gpt-3.5-turbo': Maps to Claude 3 Haiku (until proper GPT-3.5 access is configured)
            
        Returns:
            agent: Context-aware agent instance
        """
        try:
            session_id = session_context['session_id']
            agent_key = f"{session_id}_{model_name}"  # Include model in cache key
            
            logger.debug(f"Getting session agent for session {session_id} with model {model_name}")
            
            # Check if we already have a cached agent for this session and model
            if agent_key in self.session_agents:
                logger.debug(f"Using cached agent for session {session_id} with model {model_name}")
                return self.session_agents[agent_key]
            
            # Check if we're switching models for the same session
            existing_agent_keys = [key for key in self.session_agents.keys() if key.startswith(f"{session_id}_")]
            
            if existing_agent_keys and not any(key.endswith(f"_{model_name}") for key in existing_agent_keys):
                logger.debug(f"Model switch detected for session {session_id}, clearing old agent cache")
                # Clear old agents for this session to ensure fresh context
                for old_key in existing_agent_keys:
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
    
    def _create_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-sonnet-4') -> Any:
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
            
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to inject full history into system prompt for efficiency
            enhanced_system_prompt = system_prompt
            
            # Get session-specific tools
            session_tools = self._get_session_tools(session_context)
            
            # Create new agent instance with session context and specified model
            from strands import Agent
            from agent import MODELS
            
            if model_name not in MODELS:
                logger.warning(f"Unknown model '{model_name}', falling back to claude-sonnet-4")
                model_name = 'claude-sonnet-4'
            
            selected_model = MODELS[model_name]
            logger.debug(f"Creating session agent with model: {model_name}")
            
            # Wrap Agent creation in timeout to prevent hanging on MetricsClient initialization
            import threading
            
            def create_agent_with_timeout():
                """Create agent with timeout protection"""
                try:
                    return Agent(
                        system_prompt=enhanced_system_prompt,
                        tools=session_tools,
                        model=selected_model
                    )
                except Exception as e:
                    logger.error(f"Error creating Agent: {str(e)}")
                    raise
            
            # Use threading with timeout to prevent hanging
            agent_result = [None]
            agent_exception = [None]
            
            def agent_creator():
                try:
                    agent_result[0] = create_agent_with_timeout()
                except Exception as e:
                    agent_exception[0] = e
            
            agent_thread = threading.Thread(target=agent_creator, daemon=True)
            agent_thread.start()
            agent_thread.join(timeout=10.0)  # 10 second timeout for Agent creation
            
            if agent_thread.is_alive():
                logger.error("Agent creation timed out after 10 seconds - MetricsClient may be hanging")
                raise Exception("Agent creation timed out - Strands MetricsClient initialization may be hanging. Check network connectivity or disable metrics.")
            
            if agent_exception[0]:
                raise agent_exception[0]
            
            if agent_result[0] is None:
                raise Exception("Agent creation failed - no agent returned")
            
            session_agent = agent_result[0]
            logger.debug(f"Agent created with {len(session_agent.messages)} messages")
            
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
                logger.debug("No conversation history to add to system prompt")
                return system_prompt
            
            logger.debug(f"Adding {len(conversation_history)} conversations to system prompt for model switching")
            
            # Build conversation history section
            history_section = "\n\n" + "="*80 + "\n"
            history_section += "📚 CONVERSATION HISTORY FOR CONTEXT:\n"
            history_section += "="*80 + "\n"
            history_section += "🚨 CRITICAL: The following conversation history contains previous user statements AND your previous responses.\n"
            history_section += "When the user asks follow-up questions like 'which one' or 'which has the lowest', CHECK THIS SECTION FIRST.\n"
            history_section += "ALWAYS reference the specific stocks, numbers, and data from your previous responses in this history.\n\n"
            
            for i, conv in enumerate(conversation_history, 1):
                user_message = conv.get('user_message', '').strip()
                agent_response = conv.get('agent_response', '').strip()
                
                if user_message:
                    history_section += f"User Message {i}: \"{user_message}\"\n"
                
                if agent_response:
                    # Include more of the response for better context, especially for stock recommendations
                    truncated_response = agent_response[:1000] + "..." if len(agent_response) > 1000 else agent_response
                    history_section += f"Agent Response {i}: \"{truncated_response}\"\n"
                
                history_section += "---\n"
            
            history_section += "\n" + "="*80 + "\n"
            history_section += "🎯 CRITICAL INSTRUCTIONS:\n"
            history_section += "="*80 + "\n"
            history_section += "If the user asks about their holdings or shares, ALWAYS check the conversation history above.\n"
            history_section += "For example, if the user previously said 'I have 2 shares of AAPL', then they HAVE 2 shares of AAPL.\n"
            history_section += "DO NOT say 'I don't have any record' if the conversation history shows their holdings.\n\n"
            history_section += "If the user asks follow-up questions like 'which one has the lowest market cap' or 'which stock should I pick',\n"
            history_section += "ALWAYS reference the specific stocks and data from your previous response in the conversation history above.\n"
            history_section += "DO NOT mention stocks that weren't in your previous response.\n"
            history_section += "="*80 + "\n"
            
            logger.debug(f"Added conversation history to system prompt: {len(history_section)} characters")
            
            return system_prompt + history_section
            
        except Exception as e:
            logger.error(f"Error adding conversation history to prompt: {str(e)}")
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
        base_prompt = """You are a financial assistant providing data-driven analysis.

🚨 RULES:
- Provide ONLY ONE complete response per user message
- Use tools for financial queries - start with get_financial_data() for stocks
- ALWAYS provide complete responses - never leave responses empty
- Never return empty responses after calling tools

🔧 KEY TOOLS: 
- get_financial_data(symbol, timeframe, start_date, end_date) - LIVE stock data
- get_crypto_data_tool(symbol, timeframe, start_date, end_date) - Crypto data
- generate_chart_tool(symbol, data_json, chart_type, title) - Generate charts
- get_chat_history_tool(session_id, user_id, limit, include_recent) - Get chat history
- search_chat_history_tool(session_id, user_id, search_term, limit) - Search chat history
- generate_agent_file_tool(filename, content, file_type) - Create files
- generate_excel_file_tool(filename, content, template_type, include_charts) - Create CSV files
- get_session_context_tool(session_id, user_id) - Get full session context when needed
- get_session_files_tool(session_id, user_id, file_type) - Get specific files when needed

📊 CHART GENERATION RULES:
- When comparing multiple stocks, ALWAYS call generate_chart_tool ONCE with the COMPLETE result from get_multiple_financial_data
- DO NOT call generate_chart_tool multiple times for each stock - it creates a single comparison chart automatically
- DO NOT call read_s3_file_tool before generate_chart_tool - the tool handles S3 keys automatically
- If get_multiple_financial_data returns data with an s3_key, pass that result directly to generate_chart_tool
- generate_chart_tool will automatically read from S3 if needed - you don't need to read it first
- For comparison charts: data = get_multiple_financial_data("SNAP,SPY", "1y") → generate_chart_tool("SNAP vs SPY", data, "line", normalize=True)
- For normalized comparison charts (showing relative performance), set normalize=True in generate_chart_tool
- NEVER read large S3 files yourself - let generate_chart_tool handle it
- NEVER generate HTML reports when user explicitly asks for a "chart" - use generate_chart_tool instead

📊 HTML REPORT GENERATION RULES:
- NEVER embed all raw data points in HTML files - this causes timeouts
- NEVER call read_s3_file_tool to read full data files when generating HTML reports
- For HTML reports with charts:
  1. Use get_multiple_financial_data to get data (it returns summary metrics)
  2. Call generate_chart_tool to create a chart image (saves to S3)
  3. Create lightweight HTML that embeds the chart image URL and summary metrics only
  4. DO NOT read the full data file - use the summary from step 1
- Keep HTML files under 50KB - use external chart images, not inline data
- Extract only key metrics (CAGR, volatility, max drawdown, Sharpe ratio) from initial tool responses
- If data is stored in S3 (s3_key provided), DO NOT read it - reference it via link instead
- For interactive charts, use Chart.js with <50 sample data points, not full datasets

⚡ WORKFLOW:
1. Call relevant tools immediately
2. Use on-demand tools to get full content when needed
3. Synthesize tool data into actionable insights
4. Provide complete final response

💡 ON-DEMAND LOADING:
- Session context shows summaries only - use tools to get full content
- get_session_context_tool() - Get complete session context when needed
- get_session_files_tool() - Get specific files when needed
- get_chat_history_tool() - Get conversation history when needed

🧠 INTELLIGENT CONTEXT DETECTION: When users ask questions that seem to reference previous data, context, or items from earlier in the conversation, use the appropriate tool:

📋 CONTEXT TOOLS USAGE:
- get_session_context_tool(session_id, user_id) - For files, context items, and session variables
- get_chat_history_tool(session_id, user_id, limit, include_recent) - For previous conversations
- search_chat_history_tool(session_id, user_id, search_term, limit) - For specific topics in chat history

🔍 TRIGGER EXAMPLES:
- "can you see this context item?" → get_session_context_tool()
- "do you remember what I said about AAPL?" → search_chat_history_tool(search_term="AAPL")
- "what did we discuss earlier?" → get_chat_history_tool(limit=5)
- "can you access any previous context items?" → get_session_context_tool()
- "what's in my session?" → get_session_context_tool()
- "do you see this item?" → get_session_context_tool()
- "what did I ask about before?" → get_chat_history_tool(limit=3)

📝 CHAT HISTORY INTERPRETATION:
When get_chat_history_tool returns data:
- If "success": true and "conversations" array has items → There IS previous conversation history
- If "success": true and "conversations" array is empty → No previous conversations in this session
- If "success": false → There was an error retrieving history
- ALWAYS check the "total_conversations" field to understand the full scope
- Use the conversation data to provide accurate summaries of what was discussed
- NEVER say "this is the start of our conversation" if conversations array contains items

🔧 TO GET SESSION_ID AND USER_ID:
- session_id and user_id are provided in the Session Context section of your input message
- Look for "Session ID: {session_id}" and "User ID: {user_id}" in the message you receive
- Use these exact values when calling the tools

✅ ALWAYS: Use real market data, provide specific recommendations
🔴 NEVER: Return empty responses, get stuck in tool loops, leave responses incomplete

"""
        
        # Add session-specific context
        session_info = self._format_session_context(session_context)
        
        return base_prompt + session_info
    
    def _truncate_content(self, content: str, max_length: int = 1000) -> str:
        """
        Truncate content to prevent token limit issues
        
        Args:
            content: Content to truncate
            max_length: Maximum length allowed
            
        Returns:
            Truncated content with ellipsis if needed
        """
        if not content or len(content) <= max_length:
            return content
        
        return content[:max_length] + "... [truncated]"
    
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
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to access conversation_history from context for efficiency
            conversation_history = []
            
            # Format webpage information
            webpage_info = f"""
🌐 CURRENT SESSION CONTEXT:
===========================
Session ID: {session_id}
User ID: {session_context['user_id']}
Webpage: {metadata.get('page_url', 'Unknown')}
Page Title: {metadata.get('page_title', 'Unknown')}
User Intent: {metadata.get('user_intent', 'general')}
Page Type: {session_variables.get('page_type', 'unknown')}

📄 WEBPAGE CONTENT:
==================
💡 Use get_session_context_tool(session_id, user_id) to access webpage content when needed

📁 UPLOADED FILES IN SESSION:
============================
🚨 CRITICAL: When users ask about files, ALWAYS call get_session_files_tool(session_id, user_id, "all") first!
💡 Use get_session_files_tool() to discover and access uploaded files

📋 CONTEXT ITEMS IN SESSION:
============================
🚨 CRITICAL: When users ask about context items, ALWAYS call get_session_context_tool(session_id, user_id) first!
💡 Use get_session_context_tool() to discover and access context items
🚨 NEW CONTEXT ITEMS: If the user message indicates new context items were just added, IMMEDIATELY call get_session_context_tool() 
   to discover what items are available before responding. The user's question likely references these new items.

🎯 SESSION FOCUS:
================
Based on the current webpage and user intent, focus on:
- {self._get_focus_areas(session_variables)}
- Maintain context of: {metadata.get('user_intent', 'general inquiry')}
- Relevant tools for this session: {', '.join(session_variables.get('relevant_tools', []))}

"""
            
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to include conversation history in system prompt for efficiency
            
            # Add session-specific instructions
            context_note = ""
            if len(conversation_history) > 5:
                context_note = f"- This conversation has {len(conversation_history)} total exchanges - reference earlier context if user asks about previous topics\n"
            
            webpage_info += f"""
🎯 SESSION-SPECIFIC INSTRUCTIONS:
=================================
- Stay focused on the current session's context and webpage
- Reference webpage content when relevant to user questions
- Maintain conversation continuity within this session
- Don't mix contexts from other sessions or users
- Use session-relevant tools: {', '.join(session_variables.get('relevant_tools', []))}
- IMPORTANT: If user asks follow-up questions about previous responses, use get_chat_history_tool() or search_chat_history_tool()
- If user asks about "these stocks" or "which one", use search_chat_history_tool() to find relevant previous conversations
{context_note}- If user references earlier parts of conversation, use get_chat_history_tool() to retrieve the relevant history
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
            
            logger.debug(f"Session tools configured for page_type: {page_type}")
            
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
            logger.debug(f"Cleared cached agent for session {session_id}")
    
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