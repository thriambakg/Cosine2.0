# Scalability Analysis & Recommendations

## Current Architecture Limits

### 1. **WebSocket API Gateway**
- **Limit**: 100,000 concurrent connections per region (default)
- **Request Rate**: No hard limit, but throttling at 10,000 requests/second
- **Current Status**: ✅ Good for most applications, can request increases

### 2. **Lambda Functions**
- **Concurrency**: 1,000 concurrent executions per region (default, can be increased)
- **Timeout**: Up to 15 minutes
- **Current Status**: ✅ Auto-scales, but check for cold starts

### 3. **DynamoDB**
- **Throughput**: On-demand (scales automatically) or provisioned
- **Item Size**: 400 KB max per item
- **Current Status**: ⚠️ Potential bottleneck with large message arrays

### 4. **SNS**
- **Throughput**: 100,000 messages/second
- **Current Status**: ✅ Adequate

## Current Duplicate Prevention Issues

### ✅ **Good News:**
- **DynamoDB Partition Isolation**: Each session has unique partition key (`user_id` + `session_id`)
- **No Cross-Session Contention**: Different users editing different sessions = different partitions = no write conflicts
- **Horizontal Scaling**: System can handle many concurrent edits across different sessions

### ❌ **Remaining Problems:**

1. **Client-Side Only Duplicate Prevention**: 
   - `processingQueue` and `recentSendTimestamps` are in-memory Maps (per browser instance)
   - ✅ Works within single tab/window
   - ❌ Won't prevent duplicates from network retries/WebSocket reconnections
   - ❌ Won't prevent duplicates if user rapidly clicks "save" button
   - ❌ Won't prevent duplicates from race conditions in frontend

2. **No Server-Side Idempotency**: 
   - No idempotency keys in WebSocket messages
   - Network retries could cause duplicate edits
   - No way to deduplicate at the server level

3. **No Rate Limiting**: 
   - Users can spam edit requests (intentional or accidental)
   - No per-user rate limiting to prevent abuse
   - Could overwhelm system with rapid-fire edits

## Scalability Estimates

### **Current Architecture Capacity:**

**Per User (Independent Sessions):**
- ✅ Multiple concurrent sessions per user: No issue (different partitions)
- ✅ Rapid edits to same session: Limited by client-side duplicate prevention only
- ⚠️ Network retries: Could cause duplicates (no server-side idempotency)

**Concurrent Users (Different Sessions):**
- ✅ 1,000 concurrent users editing simultaneously: **Very feasible**
  - Each session = different DynamoDB partition
  - No write contention between sessions
  - Lambda auto-scales per request
  
- ✅ 10,000 concurrent users: **Feasible** (may need API Gateway limit increase request)
  - DynamoDB on-demand mode handles this well
  - Lambda concurrency can be increased
  
- ✅ 100,000+ concurrent users: **Possible with optimizations**
  - Requires API Gateway limit increase
  - May need DynamoDB optimizations for large message arrays

**Bottlenecks:**
- ⚠️ Large message arrays (>1000 messages): DynamoDB 400KB item limit risk
- ⚠️ Network retries: Could create duplicate edits (needs idempotency)
- ⚠️ Rapid-fire edits from single user: Could spam system (needs rate limiting)

## Recommended Improvements

### 1. **Server-Side Idempotency** (Critical)

Add idempotency keys to all WebSocket messages:

```python
# In lambda_function.py - handle_edit_message
def handle_edit_message(connection_id, user_id, session_id, message_data):
    idempotency_key = message_data.get('idempotencyKey')
    message_id = message_data.get('messageId')
    
    # Create composite key: {user_id}#{session_id}#{idempotency_key}
    idempotency_composite = f"{user_id}#{session_id}#{idempotency_key}"
    
    # Check DynamoDB idempotency table (TTL: 5 minutes)
    idempotency_table = dynamodb.Table('idempotency_keys')
    try:
        response = idempotency_table.put_item(
            Item={
                'idempotency_key': idempotency_composite,
                'timestamp': int(datetime.now().timestamp()),
                'ttl': int((datetime.now() + timedelta(minutes=5)).timestamp())
            },
            ConditionExpression='attribute_not_exists(idempotency_key)'
        )
        # First time seeing this key - proceed
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            logger.warning(f"⏭️ Duplicate edit request detected: {idempotency_key}")
            return {'statusCode': 200, 'body': json.dumps({'duplicate': True})}
        raise
```

### 2. **Frontend Idempotency Key Generation**

```typescript
// In unifiedMessageHandler.ts
private generateIdempotencyKey(messageData: UnifiedMessageData): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const textHash = messageData.text ? btoa(messageData.text).substring(0, 16) : '';
  const source = messageData.source;
  
  // Format: {timestamp}_{random}_{textHash}_{source}
  return `idemp_${timestamp}_${random}_${textHash}_${source}`;
}
```

### 3. **DynamoDB Optimization** (Only if needed for large sessions)

**Option A: Message Pagination**
- Store only last N messages in session (e.g., last 50)
- Archive older messages to S3
- Reduces DynamoDB item size (stay under 400KB limit)

**Option B: Separate Messages Table**
- Move messages array to separate DynamoDB table
- Use composite key: `{session_id}#{message_id}`
- Allows unlimited message history per session
- **Note**: This is only needed if sessions frequently exceed 400KB

### 4. **Rate Limiting** (Per User, Not Per Session)

Add per-user/per-session rate limiting:

```python
import time
from collections import defaultdict

# In-memory rate limiter (for single Lambda instance)
# For distributed, use DynamoDB or ElastiCache
rate_limiter = defaultdict(list)

def check_rate_limit(user_id: str, session_id: str, limit: int = 10, window: int = 60):
    key = f"{user_id}#{session_id}"
    now = time.time()
    
    # Clean old entries
    rate_limiter[key] = [t for t in rate_limiter[key] if now - t < window]
    
    if len(rate_limiter[key]) >= limit:
        return False
    
    rate_limiter[key].append(now)
    return True
```

**Better: Use DynamoDB TTL for distributed rate limiting**

### 5. **Monitoring & Alerting**

Track key metrics:
- Edit request rate per user
- Duplicate edit detection rate
- DynamoDB write throttling events
- Lambda concurrency spikes
- WebSocket connection failures

**Not Needed**: Distributed locking or optimistic locking since different sessions don't conflict!
```

### 6. **Message Batching**

For high-frequency edits, batch multiple edits:
- Buffer edits for 500ms
- Process latest edit only
- Discard intermediate states

## Implementation Priority

### 🔴 **Critical (Do Now)**
1. **Server-side idempotency keys** - Prevents duplicate edits from network retries
2. **Rate limiting per user** - Prevents spam/abuse (not per-session, per-user)

### 🟡 **High Priority (Next Sprint)**
3. Message pagination or separate messages table - For sessions with >1000 messages
4. Better error handling and logging for duplicate detection
5. Monitoring and alerting for system health

### 🟢 **Medium Priority (Future)**
6. DynamoDB Streams for audit trail
7. Message batching for rapid edits (if needed)
8. Connection pooling optimizations

**Note**: Optimistic locking and distributed locking NOT needed since different sessions don't conflict!

## Capacity Planning

**Current Architecture Can Handle:**
- ✅ **1,000-10,000 concurrent users** editing their own sessions comfortably
- ✅ **~100 edits/second across all users** (limited mainly by Lambda/DynamoDB throughput)
- ⚠️ **Network retries** could cause duplicates (needs idempotency)
- ⚠️ **No rate limiting** could allow abuse

**To Scale to 100,000+ Users:**
- ✅ Implement server-side idempotency (prevents duplicates from retries)
- ✅ Add per-user rate limiting (prevents abuse)
- ⚠️ Request API Gateway limit increase if needed (default: 100k connections)
- ⚠️ Monitor DynamoDB for large message arrays (>1000 messages)
- Consider DynamoDB Global Tables only if multi-region needed

## Testing Recommendations

1. **Load Testing**: Use AWS Load Testing or Locust
   - ✅ **Test 10,000 concurrent users** editing different sessions (realistic scenario)
   - ✅ **Test network retries** (simulate duplicate WebSocket sends)
   - ✅ **Test rapid-fire edits** from single user (test rate limiting)
   - ⚠️ **NOT needed**: Multiple edits to same session from different devices (you said not a concern)

2. **Chaos Engineering**: 
   - Network failures during edits (should be handled by idempotency)
   - Lambda cold starts (should auto-scale)
   - DynamoDB throttling simulation (on-demand should handle this)

3. **Monitoring**:
   - Duplicate edit detection rate (with idempotency keys)
   - Per-user edit rate (for rate limiting enforcement)
   - DynamoDB item sizes (watch for 400KB limit)
   - Lambda concurrency (should auto-scale)
   - WebSocket connection failures (unrelated to edits, but good to monitor)

