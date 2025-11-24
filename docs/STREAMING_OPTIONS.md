# Streaming Options for Async Search State Updates

## Current Approach: DynamoDB + Polling
- **Status**: ✅ Working, no infrastructure changes needed
- **How it works**: Frontend polls `/sec-search-status` endpoint every 1-2 seconds
- **Pros**: Simple, reliable, works with existing infrastructure
- **Cons**: Slight delay (1-2 seconds) for state updates, requires polling

## Alternative: WebSockets (Recommended for Real-Time)
AWS API Gateway WebSocket API allows bidirectional real-time communication:

### How it would work:
1. Frontend establishes WebSocket connection to API Gateway
2. Lambda sends progress updates directly to WebSocket connection
3. Frontend receives updates in real-time (no polling needed)

### Implementation:
- Use API Gateway WebSocket API (not REST API)
- Lambda can send messages to specific connection IDs
- Frontend maintains WebSocket connection during search
- Updates pushed immediately when progress changes

### Pros:
- ✅ Real-time updates (no polling delay)
- ✅ Lower latency
- ✅ More efficient (no repeated HTTP requests)

### Cons:
- ⚠️ Requires infrastructure changes (new WebSocket API)
- ⚠️ Need to manage connection lifecycle
- ⚠️ More complex error handling (connection drops, reconnects)

## Alternative: Server-Sent Events (SSE)
One-way streaming from server to client:

### How it would work:
1. Frontend opens SSE connection to `/sec-search-stream?job_id=xxx`
2. Lambda streams progress updates as events
3. Frontend receives updates in real-time

### Pros:
- ✅ Simpler than WebSockets (one-way)
- ✅ Works over HTTP (no special protocol)
- ✅ Automatic reconnection

### Cons:
- ⚠️ Requires infrastructure changes
- ⚠️ API Gateway doesn't natively support SSE (need Lambda response streaming)
- ⚠️ One-way only (can't send cancel from same connection)

## Alternative: DynamoDB Streams + WebSockets
Push updates when DynamoDB changes:

### How it would work:
1. DynamoDB Stream triggers Lambda when job progress updates
2. Lambda pushes update to WebSocket connection
3. Frontend receives real-time updates

### Pros:
- ✅ True push-based updates
- ✅ No polling needed

### Cons:
- ⚠️ Requires WebSocket infrastructure
- ⚠️ More complex setup

## Recommendation

**For now**: Keep the current DynamoDB + polling approach because:
- ✅ It's working reliably
- ✅ No infrastructure changes needed
- ✅ Simple to maintain
- ✅ 1-2 second delay is acceptable for search progress

**Future enhancement**: If real-time updates become critical, implement WebSockets:
- Use API Gateway WebSocket API
- Store connection IDs in DynamoDB (keyed by user/session)
- Lambda pushes updates directly to WebSocket when progress changes
- Frontend maintains WebSocket connection during search

## Note on UDP
AWS API Gateway does **not** support UDP. HTTP/HTTPS (TCP) is the only protocol supported. For real-time streaming, WebSockets (which run over TCP) are the recommended AWS-native solution.

