"""
Agent Logger - Handles both CloudWatch logging and WebSocket streaming for AI thoughts.

This class processes all logs from the agent and:
1. Sends logs to CloudWatch (standard logging)
2. Streams relevant logs to WebSocket for real-time user visibility
3. Handles high-volume logging with batching and rate limiting
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


class AgentLogger:
    """
    Unified logging handler for agent that processes logs for both CloudWatch and WebSocket.
    
    Handles high-volume logging with:
    - Aggressive batching (time-based and size-based)
    - Log filtering to reduce noise
    - Session/user isolation
    - Rate limiting to prevent overwhelming websocket
    """
    
    # Class-level variables for singleton pattern
    _instance: Optional['AgentLogger'] = None
    _lock = threading.Lock()
    
    def __init__(self, session_id: Optional[str] = None, user_id: Optional[str] = None, message_id: Optional[str] = None):
        """
        Initialize AgentLogger.
        
        Args:
            session_id: Session ID for WebSocket streaming (optional)
            user_id: User ID for WebSocket streaming (optional)
            message_id: Message ID to link logs to specific user message (optional)
        """
        # Standard Python logger for CloudWatch
        self.logger = logging.getLogger('agent')
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
        
        # WebSocket streaming configuration
        self.session_id = session_id
        self.user_id = user_id
        self.message_id = message_id or (f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}" if session_id else None)
        
        # WebSocket log buffer and batching
        self.log_buffer: List[Dict[str, Any]] = []
        self.last_send_time = 0
        self.batch_interval = 0.3  # Send batch every 300ms
        self.max_buffer_size = 20  # Max logs per batch
        self.max_logs_per_second = 50  # Rate limit: max 50 logs/second
        self.log_count_window: List[float] = []  # Track logs in time window for rate limiting
        self.buffer_lock = threading.Lock()  # Thread-safe batching
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
    
    def _should_skip_for_websocket(self, message: str, level: str) -> bool:
        """
        Check if log should be skipped for WebSocket streaming.
        Only send tool-related logs to WebSocket for better UX.
        
        Args:
            message: Log message
            level: Log level
            
        Returns:
            True if should skip, False otherwise
        """
        # Only send tool-related logs to WebSocket
        import re
        
        # Check if this is a tool call log
        # These patterns match Strands agent tool call logs
        tool_patterns = [
            r'Tool\s*#\d+:',           # "Tool #1:", "Tool #2:", etc. (Strands format)
            r'Tool\s*#\d+\s*:',        # "Tool #1 :" (with spaces)
            r'Tool\s*#\d+\s*[:\-]',    # "Tool #1:", "Tool #1 -", etc.
            r'get_\w+_tool',           # Tool function names like "get_chat_history_tool"
            r'generate_\w+_tool',      # "generate_chart_tool"
            r'read_\w+_tool',          # "read_pdf_tool"
            r'analyze_\w+_tool',       # "analyze_pdf_content_tool"
            r'search_\w+_tool',       # "search_chat_history_tool"
            r'process_\w+_tool',      # "process_chat_session_context_tool"
            r'compare_\w+_tool',       # "compare_crypto_tool"
            r'calculate_\w+_tool',     # Tool functions
            r'get_\w+_data',           # "get_financial_data"
            r'get_\w+_filing',         # "get_filing_document"
        ]
        
        is_tool_related = any(re.search(pattern, message, re.IGNORECASE) for pattern in tool_patterns)
        
        # Skip everything except tool-related logs
        if not is_tool_related:
            return True
        
        # Skip DEBUG level logs (even for tools)
        if level == 'DEBUG':
            return True
        
        # Skip noisy patterns
        for pattern in self.skip_patterns:
            if re.search(pattern, message, re.IGNORECASE):
                return True
        
        return False
    
    def _send_batch_to_websocket(self):
        """Send buffered logs to WebSocket processor with unique payload structure"""
        if not self.log_buffer or not self.websocket_enabled:
            return
        
        # Extract batch (thread-safe)
        with self.buffer_lock:
            if not self.log_buffer:
                return
            batch = self.log_buffer.copy()
            self.log_buffer.clear()
            self.last_send_time = time.time()
        
        try:
            # Construct unique payload with all necessary markers
            unique_payload = {
                # Session/User Identification (CRITICAL for differentiation)
                'session_id': self.session_id,
                'user_id': self.user_id,
                'message_id': self.message_id,
                
                # Log Batch Metadata
                'log_batch_id': f"batch_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}",
                'batch_timestamp': time.time(),
                'batch_size': len(batch),
                'batch_index': 0,
                
                # Log Entries
                'logs': batch,
                
                # Processing Context
                'source': 'agent_lambda',
                'log_type': 'agent_thoughts',
                'version': '1.0'
            }
            
            # Send via SQS (preferred) or Lambda invocation (fallback)
            if self.use_sqs and self.sqs_client and self.sqs_queue_url:
                # Send to SQS queue for better handling of high-volume logs
                # Use same structure as chat responses for consistent routing
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
                    
                    # Successfully sent to SQS
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
            self.logger.warning(f"Failed to send logs to WebSocket: {str(e)}")
    
    def _add_to_websocket_buffer(self, level: str, message: str, **kwargs):
        """
        Add log to WebSocket buffer with rate limiting and batching.
        
        Args:
            level: Log level
            message: Log message
            **kwargs: Additional log metadata
        """
        if not self.websocket_enabled:
            return
        
        # Check if should skip
        if self._should_skip_for_websocket(message, level):
            return
        
        # Rate limiting: check if we're exceeding logs per second
        current_time = time.time()
        with self.buffer_lock:
            # Clean old entries from window (older than 1 second)
            self.log_count_window = [
                ts for ts in self.log_count_window 
                if current_time - ts < 1.0
            ]
            
            # Check rate limit
            if len(self.log_count_window) >= self.max_logs_per_second:
                # Drop this log to prevent overwhelming
                return
            
            # Add to rate limit window
            self.log_count_window.append(current_time)
        
        # Create structured log entry
        log_entry = {
            'log_id': f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}",
            'level': level,
            'message': message,
            'timestamp': time.time(),
            'relative_time': current_time - self.start_time,
            **kwargs
        }
        
        # Add to buffer (thread-safe)
        with self.buffer_lock:
            self.log_buffer.append(log_entry)
        
        # Send batch if buffer is full or time elapsed
        current_time = time.time()
        should_send = False
        
        with self.buffer_lock:
            buffer_full = len(self.log_buffer) >= self.max_buffer_size
            time_elapsed = current_time - self.last_send_time >= self.batch_interval
            should_send = buffer_full or time_elapsed
        
        if should_send:
            self._send_batch_to_websocket()
    
    def info(self, message: str, **kwargs):
        """Log info message to both CloudWatch and WebSocket"""
        self.logger.info(message)
        self._add_to_websocket_buffer('INFO', message, **kwargs)
    
    def debug(self, message: str, **kwargs):
        """Log debug message to CloudWatch only (not streamed to WebSocket)"""
        self.logger.debug(message)
        # Debug logs are not sent to WebSocket
    
    def warning(self, message: str, **kwargs):
        """Log warning message to both CloudWatch and WebSocket"""
        self.logger.warning(message)
        self._add_to_websocket_buffer('WARNING', message, **kwargs)
    
    def error(self, message: str, **kwargs):
        """Log error message to both CloudWatch and WebSocket"""
        self.logger.error(message)
        self._add_to_websocket_buffer('ERROR', message, **kwargs)
    
    def critical(self, message: str, **kwargs):
        """Log critical message to both CloudWatch and WebSocket"""
        self.logger.critical(message)
        self._add_to_websocket_buffer('CRITICAL', message, **kwargs)
    
    def flush(self):
        """Flush remaining logs to WebSocket before agent completes"""
        if self.websocket_enabled:
            with self.buffer_lock:
                if self.log_buffer:
                    self._send_batch_to_websocket()
    
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
        # Clear buffer when session changes
        with self.buffer_lock:
            self.log_buffer.clear()
            self.log_count_window.clear()


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

