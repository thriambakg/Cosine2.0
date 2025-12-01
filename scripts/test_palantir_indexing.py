"""
Full indexing test script for USAspending API
- Gets recipient from autocomplete
- Searches for transactions/awards
- Indexes full award details, transactions, and subawards
- Outputs structured JSON files
"""

import json
import requests
import time
import os
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict
from urllib.parse import urljoin

BASE_URL = "https://api.usaspending.gov"

def make_api_call(endpoint: str, method: str, params: Optional[Dict] = None, body: Optional[Dict] = None, timeout: int = 30) -> Tuple[bool, Optional[Dict], Optional[str], int]:
    """Make an API call to the USAspending API with retry logic"""
    url = BASE_URL + endpoint
    max_retries = 2
    retry_count = 0
    
    while retry_count <= max_retries:
        try:
            if method == "GET":
                response = requests.get(url, params=params, timeout=timeout)
            elif method == "POST":
                response = requests.post(
                    url,
                    json=body if body else {},
                    params=params,
                    headers={"Content-Type": "application/json"},
                    timeout=timeout
                )
            else:
                return False, None, f"Unsupported method: {method}", 0
            
            status_code = response.status_code
            
            if status_code == 200:
                try:
                    data = response.json()
                    return True, data, None, status_code
                except json.JSONDecodeError:
                    return False, None, "Invalid JSON response", status_code
            else:
                error_msg = f"HTTP {status_code}"
                try:
                    error_data = response.json()
                    if isinstance(error_data, dict):
                        if "message" in error_data:
                            error_msg += f": {error_data['message']}"
                        elif "detail" in error_data:
                            error_msg += f": {error_data['detail']}"
                except:
                    error_text = response.text[:200] if response.text else "No response body"
                    error_msg += f": {error_text}"
                return False, None, error_msg, status_code
        
        except requests.exceptions.ConnectionError as e:
            retry_count += 1
            if retry_count <= max_retries:
                print(f"  Connection error, retrying in 2 seconds... (Attempt {retry_count}/{max_retries})")
                time.sleep(2)
            else:
                return False, None, f"Request error after {max_retries} retries: {str(e)}", 0
        except requests.exceptions.Timeout:
            return False, None, f"Request timeout ({timeout}s)", 0
        except requests.exceptions.RequestException as e:
            return False, None, f"Request error: {str(e)}", 0
        except Exception as e:
            return False, None, f"Unexpected error: {str(e)}", 0
    
    return False, None, "Unknown error after retries", 0


def get_recipient_from_autocomplete(recipient_name: str) -> Optional[Dict[str, Any]]:
    """Get first recipient from autocomplete endpoint (simulating user selection)"""
    print(f"\n{'=' * 80}")
    print(f"Step 1: Autocomplete Search for '{recipient_name}'")
    print(f"{'=' * 80}\n")
    
    success, data, error, status = make_api_call(
        "/api/v2/autocomplete/recipient/",
        "POST",
        body={"search_text": recipient_name, "limit": 50}
    )
    
    if not success or not data.get("results"):
        print(f"Failed to get autocomplete results: {error}")
        return None
    
    # Use the second result (simulating user selecting second autocomplete suggestion)
    if len(data["results"]) < 2:
        print(f"Only {len(data['results'])} result(s) available, using first result")
        selected_index = 0
    else:
        selected_index = 1  # Second result (index 1)
    
    selected_result = data["results"][selected_index]
    recipient_name_result = selected_result.get("recipient_name", "")
    uei = selected_result.get("uei")
    duns = selected_result.get("duns")
    
    print(f"Selected autocomplete result #{selected_index + 1}:")
    print(f"  Recipient Name: {recipient_name_result}")
    print(f"  UEI: {uei or 'N/A'}")
    print(f"  DUNS: {duns or 'N/A'}")
    print(f"\nTotal results available: {len(data['results'])}")
    if len(data['results']) > 1:
        print(f"\nOther results (showing first 5):")
        for i, result in enumerate(data["results"][:5], 1):
            marker = " <-- SELECTED" if i == selected_index + 1 else ""
            print(f"  {i}. {result.get('recipient_name', 'N/A')} (UEI: {result.get('uei', 'N/A')}, DUNS: {result.get('duns', 'N/A')}){marker}")
    
    return {
        "recipient_name": recipient_name_result,
        "uei": uei,
        "duns": duns
    }


def search_and_print_awards(recipient_name: str, limit: int = 3):
    """Search for transactions/awards using spending_by_transaction endpoint and print them to terminal"""
    print(f"\n{'=' * 80}")
    print(f"Step 2: Searching for Transactions/Awards for '{recipient_name}'")
    print(f"Using endpoint: /api/v2/search/spending_by_transaction/")
    print(f"{'=' * 80}\n")
    
    # Try different search approaches using spending_by_transaction endpoint
    search_attempts = [
        {
            "name": "keywords filter (PALANTIR)",
            "filters": {
                "keywords": ["PALANTIR"],
                "award_type_codes": ["A", "B", "C", "D"]
            }
        },
        {
            "name": "recipient_search_text (exact name)",
            "filters": {
                "recipient_search_text": [recipient_name],
                "award_type_codes": ["A", "B", "C", "D"]
            }
        },
        {
            "name": "recipient_search_text (PALANTIR only)",
            "filters": {
                "recipient_search_text": ["PALANTIR"],
                "award_type_codes": ["A", "B", "C", "D"]
            }
        },
        {
            "name": "keywords filter (exact name)",
            "filters": {
                "keywords": [recipient_name],
                "award_type_codes": ["A", "B", "C", "D"]
            }
        }
    ]
    
    for attempt in search_attempts:
        print(f"Trying: {attempt['name']}...")
        success, data, error, status = make_api_call(
            "/api/v2/search/spending_by_transaction/",
            "POST",
            body={
                "filters": attempt["filters"],
                "fields": [
                    "Award ID",
                    "generated_internal_id",
                    "internal_id",
                    "Recipient Name",
                    "Awarding Agency",
                    "Awarding Sub Agency",
                    "Transaction Amount",
                    "Action Date",
                    "Award Type"
                ],
                "limit": limit,
                "page": 1,
                "sort": "Transaction Amount",
                "order": "desc"
            }
        )
        
        if success:
            if data.get("results") and len(data["results"]) > 0:
                print(f"\n✓ SUCCESS with {attempt['name']}!")
                print(f"Found {len(data['results'])} transactions:\n")
                
                for i, transaction in enumerate(data["results"], 1):
                    print(f"  Transaction {i}:")
                    print(f"    Award ID: {transaction.get('Award ID', 'N/A')}")
                    print(f"    Internal ID: {transaction.get('internal_id', 'N/A')}")
                    print(f"    Generated Internal ID: {transaction.get('generated_internal_id', 'N/A')}")
                    print(f"    Recipient Name: {transaction.get('Recipient Name', 'N/A')}")
                    print(f"    Awarding Agency: {transaction.get('Awarding Agency', 'N/A')}")
                    print(f"    Transaction Amount: {transaction.get('Transaction Amount', 'N/A')}")
                    print(f"    Action Date: {transaction.get('Action Date', 'N/A')}")
                    print(f"    Award Type: {transaction.get('Award Type', 'N/A')}")
                    print()
                
                return data["results"]
            else:
                print(f"  Success but no results found")
                if data.get("messages"):
                    print(f"  Messages: {data['messages']}")
                if data.get("page_metadata"):
                    print(f"  Page metadata: {data['page_metadata']}")
                print(f"  Full response structure:")
                print(f"    {json.dumps(data, indent=2, default=str)[:800]}\n")
        else:
            print(f"  ✗ Failed: {error or 'Unknown error'}")
            if data:
                print(f"  Response data: {json.dumps(data, indent=2)[:500]}\n")
            else:
                print()
    
    print("All search attempts failed. No transactions found.")
    return []


def extract_unique_award_ids(transactions: List[Dict]) -> List[str]:
    """Extract unique award IDs from transaction results"""
    award_ids = set()
    for transaction in transactions:
        award_id = transaction.get("generated_internal_id") or transaction.get("Award ID")
        if award_id:
            award_ids.add(award_id)
    return list(award_ids)


def get_award_details(award_id: str) -> Optional[Dict[str, Any]]:
    """Get full award details from /api/v2/awards/<AWARD_ID>/"""
    print(f"  Fetching award details for: {award_id}")
    success, data, error, status = make_api_call(
        f"/api/v2/awards/{award_id}/",
        "GET"
    )
    
    if success and data:
        return data
    else:
        print(f"    ✗ Failed to get award details: {error}")
        return None


def get_transactions_for_award(award_id: str) -> List[Dict[str, Any]]:
    """Get all transactions for a specific award"""
    print(f"  Fetching transactions for award: {award_id}")
    all_transactions = []
    page = 1
    limit = 100
    
    while True:
        success, data, error, status = make_api_call(
            "/api/v2/transactions/",
            "POST",
            body={
                "award_id": award_id,
                "page": page,
                "limit": limit,
                "sort": "action_date",
                "order": "desc"
            }
        )
        
        if success and data:
            transactions = data.get("results", [])
            if transactions:
                all_transactions.extend(transactions)
                page_metadata = data.get("page_metadata", {})
                if not page_metadata.get("hasNext", False):
                    break
                page += 1
            else:
                break
        else:
            print(f"    ✗ Failed to get transactions: {error}")
            break
    
    print(f"    ✓ Found {len(all_transactions)} transactions")
    return all_transactions


def get_subawards_for_award(award_id: str) -> List[Dict[str, Any]]:
    """Get all subawards for a specific award"""
    print(f"  Fetching subawards for award: {award_id}")
    all_subawards = []
    page = 1
    limit = 100
    
    while True:
        success, data, error, status = make_api_call(
            "/api/v2/subawards/",
            "POST",
            body={
                "award_id": award_id,
                "page": page,
                "limit": limit
            }
        )
        
        if success and data:
            subawards = data.get("results", [])
            if subawards:
                all_subawards.extend(subawards)
                page_metadata = data.get("page_metadata", {})
                if not page_metadata.get("hasNext", False):
                    break
                page += 1
            else:
                break
        else:
            print(f"    ✗ Failed to get subawards: {error}")
            break
    
    print(f"    ✓ Found {len(all_subawards)} subawards")
    return all_subawards


def extract_fiscal_year(date_str: Optional[str]) -> Optional[int]:
    """Extract fiscal year from date string (YYYY-MM-DD)"""
    if not date_str:
        return None
    try:
        date_obj = datetime.strptime(date_str[:10], "%Y-%m-%d")
        # Fiscal year: Oct 1 - Sep 30
        if date_obj.month >= 10:
            return date_obj.year + 1
        else:
            return date_obj.year
    except:
        return None


def flatten_award_data(award: Dict[str, Any], transactions: List[Dict], subawards: List[Dict]) -> Dict[str, Any]:
    """Flatten award data according to DynamoDB schema"""
    award_id = award.get("generated_unique_award_id") or award.get("id")
    award_type = award.get("category", "unknown")
    
    # Extract period of performance
    period = award.get("period_of_performance", {}) or {}
    period_start = period.get("start_date")
    period_end = period.get("current_end_date") or period.get("end_date")
    
    # Extract agency information
    awarding_agency = award.get("awarding_agency", {}) or {}
    funding_agency = award.get("funding_agency", {}) or {}
    
    # Extract recipient information
    recipient = award.get("recipient", {}) or {}
    recipient_location = recipient.get("location", {}) or {}
    
    # Extract NAICS
    naics = award.get("naics", {}) or {}
    naics_code = None
    naics_description = None
    if isinstance(naics, dict):
        naics_code = naics.get("code")
        naics_description = naics.get("description")
    elif isinstance(naics, list) and len(naics) > 0:
        naics_code = naics[0].get("code")
        naics_description = naics[0].get("description")
    
    # Extract PSC
    psc = award.get("product_or_service_code", {}) or {}
    psc_code = None
    psc_description = None
    if isinstance(psc, dict):
        psc_code = psc.get("code")
        psc_description = psc.get("description")
    
    # Extract CFDA (for financial assistance)
    cfda_number = None
    if award_type == "financial_assistance":
        cfda_info = award.get("cfda_info", [])
        if cfda_info and len(cfda_info) > 0:
            cfda_number = cfda_info[0].get("program_number")
    
    # Extract DEF codes
    def_codes = []
    account_obligations = award.get("account_obligations_by_defc", [])
    if account_obligations:
        def_codes = [item.get("code") for item in account_obligations if item.get("code")]
    
    # Flattened award data
    flattened = {
        "award_id": award_id,
        "award_type": award_type,
        
        # Core award data
        "total_obligation": award.get("total_obligation"),
        "period_start_date": period_start,
        "period_end_date": period_end,
        "fiscal_year": extract_fiscal_year(period_start),
        "description": award.get("description"),
        
        # Agency information
        "awarding_agency_id": awarding_agency.get("id"),
        "awarding_agency_code": awarding_agency.get("toptier_agency", {}).get("code") if isinstance(awarding_agency.get("toptier_agency"), dict) else None,
        "awarding_agency_name": awarding_agency.get("toptier_agency", {}).get("name") if isinstance(awarding_agency.get("toptier_agency"), dict) else None,
        "funding_agency_id": funding_agency.get("id"),
        "funding_agency_code": funding_agency.get("toptier_agency", {}).get("code") if isinstance(funding_agency.get("toptier_agency"), dict) else None,
        "funding_agency_name": funding_agency.get("toptier_agency", {}).get("name") if isinstance(funding_agency.get("toptier_agency"), dict) else None,
        
        # Recipient information
        "recipient_id": recipient.get("recipient_id") or recipient.get("recipient_unique_id"),
        "recipient_name": recipient.get("recipient_name"),
        "recipient_unique_id": recipient.get("recipient_unique_id"),
        "recipient_location_state": recipient_location.get("state_code"),
        "recipient_location_country": recipient_location.get("country_code"),
        
        # Reference codes
        "naics_code": naics_code,
        "naics_description": naics_description,
        "psc_code": psc_code,
        "psc_description": psc_description,
        "cfda_number": cfda_number,
        "def_codes": def_codes,
        
        # Counts
        "subaward_count": len(subawards),
        "transaction_count": len(transactions),
        
        # Full response data
        "full_response": award,
        
        # Related data flags
        "transactions_indexed": len(transactions) > 0,
        "subawards_indexed": len(subawards) > 0,
        "full_indexing_complete": True,
        
        # Metadata
        "indexed_at": datetime.now(timezone.utc).isoformat(),
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "data_source": "usaspending_api",
        "api_version": "v2"
    }
    
    return flattened


def index_awards(transactions: List[Dict], output_dir: str = "temp") -> Dict[str, Any]:
    """Index all awards found in transactions"""
    print(f"\n{'=' * 80}")
    print("Step 3: Indexing Awards")
    print(f"{'=' * 80}\n")
    
    # Extract unique award IDs
    award_ids = extract_unique_award_ids(transactions)
    print(f"Found {len(award_ids)} unique award IDs to index\n")
    
    indexed_awards = []
    indexed_transactions = []
    indexed_subawards = []
    
    for i, award_id in enumerate(award_ids, 1):
        print(f"[{i}/{len(award_ids)}] Processing award: {award_id}")
        
        # Get award details
        award = get_award_details(award_id)
        if not award:
            continue
        
        # Get transactions for this award
        transactions_list = get_transactions_for_award(award_id)
        
        # Get subawards for this award
        subawards_list = get_subawards_for_award(award_id)
        
        # Flatten award data
        flattened_award = flatten_award_data(award, transactions_list, subawards_list)
        indexed_awards.append(flattened_award)
        
        # Add transactions with award_id reference
        for transaction in transactions_list:
            transaction["award_id"] = award_id
            transaction["fiscal_year"] = extract_fiscal_year(transaction.get("action_date"))
            indexed_transactions.append(transaction)
        
        # Add subawards with award_id reference
        for subaward in subawards_list:
            subaward["prime_award_id"] = award_id
            indexed_subawards.append(subaward)
        
        print()
        time.sleep(0.5)  # Rate limiting
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Save indexed data
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    
    awards_file = os.path.join(output_dir, f"indexed_awards_{timestamp}.json")
    transactions_file = os.path.join(output_dir, f"indexed_transactions_{timestamp}.json")
    subawards_file = os.path.join(output_dir, f"indexed_subawards_{timestamp}.json")
    summary_file = os.path.join(output_dir, f"indexing_summary_{timestamp}.json")
    
    print(f"\nSaving indexed data to {output_dir}/...")
    
    with open(awards_file, "w", encoding="utf-8") as f:
        json.dump(indexed_awards, f, indent=2, default=str)
    print(f"  ✓ Saved {len(indexed_awards)} awards to {awards_file}")
    
    with open(transactions_file, "w", encoding="utf-8") as f:
        json.dump(indexed_transactions, f, indent=2, default=str)
    print(f"  ✓ Saved {len(indexed_transactions)} transactions to {transactions_file}")
    
    with open(subawards_file, "w", encoding="utf-8") as f:
        json.dump(indexed_subawards, f, indent=2, default=str)
    print(f"  ✓ Saved {len(indexed_subawards)} subawards to {subawards_file}")
    
    # Create summary
    summary = {
        "indexing_timestamp": timestamp,
        "total_awards_indexed": len(indexed_awards),
        "total_transactions_indexed": len(indexed_transactions),
        "total_subawards_indexed": len(indexed_subawards),
        "award_ids": award_ids,
        "output_files": {
            "awards": awards_file,
            "transactions": transactions_file,
            "subawards": subawards_file
        }
    }
    
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"  ✓ Saved summary to {summary_file}")
    
    return summary


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
    # (these are specific search filters, not bulk download patterns)
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


def initiate_download(filters: Dict[str, Any], download_type: str = "awards", output_dir: str = "temp") -> Optional[Dict[str, Any]]:
    """
    Initiate a download with auto-detection for bulk vs regular download.
    
    Args:
        filters: Search filters dictionary
        download_type: Type of download (awards, transactions, contract)
        output_dir: Output directory for files
    """
    print(f"\n{'=' * 80}")
    print(f"Step 4: Initiating Download ({download_type})")
    print(f"{'=' * 80}\n")
    
    # Auto-detect if bulk download should be used
    use_bulk_download = should_use_bulk_download(filters)
    
    if use_bulk_download:
        print("🔍 Auto-detected: Using BULK DOWNLOAD (agency + time period only)")
        return initiate_bulk_download(filters, download_type, output_dir)
    else:
        print("🔍 Auto-detected: Using REGULAR DOWNLOAD (specific search filters)")
        return initiate_regular_download(filters, download_type, output_dir)


def initiate_bulk_download(filters: Dict[str, Any], download_type: str = "awards", output_dir: str = "temp") -> Optional[Dict[str, Any]]:
    """Initiate a bulk download (for agency + date range queries)"""
    # Bulk download requires date_range and date_type
    date_range = filters.get("date_range")
    time_period = filters.get("time_period", [])
    
    # Convert time_period to date_range if needed
    if not date_range and time_period and len(time_period) > 0:
        date_range = time_period[0]  # Use first time period
        date_type = date_range.get("date_type", "action_date")
    elif date_range:
        date_type = date_range.get("date_type", "action_date")
    else:
        print(f"  ✗ Bulk download requires date_range or time_period")
        return None
    
    # Build bulk download request
    bulk_filters = {
        "agencies": filters.get("agencies", []),
        "date_range": {
            "start_date": date_range.get("start_date"),
            "end_date": date_range.get("end_date")
        },
        "date_type": date_type
    }
    
    # Add optional fields
    if "prime_award_types" in filters:
        bulk_filters["prime_award_types"] = filters["prime_award_types"]
    elif "award_type_codes" in filters:
        # Convert award_type_codes to prime_award_types for bulk download
        bulk_filters["prime_award_types"] = filters["award_type_codes"]
    
    if "keyword" in filters:
        bulk_filters["keyword"] = filters["keyword"]
    
    if "place_of_performance_scope" in filters:
        bulk_filters["place_of_performance_scope"] = filters["place_of_performance_scope"]
    
    if "recipient_scope" in filters:
        bulk_filters["recipient_scope"] = filters["recipient_scope"]
    
    print(f"Initiating bulk download...")
    print(f"  Agencies: {len(bulk_filters['agencies'])}")
    print(f"  Date Range: {bulk_filters['date_range']['start_date']} to {bulk_filters['date_range']['end_date']}")
    
    # Bulk download endpoint
    success, data, error, status = make_api_call(
        "/api/v2/bulk_download/awards/",
        "POST",
        body={
            "filters": bulk_filters,
            "file_format": "csv"
        }
    )
    
    if not success or not data:
        print(f"  ✗ Failed to initiate bulk download: {error}")
        return None
    
    status_url = data.get("status_url")
    file_name = data.get("file_name")
    file_url = data.get("file_url")
    
    if not file_name:
        print(f"  ✗ No file_name in response")
        return None
    
    print(f"  ✓ Bulk download initiated")
    print(f"    File name: {file_name}")
    print(f"    Status URL: {status_url}")
    
    return {
        "status_url": status_url,
        "file_name": file_name,
        "file_url": file_url,
        "download_request": data.get("download_request", {}),
        "download_type": "bulk_download",
        "original_download_type": download_type
    }


def initiate_regular_download(filters: Dict[str, Any], download_type: str = "awards", output_dir: str = "temp") -> Optional[Dict[str, Any]]:
    """Initiate a regular download (for specific search results)"""
    # Determine endpoint based on download type
    if download_type == "awards":
        endpoint = "/api/v2/download/awards/"
    elif download_type == "transactions":
        endpoint = "/api/v2/download/transactions/"
    elif download_type == "contract":
        endpoint = "/api/v2/download/contract/"
    else:
        print(f"  ✗ Unsupported download type: {download_type}")
        return None
    
    print(f"Initiating {download_type} download...")
    if "award_ids" in filters:
        print(f"  Award IDs: {len(filters['award_ids'])}")
    if "recipient_search_text" in filters:
        print(f"  Recipient: {filters['recipient_search_text']}")
    if "keywords" in filters:
        print(f"  Keywords: {filters['keywords']}")
    
    # Initiate download
    success, data, error, status = make_api_call(
        endpoint,
        "POST",
        body={
            "filters": filters
        }
    )
    
    if not success or not data:
        print(f"  ✗ Failed to initiate download: {error}")
        return None
    
    status_url = data.get("status_url")
    file_name = data.get("file_name")
    file_url = data.get("file_url")
    
    if not file_name:
        print(f"  ✗ No file_name in response")
        return None
    
    print(f"  ✓ Download initiated")
    print(f"    File name: {file_name}")
    print(f"    Status URL: {status_url}")
    
    return {
        "status_url": status_url,
        "file_name": file_name,
        "file_url": file_url,
        "download_request": data.get("download_request", {}),
        "download_type": "download",
        "original_download_type": download_type
    }


def poll_download_status(file_name: str, is_bulk: bool = False, max_wait: int = 300, poll_interval: int = 2) -> Optional[Dict[str, Any]]:
    """Poll download status until ready or failed"""
    print(f"\nPolling download status for: {file_name}")
    print(f"  Type: {'Bulk Download' if is_bulk else 'Regular Download'}")
    print(f"  Max wait time: {max_wait} seconds")
    print(f"  Poll interval: {poll_interval} seconds\n")
    
    start_time = time.time()
    attempt = 0
    
    # Use appropriate status endpoint
    status_endpoint = "/api/v2/bulk_download/status/" if is_bulk else "/api/v2/download/status/"
    
    while time.time() - start_time < max_wait:
        attempt += 1
        success, data, error, status = make_api_call(
            status_endpoint,
            "GET",
            params={"file_name": file_name}
        )
        
        if not success or not data:
            print(f"  Attempt {attempt}: Failed to get status - {error}")
            time.sleep(poll_interval)
            continue
        
        download_status = data.get("status", "unknown")
        message = data.get("message")
        seconds_elapsed = data.get("seconds_elapsed")
        total_rows = data.get("total_rows")
        total_size = data.get("total_size")
        file_url = data.get("file_url")
        
        print(f"  Attempt {attempt}: Status = {download_status}", end="")
        if seconds_elapsed:
            print(f" (elapsed: {seconds_elapsed}s)", end="")
        if total_rows is not None:
            print(f" | Rows: {total_rows}", end="")
        if total_size is not None:
            print(f" | Size: {total_size} KB", end="")
        print()
        
        if download_status == "finished" or download_status == "ready":
            print(f"\n  ✓ Download ready!")
            return {
                "status": download_status,
                "file_name": file_name,
                "file_url": file_url,
                "total_rows": total_rows,
                "total_size": total_size,
                "seconds_elapsed": seconds_elapsed,
                "message": message
            }
        elif download_status == "failed":
            print(f"\n  ✗ Download failed: {message}")
            return None
        elif download_status == "running":
            # Continue polling
            time.sleep(poll_interval)
        else:
            # Unknown status, continue polling
            print(f"    Unknown status, continuing to poll...")
            time.sleep(poll_interval)
    
    print(f"\n  ✗ Timeout: Download did not complete within {max_wait} seconds")
    return None


def download_file(file_url: str, file_name: str, output_dir: str = "temp") -> Optional[str]:
    """Download file from USAspending API"""
    print(f"\nDownloading file: {file_name}")
    
    # file_url is typically a relative path, need to construct full URL
    if file_url.startswith("http"):
        download_url = file_url
    else:
        # Relative path, prepend base URL
        download_url = urljoin(BASE_URL, file_url)
    
    print(f"  Download URL: {download_url}")
    
    try:
        response = requests.get(download_url, stream=True, timeout=60)
        response.raise_for_status()
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, file_name)
        
        # Download file
        total_size = 0
        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    total_size += len(chunk)
        
        file_size_mb = total_size / (1024 * 1024)
        print(f"  ✓ File downloaded successfully")
        print(f"    Saved to: {output_path}")
        print(f"    Size: {file_size_mb:.2f} MB")
        
        return output_path
        
    except requests.exceptions.RequestException as e:
        print(f"  ✗ Failed to download file: {e}")
        return None
    except Exception as e:
        print(f"  ✗ Unexpected error: {e}")
        return None


def download_indexed_awards(filters: Dict[str, Any], output_dir: str = "temp") -> Optional[Dict[str, Any]]:
    """
    Complete download workflow: initiate, poll, and download.
    
    Args:
        filters: Search filters dictionary (will auto-detect bulk vs regular)
        output_dir: Output directory for files
    """
    # Step 1: Initiate download (auto-detects bulk vs regular)
    download_info = initiate_download(filters, download_type="awards", output_dir=output_dir)
    if not download_info:
        return None
    
    file_name = download_info["file_name"]
    is_bulk = download_info.get("download_type") == "bulk_download"
    
    # Step 2: Poll for status
    status_info = poll_download_status(file_name, is_bulk=is_bulk, max_wait=300, poll_interval=2)
    if not status_info:
        return None
    
    # Step 3: Download file
    file_path = download_file(status_info["file_url"], file_name, output_dir=output_dir)
    if not file_path:
        return None
    
    return {
        "download_info": download_info,
        "status_info": status_info,
        "file_path": file_path,
        "file_name": file_name
    }


def search_by_agency_and_time(agency_name: str, start_date: str, end_date: str, limit: int = 10) -> List[Dict]:
    """Search for contracts by agency and time period"""
    print(f"\n{'=' * 80}")
    print(f"Searching for contracts: {agency_name}")
    print(f"Time Period: {start_date} to {end_date}")
    print(f"{'=' * 80}\n")
    
    # Search using spending_by_transaction endpoint
    success, data, error, status = make_api_call(
        "/api/v2/search/spending_by_transaction/",
        "POST",
        body={
            "filters": {
                "agencies": [
                    {
                        "type": "awarding",
                        "tier": "toptier",
                        "name": agency_name
                    }
                ],
                "time_period": [
                    {
                        "start_date": start_date,
                        "end_date": end_date
                    }
                ],
                "award_type_codes": ["A", "B", "C", "D"]  # Contract types
            },
            "fields": [
                "Award ID",
                "generated_internal_id",
                "internal_id",
                "Recipient Name",
                "Awarding Agency",
                "Transaction Amount",
                "Action Date",
                "Award Type"
            ],
            "limit": limit,
            "page": 1,
            "sort": "Transaction Amount",
            "order": "desc"
        }
    )
    
    if success and data and data.get("results"):
        transactions = data["results"]
        print(f"✓ Found {len(transactions)} transactions\n")
        return transactions
    else:
        print(f"✗ Failed to search: {error}")
        return []


def bulk_workflow_example(agency_name: str = "Department of Energy", days_back: int = 7, limit: int = 5, output_dir: str = "temp"):
    """
    Complete bulk workflow example:
    1. Search for contracts by agency and time period
    2. Index all found awards (full details, transactions, subawards)
    3. Perform bulk download for the entire search result set
    """
    print("=" * 80)
    print("Bulk Download Workflow Example")
    print("=" * 80)
    
    # Calculate date range (past week)
    from datetime import datetime, timedelta
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)
    
    start_date_str = start_date.strftime("%Y-%m-%d")
    end_date_str = end_date.strftime("%Y-%m-%d")
    
    print(f"\nSearching for {agency_name} contracts from the past {days_back} days")
    print(f"Date Range: {start_date_str} to {end_date_str}\n")
    
    # Step 1: Search for contracts
    transactions = search_by_agency_and_time(agency_name, start_date_str, end_date_str, limit=limit)
    
    if not transactions:
        print(f"\n{'=' * 80}")
        print("No transactions found. Cannot proceed with indexing.")
        print(f"{'=' * 80}")
        return
    
    # Step 2: Index all awards (get full details, transactions, subawards)
    summary = index_awards(transactions, output_dir=output_dir)
    
    if summary.get("total_awards_indexed", 0) == 0:
        print(f"\n⚠ No awards indexed. Skipping bulk download.")
        return
    
    # Step 3: Perform bulk download (auto-detected because we only have agency + time period)
    print(f"\n{'=' * 80}")
    print("Step 4: Bulk Download (Auto-Detected)")
    print(f"{'=' * 80}\n")
    
    # Build filters for bulk download (agency + time period only)
    bulk_filters = {
        "agencies": [
            {
                "type": "awarding",
                "tier": "toptier",
                "name": agency_name
            }
        ],
        "time_period": [
            {
                "start_date": start_date_str,
                "end_date": end_date_str
            }
        ],
        "award_type_codes": ["A", "B", "C", "D"]  # Contract types
    }
    
    print("Bulk download filters:")
    print(f"  Agency: {agency_name}")
    print(f"  Time Period: {start_date_str} to {end_date_str}")
    print(f"  Award Types: Contracts (A, B, C, D)")
    print()
    
    try:
        download_result = download_indexed_awards(bulk_filters, output_dir=output_dir)
    except Exception as e:
        print(f"\n⚠ Bulk download failed: {e}")
        import traceback
        traceback.print_exc()
        download_result = None
    
    # Final summary
    print(f"\n{'=' * 80}")
    print("Bulk Workflow Complete!")
    print(f"{'=' * 80}")
    print(f"Search Results: {len(transactions)} transactions found")
    print(f"Total Awards Indexed: {summary['total_awards_indexed']}")
    print(f"Total Transactions Indexed: {summary['total_transactions_indexed']}")
    print(f"Total Subawards Indexed: {summary['total_subawards_indexed']}")
    
    if download_result:
        print(f"\nBulk Download:")
        print(f"  Type: {'Bulk Download' if download_result.get('download_info', {}).get('download_type') == 'bulk_download' else 'Regular Download'}")
        print(f"  File: {download_result['file_name']}")
        print(f"  Path: {download_result['file_path']}")
        if download_result.get('status_info', {}).get('total_rows'):
            print(f"  Rows: {download_result['status_info']['total_rows']}")
        if download_result.get('status_info', {}).get('total_size'):
            print(f"  Size: {download_result['status_info']['total_size']} KB")
    else:
        print(f"\nBulk Download: Not completed")
    
    print(f"\nOutput files saved to: {output_dir}/")
    print(f"{'=' * 80}")


def main():
    """Main function - Full indexing workflow"""
    print("=" * 80)
    print("USAspending API Full Indexing Test")
    print("=" * 80)
    
    recipient_name = "Palantir"
    output_dir = "temp"
    
    # Step 1: Get recipient from autocomplete
    recipient_info = get_recipient_from_autocomplete(recipient_name)
    if not recipient_info:
        print("Could not find recipient. Exiting.")
        return
    
    selected_recipient_name = recipient_info["recipient_name"]
    
    # Step 2: Search for transactions/awards
    transactions = search_and_print_awards(selected_recipient_name, limit=3)
    
    if not transactions:
        print(f"\n{'=' * 80}")
        print("No transactions found. Cannot proceed with indexing.")
        print(f"{'=' * 80}")
        return
    
    # Step 3: Index all awards (get full details, transactions, subawards)
    summary = index_awards(transactions, output_dir=output_dir)
    
    # Step 4: Download indexed awards (optional - can be skipped if indexing fails)
    download_result = None
    if summary.get("total_awards_indexed", 0) > 0:
        award_ids = summary.get("award_ids", [])
        if award_ids:
            try:
                # Build filters for download (using award_ids - will use regular download)
                filters = {
                    "award_ids": award_ids,
                    "award_type_codes": ["A", "B", "C", "D"]
                }
                download_result = download_indexed_awards(filters, output_dir=output_dir)
            except Exception as e:
                print(f"\n⚠ Download failed: {e}")
                import traceback
                traceback.print_exc()
    else:
        print(f"\n⚠ Skipping download - no awards indexed")
    
    # Final summary
    print(f"\n{'=' * 80}")
    print("Indexing & Download Complete!")
    print(f"{'=' * 80}")
    print(f"Total Awards Indexed: {summary['total_awards_indexed']}")
    print(f"Total Transactions Indexed: {summary['total_transactions_indexed']}")
    print(f"Total Subawards Indexed: {summary['total_subawards_indexed']}")
    
    if download_result:
        print(f"\nDownload:")
        print(f"  File: {download_result['file_name']}")
        print(f"  Path: {download_result['file_path']}")
        if download_result.get('status_info', {}).get('total_rows'):
            print(f"  Rows: {download_result['status_info']['total_rows']}")
        if download_result.get('status_info', {}).get('total_size'):
            print(f"  Size: {download_result['status_info']['total_size']} KB")
    else:
        print(f"\nDownload: Not completed")
    
    print(f"\nOutput files saved to: {output_dir}/")
    print(f"{'=' * 80}")


if __name__ == "__main__":
    import sys
    
    try:
        # Check if bulk workflow is requested
        if len(sys.argv) > 1 and sys.argv[1] == "bulk":
            # Run bulk workflow example
            bulk_workflow_example(
                agency_name="Department of Energy",
                days_back=7,  # Past week
                limit=5,  # Limit to 5 transactions for testing
                output_dir="temp"
            )
        else:
            # Run regular workflow
            main()
    except KeyboardInterrupt:
        print("\n\nScript interrupted by user.")
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nScript interrupted by user.")
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
