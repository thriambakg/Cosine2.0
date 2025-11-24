# SEC Search WebSocket Security & User Isolation

## Overview
The SEC search feature uses WebSocket streaming for real-time progress updates. This document outlines the security measures for proper user isolation in a multi-user production environment.

## User ID Extraction

### Current Implementation
The Lambda extracts `user_id` from the authenticated request using multiple fallback methods:

1. **Primary (Recommended)**: From API Gateway Cognito Authorizer
   - Extracts `sub` (subject) from Cognito JWT claims
   - Requires API Gateway to have Cognito authorizer configured
   - Location: `event['requestContext']['authorizer']['claims']['sub']`

2. **Fallback 1**: From request context identity
   - Location: `event['requestContext']['identity']['cognitoIdentityId']`

3. **Fallback 2**: From headers (if API Gateway passes it)
   - Location: `event['headers']['x-user-id']` or `event['headers']['X-User-Id']`

### Security Measures

✅ **NEVER trusts `user_id` from request body** - This can be spoofed by clients
✅ **Only sends progress to connections belonging to that specific `user_id`**
✅ **Logs warnings if `user_id` cannot be extracted** - Progress streaming disabled in this case
✅ **User-specific WebSocket connection lookup** - `get_active_connections_for_user(user_id)` only returns connections for that user

## Production Requirements

### Required: API Gateway Cognito Authorizer

For production, the API Gateway **MUST** have a Cognito authorizer configured for the `/sec-search` endpoint to ensure:
- JWT tokens are validated
- User ID is extracted from validated claims
- Unauthenticated requests are rejected

**Current Status**: API Gateway has `authorization = "NONE"` - this needs to be changed to use Cognito authorizer.

### Terraform Configuration

Add Cognito authorizer to the SEC search endpoint:

```hcl
# In terraform/modules/api-gateway/main.tf
resource "aws_api_gateway_authorizer" "cognito" {
  name                   = "cognito-authorizer"
  rest_api_id           = aws_api_gateway_rest_api.this.id
  type                  = "COGNITO_USER_POOLS"
  provider_arns         = [var.cognito_user_pool_arn]
  identity_source       = "method.request.header.Authorization"
}

# Update the SEC search method to use authorizer
resource "aws_api_gateway_method" "sec_search_post" {
  # ... existing config ...
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}
```

## User Isolation Guarantees

1. **Job Creation**: Each job stores the `user_id` from the authenticated request
2. **Progress Streaming**: Progress messages are only sent to WebSocket connections belonging to that `user_id`
3. **Connection Lookup**: `get_active_connections_for_user(user_id)` queries DynamoDB with `user_id` as the key
4. **No Cross-User Leakage**: Even if multiple users search simultaneously, each only receives their own progress updates

## Testing Multi-User Scenarios

To verify proper isolation:
1. Open two browser sessions with different users
2. Start searches simultaneously
3. Verify each user only sees progress for their own search
4. Check CloudWatch logs to confirm `user_id` extraction and connection routing

## Troubleshooting

### Issue: Progress updates not received
- Check CloudWatch logs for `user_id` extraction warnings
- Verify WebSocket connection is active for that user
- Check if API Gateway has Cognito authorizer configured

### Issue: Wrong user receiving progress
- Verify API Gateway has Cognito authorizer configured
- Check that `user_id` is being extracted from JWT claims (not request body)
- Verify `get_active_connections_for_user()` is querying by correct `user_id`

