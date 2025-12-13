"""
Agent Logger - Handles both CloudWatch logging and WebSocket streaming for tool calls.

This class processes all logs from the agent and:
1. Sends logs to CloudWatch (standard logging)
2. Streams tool call logs immediately to WebSocket directly (no SQS queue needed!)
3. Filters logs to only send tool-related logs (no batching - immediate delivery)
"""

import logging
import time
import threading
import uuid
import json
from typing import List, Dict, Any, Optional
import os

# Try to import websocket_handler for direct WebSocket streaming
try:
    from websocket_handler import WebSocketHandler
    WEBSOCKET_HANDLER_AVAILABLE = True
except ImportError:
    WEBSOCKET_HANDLER_AVAILABLE = False
    WebSocketHandler = None


class AgentLogger(logging.Handler):
    """
    Unified logging handler for agent that processes logs for both CloudWatch and WebSocket.
    
    Sends all logs immediately to WebSocket directly (no SQS queue needed!).
    - Immediate delivery (no batching)
    - No filtering - all logs sent to both CloudWatch and WebSocket
    - Session/user isolation
    """
    
    # Class-level variables for singleton pattern
    _instance: Optional['AgentLogger'] = None
    _lock = threading.Lock()
    
    def __init__(self, session_id: Optional[str] = None, user_id: Optional[str] = None, message_id: Optional[str] = None):
        """
        Initialize AgentLogger as a logging Handler.
        
        Args:
            session_id: Session ID for WebSocket streaming (optional)
            user_id: User ID for WebSocket streaming (optional)
            message_id: Message ID to link logs to specific user message (optional)
        """
        # Initialize as logging.Handler
        super().__init__()
        self.setLevel(logging.INFO)
        
        # Standard Python logger for CloudWatch (also add StreamHandler for CloudWatch)
        self.logger = logging.getLogger('agent')
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
        
        # Internal logger for AgentLogger errors (doesn't go through AgentLogger handler to avoid loops)
        self._internal_logger = logging.getLogger('agent_logger_internal')
        if not self._internal_logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
            self._internal_logger.addHandler(handler)
            self._internal_logger.setLevel(logging.WARNING)
        
        # DO NOT attach as handler to root logger or any logger
        # Only logs explicitly sent via agent_logger.info/debug/warning/error/critical() will be sent to SQS
        # This prevents intercepting all application logs
        
        # WebSocket streaming configuration
        self.session_id = session_id
        self.user_id = user_id
        self.message_id = message_id or (f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}" if session_id else None)
        
        # WebSocket streaming - send immediately (no batching)
        self.start_time = time.time()
        
        # Filter patterns for noisy logs (skip these for WebSocket)
        self.skip_patterns = [
            'DEBUG:',
            'Import test',
            'Successfully imported',
            'Layer path',
            'OTEL',
            'OpenTelemetry',
            'Added .* to sys.path',
            'Successfully imported .* from layer',
            'Successfully imported .* after'
        ]
        
        # Enable WebSocket streaming only if session context is available
        # Use direct WebSocket handler (no SQS queue needed!)
        self.websocket_enabled = bool(session_id and user_id and WEBSOCKET_HANDLER_AVAILABLE)
        
        # Initialize WebSocket handler if available
        if self.websocket_enabled and WEBSOCKET_HANDLER_AVAILABLE:
            try:
                self.ws_handler = WebSocketHandler()
            except Exception as e:
                self._internal_logger.warning(f"Failed to initialize WebSocket handler: {e}")
                self.websocket_enabled = False
                self.ws_handler = None
        else:
            self.ws_handler = None
    
    @classmethod
    def get_instance(cls, session_id: Optional[str] = None, user_id: Optional[str] = None, message_id: Optional[str] = None) -> 'AgentLogger':
        """
        Get or create singleton instance of AgentLogger.
        
        Args:
            session_id: Session ID for WebSocket streaming
            user_id: User ID for WebSocket streaming
            message_id: Message ID to link logs
            
        Returns:
            AgentLogger instance
        """
        with cls._lock:
            if cls._instance is None or (session_id and cls._instance.session_id != session_id):
                cls._instance = cls(session_id, user_id, message_id)
            elif session_id and cls._instance.session_id != session_id:
                # Update existing instance with new session context
                cls._instance.session_id = session_id
                cls._instance.user_id = user_id
                cls._instance.message_id = message_id
                cls._instance.websocket_enabled = bool(session_id and user_id and WEBSOCKET_HANDLER_AVAILABLE)
                cls._instance.start_time = time.time()
                # Reinitialize WebSocket handler if needed
                if cls._instance.websocket_enabled and WEBSOCKET_HANDLER_AVAILABLE and not cls._instance.ws_handler:
                    try:
                        cls._instance.ws_handler = WebSocketHandler()
                    except Exception as e:
                        cls._instance._internal_logger.warning(f"Failed to reinitialize WebSocket handler: {e}")
                        cls._instance.websocket_enabled = False
            return cls._instance
    
    
    def _send_log_to_websocket(self, log_entry: Dict[str, Any]):
        """Send single log entry immediately to WebSocket directly (no SQS queue needed!)"""
        if not self.websocket_enabled or not self.ws_handler:
            return
        
        try:
            # Construct log message in format expected by frontend
            log_message = {
                'type': 'agent_log',
                'session_id': self.session_id,
                'user_id': self.user_id,
                'payload': {
                    'message': log_entry.get('message', ''),
                    'level': log_entry.get('level', 'INFO'),
                    'log_id': log_entry.get('log_id', f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}"),
                    'log_timestamp': log_entry.get('timestamp', time.time()),
                    'relative_time': log_entry.get('relative_time', time.time() - self.start_time),
                    'source': 'agent_lambda',
                    'log_type': 'agent_tool_call',
                    'message_id': self.message_id,
                    'version': '1.0'
                }
            }
            
            # Send directly to WebSocket (no SQS queue!)
            self.ws_handler.send_agent_log(self.user_id, self.session_id, log_message)
            
        except Exception as e:
            # Log error but don't break agent
            # Use internal logger to avoid infinite loop (don't send this error to WebSocket)
            # Errors here are non-critical - logs still go to CloudWatch
            self._internal_logger.warning(f"Failed to send log to WebSocket: {str(e)}")
    
    def emit(self, record: logging.LogRecord):
        """
        Override logging.Handler.emit (not used - we don't attach as handler).
        This method exists because AgentLogger extends logging.Handler, but we don't use it.
        Only logs explicitly sent via agent_logger.info/debug/warning/error/critical() go to WebSocket.
        
        Args:
            record: LogRecord from Python's logging system
        """
        # This method is not used - we don't attach AgentLogger as a handler
        # Only explicit calls to agent_logger methods send logs to WebSocket
        pass
    
    def _send_to_websocket(self, level: str, message: str, **kwargs):
        """
        Send log immediately to WebSocket directly (no SQS queue needed!).
        This is used when calling agent_logger.info() directly.
        
        Args:
            level: Log level
            message: Log message
            **kwargs: Additional log metadata
        """
        if not self.websocket_enabled:
            return
        
        # Create structured log entry (no filtering - send all logs)
        current_time = time.time()
        log_entry = {
            'log_id': f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}",
            'level': level,
            'message': message,
            'timestamp': current_time,
            'relative_time': current_time - self.start_time,
            **kwargs
        }
        
        # Send immediately to WebSocket (no filtering, no SQS!)
        self._send_log_to_websocket(log_entry)
    
    def info(self, message: str, **kwargs):
        """Log info message to both CloudWatch and WebSocket (immediate send)"""
        self.logger.info(message)
        self._send_to_websocket('INFO', message, **kwargs)
    
    def debug(self, message: str, **kwargs):
        """Log debug message to both CloudWatch and WebSocket (immediate send)"""
        self.logger.debug(message)
        self._send_to_websocket('DEBUG', message, **kwargs)
    
    def warning(self, message: str, **kwargs):
        """Log warning message to both CloudWatch and WebSocket (immediate send)"""
        self.logger.warning(message)
        self._send_to_websocket('WARNING', message, **kwargs)
    
    def error(self, message: str, **kwargs):
        """Log error message to both CloudWatch and WebSocket (immediate send)"""
        self.logger.error(message)
        self._send_to_websocket('ERROR', message, **kwargs)
    
    def critical(self, message: str, **kwargs):
        """Log critical message to both CloudWatch and WebSocket (immediate send)"""
        self.logger.critical(message)
        self._send_to_websocket('CRITICAL', message, **kwargs)
    
    def flush(self):
        """Flush remaining logs (no-op since we send immediately, no batching)"""
        # No batching, so nothing to flush - logs are sent immediately
        pass
    
    def set_session_context(self, session_id: str, user_id: str, message_id: Optional[str] = None):
        """
        Update session context for WebSocket streaming.
        
        Args:
            session_id: Session ID
            user_id: User ID
            message_id: Optional message ID
        """
        self.session_id = session_id
        self.user_id = user_id
        if message_id:
            self.message_id = message_id
        self.websocket_enabled = bool(session_id and user_id and WEBSOCKET_HANDLER_AVAILABLE)
        # Reinitialize WebSocket handler if needed
        if self.websocket_enabled and WEBSOCKET_HANDLER_AVAILABLE and not self.ws_handler:
            try:
                self.ws_handler = WebSocketHandler()
            except Exception as e:
                self._internal_logger.warning(f"Failed to initialize WebSocket handler: {e}")
                self.websocket_enabled = False
        self.start_time = time.time()


# Global instance getter function for easy access
def get_agent_logger(session_id: Optional[str] = None, user_id: Optional[str] = None, message_id: Optional[str] = None) -> AgentLogger:
    """
    Get AgentLogger instance (singleton pattern).
    
    Args:
        session_id: Session ID for WebSocket streaming
        user_id: User ID for WebSocket streaming
        message_id: Message ID to link logs
        
    Returns:
        AgentLogger instance
    """
    return AgentLogger.get_instance(session_id, user_id, message_id)

