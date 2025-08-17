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

# Data sources for account and region info
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

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

# KMS Key for encryption
resource "aws_kms_key" "main" {
  description             = "KMS key for ${var.project_name} ${var.environment}"
  enable_key_rotation     = true
  deletion_window_in_days = 7

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableIAMUserPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Principal = {
          Service = "logs.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = [
              "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-*",
              "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/wafv2/${var.project_name}-*",
              "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/vpc/flowlogs/${var.project_name}-*"
            ]
          }
        }
      }
    ]
  })

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-kms-key-${var.environment}"
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.project_name}-${var.environment}"
  target_key_id = aws_kms_key.main.key_id

  lifecycle {
    ignore_changes = [target_key_id]
  }
}

# Custom IAM policy for stock volatility Lambda - DISABLED FOR CLOUDFRONT DEPLOYMENT
# CloudFront + S3 static hosting doesn't need Lambda IAM policies
# resource "aws_iam_policy" "stock_volatility_lambda_policy" {
#   count       = 0 # Disabled for static hosting deployment
#   name        = "${var.project_name}-stock-volatility-policy-${var.environment}"
#   description = "Custom policy for stock volatility Lambda function"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Effect = "Allow"
#         Action = [
#           "s3:GetObject",
#           "s3:PutObject"
#         ]
#         Resource = [
#           "arn:aws:s3:::${var.project_name}-*/*"
#         ]
#       },
#       {
#         Effect = "Allow"
#         Action = [
#           "secretsmanager:GetSecretValue"
#         ]
#         Resource = [
#           "arn:aws:secretsmanager:*:*:secret:${var.project_name}/*"
#         ]
#       }
#     ]
#   })
#
#   tags = var.common_tags
# }

# Stock Volatility Lambda Function - DISABLED FOR CLOUDFRONT DEPLOYMENT
# CloudFront + S3 static hosting doesn't need backend Lambda functions
# This saves Lambda compute costs and simplifies the architecture
# Re-enable when you need dynamic backend functionality
# module "stock_volatility_lambda" {
#   count  = 0 # Disabled for static hosting deployment
#   source = "./modules/lambda"
#
#   function_name = "${var.project_name}-stock-volatility-${var.environment}"
#   description   = "Lambda function for stock volatility calculation using yfinance"
#   handler       = "lambda_function.lambda_handler"
#   runtime       = "python3.11"
#   timeout       = 60
#   memory_size   = 512
#
#   # Source directory
#   source_dir = "../backend_app/src/stocks/volatility_fetch/app"
#
#   # Environment variables
#   environment_variables = {
#     ENVIRONMENT = var.environment
#     LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
#   }
#
#   # Additional IAM policies (temporarily empty until permissions are granted)
#   additional_policy_arns = [
#     # aws_iam_policy.stock_volatility_lambda_policy.arn # Disabled until IAM permissions granted
#   ]
#
#   tags = var.common_tags
# }

# VPC for secure networking - DISABLED FOR CLOUDFRONT DEPLOYMENT
# CloudFront + S3 static hosting doesn't need VPC, NAT gateways, or private subnets
# This saves ~$50-100/month in NAT Gateway and EIP costs
# module "vpc" {
#   source = "./modules/vpc"
#
#   project_name = var.project_name
#   environment  = var.environment
#   vpc_cidr     = var.vpc_cidr
#   az_count     = var.az_count
#   kms_key_arn  = aws_kms_key.main.arn
#
#   tags = var.common_tags
# }

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
# CUSTOM DOMAIN CONFIGURATION - PHASE 2: DNS RECORDS
# For CloudFront, DNS records will be handled separately if needed
# ============================================================================

# ============================================================================
# BACKEND API INFRASTRUCTURE - Lambda Functions + API Gateway
# ============================================================================

# API Gateway for backend services
module "api_gateway" {
  source = "./modules/api-gateway"

  api_name        = "${var.project_name}-api-${var.environment}"
  api_description = "Backend API for ${var.project_name} ${var.environment}"

  # Public endpoint for frontend integration
  endpoint_type = "REGIONAL"

  # Enable CloudWatch logging
  create_api_gateway_account = true
  log_retention_days         = 7
  cloudwatch_kms_key_arn     = aws_kms_key.main.arn

  # CORS settings for frontend integration
  binary_media_types = ["*/*"]

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

# IAM Policy for Lambda functions to access DynamoDB
resource "aws_iam_policy" "lambda_dynamodb_policy" {
  name        = "${var.project_name}-lambda-dynamodb-policy-${var.environment}"
  description = "Policy for Lambda functions to access DynamoDB"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.user_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.user_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Chat Lambda Function
module "chat_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-chat-${var.environment}"
  description   = "Lambda function for AI chat functionality"
  handler       = "lambda_handler.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 1024

  # Source directory
  source_dir = "../backend_app/src/Chat"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
    USER_TABLE  = data.terraform_remote_state.base_infra.outputs.user_table_name
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn
  ]

  tags = var.common_tags
}

# Stock Volatility Lambda Function
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

# Portfolio Analysis Lambda Function
module "portfolio_analysis_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-portfolio-analysis-${var.environment}"
  description   = "Lambda function for portfolio risk analysis and calculations"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 1024

  # Source directory
  source_dir = "../backend_app/src/stocks/stock_statistics"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
    USER_TABLE  = data.terraform_remote_state.base_infra.outputs.user_table_name
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn
  ]

  tags = var.common_tags
}

# Crypto Stats Lambda Function
module "crypto_stats_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-crypto-stats-${var.environment}"
  description   = "Lambda function for cryptocurrency statistics and analysis"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/crypto/app"

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

# Option Pricing Lambda Function
module "option_pricing_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-option-pricing-${var.environment}"
  description   = "Lambda function for option pricing calculations using Black-Scholes"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/options/black_scholes"

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

# Stock Alerts Lambda Function
module "stock_alerts_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-alerts-${var.environment}"
  description   = "Lambda function for stock alert creation and management"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/alert_creation"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
    USER_TABLE  = data.terraform_remote_state.base_infra.outputs.user_table_name
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn
  ]

  tags = var.common_tags
}

# ============================================================================
# API GATEWAY RESOURCES AND INTEGRATIONS
# ============================================================================

# API Gateway Resources
resource "aws_api_gateway_resource" "chat" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "chat"
}

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

resource "aws_api_gateway_resource" "portfolio" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "portfolio"
}

resource "aws_api_gateway_resource" "crypto" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "crypto"
}

resource "aws_api_gateway_resource" "options" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "options"
}

resource "aws_api_gateway_resource" "alerts" {
  rest_api_id = module.api_gateway.rest_api_id
  parent_id   = module.api_gateway.rest_api_root_resource_id
  path_part   = "alerts"
}

# API Gateway Methods
resource "aws_api_gateway_method" "chat_post" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "stocks_volatility_get" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.stocks_volatility.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "portfolio_post" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.portfolio.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "crypto_get" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.crypto.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "options_post" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.options.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "alerts_post" {
  rest_api_id   = module.api_gateway.rest_api_id
  resource_id   = aws_api_gateway_resource.alerts.id
  http_method   = "POST"
  authorization = "NONE"
}

# Lambda Integrations
resource "aws_api_gateway_integration" "chat_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.chat_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.chat_lambda.invoke_arn
}

resource "aws_api_gateway_integration" "stocks_volatility_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.stocks_volatility.id
  http_method = aws_api_gateway_method.stocks_volatility_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.stock_volatility_lambda.invoke_arn
}

resource "aws_api_gateway_integration" "portfolio_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.portfolio.id
  http_method = aws_api_gateway_method.portfolio_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.portfolio_analysis_lambda.invoke_arn
}

resource "aws_api_gateway_integration" "crypto_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.crypto.id
  http_method = aws_api_gateway_method.crypto_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.crypto_stats_lambda.invoke_arn
}

resource "aws_api_gateway_integration" "options_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.options.id
  http_method = aws_api_gateway_method.options_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.option_pricing_lambda.invoke_arn
}

resource "aws_api_gateway_integration" "alerts_integration" {
  rest_api_id = module.api_gateway.rest_api_id
  resource_id = aws_api_gateway_resource.alerts.id
  http_method = aws_api_gateway_method.alerts_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.stock_alerts_lambda.invoke_arn
}

# Lambda permissions for API Gateway
resource "aws_lambda_permission" "chat_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.chat_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "stocks_volatility_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.stock_volatility_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "portfolio_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.portfolio_analysis_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "crypto_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.crypto_stats_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "options_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.option_pricing_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "alerts_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.stock_alerts_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.rest_api_execution_arn}/*/*"
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