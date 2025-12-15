"""
Tool Executor - Maps tool names to implementations and executes them
"""

import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class ToolExecutor:
    """Executes tools by name"""
    
    def __init__(self):
        """Initialize tool executor"""
        self.tool_registry = {}
        self._register_tools()
        logger.info("ToolExecutor initialized")
    
    def _register_tools(self):
        """Register all available tools"""
        # Import tools from agent module
        from agent import (
            get_multiple_financial_data,
            get_financial_data,
            analyze_portfolio,
            calculate_stock_correlation
        )
        from tools.chart_generator import generate_chart_tool
        
        self.tool_registry = {
            'get_multiple_financial_data': get_multiple_financial_data,
            'get_financial_data': get_financial_data,
            'analyze_portfolio': analyze_portfolio,
            'calculate_stock_correlation': calculate_stock_correlation,
            'generate_chart': generate_chart_tool,
            'generate_chart_tool': generate_chart_tool,  # Alias for consistency
        }
    
    def execute_tool(self, tool_name: str, parameters: Dict[str, Any], session_id: str, user_id: str) -> Any:
        """
        Execute a tool by name.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Tool parameters
            session_id: Session ID
            user_id: User ID
            
        Returns:
            Tool result
        """
        if tool_name not in self.tool_registry:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        tool_func = self.tool_registry[tool_name]
        
        # Set environment variables for tools
        import os
        os.environ['USER_ID'] = user_id
        os.environ['SESSION_ID'] = session_id
        
        logger.info(f"Executing tool: {tool_name} with parameters: {list(parameters.keys())}")
        
        # Execute tool
        result = tool_func(**parameters)
        
        return result
