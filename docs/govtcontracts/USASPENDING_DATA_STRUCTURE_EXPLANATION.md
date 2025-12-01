# USAspending Data Structure: Awards, Transactions, and Subawards

## Overview

These are **NOT** the same thing - they represent different levels of the contract hierarchy:

```
Award (Prime Contract)
├── Transactions (Individual actions on the contract)
└── Subawards (Subcontracts issued by the prime contractor)
```

---

## 1. Awards (Prime Contracts)

**What they are**: The main contract/award record between the government and the prime contractor.

**Example from your data**:
- **5 awards** indexed
- One example: `CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-`
  - **Recipient**: TRIAD NATIONAL SECURITY, LLC (prime contractor)
  - **Total Obligation**: $31.7 billion
  - **Period**: 2018-06-08 to 2028-10-31
  - **Description**: "Management and Operation of Los Alamos National Laboratory"
  - **Transaction Count**: 229 (this award has 229 individual actions)
  - **Subaward Count**: 7,065 (this award has 7,065 subcontracts)

**Key Fields**:
- `award_id` - Unique identifier
- `total_obligation` - Total contract value
- `recipient_name` - Prime contractor
- `period_start_date` / `period_end_date` - Contract duration
- `subaward_count` - Number of subcontracts
- `transaction_count` - Number of transactions

---

## 2. Transactions (Individual Actions)

**What they are**: Individual actions, modifications, payments, or changes to an award over time.

**Example from your data**:
- **1,927 transactions** indexed across all 5 awards
- Each transaction represents one action on a contract:
  - Contract modifications (P00001, P00002, etc.)
  - Funding actions
  - Administrative changes
  - Payment obligations

**Example Transaction**:
```json
{
  "id": "CONT_TX_8900_-NONE-_89233218CNA000001_P00229_-NONE-_0",
  "award_id": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
  "action_date": "2025-11-26",
  "action_type": "C",
  "action_type_description": "FUNDING ONLY ACTION",
  "modification_number": "P00229",
  "federal_action_obligation": 2747932.67
}
```

**Key Fields**:
- `award_id` - **Foreign key** linking to the parent award
- `action_date` - When this action occurred
- `action_type` - Type of action (modification, funding, etc.)
- `modification_number` - Modification sequence (P00001, P00002, etc.)
- `federal_action_obligation` - Amount for this specific action

**Relationship**: One award can have **many transactions** (modifications, payments, etc.)

---

## 3. Subawards (Subcontracts)

**What they are**: Subcontracts issued by the prime contractor to subcontractors.

**Example from your data**:
- **15,384 subawards** indexed across all 5 awards
- Each subaward represents work subcontracted by the prime contractor

**Example Subaward**:
```json
{
  "id": 1374077,
  "subaward_number": "CW9930",
  "prime_award_id": "CONT_AWD_89233218CNA000001_8900_-NONE-_-NONE-",
  "recipient_name": "MERRICK-SMSI JOINT VENTURE LLP",
  "amount": 800000.0,
  "action_date": "2021-07-28",
  "description": "MERRICK SMSI JV - STAND ALONE -SUPPLIER LEVEL - PROFESSIONAL SERVICES"
}
```

**Key Fields**:
- `prime_award_id` - **Foreign key** linking to the parent award
- `recipient_name` - Subcontractor name (NOT the prime contractor)
- `amount` - Subaward amount
- `subaward_number` - Subcontract identifier

**Relationship**: One award can have **many subawards** (the prime contractor subcontracts work)

---

## Data Hierarchy Example

From your indexed data:

### Award #1: `CONT_AWD_89233218CNA000001`
- **Prime Contractor**: TRIAD NATIONAL SECURITY, LLC
- **Total Value**: $31.7 billion
- **Has 229 Transactions** (modifications, payments, etc.)
- **Has 7,065 Subawards** (subcontracts to other companies)

**Transactions for this award**:
- Transaction P00229: $2.7M funding action (2025-11-26)
- Transaction P00228: $1.6B funding action (2025-11-26)
- Transaction P00226: $37.4M funding action (2025-10-30)
- ... (226 more transactions)

**Subawards for this award**:
- Subaward CW9930: $800K to MERRICK-SMSI JOINT VENTURE LLP
- Subaward CW9928: $500K to MERRICK-SMSI JOINT VENTURE LLP
- Subaward CW9912: $33.3M to NORTHERN NEW MEXICO ARCHITECTS & ENGINEERS GROUP LLC
- ... (7,062 more subawards)

---

## Why Three Separate Files?

### 1. **Awards File** (`indexed_awards_*.json`)
- Contains the **prime contract** information
- One record per award
- Summary data (total obligation, dates, recipient, etc.)
- Includes counts: `transaction_count`, `subaward_count`

### 2. **Transactions File** (`indexed_transactions_*.json`)
- Contains **all individual actions** on all awards
- Many records per award (one per transaction)
- Detailed transaction data (action date, type, amount, modification number)
- Linked to award via `award_id` foreign key

### 3. **Subawards File** (`indexed_subawards_*.json`)
- Contains **all subcontracts** under all awards
- Many records per award (one per subaward)
- Subcontractor information and amounts
- Linked to award via `prime_award_id` foreign key

---

## Summary Statistics from Your Data

```
5 Awards (Prime Contracts)
├── 1,927 Transactions (Individual actions across all awards)
└── 15,384 Subawards (Subcontracts across all awards)
```

**Average per award**:
- ~385 transactions per award
- ~3,077 subawards per award

**Note**: One award (`CONT_AWD_89233218CNA000001`) has 7,065 subawards alone - it's a large management and operations contract.

---

## Use Cases

### Awards
- "Show me all contracts for Company X"
- "What's the total value of contracts in 2023?"
- "List all DOE contracts"

### Transactions
- "Show me all modifications to this contract"
- "What payments were made on this contract?"
- "Track contract changes over time"

### Subawards
- "Who did the prime contractor subcontract to?"
- "Show me all subcontractors for this contract"
- "What's the subcontracting chain?"

---

## Database Design Rationale

This structure allows:
1. **Efficient Queries**: Query awards without loading all transactions/subawards
2. **Scalability**: Large contracts can have thousands of transactions/subawards
3. **Flexibility**: Can query transactions or subawards independently
4. **Relationships**: Foreign keys (`award_id`, `prime_award_id`) maintain relationships

---

## Answer to Your Question

**No, awards and subawards are NOT a distillation of transactions.**

They are **three separate but related entities**:

- **Awards** = Prime contracts (government → prime contractor)
- **Transactions** = Individual actions on those contracts (modifications, payments)
- **Subawards** = Subcontracts (prime contractor → subcontractors)

Think of it like:
- **Award** = The main contract document
- **Transactions** = All the changes/modifications to that contract over time
- **Subawards** = All the subcontracts the prime contractor issued to others

All three are indexed separately because they serve different purposes and have different query patterns.

