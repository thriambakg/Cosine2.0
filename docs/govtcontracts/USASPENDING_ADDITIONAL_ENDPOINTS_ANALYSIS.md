# Additional USAspending Endpoints - Use Case Analysis

## Overview

This document analyzes additional USAspending API endpoints beyond the core search, autocomplete, and download functionality to identify valuable use cases we might be missing.

## Currently Covered

✅ **Autocomplete Endpoints** - Building valid queries  
✅ **Search Endpoints** - Finding contracts/awards  
✅ **Download Endpoints** - Getting exact details  

---

## Additional Endpoints with High Value Use Cases

### 1. Transactions Endpoints (`/api/v2/transactions/`)

**Endpoint**: `/api/v2/transactions/` (POST)

**Use Case**: **Transaction History for Contracts**

**Why Important**:
- Contracts have multiple transactions (modifications, payments, adjustments)
- Users need to see the complete transaction timeline for a contract
- Each transaction shows: action date, type, obligation amount, modification number
- Critical for understanding contract evolution and payment history

**Example Scenarios**:
- User views a contract → Wants to see all modifications and payments
- User analyzes contract changes over time
- User tracks payment schedule for a contract

**Implementation**:
- When user views award details, show "View Transactions" button
- Fetch transactions for that award_id
- Display in a timeline or table format
- Could be indexed alongside awards (foreign key: award_id)

**Recommendation**: **HIGH PRIORITY** - Essential for complete contract analysis

---

### 2. Subawards Endpoints (`/api/v2/subawards/`)

**Endpoint**: `/api/v2/subawards/` (POST)

**Use Case**: **Subcontracting Relationships**

**Why Important**:
- Prime contractors often subcontract work
- Users need to see the full subcontracting chain
- Important for understanding who actually performs the work
- Shows subaward amount, subawardee name, description

**Example Scenarios**:
- User views a contract → Wants to see who the prime contractor subcontracted to
- User analyzes subcontracting patterns
- User tracks subcontractor relationships

**Implementation**:
- When user views award details, show "View Subawards" button
- Fetch subawards for that award_id
- Display in a table showing subawardee, amount, description
- Could be indexed alongside awards (foreign key: award_id)

**Recommendation**: **HIGH PRIORITY** - Important for understanding contract relationships

---

### 3. Recipient Endpoints (`/api/v2/recipient/`)

**Endpoints**:
- `/api/v2/recipient/<RECIPIENT_ID>/` - Recipient details
- `/api/v2/recipient/` - List recipients (POST with filters)
- `/api/v2/recipient/children/<DUNS_OR_UEI>/` - Recipient hierarchy

**Use Case**: **Recipient/Company Profiles**

**Why Important**:
- Users want to see all contracts for a specific company/recipient
- Recipient details include: name, location, business types, parent/child relationships
- Shows total transaction amounts and counts
- Important for company-level analysis

**Example Scenarios**:
- User searches for "Lockheed Martin" → Wants to see all their contracts
- User views a contract → Clicks on recipient name → Sees recipient profile
- User analyzes a company's contract portfolio
- User tracks parent/subsidiary relationships

**Implementation**:
- Add "View Recipient Profile" link in search results
- Recipient profile page showing:
  - Basic info (name, location, business types)
  - All awards for this recipient (use search with recipient_id filter)
  - Parent/child relationships
  - Total spending statistics
- Could index recipient details (separate table or part of award index)

**Recommendation**: **MEDIUM-HIGH PRIORITY** - Very useful for company-level analysis

---

### 4. Reference Endpoints (`/api/v2/references/`)

**Key Endpoints**:
- `/api/v2/references/award_types/` - Award types map
- `/api/v2/references/data_dictionary/` - Data dictionary
- `/api/v2/references/glossary/` - Glossary terms
- `/api/v2/references/naics/<NAICS_CODE>/` - NAICS hierarchy
- `/api/v2/references/toptier_agencies/` - All agencies

**Use Case**: **UI Enhancement & Validation**

**Why Important**:
- **Award Types Map**: Translate award type codes (A, B, C, D, etc.) to human-readable names
- **Data Dictionary**: Understand what each field means (tooltips, help text)
- **Glossary**: Explain terminology (e.g., "obligation", "outlay", "DEFC")
- **NAICS/PSC Hierarchies**: Show category trees for filtering
- **Agency List**: Pre-populate agency dropdowns

**Example Scenarios**:
- User sees award type "A" → Tooltip shows "Definitive Contract"
- User hovers over "total_obligation" → Tooltip explains what it means
- User filters by NAICS → Shows hierarchical category tree
- User selects agency → Dropdown shows all available agencies

**Implementation**:
- Cache reference data (long TTL - 7-30 days)
- Use for:
  - UI labels and tooltips
  - Filter dropdowns
  - Help text and documentation
  - Data validation

**Recommendation**: **MEDIUM PRIORITY** - Improves UX significantly but not critical for core functionality

---

### 5. Agency Endpoints (`/api/v2/agency/`)

**Key Endpoints**:
- `/api/v2/agency/<TOPTIER_AGENCY_CODE>/` - Agency overview
- `/api/v2/agency/<TOPTIER_AGENCY_CODE>/awards/` - Agency summary

**Use Case**: **Agency Context & Profiles**

**Why Important**:
- Users want to understand agency context when viewing contracts
- Agency overview shows: mission, website, budgetary resources
- Agency summary shows: total obligations, transaction counts
- Useful for agency-level analysis

**Example Scenarios**:
- User views a contract → Wants to see agency details
- User filters by agency → Wants to see agency spending summary
- User analyzes spending by agency

**Implementation**:
- Add "View Agency Profile" link in search results
- Agency profile page showing:
  - Basic info (name, mission, website)
  - Spending summary (total obligations, transaction counts)
  - All awards for this agency (use search with agency filter)
- Cache agency data (medium TTL - 24 hours)

**Recommendation**: **MEDIUM PRIORITY** - Nice to have for context, but not essential

---

### 6. Award-Specific Endpoints (`/api/v2/awards/`)

**Additional Endpoints**:
- `/api/v2/awards/accounts/` - Federal accounts for award
- `/api/v2/awards/funding/` - Funding details
- `/api/v2/awards/funding_rollup/` - Aggregated funding

**Use Case**: **Detailed Award Analysis**

**Why Important**:
- Shows which federal accounts funded the award
- Shows funding agency breakdown
- Important for financial tracking and accountability

**Example Scenarios**:
- User views award → Wants to see funding sources
- User analyzes funding patterns
- User tracks federal account usage

**Implementation**:
- Add "View Funding Details" section in award details page
- Fetch funding/accounts when viewing award
- Display in a table or breakdown chart

**Recommendation**: **LOW-MEDIUM PRIORITY** - Useful for detailed analysis but not core functionality

---

## Summary & Recommendations

### High Priority (Implement Soon)

1. **Transactions Endpoints** ⭐⭐⭐
   - Essential for complete contract analysis
   - Shows modification history and payment timeline
   - Should be indexed alongside awards

2. **Subawards Endpoints** ⭐⭐⭐
   - Important for understanding subcontracting relationships
   - Shows who actually performs the work
   - Should be indexed alongside awards

### Medium Priority (Implement Later)

3. **Recipient Endpoints** ⭐⭐
   - Very useful for company-level analysis
   - Enables recipient profile pages
   - Can enhance search results with recipient links

4. **Reference Endpoints** ⭐⭐
   - Improves UX significantly
   - Enables tooltips, help text, validation
   - Should be cached (long TTL)

### Low Priority (Nice to Have)

5. **Agency Endpoints** ⭐
   - Provides context but not essential
   - Can enhance search results with agency links

6. **Award Funding Endpoints** ⭐
   - Useful for detailed financial analysis
   - Not needed for basic contract search

---

## Implementation Strategy

### Phase 1 (Core - Already Planned)
- ✅ Search endpoints
- ✅ Autocomplete endpoints
- ✅ Download endpoints

### Phase 2 (Essential Details)
- ⭐ Transactions endpoints
- ⭐ Subawards endpoints

### Phase 3 (Enhanced UX)
- ⭐⭐ Recipient endpoints
- ⭐⭐ Reference endpoints (cached)

### Phase 4 (Nice to Have)
- ⭐ Agency endpoints
- ⭐ Award funding endpoints

---

## Data Indexing Strategy

### Should Index:
1. **Transactions** - Index in `usaspending-transactions-index` (already planned)
2. **Subawards** - Consider separate table or add to awards table
3. **Recipients** - Could index recipient details, or fetch on-demand

### Should Cache (Not Index):
1. **Reference Data** - Cache with long TTL (7-30 days)
2. **Agency Data** - Cache with medium TTL (24 hours)
3. **Award Funding** - Fetch on-demand when viewing award details

---

## Frontend Integration Points

### Search Results Enhancements:
- Add "View Transactions" button → Opens transactions modal/page
- Add "View Subawards" button → Opens subawards modal/page
- Add "View Recipient Profile" link → Opens recipient profile page
- Add "View Agency Profile" link → Opens agency profile page

### Award Details Page:
- Tabs: Overview | Transactions | Subawards | Funding
- Reference data used for tooltips and labels

### New Pages:
- Recipient Profile Page
- Agency Profile Page

---

## Conclusion

**Missing Critical Endpoints**:
1. **Transactions** - Essential for contract analysis
2. **Subawards** - Important for relationship understanding

**Missing UX Enhancements**:
3. **Recipients** - Company-level analysis
4. **References** - Better user experience

These should be added to the design document and implementation plan.

