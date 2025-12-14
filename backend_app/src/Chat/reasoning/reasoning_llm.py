"""
Reasoning LLM - Formats and explains orchestrator results
Does NOT plan or execute tools - only explains and formats
"""

import json
import logging
from typing import Dict, Any, Optional
from planner.context_aware_agent import ContextAwareAgent

logger = logging.getLogger(__name__)

class ReasoningLLM:
    """
    Reasoning LLM that formats and explains orchestrator results naturally.
    Does NOT plan or execute tools - only provides explanations and formatting.
    """
    
    def __init__(self, context_aware_agent: ContextAwareAgent):
        """
        Initialize the Reasoning LLM.
        
        Args:
            context_aware_agent: ContextAwareAgent instance for LLM calls
        """
        self.context_aware_agent = context_aware_agent
        logger.info("ReasoningLLM initialized")
    
    def format_response(self, user_question: str, chat_payload: Dict[str, Any], 
                       session_context: Dict[str, Any], model: str = 'claude-sonnet-4') -> str:
        """
        Format and explain orchestrator results naturally.
        
        Args:
            user_question: The original user question
            chat_payload: Structured data from orchestrator (table, notes, file_references, etc.)
            session_context: Session context for conversation history
            model: Model to use for reasoning
            
        Returns:
            Natural language response explaining the results
        """
        logger.info(f"Formatting response for question: {user_question[:100]}...")
        
        try:
            # Create a reasoning-specific agent (no tools, no planning capabilities)
            from planner.agent import create_financial_agent
            
            # Create agent with reasoning system prompt (no tools)
            reasoning_prompt = self._create_reasoning_prompt(user_question, chat_payload)
            reasoning_system_prompt = self._get_reasoning_system_prompt(session_context)
            
            # Create agent with reasoning system prompt
            agent = create_financial_agent(model)
            # Override system prompt for reasoning (we'll pass it in the message)
            # Actually, we need to create the agent with the right prompt
            # For now, we'll use the context_aware_agent but with a modified prompt
            
            # Get session agent and modify its behavior via prompt
            agent = self.context_aware_agent.get_session_agent(session_context, model)
            
            # Create full prompt with reasoning instructions
            full_prompt = f"""{reasoning_system_prompt}

{reasoning_prompt}"""
            
            # Get LLM response
            response = agent(full_prompt)
            
            # Extract response content
            if hasattr(response, 'message') and hasattr(response.message, 'content'):
                if isinstance(response.message.content, list):
                    response_text = "".join(str(block) for block in response.message.content)
                else:
                    response_text = str(response.message.content)
            else:
                response_text = str(response)
            
            logger.info(f"Generated reasoning response: {len(response_text)} chars")
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Error formatting response: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            # Fallback to simple summary
            return self._create_fallback_response(chat_payload)
    
    def _create_reasoning_prompt(self, user_question: str, chat_payload: Dict[str, Any]) -> str:
        """
        Create the reasoning prompt for the LLM.
        
        Args:
            user_question: Original user question
            chat_payload: Structured data from orchestrator
            
        Returns:
            Formatted prompt for reasoning LLM
        """
        # Format chat_payload for the prompt
        task_completed = chat_payload.get('task_completed', 'Task completed')
        file_references = chat_payload.get('file_references', [])
        key_results = chat_payload.get('key_results', {})
        table = chat_payload.get('table', [])
        notes = chat_payload.get('notes', [])
        
        prompt = f"""You are a financial explanation assistant. Your job is to explain and format results from tool execution.

🚨 CRITICAL RULES:
=================
- You do NOT plan or execute tools
- You do NOT create execution plans
- You ONLY explain and format results that have already been computed
- You enhance summaries with natural language and context
- You present data outputs clearly alongside your explanations

USER QUESTION:
==============
{user_question}

TASK COMPLETED:
===============
{task_completed}

EXECUTION NOTES:
================
{chr(10).join(f"- {note}" for note in notes)}

KEY RESULTS:
============
{json.dumps(key_results, indent=2) if key_results else "No specific metrics extracted"}

TABULAR DATA:
=============
{json.dumps(table, indent=2) if table else "No tabular data available"}

FILE REFERENCES:
================
"""
        
        if file_references:
            for file_ref in file_references:
                prompt += f"- {file_ref.get('filename', 'Unknown')} ({file_ref.get('type', 'unknown')}): {file_ref.get('description', 'Generated file')}\n"
        else:
            prompt += "No files were generated.\n"
        
        prompt += """
YOUR TASK:
==========
Provide a natural, clear explanation of what was accomplished. Your response should:

1. Directly answer the user's question using the results provided
2. Explain the key findings and metrics in plain language
3. Reference any files that were generated and what they contain
4. Present tabular data in a clear, readable format if applicable
5. Add context and insights that make the results meaningful
6. Be conversational and helpful - like explaining to a colleague

DO NOT:
- Create new plans or suggest tool calls
- Execute any tools
- Return raw data without explanation
- Use technical jargon without explanation

DO:
- Explain what the results mean
- Highlight important findings
- Reference generated files naturally
- Make the data accessible and understandable
- Provide insights based on the results

Format your response naturally, as if you're explaining the analysis to the user."""
        
        return prompt
    
    def _get_reasoning_system_prompt(self, session_context: Dict[str, Any]) -> str:
        """
        Get the system prompt for the Reasoning LLM.
        This is different from the planner prompt - it focuses on explanation, not planning.
        
        Args:
            session_context: Session context for conversation history
            
        Returns:
            System prompt for reasoning
        """
        base_prompt = """You are a financial explanation assistant. Your ONLY job is to explain and format results from tool execution.

🚨 CRITICAL RULES:
=================
- You do NOT plan or execute tools
- You do NOT create execution plans
- You do NOT call tools
- You ONLY explain and format results that have already been computed
- You enhance summaries with natural language and context
- You present data outputs clearly alongside your explanations

YOUR ROLE:
==========
You receive structured data from tool execution (tables, metrics, file references, notes).
Your job is to:
1. Explain what was accomplished in natural language
2. Present key findings and metrics clearly
3. Reference any files that were generated
4. Format tabular data in a readable way
5. Add context and insights that make results meaningful
6. Be conversational and helpful

DO NOT:
- Create new plans or suggest tool calls
- Execute any tools
- Return raw data without explanation
- Use technical jargon without explanation
- Try to plan or organize tool execution

DO:
- Explain what the results mean
- Highlight important findings
- Reference generated files naturally
- Make the data accessible and understandable
- Provide insights based on the results
- Format your response naturally, as if explaining to a colleague

You are part of a three-stage system:
1. PLANNER: Creates execution plans (you don't do this)
2. ORCHESTRATOR: Executes tools and generates data (you don't do this)
3. REASONING (You): Explains and formats the results (this is your job)

Remember: You only explain. You never plan or execute."""
        
        return base_prompt
    
    def _create_fallback_response(self, chat_payload: Dict[str, Any]) -> str:
        """Create a simple fallback response if LLM fails."""
        task_completed = chat_payload.get('task_completed', 'Task completed')
        notes = chat_payload.get('notes', [])
        file_references = chat_payload.get('file_references', [])
        
        response = f"{task_completed}.\n\n"
        
        if notes:
            response += "Summary:\n"
            for note in notes:
                response += f"- {note}\n"
        
        if file_references:
            response += "\nGenerated files:\n"
            for file_ref in file_references:
                response += f"- {file_ref.get('filename', 'Unknown')}\n"
        
        return response

