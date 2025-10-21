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
            
            # Inject conversation history into system prompt for model switching
            enhanced_system_prompt = self._add_conversation_history_to_prompt(system_prompt, session_context)
            
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
            
            # Create agent with enhanced system prompt that includes conversation history
            logger.info(f"🔍 DEBUG: Creating new agent with model {model_name}")
            session_agent = Agent(
                system_prompt=enhanced_system_prompt,
                tools=session_tools,
                model=selected_model
            )
            logger.info(f"🔍 DEBUG: Agent created with {len(session_agent.messages)} messages (empty - conversation history is in system prompt)")
            logger.info(f"🔍 DEBUG: Agent tools: {[tool.__name__ if hasattr(tool, '__name__') else str(tool) for tool in session_tools]}")
            logger.info(f"🔍 DEBUG: Agent created with enhanced system prompt containing conversation history")
            
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
            
            logger.info(f"🔍 DEBUG: Added conversation history to system prompt: {len(history_section)} characters")
            logger.info(f"🔍 DEBUG: History section content: {history_section[:200]}...")
            
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
        base_prompt = """You are a financial assistant providing data-driven analysis.

🚨 RULES:
- Provide ONLY ONE complete response per user message
- Use tools for financial queries - start with get_financial_data() for stocks
- ALWAYS provide complete responses - never leave responses empty
- Never return empty responses after calling tools

🔧 TOOLS: get_financial_data, analyze_portfolio, get_technical_analysis, search_financial_news, calculate_stock_correlation, get_volatility_surface, python_financial_calculator, return_files_to_user

⚡ WORKFLOW:
1. Call relevant tools immediately
2. Synthesize tool data into actionable insights
3. Provide complete final response

📋 EXAMPLE FOR FILE REQUESTS:
User: "return the file to me"
Agent: [Calls return_files_to_user("all") tool]
Tool Result: "AGENT_FILE_RETURN: {...}"
Agent: "Files have been returned to your chat interface. You can now download them."

📁 FILE HANDLING:
🚨 CRITICAL: When users ask for files, you MUST use return_files_to_user tool!
- User says "return the file" → IMMEDIATELY call return_files_to_user("all")
- User says "download the file" → IMMEDIATELY call return_files_to_user("all") 
- User says "give me the file" → IMMEDIATELY call return_files_to_user("all")
- User says "send me the file" → IMMEDIATELY call return_files_to_user("all")
- For specific files → Use return_files_to_user("0,2,3") with file indices
- This tool makes files available for download in the chat interface
- DO NOT say you can't access files - ALWAYS try the tool first!

✅ ALWAYS: Use real market data, provide specific recommendations
🔴 NEVER: Return empty responses, get stuck in tool loops, leave responses incomplete

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

📁 UPLOADED FILES IN SESSION:
============================
{self._format_uploaded_files(session_variables)}

📋 CONTEXT ITEMS IN SESSION:
============================
{self._format_context_items(session_variables)}

🎯 SESSION FOCUS:
================
Based on the current webpage and user intent, focus on:
- {self._get_focus_areas(session_variables)}
- Maintain context of: {metadata.get('user_intent', 'general inquiry')}
- Relevant tools for this session: {', '.join(session_variables.get('relevant_tools', []))}

"""
            
            # Add recent conversation context with smart selection
            if conversation_history:
                conversation_context = "\n💬 RECENT CONVERSATION:\n=====================\n"
                
                # Smart context selection: prioritize recent messages but include more if needed
                total_messages = len(conversation_history)
                
                if total_messages <= 5:
                    # Short conversation: include all messages
                    recent_messages = conversation_history
                elif total_messages <= 10:
                    # Medium conversation: include last 5 messages
                    recent_messages = conversation_history[-5:]
                else:
                    # Long conversation: include last 3 + first few for context
                    recent_messages = conversation_history[:2] + conversation_history[-3:]
                
                for i, msg in enumerate(recent_messages):
                    user_msg = msg.get('user_message', '').strip()
                    agent_msg = msg.get('agent_response', '').strip()
                    
                    if user_msg:  # Only include if there's a user message
                        # Use relative numbering for clarity
                        msg_num = conversation_history.index(msg) + 1
                        conversation_context += f"Q{msg_num}: {user_msg}\n"
                        if agent_msg:
                            # Include more of the response for better context
                            conversation_context += f"A{msg_num}: {agent_msg[:1000]}{'...' if len(agent_msg) > 1000 else ''}\n\n"
                
                # Add context summary for long conversations
                if total_messages > 10:
                    conversation_context += f"[Note: This is part of a longer conversation with {total_messages} total exchanges]\n\n"
                
                webpage_info += conversation_context
            
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
- IMPORTANT: If user asks follow-up questions about previous responses, reference the conversation history above
- If user asks about "these stocks" or "which one", check the recent conversation for stock mentions
{context_note}- If user references earlier parts of conversation not shown above, acknowledge the longer conversation context
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
    
    def _format_uploaded_files(self, session_variables: Dict[str, Any]) -> str:
        """Format uploaded files information for the system prompt"""
        try:
            uploaded_files = session_variables.get('uploaded_files', [])
            
            if not uploaded_files:
                return "No files uploaded to this session."
            
            files_info = f"Total files: {len(uploaded_files)}\n"
            
            for i, file_info in enumerate(uploaded_files, 1):
                filename = file_info.get('filename', 'Unknown')
                file_size = file_info.get('file_size', 0)
                content_type = file_info.get('content_type', 'unknown')
                s3_key = file_info.get('s3_key', '')
                
                # Convert bytes to KB/MB for display
                if file_size > 1024 * 1024:
                    size_display = f"{file_size / (1024 * 1024):.1f} MB"
                elif file_size > 1024:
                    size_display = f"{file_size / 1024:.1f} KB"
                else:
                    size_display = f"{file_size} bytes"
                
                files_info += f"{i}. {filename} ({size_display}, {content_type})\n"
                if s3_key:
                    files_info += f"   S3 Key: {s3_key}\n"
            
            files_info += "\n💡 You can use the read_s3_file_tool to read and analyze these files when users ask about them."
            
            return files_info
            
        except Exception as e:
            logger.error(f"Error formatting uploaded files: {str(e)}")
            return "Error loading uploaded files information."
    
    def _format_context_items(self, session_variables: Dict[str, Any]) -> str:
        """Format context items information for the system prompt"""
        try:
            context_items = session_variables.get('context_items', [])
            
            if not context_items:
                return "No context items added to this session."
            
            context_info = f"Total context items: {len(context_items)}\n"
            
            for i, item in enumerate(context_items, 1):
                item_type = item.get('type', 'unknown')
                title = item.get('title', 'Untitled')
                subtitle = item.get('subtitle', '')
                
                context_info += f"{i}. [{item_type.upper()}] {title}\n"
                if subtitle:
                    context_info += f"   {subtitle}\n"
                
                # Add specific information based on item type
                if item_type == 'stock':
                    symbol = item.get('data', {}).get('symbol', '')
                    if symbol:
                        context_info += f"   Symbol: {symbol}\n"
                elif item_type == 'news':
                    source = item.get('data', {}).get('source', '')
                    if source:
                        context_info += f"   Source: {source}\n"
                elif item_type == 'tile':
                    tile_type = item.get('data', {}).get('tile_type', '')
                    if tile_type:
                        context_info += f"   Tile Type: {tile_type}\n"
                elif item_type == 'file':
                    filename = item.get('data', {}).get('original_filename', '')
                    if filename:
                        context_info += f"   File: {filename}\n"
            
            context_info += "\n💡 These context items provide additional information for analysis. Use them to enhance your responses when relevant."
            
            return context_info
            
        except Exception as e:
            logger.error(f"Error formatting context items: {str(e)}")
            return "Error loading context items information."
    
    
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