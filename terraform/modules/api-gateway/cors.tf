# CORS Configuration for API Gateway
# modules/api-gateway/cors.tf

# This file contains CORS-related resources that are created when enable_cors is true

# Local values for CORS configuration
locals {
  # Convert lists to comma-separated strings for API Gateway
  cors_allowed_origins_str = join(",", var.cors_allowed_origins)
  cors_allowed_methods_str = join(",", var.cors_allowed_methods)
  cors_allowed_headers_str = join(",", var.cors_allowed_headers)
}

# CORS Gateway Response for 4XX errors
resource "aws_api_gateway_gateway_response" "cors_4xx" {
  count       = var.enable_cors ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allowed_origins_str}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${local.cors_allowed_headers_str}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${local.cors_allowed_methods_str}'"
    "gatewayresponse.header.Access-Control-Max-Age"       = "'${var.cors_max_age}'"
  }

  response_type = "DEFAULT_4XX"
}

# CORS Gateway Response for 5XX errors
resource "aws_api_gateway_gateway_response" "cors_5xx" {
  count       = var.enable_cors ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allowed_origins_str}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${local.cors_allowed_headers_str}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${local.cors_allowed_methods_str}'"
    "gatewayresponse.header.Access-Control-Max-Age"       = "'${var.cors_max_age}'"
  }

  response_type = "DEFAULT_5XX"
}

# CORS Gateway Response for unauthorized
resource "aws_api_gateway_gateway_response" "cors_unauthorized" {
  count       = var.enable_cors ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allowed_origins_str}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${local.cors_allowed_headers_str}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${local.cors_allowed_methods_str}'"
    "gatewayresponse.header.Access-Control-Max-Age"       = "'${var.cors_max_age}'"
  }

  response_type = "UNAUTHORIZED"
}

# CORS Gateway Response for access denied
resource "aws_api_gateway_gateway_response" "cors_access_denied" {
  count       = var.enable_cors ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allowed_origins_str}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${local.cors_allowed_headers_str}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${local.cors_allowed_methods_str}'"
    "gatewayresponse.header.Access-Control-Max-Age"       = "'${var.cors_max_age}'"
  }

  response_type = "ACCESS_DENIED"
}

# CORS Gateway Response for missing authentication token
resource "aws_api_gateway_gateway_response" "cors_missing_auth_token" {
  count       = var.enable_cors ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allowed_origins_str}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${local.cors_allowed_headers_str}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${local.cors_allowed_methods_str}'"
    "gatewayresponse.header.Access-Control-Max-Age"       = "'${var.cors_max_age}'"
  }

  response_type = "MISSING_AUTHENTICATION_TOKEN"
}
