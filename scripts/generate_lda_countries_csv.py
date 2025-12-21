#!/usr/bin/env python3
"""
Generate CSV files of LDA constants for autocomplete (countries and general issues).

This script:
1. Calls the LDA API endpoints for countries and/or general issues
2. Extracts names from the response
3. Generates CSV files with a single column of names
4. Optionally uploads to S3

Usage:
    # Generate both CSVs locally
    python generate_lda_countries_csv.py
    
    # Generate only countries CSV
    python generate_lda_countries_csv.py --countries-only
    
    # Generate only general issues CSV
    python generate_lda_countries_csv.py --general-issues-only
    
    # Generate and upload to S3
    python generate_lda_countries_csv.py --s3-bucket your-bucket-name
    
    # Custom output files and S3 keys
    python generate_lda_countries_csv.py \
      --output-countries countries.csv \
      --output-issues issues.csv \
      --s3-bucket your-bucket \
      --s3-key-countries lists/countries.csv \
      --s3-key-issues lists/general_issues.csv

Environment Variables:
    LDA_API_KEY - LDA API key (or will prompt if not set)

The CSV format will be:
    country_name (or general_issue_name)
    Afghanistan
    Albania
    ...
    
Note: The CSVs will be sorted alphabetically and can be used for autocomplete
in the LDA search page. Commas are removed from names to avoid CSV parsing issues.
"""

import json
import csv
import requests
import argparse
import sys
import os
from pathlib import Path
from typing import List, Dict
from io import StringIO

# LDA API Configuration
LDA_API_BASE_URL = "https://lda.senate.gov/api/v1"
COUNTRIES_ENDPOINT = f"{LDA_API_BASE_URL}/constants/general/countries/"
GENERAL_ISSUES_ENDPOINT = f"{LDA_API_BASE_URL}/constants/filing/lobbyingactivityissues/"

def get_api_key() -> str:
    """Get API key from environment variable or prompt user"""
    api_key = os.environ.get('LDA_API_KEY')
    if not api_key:
        print("⚠️  LDA_API_KEY environment variable not set.")
        print("   Please set it or enter your API key when prompted.")
        api_key = input("Enter LDA API Key: ").strip()
    return api_key

def fetch_data(api_key: str, endpoint: str, data_type: str) -> List[Dict]:
    """Fetch data from LDA API (works for both countries and general issues)"""
    headers = {
        "Authorization": f"Token {api_key}",
        "Accept": "application/json"
    }
    
    print(f"📡 Fetching {data_type} from: {endpoint}")
    
    try:
        response = requests.get(endpoint, headers=headers, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        print(f"✅ Successfully fetched {len(data)} {data_type}")
        return data
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching {data_type}: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Status Code: {e.response.status_code}")
            print(f"   Response: {e.response.text[:200]}")
        return None

def extract_names(items: List[Dict], item_type: str = "country") -> List[str]:
    """Extract names from API response (works for both countries and general issues)"""
    names = []
    
    for item in items:
        # API returns objects with 'name' and 'value' fields
        # We want the 'name' field
        name = item.get('name')
        if name:
            # Clean the name (strip whitespace and remove commas)
            cleaned_name = name.strip().replace(',', '')
            if cleaned_name:
                names.append(cleaned_name)
    
    # Sort alphabetically
    names.sort()
    
    return names

def generate_csv(names: List[str], column_name: str) -> str:
    """Generate CSV content with names"""
    # Create CSV in memory
    csv_buffer = StringIO()
    
    # Write header
    csv_buffer.write(f"{column_name}\n")
    
    # Write each name on a new line
    for name in names:
        csv_buffer.write(f"{name}\n")
    
    return csv_buffer.getvalue()

def save_csv_to_file(csv_content: str, output_file: Path, data_type: str):
    """Save CSV content to file"""
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(csv_content)
    
    # Count lines (excluding header)
    line_count = csv_content.count('\n') - 1
    print(f"💾 Saved {line_count} {data_type} to: {output_file}")

def upload_to_s3(csv_content: str, bucket: str, key: str, data_type: str):
    """Upload CSV to S3"""
    try:
        import boto3
        s3_client = boto3.client('s3')
        
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=csv_content.encode('utf-8'),
            ContentType='text/csv',
            CacheControl='max-age=3600'  # Cache for 1 hour
        )
        
        line_count = csv_content.count('\n') - 1
        print(f"☁️  Uploaded {line_count} {data_type} to s3://{bucket}/{key}")
        
    except ImportError:
        print("⚠️  boto3 not installed. Skipping S3 upload.")
        print("   Install with: pip install boto3")
    except Exception as e:
        print(f"❌ Error uploading to S3: {e}")

def print_sample(names: List[str], data_type: str):
    """Print sample names"""
    if not names:
        return
    
    print(f"\n📋 Sample {data_type} (first 10):")
    for name in names[:10]:
        print(f"   - {name}")
    
    if len(names) > 10:
        print(f"   ... and {len(names) - 10} more")

def main():
    parser = argparse.ArgumentParser(
        description="Generate CSV files of LDA constants (countries and general issues) for autocomplete"
    )
    parser.add_argument(
        '--output-countries',
        type=str,
        default='lda_countries.csv',
        help='Output CSV file path for countries (default: lda_countries.csv)'
    )
    parser.add_argument(
        '--output-issues',
        type=str,
        default='lda_general_issues.csv',
        help='Output CSV file path for general issues (default: lda_general_issues.csv)'
    )
    parser.add_argument(
        '--countries-only',
        action='store_true',
        help='Only generate countries CSV'
    )
    parser.add_argument(
        '--general-issues-only',
        action='store_true',
        help='Only generate general issues CSV'
    )
    parser.add_argument(
        '--s3-bucket',
        type=str,
        help='S3 bucket name for upload (optional)'
    )
    parser.add_argument(
        '--s3-key-countries',
        type=str,
        default='lists/countries.csv',
        help='S3 key/path for countries upload (default: lists/countries.csv)'
    )
    parser.add_argument(
        '--s3-key-issues',
        type=str,
        default='lists/general_issues.csv',
        help='S3 key/path for general issues upload (default: lists/general_issues.csv)'
    )
    
    args = parser.parse_args()
    
    # Determine what to generate
    generate_countries = not args.general_issues_only
    generate_issues = not args.countries_only
    
    # Get API key
    api_key = get_api_key()
    if not api_key:
        print("❌ API key is required")
        sys.exit(1)
    
    results = {}
    
    # Process countries
    if generate_countries:
        print("\n" + "=" * 60)
        print("🌍 Processing Countries")
        print("=" * 60)
        
        countries = fetch_data(api_key, COUNTRIES_ENDPOINT, "countries")
        if countries is None:
            print("❌ Failed to fetch countries from API")
        else:
            country_names = extract_names(countries, "country")
            if not country_names:
                print("⚠️  No country names found in API response")
            else:
                print(f"📝 Extracted {len(country_names)} unique country names")
                
                # Generate CSV
                csv_content = generate_csv(country_names, "country_name")
                
                # Save to file
                output_file = Path(args.output_countries)
                save_csv_to_file(csv_content, output_file, "country names")
                
                # Upload to S3 if bucket specified
                if args.s3_bucket:
                    upload_to_s3(csv_content, args.s3_bucket, args.s3_key_countries, "country names")
                
                # Print sample
                print_sample(country_names, "country names")
                
                results['countries'] = {
                    'count': len(country_names),
                    'file': output_file,
                    's3_key': args.s3_key_countries if args.s3_bucket else None
                }
    
    # Process general issues
    if generate_issues:
        print("\n" + "=" * 60)
        print("📋 Processing General Issues")
        print("=" * 60)
        
        issues = fetch_data(api_key, GENERAL_ISSUES_ENDPOINT, "general issues")
        if issues is None:
            print("❌ Failed to fetch general issues from API")
        else:
            issue_names = extract_names(issues, "general issue")
            if not issue_names:
                print("⚠️  No general issue names found in API response")
            else:
                print(f"📝 Extracted {len(issue_names)} unique general issue names")
                
                # Generate CSV
                csv_content = generate_csv(issue_names, "general_issue_name")
                
                # Save to file
                output_file = Path(args.output_issues)
                save_csv_to_file(csv_content, output_file, "general issue names")
                
                # Upload to S3 if bucket specified
                if args.s3_bucket:
                    upload_to_s3(csv_content, args.s3_bucket, args.s3_key_issues, "general issue names")
                
                # Print sample
                print_sample(issue_names, "general issue names")
                
                results['general_issues'] = {
                    'count': len(issue_names),
                    'file': output_file,
                    's3_key': args.s3_key_issues if args.s3_bucket else None
                }
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 Summary:")
    if 'countries' in results:
        print(f"   Countries: {results['countries']['count']} items → {results['countries']['file']}")
        if results['countries']['s3_key']:
            print(f"      S3: s3://{args.s3_bucket}/{results['countries']['s3_key']}")
    if 'general_issues' in results:
        print(f"   General Issues: {results['general_issues']['count']} items → {results['general_issues']['file']}")
        if results['general_issues']['s3_key']:
            print(f"      S3: s3://{args.s3_bucket}/{results['general_issues']['s3_key']}")
    print("=" * 60)

if __name__ == "__main__":
    main()

