# USAspending Search Fields: General vs Advanced

This document categorizes searchable fields into **General Search** (common use cases) and **Advanced Search** (specialized/complex filters).

---

## General Search Fields (Primary Search Interface)

These fields cover 80-90% of typical user searches and should be prominently displayed:

### Core Search Fields
1. **Recipient** (`recipient_search_text`)
   - Who received the award
   - Most common search: "Find all contracts for Company X"
   - ✅ Has autocomplete

2. **Award Amount** (`award_amounts`)
   - Financial range filter
   - Common: "Contracts over $1M"
   - Manual input (number range)

3. **Time Period** (`time_period`)
   - Date range filter
   - Common: "Contracts from 2020-2023"
   - Manual input (date picker)

4. **Keywords** (`keywords`)
   - Free text search across multiple fields
   - Common: "software", "defense", "research"
   - Manual input (text field)

5. **Awarding Agency** (`agencies` with type="awarding")
   - Which agency awarded the contract
   - Common: "Department of Defense contracts"
   - ✅ Has autocomplete

6. **Award Type** (`award_type_codes`)
   - Contract vs Grant vs Loan
   - Common: "Show only contracts" or "Show only grants"
   - 📋 Reference data (dropdown/checkboxes)

7. **Place of Performance** (`place_of_performance_locations`)
   - Where work is performed
   - Common: "Contracts in California"
   - ✅ Has autocomplete (location)

8. **Description** (`description`)
   - What the contract is about
   - Common: Search contract descriptions
   - Manual input (text field)

---

## Advanced Search Fields (Advanced Filters Section)

These fields are specialized, technical, or less commonly used:

### Financial/Account Fields (Technical)
1. **Funding Agency** (`agencies` with type="funding")
   - Less common than awarding agency
   - Advanced: "Contracts funded by X but awarded by Y"
   - ✅ Has autocomplete

2. **Treasury Account Symbol (TAS)** (`tas_codes`, `treasury_account_components`)
   - Very technical, government accounting codes
   - Advanced: Financial tracking and reporting
   - 🏦 Has account autocomplete (7 sub-fields)

3. **Program Activity** (`program_activity`, `program_activities`)
   - Government program tracking
   - Advanced: Budget and program analysis
   - ✅ Has autocomplete

4. **Federal Accounts** (`federal_accounts_funding_this_award`)
   - Technical financial tracking
   - Advanced: Budget analysis
   - 📋 Reference data

### Industry/Classification Fields (Can be Advanced)
5. **NAICS Codes** (`naics_codes`)
   - Industry classification
   - **Note**: Can be general if user-friendly (e.g., "Technology Services")
   - **Advanced**: If requiring specific codes
   - ✅ Has autocomplete

6. **PSC Codes** (`psc_codes`)
   - Product/Service classification
   - **Advanced**: Technical procurement codes
   - ✅ Has autocomplete

7. **CFDA Program Numbers** (`program_numbers`)
   - Financial assistance program codes
   - Advanced: Grant program tracking
   - ✅ Has autocomplete

### Contract Characteristics (Advanced)
8. **Contract Pricing Type** (`contract_pricing_type_codes`)
   - Technical: Fixed-price, cost-plus, etc.
   - Advanced: Procurement analysis
   - Manual input (with reference)

9. **Set-Aside Type** (`set_aside_type_codes`)
   - Small business set-asides
   - Advanced: Business opportunity analysis
   - Manual input (with reference)

10. **Extent Competed** (`extent_competed_type_codes`)
    - Competition level (full, limited, etc.)
    - Advanced: Procurement analysis
    - Manual input (with reference)

### Business Type Fields (Advanced)
11. **Recipient Type Names** (`recipient_type_names`)
    - Business classifications (sole proprietorship, etc.)
    - Advanced: Business analysis
    - Manual input (with reference)

12. **Recipient Scope** (`recipient_scope`)
    - Domestic vs foreign recipient
    - Advanced: Geographic analysis
    - Dropdown (enum)

13. **Place of Performance Scope** (`place_of_performance_scope`)
    - Domestic vs foreign performance
    - Advanced: Geographic analysis
    - Dropdown (enum)

### Specialized/Technical Fields
14. **DEF Codes** (`def_codes`)
    - Disaster/Emergency Fund codes
    - Advanced: COVID-19, IIJA, disaster relief tracking
    - 📋 Reference data

15. **Award IDs** (`award_ids`, `award_unique_id`)
    - Specific award lookup
    - Advanced: Direct award reference
    - Manual input (exact match)

16. **Awarding/Funding Sub-Agencies** (`agencies` with tier="subtier")
    - More granular than top-tier agencies
    - Advanced: Detailed agency analysis
    - ✅ Has autocomplete

17. **Recipient Locations** (`recipient_locations`)
    - More granular than recipient scope
    - Advanced: Detailed geographic analysis
    - ✅ Has autocomplete (location)

18. **City** (`city` via location autocomplete)
    - More granular than state
    - Advanced: City-level analysis
    - ✅ Has autocomplete

---

## Recommended UI Layout

### General Search Tab/Section
```
┌─────────────────────────────────────┐
│ General Search                      │
├─────────────────────────────────────┤
│ Recipient:        [Autocomplete]    │
│ Award Amount:    [$___ to $___]    │
│ Time Period:      [From] [To]       │
│ Keywords:         [Text input]      │
│ Awarding Agency:  [Autocomplete]    │
│ Award Type:       [Dropdown]        │
│ Location:         [Autocomplete]    │
│ Description:      [Text input]      │
└─────────────────────────────────────┘
```

### Advanced Search Tab/Section
```
┌─────────────────────────────────────┐
│ Advanced Filters                    │
├─────────────────────────────────────┤
│ Financial/Account:                  │
│   • Funding Agency                  │
│   • Treasury Account Symbol (TAS)   │
│   • Program Activity                │
│                                     │
│ Industry/Classification:            │
│   • NAICS Codes                     │
│   • PSC Codes                       │
│   • CFDA Program Numbers            │
│                                     │
│ Contract Characteristics:           │
│   • Contract Pricing Type           │
│   • Set-Aside Type                  │
│   • Extent Competed                 │
│                                     │
│ Business Type:                      │
│   • Recipient Type                  │
│   • Recipient Scope                 │
│   • Performance Scope               │
│                                     │
│ Specialized:                        │
│   • DEF Codes (Disaster/Emergency)  │
│   • Award IDs (Specific Lookup)    │
│   • Sub-Agencies                    │
│   • City/Detailed Locations         │
└─────────────────────────────────────┘
```

---

## Field Count Summary

- **General Search Fields**: 8 fields
- **Advanced Search Fields**: 18+ fields

**Total**: ~26 searchable fields

---

## Rationale for Categorization

### General Fields Criteria:
1. ✅ Used in 80%+ of searches
2. ✅ Intuitive and user-friendly
3. ✅ Cover basic "who, what, when, where, how much"
4. ✅ Don't require specialized knowledge

### Advanced Fields Criteria:
1. ⚙️ Technical/government-specific terminology
2. ⚙️ Specialized use cases (budget analysis, procurement analysis)
3. ⚙️ Require domain knowledge (TAS codes, PSC codes)
4. ⚙️ Less commonly used but powerful for specific needs
5. ⚙️ Granular/detailed options (sub-agencies, cities)

---

## Implementation Notes

1. **General Search**: Should be the default view, prominently displayed
2. **Advanced Search**: Collapsible section or separate tab
3. **Progressive Disclosure**: Show advanced fields when user needs them
4. **Help Text**: Advanced fields should have tooltips/help explaining what they are
5. **Reference Data**: Pre-load reference data for advanced dropdowns (award types, DEF codes, etc.)

---

## Special Cases

### NAICS/PSC Codes
- **General**: If presented as user-friendly categories (e.g., "Technology Services", "Research & Development")
- **Advanced**: If requiring specific code entry (e.g., "541715")

**Recommendation**: Provide both - simple category selector in general, code entry in advanced

### Award Type
- **General**: High-level (Contracts, Grants, Loans)
- **Advanced**: Detailed types (IDV_A, IDV_B, etc.)

**Recommendation**: General shows main categories, advanced shows all subtypes

