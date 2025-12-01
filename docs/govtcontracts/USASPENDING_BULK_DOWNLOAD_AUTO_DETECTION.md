# USAspending Bulk Download Auto-Detection

## Overview

The system automatically detects when a download request should use the **bulk download** endpoint vs the **regular download** endpoint based on the search filters provided.

---

## Auto-Detection Logic

### Criteria for Bulk Download

A download request will automatically use the **bulk download** endpoint (`/api/v2/bulk_download/awards/`) when:

1. ✅ **Agency(ies) are provided** (`agencies` filter with at least one agency)
2. ✅ **Time period is provided** (`time_period` or `date_range` filter)
3. ❌ **No other specific search filters** are present

### Criteria for Regular Download

A download request will use the **regular download** endpoint (`/api/v2/download/awards/`) when:

- Any of these filters are present:
  - `recipient_search_text` or `recipient_id`
  - `keywords`
  - `award_ids` or `award_unique_id`
  - `description`
  - `recipient_locations`
  - `place_of_performance_locations`
  - `naics_codes`
  - `psc_codes`
  - `program_numbers`
  - `def_codes`
  - `award_amounts`
  - `recipient_type_names`
  - `contract_pricing_type_codes`
  - `set_aside_type_codes`
  - `extent_competed_type_codes`
  - Or any other specific search filter

---

## Examples

### Example 1: Bulk Download (Auto-Detected)

```json
{
  "filters": {
    "agencies": [
      {
        "type": "awarding",
        "tier": "toptier",
        "name": "Department of Defense"
      }
    ],
    "time_period": [
      {
        "start_date": "2020-01-01",
        "end_date": "2023-12-31"
      }
    ],
    "award_type_codes": ["A", "B", "C", "D"]
  }
}
```

**Result**: ✅ Uses `/api/v2/bulk_download/awards/`

**Why**: Only agency + time period (and award_type_codes which is allowed)

---

### Example 2: Regular Download (Auto-Detected)

```json
{
  "filters": {
    "agencies": [
      {
        "type": "awarding",
        "tier": "toptier",
        "name": "Department of Defense"
      }
    ],
    "time_period": [
      {
        "start_date": "2020-01-01",
        "end_date": "2023-12-31"
      }
    ],
    "recipient_search_text": ["Palantir"]
  }
}
```

**Result**: ✅ Uses `/api/v2/download/awards/`

**Why**: Has `recipient_search_text` filter (specific search, not bulk)

---

### Example 3: Regular Download (Auto-Detected)

```json
{
  "filters": {
    "award_ids": [
      "CONT_AWD_W911QX24F0053_9700_W911QX24D0012_9700",
      "CONT_AWD_15F06721F0001876_1549_GS35F0483W_4730"
    ]
  }
}
```

**Result**: ✅ Uses `/api/v2/download/awards/`

**Why**: Has `award_ids` filter (specific award lookup)

---

### Example 4: Regular Download (Auto-Detected)

```json
{
  "filters": {
    "keywords": ["software", "development"],
    "award_type_codes": ["A", "B", "C", "D"]
  }
}
```

**Result**: ✅ Uses `/api/v2/download/awards/`

**Why**: Has `keywords` filter (text search, not bulk)

---

## Implementation

### Detection Function

```python
def should_use_bulk_download(filters: Dict[str, Any]) -> bool:
    """
    Auto-detect if bulk download should be used.
    
    Criteria: Only agency(ies) and time_period/date_range are provided.
    No other filters like recipient, keywords, award_ids, etc.
    """
    # Check for required bulk download fields
    has_agencies = "agencies" in filters and len(filters.get("agencies", [])) > 0
    has_time_period = "time_period" in filters and len(filters.get("time_period", [])) > 0
    has_date_range = "date_range" in filters and filters.get("date_range") is not None
    
    # Must have both agency and time period/date range
    if not (has_agencies and (has_time_period or has_date_range)):
        return False
    
    # Check for fields that indicate this is NOT a bulk download scenario
    exclude_fields = [
        "recipient_search_text",
        "recipient_id",
        "keywords",
        "award_ids",
        "award_unique_id",
        "description",
        "recipient_locations",
        "place_of_performance_locations",
        "naics_codes",
        "psc_codes",
        "program_numbers",
        "def_codes",
        "award_amounts",
        "recipient_type_names",
        "contract_pricing_type_codes",
        "set_aside_type_codes",
        "extent_competed_type_codes"
    ]
    
    # If any exclude fields are present, use regular download
    for field in exclude_fields:
        if field in filters and filters[field]:
            return False
    
    # Only agency and time period/date range - use bulk download
    return True
```

### Usage

```python
def initiate_download(filters: Dict[str, Any], download_type: str = "awards") -> Dict:
    """Initiate download with auto-detection"""
    
    # Auto-detect bulk vs regular
    use_bulk = should_use_bulk_download(filters)
    
    if use_bulk:
        return initiate_bulk_download(filters, download_type)
    else:
        return initiate_regular_download(filters, download_type)
```

---

## Benefits

1. **User-Friendly**: Users don't need to know the difference between bulk and regular downloads
2. **Optimal Performance**: Automatically uses the most efficient endpoint
3. **Transparent**: Works behind the scenes without user intervention
4. **Flexible**: Can still explicitly call bulk download endpoint if needed

---

## Status Endpoints

- **Bulk Download Status**: `/api/v2/bulk_download/status/`
- **Regular Download Status**: `/api/v2/download/status/`

The system automatically uses the correct status endpoint based on the download type.

---

## Notes

- `award_type_codes` is allowed in bulk downloads (it's converted to `prime_award_types`)
- Optional bulk download fields like `keyword`, `place_of_performance_scope`, `recipient_scope` are allowed
- The detection is conservative: if in doubt, it uses regular download (safer for specific searches)

