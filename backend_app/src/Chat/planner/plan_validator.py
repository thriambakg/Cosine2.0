"""
Plan Validator - Validates execution plans before execution
"""

import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class PlanValidator:
    """
    Validates execution plans to ensure they're safe and correct.
    """
    
    # List of available tools (will be populated from tools directory)
    AVAILABLE_TOOLS = [
        'get_financial_data',
        'get_multiple_financial_data',
        'get_crypto_data_tool',
        'python_financial_calculator',
        'generate_chart_tool',
        'generate_stock_chart',
        'generate_agent_file_tool',
        'generate_excel_file_tool',
        'get_session_context_tool',
        'get_session_files_tool',
        'read_s3_file_tool',
        'get_chat_history_tool',
        'search_chat_history_tool',
        'fetch_web_content_tool',
        'read_pdf_tool',
        'analyze_pdf_content_tool',
        'get_company_cik',
        'get_company_filings',
        'get_filing_document',
        'search_sec_filings',
    ]
    
    def __init__(self):
        """Initialize the plan validator."""
        logger.info("PlanValidator initialized")
    
    def validate_plan(self, plan: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validate an execution plan.
        
        Args:
            plan: The execution plan to validate
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        if not isinstance(plan, dict):
            return False, "Plan must be a dictionary"
        
        if 'steps' not in plan:
            return False, "Plan must contain 'steps' field"
        
        if not isinstance(plan['steps'], list):
            return False, "Plan 'steps' must be a list"
        
        if len(plan['steps']) == 0:
            return False, "Plan must contain at least one step"
        
        # Validate each step
        for i, step in enumerate(plan['steps']):
            if not isinstance(step, dict):
                return False, f"Step {i+1} must be a dictionary"
            
            if 'tool' not in step:
                return False, f"Step {i+1} must contain 'tool' field"
            
            tool_name = step['tool']
            if tool_name not in self.AVAILABLE_TOOLS:
                return False, f"Step {i+1} uses unknown tool: {tool_name}"
            
            if 'parameters' not in step:
                return False, f"Step {i+1} must contain 'parameters' field"
            
            if not isinstance(step['parameters'], dict):
                return False, f"Step {i+1} 'parameters' must be a dictionary"
        
        return True, None

