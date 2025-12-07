# USAspending Autocomplete Lambda

This Lambda function handles all autocomplete endpoints for the USAspending API integration.

## Supported Autocomplete Types

### Account Autocomplete (TAS Components)
- `accounts_a` - Treasury Account Symbol Availability Type Code
- `accounts_aid` - Agency Identifier
- `accounts_ata` - Allocation Transfer Agency Identifier
- `accounts_bpoa` - Beginning Period of Availability
- `accounts_epoa` - Ending Period of Availability
- `accounts_main` - Main Account Code
- `accounts_sub` - Sub-Account Code

**Aliases:**
- `tas_availability_type` → `accounts_a`
- `tas_agency_id` → `accounts_aid`
- `tas_ata` → `accounts_ata`
- `tas_bpoa` → `accounts_bpoa`
- `tas_epoa` → `accounts_epoa`
- `tas_main_account` → `accounts_main`
- `tas_sub_account` → `accounts_sub`

### Agency Autocomplete
- `awarding_agency` - Awarding agencies
- `awarding_agency_office` - Awarding agencies and offices
- `funding_agency` - Funding agencies
- `funding_agency_office` - Funding agencies and offices

### Other Autocomplete
- `recipient` - Recipient names and UEI
- `city` - City names
- `location` - Geographic locations
- `program_activity` - Program activities
- `cfda` - CFDA programs
- `naics` - NAICS codes
- `psc` - Product/Service codes
- `glossary` - Glossary terms

## API Usage

### Request Format

**API Gateway:**
```
POST /usaspending-autocomplete/{type}
Content-Type: application/json

{
  "search_text": "Lockheed",
  "limit": 10,
  "filter": {}  // Optional, for city endpoint
}
```

**Direct Invocation:**
```json
{
  "autocomplete_type": "recipient",
  "search_text": "Lockheed",
  "limit": 10
}
```

### Response Format

```json
{
  "success": true,
  "autocomplete_type": "recipient",
  "results": [
    {
      "name": "Lockheed Martin Corporation",
      "recipient_id": "...",
      "uei": "...",
      "duns": "..."
    }
  ],
  "messages": [],
  "metadata": {
    "timestamp": "2025-12-01T00:00:00",
    "endpoint": "/api/v2/autocomplete/recipient/"
  }
}
```

## Environment Variables

- `USASPENDING_BASE_URL` - Base URL for USAspending API (default: `https://api.usaspending.gov`)
- `USASPENDING_USER_AGENT` - User agent string for API requests
- `REQUEST_TIMEOUT` - Request timeout in seconds (default: 30)

## Error Handling

The Lambda returns appropriate HTTP status codes:
- `200` - Success
- `400` - Bad request (missing parameters, invalid type)
- `500` - Internal server error

Error response format:
```json
{
  "error": "Error type",
  "message": "Error message"
}
```

## Testing

Example test event:
```json
{
  "autocomplete_type": "recipient",
  "search_text": "Palantir",
  "limit": 5
}
```






