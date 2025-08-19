# Simplified API Gateway Module
# Based on working CloudFormation pattern

# REST API Gateway
resource "aws_api_gateway_rest_api" "this" {
  name        = var.api_name
  description = var.api_description

  endpoint_configuration {
    types = ["EDGE"]
  }

  tags = var.tags
}

# API Gateway deployment
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode(concat(
      [for resource in aws_api_gateway_resource.this : resource.id],
      [for method in aws_api_gateway_method.this : method.id],
      [for integration in aws_api_gateway_integration.this : integration.id],
      [for method_response in aws_api_gateway_method_response.this : method_response.id],
      [for integration_response in aws_api_gateway_integration_response.this : integration_response.id]
    )))
  }

  depends_on = [
    aws_api_gateway_rest_api.this,
    aws_api_gateway_resource.this,
    aws_api_gateway_method.this,
    aws_api_gateway_integration.this,
    aws_api_gateway_method_response.this
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# API Gateway stage
resource "aws_api_gateway_stage" "this" {
  deployment_id = aws_api_gateway_deployment.this.id
  rest_api_id   = aws_api_gateway_rest_api.this.id
  stage_name    = var.stage_name

  tags = var.tags
}

# Resources - dynamically created based on var.resources
resource "aws_api_gateway_resource" "this" {
  for_each = var.resources

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = each.value.path_part

  depends_on = [
    aws_api_gateway_rest_api.this
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# Methods - dynamically created based on var.methods
resource "aws_api_gateway_method" "this" {
  for_each = var.methods

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.this[each.value.resource_key].id
  http_method   = each.value.http_method
  authorization = "NONE"

  request_parameters = each.value.request_parameters
}

# Integrations - dynamically created based on var.methods
resource "aws_api_gateway_integration" "this" {
  for_each = var.methods

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value.resource_key].id
  http_method = aws_api_gateway_method.this[each.key].http_method

  type                    = each.value.integration_type
  integration_http_method = each.value.integration_http_method
  uri                     = each.value.lambda_arn != null ? "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${each.value.lambda_arn}/invocations" : null

  # For MOCK integrations
  request_templates = each.value.integration_type == "MOCK" ? {
    "application/json" = "{\"statusCode\": 200}"
  } : null

  passthrough_behavior = each.value.integration_type == "MOCK" ? "WHEN_NO_MATCH" : null
}

# Method responses - dynamically created based on var.methods
resource "aws_api_gateway_method_response" "this" {
  for_each = var.methods

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value.resource_key].id
  http_method = aws_api_gateway_method.this[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

# Integration responses - for all methods (both Lambda and MOCK)
resource "aws_api_gateway_integration_response" "this" {
  for_each = var.methods

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value.resource_key].id
  http_method = aws_api_gateway_method.this[each.key].http_method
  status_code = aws_api_gateway_method_response.this[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  # For MOCK integrations, we need a response template
  response_templates = each.value.integration_type == "MOCK" ? {
    "application/json" = "{\"statusCode\": 200}"
    } : {
    "application/json" = ""
  }

  # Add lifecycle to prevent recreation issues
  lifecycle {
    create_before_destroy = true
  }

  # Ensure integration exists before creating response
  depends_on = [
    aws_api_gateway_integration.this
  ]
}

# Lambda permissions - dynamically created based on var.lambda_permissions
resource "aws_lambda_permission" "lambda_permissions" {
  for_each = var.lambda_permissions

  statement_id  = "AllowExecutionFromAPIGateway_${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_arn
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_api_gateway_rest_api.this.execution_arn}/*/${each.value.http_method}/${each.value.resource_path}"
}

# Data source for current region
data "aws_region" "current" {}
