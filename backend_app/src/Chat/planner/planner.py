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
            # Create planning prompt
            planning_prompt = f"""You are a planning system that creates execution plans for deterministic financial data tasks.

USER QUERY: {user_query}

Your job is to create a JSON execution plan for deterministic tasks like:
- Fetching stock data for multiple symbols
- Generating charts
- Calculating portfolio metrics
- Processing large datasets

DETERMINISTIC TASKS (use orchestrator):
- get_multiple_financial_data: Fetch data for multiple stocks
- generate_chart: Generate charts from data
- analyze_portfolio_performance: Calculate portfolio metrics
- calculate_correlations: Calculate stock correlations

NON-DETERMINISTIC TASKS (agent handles directly):
- User questions and explanations
- Report generation
- Document creation
- General conversation

If the query requires deterministic data processing, create a plan.
If it's a simple question or report generation, return {{"needs_planning": false}}.

PLAN FORMAT:
{{
  "needs_planning": true,
  "steps": [
    {{
      "tool": "tool_name",
      "parameters": {{"param1": "value1"}},
      "store_result": true/false
    }}
  ]
}}

Return ONLY JSON, no other text."""

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
            
            if plan:
                logger.info(f"Created plan with {len(plan.get('steps', []))} steps")
                return plan
            else:
                logger.info("Query does not need planning - agent will handle directly")
                return {"needs_planning": False}
                
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
                return json.loads(plan_json)
            
            # Try to find JSON object directly
            json_match = re.search(r'\{.*"steps".*\}', response_text, re.DOTALL)
            if json_match:
                plan_json = json_match.group(0)
                return json.loads(plan_json)
            
            # Try parsing entire response as JSON
            return json.loads(response_text)
            
        except (json.JSONDecodeError, AttributeError):
            logger.warning("Could not parse plan from response")
            return None
