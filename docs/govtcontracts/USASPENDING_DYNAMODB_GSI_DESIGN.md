# USAspending DynamoDB GSI Design

## Overview

This document maps out all Global Secondary Indexes (GSIs) needed for the `usaspending-awards-index` DynamoDB table to support:
1. **API Search Patterns**: Fast lookups matching USAspending API filter capabilities
2. **Agent Analysis Queries**: Top N queries, aggregations, trend analysis
3. **Common User Searches**: Most frequent search patterns

---

## Query Patterns Analysis

### Common Search Patterns (from USAspending API)
1. **Recipient Search**: "All contracts for Lockheed Martin" (most common)
2. **Agency Search**: "All contracts from Department of Defense"
3. **Fiscal Year Filter**: "Contracts in FY 2023"
4. **Date Range**: "Contracts from 2020-01-01 to 2023-12-31"
5. **Industry (NAICS)**: "All contracts in Aerospace industry"
6. **Product/Service (PSC)**: "All contracts for IT services"
7. **State/Location**: "All contracts in California"
8. **Award Type**: "All IDV contracts"
9. **Amount Range**: "Contracts over $10M"
10. **Program (CFDA)**: "All financial assistance for program X"

### Agent Analysis Queries
1. **Top N Recipients**: "Top 10 companies by total contract value"
2. **Top N Agencies**: "Top 10 agencies by spending"
3. **Top N Awards**: "Top 10 largest contracts"
4. **Trend Analysis**: "Spending trends by fiscal year"
5. **Industry Analysis**: "Contracts by NAICS code"
6. **Geographic Analysis**: "Contracts by state"
7. **Time-based Analysis**: "Contracts by month/quarter"

---

## GSI Design Strategy

### Key Principles
1. **Hash Key**: What we're querying by (e.g., `recipient_id`, `awarding_agency_code`)
2. **Sort Key**: What we're sorting/filtering by (e.g., `fiscal_year`, `total_obligation`)
3. **Composite Queries**: Use hash + sort key together for efficient queries
4. **Top N Queries**: Use sort key with descending order (e.g., `total_obligation DESC`)

### GSI Naming Convention
- Format: `{Entity}{SortField}Index`
- Examples: `RecipientFiscalYearIndex`, `AgencyObligationIndex`

---

## Proposed GSIs

### 1. RecipientFiscalYearIndex ⭐⭐⭐ (CRITICAL)
- **Hash Key**: `recipient_id` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All contracts for recipient X in FY 2023"
  - "All contracts for recipient X across all years"
  - Agent: "Show me all Lockheed Martin contracts"
- **Query Example**:
  ```python
  # All contracts for recipient in specific year
  query(IndexName='RecipientFiscalYearIndex',
        KeyConditionExpression='recipient_id = :rid AND fiscal_year = :fy',
        ExpressionAttributeValues={':rid': 'recipient_123', ':fy': 2023})
  
  # All contracts for recipient (all years)
  query(IndexName='RecipientFiscalYearIndex',
        KeyConditionExpression='recipient_id = :rid',
        ExpressionAttributeValues={':rid': 'recipient_123'})
  ```

### 2. RecipientObligationIndex ⭐⭐ (TOP N QUERIES)
- **Hash Key**: `recipient_id` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top contracts for recipient X"
  - Agent: "What are Lockheed Martin's largest contracts?"
- **Query Example**:
  ```python
  # Top 10 contracts for recipient
  query(IndexName='RecipientObligationIndex',
        KeyConditionExpression='recipient_id = :rid',
        ExpressionAttributeValues={':rid': 'recipient_123'},
        ScanIndexForward=False,  # Descending
        Limit=10)
  ```

### 3. AwardingAgencyFiscalYearIndex ⭐⭐⭐ (CRITICAL)
- **Hash Key**: `awarding_agency_code` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All contracts from Department of Defense in FY 2023"
  - Agent: "Show me all DOD contracts"
- **Query Example**:
  ```python
  query(IndexName='AwardingAgencyFiscalYearIndex',
        KeyConditionExpression='awarding_agency_code = :code AND fiscal_year = :fy',
        ExpressionAttributeValues={':code': '089', ':fy': 2023})
  ```

### 4. AwardingAgencyObligationIndex ⭐⭐ (TOP N QUERIES)
- **Hash Key**: `awarding_agency_code` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top contracts from agency X"
  - Agent: "What are DOD's largest contracts?"
- **Query Example**:
  ```python
  query(IndexName='AwardingAgencyObligationIndex',
        KeyConditionExpression='awarding_agency_code = :code',
        ExpressionAttributeValues={':code': '089'},
        ScanIndexForward=False,
        Limit=10)
  ```

### 5. FiscalYearObligationIndex ⭐⭐⭐ (TOP N QUERIES - GLOBAL)
- **Hash Key**: `fiscal_year` (number)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top 10 largest contracts in FY 2023"
  - Agent: "What were the biggest contracts last year?"
- **Query Example**:
  ```python
  query(IndexName='FiscalYearObligationIndex',
        KeyConditionExpression='fiscal_year = :fy',
        ExpressionAttributeValues={':fy': 2023},
        ScanIndexForward=False,
        Limit=10)
  ```

### 6. FiscalYearStartDateIndex ⭐ (DATE RANGE)
- **Hash Key**: `fiscal_year` (number)
- **Sort Key**: `period_start_date` (string, ISO format: YYYY-MM-DD)
- **Projection**: ALL
- **Use Cases**:
  - "Contracts starting in Q1 2023"
  - Date range queries within a fiscal year
- **Query Example**:
  ```python
  query(IndexName='FiscalYearStartDateIndex',
        KeyConditionExpression='fiscal_year = :fy AND period_start_date BETWEEN :start AND :end',
        ExpressionAttributeValues={
            ':fy': 2023,
            ':start': '2023-01-01',
            ':end': '2023-03-31'
        })
  ```

### 7. NAICSCodeFiscalYearIndex ⭐⭐ (INDUSTRY ANALYSIS)
- **Hash Key**: `naics_code` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All contracts in Aerospace industry (NAICS 3364) in FY 2023"
  - Agent: "Show me all IT services contracts"
- **Query Example**:
  ```python
  query(IndexName='NAICSCodeFiscalYearIndex',
        KeyConditionExpression='naics_code = :code AND fiscal_year = :fy',
        ExpressionAttributeValues={':code': '336411', ':fy': 2023})
  ```

### 8. NAICSCodeObligationIndex ⭐ (TOP N BY INDUSTRY)
- **Hash Key**: `naics_code` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top contracts in Aerospace industry"
  - Agent: "What are the largest IT services contracts?"
- **Query Example**:
  ```python
  query(IndexName='NAICSCodeObligationIndex',
        KeyConditionExpression='naics_code = :code',
        ExpressionAttributeValues={':code': '336411'},
        ScanIndexForward=False,
        Limit=10)
  ```

### 9. PSCCodeFiscalYearIndex ⭐⭐ (PRODUCT/SERVICE ANALYSIS)
- **Hash Key**: `psc_code` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All IT services contracts (PSC D302) in FY 2023"
  - Agent: "Show me all professional services contracts"
- **Query Example**:
  ```python
  query(IndexName='PSCCodeFiscalYearIndex',
        KeyConditionExpression='psc_code = :code AND fiscal_year = :fy',
        ExpressionAttributeValues={':code': 'D302', ':fy': 2023})
  ```

### 10. PSCCodeObligationIndex ⭐ (TOP N BY PRODUCT/SERVICE)
- **Hash Key**: `psc_code` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top IT services contracts"
- **Query Example**:
  ```python
  query(IndexName='PSCCodeObligationIndex',
        KeyConditionExpression='psc_code = :code',
        ExpressionAttributeValues={':code': 'D302'},
        ScanIndexForward=False,
        Limit=10)
  ```

### 11. StateFiscalYearIndex ⭐⭐ (GEOGRAPHIC ANALYSIS)
- **Hash Key**: `recipient_location_state` (string, 2-letter code)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All contracts in California in FY 2023"
  - Agent: "Show me all contracts in Texas"
- **Query Example**:
  ```python
  query(IndexName='StateFiscalYearIndex',
        KeyConditionExpression='recipient_location_state = :state AND fiscal_year = :fy',
        ExpressionAttributeValues={':state': 'CA', ':fy': 2023})
  ```

### 12. StateObligationIndex ⭐ (TOP N BY STATE)
- **Hash Key**: `recipient_location_state` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top contracts in California"
  - Agent: "What are the largest contracts in each state?"
- **Query Example**:
  ```python
  query(IndexName='StateObligationIndex',
        KeyConditionExpression='recipient_location_state = :state',
        ExpressionAttributeValues={':state': 'CA'},
        ScanIndexForward=False,
        Limit=10)
  ```

### 13. AwardTypeFiscalYearIndex ⭐ (AWARD TYPE FILTER)
- **Hash Key**: `award_type` (string: "contract", "idv", "financial_assistance")
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All IDV contracts in FY 2023"
  - Agent: "Show me all financial assistance awards"
- **Query Example**:
  ```python
  query(IndexName='AwardTypeFiscalYearIndex',
        KeyConditionExpression='award_type = :type AND fiscal_year = :fy',
        ExpressionAttributeValues={':type': 'idv', ':fy': 2023})
  ```

### 14. AwardTypeObligationIndex ⭐ (TOP N BY TYPE)
- **Hash Key**: `award_type` (string)
- **Sort Key**: `total_obligation` (number, descending)
- **Projection**: ALL
- **Use Cases**:
  - "Top IDV contracts"
- **Query Example**:
  ```python
  query(IndexName='AwardTypeObligationIndex',
        KeyConditionExpression='award_type = :type',
        ExpressionAttributeValues={':type': 'contract'},
        ScanIndexForward=False,
        Limit=10)
  ```

### 15. CFDANumberFiscalYearIndex ⭐ (FINANCIAL ASSISTANCE)
- **Hash Key**: `cfda_number` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All awards for CFDA program 12.345 in FY 2023"
  - Agent: "Show me all grants for program X"
- **Query Example**:
  ```python
  query(IndexName='CFDANumberFiscalYearIndex',
        KeyConditionExpression='cfda_number = :cfda AND fiscal_year = :fy',
        ExpressionAttributeValues={':cfda': '12.345', ':fy': 2023})
  ```

### 16. RecipientNameFiscalYearIndex ⭐ (FALLBACK SEARCH)
- **Hash Key**: `recipient_name_normalized` (string, lowercase, normalized)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - Fallback when `recipient_id` is unknown
  - Text-based recipient search
- **Query Example**:
  ```python
  query(IndexName='RecipientNameFiscalYearIndex',
        KeyConditionExpression='recipient_name_normalized = :name AND fiscal_year = :fy',
        ExpressionAttributeValues={':name': 'lockheed martin', ':fy': 2023})
  ```

### 17. FundingAgencyFiscalYearIndex ⭐ (FUNDING AGENCY)
- **Hash Key**: `funding_agency_code` (string)
- **Sort Key**: `fiscal_year` (number)
- **Projection**: ALL
- **Use Cases**:
  - "All contracts funded by agency X"
  - Different from awarding agency (can be different)
- **Query Example**:
  ```python
  query(IndexName='FundingAgencyFiscalYearIndex',
        KeyConditionExpression='funding_agency_code = :code AND fiscal_year = :fy',
        ExpressionAttributeValues={':code': '089', ':fy': 2023})
  ```

---

## GSI Summary Table

| # | GSI Name | Hash Key | Sort Key | Priority | Use Case |
|---|----------|----------|----------|----------|----------|
| 1 | RecipientFiscalYearIndex | `recipient_id` | `fiscal_year` | ⭐⭐⭐ | Most common search |
| 2 | RecipientObligationIndex | `recipient_id` | `total_obligation` (DESC) | ⭐⭐ | Top N by recipient |
| 3 | AwardingAgencyFiscalYearIndex | `awarding_agency_code` | `fiscal_year` | ⭐⭐⭐ | Agency search |
| 4 | AwardingAgencyObligationIndex | `awarding_agency_code` | `total_obligation` (DESC) | ⭐⭐ | Top N by agency |
| 5 | FiscalYearObligationIndex | `fiscal_year` | `total_obligation` (DESC) | ⭐⭐⭐ | Global top N |
| 6 | FiscalYearStartDateIndex | `fiscal_year` | `period_start_date` | ⭐ | Date range |
| 7 | NAICSCodeFiscalYearIndex | `naics_code` | `fiscal_year` | ⭐⭐ | Industry search |
| 8 | NAICSCodeObligationIndex | `naics_code` | `total_obligation` (DESC) | ⭐ | Top N by industry |
| 9 | PSCCodeFiscalYearIndex | `psc_code` | `fiscal_year` | ⭐⭐ | Product/service search |
| 10 | PSCCodeObligationIndex | `psc_code` | `total_obligation` (DESC) | ⭐ | Top N by PSC |
| 11 | StateFiscalYearIndex | `recipient_location_state` | `fiscal_year` | ⭐⭐ | Geographic search |
| 12 | StateObligationIndex | `recipient_location_state` | `total_obligation` (DESC) | ⭐ | Top N by state |
| 13 | AwardTypeFiscalYearIndex | `award_type` | `fiscal_year` | ⭐ | Award type filter |
| 14 | AwardTypeObligationIndex | `award_type` | `total_obligation` (DESC) | ⭐ | Top N by type |
| 15 | CFDANumberFiscalYearIndex | `cfda_number` | `fiscal_year` | ⭐ | Financial assistance |
| 16 | RecipientNameFiscalYearIndex | `recipient_name_normalized` | `fiscal_year` | ⭐ | Fallback search |
| 17 | FundingAgencyFiscalYearIndex | `funding_agency_code` | `fiscal_year` | ⭐ | Funding agency |

**Total GSIs**: 17

---

## Implementation Notes

### Required Attributes in Awards Table
All GSI hash and sort keys must be present in the award record:
- `recipient_id` (string)
- `recipient_name_normalized` (string, lowercase, normalized)
- `awarding_agency_code` (string)
- `funding_agency_code` (string)
- `fiscal_year` (number)
- `total_obligation` (number)
- `period_start_date` (string, ISO format)
- `naics_code` (string, nullable)
- `psc_code` (string, nullable)
- `cfda_number` (string, nullable, for financial assistance only)
- `recipient_location_state` (string, 2-letter code, nullable)
- `award_type` (string: "contract", "idv", "financial_assistance")

### Nullable Fields
- `naics_code`: Not all awards have NAICS (financial assistance may not)
- `psc_code`: Not all awards have PSC (financial assistance may not)
- `cfda_number`: Only financial assistance awards have CFDA
- `recipient_location_state`: May be missing for some awards

**Important**: DynamoDB GSIs cannot have NULL or empty string values. If a field is missing:
- **Option 1**: Omit the attribute from the item (recommended)
- **Option 2**: Use a sentinel value like "N/A" or "UNKNOWN" (not recommended for sort keys)

### Projection Strategy
- **ALL**: Project all attributes (recommended for most GSIs)
  - Allows full award data without additional DynamoDB read
  - Higher storage cost, but better query performance
- **KEYS_ONLY**: Only project hash/sort keys (for very large tables)
  - Lower storage cost
  - Requires additional DynamoDB read to get full award data

### Read/Write Capacity
- **Read Capacity**: Start with 5-10 units per GSI (adjust based on usage)
- **Write Capacity**: Start with 5 units per GSI (adjust based on indexing load)
- **On-Demand**: Consider using on-demand billing for variable workloads

---

## Query Examples for Agent

### Example 1: "Top 10 companies by total contract value"
```python
# Use FiscalYearObligationIndex to get top contracts globally
# Then group by recipient_id and sum
# Or use RecipientObligationIndex for each recipient and aggregate
```

### Example 2: "All Lockheed Martin contracts in 2023"
```python
query(IndexName='RecipientFiscalYearIndex',
      KeyConditionExpression='recipient_id = :rid AND fiscal_year = :fy',
      ExpressionAttributeValues={':rid': 'lockheed_recipient_id', ':fy': 2023})
```

### Example 3: "Top 10 largest contracts in Aerospace industry"
```python
query(IndexName='NAICSCodeObligationIndex',
      KeyConditionExpression='naics_code = :code',
      ExpressionAttributeValues={':code': '336411'},
      ScanIndexForward=False,
      Limit=10)
```

### Example 4: "All DOD contracts over $10M in FY 2023"
```python
query(IndexName='AwardingAgencyFiscalYearIndex',
      KeyConditionExpression='awarding_agency_code = :code AND fiscal_year = :fy',
      FilterExpression='total_obligation >= :min',
      ExpressionAttributeValues={
          ':code': '089',
          ':fy': 2023,
          ':min': 10000000
      })
```

---

## Cost Considerations

### Storage Cost
- Each GSI stores a copy of the item (or projected attributes)
- 17 GSIs × average item size = significant storage overhead
- **Mitigation**: Use KEYS_ONLY projection for less-used GSIs

### Read/Write Capacity
- Each GSI requires separate read/write capacity
- 17 GSIs × 5 units = 85 read capacity units minimum
- **Mitigation**: Use on-demand billing, or adjust capacity based on actual usage

### Query Performance
- GSIs enable fast queries (milliseconds)
- Without GSIs, would require full table scans (expensive, slow)
- **Benefit**: Fast queries justify the storage/capacity cost

---

## Phase 1 Implementation (MVP)

Start with the most critical GSIs:
1. RecipientFiscalYearIndex ⭐⭐⭐
2. AwardingAgencyFiscalYearIndex ⭐⭐⭐
3. FiscalYearObligationIndex ⭐⭐⭐
4. RecipientObligationIndex ⭐⭐
5. AwardingAgencyObligationIndex ⭐⭐

Add remaining GSIs in Phase 2 based on actual usage patterns.

