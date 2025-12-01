# USAspending Indexing Lambda

This Lambda function handles indexing of awards, transactions, and subawards from the USAspending API.

## Location
`backend_app/src/govt_contracts/indexing/lambda_function.py`

## API Endpoint
`POST /usaspending-indexing`

## Functionality

### Single Award Indexing
- Fetches award details from `/api/v2/awards/<AWARD_ID>/`
- Stores flattened award data in DynamoDB (`usaspending-awards-index`)
- Fetches all transactions (paginated) from `/api/v2/transactions/`
- Fetches all subawards (paginated) from `/api/v2/subawards/`
- Combines transactions and subawards into a single JSON object
- Gzips and uploads to S3 at `{award_id}/details.json.gz`
- Updates DynamoDB with S3 key and completion flags

### Multiple Award Indexing
- Processes multiple awards in sequence
- Returns summary of successful/failed/skipped counts

## S3 Storage Structure

Files are stored using the award_id (primary key) as the path:
```
s3://cosine-usaspending-data-{environment}/
  ├── {award_id_1}/
  │   └── details.json.gz
  ├── {award_id_2}/
  │   └── details.json.gz
  └── ...
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

## API Usage

### Request Format

**Single Award Indexing:**
```json
{
  "action": "index_award",
  "award_id": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
  "force_reindex": false
}
```

**Multiple Award Indexing:**
```json
{
  "action": "index_multiple",
  "award_ids": [
    "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
    "CONT_AWD_89233018CNR000004_8900_-NONE-_-NONE-"
  ],
  "force_reindex": false
}
```

**Search and Index (Recommended):**
```json
{
  "action": "search_and_index",
  "filters": {
    // General search fields
    "recipient_search_text": ["Lockheed Martin"],
    "keywords": ["defense", "software"],
    "description": ["research"],
    "award_amounts": [{"lower_bound": 1000000, "upper_bound": 10000000}],
    "time_period": [{"start_date": "2020-01-01", "end_date": "2023-12-31", "date_type": "action_date"}],
    "award_type_codes": ["A", "B", "C", "D"],
    
    // Agency filters
    "awarding_agency_code": "020",
    "awarding_agency_name": "Department of Defense",
    "funding_agency_code": "020",
    
    // Location filters
    "place_of_performance_locations": [{"country": "USA", "state": "CA"}],
    "recipient_locations": [{"country": "USA", "state": "VA"}],
    
    // Reference codes
    "naics_codes": ["541715"],
    "psc_codes": ["D302"],
    "program_numbers": ["12.345"],
    "cfda_number": "12.345",
    
    // Advanced filters
    "tas_codes": ["020-1234"],
    "program_activities": ["123456"],
    "contract_pricing_type_codes": ["1"],
    "set_aside_type_codes": ["A"],
    "extent_competed_type_codes": ["A"],
    "recipient_type_names": ["Small Business"],
    "recipient_scope": "domestic",
    "place_of_performance_scope": "domestic",
    "def_codes": ["A", "B"],
    "award_ids": ["CONT_AWD_123"],
    "award_unique_id": "CONT_AWD_123",
    
    // GSI fields (for DynamoDB queries)
    "fiscal_year": 2023,
    "recipient_id": "abc123",
    "recipient_name_normalized": "lockheed martin",
    "awarding_agency_code": "020",
    "naics_code": "541715",
    "psc_code": "D302",
    "cfda_number": "12.345",
    "recipient_location_state": "CA",
    "award_type": "contract"
  },
  "limit": 100,
  "force_reindex": false
}
```

### Response Format

**Single Award:**
```json
{
  "success": true,
  "award_id": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
  "s3_key": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-/details.json.gz",
  "transaction_count": 229,
  "subaward_count": 7065,
  "message": "Award indexed successfully"
}
```

**Multiple Awards:**
```json
{
  "total": 2,
  "successful": 2,
  "failed": 0,
  "skipped": 0,
  "results": [
    {
      "success": true,
      "award_id": "...",
      "s3_key": "...",
      "transaction_count": 229,
      "subaward_count": 7065
    },
    ...
  ]
}
```

**Search and Index:**
```json
{
  "search_results": {
    "total_found": 50,
    "award_ids": ["CONT_AWD_123", "CONT_AWD_456", ...]
  },
  "indexing_results": {
    "total": 50,
    "successful": 48,
    "failed": 1,
    "skipped": 1,
    "results": [
      {
        "success": true,
        "award_id": "CONT_AWD_123",
        "s3_key": "CONT_AWD_123/details.json.gz",
        "transaction_count": 229,
        "subaward_count": 7065
      },
      ...
    ]
  }
}
```

## Indexing Process

1. **Check Existing**: If award already exists and `full_indexing_complete == true`, skip (unless `force_reindex=true`)
2. **Fetch Award**: Call `/api/v2/awards/<AWARD_ID>/` to get full award details
3. **Flatten Data**: Extract key fields for DynamoDB indexing (recipient, agency, codes, etc.)
4. **Store Award**: Save flattened award to DynamoDB with `full_indexing_complete: false`
5. **Fetch Transactions**: Paginate through `/api/v2/transactions/` to get all transactions
6. **Fetch Subawards**: Paginate through `/api/v2/subawards/` to get all subawards
7. **Combine & Upload**: Create combined JSON, gzip, upload to S3
8. **Update DynamoDB**: Set `award_details_s3_key`, `award_details_indexed: true`, `full_indexing_complete: true`, and counts

## Data Flattening

The Lambda extracts and flattens the following fields for DynamoDB indexing:

- **Core**: `award_id`, `award_type`, `total_obligation`, `period_start_date`, `period_end_date`, `fiscal_year`, `description`
- **Agency**: `awarding_agency_id`, `awarding_agency_code`, `awarding_agency_name`, `funding_agency_id`, `funding_agency_code`, `funding_agency_name`
- **Recipient**: `recipient_id`, `recipient_name`, `recipient_name_normalized`, `recipient_unique_id`, `recipient_location_state`, `recipient_location_country`
- **Reference Codes**: `naics_code`, `naics_description`, `psc_code`, `psc_description`, `cfda_number`, `def_codes`
- **Full Response**: Complete award object stored in `full_response` attribute

## Environment Variables

- `USASPENDING_BASE_URL` - Base URL for USAspending API (default: `https://api.usaspending.gov`)
- `USASPENDING_USER_AGENT` - User agent string for API requests
- `REQUEST_TIMEOUT` - Request timeout in seconds (default: 30)
- `AWARDS_TABLE_NAME` - DynamoDB table name (default: `usaspending-awards-index`)
- `S3_BUCKET_NAME` - S3 bucket name (default: `cosine-usaspending-data-{environment}`)

## Error Handling

- **Award Not Found**: Returns `success: false` with error message
- **API Errors**: Logs error and returns failure response
- **S3 Upload Errors**: Logs error and raises exception
- **DynamoDB Errors**: Logs error and raises exception

## Performance Considerations

- **Timeout**: 15 minutes (900 seconds) for large indexing operations
- **Memory**: 1024 MB for processing large transactions/subawards arrays
- **Pagination**: Fetches transactions and subawards in batches of 100
- **Parallel Fetching**: Transactions and subawards could be fetched in parallel (future optimization)

## Primary Key Check

Before indexing, the Lambda checks if the award already exists in DynamoDB:
- If `full_indexing_complete == true`: Skip indexing (unless `force_reindex=true`)
- If not exists or incomplete: Proceed with full indexing

## Supported Filter Fields

The `search_and_index` action accepts all searchable fields from the USAspending API, plus GSI fields for DynamoDB queries:

### General Search Fields
- `recipient_search_text` (array or string)
- `keywords` (array or string)
- `description` (array or string)
- `award_amounts` (array of objects with `lower_bound`, `upper_bound`)
- `time_period` (array of objects with `start_date`, `end_date`, `date_type`)
- `award_type_codes` (array or string: "A", "B", "C", "D", etc.)
- `agencies` (array of objects with `type`, `tier`, `name`/`toptier_code`)
- `place_of_performance_locations` (array of location objects)
- `recipient_locations` (array of location objects)

### Reference Codes
- `naics_codes` (array or string)
- `psc_codes` (array or string)
- `program_numbers` (array or string)
- `cfda_number` (string)

### Advanced Filters
- `tas_codes` (array or string)
- `treasury_account_components` (array of objects)
- `program_activities` (array or string)
- `contract_pricing_type_codes` (array or string)
- `set_aside_type_codes` (array or string)
- `extent_competed_type_codes` (array or string)
- `recipient_type_names` (array or string)
- `recipient_scope` (string: "domestic", "foreign")
- `place_of_performance_scope` (string: "domestic", "foreign")
- `def_codes` (array or string)
- `award_ids` (array or string)
- `award_unique_id` (string)

### GSI Fields (for DynamoDB queries)
- `fiscal_year` (number or array) - Converts to time_period if not provided
- `recipient_id` (string)
- `recipient_name_normalized` (string)
- `awarding_agency_code` (string)
- `funding_agency_code` (string)
- `naics_code` (string)
- `psc_code` (string)
- `cfda_number` (string)
- `recipient_location_state` (string)
- `award_type` (string: "contract", "idv", "financial_assistance")

### Convenience Fields
- `min_obligation` / `max_obligation` - Automatically converted to `award_amounts`
- `date_from` / `date_to` - Automatically converted to `time_period`
- `awarding_agency_name` / `funding_agency_name` - Automatically converted to `agencies`

This prevents duplicate indexing and enables incremental updates.

