"""
Status Reporter - Sends tool call summaries to WebSocket
Maintains existing status functionality for frontend
"""

import logging
import time
import uuid
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class StatusReporter:
    """
    Reports tool execution status to WebSocket for frontend display.
    Uses the same format as AgentLogger to maintain compatibility.
    """
    
    def __init__(self, websocket_handler=None):
        """
        Initialize status reporter.
        
        Args:
            websocket_handler: WebSocketHandler instance for sending messages (optional)
        """
        self.ws_handler = websocket_handler
        self.start_time = time.time()
        logger.info("StatusReporter initialized")
    
    def report_tool_starting(self, tool_name: str, parameters: Dict[str, Any], 
                            session_id: str, user_id: str, message_id: str,
                            step_num: int, total_steps: int):
        """
        Report that a tool is starting execution.
        
        Args:
            tool_name: Name of the tool
            parameters: Tool parameters
            session_id: Session ID
            user_id: User ID
            message_id: Message ID
            step_num: Current step number
            total_steps: Total number of steps
        """
        # Create short summary of parameters
        param_summary = self._format_params_summary(tool_name, parameters)
        
        message = f"Calling {tool_name}... {param_summary} (Step {step_num}/{total_steps})"
        
        self._send_status(message, 'INFO', session_id, user_id, message_id)
    
    def report_tool_completed(self, tool_name: str, result_summary: str,
                             session_id: str, user_id: str, message_id: str,
                             step_num: int, total_steps: int):
        """
        Report that a tool completed successfully.
        
        Args:
            tool_name: Name of the tool
            result_summary: Short summary of result
            session_id: Session ID
            user_id: User ID
            message_id: Message ID
            step_num: Current step number
            total_steps: Total number of steps
        """
        message = f"✅ {tool_name} completed" + (f": {result_summary}" if result_summary else "") + f" (Step {step_num}/{total_steps})"
        
        self._send_status(message, 'INFO', session_id, user_id, message_id)
    
    def report_tool_failed(self, tool_name: str, error_message: str,
                          session_id: str, user_id: str, message_id: str,
                          step_num: int, total_steps: int):
        """
        Report that a tool failed.
        
        Args:
            tool_name: Name of the tool
            error_message: Error message
            session_id: Session ID
            user_id: User ID
            message_id: Message ID
            step_num: Current step number
            total_steps: Total number of steps
        """
        message = f"❌ {tool_name} failed: {error_message[:100]}" + (f" (Step {step_num}/{total_steps})" if step_num else "")
        
        self._send_status(message, 'ERROR', session_id, user_id, message_id)
    
    def _format_params_summary(self, tool_name: str, parameters: Dict[str, Any]) -> str:
        """
        Create short summary of tool parameters for status display.
        
        Args:
            tool_name: Name of the tool
            parameters: Tool parameters
            
        Returns:
            Short parameter summary string
        """
        if not parameters:
            return ""
        
        # Tool-specific formatting for better readability
        if tool_name == 'get_multiple_financial_data':
            symbols = parameters.get('symbols', '')
            timeframe = parameters.get('timeframe', '1y')
            return f"symbols={symbols[:50]}, timeframe={timeframe}"
        
        elif tool_name == 'get_financial_data':
            symbol = parameters.get('symbol', '')
            timeframe = parameters.get('timeframe', '1y')
            return f"symbol={symbol}, timeframe={timeframe}"
        
        elif tool_name == 'python_financial_calculator':
            calc = parameters.get('calculation', '')
            if len(calc) > 100:
                return f"calculation={calc[:100]}..."
            return f"calculation={calc}"
        
        elif tool_name == 'generate_chart_tool':
            symbol = parameters.get('symbol', '')
            chart_type = parameters.get('chart_type', 'line')
            return f"symbol={symbol}, type={chart_type}"
        
        elif tool_name == 'generate_agent_file_tool':
            filename = parameters.get('filename', '')
            return f"filename={filename}"
        
        elif tool_name == 'get_session_context_tool':
            return "retrieving session context"
        
        elif tool_name == 'get_session_files_tool':
            file_type = parameters.get('file_type', 'all')
            return f"file_type={file_type}"
        
        # Generic fallback - show first 3 parameters
        param_items = list(parameters.items())[:3]
        return ", ".join([f"{k}={str(v)[:30]}" for k, v in param_items])
    
    def _send_status(self, message: str, level: str, session_id: str, user_id: str, message_id: str):
        """
        Send status message to WebSocket using same format as AgentLogger.
        
        Args:
            message: Status message
            level: Log level (INFO, ERROR, etc.)
            session_id: Session ID
            user_id: User ID
            message_id: Message ID
        """
        if not self.ws_handler:
            logger.debug(f"WebSocket handler not available, skipping status: {message}")
            return
        
        try:
            # Create log message in same format as AgentLogger
            log_message = {
                'type': 'agent_log',
                'session_id': session_id,
                'user_id': user_id,
                'payload': {
                    'message': message,
                    'level': level,
                    'log_id': f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}",
                    'log_timestamp': time.time(),
                    'relative_time': time.time() - self.start_time,
                    'source': 'orchestrator',
                    'log_type': 'agent_tool_call',
                    'message_id': message_id,
                    'version': '1.0'
                }
            }
            
            # Send via WebSocket
            self.ws_handler.send_agent_log(user_id, session_id, log_message)
            
        except Exception as e:
            logger.warning(f"Failed to send status to WebSocket: {str(e)}")

