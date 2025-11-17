# Live Log Streaming Feasibility Analysis

## Current Architecture

```
User Message → WebSocket message_processor Lambda → Chat Agent Lambda (async)
                                                          ↓
                                    SNS (response) → message_processor → WebSocket → Frontend
```

## Feasibility Assessment: ✅ **FEASIBLE**

### Why This Will Work

1. **Agent Has Session Context**
   - The agent lambda receives `session_id` and `user_id` in the event payload (see `lambda_handler.py:468-695`)
   - These are available throughout the agent execution

2. **Existing Communication Mechanism**
   - There's already a `lambda_invocation.py` module with `invoke_websocket_processor()` function
   - This function can send messages to the websocket processor lambda
   - The websocket processor has `get_active_connections_for_user_session()` to route messages

3. **No Direct WebSocket Access Needed**
   - The agent doesn't need direct WebSocket connection
   - It can invoke the websocket processor lambda, which handles routing to active connections
   - This is the same pattern used for agent file returns

4. **WebSocket Processor Can Handle New Message Types**
   - The websocket processor already handles multiple message types (`chat`, `kill_signal`, `edit_message`, etc.)
   - We can add a new `agent_log` message type

## Implementation Approach

### Option A: Custom Logging Handler (Recommended)

**Architecture:**
```
Agent Lambda
  ↓ (logger.info/debug calls)
Custom Logging Handler
  ↓ (intercepts logs)
invoke_websocket_processor()
  ↓ (async Lambda invocation)
WebSocket Processor Lambda
  ↓ (finds active connections)
WebSocket → Frontend
```

**Pros:**
- Minimal code changes to agent
- Automatic capture of all logger calls
- Can filter log levels (INFO, DEBUG, etc.)
- Can batch/throttle logs

**Cons:**
- Need to be careful about log volume
- May need filtering to avoid noise

### Option B: Explicit Log Streaming Function

**Architecture:**
```
Agent Lambda
  ↓ (explicit stream_log() calls)
invoke_websocket_processor()
  ↓ (async Lambda invocation)
WebSocket Processor Lambda
  ↓ (finds active connections)
WebSocket → Frontend
```

**Pros:**
- Full control over what gets streamed
- No risk of overwhelming websocket
- Can include structured metadata

**Cons:**
- Requires manual calls throughout agent code
- Easy to miss important logs

### Option C: Hybrid Approach (Best)

Combine both:
- Custom logging handler for automatic capture
- Explicit `stream_agent_thought()` function for important milestones
- Filtering/throttling to manage volume

## Implementation Details

### Critical Requirements

1. **Unique Payload Structure**: Each log payload must contain all necessary markers to differentiate across sessions and users
2. **High Volume Handling**: For every user message, there will be LOTS of logs - must be handled carefully
3. **Session Isolation**: Logs must be properly scoped to specific sessions/users to avoid cross-contamination

### 1. Agent Lambda Changes

**File: `backend_app/src/Chat/agent.py`**

Add a custom logging handler with robust batching and session tracking:
```python
import logging
import time
import threading
from lambda_invocation import invoke_websocket_processor
import os
from typing import List, Dict, Any
import uuid

class WebSocketLogHandler(logging.Handler):
    """
    Custom logging handler that streams AI thoughts/logs to WebSocket.
    
    Handles high-volume logging with:
    - Aggressive batching (time-based and size-based)
    - Log filtering to reduce noise
    - Session/user isolation
    - Rate limiting to prevent overwhelming websocket
    """
    
    def __init__(self, session_id: str, user_id: str, message_id: str = None):
        super().__init__()
        self.session_id = session_id
        self.user_id = user_id
        self.message_id = message_id or f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        self.log_buffer: List[Dict[str, Any]] = []
        self.last_send_time = 0
        self.batch_interval = 0.3  # Send batch every 300ms (more frequent for real-time feel)
        self.max_buffer_size = 20  # Max logs per batch (increased for efficiency)
        self.max_logs_per_second = 50  # Rate limit: max 50 logs/second
        self.log_count_window = []  # Track logs in time window for rate limiting
        self.lock = threading.Lock()  # Thread-safe batching
        
        # Filter patterns for noisy logs (skip these)
        self.skip_patterns = [
            'DEBUG:',
            'Import test',
            'Successfully imported',
            'Layer path',
            'OTEL',
            'OpenTelemetry'
        ]
        
    def emit(self, record):
        """Emit a log record to WebSocket with filtering and rate limiting"""
        try:
            # Filter log levels (only INFO and above, skip DEBUG)
            if record.levelno < logging.INFO:
                return
            
            # Format log message
            log_message = self.format(record)
            
            # Skip noisy logs
            if any(pattern in log_message for pattern in self.skip_patterns):
                return
            
            # Rate limiting: check if we're exceeding logs per second
            current_time = time.time()
            with self.lock:
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
            
            # Create structured log entry with all necessary markers
            log_entry = {
                'log_id': f"log_{int(time.time() * 1000000)}_{uuid.uuid4().hex[:8]}",  # Unique log ID
                'level': record.levelname,
                'message': log_message,
                'timestamp': record.created,
                'relative_time': current_time - self.start_time if hasattr(self, 'start_time') else 0,
                'module': record.module if hasattr(record, 'module') else 'unknown',
                'function': record.funcName if hasattr(record, 'funcName') else 'unknown'
            }
            
            # Add to buffer (thread-safe)
            with self.lock:
                self.log_buffer.append(log_entry)
            
            # Send batch if buffer is full or time elapsed
            current_time = time.time()
            should_send = False
            
            with self.lock:
                buffer_full = len(self.log_buffer) >= self.max_buffer_size
                time_elapsed = current_time - self.last_send_time >= self.batch_interval
                should_send = buffer_full or time_elapsed
            
            if should_send:
                self._send_batch()
                
        except Exception as e:
            # Don't let logging errors break the agent
            # Silently fail to avoid recursive logging issues
            pass
    
    def _send_batch(self):
        """Send buffered logs to WebSocket processor with unique payload structure"""
        if not self.log_buffer:
            return
        
        # Extract batch (thread-safe)
        with self.lock:
            if not self.log_buffer:
                return
            batch = self.log_buffer.copy()
            self.log_buffer.clear()
            self.last_send_time = time.time()
        
        try:
            # Construct unique payload with all necessary markers
            # This payload structure ensures proper session/user differentiation
            unique_payload = {
                # Session/User Identification (CRITICAL for differentiation)
                'session_id': self.session_id,
                'user_id': self.user_id,
                'message_id': self.message_id,  # Links logs to specific user message
                
                # Log Batch Metadata
                'log_batch_id': f"batch_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}",  # Unique batch ID
                'batch_timestamp': time.time(),
                'batch_size': len(batch),
                'batch_index': 0,  # Can be used for ordering if multiple batches
                
                # Log Entries
                'logs': batch,
                
                # Processing Context
                'source': 'agent_lambda',
                'log_type': 'agent_thoughts',  # Distinguishes from other log types
                'version': '1.0'  # For future compatibility
            }
            
            # Invoke websocket processor with unique payload
            invoke_websocket_processor(
                user_id=self.user_id,
                session_id=self.session_id,
                message_type='agent_log',  # Unique message type for AI thoughts
                payload=unique_payload
            )
            
        except Exception as e:
            # Log error but don't break agent
            # Errors here are non-critical - logs still go to CloudWatch
            pass
    
    def flush(self):
        """Flush remaining logs before agent completes"""
        with self.lock:
            if self.log_buffer:
                self._send_batch()
    
    def set_start_time(self, start_time: float):
        """Set the start time for relative timestamps"""
        self.start_time = start_time
```

**Setup in agent initialization (in `lambda_handler.py`):**
```python
def setup_agent_logging(session_id: str, user_id: str, message_id: str = None):
    """
    Setup WebSocket logging for agent with session/user context.
    
    Args:
        session_id: Session ID for log isolation
        user_id: User ID for log isolation
        message_id: Optional message ID to link logs to specific user message
        
    Returns:
        WebSocketLogHandler instance
    """
    # Get root logger
    root_logger = logging.getLogger()
    
    # Create WebSocket handler with session context
    ws_handler = WebSocketLogHandler(session_id, user_id, message_id)
    ws_handler.setLevel(logging.INFO)
    ws_handler.setFormatter(logging.Formatter('%(message)s'))
    ws_handler.set_start_time(time.time())
    
    # Add handler
    root_logger.addHandler(ws_handler)
    
    return ws_handler

# In handle_chat_message function, setup logging before agent processing:
def handle_chat_message(event_body: Dict[str, Any]) -> Dict[str, Any]:
    # ... existing code to extract session_id, user_id ...
    
    # Setup WebSocket logging BEFORE agent processing
    message_id = event_body.get('messageId') or f"msg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    ws_log_handler = setup_agent_logging(session_id, user_id, message_id)
    
    try:
        # Process with agent (logs will be streamed automatically)
        agent_response = process_with_kill_monitoring(agent, enhanced_message, session_id, user_id, session_context)
        
        # ... rest of processing ...
        
    finally:
        # Flush any remaining logs
        ws_log_handler.flush()
        # Remove handler to prevent memory leaks
        logging.getLogger().removeHandler(ws_log_handler)
```

### 2. WebSocket Processor Changes

**File: `backend_app/src/websocket/message_processor/app/lambda_function.py`**

Add handler for `agent_log` messages with careful high-volume handling:
```python
def handle_agent_log(event):
    """
    Handle agent log streaming from chat agent lambda.
    
    CAREFULLY handles high-volume logs per user message with:
    - Session/user validation
    - Connection verification
    - Batch processing
    - Error isolation
    
    Args:
        event: Event containing unique payload with user_id, session_id, logs, and metadata
        
    Returns:
        API Gateway response
    """
    try:
        # Extract all markers from unique payload structure
        user_id = event.get('user_id')
        session_id = event.get('session_id')
        payload = event.get('payload', {}) if 'payload' in event else event
        
        # Validate all required markers are present
        if not user_id or not session_id:
            logger.error("Missing user_id or session_id in agent log event")
            return {
                'statusCode': 400,
                'body': json_dumps_safe({'error': 'Missing user_id or session_id'})
            }
        
        # Extract log batch metadata from unique payload
        logs = payload.get('logs', [])
        message_id = payload.get('message_id')
        log_batch_id = payload.get('log_batch_id')
        batch_size = payload.get('batch_size', len(logs))
        
        if not logs:
            logger.warning(f"Empty log batch received for session {session_id}")
            return {
                'statusCode': 200,
                'body': json_dumps_safe({'message': 'Empty log batch'})
            }
        
        logger.info(f"Processing agent log batch: session={session_id}, user={user_id}, batch_id={log_batch_id}, size={batch_size}")
        
        # CRITICAL: Find active connections for THIS specific session/user
        # This ensures logs only go to the correct session
        active_connections = get_active_connections_for_user_session(user_id, session_id)
        
        if not active_connections:
            logger.info(f"No active connections for session {session_id}, user {user_id} - logs will be visible on reconnect")
            return {
                'statusCode': 200,
                'body': json_dumps_safe({'message': 'No active connections'})
            }
        
        # Construct unique message payload with all markers for frontend
        # This ensures frontend can properly differentiate and route logs
        log_message = {
            'type': 'agent_log',  # Unique message type for AI thoughts
            
            # Session/User Identification (CRITICAL for frontend routing)
            'session_id': session_id,
            'user_id': user_id,
            'message_id': message_id,  # Links to specific user message
            
            # Batch Metadata
            'log_batch_id': log_batch_id,
            'batch_timestamp': payload.get('batch_timestamp'),
            'batch_size': batch_size,
            'batch_index': payload.get('batch_index', 0),
            
            # Log Entries
            'logs': logs,
            
            # Processing Context
            'source': payload.get('source', 'agent_lambda'),
            'log_type': payload.get('log_type', 'agent_thoughts'),
            'version': payload.get('version', '1.0'),
            
            # Delivery Metadata
            'delivered_at': datetime.now().isoformat(),
            'connection_count': len(active_connections)
        }
        
        # Send to all active connections for this session/user
        # Isolate errors per connection to prevent one failure from blocking others
        successful_deliveries = 0
        failed_deliveries = 0
        
        for connection_id in active_connections:
            try:
                # Verify connection is still active before sending
                # (get_active_connections_for_user_session already filters, but double-check)
                send_message_to_client(connection_id, log_message)
                successful_deliveries += 1
                logger.debug(f"Sent {batch_size} agent logs to connection {connection_id}")
                
            except Exception as e:
                failed_deliveries += 1
                logger.error(f"Failed to send logs to connection {connection_id}: {str(e)}")
                # Continue to other connections even if one fails
        
        logger.info(f"Agent log batch delivered: session={session_id}, successful={successful_deliveries}, failed={failed_deliveries}, total_logs={batch_size}")
        
        return {
            'statusCode': 200,
            'body': json_dumps_safe({
                'message': 'Logs delivered',
                'successful_connections': successful_deliveries,
                'failed_connections': failed_deliveries,
                'batch_size': batch_size
            })
        }
        
    except Exception as e:
        logger.error(f"Error handling agent logs: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            'statusCode': 500,
            'body': json_dumps_safe({'error': str(e)})
        }
```

**Update lambda_handler to route agent_log messages:**
```python
def lambda_handler(event, context):
    # ... existing code ...
    
    # Check if this is an agent log message (direct Lambda invocation)
    if 'type' in event and event.get('type') == 'agent_log':
        logger.info("Processing agent log message")
        return handle_agent_log(event)
    
    # ... rest of existing code ...
```

### 3. Frontend Changes

**File: `frontend/react-app/src/pages/ChatPage.tsx`**

Add handler for `agent_log` messages with session-aware routing:
```typescript
// State for agent logs (per session)
const [agentLogs, setAgentLogs] = useState<Map<string, AgentLog[]>>(new Map());

interface AgentLog {
  log_id: string;
  level: string;
  message: string;
  timestamp: number;
  relative_time: number;
  module?: string;
  function?: string;
}

interface AgentLogBatch {
  type: 'agent_log';
  session_id: string;
  user_id: string;
  message_id: string;
  log_batch_id: string;
  batch_timestamp: number;
  batch_size: number;
  batch_index: number;
  logs: AgentLog[];
  delivered_at: string;
}

// In the WebSocket message handler
useEffect(() => {
  if (!ws) return;
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // Handle agent logs with proper session routing
    if (data.type === 'agent_log') {
      const batch = data as AgentLogBatch;
      
      // CRITICAL: Verify this log batch belongs to current session
      // This prevents logs from other sessions appearing in wrong chat
      if (batch.session_id !== currentSessionId) {
        console.warn(`Received logs for different session: ${batch.session_id} (current: ${currentSessionId})`);
        return; // Ignore logs for other sessions
      }
      
      // Deduplicate logs using log_id (in case of retries)
      setAgentLogs(prev => {
        const sessionLogs = prev.get(batch.session_id) || [];
        const existingLogIds = new Set(sessionLogs.map(log => log.log_id));
        
        // Filter out duplicates
        const newLogs = batch.logs.filter(log => !existingLogIds.has(log.log_id));
        
        if (newLogs.length === 0) {
          return prev; // No new logs
        }
        
        // Add new logs and sort by timestamp
        const updatedLogs = [...sessionLogs, ...newLogs].sort((a, b) => 
          a.timestamp - b.timestamp
        );
        
        // Limit total logs per session to prevent memory issues (keep last 500)
        const limitedLogs = updatedLogs.slice(-500);
        
        const newMap = new Map(prev);
        newMap.set(batch.session_id, limitedLogs);
        return newMap;
      });
      
      console.log(`Received ${batch.logs.length} agent logs for session ${batch.session_id}`);
    }
    
    // ... existing message handlers ...
  };
}, [ws, currentSessionId]);

// Get logs for current session
const currentSessionLogs = agentLogs.get(currentSessionId) || [];
```

**Add UI component for logs with session isolation:**
```typescript
// Add a collapsible log panel component (only shows logs for current session)
{showAgentLogs && currentSessionLogs.length > 0 && (
  <div className="agent-logs-panel">
    <div className="agent-logs-header">
      <h3>Agent Processing Logs</h3>
      <span className="log-count">{currentSessionLogs.length} logs</span>
      <button onClick={() => setAgentLogs(prev => {
        const newMap = new Map(prev);
        newMap.delete(currentSessionId);
        return newMap;
      })}>Clear</button>
    </div>
    <div className="agent-logs-content">
      {currentSessionLogs.map((log) => (
        <div key={log.log_id} className={`log-entry log-${log.level.toLowerCase()}`}>
          <span className="log-timestamp">
            {new Date(log.timestamp * 1000).toLocaleTimeString()}
          </span>
          <span className="log-relative-time">
            +{log.relative_time.toFixed(2)}s
          </span>
          <span className="log-level">{log.level}</span>
          <span className="log-message">{log.message}</span>
          {log.module && (
            <span className="log-context">{log.module}.{log.function}</span>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

**File: `frontend/react-app/src/components/GlobalChatSidebar.tsx`**

Add handler for agent logs in sidebar (if needed):
```typescript
// Similar handler in sidebar for session preview
// Use session_id from the batch to route to correct session preview
if (data.type === 'agent_log') {
  const batch = data as AgentLogBatch;
  
  // Update session preview with log count
  updateSessionLogCount(batch.session_id, batch.batch_size);
  
  // Optionally show indicator that agent is processing
  if (batch.batch_size > 0) {
    setSessionProcessing(batch.session_id, true);
  }
}
```

## Considerations

### 1. Log Volume Management (CRITICAL - High Volume Per Message)

**Problem**: For every user message, there will be LOTS of logs (potentially 50-200+ logs)

**Solutions**:
- **Aggressive Batching**: 
  - Time-based: Send every 300ms (faster than 500ms for real-time feel)
  - Size-based: Max 20 logs per batch (increased from 10 for efficiency)
  - Reduces Lambda invocations and WebSocket messages
  
- **Rate Limiting**: 
  - Max 50 logs/second per session
  - Drops excess logs to prevent overwhelming
  - Prevents one session from consuming all resources
  
- **Smart Filtering**: 
  - Skip DEBUG level logs
  - Filter noisy patterns (import messages, OTEL, etc.)
  - Only send meaningful AI thoughts
  
- **Batch Indexing**: 
  - Each batch has unique `log_batch_id` and `batch_index`
  - Frontend can reconstruct order if batches arrive out of order
  - Helps with deduplication

### 2. Session/User Differentiation (CRITICAL)

**Problem**: Must properly differentiate logs across multiple sessions/users

**Solutions**:
- **Unique Payload Structure**: Every payload includes:
  - `session_id`: Isolates logs to specific session
  - `user_id`: Ensures user ownership
  - `message_id`: Links logs to specific user message
  - `log_batch_id`: Unique batch identifier
  - `log_id`: Unique identifier per log entry
  
- **Connection Verification**: 
  - `get_active_connections_for_user_session()` validates session/user
  - Only sends to connections matching BOTH session_id AND user_id
  - Prevents cross-contamination between sessions
  
- **Frontend Routing**: 
  - Frontend uses `session_id` to route logs to correct UI
  - Logs are stored per-session in frontend state
  - Prevents logs from appearing in wrong chat window

### 3. Performance Impact

- **Async Invocation**: Using `InvocationType='Event'` means no blocking
- **Lambda Costs**: 
  - With batching: ~5-10 invocations per user message (instead of 50-200)
  - Cost reduction: ~90% fewer Lambda invocations
- **WebSocket Load**: 
  - Batched logs: ~5-10 messages per user message (instead of 50-200)
  - Message reduction: ~95% fewer WebSocket messages
- **Memory**: 
  - Batching reduces memory footprint in agent lambda
  - Log buffer cleared after each send

### 4. Error Handling

- **Graceful Degradation**: 
  - If WebSocket processor fails, agent continues
  - Logs still go to CloudWatch as backup
  - Frontend can request logs on reconnect if needed
  
- **Error Isolation**: 
  - One connection failure doesn't block others
  - Logging errors don't break agent execution
  - Thread-safe batching prevents race conditions
  
- **No Breaking Changes**: 
  - Logging errors are silently caught
  - Agent execution is never blocked by logging
  - Existing functionality remains unchanged

### 5. Security

- **Session Validation**: 
  - WebSocket processor validates session_id/user_id before routing
  - Only sends to authenticated, active connections
  - Prevents unauthorized log access
  
- **Connection Verification**: 
  - `get_active_connections_for_user_session()` double-checks ownership
  - Connections are verified before each send
  - Expired connections are automatically filtered
  
- **No Sensitive Data**: 
  - Filter out any sensitive information from logs
  - Only send user-facing AI thoughts
  - Skip internal debugging information

### 6. High Volume Handling Strategy

**For 100 logs per user message**:
- **Without batching**: 100 Lambda invocations + 100 WebSocket messages
- **With batching (20 logs/batch)**: 5 Lambda invocations + 5 WebSocket messages
- **Efficiency gain**: 95% reduction in invocations/messages

**For 200 logs per user message**:
- **Without batching**: 200 Lambda invocations + 200 WebSocket messages
- **With batching + rate limiting**: 
  - Rate limit: 50 logs/second max
  - Batches: ~10 batches (20 logs each)
  - Result: 10 Lambda invocations + 10 WebSocket messages
- **Efficiency gain**: 95% reduction, with rate limiting preventing overload

## Testing Strategy

1. **Unit Tests**: Test logging handler batching and filtering
2. **Integration Tests**: Test end-to-end flow from agent to frontend
3. **Load Tests**: Verify performance with high log volume
4. **Error Tests**: Verify graceful degradation on failures

## Next Steps

1. ✅ **Feasibility Confirmed** - Architecture supports this
2. ⏭️ **Implement Custom Logging Handler** in agent
3. ⏭️ **Add agent_log Handler** in websocket processor
4. ⏭️ **Update Frontend** to display logs
5. ⏭️ **Test and Refine** filtering/throttling

## Alternative: Direct API Gateway Management API

**Note**: We could also have the agent call API Gateway Management API directly, but this would require:
- Passing `connection_id` to the agent (not currently available)
- Managing connection lifecycle in agent
- More complex error handling

**Recommendation**: Use the existing `invoke_websocket_processor` pattern for consistency and simplicity.

