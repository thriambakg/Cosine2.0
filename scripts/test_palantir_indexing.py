"""
Test script for Department of Agriculture and Department of Commerce
Tests bulk download for 2025-12-03 to verify award extraction
"""

import json
import requests
import time
import os
import zipfile
import csv
from typing import Dict, List, Any, Optional, Tuple
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
        for i, trans in enumerate(transactions[:5], 1):
            print(f"  Transaction {i}:")
            print(f"    Award ID: {trans.get('Award ID', 'N/A')}")
            print(f"    Generated Internal ID: {trans.get('generated_internal_id', 'N/A')}")
            print(f"    Recipient: {trans.get('Recipient Name', 'N/A')}")
            print(f"    Amount: {trans.get('Transaction Amount', 'N/A')}")
            print(f"    Action Date: {trans.get('Action Date', 'N/A')}")
            print()
        return transactions
    else:
        print(f"✗ Failed to search: {error}")
        if data:
            print(f"  Response: {json.dumps(data, indent=2)[:500]}")
        return []


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
    
    print(f"Initiating bulk download...")
    print(f"  Agencies: {len(bulk_filters['agencies'])}")
    print(f"  Date Range: {bulk_filters['date_range']['start_date']} to {bulk_filters['date_range']['end_date']}")
    print(f"  Award Types: {bulk_filters.get('prime_award_types', [])}")
    
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


def poll_download_status(file_name: str, is_bulk: bool = False, max_wait: int = 600, poll_interval: int = 5) -> Optional[Dict[str, Any]]:
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


def fetch_subawards(award_id: str, verbose: bool = False) -> List[Dict[str, Any]]:
    """Fetch all subawards for an award (paginated)"""
    if verbose:
        print(f"\n{'=' * 80}")
        print(f"Fetching subawards for award: {award_id}")
        print(f"{'=' * 80}\n")
    
    all_subawards = []
    page = 1
    limit = 100
    
    while True:
        if verbose:
            print(f"  Fetching page {page}...")
        success, response, error, status = make_api_call(
            "/api/v2/subawards/",
            "POST",
            body={
                "award_id": award_id,
                "page": page,
                "limit": limit,
                "sort": "amount",
                "order": "desc"
            }
        )
        
        if not success or not response:
            if verbose:
                print(f"  ✗ Failed to fetch subawards: {error}")
            break
        
        subawards = response.get("results", [])
        if not subawards:
            if verbose:
                print(f"  ℹ️ No subawards found in page {page}")
            break
        
        if verbose:
            print(f"  ✓ Found {len(subawards)} subawards on page {page}")
        all_subawards.extend(subawards)
        
        page_metadata = response.get("page_metadata", {})
        has_next = page_metadata.get("hasNext", False)
        
        if not has_next:
            break
        
        page += 1
        time.sleep(0.5)  # Small delay between pages
    
    if verbose:
        print(f"\n  ✓ Completed: {len(all_subawards)} total subawards found")
        if all_subawards:
            print(f"\n  Sample subaward details (first 3):")
            for i, subaward in enumerate(all_subawards[:3], 1):
                subaward_id = subaward.get("subaward_id", "unknown")
                subaward_amount = subaward.get("subaward_amount", "unknown")
                subaward_number = subaward.get("subaward_number", "unknown")
                print(f"    Subaward {i}:")
                print(f"      ID: {subaward_id}")
                print(f"      Number: {subaward_number}")
                print(f"      Amount: ${subaward_amount:,.2f}" if isinstance(subaward_amount, (int, float)) else f"      Amount: {subaward_amount}")
                print(f"      Subawardee: {subaward.get('subawardee_name', 'N/A')}")
    
    return all_subawards


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


def test_agencies():
    """Test Department of Agriculture and Department of Commerce for 2025-01-15 to 2025-01-16"""
    print("=" * 80)
    print("Testing Department of Agriculture and Department of Commerce")
    print("Date Range: 2025-01-15 to 2025-01-16")
    print("=" * 80)
    
    start_date = "2025-01-15"
    end_date = "2025-01-16"
    
    agencies_to_test = [
        "Department of Agriculture",
        "Department of Commerce"
    ]
    
    for agency_name in agencies_to_test:
        print(f"\n{'=' * 80}")
        print(f"Testing: {agency_name}")
        print(f"{'=' * 80}\n")
        
        # Test search first
        transactions = search_by_agency_and_time(
            agency_name=agency_name,
            start_date=start_date,
            end_date=end_date,
            limit=10
        )
        
        print(f"\nSearch Results: {len(transactions)} transactions found")
        
        # Test bulk download
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
                    "start_date": start_date,
                    "end_date": end_date
                }
            ],
            "award_type_codes": ["A", "B", "C", "D"]  # Contract types
        }
        
        print(f"\nInitiating bulk download for {agency_name}...")
        download_info = initiate_bulk_download(bulk_filters, download_type="awards", output_dir="temp")
        
        if download_info:
            file_name = download_info["file_name"]
            print(f"  ✓ Bulk download initiated: {file_name}")
            
            # Poll for status
            print(f"\nPolling download status...")
            status_info = poll_download_status(
                file_name, 
                is_bulk=True, 
                max_wait=600,  # 10 minutes
                poll_interval=5
            )
            
            if status_info and status_info.get("file_url"):
                print(f"\n  ✓ Download ready!")
                print(f"    File URL: {status_info['file_url']}")
                print(f"    Total Rows: {status_info.get('total_rows', 'N/A')}")
                print(f"    Total Size: {status_info.get('total_size', 'N/A')} KB")
                
                # Download and inspect the file
                print(f"\n  Downloading file...")
                file_path = download_file(status_info["file_url"], file_name, output_dir="temp")
                
                if file_path:
                    print(f"    ✓ File downloaded: {file_path}")
                    # Try to parse and show first few rows
                    try:
                        with zipfile.ZipFile(file_path, 'r') as zip_ref:
                            csv_files = [f for f in zip_ref.namelist() if f.endswith('.csv')]
                            if csv_files:
                                csv_file = csv_files[0]
                                print(f"    Found CSV: {csv_file}")
                                csv_content = zip_ref.read(csv_file).decode('utf-8')
                                reader = csv.DictReader(csv_content.splitlines())
                                rows = list(reader)
                                print(f"    Total rows in CSV: {len(rows)}")
                                
                                if rows:
                                    print(f"\n    First row columns (first 15): {list(rows[0].keys())[:15]}")
                                    print(f"    First row sample (first 5 fields):")
                                    for key, value in list(rows[0].items())[:5]:
                                        print(f"      {key}: {value[:100] if value else 'N/A'}")
                                    
                                    # Look for award ID columns
                                    award_id_cols = [k for k in rows[0].keys() if 'award' in k.lower() and 'id' in k.lower()]
                                    if award_id_cols:
                                        print(f"\n    Award ID columns found: {award_id_cols}")
                                        unique_ids = set()
                                        for row in rows:
                                            for col in award_id_cols:
                                                if row.get(col):
                                                    unique_ids.add(row[col])
                                        print(f"    Unique award IDs: {len(unique_ids)}")
                                        if unique_ids:
                                            print(f"    Sample IDs: {list(unique_ids)[:5]}")
                                    else:
                                        print(f"\n    ⚠️ No award ID columns found in CSV")
                                        print(f"    All columns: {list(rows[0].keys())}")
                                    
                                    # Also check for generated_unique_award_id specifically
                                    if 'generated_unique_award_id' in rows[0].keys():
                                        unique_gen_ids = set()
                                        for row in rows:
                                            if row.get('generated_unique_award_id'):
                                                unique_gen_ids.add(row['generated_unique_award_id'])
                                        print(f"\n    generated_unique_award_id found: {len(unique_gen_ids)} unique values")
                                        if unique_gen_ids:
                                            print(f"    Sample generated_unique_award_id: {list(unique_gen_ids)[:5]}")
                                    
                                    # Test subaward fetching for all award IDs
                                    print(f"\n{'=' * 80}")
                                    print(f"Testing Subaward Fetching for All Awards")
                                    print(f"{'=' * 80}")
                                    
                                    # Try to find award ID column
                                    award_id_col = None
                                    for col in ['contract_award_unique_key', 'generated_unique_award_id', 'award_id', 'Award ID']:
                                        if col in rows[0].keys():
                                            award_id_col = col
                                            break
                                    
                                    if award_id_col:
                                        print(f"\n  Using award ID column: {award_id_col}")
                                        # Get unique award IDs
                                        unique_award_ids = set()
                                        for row in rows:
                                            award_id = row.get(award_id_col)
                                            if award_id:
                                                unique_award_ids.add(award_id)
                                        
                                        award_ids_list = list(unique_award_ids)
                                        print(f"  Found {len(award_ids_list)} unique award IDs")
                                        print(f"\n  Testing subaward fetching for all awards...\n")
                                        
                                        # Test subaward fetching for all awards
                                        total_subawards = 0
                                        awards_with_subawards = 0
                                        for idx, test_award_id in enumerate(award_ids_list, 1):
                                            subawards = fetch_subawards(test_award_id, verbose=False)
                                            subaward_count = len(subawards)
                                            print(f"  Transaction {idx}: {subaward_count} subawards")
                                            total_subawards += subaward_count
                                            if subaward_count > 0:
                                                awards_with_subawards += 1
                                            time.sleep(0.2)  # Small delay between requests
                                        
                                        # Summary
                                        print(f"\n  Summary: {awards_with_subawards}/{len(award_ids_list)} awards have subawards")
                                        print(f"  Total subawards found: {total_subawards}")
                                    else:
                                        print(f"\n  ⚠️ Could not find award ID column to test subaward fetching")
                                        print(f"  Available columns: {list(rows[0].keys())[:10]}...")
                                else:
                                    print(f"    ⚠️ CSV file is empty (0 rows)")
                            else:
                                print(f"    ⚠️ No CSV file found in ZIP")
                    except Exception as e:
                        print(f"    ✗ Error parsing file: {e}")
                        import traceback
                        traceback.print_exc()
            else:
                print(f"  ✗ Download not ready or failed")
        else:
            print(f"  ✗ Failed to initiate bulk download")
        
        print(f"\n{'=' * 80}\n")


if __name__ == "__main__":
    import sys
    
    try:
        test_agencies()
    except KeyboardInterrupt:
        print("\n\nScript interrupted by user.")
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
