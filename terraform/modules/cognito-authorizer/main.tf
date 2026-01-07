# Cognito Authorizer for API Gateway
# Validates JWT tokens from Cognito User Pool
# No Lambda invocation needed - API Gateway handles JWT validation natively

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "${var.api_name}-cognito-authorizer"
  rest_api_id     = var.rest_api_id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.cognito_user_pool_arn]
  identity_source = "method.request.header.Authorization"

  # Cache auth results for 5 minutes to reduce Cognito calls
  authorizer_result_ttl_in_seconds = 300
}

# API Gateway method throttling settings
resource "aws_api_gateway_method_settings" "protected_endpoints" {
  rest_api_id = var.rest_api_id
  stage_name  = var.stage_name
  method_path = "*/*"

  settings {
    # Throttle settings: 5 requests per second, burst of 10
    throttle_settings {
      burst_limit = var.throttle_burst_limit
      rate_limit  = var.throttle_rate_limit
    }

    # Logging
    logging_level      = "ERROR"
    data_trace_enabled = false
    metrics_enabled    = true
  }
}

# Usage plan for additional rate limiting control
resource "aws_api_gateway_usage_plan" "protected" {
  name = "${var.api_name}-usage-plan"

  api_stages {
    api_id = var.rest_api_id
    stage  = var.stage_name
  }

  # Daily quota: 50,000 requests per day
  quota_settings {
    limit  = var.daily_quota_limit
    period = "DAY"
  }

  throttle_settings {
    burst_limit = var.throttle_burst_limit
    rate_limit  = var.throttle_rate_limit
  }

  tags = var.tags
}

# API Key for machine-to-machine communication (internal services only)
resource "aws_api_gateway_api_key" "internal" {
  name        = "${var.api_name}-internal-key"
  description = "API key for internal machine-to-machine communication"
  enabled     = true

  tags = var.tags
}

# Usage plan key to enable API key throttling
resource "aws_api_gateway_usage_plan_key" "internal" {
  key_id        = aws_api_gateway_api_key.internal.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.protected.id
}
