terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.common_tags
  }
}

# ============================================================================
# DATA SOURCES - Reference Base Infrastructure Resources
# ============================================================================

# Data sources for base infrastructure outputs (DynamoDB tables, Cognito)
data "terraform_remote_state" "base_infra" {
  backend = "s3"
  config = {
    bucket = "cosine-terraform-state-bucket"
    key    = "base-infrastructure/${var.environment}/terraform.tfstate"
    region = var.aws_region
  }
}

# Data sources for account and region info - Not needed for minimal setup
# These can be added back if needed for future features

# Data source for static hosting bucket from base infrastructure
data "aws_s3_bucket" "static_hosting" {
  bucket = "${var.project_name}-static-hosting-${var.environment}"
}

# Local values for resource naming
locals {
  # Use certificate when available: either from custom domain module or provided certificate_arn
  certificate_arn = var.enable_custom_domain ? (
    length(module.domain) > 0 ? module.domain[0].certificate_arn : ""
    ) : (
    var.certificate_arn != "" ? var.certificate_arn : (
      length(module.ssl_certificate) > 0 ? module.ssl_certificate[0].certificate_arn : ""
    )
  )
}

# Use KMS keys from base infrastructure instead of creating new ones
# This avoids conflicts and ensures proper permissions
locals {
  # Use main KMS key from base infrastructure if available, otherwise use null
  kms_key_arn = try(data.terraform_remote_state.base_infra.outputs.kms_key_arn, null)

  # Use CloudWatch KMS key for CloudWatch logging if available, otherwise use main key
  cloudwatch_kms_key_arn = try(data.terraform_remote_state.base_infra.outputs.cloudwatch_key_arn, local.kms_key_arn)
}

# SSL Certificate for staging HTTPS (when no custom domain)
module "ssl_certificate" {
  count  = var.enable_custom_domain ? 0 : 1
  source = "./modules/ssl-certificate"

  project_name = var.project_name
  environment  = var.environment
  tags         = var.common_tags
}

# ============================================================================
# CUSTOM DOMAIN CONFIGURATION - PHASE 1: CERTIFICATE CREATION
# Route53 hosted zone and SSL certificate (independent of ALB)
# ============================================================================

module "domain" {
  count  = var.enable_custom_domain ? 1 : 0
  source = "./modules/domain"

  enable_custom_domain = var.enable_custom_domain
  domain_name          = var.domain_name
  subdomain            = var.environment == "production" ? var.production_subdomain : var.staging_subdomain
  project_name         = var.project_name
  environment          = var.environment
  common_tags          = var.common_tags
}

# ============================================================================
# MINIMAL BACKEND API INFRASTRUCTURE - Only Stock Volatility
# ============================================================================

# API Gateway for backend services
module "api_gateway" {
  source = "./modules/api-gateway"

  api_name        = "${var.project_name}-api-${var.environment}"
  api_description = "Backend API for ${var.project_name} ${var.environment}"

  # Public endpoint for frontend integration
  endpoint_type = "REGIONAL"

  # WAF protection (required for REGIONAL endpoints) - temporarily disabled
  # waf_web_acl_arn = module.waf.web_acl_arn

  # Enable CloudWatch logging
  create_api_gateway_account = true
  log_retention_days         = 7
  cloudwatch_kms_key_arn     = local.cloudwatch_kms_key_arn

  # CORS settings for frontend integration
  binary_media_types   = ["*/*"]
  enable_cors          = true
  cors_allowed_origins = ["*"]
  cors_allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  cors_allowed_headers = ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"]

  # Disable automatic deployment - we'll create our own after integrations
  create_deployment = false

  tags = var.common_tags
}

# IAM Policy for Lambda functions to access Secrets Manager
resource "aws_iam_policy" "lambda_secrets_policy" {
  name        = "${var.project_name}-lambda-secrets-policy-${var.environment}"
  description = "Policy for Lambda functions to access Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Stock Volatility Lambda Function - ONLY THIS ONE IS NEEDED
module "stock_volatility_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-volatility-${var.environment}"
  description   = "Lambda function for stock volatility calculation using yfinance"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/volatility_fetch/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  tags = var.common_tags
}

# ============================================================================
# API GATEWAY RESOURCES AND INTEGRATIONS - Only Stock Volatility
# ============================================================================

# API Gateway Resources
resource "aws_api_gateway_resource" "stocks" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "stocks"
}

resource "aws_api_gateway_resource" "stocks_volatility" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = aws_api_gateway_resource.stocks.id
  path_part   = "volatility"
}

# API Gateway Methods
resource "aws_api_gateway_method" "stocks_volatility_get" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.stocks_volatility.id
  http_method   = "GET"
  authorization = "NONE"
}











# Lambda Integrations
resource "aws_api_gateway_integration" "stocks_volatility_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.stocks_volatility.id
  http_method = aws_api_gateway_method.stocks_volatility_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.stock_volatility_lambda.invoke_arn
}













# Lambda permissions for API Gateway
resource "aws_lambda_permission" "stocks_volatility_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.stock_volatility_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

# ============================================================================
# CORS METHOD RESPONSES AND INTEGRATION RESPONSES
# ============================================================================

# Method Response for GET with CORS headers
resource "aws_api_gateway_method_response" "stocks_volatility_get_200" {
  count       = module.api_gateway.cors_enabled ? 1 : 0
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.stocks_volatility.id
  http_method = aws_api_gateway_method.stocks_volatility_get.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = true
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Max-Age"       = true
  }
}







# Integration Response for GET with CORS headers
resource "aws_api_gateway_integration_response" "stocks_volatility_get_integration_response" {
  count       = module.api_gateway.cors_enabled ? 1 : 0
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.stocks_volatility.id
  http_method = aws_api_gateway_method.stocks_volatility_get.http_method
  status_code = aws_api_gateway_method_response.stocks_volatility_get_200[0].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'${join(",", module.api_gateway.cors_allowed_origins)}'"
    "method.response.header.Access-Control-Allow-Headers" = "'${join(",", module.api_gateway.cors_allowed_headers)}'"
    "method.response.header.Access-Control-Allow-Methods" = "'${join(",", module.api_gateway.cors_allowed_methods)}'"
    "method.response.header.Access-Control-Max-Age"       = "'${module.api_gateway.cors_max_age}'"
  }
}







# API Gateway Deployment - Create after all integrations are configured
resource "aws_api_gateway_deployment" "main" {
  rest_api_id = module.api_gateway.rest_api_id

  # Trigger redeployment when any integration changes
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.stocks_volatility_integration.uri,
      aws_api_gateway_method.stocks_volatility_get.http_method,
      aws_api_gateway_resource.stocks_volatility.path_part
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.stocks_volatility_integration,
    aws_api_gateway_method_response.stocks_volatility_get_200,
    aws_api_gateway_integration_response.stocks_volatility_get_integration_response,
    aws_lambda_permission.stocks_volatility_api_gateway
  ]
}

# API Gateway Stage - Create stage for the deployment
resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = module.api_gateway.rest_api_id
  stage_name    = var.environment

  # Enable CloudWatch logging
  access_log_settings {
    destination_arn = module.api_gateway.cloudwatch_log_group_arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      caller         = "$context.identity.caller"
      user           = "$context.identity.user"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      resourcePath   = "$context.resourcePath"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
      errorType      = "$context.error.messageString"
    })
  }

  tags = var.common_tags
}

# ============================================================================
# FRONTEND APPLICATION DEPLOYMENT - CloudFront + S3 Static Hosting
# ============================================================================

# CloudFront Distribution for static website hosting
module "cloudfront" {
  count  = var.use_cloudfront_deployment ? 1 : 0
  source = "./modules/cloudfront"

  project_name          = var.project_name
  environment           = var.environment
  s3_bucket_domain_name = data.aws_s3_bucket.static_hosting.bucket_regional_domain_name
  s3_bucket_id          = data.aws_s3_bucket.static_hosting.id
  s3_bucket_arn         = data.aws_s3_bucket.static_hosting.arn

  # Use the same certificate as ALB if available
  acm_certificate_arn = local.certificate_arn
  aliases             = var.cloudfront_aliases

  # Enable WAF for security
  create_waf            = true
  waf_rate_limit        = var.waf_rate_limit
  waf_blocked_countries = var.waf_blocked_countries

  # SPA configuration for Next.js
  default_root_object = "index.html"

  # Cache behavior settings optimized for Next.js
  default_cache_behavior_settings = {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3Origin"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 1 # Minimal caching to allow compression
    max_ttl                = 1
  }

  custom_error_responses = [
    # Handle all possible error codes for SPA routing
    {
      error_code            = 403
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    },
    {
      error_code            = 404
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    },
    # Handle other potential error codes
    {
      error_code            = 400
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    },
    {
      error_code            = 500
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  ]

  tags = var.common_tags

  depends_on = [data.aws_s3_bucket.static_hosting]
}