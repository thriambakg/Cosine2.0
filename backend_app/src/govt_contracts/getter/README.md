# USAspending Getter Lambda Function

## Overview
This Lambda function retrieves award details, transactions, and subawards from DynamoDB and S3. It fetches award metadata from DynamoDB and the combined transactions/subawards file from S3.

## Location
`backend_app/src/govt_contracts/getter/lambda_function.py`

## API Endpoint
`GET /usaspending-award`

## Request Parameters

### Query String Parameters
- `award_id` (required): The award ID to retrieve (e.g., `CONT_AWD_N0001917C0001_9700_-NONE-_-NONE-`)
- `include_transactions` (optional): Whether to include transactions in response (default: `true`)
- `include_subawards` (optional): Whether to include subawards in response (default: `true`)

## Example Request

```
GET /usaspending-award?award_id=CONT_AWD_N0001917C0001_9700_-NONE-_-NONE-&include_transactions=true&include_subawards=true
```

## Response Format

```json
{
  "success": true,
  "award_id": "CONT_AWD_N0001917C0001_9700_-NONE-_-NONE-",
  "award": {
    "award_id": "...",
    "award_type": "contract",
    "total_obligation": 1000000.0,
    "period_start_date": "2020-01-01",
    "period_end_date": "2023-12-31",
    "fiscal_year": 2023,
    "description": "Contract description",
    "awarding_agency": {
      "id": "...",
      "code": "020",
      "name": "Department of Defense"
    },
    "funding_agency": { ... },
    "recipient": { ... },
    "naics": { ... },
    "psc": { ... },
    "cfda_number": null,
    "def_codes": [],
    "full_response": { ... },
    "indexed_at": "2025-12-01T04:38:36.395671+00:00",
    "last_updated": "2025-12-01T04:38:36.395671+00:00"
  },
  "transactions": [
    {
      "id": "CONT_TX_...",
      "type": "C",
      "type_description": "DELIVERY ORDER",
      "action_date": "2025-08-08",
      "action_type": "B",
      "action_type_description": "SUPPLEMENTAL AGREEMENT FOR WORK WITHIN SCOPE",
      "modification_number": "P00023",
      "description": "...",
      "federal_action_obligation": 0.0,
      "face_value_loan_guarantee": 0.0,
      "original_loan_subsidy_cost": 0.0
    }
  ],
  "subawards": [],
  "metadata": {
    "transaction_count": 24,
    "subaward_count": 0,
    "award_details_indexed": true,
    "full_indexing_complete": true
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing award_id",
  "message": "Please provide award_id in path or request body"
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": "Award not found",
  "award_id": "CONT_AWD_123"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "..."
}
```

## Implementation Notes

- Fetches award metadata from DynamoDB (`usaspending-awards-index` table)
- Retrieves transactions and subawards from S3 using the `award_details_s3_key` stored in DynamoDB
- Decompresses gzipped JSON file from S3
- Converts DynamoDB Decimal types to float for JSON serialization
- Returns structured response with award details, transactions, and subawards
- Supports optional inclusion/exclusion of transactions and subawards via query parameters

## S3 File Format

The S3 file is stored as gzipped JSON with the following structure:
```json
{
  "transactions": [...],
  "subawards": [...],
  "indexed_at": "2025-12-01T04:38:36.395671+00:00",
  "transaction_count": 24,
  "subaward_count": 0
}
```

The S3 key format is: `{award_id}/details.json.gz`






