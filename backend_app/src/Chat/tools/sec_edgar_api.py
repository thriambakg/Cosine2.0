"""
SEC EDGAR API tool for fetching SEC filings and documents
"""

import json
import os
import boto3
import logging
import requests
import time
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import re
from urllib.parse import urljoin, urlparse

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    logger.info("Successfully imported Strands types from layer")
except ImportError as e:
    logger.error(f"Failed to import Strands types: {e}")
    # Define fallback types if needed
    class ToolResult:
        def __init__(self, content: str, is_error: bool = False):
            self.content = content
            self.is_error = is_error

    def tool(func):
        return func

# SEC EDGAR API Configuration
SEC_BASE_URL = "https://www.sec.gov"
EDGAR_API_BASE = "https://data.sec.gov"
USER_AGENT = "Cosine Financial Analysis Agent (contact@cosine.com)"

# Rate limiting
REQUEST_DELAY = 0.1  # 100ms between requests to respect SEC rate limits
MAX_RETRIES = 3

def make_sec_request(url: str, headers: Dict[str, str] = None) -> requests.Response:
    """
    Make a request to SEC EDGAR API with proper headers and rate limiting
    """
    if headers is None:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate'
        }
    
    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(REQUEST_DELAY)  # Rate limiting
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                return response
            elif response.status_code == 429:  # Rate limited
                wait_time = 2 ** attempt  # Exponential backoff
                logger.warning(f"Rate limited, waiting {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                logger.error(f"HTTP {response.status_code}: {response.text}")
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed (attempt {attempt + 1}): {str(e)}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
            else:
                raise
    
    raise Exception(f"Failed to fetch data after {MAX_RETRIES} attempts")

@tool
def get_company_cik(symbol: str) -> str:
    """
    Get the Central Index Key (CIK) for a company by ticker symbol
    
    Args:
        symbol: Stock ticker symbol (e.g., 'AAPL', 'TSLA')
        
    Returns:
        String with CIK number or error message
    """
    try:
        logger.info(f"Looking up CIK for symbol: {symbol}")
        
        # SEC company tickers endpoint
        url = f"{EDGAR_API_BASE}/api/xbrl/companyfacts/CIK0000000000.json"
        
        # Try to find the company by searching through the tickers endpoint
        tickers_url = f"{SEC_BASE_URL}/files/company_tickers.json"
        response = make_sec_request(tickers_url)
        
        if response.status_code == 200:
            tickers_data = response.json()
            
            # Search for the symbol
            for entry in tickers_data.values():
                if entry.get('ticker', '').upper() == symbol.upper():
                    cik = str(entry.get('cik_str', ''))
                    if cik:
                        # Pad CIK to 10 digits
                        cik_padded = cik.zfill(10)
                        logger.info(f"Found CIK for {symbol}: {cik_padded}")
                        return f"CIK for {symbol}: {cik_padded}"
            
            return f"Company with ticker '{symbol}' not found in SEC database"
        else:
            return f"Error fetching company data: HTTP {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error getting CIK for {symbol}: {str(e)}")
        return f"Error getting CIK for {symbol}: {str(e)}"

@tool
def get_company_filings(cik: str, form_type: str = "10-K", limit: int = 10) -> str:
    """
    Get recent SEC filings for a company
    
    Args:
        cik: Central Index Key (10-digit padded)
        form_type: Type of filing (10-K, 10-Q, 8-K, etc.)
        limit: Maximum number of filings to return
        
    Returns:
        String with filing information or error message
    """
    try:
        logger.info(f"Getting {form_type} filings for CIK: {cik}")
        
        # Clean CIK (remove leading zeros, pad to 10 digits)
        cik_clean = cik.replace('CIK', '').strip()
        cik_padded = cik_clean.zfill(10)
        
        # SEC submissions endpoint
        url = f"{EDGAR_API_BASE}/submissions/CIK{cik_padded}.json"
        
        response = make_sec_request(url)
        
        if response.status_code == 200:
            data = response.json()
            
            # Extract filings
            filings = data.get('filings', {}).get('recent', {})
            forms = filings.get('form', [])
            accession_numbers = filings.get('accessionNumber', [])
            filing_dates = filings.get('filingDate', [])
            primary_documents = filings.get('primaryDocument', [])
            
            # Filter by form type
            matching_filings = []
            for i, form in enumerate(forms):
                if form == form_type and len(matching_filings) < limit:
                    accession = accession_numbers[i] if i < len(accession_numbers) else 'N/A'
                    filing_date = filing_dates[i] if i < len(filing_dates) else 'N/A'
                    primary_doc = primary_documents[i] if i < len(primary_documents) else 'N/A'
                    
                    matching_filings.append({
                        'form': form,
                        'accession_number': accession,
                        'filing_date': filing_date,
                        'primary_document': primary_doc
                    })
            
            if matching_filings:
                result = f"Found {len(matching_filings)} {form_type} filings for CIK {cik_padded}:\n\n"
                for filing in matching_filings:
                    result += f"• {filing['form']} - {filing['filing_date']}\n"
                    result += f"  Accession: {filing['accession_number']}\n"
                    result += f"  Document: {filing['primary_document']}\n\n"
                
                return result
            else:
                return f"No {form_type} filings found for CIK {cik_padded}"
        else:
            return f"Error fetching filings: HTTP {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error getting filings for CIK {cik}: {str(e)}")
        return f"Error getting filings for CIK {cik}: {str(e)}"

@tool
def get_filing_document(cik: str, accession_number: str, document_name: str = None) -> str:
    """
    Get the full text content of a specific SEC filing document
    
    Args:
        cik: Central Index Key (10-digit padded)
        accession_number: Accession number of the filing
        document_name: Specific document name (optional)
        
    Returns:
        String with document content or error message
    """
    try:
        logger.info(f"Getting document for CIK: {cik}, Accession: {accession_number}")
        
        # Clean CIK
        cik_clean = cik.replace('CIK', '').strip()
        cik_padded = cik_clean.zfill(10)
        
        # Clean accession number (remove dashes)
        accession_clean = accession_number.replace('-', '')
        
        # Construct document URL
        if document_name:
            # Specific document
            document_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}/{document_name}"
        else:
            # Try to get the primary document from submissions
            submissions_url = f"{EDGAR_API_BASE}/submissions/CIK{cik_padded}.json"
            response = make_sec_request(submissions_url)
            
            if response.status_code == 200:
                data = response.json()
                filings = data.get('filings', {}).get('recent', {})
                accession_numbers = filings.get('accessionNumber', [])
                primary_documents = filings.get('primaryDocument', [])
                
                # Find the matching filing
                for i, acc_num in enumerate(accession_numbers):
                    if acc_num == accession_number:
                        document_name = primary_documents[i] if i < len(primary_documents) else None
                        break
                
                if not document_name:
                    return f"Primary document not found for accession {accession_number}"
                
                document_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}/{document_name}"
            else:
                return f"Error fetching submission data: HTTP {response.status_code}"
        
        # Fetch the document
        response = make_sec_request(document_url)
        
        if response.status_code == 200:
            content = response.text
            
            # Truncate if too long (SEC filings can be massive)
            if len(content) > 100000:  # 100KB limit
                content = content[:100000] + "\n\n[Document truncated - too large for display]"
            
            return f"Document content for {document_name or 'filing'}:\n\n{content}"
        else:
            return f"Error fetching document: HTTP {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error getting document: {str(e)}")
        return f"Error getting document: {str(e)}"

@tool
def search_sec_filings(company_name: str = None, form_type: str = "10-K", 
                      start_date: str = None, end_date: str = None, limit: int = 10) -> str:
    """
    Search for SEC filings by company name and other criteria
    
    Args:
        company_name: Name of the company to search for
        form_type: Type of filing (10-K, 10-Q, 8-K, etc.)
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        limit: Maximum number of results
        
    Returns:
        String with search results or error message
    """
    try:
        logger.info(f"Searching SEC filings: {company_name}, {form_type}")
        
        # SEC company search endpoint
        search_url = f"{EDGAR_API_BASE}/api/xbrl/companyfacts/CIK0000000000.json"
        
        # For now, return a message about the search capability
        # In a full implementation, you would use the SEC's search API
        result = f"SEC Filing Search Results:\n\n"
        result += f"Company: {company_name or 'All companies'}\n"
        result += f"Form Type: {form_type}\n"
        result += f"Date Range: {start_date or 'All dates'} to {end_date or 'Present'}\n"
        result += f"Limit: {limit} results\n\n"
        result += "Note: This is a simplified search. For comprehensive SEC filing search, "
        result += "use the SEC's EDGAR search interface at https://www.sec.gov/edgar/search/"
        
        return result
        
    except Exception as e:
        logger.error(f"Error searching SEC filings: {str(e)}")
        return f"Error searching SEC filings: {str(e)}"

@tool
def get_filing_exhibits(cik: str, accession_number: str) -> str:
    """
    Get all exhibits for a specific SEC filing
    
    Args:
        cik: Central Index Key (10-digit padded)
        accession_number: Accession number of the filing
        
    Returns:
        String with exhibit information or error message
    """
    try:
        logger.info(f"Getting exhibits for CIK: {cik}, Accession: {accession_number}")
        
        # Clean CIK
        cik_clean = cik.replace('CIK', '').strip()
        cik_padded = cik_clean.zfill(10)
        
        # Clean accession number
        accession_clean = accession_number.replace('-', '')
        
        # Get the filing's index page
        index_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}/index.html"
        
        response = make_sec_request(index_url)
        
        if response.status_code == 200:
            content = response.text
            
            # Parse HTML to find exhibits
            # This is a simplified parser - in production you'd use BeautifulSoup
            exhibits = []
            lines = content.split('\n')
            
            for line in lines:
                if 'EX-' in line.upper() or 'EXHIBIT' in line.upper():
                    # Extract exhibit information
                    if 'href=' in line:
                        # Find the href and text
                        href_match = re.search(r'href="([^"]*)"', line)
                        text_match = re.search(r'>([^<]*)<', line)
                        
                        if href_match and text_match:
                            exhibit_url = href_match.group(1)
                            exhibit_text = text_match.group(1).strip()
                            
                            if exhibit_text and len(exhibit_text) > 3:  # Filter out empty or very short matches
                                exhibits.append({
                                    'name': exhibit_text,
                                    'url': f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}/{exhibit_url}"
                                })
            
            if exhibits:
                result = f"Found {len(exhibits)} exhibits for filing {accession_number}:\n\n"
                for exhibit in exhibits[:10]:  # Limit to first 10 exhibits
                    result += f"• {exhibit['name']}\n"
                    result += f"  URL: {exhibit['url']}\n\n"
                
                if len(exhibits) > 10:
                    result += f"... and {len(exhibits) - 10} more exhibits\n"
                
                return result
            else:
                return f"No exhibits found for filing {accession_number}"
        else:
            return f"Error fetching filing index: HTTP {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error getting exhibits: {str(e)}")
        return f"Error getting exhibits: {str(e)}"

@tool
def download_filing_pdf(cik: str, accession_number: str, document_name: str, 
                       save_to_s3: bool = True) -> str:
    """
    Download a SEC filing as PDF and optionally save to S3
    
    Args:
        cik: Central Index Key (10-digit padded)
        accession_number: Accession number of the filing
        document_name: Name of the document to download
        save_to_s3: Whether to save the PDF to S3
        
    Returns:
        String with download status and S3 URL if saved
    """
    try:
        logger.info(f"Downloading PDF for CIK: {cik}, Document: {document_name}")
        
        # Clean CIK
        cik_clean = cik.replace('CIK', '').strip()
        cik_padded = cik_clean.zfill(10)
        
        # Clean accession number
        accession_clean = accession_number.replace('-', '')
        
        # Construct document URL
        document_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_clean}/{document_name}"
        
        # Download the document
        response = make_sec_request(document_url)
        
        if response.status_code == 200:
            content = response.content
            
            if save_to_s3:
                # Save to S3
                bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
                user_id = os.environ.get('USER_ID')
                session_id = os.environ.get('SESSION_ID')
                
                if not bucket_name or not user_id or not session_id:
                    return "Error: Missing environment variables for S3 upload"
                
                # Generate S3 key for agent-files folder
                timestamp = int(time.time())
                s3_key = f"users/{user_id}/sessions/{session_id}/agent-files/{timestamp}_{document_name}"
                
                # Upload to S3
                s3_client = boto3.client('s3')
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=s3_key,
                    Body=content,
                    ContentType='application/pdf',
                    Metadata={
                        'source': 'sec_edgar',
                        'cik': cik_padded,
                        'accession_number': accession_number,
                        'document_name': document_name,
                        'download_timestamp': str(timestamp)
                    }
                )
                
                s3_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
                
                result = f"✅ Successfully downloaded and saved SEC filing to S3:\n\n"
                result += f"Document: {document_name}\n"
                result += f"CIK: {cik_padded}\n"
                result += f"Accession: {accession_number}\n"
                result += f"S3 URL: {s3_url}\n"
                result += f"File Size: {len(content):,} bytes"
                return result
            else:
                result = f"✅ Successfully downloaded SEC filing:\n\n"
                result += f"Document: {document_name}\n"
                result += f"File Size: {len(content):,} bytes\n"
                result += f"Content Type: {response.headers.get('content-type', 'unknown')}"
                return result
        else:
            return f"Error downloading document: HTTP {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error downloading PDF: {str(e)}")
        return f"Error downloading PDF: {str(e)}"
