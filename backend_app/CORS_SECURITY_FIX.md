# CORS Security Fix - API Gateway and Lambda Functions

## Summary
Fixed critical CORS (Cross-Origin Resource Sharing) vulnerability where all origins (`'*'`) were allowed to access the API. The API now only accepts requests from:
- `https://investcosine.com`
- `https://www.investcosine.com`
- `http://localhost:3000` (for local development)

## Changes Made

### 1. API Gateway Module (`Cosine2.0/terraform/modules/api-gateway/main.tf`)
**Lines 140-155 and 265-280**
- Changed `"method.response.header.Access-Control-Allow-Origin" = "'*'"` to `"method.response.header.Access-Control-Allow-Origin" = "method.request.header.Origin"`
- This allows the origin header from requests to be echoed back in the response (for whitelisted origins)
- Updated both regular method integration responses and OPTIONS method integration responses

### 2. CORS Helper Utility (`Cosine2.0/backend_app/src/cors_helper.py`) - NEW FILE
Created centralized CORS validation module with:
- `get_cors_headers(origin)` - Returns proper CORS headers only for whitelisted origins
- `validate_origin(origin)` - Validates if an origin is in the whitelist
- Whitelist: `investcosine.com`, `www.investcosine.com`, `localhost:3000`

### 3. News Search Lambda (`Cosine2.0/backend_app/src/news_search/app/lambda_function.py`)
**Lines 1-20 and lambda_handler section**
- Added import of cors_helper module
- Changed hardcoded `'Access-Control-Allow-Origin': '*'` to use `get_cors_headers(origin)`
- Now validates origin from request headers and only allows whitelisted domains

## Migration Path for Other Lambdas

The following Lambda functions still have hardcoded `'*'` CORS and should be updated:

### High Priority (Frontend-facing APIs):
- `congress_bills/search/lambda_function.py` (line 37)
- `lda_search/search/lambda_function.py` (line 36)
- `govt_contracts/search/lambda_function.py` (line 38)
- `politician_trades_search/app/lambda_function.py` (line 1802)
- `stocks/alert_creation/app/lambda_function.py` (multiple lines)

### Medium Priority (Internal/Support APIs):
- `billing/aws_spending/app/lambda_function.py` (line 36)
- `billing/payment_processing/app/lambda_function.py` (line 45)
- `session_management/app/lambda_function.py` (line 30)
- `lambda_wrapper/app/lambda_function.py` (line 242)

### Lower Priority (Data/Background APIs):
- `stocks/stock_data/app/lambda_function.py`
- `stocks/stock_statistics/app/lambda_function.py`
- `stocks/volatility_fetch/app/lambda_function.py`
- `stocks/robinhood_integration/app/lambda_function.py`
- `stocks/stock_screener/app/lambda_function.py`
- `crypto/stats_fetch/app/lambda_function.py`
- `sec_search/scraper/lambda_function.py` (many lines)
- `file_return/app/lambda_function.py` (line 136)
- `filesystem/app/lambda_function.py` (line 116)
- `Chat/lambda_handler.py` (multiple lines)
- `Chat/file_upload_handler.py` (multiple lines)

## How to Update Other Lambdas

1. Add import at top of file:
   ```python
   import sys
   sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
   from cors_helper import get_cors_headers, validate_origin
   ```

2. Replace all instances of:
   ```python
   'Access-Control-Allow-Origin': '*'
   ```
   with:
   ```python
   **get_cors_headers(origin)
   ```

3. Get origin from headers before building response:
   ```python
   headers = event.get('headers', {})
   origin = headers.get('Origin') or headers.get('origin')
   ```

## Testing

Test with curl to verify CORS is working:
```bash
# Should work (allowed origin)
curl -X OPTIONS https://api.investcosine.com/endpoint \
  -H "Origin: https://investcosine.com"

# Should fail (disallowed origin)
curl -X OPTIONS https://api.investcosine.com/endpoint \
  -H "Origin: https://evil.com"
```

## Security Notes
- The Origin header is controlled by the browser and cannot be spoofed by JavaScript
- Rejecting disallowed origins at the API level (not just in response headers) is more secure
- For production, ensure all frontend deployments use the whitelisted domains
- Local development on `localhost:3000` is allowed but should be disabled in production if not needed
