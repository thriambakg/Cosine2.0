"""
Tool Executor - Executes individual tools from plans
"""

import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class ToolExecutor:
    """
    Executes individual tools from execution plans.
    Imports and calls tools from the tools/ directory.
    """
    
    def __init__(self):
        """Initialize the tool executor."""
        self._tool_cache = {}
        logger.info("ToolExecutor initialized")
    
    def execute_tool(self, tool_name: str, parameters: Dict[str, Any], session_id: str, user_id: str) -> Any:
        """
        Execute a tool with given parameters.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Tool parameters
            session_id: Session ID (for tools that need it)
            user_id: User ID (for tools that need it)
            
        Returns:
            Tool execution result
        """
        logger.info(f"Executing tool: {tool_name} with parameters: {list(parameters.keys())}")
        
        try:
            # Get tool function
            tool_func = self._get_tool_function(tool_name)
            
            # Use introspection to check which parameters the tool accepts
            import inspect
            sig = inspect.signature(tool_func)
            accepted_params = set(sig.parameters.keys())
            
            # Filter parameters to only include those the tool accepts
            filtered_params = {k: v for k, v in parameters.items() if k in accepted_params}
            
            # Add session_id and user_id only if the tool accepts them
            if 'session_id' in accepted_params and 'session_id' not in filtered_params:
                filtered_params['session_id'] = session_id
            if 'user_id' in accepted_params and 'user_id' not in filtered_params:
                filtered_params['user_id'] = user_id
            
            # Execute tool with filtered parameters
            result = tool_func(**filtered_params)
            
            logger.info(f"Tool {tool_name} executed successfully")
            return result
            
        except Exception as e:
            logger.error(f"Error executing tool {tool_name}: {str(e)}")
            raise
    
    def _get_tool_function(self, tool_name: str):
        """
        Get tool function by name.
        Uses caching to avoid repeated imports.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            Tool function
        """
        if tool_name in self._tool_cache:
            return self._tool_cache[tool_name]
        
        # Import tool based on name
        # Financial data tools
        if tool_name == 'get_financial_data':
            from planner.agent import get_financial_data
            self._tool_cache[tool_name] = get_financial_data
            return get_financial_data
        
        elif tool_name == 'get_multiple_financial_data':
            from planner.agent import get_multiple_financial_data
            self._tool_cache[tool_name] = get_multiple_financial_data
            return get_multiple_financial_data
        
        # Crypto tools
        elif tool_name == 'get_crypto_data_tool':
            from tools.crypto_data_fetcher import get_crypto_data_tool
            self._tool_cache[tool_name] = get_crypto_data_tool
            return get_crypto_data_tool
        
        elif tool_name == 'compare_crypto_tool':
            from tools.crypto_data_fetcher import compare_crypto_tool
            self._tool_cache[tool_name] = compare_crypto_tool
            return compare_crypto_tool
        
        # Python calculator
        elif tool_name == 'python_financial_calculator':
            from tools.financial_calculator import python_financial_calculator
            from strands.types.tools import ToolUse
            # Wrap to handle ToolUse format - the actual function expects a ToolUse object
            def wrapped_calculator(calculation: str):
                # Create a proper ToolUse object structure
                # ToolUse from strands.types.tools expects a dict-like structure
                import uuid
                tool_use_dict = {
                    'toolUseId': str(uuid.uuid4()),
                    'toolName': 'python_financial_calculator',
                    'input': {'calculation': calculation}
                }
                # ToolUse can be constructed from a dict
                try:
                    tool_use = ToolUse(tool_use_dict)
                except Exception as e:
                    # If ToolUse construction fails, try passing dict directly
                    logger.warning(f"ToolUse construction failed, using dict directly: {str(e)}")
                    tool_use = tool_use_dict
                
                result = python_financial_calculator(tool_use)
                
                # Extract the output from ToolResult if needed
                if hasattr(result, 'output'):
                    return result.output
                elif hasattr(result, 'content'):
                    return result.content
                elif isinstance(result, dict):
                    return result.get('output', result.get('content', result))
                return result
            self._tool_cache[tool_name] = wrapped_calculator
            return wrapped_calculator
        
        # Portfolio analysis tool
        elif tool_name == 'analyze_portfolio_performance':
            from tools.portfolio_analysis_tool import analyze_portfolio_performance
            from strands.types.tools import ToolUse
            def wrapped_portfolio(data_source: str, portfolio_holdings: str, benchmark_symbol: str = "^GSPC", risk_free_rate: float = 0.02):
                import uuid
                tool_use_dict = {
                    'toolUseId': str(uuid.uuid4()),
                    'toolName': 'analyze_portfolio_performance',
                    'input': {
                        'data_source': data_source,
                        'portfolio_holdings': portfolio_holdings,
                        'benchmark_symbol': benchmark_symbol,
                        'risk_free_rate': risk_free_rate
                    }
                }
                try:
                    tool_use = ToolUse(tool_use_dict)
                except Exception as e:
                    logger.warning(f"ToolUse construction failed, using dict directly: {str(e)}")
                    tool_use = tool_use_dict
                
                result = analyze_portfolio_performance(tool_use)
                
                if hasattr(result, 'output'):
                    return result.output
                elif hasattr(result, 'content'):
                    # Extract text from content array
                    if isinstance(result.content, list) and len(result.content) > 0:
                        return result.content[0].get('text', result.content[0])
                    return result.content
                elif isinstance(result, dict):
                    content = result.get('content', result.get('output', result))
                    if isinstance(content, list) and len(content) > 0:
                        return content[0].get('text', content[0])
                    return content
                return result
            self._tool_cache[tool_name] = wrapped_portfolio
            return wrapped_portfolio
        
        # Chart tools
        elif tool_name == 'generate_chart_tool':
            from tools.chart_generator import generate_chart_tool
            from strands.types.tools import ToolUse
            # Wrap to handle ToolUse format
            def wrapped_chart(symbol: str, data_json: Any, chart_type: str = 'line', title: str = None):
                tool_use = {'input': {
                    'symbol': symbol,
                    'data_json': data_json,
                    'chart_type': chart_type,
                    'title': title
                }}
                return generate_chart_tool(ToolUse(tool_use))
            self._tool_cache[tool_name] = wrapped_chart
            return wrapped_chart
        
        elif tool_name == 'generate_stock_chart':
            from tools.chart_generator import generate_stock_chart
            self._tool_cache[tool_name] = generate_stock_chart
            return generate_stock_chart
        
        # File tools
        elif tool_name == 'generate_agent_file_tool':
            from planner.agent import generate_agent_file_tool
            self._tool_cache[tool_name] = generate_agent_file_tool
            return generate_agent_file_tool
        
        elif tool_name == 'generate_excel_file_tool':
            from planner.agent import generate_excel_file_tool
            self._tool_cache[tool_name] = generate_excel_file_tool
            return generate_excel_file_tool
        
        # Session tools
        elif tool_name == 'get_session_context_tool':
            from tools.session_database_access import get_session_context_tool
            self._tool_cache[tool_name] = get_session_context_tool
            return get_session_context_tool
        
        elif tool_name == 'get_session_files_tool':
            from tools.session_database_access import get_session_files_tool
            self._tool_cache[tool_name] = get_session_files_tool
            return get_session_files_tool
        
        elif tool_name == 'read_s3_file_tool':
            from tools.s3_file_reader import read_s3_file_tool
            self._tool_cache[tool_name] = read_s3_file_tool
            return read_s3_file_tool
        
        # Chat history tools
        elif tool_name == 'get_chat_history_tool':
            from tools.chat_history_tool import get_chat_history_tool
            self._tool_cache[tool_name] = get_chat_history_tool
            return get_chat_history_tool
        
        elif tool_name == 'search_chat_history_tool':
            from tools.chat_history_tool import search_chat_history_tool
            self._tool_cache[tool_name] = search_chat_history_tool
            return search_chat_history_tool
        
        # PDF tools
        elif tool_name == 'read_pdf_tool':
            from tools.pdf_reader import read_pdf_tool
            from strands.types.tools import ToolUse
            def wrapped_pdf(s3_key: str):
                tool_use = {'input': {'s3_key': s3_key}}
                return read_pdf_tool(ToolUse(tool_use))
            self._tool_cache[tool_name] = wrapped_pdf
            return wrapped_pdf
        
        elif tool_name == 'analyze_pdf_content_tool':
            from tools.pdf_reader import analyze_pdf_content_tool
            from strands.types.tools import ToolUse
            def wrapped_analyze(s3_key: str):
                tool_use = {'input': {'s3_key': s3_key}}
                return analyze_pdf_content_tool(ToolUse(tool_use))
            self._tool_cache[tool_name] = wrapped_analyze
            return wrapped_analyze
        
        # SEC tools
        elif tool_name == 'get_company_cik':
            from tools.sec_edgar_api import get_company_cik
            self._tool_cache[tool_name] = get_company_cik
            return get_company_cik
        
        elif tool_name == 'get_company_filings':
            from tools.sec_edgar_api import get_company_filings
            self._tool_cache[tool_name] = get_company_filings
            return get_company_filings
        
        elif tool_name == 'get_filing_document':
            from tools.sec_edgar_api import get_filing_document
            self._tool_cache[tool_name] = get_filing_document
            return get_filing_document
        
        elif tool_name == 'search_sec_filings':
            from tools.sec_edgar_api import search_sec_filings
            self._tool_cache[tool_name] = search_sec_filings
            return search_sec_filings
        
        # Web scraper
        elif tool_name == 'fetch_web_content_tool':
            from tools.web_scraper import fetch_web_content_tool
            self._tool_cache[tool_name] = fetch_web_content_tool
            return fetch_web_content_tool
        
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

