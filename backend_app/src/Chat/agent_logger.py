"""
Agent Logger - Handles both CloudWatch logging and WebSocket streaming for tool calls.

This class processes all logs from the agent and:
1. Sends logs to CloudWatch (standard logging)
2. Streams tool call logs immediately to WebSocket via SQS for real-time user visibility
3. Filters logs to only send tool-related logs (no batching - immediate delivery)
"""

import logging
import time
import threading
import uuid
import json
from typing import List, Dict, Any, Optional
import os

# Try to import lambda_invocation for WebSocket streaming (fallback)
try:
    from lambda_invocation import invoke_websocket_processor
    LAMBDA_INVOCATION_AVAILABLE = True
except ImportError:
    LAMBDA_INVOCATION_AVAILABLE = False

# Try to import boto3 for SQS (preferred method for high-volume logs)
try:
    import boto3
    SQS_AVAILABLE = True
except ImportError:
    SQS_AVAILABLE = False


class AgentLogger(logging.Handler):
    """
    Unified logging handler for agent that processes logs for both CloudWatch and WebSocket.
    
    Sends all logs immediately to SQS for WebSocket streaming.
    - Immediate delivery (no batching)
    - No filtering - all logs sent to both CloudWatch and SQS
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
        
        # Add this handler to intercept logs from 'agent' logger
        # Also attach to root logger to catch logs from Strands framework (which may use different logger names)
        root_logger = logging.getLogger()
        if self not in root_logger.handlers:
            root_logger.addHandler(self)
        
        # Also attach to 'agent' logger specifically
        if self not in self.logger.handlers:
            self.logger.addHandler(self)
        
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
        # Prefer SQS if available, fallback to Lambda invocation
        self.websocket_enabled = bool(session_id and user_id and (SQS_AVAILABLE or LAMBDA_INVOCATION_AVAILABLE))
        self.use_sqs = SQS_AVAILABLE  # Prefer SQS for high-volume logs
        self.sqs_queue_url = os.environ.get('AGENT_LOGS_SQS_QUEUE_URL') if self.use_sqs else None
        
        # Initialize SQS client if using SQS
        if self.use_sqs and self.sqs_queue_url:
            try:
                self.sqs_client = boto3.client('sqs')
            except Exception as e:
                self.logger.warning(f"Failed to initialize SQS client: {e}, falling back to Lambda invocation")
                self.use_sqs = False
                self.sqs_client = None
        else:
            self.sqs_client = None
    
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
                cls._instance.websocket_enabled = bool(session_id and user_id and (SQS_AVAILABLE or LAMBDA_INVOCATION_AVAILABLE))
                cls._instance.start_time = time.time()
            return cls._instance
    
    
    def _send_log_to_websocket(self, log_entry: Dict[str, Any]):
        """Send single log entry immediately to WebSocket processor via SQS"""
        if not self.websocket_enabled:
            return
        
        try:
            # Construct unique payload with all necessary markers
            unique_payload = {
                # Session/User Identification (CRITICAL for differentiation)
                'session_id': self.session_id,
                'user_id': self.user_id,
                'message_id': self.message_id,
                
                # Single Log Entry (no batching)
                'log_id': log_entry.get('log_id', f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}"),
                'log_timestamp': log_entry.get('timestamp', time.time()),
                'relative_time': log_entry.get('relative_time', time.time() - self.start_time),
                
                # Log Content
                'level': log_entry.get('level', 'INFO'),
                'message': log_entry.get('message', ''),
                
                # Processing Context
                'source': 'agent_lambda',
                'log_type': 'agent_tool_call',
                'version': '1.0'
            }
            
            # Send via SQS (preferred) or Lambda invocation (fallback)
            if self.use_sqs and self.sqs_client and self.sqs_queue_url:
                # Send to SQS queue immediately (no batching)
                try:
                    sqs_message = {
                        'type': 'agent_log',  # Marker to ensure processor routes to handle_sqs_agent_logs
                        'session_id': self.session_id,
                        'user_id': self.user_id,
                        'payload': unique_payload
                    }

                    response = self.sqs_client.send_message(
                        QueueUrl=self.sqs_queue_url,
                        MessageBody=json.dumps(sqs_message),
                        MessageAttributes={
                            'session_id': {'StringValue': self.session_id, 'DataType': 'String'},
                            'user_id': {'StringValue': self.user_id, 'DataType': 'String'},
                            'message_type': {'StringValue': 'agent_log', 'DataType': 'String'}
                        }
                    )
                    
                    # Log successful send
                    self.logger.info(f"✅ Sent tool call log to SQS: {response['MessageId']} (session: {self.session_id})")
                    return
                    
                except Exception as sqs_error:
                    # If SQS fails, fallback to Lambda invocation
                    self.logger.warning(f"SQS send failed: {sqs_error}, falling back to Lambda invocation")
                    if LAMBDA_INVOCATION_AVAILABLE:
                        invoke_websocket_processor(
                            user_id=self.user_id,
                            session_id=self.session_id,
                            message_type='agent_log',
                            payload=unique_payload
                        )
            elif LAMBDA_INVOCATION_AVAILABLE:
                # Fallback to direct Lambda invocation
                invoke_websocket_processor(
                    user_id=self.user_id,
                    session_id=self.session_id,
                    message_type='agent_log',
                    payload=unique_payload
                )
            else:
                self.logger.warning("Neither SQS nor Lambda invocation available for log streaming")
            
        except Exception as e:
            # Log error but don't break agent
            # Errors here are non-critical - logs still go to CloudWatch
            self.logger.warning(f"Failed to send log to WebSocket: {str(e)}")
    
    def emit(self, record: logging.LogRecord):
        """
        Override logging.Handler.emit to intercept all logs.
        This is called automatically by Python's logging system for every log message.
        
        Args:
            record: LogRecord from Python's logging system
        """
        try:
            # Get log message and level
            message = record.getMessage()
            level = record.levelname
            
            # Send to WebSocket if enabled (no filtering - send all logs)
            if self.websocket_enabled:
                # Create structured log entry
                current_time = time.time()
                log_entry = {
                    'log_id': f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}",
                    'level': level,
                    'message': message,
                    'timestamp': current_time,
                    'relative_time': current_time - self.start_time
                }
                
                # Send immediately to SQS (no filtering)
                self._send_log_to_websocket(log_entry)
        except Exception as e:
            # Don't break logging if WebSocket send fails
            self.handleError(record)
    
    def _send_to_websocket(self, level: str, message: str, **kwargs):
        """
        Send log immediately to WebSocket processor via SQS (no batching, no filtering).
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
        
        # Send immediately to SQS (no filtering)
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
        self.websocket_enabled = bool(session_id and user_id and (SQS_AVAILABLE or LAMBDA_INVOCATION_AVAILABLE))
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

