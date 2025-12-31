# Chat Agent Performance Optimization Analysis

## Current Optimizations (Already Implemented)

1. ✅ **Base Agent Pre-warming** - Background thread pre-warms base agent
2. ✅ **Session Context Caching** - 120s TTL in-memory cache (increased from 30s)
3. ✅ **System Prompt Caching** - Cached prompts with 10-minute TTL (increased cache size to 200)
4. ✅ **Session Agent Caching** - Agents cached with context change detection
5. ✅ **Connection Pooling** - HTTP requests use connection pooling
6. ✅ **CSV Data Caching** - Autocomplete tools cache CSV data
7. ✅ **Provisioned Concurrency** - Lambda has provisioned concurrency configured
8. ✅ **Context Building Caching** - Built contexts cached with 5-minute TTL
9. ✅ **Parallel WebSocket Sends** - Multiple connections send in parallel
10. ✅ **Parallel Context Building** - Multiple context items processed concurrently
11. ✅ **Optimized Kill Signal Checking** - Reduced polling frequency (10s initial, 60s after)
12. ✅ **Increased ThreadPoolExecutor Workers** - 4 workers for parallel operations

## Performance Bottlenecks Identified

### 1. **ThreadPoolExecutor Limited to 1 Worker**
**Location**: `lambda_handler.py:206`
```python
with ThreadPoolExecutor(max_workers=1) as executor:
```
**Impact**: No parallelization possible for concurrent operations
**Recommendation**: Increase to 2-4 workers for parallel context building, tool calls, etc.

### 2. **Sequential DynamoDB Reads**
**Location**: Multiple `get_item` calls in `session_manager.py` and `websocket_handler.py`
**Impact**: Each read adds ~10-50ms latency
**Recommendation**: Batch multiple reads using `batch_get_item` where possible

### 3. **Context Building is Synchronous**
**Location**: `context_builder.py` - builds context sequentially
**Impact**: Large context items processed one at a time
**Recommendation**: Parallelize context item processing

### 4. **Agent Creation Blocks Main Thread**
**Location**: `context_aware_agent.py:176-178` - Uses threading but still blocks
**Impact**: 10-second timeout can delay responses
**Recommendation**: Pre-create agents for common models, use async agent pool

### 5. **Kill Signal Polling Every 30 Seconds**
**Location**: `lambda_handler.py:177` - Checks every 30s
**Impact**: Unnecessary DynamoDB reads during long operations
**Recommendation**: Use DynamoDB Streams or EventBridge for event-driven kill signals

### 6. **WebSocket Message Sending is Sequential**
**Location**: `websocket_handler.py:244-248` - Loops through connections
**Impact**: Multiple connections processed one at a time
**Recommendation**: Parallelize WebSocket sends using ThreadPoolExecutor

### 7. **Session Context Cache TTL Too Short**
**Location**: `session_manager.py:44` - 30 second TTL
**Impact**: Frequent cache misses for active sessions
**Recommendation**: Increase to 60-120 seconds for active sessions

### 8. **No Aggressive Prompt Caching**
**Location**: `context_aware_agent.py:277-293` - Cache exists but could be more aggressive
**Impact**: Rebuilding prompts unnecessarily
**Recommendation**: Cache prompts longer, use more granular cache keys

### 9. **Context Building Not Cached**
**Location**: `context_builder.py` - No caching of built contexts
**Impact**: Rebuilding same contexts repeatedly
**Recommendation**: Cache built contexts with TTL

### 10. **No Lazy Loading for Tools**
**Location**: `agent.py` - All tools loaded at import time
**Impact**: Slower cold starts
**Recommendation**: Lazy load tools on first use

## ✅ Implemented Optimizations (Just Completed)

### High Priority (Completed)

1. ✅ **Increased ThreadPoolExecutor Workers**
   - Changed `max_workers=1` to `max_workers=4`
   - Allows parallel context building, tool calls, WebSocket sends

2. ✅ **Parallelized WebSocket Message Sending**
   - Uses ThreadPoolExecutor to send to multiple connections concurrently
   - Reduces latency for multi-connection users

3. ✅ **Increased Session Context Cache TTL**
   - Changed from 30s to 120s for active sessions
   - Reduces DynamoDB reads for active conversations

4. ✅ **Added Context Building Caching**
   - Caches built contexts with 5-minute TTL
   - Parallelizes context item formatting for multiple items

5. ✅ **Dedicated Kill Signal Monitoring Thread**
   - Separate background thread checks every 2 seconds (doesn't block main processing)
   - Bypasses cache to ensure immediate detection of kill signals
   - Kill signals detected within 2 seconds maximum

6. ✅ **Enhanced Prompt Caching**
   - Increased cache size to 200 entries
   - Added 10-minute TTL for prompt cache
   - Better cache eviction strategy

7. ✅ **Reduced Agent Creation Timeout**
   - Reduced from 10s to 5s for faster failure detection

## Remaining Recommended Optimizations (Priority Order)

### High Priority (Still To Do)

1. **Batch DynamoDB Reads**
   - Combine multiple `get_item` calls into `batch_get_item`
   - Reduces round-trip latency

### Medium Priority (Significant Impact)

5. **Parallelize Context Building**
   - Process multiple context items concurrently
   - Use ThreadPoolExecutor for context item formatting

6. **Cache Built Contexts**
   - Cache formatted context strings with TTL
   - Key: hash of context items + user message

7. **Optimize Kill Signal Checking**
   - Use DynamoDB Streams or EventBridge instead of polling
   - Or increase polling interval to 60s for long operations

8. **Pre-create Common Model Agents**
   - Pre-create agents for claude-sonnet-4, claude-haiku-4-5
   - Keep in pool, clone for sessions

### Low Priority (Nice to Have)

9. **Lazy Load Tools**
   - Load tools on first use instead of import time
   - Reduces cold start time

10. **Aggressive Prompt Caching**
    - Increase cache size, use more granular keys
    - Cache prompts for 5+ minutes

11. **Connection Pooling for DynamoDB**
    - Configure boto3 connection pooling explicitly
    - Reuse connections across invocations

## Implementation Priority

**Phase 1 (Quick Wins - 1-2 hours):**
- Increase ThreadPoolExecutor workers
- Parallelize WebSocket sends
- Increase cache TTL
- Batch DynamoDB reads

**Phase 2 (Medium Effort - 3-4 hours):**
- Parallelize context building
- Cache built contexts
- Optimize kill signal checking

**Phase 3 (Long-term - 1-2 days):**
- Pre-create agent pool
- Lazy load tools
- Aggressive prompt caching

