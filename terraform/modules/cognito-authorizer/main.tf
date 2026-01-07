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
