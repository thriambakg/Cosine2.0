# USAspending S3 Storage Strategy

## Overview

**Problem**: DynamoDB has a 400KB item size limit. Large awards can have:
- 200-900+ transactions (100-500KB)
- 2,000-7,000+ subawards (600KB-2MB+)
- **Combined size: 700KB-2.2MB+** (exceeds DynamoDB limit)

**Solution**: Store transactions and subawards in S3, reference via S3 keys in DynamoDB awards table.

---

## Storage Architecture

### DynamoDB: Awards Table
- **Stores**: Award metadata and summary data (~8-9KB per award)
- **References**: S3 keys for transactions and subawards
- **Size**: Small, queryable, fits well in DynamoDB

### S3: Award Details (Transactions + Subawards)
- **Stores**: Combined transactions and subawards in a single file (100KB-2MB+ per award)
- **Format**: JSON object with nested arrays, gzipped
- **Structure**: One file per award containing both transactions and subawards

---

## S3 Bucket Structure

```
s3://cosine-usaspending-data-{environment}/
  ├── award-details/
  │   ├── CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-.json.gz
  │   ├── CONT_AWD_89233018CNR000004_8900_-NONE-_-NONE-.json.gz
  │   └── ...
  └── search-results/
      └── {job_id}.json
```

**File Structure** (inside each gzipped JSON):
```json
{
  "transactions": [
    { "id": "...", "award_id": "...", ... },
    ...
  ],
  "subawards": [
    { "id": "...", "prime_award_id": "...", ... },
    ...
  ],
  "indexed_at": "2025-12-01T00:00:00Z",
  "transaction_count": 229,
  "subaward_count": 7065
}
```

---

## DynamoDB Awards Table Schema (Updated)

```python
{
    "award_id": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
    
    # ... all existing award fields ...
    
    # S3 Reference (single file containing both transactions and subawards)
    "award_details_s3_key": "award-details/CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-.json.gz",
    
    # Flags
    "award_details_indexed": true,  # Combined flag for transactions + subawards
    "full_indexing_complete": true,
    
    # Counts (for UI display without fetching S3)
    "transaction_count": 229,
    "subaward_count": 7065
}
```

---

## Indexing Process

### Step 1: Index Award
1. Fetch award details from `/api/v2/awards/<AWARD_ID>/`
2. Store in DynamoDB `usaspending-awards-index`
3. Set `award_details_indexed: false`

### Step 2: Index Transactions and Subawards (Combined)
1. **Fetch Transactions**:
   - Call `/api/v2/transactions/` (POST with `award_id`)
   - Collect all transactions (paginate if needed)
   
2. **Fetch Subawards**:
   - Call `/api/v2/subawards/` (POST with `award_id`)
   - Collect all subawards (paginate if needed)
   
3. **Build Combined JSON Object**:
   ```json
   {
     "transactions": [...],
     "subawards": [...],
     "indexed_at": "2025-12-01T00:00:00Z",
     "transaction_count": 229,
     "subaward_count": 7065
   }
   ```
   
4. **Gzip and Upload to S3**:
   - Gzip the JSON
   - Upload to S3: `award-details/{award_id}.json.gz`
   
5. **Update DynamoDB Award Record**:
   - Set `award_details_s3_key`
   - Set `award_details_indexed: true`
   - Set `transaction_count`
   - Set `subaward_count`

### Step 3: Mark Complete
1. Set `full_indexing_complete: true` in DynamoDB

---

## Retrieval Process

### Get Transactions for Award

**Endpoint**: `GET /usaspending-award/<AWARD_ID>/transactions`

**Lambda Function Flow**:
```python
def get_award_transactions(award_id: str):
    # 1. Get award from DynamoDB
    award = dynamodb.get_item(
        TableName='usaspending-awards-index',
        Key={'award_id': award_id}
    )
    
    # 2. Check if award details are indexed
    if not award.get('award_details_indexed'):
        # Trigger indexing (async) or return empty
        return {"transactions": [], "indexing": True}
    
    # 3. Get S3 key from award record (single file containing both)
    s3_key = award['award_details_s3_key']
    
    # 4. Fetch from S3
    s3_object = s3.get_object(
        Bucket='cosine-usaspending-data-production',
        Key=s3_key
    )
    
    # 5. Decompress and parse combined file
    details_json = gzip.decompress(s3_object['Body'].read())
    details = json.loads(details_json)
    
    # 6. Extract transactions array from combined object
    transactions = details.get('transactions', [])
    
    # 7. Return transactions
    return {
        "transactions": transactions,
        "total": len(transactions),
        "s3_key": s3_key
    }
```

### Get Subawards for Award

**Endpoint**: `GET /usaspending-award/<AWARD_ID>/subawards`

**Flow**: Same as transactions, but:
- Check `award_details_s3_key` (same file as transactions)
- Fetch same combined file from S3
- Extract `subawards` array from combined object

### Get Full Award (Award + Transactions + Subawards)

**Endpoint**: `GET /usaspending-award/<AWARD_ID>/full`

**Lambda Function Flow**:
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
    details_json = gzip.decompress(s3_object['Body'].read())
    details = json.loads(details_json)
    
    # 5. Extract both arrays from combined object
    transactions = details.get('transactions', [])
    subawards = details.get('subawards', [])
    
    # 6. Return combined payload
    return {
        "award": award,
        "transactions": transactions,
        "subawards": subawards,
        "transaction_count": len(transactions),
        "subaward_count": len(subawards)
    }
```

---

## Performance Considerations

### S3 Fetch Performance
- **Cold**: ~100-200ms (first fetch, no cache)
- **Warm**: ~50-100ms (CloudFront/CDN cached)
- **Gzip Decompression**: ~10-50ms (depending on file size)
- **JSON Parsing**: ~20-100ms (depending on array size)

**Total**: ~80-350ms for typical fetch

### Optimization Strategies

1. **CloudFront CDN**: Cache S3 files at edge locations
   - Reduces latency for frequently accessed awards
   - TTL: 24 hours

2. **Parallel Fetching**: Fetch transactions and subawards in parallel
   - Reduces total time for `/full` endpoint

3. **Pagination**: For very large arrays, support pagination
   - Frontend requests: `?page=1&limit=100`
   - Lambda parses JSON, returns slice

4. **Caching**: Cache parsed results in Lambda memory (short TTL)
   - For repeated requests within same Lambda execution

---

## Cost Analysis

### Storage Costs (S3)

**Example**: 5 awards with average sizes:
- Transactions: ~200KB per award (gzipped: ~50KB)
- Subawards: ~1MB per award (gzipped: ~250KB)
- **Total per award**: ~300KB (gzipped)

**For 10,000 awards**:
- Storage: ~3GB (gzipped)
- S3 Standard: ~$0.07/month
- S3 Intelligent-Tiering: ~$0.02-0.07/month (auto-optimizes)

### Request Costs

- **GET requests**: $0.0004 per 1,000 requests
- **Data transfer out**: $0.09 per GB (first 10TB)

**For 100,000 transaction fetches/month**:
- GET requests: ~$0.04/month
- Data transfer: ~$0.27/month (assuming 3MB average)
- **Total**: ~$0.31/month

**Much cheaper than DynamoDB** for large data!

---

## Error Handling

### S3 File Not Found
- Check if `transactions_indexed` or `subawards_indexed` is true
- If true but file missing: Trigger re-indexing
- Return empty array with `indexing: true` flag

### Corrupted File
- Try to parse, catch JSON errors
- If corrupted: Delete S3 file, trigger re-indexing
- Return error to user

### Partial Indexing
- Award indexed but transactions not yet indexed
- Return award with `transactions_indexed: false`
- Frontend can show "Indexing transactions..." message

---

## Lambda Function Structure

### Separate Lambda: `usaspending-fetch-details`

**Purpose**: Fetch and build full award payloads from S3

**Endpoints**:
- `GET /usaspending-award/<AWARD_ID>/transactions`
- `GET /usaspending-award/<AWARD_ID>/subawards`
- `GET /usaspending-award/<AWARD_ID>/full`

**Responsibilities**:
1. Query DynamoDB for award
2. Check S3 keys
3. Fetch from S3 (with retry logic)
4. Decompress gzip
5. Parse JSON
6. Optionally paginate/filter
7. Return formatted response

**Benefits of Separate Lambda**:
- ✅ Dedicated function for S3 operations
- ✅ Can optimize for S3 fetching
- ✅ Independent scaling
- ✅ Can cache parsed results in memory
- ✅ Easier to monitor and debug

---

## Frontend Integration

### Award Details Page

```typescript
// Fetch award summary (from DynamoDB)
const award = await fetch(`/usaspending-award/${awardId}`);

// Fetch transactions on-demand (when user clicks "View Transactions")
const transactions = await fetch(`/usaspending-award/${awardId}/transactions`);

// Fetch subawards on-demand (when user clicks "View Subawards")
const subawards = await fetch(`/usaspending-award/${awardId}/subawards`);

// Or fetch everything at once
const fullAward = await fetch(`/usaspending-award/${awardId}/full`);
```

### Loading States
- Show award immediately (from DynamoDB)
- Show "Loading transactions..." when fetching from S3
- Show "Loading subawards..." when fetching from S3
- Handle partial indexing (show "Indexing in progress...")

---

## Migration Strategy

### Existing Data
If we already have transactions/subawards in DynamoDB:
1. Export from DynamoDB
2. Group by `award_id`
3. Upload to S3 as JSON files
4. Update awards table with S3 keys
5. Delete from DynamoDB (optional, or keep for backup)

### New Data
- All new indexing goes directly to S3
- No DynamoDB transactions/subawards tables needed

---

## Summary

✅ **Awards in DynamoDB**: Small, queryable, fast lookups
✅ **Transactions in S3**: Large arrays, on-demand fetching
✅ **Subawards in S3**: Large arrays, on-demand fetching
✅ **Separate Lambda**: Dedicated function for S3 fetching and payload building
✅ **Cost Effective**: S3 storage is much cheaper than DynamoDB for large data
✅ **Scalable**: No size limits, can handle awards with 10,000+ transactions/subawards

**Best of both worlds**: Fast queries (DynamoDB) + Large data storage (S3)

