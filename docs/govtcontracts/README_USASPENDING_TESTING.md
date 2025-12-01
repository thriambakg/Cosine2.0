# USAspending API Testing Scripts

## Overview

This directory contains scripts for testing and verifying USAspending API endpoints.

## Scripts

### 1. `verify_usaspending_endpoints.py`
Verifies that all endpoints are documented in the analysis document.

**Usage:**
```bash
python scripts/verify_usaspending_endpoints.py
```

### 2. `test_usaspending_endpoints.py`
Makes actual API calls to USAspending endpoints and updates documentation with response examples.

**Prerequisites:**
```bash
pip install requests
```

**Usage:**
```bash
python scripts/test_usaspending_endpoints.py
```

**Note:** This script will:
- Make ~170 API calls to the USAspending API
- Take approximately 2-3 minutes to complete (with rate limiting)
- Update the documentation file with actual response examples
- Save test results to `docs/usaspending_api_test_results.json`

**Warning:** Some endpoints may fail due to:
- Missing required parameters
- Invalid test data
- Endpoint-specific requirements

The script will continue even if some endpoints fail and will report a summary at the end.

## Test Data

The script uses example values for path parameters:
- `TOPTIER_AGENCY_CODE`: "020" (Department of the Treasury)
- `AWARD_ID`: Example contract award ID
- `ACCOUNT_CODE`: "020-0100"
- `FIPS`: "36" (New York)
- And other example values

If an endpoint fails, you may need to update the test data in the script.

## Output

- Updated documentation: `docs/USASPENDING_API_ENDPOINTS_ANALYSIS.md`
- Test results: `docs/usaspending_api_test_results.json`

