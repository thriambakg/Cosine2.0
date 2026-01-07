# Cognito JWT Authorization Implementation for API Gateway

## Overview
Implemented Cognito-based JWT authorization on protected API endpoints to prevent unauthorized scraping and enforce rate limiting without WAF or CAPTCHA costs.

## What Was Implemented

### 1. Cognito Authorizer Module (`modules/cognito-authorizer/`)
- **Purpose**: Creates and manages API Gateway Cognito authorizer
- **Key Features**:
  - JWT validation via Cognito User Pool (native API Gateway support - no Lambda invocation cost)
  - 5-minute auth result caching to reduce Cognito calls
  - Method-level throttling: 5 req/sec with 10-burst limit
  - Daily usage plan quota: 50,000 requests/day per authenticated user
  - Internal API key generation for machine-to-machine communication

### 2. Protected Endpoints (Cognito JWT Required)
The following search endpoints now require Bearer token authentication:

```
POST /congress-bills-search
POST /sec-search
POST /politician-trades-search
POST /usaspending-search
POST /usaspending-autocomplete
POST /usaspending-enrichment
POST /lda-search
```

### 3. Updated API Gateway Module
- Added `authorization_type` parameter to method definitions (default: "NONE")
- Added `authorization_scopes` parameter for optional scopes
- Integrated `cognito_authorizer_id` parameter to apply Cognito auth to methods

### 4. Rate Limiting (3-Layer Defense)
**Layer 1: API Gateway Method Throttling**
- 5 requests per second per client
- 10-request burst capacity
- Automatic 429 (Too Many Requests) response when exceeded

**Layer 2: Usage Plan Daily Quota**
- 50,000 requests per day per authenticated user
- Can be adjusted via `api_daily_quota_limit` variable

**Layer 3: Per-User Tracking**
- Cognito User Pool ID in token context allows per-user analytics
- Can add custom Lambda authorizer later for advanced tracking if needed

## Configuration Variables

Added to `terraform/variables.tf`:
```hcl
api_throttle_rate_limit     = 5      # requests/second
api_throttle_burst_limit    = 10     # concurrent burst
api_daily_quota_limit       = 50000  # per user per day
```

Customize in environment-specific `.auto.tfvars` files:
```hcl
# production.auto.tfvars
api_throttle_rate_limit  = 10
api_throttle_burst_limit = 20
api_daily_quota_limit    = 100000
```

## Deployment Steps

1. **Apply Terraform**:
   ```bash
   cd Cosine2.0
   terraform plan
   terraform apply
   ```

2. **Retrieve Cognito Credentials**:
   ```bash
   terraform output cognito_user_pool_id
   terraform output cognito_user_pool_client_id
   ```

3. **Get Internal API Key** (for backend services):
   ```bash
   terraform output cognito_authorizer.internal_api_key
   ```

## Frontend Integration

### User Authentication Flow
1. User logs in via Cognito (browser handles OAuth2)
2. Frontend receives `id_token` (JWT)
3. All API requests include: `Authorization: Bearer <id_token>`

### Example Request
```bash
curl -X POST \
  https://your-api.execute-api.us-east-1.amazonaws.com/production/congress-bills-search \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{"filters": {"politician_name": ["Maria Cantwell"]}}'
```

### Example Error (Missing Auth)
```json
{
  "message": "Unauthorized"  // 401 response
}
```

## Backend/Internal Services

For machine-to-machine communication (batch jobs, internal lambdas):

1. **Retrieve Internal API Key**:
   ```bash
   terraform output -json | jq '.cognito_authorizer.internal_api_key.value'
   ```

2. **Use as x-api-key Header**:
   ```bash
   curl -X POST https://your-api.../congress-bills-search \
     -H "x-api-key: YOUR_INTERNAL_KEY" \
     -H "Content-Type: application/json" \
     -d '...'
   ```

## Cost Impact
- **Cognito Authorizer**: Free (native API Gateway feature)
- **Usage Tracking**: Free (built-in to API Gateway)
- **Savings vs WAF**: ~$5-10/month WAF costs avoided
- **Savings vs CAPTCHA**: UX improvement with no service cost

## Monitoring & Alerts

View API Gateway metrics in CloudWatch:
- **Throttled Requests**: `AWS/ApiGateway` → `Count` filter for 429 responses
- **Unauthorized Requests**: Auth failures logged to CloudWatch
- **Usage Plan Quotas**: Quota consumption per user

Example CloudWatch Insights query:
```sql
fields @timestamp, @message, httpMethod, resourcePath
| filter httpStatus = 401 or httpStatus = 429
| stats count() by httpStatus
```

## Future Enhancements

1. **Custom Lambda Authorizer**: Track per-user API usage in DynamoDB
2. **Time-based Rate Limiting**: Different limits for peak/off-peak hours
3. **IP Whitelisting**: For internal/partner endpoints
4. **API Key Rotation**: Scheduled internal key refresh
5. **Fine-grained Scopes**: Different auth levels per endpoint (e.g., `/read` vs `/admin`)

## Rollback Plan

If issues arise:
1. **Disable Auth Temporarily**: Set `authorization_type = "NONE"` on affected endpoints
2. **Revert Terraform**: `terraform destroy` and restore previous state
3. **Check Logs**: CloudWatch Logs group `/aws/apigateway/Cosine-API` for auth failures

## Troubleshooting

### 401 Unauthorized
- **Issue**: Token expired or invalid
- **Solution**: Refresh token via Cognito; ensure Bearer token is properly formatted

### 429 Too Many Requests
- **Issue**: Rate limit exceeded
- **Solution**: Implement exponential backoff; check `RateLimit-Remaining` header

### 403 Forbidden
- **Issue**: Token valid but user lacks authorization
- **Solution**: Add user to authorized Cognito groups (future enhancement)

---

**Status**: ✅ Ready for deployment
**Tested**: Terraform validates without errors
**Backwards Compatible**: Existing unauthenticated endpoints remain open initially; can be progressively protected
