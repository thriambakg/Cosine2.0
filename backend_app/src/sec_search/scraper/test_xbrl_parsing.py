"""
Test script for XBRL table parsing
Experiments with different parsing strategies to extract XBRL data from SEC report files
"""

import requests
import re
from bs4 import BeautifulSoup
import json
from datetime import datetime

# SEC API configuration (matching Lambda)
SEC_BASE_URL = "https://www.sec.gov"
SEC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Cosine Financial Platform; contact@cosine.financial)"

def create_session():
    """Create a requests session with proper headers (matching Lambda)"""
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

def test_fetch_xbrl_zip(cik: str, accession_dir: str, accession: str):
    """Test fetching XBRL ZIP file directly"""
    session = create_session()
    
    base_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik}/{accession_dir}"
    
    # Try different possible ZIP file locations
    zip_urls = [
        f"{base_url}/{accession}-xbrl.zip",  # Most common format
        f"{base_url}/{accession_dir}-xbrl.zip",  # Alternative format
        f"{base_url}/xbrl.zip",  # Simple format
    ]
    
    print(f"\n{'='*80}")
    print(f"Testing XBRL ZIP File Download")
    print(f"{'='*80}")
    print(f"Base URL: {base_url}")
    print(f"\nTrying ZIP file URLs:")
    
    for zip_url in zip_urls:
        try:
            print(f"\n  Fetching: {zip_url}")
            response = session.get(zip_url, timeout=30, stream=True)
            
            if response.status_code == 200:
                content_type = response.headers.get('Content-Type', '')
                content_length = response.headers.get('Content-Length', 'unknown')
                
                print(f"  ✅ Status: {response.status_code}")
                print(f"  Content-Type: {content_type}")
                print(f"  Content-Length: {content_length} bytes")
                
                if 'zip' in content_type.lower() or zip_url.endswith('.zip'):
                    print(f"  ✅ This appears to be a ZIP file!")
                    
                    # Save the ZIP file
                    zip_filename = f"xbrl_{cik}_{accession.replace('-', '_')}.zip"
                    with open(zip_filename, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            f.write(chunk)
                    
                    print(f"  💾 Saved ZIP file to: {zip_filename}")
                    return zip_url, zip_filename
                else:
                    print(f"  ⚠️  Unexpected content type: {content_type}")
                    
            elif response.status_code == 404:
                print(f"  ❌ Status: {response.status_code} (Not Found)")
            else:
                print(f"  ⚠️  Status: {response.status_code}")
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            import traceback
            traceback.print_exc()
    
    return None, None

def test_fetch_report_file(cik: str, accession_dir: str):
    """Test fetching R1.htm report file directly"""
    session = create_session()
    
    base_url = f"{SEC_BASE_URL}/Archives/edgar/data/{cik}/{accession_dir}"
    report_urls = [
        f"{base_url}/R1.htm",
        f"{base_url}/R2.htm",
        f"{base_url}/R3.htm",
    ]
    
    print(f"\n{'='*80}")
    print(f"Testing XBRL Report File Fetching")
    print(f"{'='*80}")
    print(f"Base URL: {base_url}")
    print(f"\nTrying report files:")
    
    for report_url in report_urls:
        try:
            print(f"\n  Fetching: {report_url}")
            response = session.get(report_url, timeout=30)
            
            if response.status_code == 200:
                print(f"  ✅ Status: {response.status_code}")
                print(f"  Content length: {len(response.text)} bytes")
                print(f"  Content-Type: {response.headers.get('Content-Type', 'N/A')}")
                
                # Check if it contains the XBRL table
                html_text = response.text
                
                # Test 1: Regex pattern matching
                print(f"\n  Testing Regex Patterns:")
                
                # Pattern 0: Outer table containing the reportDiv (NEW - this is what we want)
                # Look for table that contains <div id="reportDiv"> with the report table inside
                pattern0 = r'<table[^>]*>.*?<div[^>]*id="reportDiv"[^>]*>.*?<table[^>]*class="report"[^>]*>.*?</table>.*?</div>.*?</table>'
                match0 = re.search(pattern0, html_text, re.DOTALL | re.IGNORECASE)
                if match0:
                    print(f"    ✅ Pattern 0 (outer table with reportDiv): Found ({len(match0.group(0))} bytes)")
                else:
                    print(f"    ❌ Pattern 0: Not found")
                    # Try simpler version - just find table containing reportDiv
                    pattern0_simple = r'<table[^>]*>.*?reportDiv.*?</table>'
                    match0_simple = re.search(pattern0_simple, html_text, re.DOTALL | re.IGNORECASE)
                    if match0_simple:
                        print(f"    ⚠️  Pattern 0 (simple): Found ({len(match0_simple.group(0))} bytes)")
                        match0 = match0_simple
                
                # Pattern 1: Exact match with class and id (inner table)
                pattern1 = r'<table[^>]*class="report"[^>]*id="id2"[^>]*>.*?</table>'
                match1 = re.search(pattern1, html_text, re.DOTALL | re.IGNORECASE)
                if match1:
                    print(f"    ✅ Pattern 1 (class='report' id='id2'): Found ({len(match1.group(0))} bytes)")
                else:
                    print(f"    ❌ Pattern 1: Not found")
                
                # Pattern 2: Just class="report" (inner table)
                pattern2 = r'<table[^>]*class="report"[^>]*>.*?</table>'
                match2 = re.search(pattern2, html_text, re.DOTALL | re.IGNORECASE)
                if match2:
                    print(f"    ✅ Pattern 2 (class='report'): Found ({len(match2.group(0))} bytes)")
                else:
                    print(f"    ❌ Pattern 2: Not found")
                
                # Pattern 3: With tbody (inner table)
                pattern3 = r'<table[^>]*class="report"[^>]*>\s*<tbody>.*?</tbody>\s*</table>'
                match3 = re.search(pattern3, html_text, re.DOTALL | re.IGNORECASE)
                if match3:
                    print(f"    ✅ Pattern 3 (with tbody): Found ({len(match3.group(0))} bytes)")
                else:
                    print(f"    ❌ Pattern 3: Not found")
                
                # Test 2: BeautifulSoup parsing
                print(f"\n  Testing BeautifulSoup Parsing:")
                try:
                    soup = BeautifulSoup(html_text, 'html.parser')
                    
                    # First, try to find the outer table containing reportDiv
                    report_div = soup.find('div', {'id': 'reportDiv'})
                    if report_div:
                        # Find the parent table
                        outer_table = report_div.find_parent('table')
                        if outer_table:
                            print(f"    ✅ Found outer table containing reportDiv ({len(str(outer_table))} bytes)")
                        else:
                            print(f"    ⚠️  Found reportDiv but no parent table")
                    else:
                        print(f"    ⚠️  No reportDiv found")
                    
                    # Find table with class="report" and id="id2" (inner table)
                    table = soup.find('table', {'class': 'report', 'id': 'id2'})
                    if table:
                        print(f"    ✅ Found inner table with class='report' id='id2' ({len(str(table))} bytes)")
                    else:
                        # Try just class="report"
                        table = soup.find('table', {'class': 'report'})
                        if table:
                            print(f"    ✅ Found inner table with class='report' ({len(str(table))} bytes)")
                        else:
                            print(f"    ❌ No table with class='report' found")
                            
                            # List all tables
                            all_tables = soup.find_all('table')
                            print(f"    Found {len(all_tables)} total tables")
                            for i, t in enumerate(all_tables[:5]):  # Show first 5
                                classes = t.get('class', [])
                                table_id = t.get('id', 'N/A')
                                print(f"      Table {i+1}: class={classes}, id={table_id}")
                except Exception as e:
                    print(f"    ❌ BeautifulSoup error: {e}")
                
                # Test 3: Check for specific content
                print(f"\n  Content Analysis:")
                if 'class="report"' in html_text:
                    print(f"    ✅ Contains 'class=\"report\"'")
                else:
                    print(f"    ❌ Does not contain 'class=\"report\"'")
                
                if 'id="id2"' in html_text:
                    print(f"    ✅ Contains 'id=\"id2\"'")
                else:
                    print(f"    ❌ Does not contain 'id=\"id2\"'")
                
                if '<tbody>' in html_text:
                    print(f"    ✅ Contains '<tbody>'")
                else:
                    print(f"    ❌ Does not contain '<tbody>'")
                
                # Show first 500 chars of content
                print(f"\n  First 500 characters of response:")
                print(f"    {html_text[:500]}...")
                
                # If we found a match, save it (prioritize outer table)
                if match0:
                    table_html = match0.group(0)
                    print(f"\n  ✅ SUCCESS: Extracted outer table with reportDiv ({len(table_html)} bytes)")
                    print(f"\n  First 200 chars of extracted table:")
                    print(f"    {table_html[:200]}...")
                    
                    # Also try BeautifulSoup extraction if available (prefer outer table)
                    try:
                        soup = BeautifulSoup(html_text, 'html.parser')
                        report_div = soup.find('div', {'id': 'reportDiv'})
                        if report_div:
                            outer_table = report_div.find_parent('table')
                            if outer_table:
                                table_html_bs = str(outer_table)
                                print(f"\n  BeautifulSoup extraction (outer table): {len(table_html_bs)} bytes")
                                return table_html_bs, report_url
                    except:
                        pass
                    
                    return table_html, report_url
                elif match1 or match2 or match3:
                    table_html = (match1 or match2 or match3).group(0)
                    print(f"\n  ✅ SUCCESS: Extracted inner table ({len(table_html)} bytes)")
                    print(f"\n  First 200 chars of extracted table:")
                    print(f"    {table_html[:200]}...")
                    
                    # Also try BeautifulSoup extraction if available
                    try:
                        soup = BeautifulSoup(html_text, 'html.parser')
                        table = soup.find('table', {'class': 'report', 'id': 'id2'}) or soup.find('table', {'class': 'report'})
                        if table:
                            table_html_bs = str(table)
                            print(f"\n  BeautifulSoup extraction: {len(table_html_bs)} bytes")
                            return table_html_bs, report_url
                    except:
                        pass
                    
                    return table_html, report_url
                
            elif response.status_code == 404:
                print(f"  ❌ Status: {response.status_code} (Not Found)")
            else:
                print(f"  ⚠️  Status: {response.status_code}")
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            import traceback
            traceback.print_exc()
    
    return None, None

def test_viewer_page(cik: str, accession: str):
    """Test fetching the viewer page and extracting the outer table"""
    session = create_session()
    
    viewer_url = f"{SEC_BASE_URL}/cgi-bin/viewer?action=view&cik={cik}&accession_number={accession}&xbrl_type=v"
    
    print(f"\n{'='*80}")
    print(f"Testing Viewer Page (for outer table extraction)")
    print(f"{'='*80}")
    print(f"URL: {viewer_url}")
    
    try:
        response = session.get(viewer_url, timeout=30)
        print(f"Status: {response.status_code}")
        print(f"Content length: {len(response.text)} bytes")
        print(f"Content-Type: {response.headers.get('Content-Type', 'N/A')}")
        
        html_text = response.text
        
        # Check if it's the JavaScript wrapper
        if 'ixvFrame' in html_text or 'loadViewer' in html_text:
            print(f"⚠️  This appears to be the JavaScript wrapper page")
            print(f"   But let's check if it also contains the outer table structure...")
        
        # Try to find the outer table with reportDiv
        print(f"\n  Testing Outer Table Extraction:")
        
        # Pattern: Find table containing reportDiv
        pattern_outer = r'<table[^>]*>.*?<div[^>]*id="reportDiv"[^>]*>.*?</div>.*?</table>'
        match_outer = re.search(pattern_outer, html_text, re.DOTALL | re.IGNORECASE)
        if match_outer:
            print(f"    ✅ Found outer table with reportDiv ({len(match_outer.group(0))} bytes)")
        else:
            print(f"    ❌ Pattern not found, trying BeautifulSoup...")
        
        # Try BeautifulSoup
        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            report_div = soup.find('div', {'id': 'reportDiv'})
            if report_div:
                print(f"    ✅ Found reportDiv")
                outer_table = report_div.find_parent('table')
                if outer_table:
                    outer_table_html = str(outer_table)
                    print(f"    ✅ Found outer table containing reportDiv ({len(outer_table_html)} bytes)")
                    print(f"\n  First 200 chars of outer table:")
                    print(f"    {outer_table_html[:200]}...")
                    return outer_table_html, viewer_url
                else:
                    print(f"    ⚠️  reportDiv found but no parent table")
            else:
                print(f"    ❌ No reportDiv found in viewer page")
        except Exception as e:
            print(f"    ❌ BeautifulSoup error: {e}")
        
        # Show first 500 chars
        print(f"\nFirst 500 characters:")
        print(f"{html_text[:500]}...")
        
        return None, None
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None, None

if __name__ == "__main__":
    # Test data from the user's example
    cik = "1404912"
    accession_dir = "000114036121012169"  # Note: no dashes in directory name
    accession = "0001140361-21-012169"    # With dashes for viewer URL
    
    print("\n" + "="*80)
    print("XBRL Parsing Test Script")
    print("="*80)
    print(f"\nTest Parameters:")
    print(f"  CIK: {cik}")
    print(f"  Accession Directory: {accession_dir}")
    print(f"  Accession Number: {accession}")
    
    # Test 1: Try to download XBRL ZIP file (preferred method)
    zip_url, zip_filename = test_fetch_xbrl_zip(cik, accession_dir, accession)
    
    # Test 2: Fetch report file directly (gets inner table) - fallback if ZIP not available
    inner_table_html, report_url = test_fetch_report_file(cik, accession_dir)
    
    # Test 3: Fetch viewer page (for outer table) - fallback if ZIP not available
    outer_table_html, viewer_url = test_viewer_page(cik, accession)
    
    # Summary
    print(f"\n{'='*80}")
    print("Summary")
    print(f"{'='*80}")
    
    # If ZIP file was downloaded, that's the preferred method
    if zip_url and zip_filename:
        print(f"✅ Successfully downloaded XBRL ZIP file from: {zip_url}")
        print(f"   Saved to: {zip_filename}")
        print(f"\n   The ZIP file contains the complete XBRL package with:")
        print(f"   - XBRL instance documents (.xml)")
        print(f"   - Taxonomy files (.xsd, .xml)")
        print(f"   - Linkbase files (.xml)")
        print(f"   - Other supporting files")
        print(f"\n   This is the preferred method over HTML parsing!")
        table_html = None  # No HTML table needed when ZIP is available
    # Fallback: Combine outer table structure with inner report table (if ZIP not available)
    if not zip_url and outer_table_html and inner_table_html:
        print(f"✅ Found both outer table structure and inner report table")
        print(f"   Combining them...")
        
        # Replace empty reportDiv with the actual report table
        # Find the empty <div id="reportDiv"></div> and replace it with the inner table
        import re
        # Pattern to find empty reportDiv
        pattern_empty_div = r'<div[^>]*id="reportDiv"[^>]*>\s*</div>'
        # Replace with div containing the inner table
        combined_html = re.sub(
            pattern_empty_div,
            f'<div id="reportDiv">{inner_table_html}</div>',
            outer_table_html,
            flags=re.IGNORECASE | re.DOTALL
        )
        
        if combined_html != outer_table_html:
            print(f"   ✅ Successfully combined tables")
            table_html = combined_html
            source_url = f"{viewer_url} + {report_url}"
            table_type = "combined (outer structure + inner report table)"
        else:
            print(f"   ⚠️  Could not combine, using outer table only")
            table_html = outer_table_html
            source_url = viewer_url
            table_type = "outer table (with menu, but empty reportDiv)"
    elif outer_table_html:
        print(f"⚠️  Found outer table but no inner report table")
        table_html = outer_table_html
        source_url = viewer_url
        table_type = "outer table (with menu, but empty reportDiv)"
    elif inner_table_html:
        print(f"⚠️  Found inner report table but no outer table structure")
        table_html = inner_table_html
        source_url = report_url
        table_type = "inner table (report only)"
    else:
        table_html = None
        source_url = None
        table_type = None
    
    if table_html:
        print(f"✅ Successfully extracted XBRL {table_type}")
        print(f"   Source: {source_url}")
        print(f"   Table size: {len(table_html)} bytes")
        
        # Create a complete HTML document with the table
        # Check if table_html contains the outer structure (has reportDiv)
        has_outer_structure = 'id="reportDiv"' in table_html or "reportDiv" in table_html
        
        full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XBRL Table - {cik} - {accession}</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #333;
            margin-bottom: 20px;
        }}
        table.report {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        table.report th {{
            background-color: #4a90e2;
            color: white;
            padding: 10px;
            text-align: left;
            border: 1px solid #ddd;
        }}
        table.report td {{
            padding: 8px;
            border: 1px solid #ddd;
        }}
        table.report tr:nth-child(even) {{
            background-color: #f9f9f9;
        }}
        table.report tr:hover {{
            background-color: #f1f1f1;
        }}
        .info {{
            margin-bottom: 20px;
            padding: 10px;
            background-color: #e8f4f8;
            border-left: 4px solid #4a90e2;
        }}
        /* Styles for the outer table structure */
        #menu {{
            list-style: none;
            padding: 0;
        }}
        #menu li {{
            margin: 5px 0;
        }}
        #menu a {{
            text-decoration: none;
            color: #333;
        }}
        #menu a:hover {{
            color: #4a90e2;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>XBRL Table</h1>
        <div class="info">
            <strong>CIK:</strong> {cik}<br>
            <strong>Accession:</strong> {accession}<br>
            <strong>Source:</strong> {source_url}<br>
            <strong>Type:</strong> {table_type}<br>
            <strong>Extracted:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        </div>
        {table_html}
    </div>
</body>
</html>"""
        
        # Save to file
        output_file = f"xbrl_table_{cik}_{accession.replace('-', '_')}.html"
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(full_html)
            print(f"\n   💾 Saved full HTML to: {output_file}")
            
            # Also save just the table HTML
            table_only_file = f"xbrl_table_only_{cik}_{accession.replace('-', '_')}.html"
            with open(table_only_file, 'w', encoding='utf-8') as f:
                f.write(table_html)
            print(f"   💾 Saved table only to: {table_only_file}")
        except Exception as e:
            print(f"\n   ⚠️  Could not save to file: {e}")
    else:
        print(f"❌ Failed to extract XBRL table")
        print(f"   Try checking:")
        print(f"   1. The report file URLs (R1.htm, R2.htm, etc.)")
        print(f"   2. The HTML structure of the report file")
        print(f"   3. Whether the filing actually has XBRL data")

