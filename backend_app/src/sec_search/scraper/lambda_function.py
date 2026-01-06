"""
SEC EDGAR Search Lambda Function
Provides search and autocomplete functionality for SEC filings
Uses hybrid API + web scraping strategy
"""

import json
import os
import logging
import requests
import time
import re
import boto3
import uuid
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

# Import async job handler
from async_job_handler import (
    create_job, update_job_progress, complete_job, fail_job,
    get_job_status, invoke_async_search, cancel_job, is_job_cancelled
)

# Import query cache helper
from query_cache import (
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin

    generate_query_hash, get_cached_query_with_validation,
    store_cached_query, update_cached_query_results
)

# DynamoDB configuration for query cache table (for storing request_id)
QUERY_CACHE_TABLE_NAME = os.environ.get('SEC_SEARCH_QUERY_CACHE_TABLE')
query_cache_dynamodb = boto3.resource('dynamodb') if QUERY_CACHE_TABLE_NAME else None
query_cache_table = query_cache_dynamodb.Table(QUERY_CACHE_TABLE_NAME) if query_cache_dynamodb and QUERY_CACHE_TABLE_NAME else None

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# SEC API configuration
SEC_BASE_URL = "https://www.sec.gov"
SEC_DATA_URL = "https://data.sec.gov"
SEC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Cosine Financial Platform; contact@cosine.financial)"

# Limit results
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '10'))

# DynamoDB configuration
DYNAMODB_TABLE_NAME = os.environ.get('SEC_FILINGS_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if DYNAMODB_TABLE_NAME else None
cache_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if dynamodb and DYNAMODB_TABLE_NAME else None

# S3 configuration for storing downloaded filings
S3_BUCKET_NAME = os.environ.get('SEC_FILINGS_S3_BUCKET', 'cosine-sec-filings-production')
s3_client = boto3.client('s3') if S3_BUCKET_NAME else None

# SNS configuration for completion notifications (wrapper Lambda)
COMPLETION_SNS_TOPIC_ARN = os.environ.get('SEC_SEARCH_COMPLETION_SNS_TOPIC_ARN')
completion_sns_client = boto3.client('sns') if COMPLETION_SNS_TOPIC_ARN else None

# Global variable to store request_id for completion notification
current_request_id: Optional[str] = None


def create_session():
    """Create a requests session with proper headers"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': SEC_USER_AGENT,
        'Accept': 'application/json, text/html, application/xhtml+xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': 'https://www.sec.gov/',
    })
    return session


def construct_filing_id(form: str, cik: str, file_number: str, film_number: str) -> str:
    """
    Construct a unique filing ID for caching: {form}-{CIK}-{fileNumber}-{filmNumber}
    This must match the DynamoDB primary key format exactly.
    
    Args:
        form: Form type (e.g., "4", "10-K")
        cik: Central Index Key (10-digit padded)
        file_number: File number
        film_number: Film number
    
    Returns:
        Filing ID string in format: {form}-{CIK}-{fileNumber}-{filmNumber}
    """
    # Normalize and validate values - all fields are required for a valid filing ID
    form = str(form).strip() if form and str(form).strip() and str(form).strip() != 'N/A' else 'N/A'
    cik = str(cik).strip() if cik and str(cik).strip() and str(cik).strip() != 'N/A' else 'N/A'
    file_number = str(file_number).strip() if file_number and str(file_number).strip() and str(file_number).strip() != 'N/A' else 'N/A'
    film_number = str(film_number).strip() if film_number and str(film_number).strip() and str(film_number).strip() != 'N/A' else 'N/A'
    
    # Pad CIK to 10 digits if it's a valid number
    if cik != 'N/A' and cik.isdigit():
        cik = cik.zfill(10)
    
    # Construct filing ID - all components must be present
    # Format: {form}-{CIK}-{fileNumber}-{filmNumber}
    # Note: file_number may contain dashes (e.g., "001-34756"), so the total dash count may be > 3
    # When split by '-', we get: [form, CIK, ...file_number_parts..., film_number]
    # So we need at least 4 parts: form, CIK, file_number (may be multiple parts), film_number
    filing_id = f"{form}-{cik}-{file_number}-{film_number}"
    
    # Validate that we have at least form and CIK (file_number and film_number can be N/A for some forms)
    if form == 'N/A' or cik == 'N/A':
        logger.error(f"CRITICAL: Invalid filing ID components - missing required fields: form={form}, cik={cik}, file_number={file_number}, film_number={film_number}")
        # Still return the ID but log as error - this should not happen in production
    
    # Validate structure: split by '-' and ensure we have at least 4 parts
    # Parts: [form, CIK, ...file_number_parts..., film_number]
    parts = filing_id.split('-')
    if len(parts) < 4:
        logger.error(f"CRITICAL: Invalid filing_id format - expected at least 4 parts when split by '-', got {len(parts)}: '{filing_id}' (parts: {parts})")
    
    return filing_id


def get_cached_filings(filing_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Check DynamoDB cache for existing filings using BatchGetItem
    
    Args:
        filing_ids: List of filing IDs to check
    
    Returns:
        Dictionary mapping filing_id to cached item data
    """
    if not cache_table or not filing_ids:
        return {}
    
    try:
        # DynamoDB BatchGetItem can handle up to 100 items
        cached_items = {}
        
        # Process in batches of 100
        for i in range(0, len(filing_ids), 100):
            batch = filing_ids[i:i+100]
            keys = [{'filingId': filing_id} for filing_id in batch]
            
            response = cache_table.meta.client.batch_get_item(
                RequestItems={
                    DYNAMODB_TABLE_NAME: {
                        'Keys': keys
                    }
                }
            )
            
            items = response.get('Responses', {}).get(DYNAMODB_TABLE_NAME, [])
            for item in items:
                filing_id = item.get('filingId')
                if filing_id:
                    cached_items[filing_id] = item
            
            # Update lastAccessed timestamp for cached items
            current_time = int(datetime.now(timezone.utc).timestamp())
            for filing_id in cached_items.keys():
                try:
                    cache_table.update_item(
                        Key={'filingId': filing_id},
                        UpdateExpression='SET lastAccessed = :ts',
                        ExpressionAttributeValues={':ts': current_time}
                    )
                except Exception as e:
                    logger.warning(f"Failed to update lastAccessed for {filing_id}: {e}")
        
        logger.info(f"🔍 Cache lookup complete: Found {len(cached_items)}/{len(filing_ids)} filing(s) in cache")
        if len(cached_items) < len(filing_ids):
            missing_ids = set(filing_ids) - set(cached_items.keys())
            logger.info(f"📋 Missing from cache ({len(missing_ids)} filing(s)): {', '.join(list(missing_ids)[:10])}" + 
                       (f" and {len(missing_ids) - 10} more..." if len(missing_ids) > 10 else ""))
        return cached_items
        
    except Exception as e:
        logger.error(f"Error checking cache: {e}")
        return {}


def store_filing_in_cache(filing_data: Dict[str, Any]) -> bool:
    """
    Store a filing in DynamoDB cache
    
    Args:
        filing_data: Dictionary containing filing data to store
    
    Returns:
        True if successful, False otherwise
    """
    if not cache_table:
        return False
    
    try:
        current_time = int(datetime.now(timezone.utc).timestamp())
        
        # Prepare item for DynamoDB
        item = {
            'filingId': filing_data.get('filingId'),
            'form': filing_data.get('form', 'N/A'),
            'cik': filing_data.get('cik', 'N/A'),
            'fileNumber': filing_data.get('fileNumber', 'N/A'),
            'filmNumber': filing_data.get('filmNumber', 'N/A'),
            'accession': filing_data.get('accession', ''),
            'adsh': filing_data.get('adsh', ''),
            'filingDate': filing_data.get('filingDate', 'N/A'),
            'reportingFor': filing_data.get('reportingFor', 'N/A'),
            'filingEntity': filing_data.get('filingEntity', 'N/A'),
            'located': filing_data.get('located', 'N/A'),
            'incorporated': filing_data.get('incorporated', 'N/A'),
            'periodEnding': filing_data.get('periodEnding', ''),
            'filingPageUrl': filing_data.get('filingPageUrl', ''),
            'primaryDocumentUrl': filing_data.get('primaryDocumentUrl', ''),
            'cachedAt': current_time,
            'lastAccessed': current_time,
        }
        
        # Add documentUrls as String Set (SS) if present
        if filing_data.get('documentUrls'):
            document_urls = filing_data['documentUrls']
            if isinstance(document_urls, list):
                item['documentUrls'] = document_urls  # DynamoDB will store as SS
        
        # Add dataFileUrls as String Set (SS) if present
        if filing_data.get('dataFileUrls'):
            data_file_urls = filing_data['dataFileUrls']
            if isinstance(data_file_urls, list):
                item['dataFileUrls'] = data_file_urls  # DynamoDB will store as SS
        
        # Add documentS3Keys as Map (M) - always store (even if empty dict)
        document_s3_keys = filing_data.get('documentS3Keys', {})
        if isinstance(document_s3_keys, dict):
            item['documentS3Keys'] = document_s3_keys  # DynamoDB will store as Map
        
        # Add dataFileS3Keys as Map (M) - always store (even if empty dict)
        data_file_s3_keys = filing_data.get('dataFileS3Keys', {})
        if isinstance(data_file_s3_keys, dict):
            item['dataFileS3Keys'] = data_file_s3_keys  # DynamoDB will store as Map
        
        # Add TTL (optional - 90 days from now)
        ttl_days = 90
        item['ttl'] = current_time + (ttl_days * 24 * 60 * 60)
        
        cache_table.put_item(Item=item)
        logger.info(f"Stored filing {item['filingId']} in cache")
        return True
        
    except Exception as e:
        logger.error(f"Error storing filing in cache: {e}")
        return False


def scrape_filing_page_for_data_files(filing_page_url: str) -> List[str]:
    """
    Scrape a SEC filing page (index.htm) to extract all data file URLs
    Only extracts from the "Data Files" table, not "Document Format Files" table
    
    Args:
        filing_page_url: URL to the SEC filing index page
    
    Returns:
        List of data file URLs found in the Data Files table
    """
    session = create_session()
    data_file_urls = []
    
    try:
        time.sleep(0.1)  # Rate limiting
        response = session.get(filing_page_url, timeout=30)
        response.raise_for_status()
        
        html_text = response.text
        
        # Find the "Data Files" header text (usually in <p>Data Files</p>)
        # Look for the pattern: <p>Data Files</p> or similar
        data_files_header_patterns = [
            r'<p[^>]*>Data Files</p>',
            r'<p[^>]*>Data Files',
            r'Data Files',
        ]
        
        data_files_header_pos = -1
        for pattern in data_files_header_patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if match:
                data_files_header_pos = match.end()  # Position after "Data Files" text
                logger.info(f"Found 'Data Files' header at position {data_files_header_pos}")
                break
        
        if data_files_header_pos < 0:
            # No Data Files section found
            logger.info("No 'Data Files' section found in filing page")
            return []
        
        # Find the <table> tag that comes AFTER "Data Files" header
        # This is the Data Files table (not Document Format Files which comes before)
        after_header = html_text[data_files_header_pos:]
        table_match = re.search(r'<table[^>]*>', after_header, re.IGNORECASE)
        
        if not table_match:
            logger.warning("Found 'Data Files' header but no table tag after it")
            return []
        
        # Get the position of the Data Files table start
        data_table_start = data_files_header_pos + table_match.start()
        logger.info(f"Found Data Files table starting at position {data_table_start}")
        
        # Find the closing </table> tag for this table
        table_content = html_text[data_table_start:]
        table_close_match = re.search(r'</table>', table_content, re.IGNORECASE)
        
        if not table_close_match:
            logger.warning("Found Data Files table start but no closing </table> tag")
            return []
        
        # Extract the complete table section
        table_section = table_content[:table_close_match.end()]
        logger.info(f"Extracted Data Files table section ({len(table_section)} chars)")
        
        # Verify this is actually the Data Files table by checking for the summary attribute
        # SEC pages often have: <table class="tableFile" summary="Data Files">
        if 'summary="Data Files"' not in table_section and "summary='Data Files'" not in table_section:
            # Check if it contains Data Files in the table
            if 'Data Files' not in table_section:
                logger.warning("Extracted table doesn't appear to be the Data Files table, verifying...")
        
        # Extract links from Data Files table
        # Extract all href links from within this table
        href_pattern = r'<a[^>]+href="([^"]+)"[^>]*>'
        all_links = re.findall(href_pattern, table_section, re.IGNORECASE)
        logger.info(f"Found {len(all_links)} href links in Data Files table")
        
        # Data Files typically contain XBRL files (.xsd, .xml), so we should NOT filter them out
        # However, we should still filter out index pages and navigation links
        for link in all_links:
            href_lower = link.lower()
            # Skip index pages and SEC navigation/search pages, but KEEP XBRL files
            if ('index' not in href_lower and 
                'browse-edgar' not in href_lower and
                'browse' not in href_lower and
                '/cgi-bin/' not in href_lower and
                'search' not in href_lower and
                '/viewer?' not in href_lower):  # Skip interactive data viewer links
                data_file_urls.append(link)
        
        logger.info(f"After filtering, {len(data_file_urls)} data file links remain")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_data_links = []
        for link in data_file_urls:
            if link not in seen:
                seen.add(link)
                unique_data_links.append(link)
        
        # Convert relative URLs to absolute
        base_url = '/'.join(filing_page_url.split('/')[:-1])
        absolute_urls = []
        for link in unique_data_links:
            if link.startswith('/'):
                absolute_url = f"{SEC_BASE_URL}{link}"
            elif not link.startswith('http'):
                absolute_url = f"{base_url}/{link}"
            else:
                absolute_url = link
            
            absolute_urls.append(absolute_url)
        
        logger.info(f"Returning {len(absolute_urls)} absolute data file URLs")
        if absolute_urls:
            logger.info(f"Data file URLs extracted: {absolute_urls[:10]}")  # Log first 10 URLs
        return absolute_urls
        
    except Exception as e:
        logger.error(f"Error scraping data files from filing page: {e}", exc_info=True)
        return []


def download_xbrl_zip(filing_page_url: str) -> Optional[bytes]:
    """
    Download XBRL ZIP file from SEC filing page.
    This is the preferred method as it provides the complete structured XBRL package.
    
    Args:
        filing_page_url: URL to the SEC filing index page (e.g., .../0001404912-25-000040-index.htm)
    
    Returns:
        XBRL ZIP file content as bytes, or None if not available or error
    """
    session = create_session()
    
    try:
        # Extract CIK and accession directory from URL
        # URL format: https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-dir}/{accession}-index.htm
        # Example: https://www.sec.gov/Archives/edgar/data/1404912/0001404912-25-000040/0001404912-25-000040-index.htm
        
        url_parts = filing_page_url.split('/')
        
        # Find the index of 'data' in the URL path
        data_index = -1
        for i, part in enumerate(url_parts):
            if part == 'data':
                data_index = i
                break
        
        if data_index == -1 or data_index + 1 >= len(url_parts):
            logger.warning(f"Cannot find 'data' in filing page URL: {filing_page_url}")
            return None
        
        # CIK is the part after 'data'
        cik = url_parts[data_index + 1]
        
        # Accession directory is the part after CIK (before the filename)
        accession_dir = None
        accession = None
        if data_index + 2 < len(url_parts):
            dir_name = url_parts[data_index + 2]
            if dir_name and not dir_name.endswith('.htm'):
                # SEC sometimes serves the index page from a dashed directory but the ZIPs live under
                # the undashed version (e.g., 0001404912-25-000040-index.htm vs 000140491225000040/xbrl.zip)
                accession_dir = dir_name.replace('-', '')
                # Build the accession with dashes for filenames
                if '-' in dir_name:
                    accession = dir_name
                elif len(dir_name) >= 18:
                    try:
                        accession = f"{dir_name[:10]}-{dir_name[10:12]}-{dir_name[12:]}"
                    except:
                        accession = dir_name
        
        # Also try to extract from filename if available
        if not accession and data_index + 3 < len(url_parts):
            filename = url_parts[data_index + 3]
            if filename.endswith('-index.htm') or filename.endswith('-index.html'):
                accession = filename.replace('-index.htm', '').replace('-index.html', '')
        
        if not cik or not accession_dir:
            logger.warning(f"Could not extract CIK or accession directory from URL: {filing_page_url} (CIK: {cik}, dir: {accession_dir})")
            return None
        
        # Construct base URL for the filing directory (using undashed directory like the test script)
        base_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik}/{accession_dir}"
        
        # Try the same ZIP locations as the test script
        zip_urls = []
        if accession:
            zip_urls.append(f"{base_url}/{accession}-xbrl.zip")
        zip_urls.append(f"{base_url}/{accession_dir}-xbrl.zip")
        zip_urls.append(f"{base_url}/xbrl.zip")
        
        # Try each ZIP URL until we find one
        for zip_url in zip_urls:
            try:
                logger.info(f"Trying to download XBRL ZIP from: {zip_url}")
                time.sleep(0.1)  # Rate limiting
                response = session.get(zip_url, timeout=30, stream=True)
                
                content_type = response.headers.get('Content-Type', '')
                content_length = response.headers.get('Content-Length', 'unknown')
                
                logger.info(f"Response for {zip_url}: status={response.status_code}, Content-Type={content_type}, Content-Length={content_length}")
                
                if response.status_code == 200:
                    # Check if it's actually a ZIP file
                    if 'zip' in content_type.lower() or zip_url.endswith('.zip'):
                        # Read the entire ZIP file content using iter_content (matching test script)
                        zip_content = b''
                        for chunk in response.iter_content(chunk_size=8192):
                            if chunk:
                                zip_content += chunk
                        
                        if len(zip_content) > 0:
                            # Verify it's actually a ZIP file by checking magic bytes
                            if zip_content.startswith(b'PK\x03\x04') or zip_content.startswith(b'PK\x05\x06'):
                                logger.info(f"Successfully downloaded XBRL ZIP from {zip_url} ({len(zip_content):,} bytes, Content-Type: {content_type})")
                                return zip_content
                            else:
                                logger.warning(f"Downloaded content from {zip_url} doesn't appear to be a valid ZIP file (magic bytes check failed)")
                                logger.info(f"First 20 bytes (hex): {zip_content[:20].hex() if len(zip_content) >= 20 else 'too short'}")
                                logger.info(f"First 100 bytes (text): {zip_content[:100] if len(zip_content) >= 100 else zip_content}")
                                continue
                        else:
                            logger.warning(f"ZIP file appears to be empty from {zip_url}")
                            continue
                    else:
                        logger.info(f"Unexpected content type {content_type} for {zip_url}, trying next URL...")
                        # Read a bit to see what we got
                        try:
                            peek = response.raw.read(200)
                            logger.info(f"First 200 bytes of response: {peek[:200]}")
                            response.raw.seek(0)  # Reset for potential retry
                        except:
                            pass
                        continue
                elif response.status_code == 404:
                    logger.info(f"ZIP file not found: {zip_url} (404)")
                    continue
                else:
                    logger.warning(f"Unexpected status code {response.status_code} for {zip_url}")
                    continue
                    
            except Exception as e:
                logger.error(f"Error fetching ZIP {zip_url}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                continue
        
        logger.warning(f"XBRL ZIP file not found for {filing_page_url}")
        return None
            
    except Exception as e:
        logger.error(f"Error downloading XBRL ZIP from {filing_page_url}: {e}")
        return None


def scrape_filing_page_for_documents(filing_page_url: str) -> List[str]:
    """
    Scrape a SEC filing page (index.htm) to extract all document URLs
    Only extracts from the "Document Format Files" table, not "Data Files" table
    
    Args:
        filing_page_url: URL to the SEC filing index page
    
    Returns:
        List of document URLs found in the Document Format Files table
    """
    session = create_session()
    document_urls = []
    
    try:
        time.sleep(0.1)  # Rate limiting
        response = session.get(filing_page_url, timeout=30)
        response.raise_for_status()
        
        html_text = response.text
        
        # Find the "Document Format Files" table section
        doc_table_start_patterns = [
            r'Document Format Files',
            r'<table[^>]*>.*?Document Format Files',
            r'<th[^>]*>.*?Document Format Files',
        ]
        
        data_table_start_patterns = [
            r'Data Files',
            r'<table[^>]*>.*?Data Files',
            r'<th[^>]*>.*?Data Files',
        ]
        
        # Find the start of Document Format Files table
        doc_table_start = -1
        for pattern in doc_table_start_patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if match:
                doc_table_start = match.start()
                break
        
        # Find the start of Data Files table (if it exists)
        data_table_start = len(html_text)  # Default to end of text
        for pattern in data_table_start_patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if match:
                data_table_start = match.start()
                break
        
        # Extract the section containing Document Format Files table
        if doc_table_start >= 0:
            before_start = html_text[:doc_table_start]
            table_open_match = before_start.rfind('<table')
            if table_open_match >= 0:
                # Find the closing </table> tag for the Document Format Files table
                # Look for the next </table> after our table start, but before Data Files table
                table_section_full = html_text[table_open_match:data_table_start]
                # Find all </table> tags and take the first one (the Document Format Files table)
                table_close_match = table_section_full.find('</table>')
                if table_close_match > 0:
                    # Include the closing tag
                    table_section = table_section_full[:table_close_match + 8]
                else:
                    # If no closing tag found, use everything up to Data Files table
                    table_section = table_section_full
            else:
                # If no table tag found before "Document Format Files", search from that point
                table_section = html_text[doc_table_start:data_table_start]
        else:
            table_section = html_text
        
        logger.debug(f"Extracted table section length: {len(table_section)} chars, found {len(re.findall(r'<a[^>]+href=', table_section, re.IGNORECASE))} href links")
        
        # Extract ALL href links from the table section (more reliable than pattern matching)
        # This captures all files regardless of extension
        href_pattern = r'<a[^>]+href="([^"]+)"[^>]*>'
        all_hrefs = re.findall(href_pattern, table_section, re.IGNORECASE)
        
        # Filter out index pages, XBRL/taxonomy files, and SEC navigation pages
        # Document Format Files should NOT include XBRL files (those are in Data Files table)
        document_urls = []
        logger.info(f"Found {len(all_hrefs)} total href links in Document Format Files table")
        for href in all_hrefs:
            href_lower = href.lower()
            # Skip index pages, XBRL, taxonomy files, and SEC navigation/search pages
            # XBRL files (.xsd, .xml taxonomy files) belong in Data Files, not Document Format Files
            if ('index' not in href_lower and 
                'xbrl' not in href_lower and
                'taxonomy' not in href_lower and
                'schema' not in href_lower and
                '.xsd' not in href_lower and  # XBRL schema files
                'browse-edgar' not in href_lower and
                'browse' not in href_lower and
                '/cgi-bin/' not in href_lower and
                'search' not in href_lower):
                document_urls.append(href)
        
        logger.info(f"After filtering, {len(document_urls)} document format file links remain (XBRL files filtered out)")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_doc_links = []
        for link in document_urls:
            if link not in seen:
                seen.add(link)
                unique_doc_links.append(link)
        
        # Convert relative URLs to absolute
        base_url = '/'.join(filing_page_url.split('/')[:-1])
        absolute_urls = []
        for link in unique_doc_links:
            if link.startswith('/'):
                absolute_url = f"{SEC_BASE_URL}{link}"
            elif not link.startswith('http'):
                absolute_url = f"{base_url}/{link}"
            else:
                absolute_url = link
            
            # Skip index pages, XBRL taxonomy files, and SEC navigation/search pages
            absolute_url_lower = absolute_url.lower()
            if ('index' not in absolute_url_lower and 
                'xbrl' not in absolute_url_lower and
                'taxonomy' not in absolute_url_lower and
                'schema' not in absolute_url_lower and
                'browse-edgar' not in absolute_url_lower and
                'browse' not in absolute_url_lower and
                '/cgi-bin/' not in absolute_url_lower and
                'search' not in absolute_url_lower):
                absolute_urls.append(absolute_url)
        
        # Sort: XML files first, then HTML, then TXT
        def link_priority(link):
            if link.endswith('.xml'):
                return 0
            elif 'primary' in link.lower() or 'document' in link.lower():
                return 1
            elif link.endswith(('.html', '.htm')):
                return 2
            elif 'doc' in link.lower():
                return 3
            else:
                return 4
        
        sorted_urls = sorted(absolute_urls, key=link_priority)
        
        logger.info(f"Returning {len(sorted_urls)} document format file URLs")
        if sorted_urls:
            logger.info(f"Document format file URLs: {sorted_urls[:5]}...")  # Log first 5 URLs
        
        return sorted_urls
        
    except Exception as e:
        logger.error(f"Error scraping filing page: {e}")
        return []


def download_document_to_s3(document_url: str, filing_id: str, filename: str) -> Optional[str]:
    """
    Download a document from SEC and store it in S3
    
    Args:
        document_url: URL of the document to download
        filing_id: Filing ID (used as S3 prefix)
        filename: Filename to use in S3 (extracted from URL or generated)
    
    Returns:
        S3 key if successful, None otherwise
    """
    if not s3_client or not S3_BUCKET_NAME:
        logger.warning("S3 client not configured, skipping download")
        return None
    
    session = create_session()
    
    try:
        # Add delay to avoid rate limiting
        time.sleep(0.1)
        
        # Download the document
        response = session.get(document_url, timeout=30)
        response.raise_for_status()
        
        if len(response.content) == 0:
            logger.warning(f"Empty content for {document_url}")
            return None
        
        # Determine content type from extension or response headers
        content_type = response.headers.get('Content-Type', 'application/octet-stream')
        if filename.endswith('.xml'):
            content_type = 'application/xml'
        elif filename.endswith(('.html', '.htm')):
            content_type = 'text/html'
        elif filename.endswith('.txt'):
            content_type = 'text/plain'
        elif filename.endswith('.pdf'):
            content_type = 'application/pdf'
        
        # Generate S3 key: filings/{filing_id}/{filename}
        s3_key = f"filings/{filing_id}/{filename}"
        
        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            Body=response.content,
            ContentType=content_type
        )
        
        logger.info(f"Downloaded and stored {document_url} to s3://{S3_BUCKET_NAME}/{s3_key}")
        return s3_key
        
    except Exception as e:
        logger.error(f"Error downloading document {document_url}: {e}")
        return None


def download_filing_documents_to_s3(filing_id: str, document_urls: List[str], data_file_urls: List[str] = None, filing_page_url: Optional[str] = None, download_xbrl: bool = True) -> Dict[str, Any]:
    """
    Download all documents for a filing to S3.
    This method is called after the DynamoDB index is created.
    Creates folder structure: filings/{filing_id}/documentformatfiles/ and filings/{filing_id}/datafiles/
    
    Args:
        filing_id: DynamoDB primary key (filingId) in format: {form}-{CIK}-{fileNumber}-{filmNumber}
        document_urls: List of document URLs from "Document Format Files" table to download
        data_file_urls: Optional list of data file URLs from "Data Files" table to download
        filing_page_url: Optional URL to the filing page (index.htm) - not downloaded
    
    Returns:
        Dict with:
        - documentS3Keys: Dict mapping document URL to S3 key (in documentformatfiles/)
        - dataFileS3Keys: Dict mapping data file URL to S3 key (in datafiles/)
        - success: Boolean indicating if at least one document was downloaded
    """
    result = {
        'documentS3Keys': {},
        'dataFileS3Keys': {},
        'xbrlS3Key': None,
        'success': False
    }
    
    if data_file_urls is None:
        data_file_urls = []
    
    if not s3_client or not S3_BUCKET_NAME:
        logger.warning("S3 client not configured, skipping downloads")
        return result
    
    # Validate filing_id format - must have at least 4 components when split by dashes
    # Expected format: {form}-{CIK}-{fileNumber}-{filmNumber} (matches DynamoDB primary key)
    # Note: file_number may contain dashes (e.g., "001-34756"), so we split and check parts
    if not filing_id:
        logger.error(f"Invalid filing_id format for S3 download: missing filing_id. Skipping download.")
        return result
    
    parts = filing_id.split('-')
    if len(parts) < 4:
        logger.error(f"Invalid filing_id format for S3 download: '{filing_id}'. Expected format: {{form}}-{{CIK}}-{{fileNumber}}-{{filmNumber}}. "
                    f"Split into {len(parts)} parts: {parts}. Skipping download.")
        return result
    
    # Sanitize filing_id for S3 (remove any invalid characters)
    import re
    sanitized_filing_id = re.sub(r'[^a-zA-Z0-9!\-_.*\'()]', '_', filing_id)
    if sanitized_filing_id != filing_id:
        logger.warning(f"Sanitized filing_id for S3: {filing_id} -> {sanitized_filing_id}")
        filing_id = sanitized_filing_id
    
    logger.info(f"Downloading documents for filing_id: {filing_id}")
    logger.info(f"  - Document Format Files: {len(document_urls)} files")
    logger.info(f"  - Data Files: {len(data_file_urls)} files")
    
    # Identify the iXBRL document link (if any) so we can associate the ZIP with it
    def is_ixbrl_document(url: str) -> bool:
        if not url:
            return False
        url_lower = url.lower()
        return 'ix?doc=' in url_lower or url_lower.startswith(f"{SEC_BASE_URL}/ix?")
    
    ixbrl_doc_url = next((url for url in document_urls if is_ixbrl_document(url)), None)
    if ixbrl_doc_url:
        logger.info(f"Detected iXBRL document link: {ixbrl_doc_url}")
    
    # Skip downloading the index page - we only need the actual document files
    
    # Download each document from Document Format Files table
    # Match glue script behavior: download and verify content type (not just URL extension)
    for doc_url in document_urls:
        try:
            if ixbrl_doc_url and doc_url == ixbrl_doc_url:
                logger.info(f"Skipping direct download for iXBRL viewer link {doc_url} - will attach XBRL ZIP instead")
                continue
        
            # Download the document first to check its actual content type
            # Use a session without compression to ensure we get exact bytes
            session = create_session()
            # Override Accept-Encoding for document downloads to get uncompressed content
            download_headers = session.headers.copy()
            download_headers['Accept-Encoding'] = 'identity'  # Request uncompressed content
            time.sleep(0.1)  # Rate limiting
            response = session.get(doc_url, headers=download_headers, timeout=30)
            response.raise_for_status()
            
            if len(response.content) == 0:
                logger.warning(f"Empty content for {doc_url}, skipping")
                continue
            
            # Preserve raw bytes - don't decode, just use as-is to preserve all content exactly
            # response.content is already the decompressed bytes (requests handles this automatically)
            # But by requesting 'identity', we avoid any compression/decompression issues
            doc_content = response.content
            
            # Log first 200 bytes for debugging (to verify we're getting the right content)
            if len(doc_content) > 0:
                preview = doc_content[:200] if len(doc_content) >= 200 else doc_content
                try:
                    preview_str = preview.decode('utf-8', errors='replace')[:200]
                    logger.debug(f"Content preview (first 200 chars): {preview_str[:100]}...")
                except:
                    logger.debug(f"Content preview (first 200 bytes, hex): {preview.hex()[:100]}...")
            
            # Get charset from response headers if available
            response_charset = None
            content_type_header = response.headers.get('Content-Type', '')
            if 'charset=' in content_type_header:
                try:
                    charset_part = content_type_header.split('charset=')[1].split(';')[0].strip().strip('"\'')
                    response_charset = charset_part
                except (IndexError, AttributeError):
                    pass
            
            # For detection only, use raw bytes to check content
            # We check bytes against bytes to avoid encoding issues
            content_start = doc_content[:1000] if len(doc_content) >= 1000 else doc_content
            content_start_lower = content_start.lower()
            
            # Check for HTML indicators (matching glue script logic) - use bytes
            # Check for various HTML/XHTML DOCTYPE declarations and HTML tags
            is_html = any(indicator in content_start_lower for indicator in [
                b'<!doctype html',  # Standard HTML5 DOCTYPE
                b'<!doctype html public',  # XHTML DOCTYPE with PUBLIC
                b'<!doctype html system',  # XHTML DOCTYPE with SYSTEM
                b'<html',  # HTML tag (with or without xmlns)
                b'<head>',  # HEAD tag
                b'<head ',  # HEAD tag with attributes
                b'<body>',  # BODY tag
                b'<body ',  # BODY tag with attributes
                b'<style',  # STYLE tag
                b'sec form 4',  # SEC form indicators
                b'sec form 3',
                b'sec form 5',
                b'form 4',
                b'form 3',
                b'form 5',
                b'schedule 13',  # Schedule 13D/13G forms
                b'schedule 13d',
                b'schedule 13g',
            ])
            
            # Check for XML indicators
            is_xml = (doc_content.startswith(b'<?xml') or 
                     b'<ownershipDocument' in doc_content or 
                     b'<document>' in doc_content or 
                     b'<edgarDocument' in doc_content)
            
            # Skip if this is the actual filing index page
            # Since we're extracting links strictly from within the "Document Format Files" table,
            # we only need to check if the URL itself is an index.htm file
            # The content-based check was too aggressive and was incorrectly skipping real documents
            is_index_page = (
                '-index.htm' in doc_url.lower() or 
                doc_url.endswith('index.htm') or
                doc_url.endswith('index.html')
            )
            
            # Skip SEC navigation/search pages (browse-edgar, search pages, etc.)
            is_sec_nav_page = (b'browse-edgar' in content_start_lower or
                             b'sec.gov/cgi-bin' in content_start_lower or
                             b'edgar search' in content_start_lower or
                             b'company search' in content_start_lower or
                             b'filings search' in content_start_lower)
            
            if is_index_page:
                logger.warning(f"Skipping {doc_url} - appears to be filing index page, not actual document")
                continue
            
            if is_sec_nav_page:
                logger.warning(f"Skipping {doc_url} - appears to be SEC navigation/search page, not actual document")
                continue
            
            # Extract filename from URL - PRESERVE original extension
            filename = doc_url.split('/')[-1]
            if not filename or filename == '' or '?' in filename:
                # Generate filename from URL path
                path_parts = doc_url.split('/')
                if len(path_parts) > 1:
                    filename = path_parts[-1]
                else:
                    # If we can't get filename from URL, try to determine extension from content
                    if is_xml and not is_html:
                        file_ext = 'xml'
                    elif is_html:
                        file_ext = 'html'
                    elif doc_url.endswith('.txt'):
                        file_ext = 'txt'
                    else:
                        file_ext = 'xml'
                    filename = f"document_{abs(hash(doc_url)) % 100000}.{file_ext}"
            
            # Clean filename (remove query params if any)
            if '?' in filename:
                filename = filename.split('?')[0]
            
            # Extract original extension from URL
            original_ext = None
            if '.' in filename:
                original_ext = filename.rsplit('.', 1)[1].lower()
                base_name = filename.rsplit('.', 1)[0]
            else:
                base_name = filename
            
            # DETECT HTML content and change extension if needed
            # If file has .xml extension but content is actually HTML, change to .html
            if original_ext == 'xml' and is_html:
                logger.info(f"Detected HTML content in {filename}, changing extension from .xml to .html")
                original_ext = 'html'
                filename = f"{base_name}.html"
            # If file has no extension but is HTML, add .html
            elif not original_ext and is_html:
                logger.info(f"Detected HTML content in {filename}, adding .html extension")
                original_ext = 'html'
                filename = f"{base_name}.html"
            
            # Determine content type based on actual content (for Content-Type header only)
            # Preserve charset from response if available
            if is_xml and not is_html:
                content_type = 'application/xml'
                if response_charset:
                    content_type += f'; charset={response_charset}'
            elif is_html:
                content_type = 'text/html'
                # Preserve charset from response, or default to UTF-8 for HTML
                charset = response_charset or 'utf-8'
                content_type += f'; charset={charset}'
            elif original_ext == 'txt':
                content_type = 'text/plain'
                if response_charset:
                    content_type += f'; charset={response_charset}'
            elif original_ext == 'json':
                content_type = 'application/json'
                if response_charset:
                    content_type += f'; charset={response_charset}'
            elif original_ext == 'pdf':
                content_type = 'application/pdf'
            elif original_ext in ['jpg', 'jpeg']:
                content_type = 'image/jpeg'
            elif original_ext == 'png':
                content_type = 'image/png'
            elif original_ext == 'gif':
                content_type = 'image/gif'
            elif original_ext in ['xls', 'xlsx']:
                content_type = 'application/vnd.ms-excel' if original_ext == 'xls' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            elif original_ext in ['doc', 'docx']:
                content_type = 'application/msword' if original_ext == 'doc' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            else:
                # Default based on content detection if no extension
                if is_xml:
                    content_type = 'application/xml'
                    if response_charset:
                        content_type += f'; charset={response_charset}'
                else:
                    content_type = 'application/octet-stream'
            
            # Sanitize filename for S3 (remove invalid characters, but preserve extension)
            if '.' in filename:
                base_name, ext = filename.rsplit('.', 1)
                base_name = re.sub(r'[^a-zA-Z0-9!\-_.*\'()]', '_', base_name)
                # Add UUID to base name to ensure uniqueness and prevent overwrites
                unique_id = str(uuid.uuid4())[:8]  # Use first 8 chars of UUID
                filename = f"{base_name}_{unique_id}.{ext}"
            else:
                filename = re.sub(r'[^a-zA-Z0-9!\-_.*\'()]', '_', filename)
                # Add UUID if no extension
                unique_id = str(uuid.uuid4())[:8]
                filename = f"{filename}_{unique_id}"
            
            # If this is HTML content, fix SEC URLs to use proper SEC.gov URLs
            # Do this BEFORE type verification since we need to decode bytes
            if is_html:
                try:
                    # Decode to string for URL processing
                    encoding = response_charset or response.encoding or 'utf-8'
                    html_content = doc_content.decode(encoding, errors='replace')
                    
                    # Fix SEC URLs in the HTML content
                    # Pattern 1: /cgi-bin/browse-edgar?action=getcompany&CIK=XXXXX -> https://www.sec.gov/edgar/browse/?CIK=XXXXX
                    # Handle both &amp; (HTML entity) and & (direct)
                    html_content = re.sub(
                        r'/cgi-bin/browse-edgar\?action=getcompany&amp;CIK=(\d+)',
                        r'https://www.sec.gov/edgar/browse/?CIK=\1',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    html_content = re.sub(
                        r'/cgi-bin/browse-edgar\?action=getcompany&CIK=(\d+)',
                        r'https://www.sec.gov/edgar/browse/?CIK=\1',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    
                    # Pattern 2: Any S3 bucket URLs pointing to SEC content -> proper SEC.gov URLs
                    html_content = re.sub(
                        r'https?://[^/]+\.s3[^/]*\.amazonaws\.com[^"\']*cgi-bin/browse-edgar\?action=getcompany&amp;CIK=(\d+)',
                        r'https://www.sec.gov/edgar/browse/?CIK=\1',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    html_content = re.sub(
                        r'https?://[^/]+\.s3[^/]*\.amazonaws\.com[^"\']*cgi-bin/browse-edgar\?action=getcompany&CIK=(\d+)',
                        r'https://www.sec.gov/edgar/browse/?CIK=\1',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    
                    # Pattern 3: Fix relative URLs that should be absolute SEC.gov URLs
                    # /cgi-bin/browse-edgar -> https://www.sec.gov/cgi-bin/browse-edgar
                    html_content = re.sub(
                        r'href=["\'](/cgi-bin/browse-edgar[^"\']*)["\']',
                        lambda m: f'href="https://www.sec.gov{m.group(1)}"',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    
                    # Pattern 4: Fix any other relative SEC URLs
                    html_content = re.sub(
                        r'href=["\'](/Archives/edgar[^"\']*)["\']',
                        lambda m: f'href="https://www.sec.gov{m.group(1)}"',
                        html_content,
                        flags=re.IGNORECASE
                    )
                    
                    # Re-encode back to bytes with the same encoding
                    doc_content = html_content.encode(encoding, errors='replace')
                    logger.debug(f"Fixed SEC URLs in HTML content (encoding: {encoding})")
                except Exception as e:
                    logger.warning(f"Error processing URLs in HTML content: {e}. Using original content.")
                    # If URL processing fails, use original content
            
            # Verify we have bytes, not a string (after URL processing)
            if isinstance(doc_content, str):
                logger.error(f"ERROR: doc_content is a string, not bytes! Converting to bytes with UTF-8 encoding.")
                doc_content = doc_content.encode('utf-8')
            elif not isinstance(doc_content, bytes):
                logger.error(f"ERROR: doc_content is neither string nor bytes! Type: {type(doc_content)}")
                doc_content = bytes(doc_content)
            
            # Construct S3 key for upload
            s3_key = f"filings/{filing_id}/documentformatfiles/{filename}"
            
            s3_client.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=s3_key,
                Body=doc_content,  # Processed bytes with fixed URLs
                ContentType=content_type
            )
            
            if s3_key:
                result['documentS3Keys'][doc_url] = s3_key
                result['success'] = True
                logger.info(f"Downloaded document to {s3_key} (preserved extension: {original_ext or 'none'}, size: {len(doc_content):,} bytes, type: {type(doc_content).__name__})")
        except Exception as e:
            logger.error(f"Error downloading document {doc_url}: {e}")
            continue
    
    # Download each data file from Data Files table
    for data_file_url in data_file_urls:
        try:
            # Download the data file first to check its actual content type
            session = create_session()
            time.sleep(0.1)  # Rate limiting
            response = session.get(data_file_url, timeout=30)
            response.raise_for_status()
            
            if len(response.content) == 0:
                logger.warning(f"Empty content for {data_file_url}, skipping")
                continue
            
            data_file_content = response.content
            content_start_lower = data_file_content[:1000].lower() if len(data_file_content) >= 1000 else data_file_content.lower()
            
            # Check for HTML indicators - use lowercase for consistency
            is_html = any(indicator in content_start_lower for indicator in [
                b'<!doctype html',  # Standard HTML5 DOCTYPE
                b'<!doctype html public',  # XHTML DOCTYPE with PUBLIC
                b'<!doctype html system',  # XHTML DOCTYPE with SYSTEM
                b'<html',  # HTML tag (with or without xmlns)
                b'<head>',  # HEAD tag
                b'<head ',  # HEAD tag with attributes
                b'<body>',  # BODY tag
                b'<body ',  # BODY tag with attributes
                b'<style',  # STYLE tag
            ])
            
            # Check for XML indicators
            is_xml = (data_file_content.startswith(b'<?xml') or 
                     b'<ownershipDocument' in data_file_content or 
                     b'<document>' in data_file_content or 
                     b'<edgarDocument' in data_file_content)
            
            # Skip if this is the actual filing index page
            # Since we're extracting links strictly from within the "Data Files" table,
            # we only need to check if the URL itself is an index.htm file
            # The content-based check was too aggressive and was incorrectly skipping real documents
            is_index_page = (
                '-index.htm' in data_file_url.lower() or 
                data_file_url.endswith('index.htm') or
                data_file_url.endswith('index.html')
            )
            
            # Skip SEC navigation/search pages (browse-edgar, search pages, etc.)
            is_sec_nav_page = (b'browse-edgar' in content_start_lower or
                             b'sec.gov/cgi-bin' in content_start_lower or
                             b'edgar search' in content_start_lower or
                             b'company search' in content_start_lower or
                             b'filings search' in content_start_lower)
            
            if is_index_page:
                logger.warning(f"Skipping {data_file_url} - appears to be filing index page, not actual data file")
                continue
            
            if is_sec_nav_page:
                logger.warning(f"Skipping {data_file_url} - appears to be SEC navigation/search page, not actual data file")
                continue
            
            # Extract filename from URL - PRESERVE original extension
            filename = data_file_url.split('/')[-1]
            if not filename or filename == '' or '?' in filename:
                # Generate filename from URL path
                path_parts = data_file_url.split('/')
                if len(path_parts) > 1:
                    filename = path_parts[-1]
                else:
                    # If we can't get filename from URL, try to determine extension from content
                    if is_xml and not is_html:
                        file_ext = 'xml'
                    elif is_html:
                        file_ext = 'html'
                    elif data_file_url.endswith('.txt'):
                        file_ext = 'txt'
                    elif data_file_url.endswith('.json'):
                        file_ext = 'json'
                    else:
                        file_ext = 'xml'
                    filename = f"datafile_{abs(hash(data_file_url)) % 100000}.{file_ext}"
            
            # Clean filename (remove query params if any)
            if '?' in filename:
                filename = filename.split('?')[0]
            
            # Extract original extension from URL
            original_ext = None
            if '.' in filename:
                original_ext = filename.rsplit('.', 1)[1].lower()
                base_name = filename.rsplit('.', 1)[0]
            else:
                base_name = filename
            
            # DETECT HTML content and change extension if needed
            # If file has .xml extension but content is actually HTML, change to .html
            if original_ext == 'xml' and is_html:
                logger.info(f"Detected HTML content in {filename}, changing extension from .xml to .html")
                original_ext = 'html'
                filename = f"{base_name}.html"
            # If file has no extension but is HTML, add .html
            elif not original_ext and is_html:
                logger.info(f"Detected HTML content in {filename}, adding .html extension")
                original_ext = 'html'
                filename = f"{base_name}.html"
            
            # Determine content type based on actual content (for Content-Type header only)
            if is_xml and not is_html:
                content_type = 'application/xml'
            elif is_html:
                content_type = 'text/html'
            elif original_ext == 'txt':
                content_type = 'text/plain'
            elif original_ext == 'json':
                content_type = 'application/json'
            elif original_ext == 'pdf':
                content_type = 'application/pdf'
            elif original_ext in ['jpg', 'jpeg']:
                content_type = 'image/jpeg'
            elif original_ext == 'png':
                content_type = 'image/png'
            elif original_ext == 'gif':
                content_type = 'image/gif'
            elif original_ext in ['xls', 'xlsx']:
                content_type = 'application/vnd.ms-excel' if original_ext == 'xls' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            elif original_ext in ['doc', 'docx']:
                content_type = 'application/msword' if original_ext == 'doc' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            else:
                # Default based on content detection if no extension
                if is_xml:
                    content_type = 'application/xml'
                else:
                    content_type = 'application/octet-stream'
            
            # Sanitize filename for S3 (remove invalid characters, but preserve extension)
            if '.' in filename:
                base_name, ext = filename.rsplit('.', 1)
                base_name = re.sub(r'[^a-zA-Z0-9!\-_.*\'()]', '_', base_name)
                # Add UUID to base name to ensure uniqueness and prevent overwrites
                unique_id = str(uuid.uuid4())[:8]  # Use first 8 chars of UUID
                filename = f"{base_name}_{unique_id}.{ext}"
            else:
                filename = re.sub(r'[^a-zA-Z0-9!\-_.*\'()]', '_', filename)
                # Add UUID if no extension
                unique_id = str(uuid.uuid4())[:8]
                filename = f"{filename}_{unique_id}"
            
            # Upload to S3 in datafiles/ subfolder
            s3_key = f"filings/{filing_id}/datafiles/{filename}"
            s3_client.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=s3_key,
                Body=data_file_content,
                ContentType=content_type
            )
            
            if s3_key:
                result['dataFileS3Keys'][data_file_url] = s3_key
                result['success'] = True
                logger.info(f"Downloaded data file to {s3_key} (preserved extension: {original_ext or 'none'}, size: {len(data_file_content):,} bytes)")
        except Exception as e:
            logger.error(f"Error downloading data file {data_file_url}: {e}")
            continue
    
    # Download XBRL ZIP file if requested and filing page URL is provided
    if download_xbrl and filing_page_url:
        try:
            logger.info(f"Attempting to download XBRL ZIP file for filing_id: {filing_id}")
            xbrl_zip_content = download_xbrl_zip(filing_page_url)
            
            if xbrl_zip_content:
                # Generate unique filename for ZIP file
                unique_id = str(uuid.uuid4())[:8]
                zip_filename = f"xbrl_{unique_id}.zip"
                
                # Upload to S3 alongside other document format files
                xbrl_s3_key = f"filings/{filing_id}/documentformatfiles/{zip_filename}"
                s3_client.put_object(
                    Bucket=S3_BUCKET_NAME,
                    Key=xbrl_s3_key,
                    Body=xbrl_zip_content,
                    ContentType='application/zip'
                )
                
                result['xbrlS3Key'] = xbrl_s3_key
                
                # Link the XBRL ZIP to the iXBRL document entry so the frontend download button serves the ZIP
                if ixbrl_doc_url:
                    result['documentS3Keys'][ixbrl_doc_url] = xbrl_s3_key
                    logger.info(f"Linked XBRL ZIP to document entry {ixbrl_doc_url}")
                else:
                    logger.info("No iXBRL document link detected to associate with the ZIP")
                
                result['success'] = True
                logger.info(f"Successfully downloaded XBRL ZIP file to {xbrl_s3_key} (size: {len(xbrl_zip_content):,} bytes)")
            else:
                logger.info(f"No XBRL ZIP file available for filing_id: {filing_id}")
        except Exception as e:
            logger.error(f"Error downloading XBRL ZIP file for {filing_id}: {e}")
            # Don't fail the entire download if XBRL download fails
    
    if result['success']:
        logger.info(f"Successfully downloaded {len(result['documentS3Keys'])} document(s) and {len(result['dataFileS3Keys'])} data file(s) for filing_id: {filing_id}")
        if result.get('xbrlS3Key'):
            logger.info(f"XBRL ZIP file downloaded to: {result['xbrlS3Key']}")
    else:
        logger.warning(f"No files were successfully downloaded for filing_id: {filing_id}")
    
    return result


def get_company_search_preview(search_term: str) -> List[Dict[str, Any]]:
    """
    Get search preview/autocomplete results from SEC search-index API
    
    Args:
        search_term: Company name or partial name to search
    
    Returns:
        List of matching companies with name, CIK, ticker
    """
    session = create_session()
    
    try:
        url = f"https://efts.sec.gov/LATEST/search-index"
        params = {
            'keysTyped': search_term
        }
        
        headers = {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'en-US,en;q=0.9',
            'origin': 'https://www.sec.gov',
            'referer': 'https://www.sec.gov/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': SEC_USER_AGENT
        }
        
        time.sleep(0.1)  # Rate limiting
        response = session.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        results = []
        
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    name = (item.get('name') or item.get('entityName') or 
                           item.get('entity') or item.get('title') or '')
                    cik = (item.get('cik') or item.get('CIK') or 
                          item.get('cik_str') or '')
                    ticker = (item.get('ticker') or item.get('symbol') or 
                             item.get('tickerSymbol') or '')
                    
                    if name or cik:
                        results.append({
                            'name': str(name),
                            'cik': str(cik) if cik else '',
                            'ticker': str(ticker) if ticker else ''
                        })
        elif isinstance(data, dict):
            if 'hits' in data:
                hits_data = data.get('hits', {})
                hits_list = hits_data.get('hits', [])
                
                for hit in hits_list:
                    if isinstance(hit, dict):
                        cik = hit.get('_id', '')
                        source = hit.get('_source', {})
                        name = source.get('entity', source.get('entity_words', ''))
                        ticker = source.get('ticker', source.get('tickers', ''))
                        if isinstance(ticker, list) and len(ticker) > 0:
                            ticker = ticker[0]
                        
                        if name or cik:
                            results.append({
                                'name': str(name),
                                'cik': str(cik) if cik else '',
                                'ticker': str(ticker) if ticker else ''
                            })
            elif 'results' in data:
                for item in data['results']:
                    if isinstance(item, dict):
                        name = (item.get('name') or item.get('entityName') or 
                               item.get('entity') or '')
                        cik = (item.get('cik') or item.get('CIK') or 
                              item.get('cik_str') or '')
                        ticker = (item.get('ticker') or item.get('symbol') or 
                                 item.get('tickerSymbol') or '')
                        
                        if name or cik:
                            results.append({
                                'name': str(name),
                                'cik': str(cik) if cik else '',
                                'ticker': str(ticker) if ticker else ''
                            })
        
        # Limit to first 10 results
        return results[:10]
        
    except Exception as e:
        logger.error(f"Error getting autocomplete: {e}")
        return []


def search_by_search_index_api(search_params: Dict[str, Any], page: int = 1) -> Dict[str, Any]:
    """
    Search using SEC search-index API (Elasticsearch endpoint)
    
    Fetches ONE API page at a time (~100 results), then slices to return 10 results.
    This matches the test script behavior - fetch on demand, not all at once.
    
    Args:
        search_params: Dictionary with search parameters
        page: Display page number (1-indexed, 10 results per page)
    
    Returns:
        Dict with success flag, total_found, and results list (10 results)
    """
    session = create_session()
    
    try:
        # Build base query parameters
        base_params = {
            'dateRange': 'all'
        }
        
        # Add CIK(s) if provided - support both single CIK and multiple CIKs
        if search_params.get('cik'):
            cik_value = search_params['cik']
            if isinstance(cik_value, list):
                # Multiple CIKs - join with comma
                ciks_list = [str(cik).zfill(10) for cik in cik_value if cik]
                if ciks_list:
                    base_params['ciks'] = ','.join(ciks_list)
            else:
                # Single CIK
                base_params['ciks'] = str(cik_value).zfill(10)
        
        # Add entity name(s) if provided - support both single and multiple
        if search_params.get('entityName'):
            entity_name_value = search_params['entityName']
            if isinstance(entity_name_value, list):
                # Multiple entity names - join with comma
                entity_names = [str(name) for name in entity_name_value if name]
                if entity_names:
                    base_params['entityName'] = ','.join(entity_names)
            else:
                # Single entity name
                entity_name = str(entity_name_value)
                if search_params.get('cik'):
                    # If CIK is provided, format as "Name (CIK 0000000000)"
                    cik_value = search_params['cik']
                    if isinstance(cik_value, list) and len(cik_value) > 0:
                        # Use first CIK for formatting if multiple provided
                        cik_str = str(cik_value[0]).zfill(10)
                        base_params['entityName'] = f"{entity_name} (CIK {cik_str})"
                    elif not isinstance(cik_value, list):
                        cik_str = str(cik_value).zfill(10)
                        base_params['entityName'] = f"{entity_name} (CIK {cik_str})"
                    else:
                        base_params['entityName'] = entity_name
                else:
                    base_params['entityName'] = entity_name
        
        # Add date range
        if search_params.get('dateFrom'):
            base_params['startdt'] = search_params['dateFrom']
        if search_params.get('dateTo'):
            base_params['enddt'] = search_params['dateTo']
        
        # Add other filters
        if search_params.get('reportingFor'):
            base_params['reportingFor'] = search_params['reportingFor']
        
        # Add location(s) - support both single and multiple
        if search_params.get('located'):
            located_value = search_params['located']
            if isinstance(located_value, list):
                # Multiple locations - join with comma
                locations = [str(loc) for loc in located_value if loc]
                if locations:
                    base_params['located'] = ','.join(locations)
            else:
                base_params['located'] = str(located_value)
        
        # Add incorporation state(s) - support both single and multiple
        if search_params.get('incorporated'):
            incorporated_value = search_params['incorporated']
            if isinstance(incorporated_value, list):
                # Multiple states - join with comma
                states = [str(state) for state in incorporated_value if state]
                if states:
                    base_params['incorporated'] = ','.join(states)
            else:
                base_params['incorporated'] = str(incorporated_value)
        if search_params.get('fileNumber'):
            base_params['fileNumber'] = search_params['fileNumber']
        if search_params.get('filmNumber'):
            base_params['filmNumber'] = search_params['filmNumber']
        # Add keywords - support both single keyword and multiple keywords
        if search_params.get('keywords'):
            keywords_value = search_params['keywords']
            if isinstance(keywords_value, list):
                # Multiple keywords - join with OR operator for broader search
                # This allows any document containing any of the keywords to match
                keywords_list = [str(keyword).strip() for keyword in keywords_value if keyword and str(keyword).strip()]
                if keywords_list:
                    # Use OR logic: "(keyword1 OR keyword2 OR keyword3)"
                    base_params['q'] = '(' + ' OR '.join([f'"{kw}"' for kw in keywords_list]) + ')'
            else:
                # Single keyword
                base_params['q'] = str(keywords_value).strip()
        if search_params.get('formTypes'):
            base_params['forms'] = ','.join(search_params['formTypes'])
        
        url = "https://efts.sec.gov/LATEST/search-index"
        
        headers = {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'en-US,en;q=0.9',
            'origin': 'https://www.sec.gov',
            'referer': 'https://www.sec.gov/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': SEC_USER_AGENT
        }
        
        # Calculate which API page we need for this display page
        # API returns ~100 results per call, we display 10 per page
        # Display pages 1-10 come from API page 1 (results 0-99)
        # Display pages 11-20 come from API page 2 (results 100-199)
        # etc.
        api_page = ((page - 1) // 10) + 1
        
        # Build params for this API page - mirror SEC website behavior exactly
        params = base_params.copy()
        
        # SEC website pagination pattern:
        # API Page 1: no page/from params
        # API Page 2: page=2&from=100
        # API Page 3: page=3&from=200 (increments of 100)
        if api_page > 1:
            params['page'] = api_page
            params['from'] = (api_page - 1) * 100  # SEC uses increments of 100
        
        logger.info(f"Fetching display page {page} (API page {api_page}, params: page={params.get('page', 'N/A')}, from={params.get('from', 'N/A')})...")
        logger.info(f"Base parameters: {base_params}")
        
        # Retry logic for handling timeouts and transient errors (500, 502, 503, 504)
        # HTTP timeout must be less than Lambda timeout (30s) to get proper error handling
        # Using 25 seconds to leave buffer for processing time
        HTTP_TIMEOUT = 25
        max_retries = 3
        retry_count = 0
        response = None
        
        while retry_count < max_retries:
            try:
                time.sleep(0.1)  # Rate limiting
                response = session.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
                response.raise_for_status()
                break  # Success, exit retry loop
            except requests.exceptions.HTTPError as e:
                # Check if it's a server error (500, 502, 503, 504) - potentially transient
                status_code = e.response.status_code if hasattr(e, 'response') and e.response else None
                is_transient_error = status_code in [500, 502, 503, 504]
                
                retry_count += 1
                if retry_count >= max_retries:
                    if is_transient_error:
                        logger.error(f"⚠️  Transient server error ({status_code}) on API page {api_page} after {max_retries} retries: {e}")
                        logger.error(f"   This may be a temporary SEC API issue. Consider retrying the search later.")
                    else:
                        logger.error(f"Failed to fetch API page {api_page} after {max_retries} retries: {e}")
                    raise
                
                # Exponential backoff for transient errors, linear for others
                if is_transient_error:
                    backoff_delay = min(2 ** retry_count, 10)  # Exponential: 2s, 4s, 8s (capped at 10s)
                    logger.warning(f"⚠️  Transient server error ({status_code}) on API page {api_page}, retry {retry_count}/{max_retries} after {backoff_delay}s: {e}")
                else:
                    backoff_delay = retry_count  # Linear: 1s, 2s, 3s
                    logger.warning(f"Timeout/error on API page {api_page}, retry {retry_count}/{max_retries} after {backoff_delay}s: {e}")
                
                time.sleep(backoff_delay)
            except (requests.exceptions.Timeout, requests.exceptions.RequestException) as e:
                retry_count += 1
                if retry_count >= max_retries:
                    logger.error(f"Failed to fetch API page {api_page} after {max_retries} retries: {e}")
                    raise
                backoff_delay = min(2 ** retry_count, 10)  # Exponential backoff for timeouts
                logger.warning(f"Timeout/error on API page {api_page}, retry {retry_count}/{max_retries} after {backoff_delay}s: {e}")
                time.sleep(backoff_delay)
        
        data = response.json()
        
        # Parse Elasticsearch response structure
        if not isinstance(data, dict) or 'hits' not in data:
            return {
                'success': False,
                'error': 'Unexpected response format from search-index API'
            }
        
        hits_data = data.get('hits', {})
        total_hits = hits_data.get('total', {})
        total_count = total_hits.get('value', 0) if isinstance(total_hits, dict) else total_hits
        
        # Extract aggregations from API response
        aggregations = data.get('aggregations', {})
        
        # Extract form filter aggregation (available form types in results)
        form_filters = []
        form_filter_agg = aggregations.get('form_filter', {})
        if form_filter_agg and 'buckets' in form_filter_agg:
            form_filters = [
                {
                    'form': bucket.get('key', ''),
                    'count': bucket.get('doc_count', 0)
                }
                for bucket in form_filter_agg.get('buckets', [])
            ]
            logger.info(f"Found {len(form_filters)} form types in results: {[f['form'] for f in form_filters]}")
        
        # Extract entity filter aggregation
        entity_filters = []
        entity_filter_agg = aggregations.get('entity_filter', {})
        if entity_filter_agg and 'buckets' in entity_filter_agg:
            entity_filters = [
                {
                    'entity': bucket.get('key', ''),
                    'count': bucket.get('doc_count', 0)
                }
                for bucket in entity_filter_agg.get('buckets', [])
            ]
            logger.info(f"Found {len(entity_filters)} entities in results")
        
        # Extract location filter aggregation (biz_states)
        location_filters = []
        location_filter_agg = aggregations.get('biz_states_filter', aggregations.get('location_filter', {}))
        if location_filter_agg and 'buckets' in location_filter_agg:
            location_filters = [
                {
                    'location': bucket.get('key', ''),
                    'count': bucket.get('doc_count', 0)
                }
                for bucket in location_filter_agg.get('buckets', [])
            ]
            logger.info(f"Found {len(location_filters)} locations in results")
        
        # Extract incorporation state filter aggregation
        incorporation_filters = []
        incorporation_filter_agg = aggregations.get('inc_states_filter', aggregations.get('incorporation_filter', {}))
        if incorporation_filter_agg and 'buckets' in incorporation_filter_agg:
            incorporation_filters = [
                {
                    'state': bucket.get('key', ''),
                    'count': bucket.get('doc_count', 0)
                }
                for bucket in incorporation_filter_agg.get('buckets', [])
            ]
            logger.info(f"Found {len(incorporation_filters)} incorporation states in results")
        
        hits_list = hits_data.get('hits', [])
        
        # Always compute filters from current batch results
        # API aggregations may not be available for entity/location/incorporation, so we compute from results
        logger.info(f"Computing filters from current batch results ({len(hits_list)} hits)")
        entity_counts = {}
        location_counts = {}
        incorporation_counts = {}
        
        # Compute from ALL hits in the current batch (not just the 10 we're displaying)
        for hit in hits_list:
            source = hit.get('_source', {})
            
            # Count entities (display_names)
            display_names = source.get('display_names', [])
            if display_names:
                for name in display_names:
                    if name and isinstance(name, str) and name.strip() and name.strip() != 'N/A':
                        entity_counts[name] = entity_counts.get(name, 0) + 1
            
            # Count locations (biz_locations or biz_states)
            biz_locations = source.get('biz_locations', [])
            biz_states = source.get('biz_states', [])
            all_locations = []
            if biz_locations:
                all_locations.extend(biz_locations)
            if biz_states:
                all_locations.extend(biz_states)
            
            for loc in all_locations:
                if loc and isinstance(loc, str) and loc.strip() and loc.strip() != 'N/A' and loc.strip() != '':
                    location_counts[loc] = location_counts.get(loc, 0) + 1
            
            # Count incorporation states (inc_states)
            inc_states = source.get('inc_states', [])
            if inc_states:
                for state in inc_states:
                    if state and isinstance(state, str) and state.strip() and state.strip() != 'N/A' and state.strip() != '':
                        incorporation_counts[state] = incorporation_counts.get(state, 0) + 1
        
        # Merge API aggregations with computed filters (API takes precedence if available)
        # But always include computed filters as fallback
        computed_entity_filters = [
            {'entity': entity, 'count': count}
            for entity, count in sorted(entity_counts.items(), key=lambda x: x[1], reverse=True)
        ]
        computed_location_filters = [
            {'location': loc, 'count': count}
            for loc, count in sorted(location_counts.items(), key=lambda x: x[1], reverse=True)
        ]
        computed_incorporation_filters = [
            {'state': state, 'count': count}
            for state, count in sorted(incorporation_counts.items(), key=lambda x: x[1], reverse=True)
        ]
        
        # Use API aggregations if available, otherwise use computed
        if not entity_filters:
            entity_filters = computed_entity_filters
        if not location_filters:
            location_filters = computed_location_filters
        if not incorporation_filters:
            incorporation_filters = computed_incorporation_filters
        
        logger.info(f"Computed filters: {len(entity_filters)} entities, {len(location_filters)} locations, {len(incorporation_filters)} incorporation states")
        if entity_filters:
            logger.info(f"Sample entities: {entity_filters[:3]}")
        if location_filters:
            logger.info(f"Sample locations: {location_filters[:3]}")
        if incorporation_filters:
            logger.info(f"Sample incorporation states: {incorporation_filters[:3]}")
        
        if not hits_list:
            logger.info(f"No results returned from API page {api_page}")
            return {
                'success': True,
                'total_found': total_count,
                'results': [],
                'form_filters': form_filters,  # Still return form filters even if no results
                'entity_filters': entity_filters,
                'location_filters': location_filters,
                'incorporation_filters': incorporation_filters
            }
        
        logger.info(f"Got {len(hits_list)} results from API page {api_page} (total found: {total_count})")
        
        # Calculate which slice we need from this API batch
        # Display page 1: want results 0-9 from API batch (results 0-99)
        # Display page 2: want results 10-19 from API batch (results 0-99)
        # Display page 11: want results 100-109 from API batch (results 100-199)
        offset_in_batch = ((page - 1) % 10) * MAX_RESULTS
        start_idx = offset_in_batch
        end_idx = start_idx + MAX_RESULTS
        
        # Slice to get exactly 10 results for this display page
        limited_hits = hits_list[start_idx:end_idx]
        
        logger.info(f"✂️  Sliced to {len(limited_hits)} results for display page {page} (from index {start_idx} to {end_idx})")
        
        # Extract results with all column data and construct filing IDs
        filing_ids = []
        filing_data_list = []
        
        logger.info(f"🔄 Processing {len(limited_hits)} filing record(s) from API results...")
        for idx, hit in enumerate(limited_hits, 1):
            source = hit.get('_source', {})
            _id = hit.get('_id', '')
            
            # Extract all column data
            form = source.get('form', source.get('file_type', 'N/A'))
            file_date = source.get('file_date', 'N/A')
            
            display_names = source.get('display_names', [])
            reporting_for = display_names[0] if display_names else 'N/A'
            filing_entity = display_names[0] if display_names else 'N/A'
            
            ciks = source.get('ciks', [])
            cik = ciks[0] if ciks else 'N/A'
            
            biz_locations = source.get('biz_locations', [])
            located = next((loc for loc in biz_locations if loc), 'N/A')
            
            inc_states = source.get('inc_states', [])
            incorporated = next((state for state in inc_states if state), 'N/A')
            
            file_nums = source.get('file_num', [])
            file_number = file_nums[0] if file_nums else 'N/A'
            
            film_nums = source.get('film_num', [])
            film_number = film_nums[0] if film_nums else 'N/A'
            
            # Extract accession number from _id
            accession = _id.split(':')[0] if ':' in _id else ''
            
            # Construct filing ID for caching - must match DynamoDB primary key format
            # Ensure all values are strings and not None
            form_str = str(form) if form is not None else 'N/A'
            cik_str = str(cik) if cik is not None and cik != 'N/A' else 'N/A'
            file_number_str = str(file_number) if file_number is not None and file_number != 'N/A' else 'N/A'
            film_number_str = str(film_number) if film_number is not None and film_number != 'N/A' else 'N/A'
            
            filing_id = construct_filing_id(form_str, cik_str, file_number_str, film_number_str)
            
            # Validate filing_id format - must have at least 3 dashes (4 components minimum)
            # Note: file_number may contain dashes (e.g., "001-34756"), so total dashes may be > 3
            # Format: {form}-{CIK}-{fileNumber}-{filmNumber}
            # We split by '-' and check we have at least 4 parts (form, CIK, fileNumber, filmNumber)
            parts = filing_id.split('-')
            if len(parts) < 4:
                logger.error(f"❌ [{idx}/{len(limited_hits)}] CRITICAL: Invalid filing_id format for DynamoDB/S3: '{filing_id}'. Expected format: {{form}}-{{CIK}}-{{fileNumber}}-{{filmNumber}}. "
                           f"Components: form='{form_str}', cik='{cik_str}', file_number='{file_number_str}', film_number='{film_number_str}'. "
                           f"Split into {len(parts)} parts: {parts}. Skipping this filing.")
                continue  # Skip this filing - don't add to list
            
            # Additional validation - ensure form and CIK are not N/A
            if filing_id.startswith('N/A-') or parts[1] == 'N/A':
                logger.error(f"❌ [{idx}/{len(limited_hits)}] CRITICAL: Invalid filing_id - form or CIK is N/A: '{filing_id}'. Skipping this filing.")
                continue  # Skip this filing
            
            filing_ids.append(filing_id)
            logger.info(f"✅ [{idx}/{len(limited_hits)}] Extracted filing record: {filing_id} (form={form_str}, cik={cik_str}, date={file_date})")
            
            filing_data_list.append({
                'filingId': filing_id,
                'form': form,
                'filingDate': file_date,
                'reportingFor': reporting_for,
                'filingEntity': filing_entity,
                'cik': cik,
                'located': located,
                'incorporated': incorporated,
                'fileNumber': file_number,
                'filmNumber': film_number,
                'accession': accession,
                'adsh': source.get('adsh', ''),
                'periodEnding': source.get('period_ending', '')
            })
        
        # Check cache for existing filings
        logger.info(f"🔍 Checking cache for {len(filing_ids)} filing(s)")
        cached_filings = get_cached_filings(filing_ids)
        logger.info(f"✅ Cache check complete: Found {len(cached_filings)}/{len(filing_ids)} filing(s) in cache")
        
        # Process results: use cache if available, otherwise scrape
        results = []
        filings_to_store_in_dynamodb = []  # New filings to store in DynamoDB
        filings_to_download = []  # All filings (cached and new) that need S3 downloads
        
        logger.info(f"📋 Processing {len(filing_data_list)} filing record(s) in new record loop")
        for idx, filing_data in enumerate(filing_data_list, 1):
            filing_id = filing_data.get('filingId', '')
            logger.info(f"📄 [{idx}/{len(filing_data_list)}] Processing filing record: {filing_id}")
            
            # Validate filing_id before proceeding
            # file_number may contain dashes, so we check by splitting instead of counting dashes
            if not filing_id:
                logger.error(f"❌ [{idx}/{len(filing_data_list)}] Invalid filing_id in filing_data: missing filing_id. Skipping this filing.")
                continue
            
            # Split by '-' and ensure we have at least 4 parts (form, CIK, fileNumber, filmNumber)
            parts = filing_id.split('-')
            if len(parts) < 4:
                logger.error(f"❌ [{idx}/{len(filing_data_list)}] Invalid filing_id in filing_data: '{filing_id}'. Expected at least 4 parts when split by '-', got {len(parts)}. Skipping this filing.")
                continue
            
            # Check if filing is in cache
            logger.info(f"🔎 [{idx}/{len(filing_data_list)}] Checking cache for filing: {filing_id}")
            if filing_id in cached_filings:
                logger.info(f"✅ [{idx}/{len(filing_data_list)}] Filing found in cache: {filing_id}")
                cached_item = cached_filings[filing_id]
                logger.info(f"✅ [{idx}/{len(filing_data_list)}] Using cached data for filing {filing_id}")
                
                # Handle documentUrls - convert set to list if needed
                document_urls = cached_item.get('documentUrls', [])
                if isinstance(document_urls, set):
                    document_urls = list(document_urls)
                elif not isinstance(document_urls, list):
                    document_urls = []
                
                # Handle dataFileUrls - convert set to list if needed
                data_file_urls = cached_item.get('dataFileUrls', [])
                if isinstance(data_file_urls, set):
                    data_file_urls = list(data_file_urls)
                elif not isinstance(data_file_urls, list):
                    data_file_urls = []
                
                # Handle S3 keys from cache - convert from DynamoDB Map format if needed
                document_s3_keys = cached_item.get('documentS3Keys', {})
                if not isinstance(document_s3_keys, dict):
                    document_s3_keys = {}
                
                data_file_s3_keys = cached_item.get('dataFileS3Keys', {})
                if not isinstance(data_file_s3_keys, dict):
                    data_file_s3_keys = {}
                
                xbrl_s3_key = cached_item.get('xbrlS3Key')
                
                # Return cached data
                filing_page_url = cached_item.get('filingPageUrl', '')
                result = {
                    'form': cached_item.get('form', filing_data['form']),
                    'filingDate': cached_item.get('filingDate', filing_data['filingDate']),
                    'reportingFor': cached_item.get('reportingFor', filing_data['reportingFor']),
                    'filingEntity': cached_item.get('filingEntity', filing_data['filingEntity']),
                    'cik': cached_item.get('cik', filing_data['cik']),
                    'located': cached_item.get('located', filing_data['located']),
                    'incorporated': cached_item.get('incorporated', filing_data['incorporated']),
                    'fileNumber': cached_item.get('fileNumber', filing_data['fileNumber']),
                    'filmNumber': cached_item.get('filmNumber', filing_data['filmNumber']),
                    'accession': cached_item.get('accession', filing_data['accession']),
                    'filingPageUrl': filing_page_url,
                    'documentUrls': document_urls,
                    'dataFileUrls': data_file_urls,
                    'documentS3Keys': document_s3_keys,
                    'dataFileS3Keys': data_file_s3_keys,
                    'xbrlS3Key': xbrl_s3_key,
                    'adsh': cached_item.get('adsh', filing_data['adsh']),
                    'filingId': filing_id,
                }
                results.append(result)
                logger.info(f"✅ [{idx}/{len(filing_data_list)}] RECORD ADDED: Cached filing {filing_id} added to results. Total results now: {len(results)}")
                
                # Skip S3 download for cached filings - they should already be in S3
                # Since indexing and downloading are tied together, if it's in DynamoDB, files should already be in S3
                logger.info(f"⏭️  [{idx}/{len(filing_data_list)}] Skipping S3 download for cached filing {filing_id} - files should already be in S3")
            else:
                # Cache miss - need to scrape
                logger.info(f"❌ [{idx}/{len(filing_data_list)}] Filing not found in cache: {filing_id}, scraping and downloading...")
                
                # Build filing page URL from accession
                filing_page_url = None
                if filing_data['accession'] and filing_data['cik'] != 'N/A':
                    cik_padded = str(filing_data['cik']).zfill(10)
                    accession_clean = filing_data['accession'].replace('-', '')
                    if len(accession_clean) >= 12:
                        accession_dashed = f"{accession_clean[:10]}-{accession_clean[10:12]}-{accession_clean[12:]}"
                        # Match the test script: directory path without dashes, filenames (viewer/index) with dashes
                        base_dir = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}"
                        filing_page_url = f"{base_dir}/{accession_dashed}-index.htm"
                
                # Scrape document URLs from filing page (Document Format Files table)
                document_urls = []
                primary_document_url = ''
                # Scrape data file URLs from filing page (Data Files table)
                data_file_urls = []
                if filing_page_url:
                    logger.info(f"📥 [{idx}/{len(filing_data_list)}] Scraping filing page for documents and data files: {filing_page_url}")
                    document_urls = scrape_filing_page_for_documents(filing_page_url)
                    if document_urls:
                        primary_document_url = document_urls[0]
                        logger.info(f"📄 [{idx}/{len(filing_data_list)}] Found {len(document_urls)} document URL(s) for filing {filing_id}")
                    else:
                        logger.warning(f"⚠️  [{idx}/{len(filing_data_list)}] No document URLs found for filing {filing_id}")
                    # Also scrape data files from Data Files table
                    data_file_urls = scrape_filing_page_for_data_files(filing_page_url)
                    if data_file_urls:
                        logger.info(f"📊 [{idx}/{len(filing_data_list)}] Found {len(data_file_urls)} data file URL(s) for filing {filing_id}")
                    else:
                        logger.info(f"ℹ️  [{idx}/{len(filing_data_list)}] No data file URLs found for filing {filing_id}")
                else:
                    logger.warning(f"⚠️  [{idx}/{len(filing_data_list)}] No filing page URL available for filing {filing_id}, skipping document/data file scraping")
                
                # Prepare result
                result = {
                    'form': filing_data['form'],
                    'filingDate': filing_data['filingDate'],
                    'reportingFor': filing_data['reportingFor'],
                    'filingEntity': filing_data['filingEntity'],
                    'cik': filing_data['cik'],
                    'located': filing_data['located'],
                    'incorporated': filing_data['incorporated'],
                    'fileNumber': filing_data['fileNumber'],
                    'filmNumber': filing_data['filmNumber'],
                    'accession': filing_data['accession'],
                    'filingPageUrl': filing_page_url,
                    'documentUrls': document_urls,
                    'dataFileUrls': data_file_urls,
                    'adsh': filing_data['adsh'],
                    'filingId': filing_id,  # Store filing_id for download step
                }
                results.append(result)
                logger.info(f"✅ [{idx}/{len(filing_data_list)}] RECORD ADDED: New filing {filing_id} added to results. Total results now: {len(results)}")
                
                # Prepare data for DynamoDB storage and download
                filing_data['filingPageUrl'] = filing_page_url
                filing_data['documentUrls'] = document_urls
                filing_data['dataFileUrls'] = data_file_urls
                filing_data['primaryDocumentUrl'] = primary_document_url
                # Initialize empty S3 keys - will be updated after download
                filing_data['documentS3Keys'] = {}
                filing_data['dataFileS3Keys'] = {}
                filings_to_store_in_dynamodb.append(filing_data)
                logger.info(f"📝 [{idx}/{len(filing_data_list)}] Added filing {filing_id} to DynamoDB storage queue")
                
                # Add to download list
                filings_to_download.append({
                    'filingId': filing_id,
                    'filingPageUrl': filing_page_url,
                    'documentUrls': document_urls,
                    'dataFileUrls': data_file_urls,
                })
                logger.info(f"⬇️  [{idx}/{len(filing_data_list)}] Added filing {filing_id} to S3 download queue ({len(document_urls)} documents, {len(data_file_urls)} data files)")
        
        # Step 1: Store new filings in DynamoDB cache
        if filings_to_store_in_dynamodb:
            logger.info(f"💾 Storing {len(filings_to_store_in_dynamodb)} new filing(s) in DynamoDB cache")
            for idx, filing_data in enumerate(filings_to_store_in_dynamodb, 1):
                filing_id = filing_data.get('filingId', 'UNKNOWN')
                try:
                    logger.info(f"💾 [{idx}/{len(filings_to_store_in_dynamodb)}] Storing filing in DynamoDB: {filing_id}")
                    store_filing_in_cache(filing_data)
                    logger.info(f"✅ [{idx}/{len(filings_to_store_in_dynamodb)}] Successfully stored filing {filing_id} in DynamoDB cache")
                except Exception as e:
                    logger.error(f"❌ [{idx}/{len(filings_to_store_in_dynamodb)}] Failed to cache filing {filing_id}: {e}")
                    # Continue - don't fail the request if caching fails
        
        # Step 2: Download documents to S3 for NEW filings only (not cached ones)
        # Cached filings should already have their files in S3 since indexing and downloading are tied together
        # This happens after DynamoDB storage to ensure the index exists
        if filings_to_download:
            logger.info(f"⬇️  Downloading documents to S3 for {len(filings_to_download)} NEW filing(s) (cached filings skipped)")
            for idx, filing_download_info in enumerate(filings_to_download, 1):
                try:
                    filing_id = filing_download_info.get('filingId')
                    document_urls = filing_download_info.get('documentUrls', [])
                    data_file_urls = filing_download_info.get('dataFileUrls', [])
                    filing_page_url = filing_download_info.get('filingPageUrl', '')
                    
                    logger.info(f"⬇️  [{idx}/{len(filings_to_download)}] Processing S3 download for filing: {filing_id}")
                    
                    if not filing_id:
                        logger.warning(f"⚠️  [{idx}/{len(filings_to_download)}] Skipping S3 download: missing filing_id")
                        continue
                    
                    if not document_urls and not data_file_urls:
                        logger.info(f"⏭️  [{idx}/{len(filings_to_download)}] Skipping S3 download for filing_id {filing_id}: no document or data file URLs to download")
                        continue
                    
                    # Validate filing_id format one more time before downloading
                    # file_number may contain dashes, so we split and check parts
                    parts = filing_id.split('-')
                    if len(parts) < 4:
                        logger.error(f"❌ [{idx}/{len(filings_to_download)}] Invalid filing_id format '{filing_id}' - skipping S3 download. Expected format: {{form}}-{{CIK}}-{{fileNumber}}-{{filmNumber}}. "
                                   f"Split into {len(parts)} parts: {parts}")
                        continue
                    
                    logger.info(f"⬇️  [{idx}/{len(filings_to_download)}] Downloading {len(document_urls)} document(s) and {len(data_file_urls)} data file(s) to S3 for filing_id: {filing_id}")
                    download_result = download_filing_documents_to_s3(
                        filing_id=filing_id,
                        document_urls=document_urls,
                        data_file_urls=data_file_urls if data_file_urls else None,
                        filing_page_url=filing_page_url if filing_page_url else None
                    )
                    
                    if download_result:
                        logger.info(f"✅ [{idx}/{len(filings_to_download)}] Successfully downloaded filing {filing_id} to S3")
                    else:
                        logger.warning(f"⚠️  [{idx}/{len(filings_to_download)}] Download result is None or empty for filing {filing_id}")
                    
                    # Update the filing_data with S3 keys for cache update
                    document_s3_keys = download_result.get('documentS3Keys', {}) if download_result else {}
                    data_file_s3_keys = download_result.get('dataFileS3Keys', {}) if download_result else {}
                    xbrl_s3_key = download_result.get('xbrlS3Key') if download_result else None
                    
                    logger.info(f"📦 [{idx}/{len(filings_to_download)}] Download result for {filing_id}: {len(document_s3_keys)} document S3 key(s), {len(data_file_s3_keys)} data file S3 key(s)" + 
                              (f", XBRL key: {xbrl_s3_key}" if xbrl_s3_key else ", no XBRL key"))
                    
                    # Update results with S3 keys if this filing is in the current page results
                    for result in results:
                        if result.get('filingId') == filing_id:
                            result['documentS3Keys'] = document_s3_keys
                            result['dataFileS3Keys'] = data_file_s3_keys
                            if xbrl_s3_key:
                                result['xbrlS3Key'] = xbrl_s3_key
                            break
                    
                    # Update DynamoDB cache with S3 keys
                    try:
                        if cache_table:
                            # Always update, even if keys are empty (to ensure fields exist in DynamoDB)
                            logger.info(f"Updating cache with S3 keys for filing {filing_id}: {len(document_s3_keys)} document keys, {len(data_file_s3_keys)} data file keys" + 
                                       (f", XBRL key: {xbrl_s3_key}" if xbrl_s3_key else ""))
                            logger.debug(f"Document S3 keys: {document_s3_keys}")
                            logger.debug(f"Data file S3 keys: {data_file_s3_keys}")
                            
                            # Build update expression - include XBRL key if available
                            if xbrl_s3_key:
                                update_expression = 'SET documentS3Keys = :doc_keys, dataFileS3Keys = :data_keys, xbrlS3Key = :xbrl_key'
                                expression_values = {
                                    ':doc_keys': document_s3_keys if document_s3_keys else {},
                                    ':data_keys': data_file_s3_keys if data_file_s3_keys else {},
                                    ':xbrl_key': xbrl_s3_key
                                }
                            else:
                                update_expression = 'SET documentS3Keys = :doc_keys, dataFileS3Keys = :data_keys'
                                expression_values = {
                                    ':doc_keys': document_s3_keys if document_s3_keys else {},
                                    ':data_keys': data_file_s3_keys if data_file_s3_keys else {}
                                }
                            
                            # Update the item with S3 keys (no need to check if item exists - update_item will work)
                            response = cache_table.update_item(
                                Key={'filingId': filing_id},
                                UpdateExpression=update_expression,
                                ExpressionAttributeValues=expression_values,
                                ReturnValues='ALL_NEW'  # Return updated item to verify
                            )
                            
                            # Verify the update
                            updated_item = response.get('Attributes', {})
                            updated_doc_keys = updated_item.get('documentS3Keys', {})
                            updated_data_keys = updated_item.get('dataFileS3Keys', {})
                            logger.info(f"✅ Successfully updated cache with S3 keys for filing {filing_id}")
                            logger.info(f"   Verified: {len(updated_doc_keys)} document keys, {len(updated_data_keys)} data file keys in cache")
                        else:
                            logger.warning(f"Cache table not available - cannot update S3 keys for filing {filing_id}")
                    except Exception as e:
                        logger.error(f"❌ Failed to update cache with S3 keys for filing {filing_id}: {e}")
                        import traceback
                        logger.error(f"❌ Traceback: {traceback.format_exc()}")
                        # Continue - don't fail the request if cache update fails
                        
                except Exception as e:
                    filing_id_error = filing_download_info.get('filingId', 'UNKNOWN')
                    logger.error(f"❌ [{idx}/{len(filings_to_download)}] Failed to download documents for filing {filing_id_error}: {e}", exc_info=True)
                    # Continue - don't fail the request if downloading fails
        else:
            logger.info(f"ℹ️  No new filings to download to S3 (all filings were cached)")
        
        # Summary log
        logger.info(f"📊 Processing summary: {len(results)} result(s) total, {len(cached_filings)} from cache, {len(filings_to_store_in_dynamodb)} new filing(s) stored, {len(filings_to_download)} new filing(s) downloaded")
        logger.info(f"✅ Returning {len(results)} filing result(s) from search_by_search_index_api")
        
        return {
            'success': True,
            'total_found': total_count,
            'results': results,
            'form_filters': form_filters,  # Available form types in current search results
            'entity_filters': entity_filters,  # Available entities in current search results
            'location_filters': location_filters,  # Available locations in current search results
            'incorporation_filters': incorporation_filters  # Available incorporation states in current search results
        }
        
    except Exception as e:
        logger.error(f"Error in search_by_search_index_api: {e}")
        return {
            'success': False,
            'error': str(e)
        }


def handle_autocomplete(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle autocomplete requests"""
    try:
        query_params = event.get('queryStringParameters') or {}
        search_term = query_params.get('query', '')
        
        if not search_term or len(search_term) < 2:
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'suggestions': []
                })
            }
        
        suggestions = get_company_search_preview(search_term)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin),
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,OPTIONS'
            },
            'body': json.dumps({
                'suggestions': suggestions
            })
        }
    except Exception as e:
        logger.error(f"Error in handle_autocomplete: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'error': str(e)
            })
        }


def handle_search(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle full search requests - supports both sync and async modes"""
    logger.info(f"🔍🔍🔍 HANDLE_SEARCH CALLED 🔍🔍🔍")
    logger.info(f"📥 Event body type: {type(event.get('body'))}")
    logger.info(f"📥 Event body (first 500 chars): {str(event.get('body', ''))[:500]}")
    try:
        # Parse request body or query params
        if event.get('body'):
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            body = event.get('queryStringParameters') or {}
        
        # Extract search parameters
        search_params = {
            'cik': body.get('cik'),
            'entityName': body.get('entityName'),
            'keywords': body.get('keywords'),
            'formTypes': body.get('formTypes', []),
            'dateFrom': body.get('dateFrom'),
            'dateTo': body.get('dateTo'),
            'reportingFor': body.get('reportingFor'),
            'located': body.get('located'),
            'incorporated': body.get('incorporated'),
            'fileNumber': body.get('fileNumber'),
            'filmNumber': body.get('filmNumber'),
            'columns': body.get('columns', [])
        }
        
        # Remove None values
        search_params = {k: v for k, v in search_params.items() if v is not None}
        
        # Check query cache first
        query_hash = generate_query_hash(search_params)
        cached_query = get_cached_query_with_validation(query_hash)
        
        if cached_query:
            # Cache hit - verify job still exists in DynamoDB
            job_id = cached_query['job_id']
            job_status = get_job_status(job_id)
            
            # Get S3 key from cache, job status, or construct from job_id
            results_s3_key = (
                cached_query.get('results_s3_key') or 
                (job_status.get('results_s3_key') if job_status else None) or
                f"jobs/{job_id}/results.json"  # Construct from job_id as fallback
            )
            
            if job_status:
                # Job exists - return job_id as before
                logger.info(f"Query cache hit for hash {query_hash}, job {job_id} exists, returning job_id")
                return {
                    'statusCode': 202,  # Accepted
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin),
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'POST,GET,OPTIONS'
                    },
                    'body': json.dumps({
                        'success': True,
                        'job_id': job_id,
                            'status': job_status.get('status', 'COMPLETED'),
                            'message': 'Search results retrieved from cache',
                            'cached': True
                    })
                }
            elif results_s3_key:
                # Job doesn't exist but S3 key available - verify it exists and return it
                from query_cache import check_s3_key_exists
                if check_s3_key_exists(results_s3_key):
                    logger.info(f"Query cache hit for hash {query_hash}, job {job_id} expired but S3 key exists, returning S3 key")
                    return {
                        'statusCode': 200,  # OK - results available
                        'headers': {
                            'Content-Type': 'application/json',
                            **get_cors_headers(origin),
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'POST,GET,OPTIONS'
                        },
                        'body': json.dumps({
                            'success': True,
                            'job_id': job_id,
                            'status': 'COMPLETED',
                            'results_s3_key': results_s3_key,
                            'total_found': cached_query.get('total_found', 0),
                            'message': 'Search results retrieved from cache (S3)',
                            'cached': True
                        })
                    }
                else:
                    logger.warning(f"Query cache hit for hash {query_hash}, but S3 key {results_s3_key} doesn't exist, treating as cache miss")
                    # Fall through to create new job
            else:
                # Cache entry exists but job and S3 key are missing - treat as cache miss
                logger.warning(f"Query cache hit for hash {query_hash}, but job {job_id} and S3 key missing, treating as cache miss")
                # Fall through to create new job
        
        # Cache miss - create new job
        logger.info(f"🔴🔴🔴 CACHE MISS - CREATING NEW JOB 🔴🔴🔴")
        logger.info(f"Query cache miss for hash {query_hash}, creating new job")
        logger.info(f"📋 Search params for new job: {json.dumps(search_params, default=str)}")
        job_id = create_job(search_params)
        logger.info(f"✅✅✅ Created new job: {job_id} ✅✅✅")
        
        # Store request_id with job if available (from SQS wrapper)
        # Store request_id separately (not in job_progress) so it doesn't get overwritten by progress updates
        if current_request_id:
            logger.info(f"📝 Storing request_id {current_request_id} with job {job_id}")
            # Store request_id as a separate field in the cache entry
            # We'll need to update the cache entry after creation to add request_id
            job_progress = None  # Will be initialized by store_cached_query
        else:
            job_progress = None
        
        # Store in query cache with initial job status
        logger.info(f"💾 Storing job in query cache...")
        store_cached_query(query_hash, job_id, search_params, job_status='PENDING', job_progress=job_progress)
        logger.info(f"💾✅ Stored job in query cache")
        
        # Store request_id separately if available (after initial creation to avoid overwriting)
        if current_request_id and query_cache_table:
            try:
                query_cache_table.update_item(
                    Key={'queryHash': query_hash},
                    UpdateExpression='SET request_id = :request_id',
                    ExpressionAttributeValues={':request_id': current_request_id}
                )
                logger.info(f"💾✅ Stored request_id {current_request_id} separately for job {job_id}")
            except Exception as e:
                logger.error(f"❌ Error storing request_id: {e}", exc_info=True)
        
        logger.info(f"🚀🚀🚀 ABOUT TO INVOKE ASYNC SEARCH 🚀🚀🚀")
        logger.info(f"🚀 Invoking async search for job {job_id} with params: {json.dumps(search_params, default=str)}")
        logger.info(f"🚀 Calling invoke_async_search function...")
        invoke_async_search(job_id, search_params)
        logger.info(f"✅✅✅ Async search invocation sent for job {job_id} ✅✅✅")
        
        return {
            'statusCode': 202,  # Accepted
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin),
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST,GET,OPTIONS'
            },
            'body': json.dumps({
                'success': True,
                'job_id': job_id,
                'status': 'PENDING',
                'message': 'Search started asynchronously'
            })
        }
    except Exception as e:
        logger.error(f"Error in handle_search: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }


def handle_job_status(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle job status requests"""
    try:
        query_params = event.get('queryStringParameters') or {}
        job_id = query_params.get('job_id')
        
        logger.info(f"📊 Status check request received for job_id: {job_id}")
        
        if not job_id:
            logger.warning(f"⚠️  Status check request missing job_id parameter")
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'job_id parameter required'
                })
            }
        
        logger.info(f"🔍 Fetching job status for: {job_id}")
        job_status = get_job_status(job_id)
        
        if not job_status:
            logger.warning(f"⚠️  Job not found: {job_id}")
        else:
            status = job_status.get('status', 'UNKNOWN')
            logger.info(f"✅ Job status retrieved for {job_id}: {status}")
            if status == 'FAILED':
                error_msg = job_status.get('error', 'Unknown error')
                logger.info(f"   Error details: {error_msg}")
            elif status == 'COMPLETED':
                results_count = job_status.get('results_count', 0)
                logger.info(f"   Results count: {results_count}")
            elif status == 'IN_PROGRESS':
                progress = job_status.get('progress', {})
                current_page = progress.get('current_page', 0)
                total_pages = progress.get('total_pages', 'Unknown')
                results_loaded = progress.get('results_loaded', 0)
                logger.info(f"   Progress: page {current_page}/{total_pages}, {results_loaded} results loaded")
        
        if not job_status:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Job not found'
                })
            }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps(job_status)
        }
    except Exception as e:
        logger.error(f"Error in handle_job_status: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'error': str(e)
            })
        }


def handle_fetch_results(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle requests to fetch results from S3"""
    try:
        query_params = event.get('queryStringParameters') or {}
        job_id = query_params.get('job_id')
        s3_key = query_params.get('s3_key')
        
        if not job_id and not s3_key:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'job_id or s3_key parameter required'
                })
            }
        
        # If job_id provided, get S3 key from job status
        if job_id and not s3_key:
            job_status = get_job_status(job_id)
            if not job_status:
                return {
                    'statusCode': 404,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin)
                    },
                    'body': json.dumps({
                        'error': 'Job not found'
                    })
                }
            s3_key = job_status.get('results_s3_key')
            if not s3_key:
                return {
                    'statusCode': 404,
                    'headers': {
                        'Content-Type': 'application/json',
                        **get_cors_headers(origin)
                    },
                    'body': json.dumps({
                        'error': 'Results not found in S3'
                    })
                }
        
        # Fetch from S3
        if not s3_client:
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'S3 client not configured'
                })
            }
        
        try:
            logger.info(f"Fetching results from S3: bucket={S3_BUCKET_NAME}, key={s3_key}")
            response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
            results_json = response['Body'].read().decode('utf-8')
            results = json.loads(results_json)
            
            logger.info(f"Successfully fetched results from S3: {len(results.get('results', []))} results")
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps(results)
            }
        except s3_client.exceptions.NoSuchKey as e:
            logger.error(f"S3 key not found: {s3_key} - {e}")
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Results file not found in S3'
                })
            }
        except s3_client.exceptions.ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            logger.error(f"S3 ClientError fetching {s3_key}: {error_code} - {error_message}")
            return {
                'statusCode': 403 if error_code == 'AccessDenied' else 500,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': f'S3 error ({error_code}): {error_message}'
                })
            }
        except Exception as e:
            logger.error(f"Error fetching results from S3: {e}", exc_info=True)
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': str(e)
                })
            }
    except Exception as e:
        logger.error(f"Error in handle_fetch_results: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'error': str(e)
            })
        }


def handle_job_cancel(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle job cancellation requests"""
    try:
        # Support both GET (query params) and POST (body) methods
        if event.get('httpMethod') == 'POST':
            if event.get('body'):
                if isinstance(event['body'], str):
                    body = json.loads(event['body'])
                else:
                    body = event['body']
            else:
                body = {}
            job_id = body.get('job_id')
        else:
            query_params = event.get('queryStringParameters') or {}
            job_id = query_params.get('job_id')
        
        if not job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'job_id parameter required'
                })
            }
        
        success = cancel_job(job_id)
        
        if success:
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'success': True,
                    'message': f'Job {job_id} cancelled successfully'
                })
            }
        else:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'success': False,
                    'error': 'Job not found or cannot be cancelled'
                })
            }
    except Exception as e:
        logger.error(f"Error in handle_job_cancel: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'error': str(e)
            })
        }


def process_async_search(job_id: str, search_params: Dict[str, Any]):
    """
    Process search asynchronously - called by Lambda async invocation
    This function runs in the background and updates job status
    Checks for cancellation after each page
    """
    try:
        logger.info(f"🚀🚀🚀 PROCESS_ASYNC_SEARCH CALLED FOR JOB {job_id} 🚀🚀🚀")
        logger.info(f"📋 Search parameters: {json.dumps(search_params, default=str)}")
        logger.info(f"⏰ Timestamp: {datetime.now(timezone.utc).isoformat()}")
        update_job_progress(job_id, 0, None, 0, 0, 'IN_PROGRESS')
        logger.info(f"✅ Updated job progress to IN_PROGRESS for job {job_id}")
        
        # Fetch all pages (up to MAX_RESULTS_TO_FETCH)
        MAX_RESULTS_TO_FETCH = 1000
        RESULTS_PER_PAGE = 10
        all_results = []
        page = 1
        total_found = 0
        estimated_total_pages = None
        logger.info(f"⚙️  Configuration: MAX_RESULTS_TO_FETCH={MAX_RESULTS_TO_FETCH}, RESULTS_PER_PAGE={RESULTS_PER_PAGE}")
        
        while len(all_results) < MAX_RESULTS_TO_FETCH:
            # Check for cancellation before starting next page
            if is_job_cancelled(job_id):
                logger.info(f"Job {job_id} was cancelled, stopping search")
                # Store partial results if any
                if all_results:
                    partial_result = {
                        'success': True,
                        'total_found': total_found,
                        'results': all_results,
                        'cancelled': True,
                        'message': 'Search was cancelled by user'
                    }
                    complete_job(job_id, partial_result)
                else:
                    fail_job(job_id, 'Search was cancelled by user')
                return
            
            # Update progress
            logger.info(f"📄 [{job_id}] Processing page {page} (current results: {len(all_results)}, total found: {total_found})")
            if estimated_total_pages:
                update_job_progress(job_id, page, estimated_total_pages, len(all_results), total_found, 'IN_PROGRESS')
                logger.info(f"📊 [{job_id}] Updated progress: page {page}/{estimated_total_pages}, {len(all_results)} results loaded, {total_found} total found")
            else:
                update_job_progress(job_id, page, None, len(all_results), total_found, 'IN_PROGRESS')
                logger.info(f"📊 [{job_id}] Updated progress: page {page}/Unknown, {len(all_results)} results loaded, {total_found} total found")
            
            # Fetch page
            logger.info(f"🔍 [{job_id}] Fetching page {page} from SEC API...")
            result = search_by_search_index_api(search_params, page=page)
            
            if not result.get('success'):
                error_msg = result.get('error', 'Search failed')
                logger.error(f"❌ [{job_id}] Page {page} fetch failed: {error_msg}")
                fail_job(job_id, error_msg)
                return
            
            logger.info(f"✅ [{job_id}] Successfully fetched page {page} from SEC API")
            
            if page == 1:
                total_found = result.get('total_found', 0)
                logger.info(f"📊 [{job_id}] First page results: total_found={total_found}")
                if total_found > 0:
                    estimated_total_pages = min(MAX_RESULTS_TO_FETCH, total_found) // RESULTS_PER_PAGE
                    if total_found % RESULTS_PER_PAGE > 0:
                        estimated_total_pages += 1
                    logger.info(f"📊 [{job_id}] Estimated total pages: {estimated_total_pages} (based on {total_found} total results, {RESULTS_PER_PAGE} per page)")
                else:
                    logger.warning(f"⚠️  [{job_id}] First page returned total_found=0, no results available")
            
            page_results = result.get('results', [])
            logger.info(f"📋 [{job_id}] Page {page} returned {len(page_results)} filing result(s)")
            
            if not page_results:
                logger.info(f"ℹ️  [{job_id}] No more results on page {page}, stopping search")
                break
            
            logger.info(f"📥 [{job_id}] Processing {len(page_results)} filing(s) from page {page}...")
            all_results.extend(page_results)
            logger.info(f"✅ [{job_id}] Added {len(page_results)} filing(s) to results. Total results so far: {len(all_results)}")
            
            # Check for cancellation after processing page
            if is_job_cancelled(job_id):
                logger.info(f"Job {job_id} was cancelled after page {page}, stopping search")
                # Store partial results
                partial_result = {
                    'success': True,
                    'total_found': total_found,
                    'results': all_results,
                    'cancelled': True,
                    'message': f'Search was cancelled by user after fetching {len(all_results)} results'
                }
                complete_job(job_id, partial_result)
                return
            
            # Check if we've fetched all results
            if len(all_results) >= total_found or len(all_results) >= MAX_RESULTS_TO_FETCH:
                break
            
            page += 1
        
        # Complete job (only if not cancelled)
        if not is_job_cancelled(job_id):
            logger.info(f"✅ [{job_id}] Completing job with {len(all_results)} result(s), total_found={total_found}")
            final_result = {
                'success': True,
                'total_found': total_found,
                'results': all_results,
                'form_filters': result.get('form_filters', []),
                'entity_filters': result.get('entity_filters', []),
                'location_filters': result.get('location_filters', []),
                'incorporation_filters': result.get('incorporation_filters', [])
            }
            complete_job(job_id, final_result)
            logger.info(f"✅ [{job_id}] Job marked as completed")
            
            # Update query cache with results
            # Get job status to find results_s3_key (set by complete_job if results >200KB)
            job_status = get_job_status(job_id)
            if job_status:
                query_hash = generate_query_hash(search_params)
                results_s3_key = job_status.get('results_s3_key')
                if results_s3_key:
                    logger.info(f"💾 [{job_id}] Updating query cache with S3 key: {results_s3_key}")
                    update_cached_query_results(query_hash, results_s3_key, total_found, len(all_results))
                else:
                    # Results are inline, update cache without S3 key
                    logger.info(f"💾 [{job_id}] Updating query cache with inline results")
                    store_cached_query(query_hash, job_id, search_params, 
                                     results_s3_key=None, total_found=total_found, 
                                     results_count=len(all_results))
            
            logger.info(f"🎉 Completed async search for job {job_id}: {len(all_results)} results, {total_found} total found")
        
    except Exception as e:
        logger.error(f"❌ [{job_id}] Error in process_async_search: {e}", exc_info=True)
        if not is_job_cancelled(job_id):
            logger.error(f"❌ [{job_id}] Failing job due to error: {str(e)}")
            fail_job(job_id, str(e))
        else:
            logger.info(f"ℹ️  [{job_id}] Job was cancelled, not failing due to error")


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - routes requests based on path
    Also handles async job processing and SQS events
    """
    # Log ALL invocations at the very start
    logger.info(f"🔵🔵🔵 LAMBDA HANDLER ENTRY POINT 🔵🔵🔵")
    logger.info(f"📥 Event keys: {list(event.keys())}")
    logger.info(f"📥 Event type: {type(event)}")
    logger.info(f"📥 Has 'async_job' key: {event.get('async_job')}")
    logger.info(f"📥 Full event (first 1000 chars): {str(event)[:1000]}")
    if context:
        logger.info(f"📥 Request ID: {context.request_id if hasattr(context, 'request_id') else 'N/A'}")
    
    # Global variable to store request_id for completion notification
    global current_request_id
    current_request_id = None
    
    try:
        # Check if this is an SQS event (from wrapper Lambda)
        if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
            first_record = event['Records'][0]
            if first_record.get('eventSource') == 'aws:sqs':
                logger.info(f"📬 SQS EVENT DETECTED - Processing message from queue")
                try:
                    # Parse SQS message body
                    message_body_str = first_record.get('body', '{}')
                    message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                    
                    # Extract request_id and API Gateway event
                    current_request_id = message_body.get('request_id')
                    api_gateway_event = message_body.get('api_gateway_event', {})
                    
                    logger.info(f"📬 Extracted request_id: {current_request_id}")
                    logger.info(f"📬 API Gateway event keys: {list(api_gateway_event.keys())}")
                    
                    # Replace event with API Gateway event for processing
                    event = api_gateway_event
                    
                except Exception as e:
                    logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                    return {
                        'statusCode': 500,
                        'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                    }
        
        # Check if this is an async job invocation
        if event.get('async_job'):
            logger.info(f"🔄🔄🔄 ASYNC JOB INVOCATION DETECTED IN LAMBDA HANDLER 🔄🔄🔄")
            job_id = event.get('job_id')
            search_params = event.get('search_params', {})
            logger.info(f"🔄 ASYNC JOB INVOCATION DETECTED: job_id={job_id}, has_search_params={bool(search_params)}")
            logger.info(f"📋 Async job event structure: async_job={event.get('async_job')}, job_id={job_id}")
            logger.info(f"📋 Search params keys: {list(search_params.keys()) if search_params else 'None'}")
            
            if job_id and search_params:
                logger.info(f"✅ Invoking process_async_search for job {job_id}")
                try:
                    process_async_search(job_id, search_params)
                    logger.info(f"✅ process_async_search completed successfully for job {job_id}")
                except Exception as e:
                    logger.error(f"❌ Exception in process_async_search for job {job_id}: {e}", exc_info=True)
                    raise  # Re-raise to be caught by outer try-except
            else:
                logger.error(f"❌ Missing job_id or search_params: job_id={job_id}, search_params={bool(search_params)}")
                logger.error(f"❌ Event structure: {json.dumps(event, default=str)[:500]}")
            return {'statusCode': 200, 'body': 'Async job started'}
        
        # Regular HTTP request
        path = event.get('path', '')
        http_method = event.get('httpMethod', '')
        
        logger.info(f"Received request: {http_method} {path}")
        
        # Route detection
        # Autocomplete endpoint: /sec-search-autocomplete (GET)
        if 'autocomplete' in path and http_method == 'GET':
            return handle_autocomplete(event)
        # Job cancel endpoint: /sec-search-cancel (POST/GET)
        elif 'sec-search-cancel' in path:
            return handle_job_cancel(event)
        # Job status endpoint: /sec-search-status (GET)
        elif 'sec-search-status' in path and http_method == 'GET':
            return handle_job_status(event)
        # Results fetch endpoint: /sec-search-results (GET) - fetch results from S3
        elif 'sec-search-results' in path and http_method == 'GET':
            logger.info(f"Routing to handle_fetch_results for path: {path}")
            return handle_fetch_results(event)
        # Search endpoint: /sec-search (POST)
        elif 'sec-search' in path and 'autocomplete' not in path and 'status' not in path and 'results' not in path and 'cancel' not in path:
            return handle_search(event)
        else:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(origin),
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Not found'
                })
            }
    except Exception as e:
        logger.error(f"❌❌❌ UNHANDLED EXCEPTION IN LAMBDA_HANDLER ❌❌❌")
        logger.error(f"❌ Error type: {type(e).__name__}")
        logger.error(f"❌ Error message: {str(e)}")
        logger.error(f"❌ Error details: {repr(e)}")
        logger.error(f"❌ Full traceback:", exc_info=True)
        logger.error(f"❌ Event that caused error: {json.dumps(event, default=str)[:1000]}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                **get_cors_headers(origin)
            },
            'body': json.dumps({
                'error': str(e)
            })
        }

