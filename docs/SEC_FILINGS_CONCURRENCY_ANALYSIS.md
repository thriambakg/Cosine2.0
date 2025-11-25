# SEC Filings Fetching Architecture - Concurrency Analysis

## Executive Summary

This document analyzes the current SEC filings fetching architecture to determine concurrent query capacity from multiple users.

**Key Finding:** The architecture can theoretically handle **~100-200 concurrent search queries** simultaneously, with the primary bottleneck being Lambda concurrency limits and SEC API rate limiting.

---

## Architecture Overview

### Components

1. **API Gateway** - Entry point for HTTP requests
2. **sec_search_lambda** - Main search handler (512 MB, 300s timeout)
3. **sec_search_progress_subscriber_lambda** - Progress update handler (256 MB, 60s timeout)
4. **DynamoDB** - Cache table for filings and job status
5. **SNS Topic** - Progress update notifications
6. **S3 Bucket** - File storage for downloaded filings

### Request Flow

```
User Request → API Gateway → sec_search_lambda (creates job, returns 202)
                                    ↓
                            Self-invokes async Lambda
                                    ↓
                    Processes pages (up to 100 pages, 10 results/page)
                                    ↓
                    Publishes progress to SNS → Subscriber Lambda → DynamoDB
                                    ↓
                    Frontend polls /sec-search-status endpoint
```

---

## Bottleneck Analysis

### 1. AWS Lambda Concurrency

**Current Configuration:**
- **Main Lambda:** 512 MB memory, 300s timeout, no reserved concurrency
- **Subscriber Lambda:** 256 MB memory, 60s timeout, no reserved concurrency
- **Default Account Limit:** 1,000 concurrent executions per region

**Capacity Calculation:**
- Each async search job runs for up to 5 minutes (300s)
- With 1,000 concurrent executions: **1,000 simultaneous searches**
- However, this is shared across ALL Lambda functions in the account

**Practical Limit:**
- If 50% of Lambda capacity is reserved for other functions: **~500 concurrent searches**
- If 80% reserved: **~200 concurrent searches**

**Recommendation:** Request a concurrency limit increase if expecting >200 concurrent users.

---

### 2. API Gateway Throttling

**Default Limits:**
- **Burst Limit:** 5,000 requests
- **Steady-State Rate:** 10,000 requests/second per account
- **Per-API Rate:** Can be configured (default: unlimited)

**Current Usage:**
- Search requests: 1 request per user (creates job, returns 202)
- Status polling: ~1 request per 2 seconds per user (while searching)
- Autocomplete: Variable (depends on typing speed)

**Capacity:**
- **Search requests:** 10,000/second (well above needs)
- **Status polling:** With 1,000 concurrent searches polling every 2s = 500 req/s
- **Total:** Well within API Gateway limits

**Verdict:** ✅ Not a bottleneck

---

### 3. DynamoDB Throughput

**Current Configuration:**
- Table name: From base_infra (likely on-demand or provisioned)
- Primary key: `filingId` (stores both filings and job status)
- TTL: Enabled for job cleanup (1 hour)

**Operations per Search:**
- **Job Creation:** 1 write (WCU)
- **Progress Updates:** ~100 writes (1 per page, up to 100 pages)
- **Status Polling:** ~50 reads (1 per 2 seconds for 100 seconds average)
- **Job Completion:** 1 write
- **Cache Lookups:** Variable (depends on cache hit rate)

**Capacity Requirements (100 concurrent searches):**
- **Writes:** 100 jobs × 102 writes/job = 10,200 writes
  - Spread over 5 minutes = ~34 writes/second
  - **WCUs needed:** ~34 WCUs
- **Reads:** 100 jobs × 50 reads/job = 5,000 reads
  - Spread over 5 minutes = ~17 reads/second
  - **RCUs needed:** ~17 RCUs (or ~9 RCUs with eventually consistent)

**DynamoDB Limits:**
- **On-Demand Mode:** Auto-scales, can handle 2x previous peak (up to 40,000 RCU/WCU)
- **Provisioned Mode:** Default up to 40,000 RCU/WCU (can be increased)

**Verdict:** ✅ Not a bottleneck (even with 1,000 concurrent searches, needs ~340 WCUs and ~170 RCUs)

---

### 4. SEC API Rate Limiting

**Current Implementation:**
- **Rate Limit:** 0.1 second delay between requests (`time.sleep(0.1)`)
- **Max Requests/Second:** ~10 requests/second per Lambda instance
- **Per Search:** Up to 100 pages = 100 requests = ~10 seconds minimum

**Bottleneck Analysis:**
- With 1,000 concurrent Lambda instances: **10,000 requests/second to SEC API**
- SEC.gov rate limits are typically:
  - **Public:** ~10 requests/second per IP
  - **With proper User-Agent:** Higher limits (exact limit unknown)

**Critical Issue:** ⚠️ **This is likely the PRIMARY bottleneck**

**Impact:**
- SEC API may throttle/block requests if too many concurrent requests from same IP/account
- Each Lambda instance makes requests independently (no shared rate limiter)
- Risk of 429 (Too Many Requests) errors

**Recommendation:**
- Implement a distributed rate limiter (e.g., DynamoDB-based token bucket)
- Or use SQS with rate-limited consumers
- Or reduce concurrency to stay within SEC API limits

---

### 5. SNS Topic Limits

**Default Limits:**
- **Publish Rate:** 30,000 messages/second per topic
- **Subscription Delivery:** 100,000 messages/second per subscription

**Current Usage:**
- Progress updates: ~100 messages per search (1 per page)
- With 1,000 concurrent searches: 100,000 messages over 5 minutes = ~333 messages/second

**Verdict:** ✅ Not a bottleneck

---

### 6. S3 Request Rates

**Default Limits:**
- **PUT Requests:** 3,500 requests/second per prefix
- **GET Requests:** 5,500 requests/second per prefix

**Current Usage:**
- File downloads: Variable (depends on number of documents per filing)
- Average: ~5-10 files per filing
- With 1,000 concurrent searches: 5,000-10,000 files over 5 minutes = ~17-33 PUTs/second

**Verdict:** ✅ Not a bottleneck

---

## Concurrent Query Capacity Estimate

### Conservative Estimate (with SEC API rate limiting)

**Assumption:** SEC API allows ~100 requests/second from our infrastructure

**Calculation:**
- Each search: ~100 requests (100 pages)
- At 0.1s delay: ~10 seconds minimum per search
- With 100 req/s limit: **~10 concurrent searches** (if all hitting SEC API simultaneously)

**However:** Not all searches hit SEC API at the same time (caching, different pages)

**Realistic Estimate:** **~50-100 concurrent searches** before SEC API throttling

---

### Optimistic Estimate (if SEC API limits are higher)

**Assumption:** SEC API allows ~1,000 requests/second

**Calculation:**
- Each search: ~100 requests
- With 1,000 req/s limit: **~100 concurrent searches** hitting SEC API
- Accounting for caching and staggered execution: **~200-300 concurrent searches**

---

### Theoretical Maximum (ignoring SEC API)

**Based on Lambda concurrency:**
- 1,000 concurrent executions (default limit)
- Each search runs for ~5 minutes
- **Capacity:** 1,000 simultaneous searches

**However:** This assumes no other Lambda functions using capacity

**Realistic:** **~200-500 concurrent searches** (assuming 50-80% capacity available)

---

## Recommendations

### 1. Implement Distributed Rate Limiting

**Problem:** Multiple Lambda instances making independent requests to SEC API

**Solution:**
- Use DynamoDB-based token bucket algorithm
- Or use SQS with rate-limited consumers (e.g., 10 messages/second)
- Or use AWS API Gateway with throttling to limit Lambda invocations

**Impact:** Prevents SEC API throttling, allows predictable capacity

---

### 2. Increase Lambda Concurrency Limit

**Current:** 1,000 concurrent executions (default)

**Recommendation:**
- Request increase to 5,000-10,000 if expecting >200 concurrent users
- Monitor CloudWatch metrics to determine actual needs

---

### 3. Optimize Caching Strategy

**Current:** DynamoDB cache for filings

**Recommendation:**
- Increase cache hit rate to reduce SEC API calls
- Consider Redis/ElastiCache for faster lookups
- Implement cache warming for popular searches

**Impact:** Reduces SEC API load, increases effective capacity

---

### 4. Implement Request Queuing

**Problem:** Sudden spikes in concurrent requests

**Solution:**
- Use SQS to queue search requests
- Process with rate-limited Lambda consumers
- Provide estimated wait time to users

**Impact:** Smooths traffic spikes, prevents overwhelming SEC API

---

### 5. Monitor and Alert

**Metrics to Monitor:**
- Lambda concurrency utilization
- DynamoDB throttling events
- SEC API error rates (429, 503)
- API Gateway 4xx/5xx errors
- Average search completion time

**Alerts:**
- Lambda concurrency >80%
- DynamoDB throttling >1%
- SEC API error rate >5%
- Search completion time >10 minutes

---

## Summary Table

| Component | Limit | Current Usage (100 concurrent) | Bottleneck? |
|-----------|-------|-------------------------------|-------------|
| **Lambda Concurrency** | 1,000 (default) | 100-200 | ⚠️ Medium |
| **API Gateway** | 10,000 req/s | ~500 req/s | ✅ No |
| **DynamoDB** | 40,000 RCU/WCU | ~34 WCU, ~17 RCU | ✅ No |
| **SNS** | 30,000 msg/s | ~333 msg/s | ✅ No |
| **S3** | 3,500 PUT/s | ~33 PUT/s | ✅ No |
| **SEC API** | Unknown (~100-1,000 req/s) | ~1,000 req/s (100 concurrent) | ⚠️ **YES - PRIMARY** |

---

## Conclusion

**Current Capacity:** **~50-100 concurrent search queries** (limited by SEC API rate limiting)

**Theoretical Maximum:** **~200-500 concurrent queries** (limited by Lambda concurrency, assuming SEC API allows)

**Primary Bottleneck:** SEC API rate limiting (unknown exact limits, but likely ~100-1,000 requests/second)

**Recommendations:**
1. Implement distributed rate limiting for SEC API requests
2. Monitor SEC API error rates and adjust accordingly
3. Increase Lambda concurrency limit if needed
4. Optimize caching to reduce SEC API load

**Next Steps:**
1. Deploy rate limiting solution
2. Load test with increasing concurrent users
3. Monitor SEC API response codes
4. Adjust capacity based on real-world performance

