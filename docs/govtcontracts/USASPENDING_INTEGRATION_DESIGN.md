# USAspending API Integration Design

## Overview

This document outlines the design for integrating the USAspending API into Cosine2.0, mirroring the architecture of the SEC search system. The system will index actual contract/award data (not autocomplete endpoints) and provide search, filtering, and retrieval capabilities.

## Architecture Overview

The USAspending integration follows the same pattern as the SEC system:

1. **Lambda Function**: Handles API calls, data processing, and caching
2. **DynamoDB Tables**: Store indexed award/contract data and query cache
3. **S3 Bucket**: Store large response payloads and bulk data
4. **API Gateway**: Expose endpoints to frontend
5. **Frontend Integration**: Search tile and page components

---

## 1. Data to Index (What We Store)

### Primary Data Sources (Index These)

Based on the analysis, we should index **actual award/contract data**, not helper endpoints:

#### 1.1 Award Details (Primary)
- **Endpoint**: `/api/v2/awards/<AWARD_ID>/`
- **Why**: This is the core data - individual contracts, IDVs, and financial assistance awards
- **Data Structure**: Varies by award type (Contract, IDV, FinancialAssistance)
- **Key Fields**:
  - `award_id` (primary key)
  - `award_type` (contract, idv, financial_assistance)
  - `total_obligation`
  - `period_of_performance_start_date`
  - `period_of_performance_current_end_date`
  - `awarding_agency` (nested object)
  - `recipient` (nested object)
  - `funding_agency` (nested object)
  - `description`
  - `subaward_count`
  - `transaction_count`

#### 1.2 Transaction Details
- **Endpoint**: `/api/v2/transactions/` (POST with filters)
- **Why**: Individual transactions that make up awards
- **Key Fields**:
  - `transaction_id`
  - `award_id` (foreign key)
  - `action_date`
  - `action_type`
  - `federal_action_obligation`
  - `awarding_agency`
  - `recipient`

#### 1.3 Subaward Details
- **Endpoint**: `/api/v2/subawards/` (POST with filters)
- **Why**: Subcontracts under prime awards
- **Key Fields**:
  - `subaward_id`
  - `prime_award_id` (foreign key)
  - `subaward_number`
  - `subaward_amount`
  - `subawardee_name`
  - `subawardee_location`

### Helper Endpoints (Do NOT Index - Fetch On-Demand)

These are used for autocomplete, filtering, and UI helpers:

- `/api/v2/autocomplete/*` - All autocomplete endpoints
- `/api/v2/references/*` - Reference data (agencies, NAICS, PSC codes)
- `/api/v2/agency/*` - Agency overview/summary (used for filtering)
- `/api/v2/recipient/*` - Recipient overview (used for filtering)
- `/api/v2/search/spending_by_*` - Search/aggregation endpoints (results computed on-demand)

### Bulk Download & Download Endpoints (Callable - Do NOT Index)

These endpoints generate downloadable files (CSV, ZIP) asynchronously. They should be fully supported as callable functionality:

#### Bulk Download Endpoints:
- `/api/v2/bulk_download/awards/` - Generate ZIP file of award data (CSV)
- `/api/v2/bulk_download/list_agencies/` - List available agencies for bulk download
- `/api/v2/bulk_download/list_monthly_files/` - List monthly pre-generated files
- `/api/v2/bulk_download/status/` - Check status of bulk download job

#### Download Endpoints:
- `/api/v2/download/accounts/` - Account data CSV download
- `/api/v2/download/assistance/` - Assistance data ZIP download
- `/api/v2/download/awards/` - Award data CSV download
- `/api/v2/download/contract/` - Contract data ZIP download
- `/api/v2/download/count/` - Transaction count (not a file)
- `/api/v2/download/disaster/` - Disaster data ZIP download
- `/api/v2/download/disaster/recipients/` - Disaster recipient data ZIP download
- `/api/v2/download/idv/` - IDV data ZIP download
- `/api/v2/download/transactions/` - Transaction data CSV download
- `/api/v2/download/status/` - Check status of download job

**Note**: These endpoints return job metadata (status_url, file_name, file_url) and generate files asynchronously. We should:
1. Support initiating downloads
2. Track download jobs in DynamoDB
3. Poll status endpoints
4. Proxy file downloads or provide direct links
5. Store download history for users

---

## 2. DynamoDB Table Design

### 2.1 Primary Table: `usaspending-awards-index`

**Purpose**: Store indexed award/contract data

**Primary Key Structure**:
- **Hash Key**: `award_id` (e.g., `CONT_AWD_H907_9700_SPE2DX16D1500_9700`)
- **Sort Key**: None (single item per award)

**Attributes**:
```python
{
    "award_id": "CONT_AWD_H907_9700_SPE2DX16D1500_9700",  # Primary key (unique per contract)
    "award_type": "contract" | "idv" | "financial_assistance",
    
    # Core award data (flattened for indexing)
    "total_obligation": Decimal,
    "period_start_date": "YYYY-MM-DD",
    "period_end_date": "YYYY-MM-DD",
    "fiscal_year": number,
    "description": string,
    
    # Agency information (flattened)
    "awarding_agency_id": number,
    "awarding_agency_code": string,
    "awarding_agency_name": string,
    "funding_agency_id": number,
    "funding_agency_code": string,
    "funding_agency_name": string,
    
    # Recipient information (flattened)
    "recipient_id": string,
    "recipient_name": string,
    "recipient_unique_id": string,  # DUNS or other ID
    "recipient_location_state": string,
    "recipient_location_country": string,
    
    # Reference codes (for GSI indexing)
    "naics_code": string,  # Primary NAICS code
    "naics_description": string,
    "psc_code": string,  # Primary PSC code
    "psc_description": string,
    "cfda_number": string,  # For financial assistance
    "def_codes": array[string],  # Disaster/Emergency codes
    
    # Counts
    "subaward_count": number,
    "transaction_count": number,
    
    # Full response data (stored as JSON)
    "full_response": {
        # Complete award object from API
    },
    
    # S3 Reference (single file containing both transactions and subawards)
    "award_details_s3_key": string,  # S3 key for combined details file (e.g., "award-details/{award_id}.json.gz")
    "award_details_indexed": boolean,  # Flag indicating if transactions and subawards are indexed
    "full_indexing_complete": boolean,  # Flag indicating complete indexing
    
    # Metadata
    "indexed_at": ISO8601 timestamp,
    "last_updated": ISO8601 timestamp,
    "data_source": "usaspending_api",
    "api_version": "v2",
    
    # TTL for cache expiration (30 days, refreshable)
    "ttl": Unix timestamp
}
```

**Global Secondary Indexes (GSIs)**:

1. **RecipientFiscalYearIndex** ⭐ (Primary for recipient searches)
   - Hash Key: `recipient_id`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: "Show all contracts for firm X" - Fast lookup by recipient

2. **AwardTypeFiscalYearIndex**
   - Hash Key: `award_type`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by award type and fiscal year

3. **AwardingAgencyFiscalYearIndex**
   - Hash Key: `awarding_agency_code`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by awarding agency

4. **RecipientNameFiscalYearIndex**
   - Hash Key: `recipient_name` (normalized, lowercase)
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Search by recipient name (fallback if recipient_id unknown)

5. **StateFiscalYearIndex**
   - Hash Key: `recipient_location_state`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by state

6. **NAICSCodeFiscalYearIndex** ⭐ (Reference code indexing)
   - Hash Key: `naics_code`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by industry/NAICS code

7. **PSCCodeFiscalYearIndex** ⭐ (Reference code indexing)
   - Hash Key: `psc_code`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by product/service code

8. **CFDANumberFiscalYearIndex** ⭐ (Reference code indexing)
   - Hash Key: `cfda_number`
   - Sort Key: `fiscal_year`
   - Projection: ALL
   - Use Case: Filter by CFDA program (financial assistance)

9. **PeriodStartDateIndex**
   - Hash Key: `award_id`
   - Sort Key: `period_start_date`
   - Projection: ALL
   - Use Case: Date range queries

### 2.2 Award Details Storage: S3 (NOT DynamoDB)

**Rationale**: DynamoDB has a 400KB item size limit. Large awards can have:
- 200-900+ transactions (100-500KB)
- 2,000-7,000+ subawards (600KB-2MB+)
- Combined size: 700KB-2.2MB+ (exceeds DynamoDB limit)

**Solution**: Store transactions and subawards in a **single combined S3 file** per award, reference via S3 key in awards table.

**S3 Structure**:
```
s3://cosine-usaspending-data-{env}/
  └── award-details/
      └── {award_id}.json.gz  # Combined file with transactions and subawards
```

**File Format** (inside gzipped JSON):
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

**Benefits**:
- ✅ **Single S3 fetch** instead of two (faster, cheaper)
- ✅ **Atomic updates** (transactions and subawards always in sync)
- ✅ **Simpler architecture** (one S3 key instead of two)
- ✅ **Better caching** (one file to cache instead of two)
- ✅ No size limits (S3 supports files up to 5TB)
- ✅ Cost-effective (S3 storage is cheaper than DynamoDB)
- ✅ On-demand fetching (only when user requests transaction/subaward history)

### 2.3 Download Jobs Table: `usaspending-download-jobs`

**Purpose**: Track bulk download and download job requests

**Primary Key Structure**:
- **Hash Key**: `job_id` (UUID generated by our system)
- **Sort Key**: None

**Attributes**:
```python
{
    "job_id": string,  # Primary key (our generated UUID)
    "usaspending_file_name": string,  # File name from USAspending API
    "usaspending_status_url": string,  # Status URL from USAspending API
    "usaspending_file_url": string,  # File URL when ready (from USAspending API)
    
    # Job metadata
    "download_type": "bulk_download" | "download",
    "endpoint": string,  # e.g., "/api/v2/bulk_download/awards/"
    "request_params": {
        # Original request parameters
    },
    
    # Status tracking
    "status": "pending" | "processing" | "ready" | "failed" | "expired",
    "usaspending_status": string,  # Status from USAspending API
    
    # User tracking
    "user_id": string,  # User who initiated download
    "session_id": string,  # Optional: session ID
    
    # Timestamps
    "created_at": ISO8601 timestamp,
    "updated_at": ISO8601 timestamp,
    "completed_at": ISO8601 timestamp,  # When file became ready
    "expires_at": ISO8601 timestamp,  # When file URL expires (usually 24-48 hours)
    
    # File metadata
    "file_size": number,  # Bytes (if available)
    "file_type": "csv" | "zip",
    
    # S3 storage (optional - if we want to cache files)
    "s3_key": string,  # Optional: if we download and store in S3
    "s3_bucket": string,
    
    # TTL for cleanup (90 days)
    "ttl": Unix timestamp
}
```

**Global Secondary Indexes (GSIs)**:

1. **UserIdCreatedAtIndex**
   - Hash Key: `user_id`
   - Sort Key: `created_at`
   - Projection: ALL
   - Use Case: List user's download history

2. **StatusCreatedAtIndex**
   - Hash Key: `status`
   - Sort Key: `created_at`
   - Projection: ALL
   - Use Case: Monitor pending/processing jobs

3. **DownloadTypeCreatedAtIndex**
   - Hash Key: `download_type`
   - Sort Key: `created_at`
   - Projection: ALL
   - Use Case: Track different download types

### 2.4 Query Cache Table: `usaspending-query-cache`

**Purpose**: Cache search queries and results (similar to SEC system)

**Primary Key Structure**:
- **Hash Key**: `query_hash` (SHA256 hash of normalized search params)

**Attributes**:
```python
{
    "query_hash": string,  # Primary key
    "job_id": string,  # For async searches
    "search_params": {
        # Normalized search parameters
    },
    "results_s3_key": string,  # S3 key where results are stored
    "total_found": number,
    "results_count": number,
    "job_status": "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED",
    "job_progress": {
        "current": number,           # Current item being processed
        "total": number,             # Total items to process
        "phase": string,             # "searching" | "indexing" | "complete"
        "message": string,           # Human-readable progress message
        "current_page": number,      # For paginated searches
        "total_pages": number,       # For paginated searches
        "results_count": number      # Number of results indexed so far
    },
    "created_at": ISO8601 timestamp,
    "updated_at": ISO8601 timestamp,
    "ttl": Unix timestamp  # 30 days
}
```

---

## 3. Lambda Function Architecture

### 3.1 Main Lambda: `usaspending-search-handler`

**Location**: `Cosine2.0/backend_app/src/usaspending_search/app/lambda_function.py`

**Responsibilities**:
1. Handle search requests from frontend
2. Check query cache for existing results
3. If cache miss, fetch from USAspending API using `/api/v2/search/spending_by_award/`
4. **Automatically index all awards from search results** that don't exist in DynamoDB
5. Return results from DynamoDB (cached + newly indexed)
6. Store search results in S3 and cache metadata in DynamoDB
7. Support async job processing for large searches with progress tracking
8. Show real-time progress via API polling (no SNS needed)

**API Endpoints** (via API Gateway):

1. **POST `/usaspending-search`**
   - Search awards/contracts with filters
   - **Automatically indexes any awards not in DynamoDB**
   - Returns: `{ job_id, status, message }` (async for large searches)
   - Request body:
     ```json
     {
       "award_type": ["contract", "idv", "financial_assistance"],
       "awarding_agency_code": ["020"],
       "recipient_id": "string",
       "recipient_name": "string",
       "fiscal_year": [2020, 2021, 2022],
       "date_from": "YYYY-MM-DD",
       "date_to": "YYYY-MM-DD",
       "min_obligation": number,
       "max_obligation": number,
       "keywords": ["keyword1", "keyword2"],
       "state": "CA",
       "limit": 100,
       "offset": 0
     }
     ```
   - **Behavior**:
     - Checks query cache first
     - If cache miss, calls USAspending search API
     - For each award in results: checks DynamoDB, fetches & indexes if missing
     - Returns results from DynamoDB (cached + newly indexed)

2. **GET `/usaspending-search-status?job_id=xxx`**
   - Check status of async search/indexing job
   - Returns: `{ status, progress: { current, total, phase }, total_found, results_count, message }`
   - **Progress phases**:
     - `"searching"` - Calling USAspending search API
     - `"indexing"` - Fetching and indexing awards from API
     - `"complete"` - All awards indexed, results ready
   - **Example response**:
     ```json
     {
       "status": "in_progress",
       "progress": {
         "current": 45,
         "total": 100,
         "phase": "indexing",
         "message": "Indexing award 45 of 100..."
       },
       "total_found": 100,
       "results_count": 0
     }
     ```

3. **GET `/usaspending-search-results?job_id=xxx`**
   - Fetch results from S3 (after job completes)
   - Returns: `{ results: [...], total_found, has_more }`

4. **POST `/usaspending-search-cancel`**
   - Cancel an in-progress search job

5. **GET `/usaspending-award/<AWARD_ID>`**
   - Fetch specific award by ID
   - Checks DynamoDB first, then API if not found
   - If not in DB or `full_indexing_complete == false`, triggers full indexing:
     - Award details
     - All transactions
     - All subawards
     - All reference codes
   - Returns award with embedded transaction/subaward counts

6. **GET `/usaspending-award/<AWARD_ID>/transactions`**
   - Get all transactions for an award
   - Queries `usaspending-transactions-index` by `award_id`
   - If not indexed, fetches from API and indexes

7. **GET `/usaspending-award/<AWARD_ID>/subawards`**
   - Get all subawards for an award
   - Queries `usaspending-subawards-index` by `prime_award_id`
   - If not indexed, fetches from API and indexes

6. **GET `/usaspending-autocomplete/<TYPE>`**
   - Proxy to USAspending autocomplete endpoints
   - Does NOT cache/index (helper endpoint)

7. **POST `/usaspending-bulk-download/awards`**
   - Initiate bulk download of awards
   - **Note**: This endpoint is called automatically by `/usaspending-download/<TYPE>` when bulk download criteria are met
   - Can also be called directly for explicit bulk downloads
   - Request body: Filter object with `agencies` (required), `date_range` (required), `date_type` (required)
   - Returns: `{ job_id, status_url, file_name, file_url, message }`
   - Creates entry in `usaspending-download-jobs` table

8. **POST `/usaspending-bulk-download/list-agencies`**
   - List available agencies for bulk download
   - Request body: `{ type: "award_agencies" | "assistance_agencies" }`
   - Returns: Agency list from USAspending API
   - Does NOT cache (helper endpoint)

9. **POST `/usaspending-bulk-download/list-monthly-files`**
   - List monthly pre-generated files
   - Request body: `{ fiscal_year, agency, type }`
   - Returns: Monthly file list from USAspending API
   - Does NOT cache (helper endpoint)

10. **GET `/usaspending-bulk-download/status?file_name=xxx`**
    - Check status of bulk download job
    - Returns: `{ status, file_url, file_name, message }`
    - Updates `usaspending-download-jobs` table

11. **POST `/usaspending-download/<TYPE>`**
    - Initiate download for specific data type
    - Types: `accounts`, `assistance`, `awards`, `contract`, `disaster`, `disaster/recipients`, `idv`, `transactions`
    - Request body: Filter object or award_id (depending on type)
    - **Auto-Detection Logic**: Automatically detects if request should use bulk download
      - **Bulk Download Criteria**: Only `agencies` and `time_period`/`date_range` are provided
      - **Regular Download Criteria**: Any other filters present (recipient, keywords, award_ids, etc.)
    - Returns: `{ job_id, status_url, file_name, file_url, message, download_type: "bulk_download" | "download" }`
    - Creates entry in `usaspending-download-jobs` table

12. **GET `/usaspending-download/status?file_name=xxx`**
    - Check status of download job
    - Returns: `{ status, file_url, file_name, message }`
    - Updates `usaspending-download-jobs` table

13. **GET `/usaspending-download/file?job_id=xxx`**
    - Proxy/download file from USAspending
    - Fetches file from `usaspending_file_url` in job record
    - Optional: Can download and cache in S3, then serve from S3
    - Returns: File stream or redirect to USAspending file URL

14. **GET `/usaspending-downloads/history`**
    - List user's download history
    - Query `usaspending-download-jobs` table by `user_id`
    - Returns: `{ downloads: [...], total }`

### 3.2 Async Job Processing with Progress Tracking (Hybrid: API Polling + SNS)

**Hybrid Approach** (API polling for status, SNS for async operations):
- Large searches are processed asynchronously
- **Progress tracked in query cache table** (updated in real-time)
- **SNS notifications** for major milestones in bulk indexing operations
- Frontend polls `/usaspending-search-status` every 1-2 seconds
- Results stored in S3 when complete
- Query cache stores job metadata and progress

**Job Processing Flow**:
1. User initiates search → Lambda creates job, returns `job_id`
2. Lambda invokes async worker (Step Functions or Lambda async invocation)
3. Worker processes awards in parallel (batches of 10-20):
   - Phase 1: "searching" - Calling USAspending search API
   - Phase 2: "getting_recipient" - Fetching recipient details
   - Phase 3: "indexing_awards" - Fetching and indexing award details
   - Phase 4: "indexing_transactions" - Fetching and indexing transactions
   - Phase 5: "indexing_subawards" - Fetching and indexing subawards
   - Phase 6: "complete" - All done
4. Worker updates progress in query cache after each batch
5. Worker sends SNS notifications for major milestones:
   - `award_indexed` - When an award is fully indexed
   - `batch_complete` - When a batch of awards is complete
   - `job_complete` - When entire job is complete
6. Frontend polls status endpoint → Gets real-time progress
7. When complete → Frontend fetches results from S3

**Progress Updates**:
```python
# In query cache table
{
  "queryHash": "...",
  "job_id": "uuid",
  "job_status": "IN_PROGRESS",
  "job_progress": {
    "current_award": 45,           # Current award being processed
    "total_awards": 100,           # Total awards to process
    "current_award_id": "CONT_AWD_123",  # Current award ID
    "phase": "indexing_transactions",     # Current phase
    "message": "Indexing transactions for award CONT_AWD_123 (45 of 100)...",
    "awards_indexed": 44,          # Awards fully indexed so far
    "transactions_indexed": 35,    # Awards with transactions indexed
    "subawards_indexed": 30        # Awards with subawards indexed
  },
  "updated_at": "2025-01-01T12:00:00Z"
}
```

**SNS Topic**: `usaspending-indexing-progress`
- **Subscribers**: Frontend WebSocket, CloudWatch Logs, Optional: Email/Slack
- **Message Format**:
  ```json
  {
    "job_id": "uuid",
    "event_type": "award_indexed" | "batch_complete" | "job_complete",
    "award_id": "CONT_AWD_123",
    "progress": {
      "current": 45,
      "total": 100,
      "phase": "indexing_transactions"
    },
    "timestamp": "2025-01-01T12:00:00Z"
  }
  ```

**Benefits of Hybrid Approach**:
- **API Polling**: Simple, direct, real-time updates (1-2 second latency)
- **SNS**: Enables WebSocket push notifications, better for long-running jobs
- **Flexible**: Can use either or both depending on use case
- **Scalable**: SNS handles fan-out to multiple subscribers

### 3.3 Combined Search & Indexing Strategy

**Unified Approach**: Search and indexing happen together automatically

**Search Flow**:
1. User performs search → Lambda receives search request
2. Check query cache for exact search match
3. If cache hit and results still valid → Return cached results from DynamoDB
4. If cache miss:
   a. Call USAspending `/api/v2/search/spending_by_award/` with filters
   b. For each award in results:
      - Check if `award_id` exists in `usaspending-awards-index` table
      - If exists → Use cached version (faster, no API call)
      - If not exists → Fetch full award details from `/api/v2/awards/<AWARD_ID>/` and index
   c. Store all results (cached + newly indexed) in query cache
   d. Return combined results

**Benefits**:
- **Automatic Indexing**: Every search builds the index organically
- **Fast Results**: Cached awards returned instantly from DynamoDB
- **Always Fresh**: New awards fetched and indexed on-demand
- **No Manual Steps**: Users don't need to trigger indexing separately
- **Progress Tracking**: Can show progress as awards are fetched/indexed

**Indexing Process** (for each new award):
1. Fetch full award from `/api/v2/awards/<AWARD_ID>/`
2. Flatten key fields for DynamoDB indexing
3. Store full response in `full_response` attribute
4. Write to DynamoDB with TTL (30 days, refreshable)
5. Update query cache with award reference

**Progress Tracking**:
- Job status stored in query cache: `{ current: 5, total: 100, status: "indexing" }`
- Frontend polls `/usaspending-search-status?job_id=xxx` every 1-2 seconds
- Lambda updates progress as awards are fetched/indexed
- Progress shows: "Indexing award 5 of 100..." or "Fetching award details..."
- No SNS needed - simple API polling is sufficient

---

## 4. API Gateway Configuration

**Base Path**: `/usaspending-*`

**Routes**:
- `/usaspending-search` → Lambda
- `/usaspending-search-status` → Lambda
- `/usaspending-search-results` → Lambda
- `/usaspending-search-cancel` → Lambda
- `/usaspending-award/{award_id}` → Lambda
- `/usaspending-autocomplete/{type}` → Lambda
- `/usaspending-bulk-download/awards` → Lambda
- `/usaspending-bulk-download/list-agencies` → Lambda
- `/usaspending-bulk-download/list-monthly-files` → Lambda
- `/usaspending-bulk-download/status` → Lambda
- `/usaspending-download/{type}` → Lambda (accounts, assistance, awards, contract, disaster, disaster/recipients, idv, transactions)
- `/usaspending-download/status` → Lambda
- `/usaspending-download/file` → Lambda
- `/usaspending-downloads/history` → Lambda

**CORS**: Enabled for frontend domain

---

## 5. S3 Bucket Configuration

**Bucket Name**: `cosine-usaspending-data-{environment}`

**Structure**:
```
s3://cosine-usaspending-data-production/
  ├── search-results/
  │   └── {job_id}.json
  ├── transactions/
  │   └── {award_id}.json  # All transactions for an award (gzipped)
  ├── subawards/
  │   └── {award_id}.json  # All subawards for an award (gzipped)
  ├── awards/
  │   └── {award_id}.json  # Optional: full award backups
  ├── downloads/
  │   ├── bulk-downloads/
  │   │   └── {job_id}.zip  # Optional: cached bulk download files
  │   └── downloads/
  │       └── {job_id}.{csv|zip}  # Optional: cached download files
  └── exports/
      └── {export_id}.csv  # For bulk exports
```

**Storage Strategy**:
- **Transactions**: One JSON file per award containing all transactions
- **Subawards**: One JSON file per award containing all subawards
- **Compression**: Files are gzipped to reduce storage costs
- **Lifecycle**: Keep for 90 days (same as award TTL), then archive to Glacier or delete

**Lifecycle Policy**:
- Delete search results after 30 days
- Keep award backups for 90 days
- Delete cached download files after 7 days (USAspending files expire in 24-48 hours, but we may cache for convenience)

---

## 6. Frontend Integration

### 6.1 Search Tile Component

**Location**: `Cosine2.0/frontend/react-app/src/components/tiles/USASpendingSearchTile.tsx`

**Features** (mirror SEC tile):
- Search form with filters:
  - Award type (contract, IDV, financial assistance)
  - Awarding agency (autocomplete)
  - Recipient (autocomplete)
  - Fiscal year (multi-select)
  - Date range (period of performance)
  - Obligation amount range
  - Keywords
  - State
- **Progress indicator** (when indexing):
  - Shows progress bar: "Indexing award X of Y..."
  - Updates in real-time via polling `/usaspending-search-status`
  - Shows current phase: "Searching..." → "Indexing..." → "Complete"
- Results table with columns:
  - Award ID
  - Award Type
  - Recipient Name
  - Awarding Agency
  - Total Obligation
  - Period Start/End
  - Fiscal Year
  - Actions (View Details, Add to Context)
- Pagination
- Column visibility controls
- Results per page selector
- Filter dialog (accordion-style)
- Remove tile button
- Settings (display options)

**Automatic Indexing**:
- When search returns results, any awards not in DynamoDB are automatically fetched and indexed
- Progress shown in real-time as awards are indexed
- Subsequent searches for same awards return instantly from DynamoDB

**State Management**:
- `searchParams`: Persisted to backend
- `filterSettings`: Persisted to backend
- `results`: Session-only (not persisted)
- `displayOptions`: Persisted to backend

### 6.2 Search Page Component

**Location**: `Cosine2.0/frontend/react-app/src/pages/USASpendingSearchPage.tsx`

**Features**:
- Full-page search interface
- Advanced filtering
- Export capabilities
- Context integration

### 6.3 API Service

**Location**: `Cosine2.0/frontend/react-app/src/services/usaspendingApi.ts`

**Methods**:
```typescript
// Search methods (with automatic indexing)
- searchAwards(params: SearchParams): Promise<SearchResponse>
  // Automatically indexes any awards not in DynamoDB
  // Returns results from DynamoDB (cached + newly indexed)
  
- getAwardById(awardId: string): Promise<Award>
  // Checks DynamoDB first, fetches & indexes if missing
  
- getSearchStatus(jobId: string): Promise<JobStatus>
  // Returns: { status, progress: { current, total, phase, message }, ... }
  // Progress phases: "searching" | "indexing" | "complete"
  
- getSearchResults(jobId: string): Promise<Award[]>
  // Returns indexed awards from DynamoDB
  
- cancelSearch(jobId: string): Promise<void>
- autocomplete(type: string, query: string): Promise<Suggestion[]>
```

---

## 7. AI Agent Integration

### 7.1 Tool Definition

**Location**: `Cosine2.0/backend_app/src/Chat/tools/usaspending_api.py`

**Tools**:
1. `search_usaspending_awards(params)` - Search awards/contracts (automatically indexes new awards)
2. `get_usaspending_award(award_id)` - Get specific award details (checks DynamoDB first, indexes if missing)
3. `get_usaspending_transactions(award_id)` - Get transactions for an award
4. `initiate_usaspending_bulk_download(filters)` - Initiate bulk download of awards
5. `initiate_usaspending_download(type, params)` - Initiate download of specific data type
6. `check_usaspending_download_status(file_name)` - Check status of download job

### 7.2 Context Item Type

**Type**: `usaspending_award`

**Data Structure**:
```typescript
{
  id: string,
  type: 'usaspending_award',
  title: string,  // e.g., "Contract - Lockheed Martin Corp"
  subtitle: string,  // e.g., "$50M • FY 2023 • Department of Defense"
  data: {
    // Full award object
  },
  timestamp: number
}
```

---

## 8. Implementation Phases

### Phase 1: Core Infrastructure
1. Create DynamoDB tables (Terraform)
   - `usaspending-awards-index`
   - `usaspending-transactions-index`
   - `usaspending-query-cache`
   - `usaspending-download-jobs`
2. Create S3 bucket (Terraform)
3. Create Lambda function skeleton
4. Create API Gateway routes
5. Basic award fetching and indexing

### Phase 2: Comprehensive Indexing
1. Implement full indexing process:
   - Award details indexing (store in DynamoDB)
   - Transactions + Subawards indexing (fetch from API, combine into single JSON object, store in S3 as gzipped JSON)
   - Reference code extraction (NAICS, PSC, CFDA, DEF codes)
   - Store single S3 key in award record (`award_details_s3_key`)
2. Implement S3 storage logic:
   - Build combined JSON object: `{ transactions: [...], subawards: [...] }`
   - Gzip compression for combined file
   - S3 key generation: `award-details/{award_id}.json.gz`
   - Error handling and retry logic
   - Parallel uploads for multiple awards
3. Implement S3 retrieval logic (in `usaspending-fetch-details` Lambda):
   - Fetch single combined file from S3, decompress, parse JSON
   - Extract `transactions` or `subawards` arrays from combined object
   - Pagination support for large arrays (slice arrays in memory)
   - Caching in Lambda memory (short TTL) - cache entire combined file
   - Error handling (file not found, corrupted, etc.)
4. Implement primary key existence check
5. Implement skip logic (if `full_indexing_complete == true`)
6. Implement progress tracking (query cache + SNS)
7. Implement recipient lookup and indexing

### Phase 3: Search Functionality
1. Implement search endpoint with recipient resolution
2. Implement query cache
3. Implement async job processing (Step Functions or Lambda async)
4. Implement S3 result storage
5. Basic frontend search tile with progress indicator

### Phase 3.5: Download Functionality
1. Implement bulk download auto-detection logic
   - Detect when only agency + time period are provided
   - Automatically route to bulk download endpoint
2. Implement bulk download endpoints
3. Implement download endpoints
4. Implement download job tracking
5. Implement status polling (both bulk and regular)
6. Implement file download/proxy
7. Frontend download UI components

### Phase 3: Advanced Features
1. Advanced filtering
2. Autocomplete integration
3. Transaction indexing
4. Subaward indexing
5. Full frontend integration

### Phase 4: AI Integration
1. Agent tools
2. Context item handling
3. Analysis capabilities

---

## 9. Key Differences from SEC System

1. **Data Structure**: USAspending has 3 award types (vs SEC's single filing structure)
2. **API Rate Limits**: USAspending may have different rate limits
3. **Pagination**: USAspending uses offset/limit (vs SEC's page-based)
4. **Filtering**: More complex filter combinations
5. **No Document Storage**: USAspending doesn't have downloadable documents like SEC filings

---

## 10. Comprehensive Indexing Implementation Details

### 10.1 Full Indexing Flow Example

**User searches**: "All contracts for Lockheed Martin"

1. **Recipient Resolution**:
   ```python
   # Call autocomplete or search to get recipient_id
   recipient_search = call_api("/api/v2/autocomplete/recipient/", {"search_text": "Lockheed Martin"})
   recipient_id = recipient_search["results"][0]["recipient_id"]
   
   # Get full recipient details
   recipient_details = call_api(f"/api/v2/recipient/{recipient_id}/")
   ```

2. **Get Contract Metadata**:
   ```python
   # Search for all awards for this recipient
   search_results = call_api("/api/v2/search/spending_by_award/", {
       "filters": {"recipient_id": recipient_id},
       "fields": ["Award ID", "generated_internal_id"],
       "limit": 100
   })
   award_ids = [result["Award ID"] for result in search_results["results"]]
   ```

3. **For Each Award** (process in batches of 10-20):
   ```python
   for award_id in award_ids:
       # Check if already fully indexed (PRIMARY KEY CHECK)
       existing_award = dynamodb.get_item(Key={"award_id": award_id})
       
       if existing_award and existing_award.get("full_indexing_complete") == True:
           # Skip - already indexed, use cached data
           continue
       
       # Full indexing process
       # 1. Fetch award details
       award_details = call_api(f"/api/v2/awards/{award_id}/")
       
       # 2. Extract reference codes
       naics_code = award_details.get("naics_hierarchy", {}).get("base_code", {}).get("code")
       psc_code = award_details.get("psc_hierarchy", {}).get("base_code", {}).get("code")
       cfda_number = award_details.get("cfda_info", [{}])[0].get("number") if award_details.get("category") == "financial_assistance" else None
       
       # 3. Store award
       dynamodb.put_item(Item={
           "award_id": award_id,
           "recipient_id": recipient_id,
           "naics_code": naics_code,
           "psc_code": psc_code,
           "cfda_number": cfda_number,
           "full_response": award_details,
           "full_indexing_complete": False,
           "transactions_indexed": False,
           "subawards_indexed": False,
           ...
       })
       
       # 4. Fetch and index transactions to S3
       all_transactions = []
       page = 1
       while True:
           response = call_api("/api/v2/transactions/", {
               "award_id": award_id,
               "page": page,
               "limit": 100
           })
           transactions = response.get("results", [])
           if not transactions:
               break
           all_transactions.extend(transactions)
           if not response.get("page_metadata", {}).get("hasNext"):
               break
           page += 1
       
       # 4b. Fetch subawards (in parallel with transactions if possible)
       all_subawards = []
       page = 1
       while True:
           response = call_api("/api/v2/subawards/", {
               "award_id": award_id,
               "page": page,
               "limit": 100
           })
           subawards = response.get("results", [])
           if not subawards:
               break
           all_subawards.extend(subawards)
           if not response.get("page_metadata", {}).get("hasNext"):
               break
           page += 1
       
       # 5. Build combined JSON object
       combined_data = {
           "transactions": all_transactions,
           "subawards": all_subawards,
           "indexed_at": datetime.utcnow().isoformat(),
           "transaction_count": len(all_transactions),
           "subaward_count": len(all_subawards)
       }
       
       # 6. Upload combined file to S3 as gzipped JSON
       combined_json = json.dumps(combined_data)
       combined_gzipped = gzip.compress(combined_json.encode())
       s3_key = f"award-details/{award_id}.json.gz"
       s3.put_object(
           Bucket="cosine-usaspending-data-production",
           Key=s3_key,
           Body=combined_gzipped,
           ContentType="application/json",
           ContentEncoding="gzip"
       )
       
       # 7. Update award with single S3 key
       dynamodb.update_item(
           Key={"award_id": award_id},
           UpdateExpression="SET award_details_s3_key = :key, award_details_indexed = :true, transaction_count = :tx_count, subaward_count = :sub_count, full_indexing_complete = :true",
           ExpressionAttributeValues={
               ":key": s3_key,
               ":true": True,
               ":tx_count": len(all_transactions),
               ":sub_count": len(all_subawards)
           }
       )
       
       # 6. Progress update
       update_progress(job_id, current_award=index, total_awards=len(award_ids))
       send_sns_notification("award_indexed", award_id, job_id)
   ```

### 10.2 Primary Key Strategy

**Primary Key**: `award_id` (unique per contract)
- Extracted from search metadata: `result["Award ID"]` or `result["generated_internal_id"]`
- Used for fast existence check: `dynamodb.get_item(Key={"award_id": award_id})`
- If exists AND `full_indexing_complete == true`, skip all indexing operations

**Benefits**:
- Fast lookup (single DynamoDB read)
- Prevents duplicate indexing
- Enables incremental updates (only index new awards)

### 10.3 Subsequent Search Flow

**On subsequent searches**:
1. Call top-level search API: `/api/v2/search/spending_by_award/`
2. Extract `award_id` from each result (metadata)
3. For each `award_id`:
   - Build primary key: `{"award_id": award_id}`
   - Check DynamoDB: `dynamodb.get_item(Key={"award_id": award_id})`
   - If exists AND `full_indexing_complete == true`:
     - Skip indexing, use cached data
   - If not exists OR `full_indexing_complete == false`:
     - Trigger full indexing process

## 11. Open Questions

1. **Rate Limiting**: What are USAspending API rate limits? Do we need throttling?
2. **Data Freshness**: How often should we refresh indexed data? (Currently 30 days TTL)
3. **Batch Size**: How many awards to fetch/index in parallel? (Recommend 10-20)
4. **Parallel Processing**: Use Step Functions, Lambda async invocation, or SQS?
5. **Export Format**: What format for bulk exports (CSV, JSON)?
6. **Search Performance**: How to optimize large result sets? (Pagination, batching)
7. **File Caching**: Should we cache download files in S3 or use direct links?
8. **Download Limits**: Should we limit number of concurrent downloads per user?
9. **File Size**: What's the maximum file size we should handle? (Some bulk downloads can be very large)
10. **Progress Polling Interval**: What's optimal? (Recommend 1-2 seconds for good UX)
11. **Index Refresh Strategy**: Should we refresh expired awards automatically or on-demand?
12. **SNS vs API Polling**: When to use SNS vs API polling? (Recommend: API polling for status, SNS for notifications)
13. **Recipient Indexing**: Should we index recipient details separately or fetch on-demand?
14. **Reference Code Extraction**: How to handle multiple NAICS/PSC codes per award? (Store primary or all?)
15. **Bulk Download Auto-Detection**: ✅ Implemented - Automatically detects when only agency + time period are provided
15. **Bulk Download Auto-Detection**: ✅ Implemented - Automatically detects when only agency + time period are provided

---

## 12. Next Steps

1. Review and approve this design
2. Create Terraform modules for DynamoDB tables (with all GSIs)
3. Create SNS topic for indexing progress
4. Implement Lambda function skeleton with full indexing logic
5. Implement primary key existence check and skip logic
6. Test comprehensive indexing (awards + transactions + subawards)
7. Build frontend search tile with progress indicator
8. Integrate with AI agent

