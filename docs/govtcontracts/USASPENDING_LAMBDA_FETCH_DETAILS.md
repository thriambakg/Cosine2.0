# USAspending Lambda: Fetch Details from S3

## Overview

**Lambda Function**: `usaspending-fetch-details`

**Purpose**: Fetch combined transactions and subawards file from S3, parse, and build full award payloads for frontend display.

**Why Separate Lambda**:
- ✅ Dedicated function for S3 operations
- ✅ Can optimize for S3 fetching and parsing
- ✅ Independent scaling (different from indexing Lambda)
- ✅ Can cache parsed results in memory (cache entire combined file)
- ✅ Easier to monitor and debug

**Key Design**: Single S3 file per award containing both transactions and subawards in a nested structure. This reduces S3 fetches from 2 to 1, improving performance and reducing costs.

---

## API Endpoints

### 1. GET `/usaspending-award/<AWARD_ID>/transactions`

**Purpose**: Get all transactions for an award

**Flow**:
```python
def get_award_transactions(award_id: str, page: int = 1, limit: int = None):
    # 1. Get award from DynamoDB
    award = dynamodb.get_item(
        TableName='usaspending-awards-index',
        Key={'award_id': award_id}
    )
    
    if not award:
        return {"error": "Award not found"}, 404
    
    # 2. Check if award details are indexed
    if not award.get('award_details_indexed'):
        return {
            "transactions": [],
            "total": 0,
            "indexing": True,
            "message": "Award details are being indexed"
        }
    
    # 3. Get S3 key (single file containing both transactions and subawards)
    s3_key = award.get('award_details_s3_key')
    if not s3_key:
        return {"error": "Award details S3 key not found"}, 500
    
    # 4. Fetch from S3
    try:
        s3_object = s3.get_object(
            Bucket='cosine-usaspending-data-production',
            Key=s3_key
        )
        
        # 5. Decompress and parse combined file
        details_gzipped = s3_object['Body'].read()
        details_json = gzip.decompress(details_gzipped)
        details = json.loads(details_json)
        
        # 6. Extract transactions array from combined object
        transactions = details.get('transactions', [])
        
        # 6. Paginate if requested
        total = len(transactions)
        if limit:
            start = (page - 1) * limit
            end = start + limit
            transactions = transactions[start:end]
        
        # 7. Return
        return {
            "transactions": transactions,
            "total": total,
            "page": page,
            "limit": limit,
            "has_more": limit and (page * limit < total),
            "s3_key": s3_key
        }
        
    except s3.exceptions.NoSuchKey:
        # File missing - trigger re-indexing
        return {
            "error": "Transactions file not found in S3",
            "indexing": True,
            "message": "Re-indexing triggered"
        }, 404
    except Exception as e:
        return {"error": str(e)}, 500
```

**Response**:
```json
{
  "transactions": [...],
  "total": 229,
  "page": 1,
  "limit": 100,
  "has_more": true,
  "s3_key": "transactions/CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-.json.gz"
}
```

---

### 2. GET `/usaspending-award/<AWARD_ID>/subawards`

**Purpose**: Get all subawards for an award

**Flow**: Same as transactions, but:
- Check `award_details_s3_key` (same file as transactions)
- Fetch same combined file from S3
- Extract `subawards` array from combined object

**Response**:
```json
{
  "subawards": [...],
  "total": 7065,
  "page": 1,
  "limit": 100,
  "has_more": true,
  "s3_key": "subawards/CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-.json.gz"
}
```

---

### 3. GET `/usaspending-award/<AWARD_ID>/full`

**Purpose**: Get complete award with transactions and subawards

**Flow**:
```python
def get_full_award(award_id: str):
    # 1. Get award from DynamoDB
    award = dynamodb.get_item(...)
    
    # 2. Check if award details are indexed
    if not award.get('award_details_indexed'):
        return {
            "award": award,
            "transactions": [],
            "subawards": [],
            "indexing": True
        }
    
    # 3. Fetch single combined file from S3 (no parallel needed - single file!)
    s3_key = award['award_details_s3_key']
    s3_object = s3.get_object(
        Bucket='cosine-usaspending-data-production',
        Key=s3_key
    )
    
    # 4. Decompress and parse
    details_gzipped = s3_object['Body'].read()
    details_json = gzip.decompress(details_gzipped)
    details = json.loads(details_json)
    
    # 5. Extract both arrays from combined object
    transactions = details.get('transactions', [])
    subawards = details.get('subawards', [])
    
    # 6. Return combined payload
    return {
        "award": award,
        "transactions": transactions,
        "subawards": subawards,
        "transactions_total": len(transactions),
        "subawards_total": len(subawards)
    }
```

**Response**:
```json
{
  "award": {...},
  "transactions": [...],
  "subawards": [...],
  "transactions_total": 229,
  "subawards_total": 7065
}
```

---

## Performance Optimizations

### 1. Single File Fetch
- Single S3 fetch for both transactions and subawards (for `/full` endpoint)
- No parallel fetching needed - everything in one file
- Reduces total latency from ~400ms (2 fetches) to ~150ms (1 fetch)

### 2. Lambda Memory Caching
```python
# Cache parsed combined file in Lambda memory (short TTL)
_cache = {}
_cache_ttl = 60  # seconds

def get_cached_award_details(award_id: str):
    cache_key = f"award_details:{award_id}"
    if cache_key in _cache:
        cached_data, timestamp = _cache[cache_key]
        if time.time() - timestamp < _cache_ttl:
            # Return cached combined object
            return cached_data  # { transactions: [...], subawards: [...] }
    return None
```

### 3. CloudFront CDN
- S3 files served via CloudFront
- Reduces latency for frequently accessed awards
- TTL: 24 hours

### 4. Streaming for Large Files
- For very large arrays, stream JSON parsing
- Don't load entire array into memory if pagination is requested

---

## Error Handling

### S3 File Not Found
- Check `award_details_indexed` flag
- If true but file missing: Trigger re-indexing (async)
- Return empty arrays with `indexing: true` flag

### Corrupted File
- Try to parse, catch JSON/gzip errors
- If corrupted: Delete S3 file, trigger re-indexing
- Return error to user with retry suggestion

### Partial Indexing
- Award indexed but award details not yet indexed
- Return award with `award_details_indexed: false`
- Frontend can show "Indexing award details..." message

### Timeout
- Large files (>2MB) might take >5 seconds to fetch/parse
- Increase Lambda timeout to 30 seconds
- Or implement streaming/chunked response

---

## Lambda Configuration

### Memory
- **Recommended**: 512MB - 1GB
- Large JSON parsing benefits from more memory
- Cost vs performance trade-off

### Timeout
- **Recommended**: 30 seconds
- Large files can take 5-10 seconds to fetch + parse
- Parallel fetching adds time

### Environment Variables
```python
S3_BUCKET = "cosine-usaspending-data-production"
DYNAMODB_TABLE = "usaspending-awards-index"
CACHE_TTL = 60  # seconds
CLOUDFRONT_DOMAIN = "d1234abcd.cloudfront.net"  # Optional: use CloudFront
```

---

## Frontend Integration

### Award Details Page

```typescript
// Fetch award summary (fast - from DynamoDB)
const award = await fetch(`/usaspending-award/${awardId}`);

// Show award immediately
displayAward(award);

// Fetch transactions on-demand (when user clicks "View Transactions")
if (award.award_details_indexed) {
  setLoadingTransactions(true);
  const { transactions } = await fetch(`/usaspending-award/${awardId}/transactions`);
  displayTransactions(transactions);
  setLoadingTransactions(false);
} else {
  showMessage("Award details are being indexed...");
}

// Fetch subawards on-demand (when user clicks "View Subawards")
if (award.award_details_indexed) {
  setLoadingSubawards(true);
  const { subawards } = await fetch(`/usaspending-award/${awardId}/subawards`);
  displaySubawards(subawards);
  setLoadingSubawards(false);
} else {
  showMessage("Award details are being indexed...");
}
```

### Pagination
```typescript
// Fetch transactions with pagination
const { transactions, total, has_more } = await fetch(
  `/usaspending-award/${awardId}/transactions?page=1&limit=100`
);

// Load more
if (has_more) {
  const { transactions: more } = await fetch(
    `/usaspending-award/${awardId}/transactions?page=2&limit=100`
  );
}
```

---

## Monitoring

### CloudWatch Metrics
- **Invocation Count**: Number of fetches
- **Duration**: Time to fetch + parse
- **Error Rate**: Failed fetches
- **Cache Hit Rate**: Cache effectiveness

### Alarms
- Error rate > 5%
- Duration > 5 seconds (p95)
- S3 file not found rate > 1%

---

## Summary

✅ **Separate Lambda**: Dedicated function for S3 fetching
✅ **On-Demand Fetching**: Only fetch when user requests
✅ **Single File Fetch**: One S3 fetch for both transactions and subawards (faster, cheaper)
✅ **Pagination Support**: Handle large arrays efficiently (slice in memory)
✅ **Error Handling**: Graceful handling of missing/corrupted files
✅ **Caching**: Lambda memory cache (entire combined file) + CloudFront CDN
✅ **Performance**: ~80-150ms typical fetch time (improved from ~200-350ms with two files)

