"""
Planner - Creates execution plans for deterministic tasks
"""

import json
import logging
import re
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class Planner:
    """
    Creates execution plans for deterministic tasks.
    Uses LLM to understand user intent and create structured plans.
    """
    
    def __init__(self, agent):
        """
        Initialize the planner.
        
        Args:
            agent: Agent instance for LLM calls
        """
        self.agent = agent
        logger.info("Planner initialized")
    
    def create_plan(self, user_query: str, session_context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Create an execution plan for a user query.
        
        Args:
            user_query: The user's query/request
            session_context: Optional session context
            
        Returns:
            Structured execution plan with steps
        """
        logger.info(f"Creating plan for query: {user_query[:100]}...")
        
        try:
            # Create planning prompt - quick decision maker, not a full response
            planning_prompt = f"""You are a planning system that quickly determines if a query needs deterministic data processing.

USER QUERY: {user_query}

DETERMINISTIC TASKS (needs planning):
- Fetching stock data for multiple symbols (3+ symbols)
- Generating charts from data
- Calculating portfolio metrics with multiple stocks
- Processing large datasets
- Batch operations on multiple stocks

NON-DETERMINISTIC TASKS (no planning needed):
- Single stock lookups
- User questions and explanations
- Report/document generation (HTML, PDF, etc.)
- General conversation
- Simple file creation

QUICK DECISION:
- If query needs deterministic batch processing → return {{"needs_planning": true, "steps": [...]}}
- If query is simple or non-deterministic → return {{"needs_planning": false}}

Return ONLY JSON, no explanation text."""

            # Get LLM response
            response = self.agent(planning_prompt)
            
            # Extract response content
            if hasattr(response, 'message') and hasattr(response.message, 'content'):
                if isinstance(response.message.content, list):
                    response_text = "".join(str(block) for block in response.message.content)
                else:
                    response_text = str(response.message.content)
            else:
                response_text = str(response)
            
            # Parse plan from response
            plan = self._extract_plan_from_response(response_text)
            
            if plan and plan.get('needs_planning') and plan.get('steps'):
                logger.info(f"Created plan with {len(plan.get('steps', []))} steps")
                return plan
            else:
                # Return None to indicate agent should handle directly
                # This prevents the agent from seeing {"needs_planning": false} in context
                logger.info("Query does not need planning - agent will handle directly")
                return None
                
        except Exception as e:
            logger.error(f"Error creating plan: {str(e)}")
            return {"needs_planning": False, "error": str(e)}
    
    def _extract_plan_from_response(self, response_text: str) -> Optional[Dict[str, Any]]:
        """Extract JSON plan from LLM response"""
        try:
            # Try to find JSON in code blocks
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
            if json_match:
                plan_json = json_match.group(1)
                parsed = json.loads(plan_json)
                # If it's just {"needs_planning": false}, return None to let agent handle
                if parsed.get('needs_planning') is False and not parsed.get('steps'):
                    return None
                return parsed
            
            # Try to find JSON object directly
            json_match = re.search(r'\{.*"(?:needs_planning|steps)".*\}', response_text, re.DOTALL)
            if json_match:
                plan_json = json_match.group(0)
                parsed = json.loads(plan_json)
                # If it's just {"needs_planning": false}, return None to let agent handle
                if parsed.get('needs_planning') is False and not parsed.get('steps'):
                    return None
                return parsed
            
            # Try parsing entire response as JSON
            parsed = json.loads(response_text)
            # If it's just {"needs_planning": false}, return None to let agent handle
            if parsed.get('needs_planning') is False and not parsed.get('steps'):
                return None
            return parsed
            
        except (json.JSONDecodeError, AttributeError):
            logger.warning("Could not parse plan from response")
            return None
