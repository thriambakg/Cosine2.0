# OPTIONS Integration Module for API Gateway
# This module creates stable OPTIONS methods for CORS preflight requests

# OPTIONS Methods - one for each resource
resource "aws_api_gateway_method" "options_methods" {
  for_each = var.resources

  rest_api_id   = var.rest_api_id
  resource_id   = each.value.resource_id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# OPTIONS Integrations - MOCK integrations for CORS
resource "aws_api_gateway_integration" "options_integrations" {
  for_each = var.resources

  rest_api_id = var.rest_api_id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.options_methods[each.key].http_method

  type                 = "MOCK"
  passthrough_behavior = "WHEN_NO_MATCH"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }

  depends_on = [
    aws_api_gateway_method.options_methods
  ]
}

# OPTIONS Method Responses
resource "aws_api_gateway_method_response" "options_method_responses" {
  for_each = var.resources

  rest_api_id = var.rest_api_id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.options_methods[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers"     = true
    "method.response.header.Access-Control-Allow-Methods"     = true
    "method.response.header.Access-Control-Allow-Origin"      = true
    "method.response.header.Access-Control-Allow-Credentials" = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [
    aws_api_gateway_method.options_methods
  ]
}

# OPTIONS Integration Responses
resource "aws_api_gateway_integration_response" "options_integration_responses" {
  for_each = var.resources

  rest_api_id = var.rest_api_id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.options_methods[each.key].http_method
  status_code = aws_api_gateway_method_response.options_method_responses[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers"     = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With,X-User-ID'"
    "method.response.header.Access-Control-Allow-Methods"     = "'POST,OPTIONS,GET,DELETE,PUT'"
    "method.response.header.Access-Control-Allow-Origin"      = "'*'"
    "method.response.header.Access-Control-Allow-Credentials" = "'true'"
  }

  response_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }

  depends_on = [
    aws_api_gateway_integration.options_integrations,
    aws_api_gateway_method_response.options_method_responses
  ]
}
