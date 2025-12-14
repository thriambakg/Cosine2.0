"""
Planner - LLM-based planning system
Creates structured execution plans for complex tasks
"""

import json
import logging
import re
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class Planner:
    """
    LLM-based planner that creates execution plans for complex tasks.
    Uses the context-aware agent to understand goals and create structured plans.
    """
    
    def __init__(self, context_aware_agent):
        """
        Initialize the planner.
        
        Args:
            context_aware_agent: ContextAwareAgent instance for LLM calls
        """
        self.context_aware_agent = context_aware_agent
        logger.info("Planner initialized")
    
    def create_plan(self, user_query: str, session_context: Dict[str, Any], model: str = 'claude-sonnet-4') -> Dict[str, Any]:
        """
        Create an execution plan for a user query.
        
        Args:
            user_query: The user's query/request
            session_context: Session context including history, files, etc.
            model: Model to use for planning
            
        Returns:
            Structured execution plan with steps, tools, and parameters
        """
        logger.info(f"Creating plan for query: {user_query[:100]}...")
        
        try:
            # Get session agent for LLM calls
            agent = self.context_aware_agent.get_session_agent(session_context, model)
            
            # Create planning prompt
            planning_prompt = f"""Create an execution plan for this request:

{user_query}

🚨 CRITICAL: You are a PLANNER - you CANNOT execute tools.
You can ONLY create plans that specify tool names and parameters.
The orchestrator will execute your plans.

IMPORTANT: 
- If this is a SIMPLE query (single question, quick lookup), provide a direct answer instead of a plan.
- If this is a COMPLEX task (multi-step, large datasets, multiple files), create a structured plan.

For COMPLEX tasks, respond with ONLY a JSON plan in this exact format:
{{
  "query": "original user query",
  "steps": [
    {{
      "tool": "tool_name",
      "parameters": {{"param1": "value1"}},
      "critical": true,
      "store_result": false
    }}
  ],
  "estimated_complexity": "medium",
  "requires_file_storage": false
}}

For SIMPLE queries, just provide a direct answer - no plan needed.

Remember: You cannot execute tools. You only create plans."""
            
            # Get LLM response
            response = agent(planning_prompt)
            
            # Extract response content
            if hasattr(response, 'message') and hasattr(response.message, 'content'):
                if isinstance(response.message.content, list):
                    response_text = "".join(str(block) for block in response.message.content)
                else:
                    response_text = str(response.message.content)
            else:
                response_text = str(response)
            
            # Try to parse as JSON plan
            plan = self._extract_plan_from_response(response_text)
            
            if plan:
                logger.info(f"Created plan with {len(plan.get('steps', []))} steps")
                return plan
            else:
                # Response was a direct answer, not a plan
                logger.info("LLM provided direct answer instead of plan")
                return {
                    'query': user_query,
                    'direct_answer': response_text,
                    'requires_plan': False
                }
                
        except Exception as e:
            logger.error(f"Error creating plan: {str(e)}")
            # Return minimal plan on error
            return {
                'query': user_query,
                'steps': [],
                'error': str(e),
                'estimated_complexity': 'unknown',
                'requires_file_storage': False
            }
    
    def _extract_plan_from_response(self, response_text: str) -> Optional[Dict[str, Any]]:
        """
        Extract JSON plan from LLM response.
        Handles cases where response includes markdown code blocks or extra text.
        
        Args:
            response_text: LLM response text
            
        Returns:
            Parsed plan dictionary or None if not a plan
        """
        try:
            # Try to find JSON in code blocks
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
            if json_match:
                plan_json = json_match.group(1)
                return json.loads(plan_json)
            
            # Try to find JSON object directly
            json_match = re.search(r'\{.*"steps".*\}', response_text, re.DOTALL)
            if json_match:
                plan_json = json_match.group(0)
                return json.loads(plan_json)
            
            # Try parsing entire response as JSON
            return json.loads(response_text)
            
        except (json.JSONDecodeError, AttributeError):
            # Not a JSON plan - likely a direct answer
            return None

