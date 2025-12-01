# USAspending API Endpoints Analysis

## Overview

This document provides a comprehensive analysis of all USAspending API v2 endpoints that need to be supported in the Cosine2.0 system. The analysis includes endpoint descriptions, request/response structures, and recommendations for data storage.

## Storage Recommendation: DynamoDB

**Recommendation: Use DynamoDB for storing USAspending API results**

### Rationale:
1. **Non-uniform Schemas**: Different endpoints return vastly different data structures:
   - Agency endpoints return simple objects with fixed fields
   - Award endpoints return complex nested objects with varying structures (contracts, IDVs, financial assistance)
   - Search endpoints return arrays of results with optional fields
   - Autocomplete endpoints return simple arrays
   - Download endpoints return job status objects

2. **Schema Variations**:
   - Awards have three distinct response types: `ContractResponse`, `IDVResponse`, and `FinancialAssistanceResponse`
   - Each has different required/optional fields
   - Nested objects (agencies, recipients, locations) appear across multiple endpoints but with slight variations
   - Some endpoints return paginated results, others return single objects
   - Some endpoints return arrays directly, others wrap in objects

3. **DynamoDB Advantages**:
   - NoSQL flexibility handles schema variations naturally
   - Can store entire JSON responses as-is
   - Good for high read/write throughput
   - Supports TTL for cache expiration
   - Can index on common fields (award_id, recipient_id, agency_code, fiscal_year)

4. **Table Structure Recommendation**:
   - **Primary Key**: `endpoint_path#request_hash` (e.g., `api/v2/awards/CONT_AWD_123#abc123`)
   - **Sort Key**: `timestamp` (for versioning/caching)
   - **GSI**: `endpoint_path#fiscal_year` for time-based queries
   - **GSI**: `endpoint_path#award_id` for award lookups
   - **Attributes**: Full JSON response stored in `response_data`, metadata in `metadata` attribute

---

## Endpoint Categories

### 1. Agency Endpoints (`/api/v2/agency/`)

#### 1.1 Agency Overview
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/`
- **Method**: GET
- **Description**: Returns agency overview information for USAspending.gov's Agency Details page
- **Response Structure**:
  ```json
  {
    "fiscal_year": number,
    "toptier_code": string,
    "name": string,
    "abbreviation": string (nullable),
    "agency_id": number,
    "icon_filename": string (nullable),
    "mission": string (nullable),
    "website": string (nullable),
    "congressional_justification_url": string (nullable),
    "about_agency_data": string (nullable),
    "subtier_agency_count": number,
    "def_codes": array[DEFC],
    "messages": array[string]
  }
  ```

**Actual Response Example**:
```json
{
    "fiscal_year": 2023,
    "toptier_code": "020",
    "name": "Department of the Treasury",
    // ... 10 more fields
  }
```

- **Schema Uniformity**: Fixed structure, all fields present

#### 1.2 Agency Awards
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/awards/`
- **Method**: GET
- **Description**: Returns agency summary information (transaction count, award obligations)
- **Response Structure**:
  ```json
  {
    "toptier_code": string,
    "fiscal_year": number,
    "latest_action_date": string (nullable),
    "transaction_count": number,
    "obligations": number,
    "messages": array[string]
  }
  ```

**Actual Response Example**:
```json
{
    "fiscal_year": 2023,
    "latest_action_date": "2023-09-30T00:00:00",
    "toptier_code": "020",
    // ... 3 more fields
  }
```

- **Schema Uniformity**: Fixed structure

#### 1.3 Agency Awards New Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/awards/new/count/`
- **Method**: GET
- **Description**: Returns count of New Awards for the agency in a single fiscal year
- **Response Structure**: Likely returns a simple count object

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "agency_type": "awarding",
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Simple count response

#### 1.4 Agency Awards Count (All Agencies)
- **Endpoint**: `/api/v2/agency/awards/count/`
- **Method**: GET
- **Description**: Returns count of Award types for agencies in a single fiscal year
- **Response Structure**: Likely returns array or object with counts per agency

**Actual Response Example**:
```json
{
    "results": [
    [
    ...,
    ...,
    ...,
    // ... 7 more items
  ]
  ],
    "page_metadata": {
    "page": 1,
    "total": 77,
    "limit": 10,
    // ... 4 more fields
  },
    "messages": []
  }
```

- **Schema Uniformity**: Array or aggregated object

#### 1.5 Agency Budget Function
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/budget_function/`
- **Method**: GET
- **Description**: Returns list of Budget Functions and Budget Subfunctions
- **Response Structure**: Array of budget function objects with codes and descriptions

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "results": [
    {
    "name": ...,
    "children": ...,
    "obligated_amount": ...,
    // ... 1 more fields
  },
    {
    "name": ...,
    "children": ...,
    "obligated_amount": ...,
    // ... 1 more fields
  },
    {
    "name": ...,
    "children": ...,
    "obligated_amount": ...,
    // ... 1 more fields
  },
    // ... 7 more items
  ],
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.6 Agency Budget Function Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/budget_function/count/`
- **Method**: GET
- **Description**: Returns count of Budget Functions
- **Response Structure**: Simple count

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "budget_function_count": 12,
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Count response

#### 1.7 Agency Budgetary Resources
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/budgetary_resources/`
- **Method**: GET
- **Description**: Returns budgetary resources and obligations for the agency and fiscal year
- **Response Structure**: Object with budget authority, obligations, outlays

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "agency_data_by_year": [
    {
    "fiscal_year": ...,
    "agency_budgetary_resources": ...,
    "agency_total_obligated": ...,
    // ... 3 more fields
  },
    {
    "fiscal_year": ...,
    "agency_budgetary_resources": ...,
    "agency_total_obligated": ...,
    // ... 3 more fields
  },
    {
    "fiscal_year": ...,
    "agency_budgetary_resources": ...,
    "agency_total_obligated": ...,
    // ... 3 more fields
  },
    // ... 7 more items
  ],
    "messages": []
  }
```

- **Schema Uniformity**: Financial summary object

#### 1.8 Agency Federal Account
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/federal_account/`
- **Method**: GET
- **Description**: Returns list of Federal Accounts and Treasury Accounts
- **Response Structure**: Array of federal account objects

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "page_metadata": {
    "page": 1,
    "total": 119,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.9 Agency Federal Account Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/federal_account/count/`
- **Method**: GET
- **Description**: Returns count of Federal Accounts
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "federal_account_count": 119,
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Count response

#### 1.10 Agency Object Class
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/object_class/`
- **Method**: GET
- **Description**: Returns list of Object Classes
- **Response Structure**: Array of object class objects

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "page_metadata": {
    "page": 1,
    "total": 29,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.11 Agency Object Class Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/object_class/count/`
- **Method**: GET
- **Description**: Returns count of Object Classes
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "object_class_count": 55,
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Count response

#### 1.12 Agency Obligations by Award Category
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/obligations_by_award_category/`
- **Method**: GET
- **Description**: Returns breakdown of obligations by award category
- **Response Structure**: Object with obligations grouped by award type

**Actual Response Example**:
```json
{
    "total_aggregated_amount": 13083927244.06,
    "results": [
    {
    "category": ...,
    "aggregated_amount": ...
  },
    {
    "category": ...,
    "aggregated_amount": ...
  },
    {
    "category": ...,
    "aggregated_amount": ...
  },
    // ... 3 more items
  ]
  }
```

- **Schema Uniformity**: Aggregated object

#### 1.13 Agency Program Activity
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/program_activity/`
- **Method**: GET
- **Description**: Returns list of Program Activity categories
- **Response Structure**: Array of program activity objects

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "page_metadata": {
    "page": 1,
    "total": 218,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.14 Agency Program Activity Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/program_activity/count/`
- **Method**: GET
- **Description**: Returns count of Program Activity categories
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "program_activity_count": 251,
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Count response

#### 1.15 Agency Sub-Agency
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/sub_agency/`
- **Method**: GET
- **Description**: Returns list of sub-agencies with obligated amounts, transaction counts
- **Response Structure**: Array of sub-agency objects with financial data

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "page_metadata": {
    "page": 1,
    "total": 8,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.16 Agency Sub-Agency Count
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/sub_agency/count/`
- **Method**: GET
- **Description**: Returns number of sub-agencies
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "sub_agency_count": 8,
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Count response

#### 1.17 Agency Sub-Components
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/sub_components/`
- **Method**: GET
- **Description**: Returns list of bureaus for the agency
- **Response Structure**: Array of bureau/sub-component objects

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "fiscal_year": 2023,
    "results": [
    {
    "name": ...,
    "id": ...,
    "total_obligations": ...,
    // ... 2 more fields
  },
    {
    "name": ...,
    "id": ...,
    "total_obligations": ...,
    // ... 2 more fields
  },
    {
    "name": ...,
    "id": ...,
    "total_obligations": ...,
    // ... 2 more fields
  },
    // ... 7 more items
  ],
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.18 Agency Sub-Components by Bureau
- **Endpoint**: `/api/v2/agency/<TOPTIER_AGENCY_CODE>/sub_components/<BUREAU_SLUG>/`
- **Method**: GET
- **Description**: Returns list of federal_accounts by bureau
- **Response Structure**: Array of federal account objects

**Actual Response Example**:
```json
{
    "toptier_code": "020",
    "bureau_slug": "interest-on-the-public-debt",
    "fiscal_year": 2023,
    // ... 4 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.19 Treasury Account Object Class
- **Endpoint**: `/api/v2/agency/treasury_account/<TREASURY_ACCOUNT_SYMBOL>/object_class/`
- **Method**: GET
- **Description**: Returns Object Classes for specified Treasury Account Symbol
- **Response Structure**: Array of object class objects

**Actual Response Example**:
```json
{
    "treasury_account_symbol": "091-0100",
    "fiscal_year": 2026,
    "page_metadata": {
    "page": 1,
    "total": 0,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 1.20 Treasury Account Program Activity
- **Endpoint**: `/api/v2/agency/treasury_account/<TREASURY_ACCOUNT_SYMBOL>/program_activity/`
- **Method**: GET
- **Description**: Returns Program Activities for specified Treasury Account Symbol
- **Response Structure**: Array of program activity objects

**Actual Response Example**:
```json
{
    "treasury_account_symbol": "091-0100",
    "fiscal_year": 2026,
    "page_metadata": {
    "page": 1,
    "total": 0,
    "limit": 10,
    // ... 4 more fields
  },
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 2. Autocomplete Endpoints (`/api/v2/autocomplete/`)

All autocomplete endpoints follow a similar pattern:
- **Method**: POST
- **Request**: `{ "search_text": string, "limit": number (optional), ... }`
- **Response**: `{ "results": array[MatchObject], "messages": array[string] }`

#### 2.1 Account Autocomplete Endpoints
- `/api/v2/autocomplete/accounts/a/` - Treasury Account Symbol Availability Type Code
- `/api/v2/autocomplete/accounts/aid/` - Agency Identifier
- `/api/v2/autocomplete/accounts/ata/` - Allocation Transfer Agency Identifier
- `/api/v2/autocomplete/accounts/bpoa/` - Beginning Period of Availability
- `/api/v2/autocomplete/accounts/epoa/` - Ending Period of Availability
- `/api/v2/autocomplete/accounts/main/` - Main Account Code
- `/api/v2/autocomplete/accounts/sub/` - Sub-Account Code

**Response Structure**: Array of matching codes/values
**Schema Uniformity**: Simple arrays

#### 2.2 Agency Autocomplete
- `/api/v2/autocomplete/awarding_agency/` - Awarding agencies
- `/api/v2/autocomplete/awarding_agency_office/` - Awarding agencies and offices
- `/api/v2/autocomplete/funding_agency/` - Funding agencies
- `/api/v2/autocomplete/funding_agency_office/` - Funding agencies and offices

**Response Structure**: Array of agency objects with name, code, abbreviation
**Schema Uniformity**: Array of similar objects

#### 2.3 Other Autocomplete
- `/api/v2/autocomplete/cfda/` - CFDA programs
- `/api/v2/autocomplete/city/` - City names
- `/api/v2/autocomplete/recipient/` - Recipient names and UEI
- `/api/v2/autocomplete/glossary/` - Glossary terms
- `/api/v2/autocomplete/naics/` - NAICS objects
- `/api/v2/autocomplete/psc/` - Product/Service codes
- `/api/v2/autocomplete/program_activity/` - Program activities
- `/api/v2/autocomplete/location` - Locations

**Response Structure**: Array of match objects (name, code, description, etc.)
**Schema Uniformity**: Arrays with varying field structures per type

---

### 3. Award Spending Endpoints (`/api/v2/award_spending/`)

#### 3.1 Award Spending by Recipient
- **Endpoint**: `/api/v2/award_spending/recipient/`
- **Method**: GET
- **Description**: Returns all award spending by recipient for a given fiscal year and agency id
- **Response Structure**: Array of recipient spending objects with amounts and counts

**Actual Response Example**:
```json
{
    "page_metadata": {
    "count": 0,
    "page": 1,
    "has_next_page": false,
    // ... 4 more fields
  },
    "results": []
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 4. Awards Endpoints (`/api/v2/awards/`)

#### 4.1 Award Details
- **Endpoint**: `/api/v2/awards/<AWARD_ID>/`
- **Method**: GET
- **Description**: Returns details about specific award
- **Response Structure**: **VARIABLE SCHEMA** - One of three types:
  - **ContractResponse**: For contract awards (type A, B, C, D)
    - Includes: `id`, `generated_unique_award_id`, `piid`, `category: "contract"`, `type`, `total_obligation`, `base_exercised_options`, `base_and_all_options`, `date_signed`, `subaward_count`, `awarding_agency`, `funding_agency`, `recipient`, `period_of_performance`, `place_of_performance`, `latest_transaction_contract_data` (extensive contract details), `parent_award`, `naics_hierarchy`, `psc_hierarchy`, `total_account_outlay`, `total_account_obligation`, `account_obligations_by_defc`, `account_outlays_by_defc`
  
  - **IDVResponse**: For Indefinite Delivery Vehicles (IDV_A through IDV_E)
    - Similar to ContractResponse but with `category: "idv"` and IDV-specific fields
  
  - **FinancialAssistanceResponse**: For grants, loans, direct payments (type 02-11)
    - Includes: `id`, `generated_unique_award_id`, `fain`, `uri`, `category` (loans/other/direct payment/grant), `type`, `record_type`, `total_obligation`, `total_subsidy_cost` (loans), `total_loan_value` (loans), `non_federal_funding` (grants), `total_funding` (grants), `cfda_info` array, `funding_opportunity`

**Schema Uniformity**: **NON-UNIFORM** - Three distinct response types with different required fields


**Actual Response Example**:
```json
{
    "id": 306293964,
    "generated_unique_award_id": "CONT_AWD_H907_9700_SPE2DX16D1500_9700",
    "piid": "H907",
    // ... 25 more fields
  }
```
#### 4.2 Award Accounts
- **Endpoint**: `/api/v2/awards/accounts/`
- **Method**: POST
- **Description**: Returns list of federal accounts for the indicated award
- **Request**: `{ "award_id": string }`
- **Response Structure**: Array of federal account objects

**Actual Response Example**:
```json
{
    "results": [],
    "page_metadata": {
    "page": 1,
    "count": 0,
    "next": null,
    // ... 3 more fields
  }
  }
```

- **Schema Uniformity**: Array of similar objects

#### 4.3 Award Counts
- `/api/v2/awards/count/federal_account/<AWARD_ID>/` - Number of federal accounts
- `/api/v2/awards/count/subaward/<AWARD_ID>/` - Number of subawards
- `/api/v2/awards/count/transaction/<AWARD_ID>/` - Number of transactions

**Response Structure**: Simple count objects
**Schema Uniformity**: Count responses

#### 4.4 Award Funding
- **Endpoint**: `/api/v2/awards/funding`
- **Method**: POST
- **Description**: Returns federal account, awarding agencies, funding agencies, and transaction obligated amount
- **Response Structure**: Object with funding details, agencies, accounts, amounts
- **Schema Uniformity**: Funding summary object

#### 4.5 Award Funding Rollup
- **Endpoint**: `/api/v2/awards/funding_rollup`
- **Method**: POST
- **Description**: Returns aggregated count of awarding agencies, federal accounts, and total transaction obligated amount
- **Response Structure**: Aggregated summary object
- **Schema Uniformity**: Aggregated object

#### 4.6 Award Last Updated
- **Endpoint**: `/api/v2/awards/last_updated/`
- **Method**: GET
- **Description**: Returns date of last update
- **Response Structure**: Date string or timestamp

**Actual Response Example**:
```json
{
    "last_updated": "11/30/2025"
  }
```

- **Schema Uniformity**: Simple date response

---

### 5. Budget Functions Endpoints (`/api/v2/budget_functions/`)

#### 5.1 List Budget Functions
- **Endpoint**: `/api/v2/budget_functions/list_budget_functions/`
- **Method**: GET
- **Description**: Returns all Budget Functions associated with a TAS
- **Response Structure**: Array of budget function objects

**Actual Response Example**:
```json
{
    "results": [
    {
    "budget_function_code": ...,
    "budget_function_title": ...
  },
    {
    "budget_function_code": ...,
    "budget_function_title": ...
  },
    {
    "budget_function_code": ...,
    "budget_function_title": ...
  },
    // ... 17 more items
  ]
  }
```

- **Schema Uniformity**: Array of similar objects

#### 5.2 List Budget Subfunctions
- **Endpoint**: `/api/v2/budget_functions/list_budget_subfunctions/`
- **Method**: POST
- **Description**: Returns all Budget Subfunctions
- **Response Structure**: Array of budget subfunction objects

**Actual Response Example**:
```json
{
    "results": [
    {
    "budget_subfunction_code": ...,
    "budget_subfunction_title": ...
  },
    {
    "budget_subfunction_code": ...,
    "budget_subfunction_title": ...
  },
    {
    "budget_subfunction_code": ...,
    "budget_subfunction_title": ...
  },
    // ... 69 more items
  ]
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 6. Bulk Download Endpoints (`/api/v2/bulk_download/`)

#### 6.1 Bulk Download Awards
- **Endpoint**: `/api/v2/bulk_download/awards/`
- **Method**: POST
- **Description**: Generates zip file for download of award data in CSV format
- **Request**: Filter object with award criteria
- **Response Structure**:
  ```json
  {
    "status_url": string,
    "file_name": string,
    "file_url": string,
    "download_request": object
  }
  ```

**Actual Response Example**:
```json
{
    "status_url": "https://api.usaspending.gov/api/v2/download/status?file_name=All_PrimeTransactions_2025-11-30_H21...",
    "file_name": "All_PrimeTransactions_2025-11-30_H21M06S03947411.zip",
    "file_url": "https://files.usaspending.gov/generated_downloads/All_PrimeTransactions_2025-11-30_H21M06S0394741...",
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Job initiation response

#### 6.2 Bulk Download List Agencies
- **Endpoint**: `/api/v2/bulk_download/list_agencies/`
- **Method**: POST
- **Description**: Lists all agencies and subagencies
- **Response Structure**: Array of agency objects

**Actual Response Example**:
```json
{
    "agencies": {
    "cfo_agencies": [
    ...,
    ...,
    ...,
    // ... 21 more items
  ],
    "other_agencies": [
    ...,
    ...,
    ...,
    // ... 85 more items
  ]
  },
    "sub_agencies": []
  }
```

- **Schema Uniformity**: Array of similar objects

#### 6.3 Bulk Download List Monthly Files
- **Endpoint**: `/api/v2/bulk_download/list_monthly_files/`
- **Method**: POST
- **Description**: Lists monthly files associated with requested params
- **Response Structure**: Array of file metadata objects

**Actual Response Example**:
```json
{
    "monthly_files": []
  }
```

- **Schema Uniformity**: Array of similar objects

#### 6.4 Bulk Download Status
- **Endpoint**: `/api/v2/bulk_download/status/`
- **Method**: GET
- **Description**: Returns status of download job
- **Response Structure**: Job status object (pending, processing, completed, failed)
- **Schema Uniformity**: Status object

---

### 7. Disaster Endpoints (`/api/v2/disaster/`)

All disaster endpoints follow similar patterns with POST requests and filter objects.

#### 7.1 Disaster Overview
- **Endpoint**: `/api/v2/disaster/overview/`
- **Method**: GET
- **Description**: Overview of Disaster/Emergency funding and spending
- **Response Structure**:
  ```json
  {
    "funding": array[{ "def_code": string, "amount": number }],
    "total_budget_authority": number,
    "spending": {
      "award_obligations": number,
      "award_outlays": number,
      "total_obligations": number,
      "total_outlays": number
    },
    "additional": { ... } (optional)
  }
  ```
- **Schema Uniformity**: Fixed structure

#### 7.2 Disaster Agency Endpoints
- `/api/v2/disaster/agency/count/` - Count of agencies
- `/api/v2/disaster/agency/loans/` - Agency loan insights
- `/api/v2/disaster/agency/spending/` - Agency spending insights

**Response Structure**: Count or array of agency objects with disaster funding data
**Schema Uniformity**: Count or array of similar objects

#### 7.3 Disaster Award Endpoints
- `/api/v2/disaster/award/amount/` - Award obligation/outlay aggregations
- `/api/v2/disaster/award/count/` - Count of awards

**Response Structure**: Aggregated amounts or count
**Schema Uniformity**: Aggregated object or count

#### 7.4 Disaster Dimension Endpoints
Pattern: `/api/v2/disaster/{dimension}/{action}/`
- Dimensions: `cfda`, `def_code`, `federal_account`, `object_class`, `recipient`
- Actions: `count`, `loans`, `spending`

**Specific Endpoints**:
- `/api/v2/disaster/cfda/count/` - Dimension Count of Disaster/Emergency funding data
- `/api/v2/disaster/cfda/loans/` - Records of loan Disaster/Emergency funding data by dimension
- `/api/v2/disaster/cfda/spending/` - Records of spending Disaster/Emergency funding data by dimension
- `/api/v2/disaster/def_code/count/` - Dimension Count of Disaster/Emergency funding data
- `/api/v2/disaster/federal_account/count/` - Dimension Count of Disaster/Emergency funding data
- `/api/v2/disaster/federal_account/loans/` - Records of loan Disaster/Emergency funding data by dimension
- `/api/v2/disaster/federal_account/spending/` - Records of spending Disaster/Emergency funding data by dimension
- `/api/v2/disaster/object_class/count/` - Dimension Count of Disaster/Emergency funding data
- `/api/v2/disaster/object_class/loans/` - Records of loan Disaster/Emergency funding data by dimension
- `/api/v2/disaster/object_class/spending/` - Records of spending Disaster/Emergency funding data by dimension
- `/api/v2/disaster/recipient/count/` - Dimension Count of Disaster/Emergency funding data
- `/api/v2/disaster/recipient/loans/` - Records of loan Disaster/Emergency funding data by dimension
- `/api/v2/disaster/recipient/spending/` - Records of spending Disaster/Emergency funding data by dimension

**Response Structure**: Count, array of loan records, or array of spending records
**Schema Uniformity**: Varies by action type

#### 7.5 Disaster Spending by Geography
- **Endpoint**: `/api/v2/disaster/spending_by_geography/`
- **Method**: POST
- **Description**: Geographic award spending of Disaster/Emergency funding
- **Response Structure**: Array of geographic spending objects

**Actual Response Example**:
```json
{
    "geo_layer": "state",
    "spending_type": "obligation",
    "scope": "recipient_location",
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 8. Download Endpoints (`/api/v2/download/`)

Similar to bulk download but for different data types.

#### 8.1 Download Endpoints
- `/api/v2/download/accounts/` - Account data CSV
- `/api/v2/download/assistance/` - Assistance data zip
- `/api/v2/download/awards/` - Award data CSV
- `/api/v2/download/contract/` - Contract data zip
- `/api/v2/download/count/` - Transaction count
- `/api/v2/download/disaster/` - Disaster data zip
- `/api/v2/download/disaster/recipients/` - Disaster recipient data zip
- `/api/v2/download/idv/` - IDV data zip
- `/api/v2/download/transactions/` - Transaction data CSV

**Request**: Filter object
**Response Structure**: Job initiation response (status_url, file_name, file_url, download_request)
**Schema Uniformity**: Job initiation responses

#### 8.2 Download Status
- **Endpoint**: `/api/v2/download/status/`
- **Method**: GET
- **Description**: Gets status of download job
- **Response Structure**: Job status object
- **Schema Uniformity**: Status object

---

### 9. Federal Accounts Endpoints (`/api/v2/federal_accounts/`)

#### 9.1 Federal Accounts List
- **Endpoint**: `/api/v2/federal_accounts/`
- **Method**: POST
- **Description**: Returns financial spending data by object class
- **Request**: Filter object with fiscal year, agency identifier, sort options
- **Response Structure**:
  ```json
  {
    "previous": number (nullable),
    "count": number,
    "limit": number,
    "hasNext": boolean,
    "page": number,
    "hasPrevious": boolean,
    "next": number (nullable),
    "fy": string,
    "results": array[FederalAccountListing]
  }
  ```

**Actual Response Example**:
```json
{
    "count": 2250,
    "limit": 10,
    "page": 1,
    // ... 7 more fields
  }
```

- **Schema Uniformity**: Paginated response

#### 9.2 Federal Account Details
- **Endpoint**: `/api/v2/federal_accounts/<ACCOUNT_CODE>/`
- **Method**: GET
- **Description**: Returns federal account based on its code
- **Response Structure**: Federal account object with details
- **Schema Uniformity**: Account detail object

#### 9.3 Federal Account Object Classes
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/available_object_classes/` - Available object classes
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/object_classes/total/` - Object classes with totals

**Response Structure**: Array of object class objects
**Schema Uniformity**: Array of similar objects

#### 9.4 Federal Account Fiscal Year Snapshot
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/fiscal_year_snapshot/` - Most recent year
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/fiscal_year_snapshot/<YEAR>/` - Specific year

**Response Structure**: Budget information object for the account
**Schema Uniformity**: Budget snapshot object

#### 9.5 Federal Account Program Activities
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/program_activities/` - List of program activities
- `/api/v2/federal_accounts/<ACCOUNT_CODE>/program_activities/total` - Program activities with totals

**Response Structure**: Array of program activity objects
**Schema Uniformity**: Array of similar objects

---

### 10. Federal Obligations Endpoints (`/api/v2/federal_obligations/`)

#### 10.1 Federal Obligations
- **Endpoint**: `/api/v2/federal_obligations/`
- **Method**: GET
- **Description**: Returns paginated list of obligations for provided agency and year
- **Response Structure**: Paginated array of obligation objects

**Actual Response Example**:
```json
{
    "page_metadata": {
    "count": 1,
    "page": 1,
    "has_next_page": false,
    // ... 4 more fields
  },
    "results": [
    {
    "id": ...,
    "account_title": ...,
    "account_number": ...,
    // ... 1 more fields
  }
  ]
  }
```

- **Schema Uniformity**: Paginated response

---

### 11. Financial Balances Endpoints (`/api/v2/financial_balances/`)

#### 11.1 Financial Balances by Agencies
- **Endpoint**: `/api/v2/financial_balances/agencies/`
- **Method**: GET
- **Description**: Returns financial balances by agency and latest quarter
- **Response Structure**: Array of agency balance objects

**Actual Response Example**:
```json
{
    "page_metadata": {
    "count": 0,
    "page": 1,
    "has_next_page": false,
    // ... 4 more fields
  },
    "results": []
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 12. Financial Spending Endpoints (`/api/v2/financial_spending/`)

#### 12.1 Financial Spending by Object Class
- `/api/v2/financial_spending/major_object_class/` - Major object class
- `/api/v2/financial_spending/object_class/` - Object class

**Response Structure**: Array of spending objects grouped by object class
**Schema Uniformity**: Array of similar objects

---

### 13. IDV Endpoints (`/api/v2/idvs/`)

#### 13.1 IDV Endpoints
- `/api/v2/idvs/accounts/` - Federal accounts for IDV (POST)
- `/api/v2/idvs/activity/` - Child/grandchild awards info (POST)
- `/api/v2/idvs/amounts/<AWARD_ID>/` - Direct children of IDV (GET)
- `/api/v2/idvs/awards/` - IDVs or contracts related to IDV (POST)
- `/api/v2/idvs/count/federal_account/<AWARD_ID>/` - Count of federal accounts (GET)
- `/api/v2/idvs/funding/` - File C funding records (POST)
- `/api/v2/idvs/funding_rollup/` - Aggregated funding info (POST)

**Response Structure**: Varies - arrays, counts, or aggregated objects
**Schema Uniformity**: Varies by endpoint

---

### 14. Recipient Endpoints (`/api/v2/recipient/`)

#### 14.1 Recipient List
- **Endpoint**: `/api/v2/recipient/`
- **Method**: POST
- **Description**: Returns list of recipients
- **Request**: Filter object
- **Response Structure**: Paginated array of recipient objects

**Actual Response Example**:
```json
{
    "page_metadata": {
    "page": 1,
    "total": 18245893,
    "limit": 50,
    // ... 4 more fields
  },
    "results": [
    {
    "id": ...,
    "duns": ...,
    "uei": ...,
    // ... 3 more fields
  },
    {
    "id": ...,
    "duns": ...,
    "uei": ...,
    // ... 3 more fields
  },
    {
    "id": ...,
    "duns": ...,
    "uei": ...,
    // ... 3 more fields
  },
    // ... 47 more items
  ]
  }
```

- **Schema Uniformity**: Paginated response

#### 14.2 Recipient Details
- **Endpoint**: `/api/v2/recipient/<HASH_VALUE>/`
- **Method**: GET
- **Description**: Returns individual recipient
- **Response Structure**:
  ```json
  {
    "name": string (nullable),
    "alternate_names": array[string],
    "duns": string (nullable),
    "uei": string (nullable),
    "recipient_id": string,
    "recipient_level": enum["R", "P", "C"],
    "parent_id": string (nullable),
    "parent_name": string (nullable),
    "parent_duns": string (nullable),
    "parent_uei": string (nullable),
    "parents": array[ParentRecipient],
    "location": RecipientLocation,
    "business_types": array[string],
    "total_transaction_amount": number,
    "total_transactions": number,
    "total_face_value_loan_amount": number,
    "total_face_value_loan_transactions": number
  }
  ```
- **Schema Uniformity**: Fixed structure

#### 14.3 Recipient Children
- **Endpoint**: `/api/v2/recipient/children/<DUNS_OR_UEI>/`
- **Method**: GET
- **Description**: Returns recipient details based on DUNS or UEI
- **Response Structure**: Recipient object with children

**Actual Response Example**:
```json
[
    {
    "recipient_id": "ae0ea5cb-55e4-459d-7fc4-ceaae17385b0-C",
    "name": "ART LINE WHOLESALERS, INC",
    "duns": "058675323",
    // ... 3 more fields
  }
  ]
```

- **Schema Uniformity**: Recipient object

#### 14.4 Recipient DUNS
- `/api/v2/recipient/duns/` - List recipients (POST)
- `/api/v2/recipient/duns/<HASH_VALUE>/` - Specific recipient by DUNS (GET)

**Response Structure**: Recipient objects
**Schema Uniformity**: Recipient objects

#### 14.5 Recipient Count
- **Endpoint**: `/api/v2/recipient/count/`
- **Method**: POST
- **Description**: Returns count of recipients for given filters
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "count": 18245893
  }
```

- **Schema Uniformity**: Count response

#### 14.6 Recipient State
- `/api/v2/recipient/state/` - Basic state information (GET)
- `/api/v2/recipient/state/<FIPS>/` - Specific state info (GET)
- `/api/v2/recipient/state/awards/<FIPS>/` - Award breakdown by FIPS (GET)

**Response Structure**: State info objects or award arrays
**Schema Uniformity**: State objects or arrays

---

### 15. References Endpoints (`/api/v2/references/`)

#### 15.1 Reference Data Endpoints
- `/api/v2/references/agency/<AGENCY_ID>/` - Basic agency info (GET)
- `/api/v2/references/assistance_listing/` - All CFDAs (GET)
- `/api/v2/references/award_types/` - Award types map (GET)
- `/api/v2/references/cfda/totals/` - CFDA totals (GET)
- `/api/v2/references/cfda/totals/<CFDA>/` - Specific CFDA totals (GET)
- `/api/v2/references/data_dictionary/` - Data dictionary JSON (GET)
- `/api/v2/references/def_codes/` - DEF Codes and titles (GET)
- `/api/v2/references/filter/` - Filter hash generator (POST)
- `/api/v2/references/hash/` - Filter hash decoder (POST)
- `/api/v2/references/glossary/` - Glossary terms (GET)
- `/api/v2/references/naics/` - All Tier 1 NAICS (GET)
- `/api/v2/references/naics/<NAICS_CODE>/` - Specific NAICS and children (GET)
- `/api/v2/references/submission_periods/` - Available submission periods (GET)
- `/api/v2/references/toptier_agencies/` - All toptier agencies (GET)
- `/api/v2/references/total_budgetary_resources/` - Total budgetary resources (GET)

**Response Structure**: Varies - arrays, objects, or single values
**Schema Uniformity**: Varies by endpoint

#### 15.2 Filter Tree Endpoints
- `/api/v2/references/filter_tree/psc/` - PSC groupings (GET)
- `/api/v2/references/filter_tree/psc/<GROUP>/` - PSC under group (GET)
- `/api/v2/references/filter_tree/psc/<GROUP>/<PSC>/` - PSC under path (GET)
- `/api/v2/references/filter_tree/psc/<GROUP>/<PSC>/<PSC>/` - PSC under path (GET)
- `/api/v2/references/filter_tree/tas/` - Toptier agencies with TAS (GET)
- `/api/v2/references/filter_tree/tas/<AGENCY>/` - Federal accounts for agency (GET)
- `/api/v2/references/filter_tree/tas/<AGENCY>/<FEDERAL_ACCOUNT>/` - TAS for federal account (GET)

**Response Structure**: Arrays of code/description objects
**Schema Uniformity**: Arrays of similar objects

---

### 16. Reporting Endpoints (`/api/v2/reporting/`)

#### 16.1 Reporting Agency Endpoints
- `/api/v2/reporting/agencies/overview/` - Submission data for all agencies (GET)
- `/api/v2/reporting/agencies/publish_dates/` - Publication/certification info (GET)
- `/api/v2/reporting/agencies/<TOPTIER_CODE>/overview/` - Submission data for agency (GET)
- `/api/v2/reporting/agencies/<TOPTIER_CODE>/differences/` - Account balance differences (GET)
- `/api/v2/reporting/agencies/<TOPTIER_CODE>/discrepancies/` - TAS discrepancies (GET)
- `/api/v2/reporting/agencies/<TOPTIER_CODE>/<FISCAL_YEAR>/<FISCAL_PERIOD>/submission_history/` - Submission history (GET)
- `/api/v2/reporting/agencies/<TOPTIER_CODE>/<FISCAL_YEAR>/<FISCAL_PERIOD>/unlinked_awards/<TYPE>/` - Unlinked awards counts (GET)

**Response Structure**: Arrays or objects with submission/reporting data
**Schema Uniformity**: Varies by endpoint

---

### 17. Search Endpoints (`/api/v2/search/`)

#### 17.1 Search Spending by Award
- **Endpoint**: `/api/v2/search/spending_by_award/`
- **Method**: POST
- **Description**: Returns fields of filtered awards
- **Request**: Filter object with `filters`, `fields`, `limit`, `page`, `sort`, `order`, `subawards`
- **Response Structure**:
  ```json
  {
    "spending_level": enum["awards", "subawards"],
    "limit": number,
    "results": array[SpendingByAwardResponse],
    "page_metadata": {
      "page": number,
      "hasNext": boolean,
      "last_record_unique_id": number (optional),
      "last_record_sort_value": string (optional)
    },
    "messages": array[string] (optional)
  }
  ```

**Actual Response Example**:
```json
{
    "spending_level": "awards",
    "limit": 1,
    "results": [
    {
    "internal_id": ...,
    "Award ID": ...,
    "generated_internal_id": ...
  }
  ],
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Paginated response with variable result fields based on requested `fields`

#### 17.2 Search Spending by Award Count
- **Endpoint**: `/api/v2/search/spending_by_award_count/`
- **Method**: POST
- **Description**: Returns number of awards in each award type
- **Response Structure**: Object with counts per award type

**Actual Response Example**:
```json
{
    "results": {
    "contracts": 7361528,
    "direct_payments": 0,
    "grants": 0,
    // ... 3 more fields
  },
    "spending_level": "awards",
    "messages": [
    "For searches, time period start and end dates are currently limited to an earliest date of 2007-1..."
  ]
  }
```

- **Schema Uniformity**: Count object

#### 17.3 Search Spending by Category
- **Endpoint**: `/api/v2/search/spending_by_category/`
- **Method**: POST
- **Description**: Returns top results of specific categories sorted by amounts
- **Request**: `category` (enum), `filters`, `limit`, `page`, `spending_level`
- **Response Structure**:
  ```json
  {
    "category": string,
    "spending_level": enum["transactions", "awards", "subawards", "award_financial"],
    "results": array[{
      "id": number,
      "recipient_id": string (optional, nullable),
      "name": string (nullable),
      "code": string (nullable),
      "amount": number,
      "total_outlays": number (nullable)
    }],
    "limit": number,
    "page_metadata": {
      "page": number,
      "hasNext": boolean
    },
    "messages": array[string] (optional)
  }
  ```
- **Schema Uniformity**: Paginated response with category-specific results

#### 17.4 Search Spending by Category (Specific)
Pattern: `/api/v2/search/spending_by_category/{category}/`
- Categories: `awarding_agency`, `awarding_subagency`, `cfda`, `country`, `county`, `district`, `federal_account`, `funding_agency`, `funding_subagency`, `naics`, `psc`, `recipient`, `recipient_duns`, `state_territory`, `defc`

**Response Structure**: Same as spending_by_category but category-specific
**Schema Uniformity**: Same pattern

#### 17.5 Search Spending by Geography
- **Endpoint**: `/api/v2/search/spending_by_geography/`
- **Method**: POST
- **Description**: Returns spending by state/county/congressional district
- **Response Structure**: Array of geographic spending objects

**Actual Response Example**:
```json
{
    "scope": "place_of_performance",
    "geo_layer": "state",
    "spending_level": "transactions",
    // ... 2 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 17.6 Search Spending by Transaction
- **Endpoint**: `/api/v2/search/spending_by_transaction/`
- **Method**: POST
- **Description**: Returns awards where fields match search term
- **Response Structure**: Array of transaction objects

**Actual Response Example**:
```json
{
    "limit": 10,
    "results": [
    {
    "Award ID": ...,
    "Transaction Amount": ...,
    "Action Date": ...,
    // ... 2 more fields
  },
    {
    "Award ID": ...,
    "Transaction Amount": ...,
    "Action Date": ...,
    // ... 2 more fields
  },
    {
    "Award ID": ...,
    "Transaction Amount": ...,
    "Action Date": ...,
    // ... 2 more fields
  },
    // ... 7 more items
  ],
    "page_metadata": {
    "page": 1,
    "next": 2,
    "previous": null,
    // ... 2 more fields
  },
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 17.7 Search Spending by Transaction Count
- **Endpoint**: `/api/v2/search/spending_by_transaction_count/`
- **Method**: POST
- **Description**: Returns counts of awards matching search
- **Response Structure**: Count

**Actual Response Example**:
```json
{
    "results": {
    "contracts": 8774775,
    "grants": 0,
    "idvs": 0,
    // ... 3 more fields
  }
  }
```

- **Schema Uniformity**: Count response

#### 17.8 Search Spending by Transaction Grouped
- **Endpoint**: `/api/v2/search/spending_by_transaction_grouped/`
- **Method**: POST
- **Description**: Returns transaction info grouped by prime award
- **Response Structure**: Array of grouped transaction objects

**Actual Response Example**:
```json
{
    "limit": 10,
    "results": [
    {
    "award_id": ...,
    "transaction_count": ...,
    "transaction_obligation": ...,
    // ... 1 more fields
  },
    {
    "award_id": ...,
    "transaction_count": ...,
    "transaction_obligation": ...,
    // ... 1 more fields
  },
    {
    "award_id": ...,
    "transaction_count": ...,
    "transaction_obligation": ...,
    // ... 1 more fields
  },
    // ... 7 more items
  ],
    "page_metadata": {
    "page": 1,
    "next": 2,
    "previous": null,
    // ... 2 more fields
  },
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 17.9 Search Spending by Subaward Grouped
- **Endpoint**: `/api/v2/search/spending_by_subaward_grouped/`
- **Method**: POST
- **Description**: Returns award id, subaward count, total subaward obligations
- **Response Structure**: Array of subaward summary objects

**Actual Response Example**:
```json
{
    "limit": 10,
    "results": [
    {
    "award_id": ...,
    "subaward_count": ...,
    "subaward_obligation": ...,
    // ... 1 more fields
  },
    {
    "award_id": ...,
    "subaward_count": ...,
    "subaward_obligation": ...,
    // ... 1 more fields
  },
    {
    "award_id": ...,
    "subaward_count": ...,
    "subaward_obligation": ...,
    // ... 1 more fields
  },
    // ... 7 more items
  ],
    "page_metadata": {
    "page": 1,
    "hasNext": false
  },
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 17.10 Search Spending Over Time
- **Endpoint**: `/api/v2/search/spending_over_time/`
- **Method**: POST
- **Description**: Returns transaction aggregated amounts over time
- **Response Structure**: Array of time period spending objects

**Actual Response Example**:
```json
{
    "group": "fiscal_year",
    "results": [
    {
    "aggregated_amount": ...,
    "time_period": ...,
    "Contract_Obligations": ...,
    // ... 12 more fields
  },
    {
    "aggregated_amount": ...,
    "time_period": ...,
    "Contract_Obligations": ...,
    // ... 12 more fields
  },
    {
    "aggregated_amount": ...,
    "time_period": ...,
    "Contract_Obligations": ...,
    // ... 12 more fields
  },
    // ... 16 more items
  ],
    "spending_level": "transactions",
    // ... 1 more fields
  }
```

- **Schema Uniformity**: Array of similar objects

#### 17.11 Search New Awards Over Time
- **Endpoint**: `/api/v2/search/new_awards_over_time/`
- **Method**: POST
- **Description**: Returns time periods with new awards
- **Response Structure**: Array of time period award count objects
- **Schema Uniformity**: Array of similar objects

#### 17.12 Search Transaction Spending Summary
- **Endpoint**: `/api/v2/search/transaction_spending_summary/`
- **Method**: POST
- **Description**: Returns number of transactions and sum of obligations
- **Response Structure**: Summary object with counts and totals

**Actual Response Example**:
```json
{
    "results": {
    "prime_awards_count": 1626341,
    "prime_awards_obligation_amount": 543925123825.58
  }
  }
```

- **Schema Uniformity**: Summary object

---

### 18. Spending Endpoints (`/api/v2/spending/`)

#### 18.1 Spending
- **Endpoint**: `/api/v2/spending/`
- **Method**: POST
- **Description**: Returns spending data through various types and filters
- **Request**: Filter object with spending type
- **Response Structure**: Varies based on spending type requested

**Actual Response Example**:
```json
{
    "total": 1678169436797.48,
    "end_date": "2018-12-31T00:00:00Z",
    "results": [
    {
    "amount": ...,
    "id": ...,
    "type": ...,
    // ... 2 more fields
  },
    {
    "amount": ...,
    "id": ...,
    "type": ...,
    // ... 2 more fields
  },
    {
    "amount": ...,
    "id": ...,
    "type": ...,
    // ... 2 more fields
  },
    // ... 17 more items
  ]
  }
```

- **Schema Uniformity**: Varies

---

### 19. Subawards Endpoints (`/api/v2/subawards/`)

#### 19.1 Subawards
- **Endpoint**: `/api/v2/subawards/`
- **Method**: POST
- **Description**: Returns subawards related to parent award or all
- **Request**: Filter object with optional `award_id`
- **Response Structure**: Array of subaward objects

**Actual Response Example**:
```json
{
    "page_metadata": {
    "page": 1,
    "next": 2,
    "previous": null,
    // ... 2 more fields
  },
    "results": [
    {
    "id": ...,
    "subaward_number": ...,
    "description": ...,
    // ... 3 more fields
  },
    {
    "id": ...,
    "subaward_number": ...,
    "description": ...,
    // ... 3 more fields
  },
    {
    "id": ...,
    "subaward_number": ...,
    "description": ...,
    // ... 3 more fields
  },
    // ... 7 more items
  ]
  }
```

- **Schema Uniformity**: Array of similar objects

---

### 20. Transactions Endpoints (`/api/v2/transactions/`)

#### 20.1 Transactions
- **Endpoint**: `/api/v2/transactions/`
- **Method**: POST
- **Description**: Returns transactions related to specific parent award
- **Request**: `{ "award_id": string, "limit": number, "page": number, "sort": string, "order": enum }`
- **Response Structure**:
  ```json
  {
    "results": array[{
      "id": string,
      "type": string,
      "type_description": string (nullable),
      "action_date": string,
      "action_type": string (nullable),
      "action_type_description": string (nullable),
      "modification_number": string,
      "description": string (nullable),
      "federal_action_obligation": number (nullable),
      "face_value_loan_guarantee": number (nullable),
      "original_loan_subsidy_cost": number (nullable),
      "cfda_number": string (optional, nullable)
    }],
    "page_metadata": {
      "page": number,
      "next": number (nullable),
      "previous": number (nullable),
      "hasNext": boolean,
      "hasPrevious": boolean
    }
  }
  ```

**Actual Response Example**:
```json
{
    "page_metadata": {
    "page": 1,
    "next": null,
    "previous": null,
    // ... 2 more fields
  },
    "results": [
    {
    "id": ...,
    "type": ...,
    "type_description": ...,
    // ... 8 more fields
  }
  ]
  }
```

- **Schema Uniformity**: Paginated response with fixed transaction structure

---

## Summary of Schema Variations

### Highly Uniform Endpoints (Fixed Structure)
- Agency overview and summary endpoints
- Count endpoints (always return simple counts)
- Reference data endpoints (arrays of similar objects)
- Autocomplete endpoints (arrays of match objects)

### Moderately Uniform Endpoints (Similar Structures)
- Search endpoints (paginated arrays with consistent metadata)
- Federal account endpoints (account objects with variations)
- Disaster endpoints (arrays with disaster-specific fields)

### Non-Uniform Endpoints (Variable Structures)
- **Award Details** (`/api/v2/awards/<AWARD_ID>/`): Three distinct response types (Contract, IDV, FinancialAssistance)
- **Search Spending by Award**: Response fields vary based on requested `fields` parameter
- **Download/Bulk Download**: Job status responses with varying metadata

### Common Nested Structures (Appear Across Multiple Endpoints)
- **Agency Objects**: `{ id, has_agency_page, toptier_agency, subtier_agency, office_agency_name }`
- **Recipient Objects**: `{ recipient_name, recipient_hash, recipient_uei, recipient_unique_id, location, business_categories, ... }`
- **Location Objects**: `{ address_line1-3, city_name, state_code, county_code, zip5, zip4, country_code, congressional_code, ... }`
- **Period of Performance**: `{ start_date, end_date, last_modified_date, potential_end_date }`
- **NAICS Hierarchy**: `{ toptier_code, midtier_code, base_code }` (each with `code` and `description`)
- **PSC Hierarchy**: `{ toptier_code, midtier_code, subtier_code, base_code }`
- **DEFC Amount**: `{ code, amount }`

---

## Implementation Recommendations

### 1. DynamoDB Table Design

**Table Name**: `usaspending_api_cache`

**Primary Key Structure**:
- **Partition Key (PK)**: `endpoint_path` (e.g., `api/v2/awards/CONT_AWD_123`)
- **Sort Key (SK)**: `request_hash#timestamp` (e.g., `abc123#2025-01-15T10:30:00Z`)

**Global Secondary Indexes (GSI)**:
1. **GSI1**: `endpoint_type#fiscal_year` - For time-based queries
   - PK: `endpoint_type` (e.g., `agency`, `award`, `search`)
   - SK: `fiscal_year#timestamp`
2. **GSI2**: `award_id#timestamp` - For award-specific lookups
   - PK: `award_id` (when applicable)
   - SK: `timestamp`
3. **GSI3**: `recipient_id#timestamp` - For recipient-specific lookups
   - PK: `recipient_id` (when applicable)
   - SK: `timestamp`

**Attributes**:
- `response_data` (Map): Full JSON response from API
- `request_params` (Map): Request parameters used
- `endpoint_type` (String): Category of endpoint
- `fiscal_year` (Number): Fiscal year if applicable
- `award_id` (String): Award ID if applicable
- `recipient_id` (String): Recipient ID if applicable
- `ttl` (Number): Time-to-live for cache expiration
- `created_at` (String): ISO timestamp
- `response_size` (Number): Size of response in bytes

### 2. Lambda Function Structure

**Function**: `usaspending-api-handler`

**Responsibilities**:
1. Accept API requests with endpoint path and parameters
2. Generate request hash for caching
3. Check DynamoDB cache first
4. If cache miss, call USAspending API
5. Store response in DynamoDB
6. Return response to caller

**Input**:
```json
{
  "endpoint_path": "api/v2/awards/CONT_AWD_123",
  "method": "GET",
  "params": {},
  "force_refresh": false
}
```

**Output**:
```json
{
  "cached": true,
  "response_data": { ... },
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 3. API Gateway Endpoint

**Endpoint**: `/api/usaspending/{endpoint_path+}`

**Method**: GET/POST (proxies to Lambda)

**Query Parameters**:
- `force_refresh`: Boolean to bypass cache
- `fiscal_year`: For time-based filtering
- Other endpoint-specific params

### 4. Caching Strategy

- **TTL**: 24 hours for most endpoints
- **Shorter TTL**: 1 hour for frequently updated data (awards, transactions)
- **Longer TTL**: 7 days for reference data (agencies, NAICS, PSC codes)
- **Cache Invalidation**: On-demand via `force_refresh` parameter

### 5. Error Handling

- Store error responses in cache with shorter TTL (5 minutes)
- Retry logic for transient failures
- Fallback to cached data if API is unavailable

---

## Next Steps

1. Create DynamoDB table with recommended structure
2. Implement Lambda function for API proxying and caching
3. Set up API Gateway endpoint
4. Create indexing service for AI agent queries
5. Implement cache warming for frequently accessed endpoints
6. Add monitoring and alerting for API health

