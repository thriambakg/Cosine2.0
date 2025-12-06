# USAspending Autocomplete Test Payloads

## Quick Copy-Paste for API Gateway Test Console

### Headers (for all requests):
```
Content-Type:application/json
```

---

## 1. Recipient Autocomplete (Most Common)
**Request Body:**
```json
{"autocomplete_type": "recipient", "search_text": "Lockheed", "limit": 10}
```

---

## 2. Awarding Agency
**Request Body:**
```json
{"autocomplete_type": "awarding_agency", "search_text": "Defense", "limit": 10}
```

---

## 3. Awarding Agency Office
**Request Body:**
```json
{"autocomplete_type": "awarding_agency_office", "search_text": "Army", "limit": 10}
```

---

## 4. Funding Agency
**Request Body:**
```json
{"autocomplete_type": "funding_agency", "search_text": "Energy", "limit": 10}
```

---

## 5. Funding Agency Office
**Request Body:**
```json
{"autocomplete_type": "funding_agency_office", "search_text": "Navy", "limit": 10}
```

---

## 6. NAICS Code (Industry Classification)
**Request Body:**
```json
{"autocomplete_type": "naics", "search_text": "research", "limit": 10}
```

---

## 7. PSC Code (Product/Service Classification)
**Request Body:**
```json
{"autocomplete_type": "psc", "search_text": "software", "limit": 10}
```

---

## 8. CFDA Program Number (Financial Assistance)
**Request Body:**
```json
{"autocomplete_type": "cfda", "search_text": "education", "limit": 10}
```

---

## 9. City
**Request Body:**
```json
{"autocomplete_type": "city", "search_text": "Washington", "limit": 10}
```

---

## 10. Location
**Request Body:**
```json
{"autocomplete_type": "location", "search_text": "California", "limit": 10}
```

---

## 11. Program Activity
**Request Body:**
```json
{"autocomplete_type": "program_activity", "search_text": "research", "limit": 10}
```

---

## 12. Glossary
**Request Body:**
```json
{"autocomplete_type": "glossary", "search_text": "award", "limit": 10}
```

---

## 13. TAS Availability Type (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_availability_type", "search_text": "X", "limit": 10}
```

---

## 14. TAS Agency ID (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_agency_id", "search_text": "020", "limit": 10}
```

---

## 15. TAS Allocation Transfer Agency (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_allocation_transfer_agency", "search_text": "020", "limit": 10}
```

---

## 16. TAS Beginning Period of Availability (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_beginning_period_of_availability", "search_text": "2020", "limit": 10}
```

---

## 17. TAS Ending Period of Availability (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_ending_period_of_availability", "search_text": "2025", "limit": 10}
```

---

## 18. TAS Main Account (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_main_account", "search_text": "1234", "limit": 10}
```

---

## 19. TAS Sub Account (Account Field)
**Request Body:**
```json
{"autocomplete_type": "tas_sub_account", "search_text": "5678", "limit": 10}
```

---

## Testing Notes

1. **All requests use POST method** to `/usaspending-autocomplete`
2. **Headers**: `Content-Type: application/json` (optional but recommended)
3. **Required fields**: `autocomplete_type`, `search_text`
4. **Optional fields**: `limit` (default: 10, max varies by endpoint)
5. **Response format**: All return `{"success": true, "autocomplete_type": "...", "results": [...], "messages": [...]}`

## Expected Response Structure

```json
{
  "success": true,
  "autocomplete_type": "recipient",
  "results": [
    {
      "id": "...",
      "name": "...",
      "duns": "...",
      "uei": "..."
    }
  ],
  "messages": [],
  "metadata": {
    "timestamp": "2025-12-01T...",
    "endpoint": "/api/v2/autocomplete/recipient/"
  }
}
```

## Priority Testing Order

1. **High Priority** (Most commonly used):
   - `recipient` (1)
   - `awarding_agency` (2)
   - `naics` (6)
   - `psc` (7)

2. **Medium Priority** (Commonly used):
   - `city` (9)
   - `location` (10)
   - `cfda` (8)
   - `program_activity` (11)

3. **Low Priority** (Specialized/Advanced):
   - All TAS account fields (13-19)
   - `glossary` (12)
   - Agency office fields (3, 5)






