# LDA API Autocomplete & Dropdown Endpoints Analysis

## Summary

This document analyzes all LDA API endpoints to identify which ones can be used for:
1. **Autocomplete** - Searchable endpoints that support name-based queries
2. **Dropdowns** - Static constant lists for form dropdowns

---

## Autocomplete Endpoints (Searchable by Name)

**✅ ALL THREE ENDPOINTS SUPPORT PARTIAL MATCHING (AUTOCOMPLETE)!**

These endpoints support partial text search and can be used for autocomplete functionality:

### 1. Registrants (`/api/v1/registrants/`)
- **Endpoint**: `GET /api/v1/registrants/`
- **Search Parameter**: `registrant_name` (string)
- **Total Count**: ~17,052 registrants
- **Partial Matching**: ✅ **YES** - Supports partial name matching
  - Example: `registrant_name=ACME` matches "ACME PUBLIC AFFAIRS, LLC"
  - Example: `registrant_name=Microsoft` matches "MICROSOFT CORPORATION"
  - Example: `registrant_name=VAN SCOYOC` matches "VAN SCOYOC ASSOCIATES" and "VAN SCOYOC KELLY"
- **Use Case**: Autocomplete for registrant name/ID search
- **Response Fields**:
  - `id` - Unique ID
  - `name` - Registrant name
  - `house_registrant_id` - House registrant ID
  - `description` - Description
  - Address fields, country, state, etc.
- **Query Example**: `?registrant_name=ACME&page_size=10`

### 2. Clients (`/api/v1/clients/`)
- **Endpoint**: `GET /api/v1/clients/`
- **Search Parameter**: `client_name` (string)
- **Total Count**: ~131,997 clients
- **Partial Matching**: ✅ **YES** - Supports partial name matching
  - Example: `client_name=Microsoft` returns 111 results (all containing "Microsoft")
  - Example: `client_name=AMERICAN` returns 5,414 results
  - Example: `client_name=BLUECROSS` returns 15 results
- **Use Case**: Autocomplete for client name/ID search
- **Response Fields**:
  - `id` - Unique ID
  - `client_id` - Client ID (string)
  - `name` - Client name
  - `general_description` - Description
  - Country, state, PPB fields, etc.
- **Query Example**: `?client_name=Microsoft&page_size=10`

### 3. Lobbyists (`/api/v1/lobbyists/`)
- **Endpoint**: `GET /api/v1/lobbyists/`
- **Search Parameter**: `lobbyist_name` (string)
- **Total Count**: ~86,806 lobbyists
- **Partial Matching**: ✅ **YES** - Supports partial name matching across name components
  - Example: `lobbyist_name=Smith` returns 679 results (matches last name "SMITH")
  - Example: `lobbyist_name=PARKER` returns 103 results (matches last name "PARKER")
  - Example: `lobbyist_name=KRISTIN` returns 260 results (matches first name "KRISTIN")
  - Example: `lobbyist_name=VAN SCOYOC` returns 6 results (matches last name "VAN SCOYOC")
  - **Note**: Searches across `first_name`, `last_name`, `middle_name` fields
- **Use Case**: Autocomplete for lobbyist name search
- **Response Fields**:
  - `id` - Unique ID
  - `first_name`, `middle_name`, `last_name` - Name components
  - `prefix`, `prefix_display` - Title prefix
  - `suffix`, `suffix_display` - Name suffix
  - `nickname` - Nickname
  - `registrant` - Associated registrant object
- **Query Example**: `?lobbyist_name=Smith&page_size=10`
- **Display Note**: Construct full name from `prefix_display`, `first_name`, `middle_name`, `last_name`, `suffix_display` for display

---

## Dropdown Endpoints (Static Constant Lists)

These endpoints provide static lists suitable for dropdown/select UI elements:

### 1. Filing Types (`/api/v1/constants/filing-types/`)
- **Endpoint**: `GET /api/v1/constants/filing-types/`
- **Use Case**: Dropdown for report type selection
- **Response**: Array of filing type objects with `value` and `display` fields
- **Example Values**: `RR`, `RA`, `Q1`, `Q1Y`, `1T`, `1TY`, `MM`, `MA`, `YY`, `YA`
- **Query Example**: `GET /api/v1/constants/filing-types/`

### 2. Filing Periods (`/api/v1/constants/filing-periods/`)
- **Endpoint**: `GET /api/v1/constants/filing-periods/`
- **Use Case**: Dropdown for filing period selection
- **Response**: Array of period objects with `value` and `display` fields
- **Example Values**: `first_quarter`, `second_quarter`, `third_quarter`, `fourth_quarter`, `mid_year`, `year_end`
- **Query Example**: `GET /api/v1/constants/filing-periods/`

### 3. Issue Areas (`/api/v1/constants/issue-areas/`)
- **Endpoint**: `GET /api/v1/constants/issue-areas/`
- **Use Case**: Dropdown for issue area selection
- **Response**: Array of issue area objects with `code` and `display` fields
- **Example Values**: `TAX`, `ENG`, `SPO`, etc.
- **Query Example**: `GET /api/v1/constants/issue-areas/`

### 4. Government Entities (`/api/v1/constants/government-entities/`)
- **Endpoint**: `GET /api/v1/constants/government-entities/`
- **Use Case**: Dropdown for government entity selection
- **Response**: Array of entity objects with `id` and `name` fields
- **Note**: May be paginated if large
- **Query Example**: `GET /api/v1/constants/government-entities/?page_size=100`

### 5. Countries (`/api/v1/constants/countries/`)
- **Endpoint**: `GET /api/v1/constants/countries/`
- **Use Case**: Dropdown for country selection
- **Response**: Array of country objects with `code` and `name` fields
- **Query Example**: `GET /api/v1/constants/countries/`

### 6. States (`/api/v1/constants/states/`)
- **Endpoint**: `GET /api/v1/constants/states/`
- **Use Case**: Dropdown for state selection (US states)
- **Response**: Array of state objects with `code` and `name` fields
- **Query Example**: `GET /api/v1/constants/states/`

### 7. Contribution Item Types (`/api/v1/constants/contribution-item-types/`)
- **Endpoint**: `GET /api/v1/constants/contribution-item-types/`
- **Use Case**: Dropdown for contribution type selection (LD-203)
- **Response**: Array of type objects with `value` and `display` fields
- **Example Values**: `feca`, `honorarium`, `gift`, etc.
- **Query Example**: `GET /api/v1/constants/contribution-item-types/`

### 8. Lobbyist Prefixes (`/api/v1/constants/lobbyist-prefixes/`)
- **Endpoint**: `GET /api/v1/constants/lobbyist-prefixes/`
- **Use Case**: Dropdown for lobbyist title prefix
- **Response**: Array of prefix objects with `value` and `display` fields
- **Example Values**: `MR`, `MRS`, `MS`, `DR`, etc.
- **Query Example**: `GET /api/v1/constants/lobbyist-prefixes/`

### 9. Lobbyist Suffixes (`/api/v1/constants/lobbyist-suffixes/`)
- **Endpoint**: `GET /api/v1/constants/lobbyist-suffixes/`
- **Use Case**: Dropdown for lobbyist name suffix
- **Response**: Array of suffix objects with `value` and `display` fields
- **Example Values**: `JR`, `SR`, `II`, `III`, etc.
- **Query Example**: `GET /api/v1/constants/lobbyist-suffixes/`

---

## Implementation Recommendations

### Autocomplete Implementation

1. **Debounce Input**: Wait 300-500ms after user stops typing before making API call
2. **Minimum Characters**: Require at least 2-3 characters before triggering autocomplete
3. **Cache Results**: Cache autocomplete results for common queries (e.g., "Microsoft", "AMERICAN")
4. **Display Format**: Show name and ID in dropdown, use ID for exact filtering
5. **Error Handling**: Handle rate limiting (429) and network errors gracefully
6. **Pagination**: For large result sets, implement "Load More" or pagination in dropdown

### Dropdown Implementation

1. **Cache Constants**: Fetch and cache all constant lists on app initialization
2. **Local Storage**: Store constants in browser local storage for offline access
3. **Refresh Strategy**: Refresh constants daily or on app version update
4. **Search/Filter**: For large lists (e.g., government entities), add search/filter within dropdown

### API Authentication

- **Method**: `Authorization: Token <API_KEY>` header (most secure)
- **Rate Limiting**: Implement 0.5s delay between requests
- **Error Handling**: Handle 401 (unauthorized) and 429 (rate limited) errors

### Example Frontend Implementation

```typescript
// Autocomplete hook for registrants
const useRegistrantAutocomplete = (query: string) => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const debounced = debounce(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `https://lda.senate.gov/api/v1/registrants/?registrant_name=${encodeURIComponent(query)}&page_size=10`,
          {
            headers: {
              'Authorization': `Token ${API_KEY}`,
              'Accept': 'application/json'
            }
          }
        );
        const data = await response.json();
        setResults(data.results || []);
      } catch (error) {
        console.error('Autocomplete error:', error);
      } finally {
        setLoading(false);
      }
    }, 300);

    debounced();

    return () => debounced.cancel();
  }, [query]);

  return { results, loading };
};
```

---

## Testing Results

All autocomplete endpoints were tested and confirmed to support partial matching:

- ✅ **Registrants**: Partial matching works (e.g., "ACME" → "ACME PUBLIC AFFAIRS, LLC")
- ✅ **Clients**: Partial matching works (e.g., "Microsoft" → 111 results)
- ✅ **Lobbyists**: Partial matching works across name components (e.g., "Smith" → 679 results)

See `Cosine-Base-Infra/scripts/test_lda_name_search.py` for test implementation.




