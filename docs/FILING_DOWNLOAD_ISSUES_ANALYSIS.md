# Filing Download Issues Analysis

## Case Study: Filing with No Documents Downloaded

**Filing Page URL**: `https://www.sec.gov/Archives/edgar/data/1404912/0001404912-25-000040/0001404912-25-000040-index.htm`

## Potential Root Causes

Based on the current code implementation, here are the most likely reasons why documents weren't downloaded:

### 1. **Filing Page URL Construction Failure** ⚠️ HIGH PROBABILITY
**Location**: `lambda_function.py` lines 1677-1684

**Issue**: The filing page URL is constructed from `accession` and `cik`. If either is missing or malformed, `filing_page_url` will be `None`.

**Code Check**:
```python
if filing_data['accession'] and filing_data['cik'] != 'N/A':
    # Construct URL
else:
    filing_page_url = None  # No URL = no scraping
```

**Impact**: If `filing_page_url` is `None`, `scrape_filing_page_for_documents()` is never called, resulting in empty `document_urls`.

**How to Verify**: Check logs for:
- `"Cache miss for filing {filing_id}, scraping..."`
- `"filing_page_url: None"` or missing filing page URL in logs

---

### 2. **Document Table Not Found** ⚠️ MEDIUM PROBABILITY
**Location**: `lambda_function.py` lines 342-486 (`scrape_filing_page_for_documents`)

**Issue**: The scraping function searches for the "Document Format Files" table using regex patterns. If the table structure is different or the text doesn't match, no documents are extracted.

**Patterns Searched**:
- `r'Document Format Files'`
- `r'<table[^>]*>.*?Document Format Files'`
- `r'<th[^>]*>.*?Document Format Files'`

**Impact**: If the table isn't found, `doc_table_start` remains `-1`, and the function returns an empty list.

**How to Verify**: Check logs for:
- `"Error scraping filing page: {e}"` - would indicate an exception
- No error but empty `document_urls` list

---

### 3. **All Documents Filtered Out** ⚠️ MEDIUM PROBABILITY
**Location**: `lambda_function.py` lines 421-434, 455-465

**Issue**: The code filters out URLs containing:
- `'index'`
- `'xbrl'`
- `'taxonomy'`
- `'schema'`
- `'browse-edgar'`
- `'browse'`
- `'/cgi-bin/'`
- `'search'`

**Problem**: If ALL document URLs in the table contain any of these terms, they'll all be filtered out, resulting in an empty list.

**Example**: If a filing has documents like:
- `document-index.html`
- `browse-edgar-doc.xml`
- `schema-file.txt`

All would be filtered, leaving nothing to download.

**How to Verify**: Check logs for:
- `"Extracted table section length: {len} chars, found {count} href links"`
- If `count > 0` but `document_urls` is empty, filtering is the issue

---

### 4. **Empty Content Detection** ⚠️ LOW PROBABILITY
**Location**: `lambda_function.py` lines 620-622

**Issue**: If a document download returns empty content, it's skipped:
```python
if len(response.content) == 0:
    logger.warning(f"Empty content for {doc_url}, skipping")
    continue
```

**Impact**: Individual documents are skipped, but this wouldn't cause ALL documents to fail.

---

### 5. **Index Page Detection (Too Aggressive)** ⚠️ LOW PROBABILITY
**Location**: `lambda_function.py` lines 686-701

**Issue**: Documents are skipped if:
- URL contains `'-index.htm'`
- URL ends with `'index.htm'` or `'index.html'`

**Problem**: If a document filename accidentally contains "index" (e.g., `document-index-notes.html`), it would be incorrectly skipped.

**Current Fix**: The code only checks for `-index.htm` in the URL, not just "index" anywhere, so this is less likely.

---

### 6. **SEC Navigation Page Detection** ⚠️ LOW PROBABILITY
**Location**: `lambda_function.py` lines 693-705

**Issue**: Documents are skipped if content contains:
- `b'browse-edgar'`
- `b'sec.gov/cgi-bin'`
- `b'edgar search'`
- etc.

**Impact**: If a document's content (not URL) contains these terms, it would be incorrectly identified as a navigation page.

---

### 7. **Download Failures (Network/S3)** ⚠️ MEDIUM PROBABILITY
**Location**: `lambda_function.py` lines 608-889

**Issue**: Individual downloads can fail due to:
- Network timeouts (30-second timeout)
- HTTP errors (404, 403, etc.)
- S3 upload failures
- KMS permission errors

**Impact**: Each failure is logged but doesn't stop other downloads. If ALL downloads fail, no files are stored.

**How to Verify**: Check logs for:
- `"❌ Error downloading document {doc_url}: {e}"`
- `"📊 Download summary: X attempted, 0 successful, X failed"`

---

### 8. **Filing ID Validation Failure** ⚠️ LOW PROBABILITY
**Location**: `lambda_function.py` lines 1730-1736

**Issue**: If `filing_id` format is invalid (less than 4 parts when split by `-`), the download is skipped entirely.

**Impact**: No downloads attempted for the filing.

**How to Verify**: Check logs for:
- `"Invalid filing_id format '{filing_id}' - skipping S3 download"`

---

## Recommended Investigation Steps

### Step 1: Check Lambda Logs
Look for these log messages in chronological order:

1. **Filing Processing**:
   ```
   "Cache miss for filing {filing_id}, scraping..."
   "📥 Starting download for filing_id: {filing_id}"
   "   Filing page URL: {url}"
   ```

2. **Scraping Results**:
   ```
   "Extracted table section length: {len} chars, found {count} href links"
   "Document Format Files: {count} files"
   ```

3. **Download Attempts**:
   ```
   "   Downloading document 1/{total}: {url}"
   "   ✅ Downloaded document to {s3_key}"
   "   ❌ Error downloading document {url}: {error}"
   ```

4. **Summary**:
   ```
   "📊 Download summary: X attempted, Y successful, Z failed, W skipped"
   ```

### Step 2: Manual Verification
1. Visit the filing page URL in a browser
2. Inspect the "Document Format Files" table
3. Check if document URLs contain filtered terms
4. Verify the table structure matches expected patterns

### Step 3: Test Scraping Function
Add temporary debug logging to see what's being extracted:
```python
logger.info(f"Raw hrefs found: {all_hrefs}")
logger.info(f"After filtering: {document_urls}")
```

### Step 4: Check for Edge Cases
- Filings with unusual table structures
- Filings where all documents are in subdirectories
- Filings with JavaScript-rendered content (not in initial HTML)

## Most Likely Cause for This Filing

Based on the code analysis, the **most likely causes** are:

1. **All documents filtered out** (40% probability)
   - Documents may have URLs containing "index", "browse", or other filtered terms
   - The filtering logic is applied twice (lines 421-434 and 455-465), which might be too aggressive

2. **Filing page URL not constructed** (30% probability)
   - Missing or malformed `accession` or `cik` in the API response
   - Results in `filing_page_url = None`, so no scraping occurs

3. **Table not found** (20% probability)
   - The "Document Format Files" table might have a different structure
   - Regex patterns might not match the actual HTML

4. **All downloads failed** (10% probability)
   - Network issues, timeouts, or S3 upload failures for all documents

## Recommended Fixes

1. **Add more detailed logging** in `scrape_filing_page_for_documents()`:
   - Log the raw HTML section where table is expected
   - Log all hrefs found before filtering
   - Log hrefs after filtering with reason for each filter

2. **Relax filtering logic**:
   - Only filter if the entire URL matches the pattern, not if it's a substring
   - For example: `'index'` should only filter `*-index.htm`, not `document-index-notes.html`

3. **Add fallback scraping**:
   - If no documents found, try alternative table detection methods
   - Check if table exists but with different text (e.g., "Documents" instead of "Document Format Files")

4. **Validate filing page URL construction**:
   - Log when `filing_page_url` is `None` and why
   - Add fallback URL construction methods

5. **Add retry logic** for failed downloads:
   - Retry failed downloads with exponential backoff
   - Log specific error types (network vs. S3 vs. content)

