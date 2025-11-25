# SEC Search Query Cache Implementation

## Overview

This document describes the implementation of a query cache system for SEC search to avoid re-running identical searches and speed up response times.

## Architecture

### Components

1. **DynamoDB Query Cache Table** (`sec-search-query-cache`)
   - Primary Key: `queryHash` (SHA256 hash of normalized search parameters)
   - GSI: `JobIdIndex` (for looking up by job_id)
   - TTL: 30 days
   - Stores: job_id, results_s3_key, search_params (normalized), total_found, results_count

2. **Query Cache Helper Module** (`query_cache.py`)
   - `normalize_search_params()`: Removes fields that shouldn't affect cache (reportingFor, incorporated, fileNumber, filmNumber)
   - `generate_query_hash()`: Creates SHA256 hash of normalized parameters
   - `get_cached_query_with_validation()`: Retrieves cache and validates S3 key exists
   - `store_cached_query()`: Stores new cache entry
   - `update_cached_query_results()`: Updates cache with results information

3. **Lambda Integration**
   - `handle_search()`: Checks cache before creating new jobs
   - `process_async_search()`: Updates cache when job completes

## Query Normalization

### Fields Included in Cache Key
- `cik`: Company CIK
- `entityName`: Company/entity name
- `keywords`: Search keywords
- `formTypes`: Form type filters (sorted)
- `dateFrom`: Start date
- `dateTo`: End date
- `located`: Location filter
- `columns`: Column selection (sorted)

### Fields Excluded from Cache Key
- `reportingFor`: Not used for cache matching
- `incorporated`: Not used for cache matching
- `fileNumber`: Not used for cache matching
- `filmNumber`: Not used for cache matching

## Flow

### Cache Hit Flow
```
User Request → Lambda → Check Query Cache → Cache Hit → Return existing job_id → Frontend polls status → Get results from S3
```

### Cache Miss Flow
```
User Request → Lambda → Check Query Cache → Cache Miss → Create new job → Process search → Store results in S3 → Update cache → Return job_id
```

### Stale Cache Handling
If cache exists but S3 key is missing:
- Cache is considered stale
- New job is created
- Cache is updated with new job_id and S3 key

## Implementation Status

### ✅ Completed
- [x] DynamoDB table created in base_infra
- [x] Query cache helper module (`query_cache.py`)
- [x] Lambda integration for cache checking
- [x] Lambda integration for cache updates

### 🔄 In Progress
- [ ] API endpoint to fetch results from S3
- [ ] Frontend integration to fetch from S3
- [ ] Remove excluded fields from frontend UI
- [ ] Terraform updates for Lambda environment variables and IAM policies

## Next Steps

1. Add `/sec-search-results` endpoint to fetch results from S3
2. Update frontend to call S3 fetch endpoint when `results_s3_key` exists
3. Remove `reportingFor`, `incorporated`, `fileNumber`, `filmNumber` from advanced query settings UI
4. Update Terraform to:
   - Add `SEC_SEARCH_QUERY_CACHE_TABLE` environment variable
   - Add query cache table IAM policy to Lambda

## Benefits

1. **Faster Response Times**: Cached queries return immediately with existing job_id
2. **Reduced SEC API Load**: Identical queries don't hit SEC API
3. **Cost Savings**: Fewer Lambda invocations and DynamoDB operations
4. **Better User Experience**: Instant results for repeated searches

