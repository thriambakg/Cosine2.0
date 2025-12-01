# USAspending Searchable Fields vs Autocomplete Support

This document maps searchable filter fields to their autocomplete/autofill companion endpoints.

## Summary

**Not all searchable fields have autocomplete companions.** Some fields use reference endpoints (static lists), some have autocomplete, and some require manual input.

---

## Fields WITH Autocomplete Support ✅

| Searchable Field | Autocomplete Endpoint | Type | Notes |
|-----------------|----------------------|------|-------|
| **Recipient** | `/api/v2/autocomplete/recipient/` | Autocomplete | Searches name, UEI, DUNS |
| **Awarding Agency** | `/api/v2/autocomplete/awarding_agency/` | Autocomplete | Agency name/code |
| **Awarding Agency Office** | `/api/v2/autocomplete/awarding_agency_office/` | Autocomplete | Includes offices |
| **Funding Agency** | `/api/v2/autocomplete/funding_agency/` | Autocomplete | Agency name/code |
| **Funding Agency Office** | `/api/v2/autocomplete/funding_agency_office/` | Autocomplete | Includes offices |
| **NAICS Codes** | `/api/v2/autocomplete/naics/` | Autocomplete | Industry codes |
| **PSC Codes** | `/api/v2/autocomplete/psc/` | Autocomplete | Product/Service codes |
| **CFDA Programs** | `/api/v2/autocomplete/cfda/` | Autocomplete | Program numbers |
| **City** | `/api/v2/autocomplete/city/` | Autocomplete | City names |
| **Location** | `/api/v2/autocomplete/location/` | Autocomplete | Geographic locations |
| **Program Activity** | `/api/v2/autocomplete/program_activity/` | Autocomplete | Program activities |

---

## Fields WITH Reference Endpoints (Static Lists) 📋

These provide lookup data but are not autocomplete (no search_text parameter):

| Searchable Field | Reference Endpoint | Type | Notes |
|-----------------|-------------------|------|-------|
| **Award Types** | `/api/v2/references/award_types/` | Reference | Static map of award type codes |
| **DEF Codes** | `/api/v2/references/def_codes/` | Reference | Disaster/Emergency Fund codes |
| **NAICS Hierarchy** | `/api/v2/references/naics/` | Reference | All Tier 1 NAICS (GET, not POST) |
| **NAICS Children** | `/api/v2/references/naics/<NAICS_CODE>/` | Reference | NAICS hierarchy |
| **PSC Tree** | `/api/v2/references/filter_tree/psc/` | Reference | PSC groupings (hierarchical) |
| **TAS Codes** | `/api/v2/references/filter_tree/tas/` | Reference | Treasury Account Symbol tree |
| **All CFDAs** | `/api/v2/references/assistance_listing/` | Reference | All CFDA programs (GET) |
| **Top Tier Agencies** | `/api/v2/references/toptier_agencies/` | Reference | All top-tier agencies |

---

## Fields WITH Account Autocomplete (Treasury Account Components) 🏦

| Searchable Field | Autocomplete Endpoint | Type | Notes |
|-----------------|----------------------|------|-------|
| **TAS - Agency ID** | `/api/v2/autocomplete/accounts/aid/` | Autocomplete | Agency Identifier |
| **TAS - ATA** | `/api/v2/autocomplete/accounts/ata/` | Autocomplete | Allocation Transfer Agency |
| **TAS - BPOA** | `/api/v2/autocomplete/accounts/bpoa/` | Autocomplete | Beginning Period of Availability |
| **TAS - EPOA** | `/api/v2/autocomplete/accounts/epoa/` | Autocomplete | Ending Period of Availability |
| **TAS - Main Account** | `/api/v2/autocomplete/accounts/main/` | Autocomplete | Main Account Code |
| **TAS - Sub Account** | `/api/v2/autocomplete/accounts/sub/` | Autocomplete | Sub-Account Code |
| **TAS - Availability Type** | `/api/v2/autocomplete/accounts/a/` | Autocomplete | Availability Type Code |

---

## Fields WITHOUT Autocomplete/Reference Support ❌

These fields require manual input or must be constructed from other data:

| Searchable Field | Input Method | Notes |
|-----------------|--------------|-------|
| **Award Amounts** | Manual input | Range: `lower_bound`, `upper_bound` (numbers) |
| **Time Period** | Manual input | Date picker: `start_date`, `end_date` (YYYY-MM-DD) |
| **Award IDs** | Manual input | Specific award IDs (can use exact match with quotes) |
| **Keywords** | Manual input | Free text search |
| **Description** | Manual input | Free text search |
| **Contract Pricing Type Codes** | Manual input | Codes like "J", "K", "L" (need reference data) |
| **Set-Aside Type Codes** | Manual input | Codes like "NONE", "SBA" (need reference data) |
| **Extent Competed Type Codes** | Manual input | Codes like "A", "B", "C" (need reference data) |
| **Recipient Type Names** | Manual input | Business type strings (need reference data) |
| **Place of Performance Scope** | Dropdown | Enum: "domestic" or "foreign" |
| **Recipient Scope** | Dropdown | Enum: "domestic" or "foreign" |

---

## Field Categories Breakdown

### ✅ Full Autocomplete Support (11 fields)
1. Recipient
2. Awarding Agency
3. Awarding Agency Office
4. Funding Agency
5. Funding Agency Office
6. NAICS Codes
7. PSC Codes
8. CFDA Programs
9. City
10. Location
11. Program Activity

### 📋 Reference Data Only (8+ fields)
1. Award Types
2. DEF Codes
3. NAICS Hierarchy (GET endpoint)
4. PSC Tree
5. TAS Tree
6. All CFDAs (GET endpoint)
7. Top Tier Agencies
8. Treasury Account Components (via filter_tree)

### 🏦 Account Component Autocomplete (7 fields)
All TAS-related fields have autocomplete support

### ❌ No Autocomplete/Reference (10+ fields)
1. Award Amounts (manual range input)
2. Time Period (date picker)
3. Award IDs (manual input)
4. Keywords (free text)
5. Description (free text)
6. Contract Pricing Type Codes (manual with reference)
7. Set-Aside Type Codes (manual with reference)
8. Extent Competed Type Codes (manual with reference)
9. Recipient Type Names (manual with reference)
10. Scope fields (dropdown enums)

---

## Implementation Recommendations

### For Frontend UI:

1. **Autocomplete Fields** → Use autocomplete endpoints with search-as-you-type
   - Recipient, Agencies, NAICS, PSC, CFDA, City, Location, Program Activity

2. **Reference Data Fields** → Pre-load and cache reference endpoints
   - Award Types, DEF Codes, NAICS/PSC hierarchies
   - Use for dropdowns, checkboxes, or hierarchical selectors

3. **Manual Input Fields** → Standard form inputs
   - Award Amounts (number range inputs)
   - Time Period (date pickers)
   - Keywords/Description (text inputs)
   - Award IDs (text input with exact match option)

4. **Enum Fields** → Simple dropdowns
   - Scope fields (domestic/foreign)
   - Award Type Codes (from reference data)

5. **Account Components** → Use account autocomplete endpoints
   - TAS-related fields

---

## Example: Building a Search Form

```javascript
// Fields with autocomplete
const autocompleteFields = {
  recipient: '/api/v2/autocomplete/recipient/',
  awarding_agency: '/api/v2/autocomplete/awarding_agency/',
  funding_agency: '/api/v2/autocomplete/funding_agency/',
  naics: '/api/v2/autocomplete/naics/',
  psc: '/api/v2/autocomplete/psc/',
  cfda: '/api/v2/autocomplete/cfda/',
  city: '/api/v2/autocomplete/city/',
  location: '/api/v2/autocomplete/location/',
  program_activity: '/api/v2/autocomplete/program_activity/'
};

// Fields with reference data (pre-load)
const referenceFields = {
  award_types: '/api/v2/references/award_types/',
  def_codes: '/api/v2/references/def_codes/',
  naics_hierarchy: '/api/v2/references/naics/',
  psc_tree: '/api/v2/references/filter_tree/psc/',
  toptier_agencies: '/api/v2/references/toptier_agencies/'
};

// Manual input fields
const manualFields = [
  'award_amounts',      // Number range
  'time_period',        // Date picker
  'award_ids',          // Text input
  'keywords',           // Text input
  'description'         // Text input
];
```

---

## Summary Statistics

- **Total Searchable Fields**: ~30+ fields
- **With Autocomplete**: 11 fields (37%)
- **With Reference Data**: 8+ fields (27%)
- **With Account Autocomplete**: 7 fields (23%)
- **Manual Input Only**: 10+ fields (33%)

**Note**: Some fields appear in multiple categories (e.g., NAICS has both autocomplete and reference endpoints).

