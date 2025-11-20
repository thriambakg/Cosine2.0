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
from typing import Dict, List, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# SEC API configuration
SEC_BASE_URL = "https://www.sec.gov"
SEC_DATA_URL = "https://data.sec.gov"
SEC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Cosine Financial Platform; contact@cosine.financial)"

# Limit results
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '10'))


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
                table_section_full = html_text[table_open_match:data_table_start]
                table_close_match = table_section_full.find('</table>')
                if table_close_match > 0:
                    table_section = table_section_full[:table_close_match + 8]
                else:
                    table_section = table_section_full
            else:
                table_section = html_text[doc_table_start:data_table_start]
        else:
            table_section = html_text
        
        # Extract links only from this table section
        # Strategy 1: Find all .xml file links (prioritize these)
        xml_pattern = r'href="([^"]*\.xml[^"]*)"'
        xml_matches = re.findall(xml_pattern, table_section, re.IGNORECASE)
        document_urls.extend(xml_matches)
        
        # Strategy 2: Look for primary document patterns (highest priority)
        primary_patterns = [
            r'href="([^"]*primary[_-]?document[^"]*\.xml[^"]*)"',
            r'href="([^"]*primarydoc[^"]*\.xml[^"]*)"',
            r'href="([^"]*document[^"]*\.xml[^"]*)"',
            r'href="([^"]*doc\d+\.xml[^"]*)"',
        ]
        primary_links = []
        for pattern in primary_patterns:
            matches = re.findall(pattern, table_section, re.IGNORECASE)
            primary_links.extend(matches)
        
        # Prepend primary links to prioritize them
        document_urls = primary_links + [link for link in document_urls if link not in primary_links]
        
        # Strategy 3: Look for .html/.htm files in the table
        html_pattern = r'href="([^"]*\.(?:html?|htm)[^"]*)"'
        html_matches = re.findall(html_pattern, table_section, re.IGNORECASE)
        html_matches = [link for link in html_matches 
                       if 'index' not in link.lower() 
                       and 'xbrl' not in link.lower()
                       and 'taxonomy' not in link.lower()]
        document_urls.extend(html_matches)
        
        # Strategy 4: Look for .txt files in the table
        txt_pattern = r'href="([^"]*\.txt[^"]*)"'
        txt_matches = re.findall(txt_pattern, table_section, re.IGNORECASE)
        document_urls.extend(txt_matches)
        
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
            
            # Skip index pages and XBRL taxonomy files
            if ('index' not in absolute_url.lower() and 
                'xbrl' not in absolute_url.lower() and
                'taxonomy' not in absolute_url.lower() and
                'schema' not in absolute_url.lower()):
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
        
        return sorted_urls
        
    except Exception as e:
        logger.error(f"Error scraping filing page: {e}")
        return []


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


def search_by_search_index_api(search_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search using SEC search-index API (Elasticsearch endpoint)
    
    Note: The SEC API doesn't support server-side pagination (from/size parameters).
    We fetch all results in one call (API typically returns up to 20-100 results),
    then paginate client-side.
    
    Args:
        search_params: Dictionary with search parameters
    
    Returns:
        Dict with success flag and results list
    """
    session = create_session()
    
    try:
        params = {
            'dateRange': 'all'
        }
        
        # Add CIK if provided
        if search_params.get('cik'):
            params['ciks'] = str(search_params['cik']).zfill(10)
        
        # Add entity name if provided
        if search_params.get('entityName'):
            entity_name = search_params['entityName']
            if search_params.get('cik'):
                cik_str = str(search_params['cik']).zfill(10)
                params['entityName'] = f"{entity_name} (CIK {cik_str})"
            else:
                params['entityName'] = entity_name
        
        # Add date range
        if search_params.get('dateFrom'):
            params['startdt'] = search_params['dateFrom']
        if search_params.get('dateTo'):
            params['enddt'] = search_params['dateTo']
        
        # Handle pagination - SEC API uses 'page' and 'from' parameters
        page = search_params.get('page', 1)
        try:
            page = int(page)
            if page < 1:
                page = 1
        except (ValueError, TypeError):
            page = 1
        
        # SEC API pagination: use 'page' parameter and 'from' for offset
        # The SEC website uses from=100 for page 2, suggesting the API might require increments of 100
        # However, we want 10 results per page. Let's try both approaches:
        # 1. First try: from = (page - 1) * 10 (our desired page size)
        # 2. If that doesn't work, we might need to use from=100, 200, etc. and fetch larger batches
        
        # SEC API pagination strategy:
        # The API might only support 'from' in increments of 100 (like their website)
        # So we'll fetch 100-result batches and slice to get our 10 per page
        # Page 1: from=0 (implicit), get batch 0-99, slice to 0-9
        # Page 2: from=0, get batch 0-99, slice to 10-19  
        # Page 11: from=100, get batch 100-199, slice to 100-109
        
        # Calculate which 100-result batch contains our desired page
        desired_start = (page - 1) * MAX_RESULTS  # e.g., page 2 = result 10
        batch_start = (desired_start // 100) * 100  # e.g., result 10 is in batch starting at 0
        
        if batch_start > 0:
            params['from'] = batch_start
            params['size'] = 100  # Request full batch
        elif page > 1:
            # For pages 2-10, we still need from=0 but request size=100
            params['size'] = 100
        
        if page > 1:
            params['page'] = page
        
        logger.info(f"Making SEC API request with params: {params}, page={page}")
        
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
        
        time.sleep(0.1)  # Rate limiting
        response = session.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        
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
        
        # Get all hits returned by the API
        hits_list = hits_data.get('hits', [])
        
        logger.info(f"SEC API returned {len(hits_list)} results for page {page} (total_found: {total_count})")
        if len(hits_list) > 0:
            first_id = hits_list[0].get('_id', 'N/A')
            last_id = hits_list[-1].get('_id', 'N/A')
            logger.info(f"First result ID: {first_id[:50] if len(first_id) > 50 else first_id}")
            logger.info(f"Last result ID: {last_id[:50] if len(last_id) > 50 else last_id}")
        
        # Calculate which slice of the 100-result batch we need
        # Page 1: want results 0-9 from batch starting at 0
        # Page 2: want results 10-19 from batch starting at 0
        # Page 11: want results 100-109 from batch starting at 100
        batch_start = ((page - 1) * MAX_RESULTS) // 100 * 100
        offset_in_batch = ((page - 1) * MAX_RESULTS) % 100
        start_idx = offset_in_batch
        end_idx = start_idx + MAX_RESULTS
        
        logger.info(f"Batch start: {batch_start}, offset in batch: {offset_in_batch}, slicing [{start_idx}:{end_idx}]")
        
        # Slice the batch to get our 10 results
        limited_hits = hits_list[start_idx:end_idx]
        
        logger.info(f"Using {len(limited_hits)} results from API response (sliced from batch)")
        
        # Extract results with all column data
        results = []
        for hit in limited_hits:
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
            
            # Build filing page URL from accession
            filing_page_url = None
            if accession and cik != 'N/A':
                cik_padded = str(cik).zfill(10)
                accession_clean = accession.replace('-', '')
                if len(accession_clean) >= 12:
                    accession_dashed = f"{accession_clean[:10]}-{accession_clean[10:12]}-{accession_clean[12:]}"
                    base_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik_padded}/{accession_dashed}"
                    filing_page_url = f"{base_url}/{accession_dashed}-index.htm"
            
            # Scrape document URLs from filing page
            document_urls = []
            if filing_page_url:
                document_urls = scrape_filing_page_for_documents(filing_page_url)
            
            results.append({
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
                'filingPageUrl': filing_page_url,
                'documentUrls': document_urls,
                'adsh': source.get('adsh', '')
            })
        
        return {
            'success': True,
            'total_found': total_count,
            'results': results
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
                    'Access-Control-Allow-Origin': '*',
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
                'Access-Control-Allow-Origin': '*',
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
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': str(e)
            })
        }


def handle_search(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle full search requests"""
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
        
        result = search_by_search_index_api(search_params)
        
        return {
            'statusCode': 200 if result.get('success') else 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST,GET,OPTIONS'
            },
            'body': json.dumps(result)
        }
    except Exception as e:
        logger.error(f"Error in handle_search: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - routes requests based on path
    """
    try:
        path = event.get('path', '')
        http_method = event.get('httpMethod', '')
        
        logger.info(f"Received request: {http_method} {path}")
        
        # Route detection
        # Autocomplete endpoint: /sec-search-autocomplete (GET)
        if 'autocomplete' in path and http_method == 'GET':
            return handle_autocomplete(event)
        # Search endpoint: /sec-search (POST)
        elif 'sec-search' in path and 'autocomplete' not in path:
            return handle_search(event)
        else:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'Not found'
                })
            }
    except Exception as e:
        logger.error(f"Error in lambda_handler: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': str(e)
            })
        }

