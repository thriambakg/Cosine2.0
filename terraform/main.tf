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
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
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
  stage_name      = var.environment

  # Resources configuration
  resources = {
    volatility = {
      path_part = "volatility"
    }
    crypto = {
      path_part = "crypto"
    }
    dashboard = {
      path_part = "dashboard"
    }
    alerts = {
      path_part = "alerts"
    }
  }

  # Methods configuration
  methods = {
    # GET method for stock volatility
    volatility_get = {
      resource_key            = "volatility"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_volatility_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for crypto stats
    crypto_get = {
      resource_key            = "crypto"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.crypto_stats_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for alerts (fetch user alerts)
    alerts_get = {
      resource_key            = "alerts"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for alerts (create new alert)
    alerts_post = {
      resource_key            = "alerts"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # DELETE method for alerts (delete specific alert)
    alerts_delete = {
      resource_key            = "alerts"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # User Dashboard methods
    dashboard_get = {
      resource_key            = "dashboard"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    dashboard_put = {
      resource_key            = "dashboard"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    dashboard_post = {
      resource_key            = "dashboard"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    dashboard_delete = {
      resource_key            = "dashboard"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
  }

  # Lambda permissions configuration
  lambda_permissions = {
    stock_volatility = {
      function_arn  = module.stock_volatility_lambda.function_arn
      http_method   = "GET"
      resource_path = "volatility"
    }
    crypto_stats = {
      function_arn  = module.crypto_stats_lambda.function_arn
      http_method   = "GET"
      resource_path = "crypto"
    }
    dashboard_get = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "GET"
      resource_path = "dashboard"
    }
    dashboard_post = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "POST"
      resource_path = "dashboard"
    }
    dashboard_put = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard"
    }
    dashboard_delete = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "dashboard"
    }
    alerts_get = {
      function_arn  = module.stock_alerts_lambda.function_arn
      http_method   = "GET"
      resource_path = "alerts"
    }
    alerts_post = {
      function_arn  = module.stock_alerts_lambda.function_arn
      http_method   = "POST"
      resource_path = "alerts"
    }
    alerts_delete = {
      function_arn  = module.stock_alerts_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "alerts"
    }
  }

  tags = var.common_tags

  # Deployment trigger - increment this when you want to force a redeployment
  deployment_trigger = "2"
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
          data.terraform_remote_state.base_infra.outputs.user_profiles_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.user_profiles_table_arn}/index/*",
          data.terraform_remote_state.base_infra.outputs.alerts_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.alerts_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Lambda functions to access KMS keys
resource "aws_iam_policy" "lambda_kms_policy" {
  name        = "${var.project_name}-lambda-kms-policy-${var.environment}"
  description = "Policy for Lambda functions to access KMS keys for DynamoDB encryption"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.dynamodb_module_kms_key_arn
        ]
      }
    ]
  })

  tags = var.common_tags
}

# SES Module for email sending capabilities
module "ses" {
  source = "./modules/ses"

  project_name = var.project_name
  environment  = var.environment
  from_email   = var.ses_from_email
  common_tags  = var.common_tags
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

# Crypto Stats Lambda Function
module "crypto_stats_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-crypto-stats-${var.environment}"
  description   = "Lambda function for cryptocurrency statistics using CoinGecko API"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/crypto/stats_fetch/app"

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

# User Dashboard Lambda Function
module "user_dashboard_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-user-dashboard-${var.environment}"
  description   = "Lambda function for user dashboard management"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/user_dashboard/app"

  # Environment variables
  environment_variables = {
    USER_PROFILES_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.user_profiles_table_name
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  tags = var.common_tags
}

# Stock Alerts Lambda Function
module "stock_alerts_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-alerts-${var.environment}"
  description   = "Lambda function for stock alert management (create, read, delete alerts)"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/stocks/alert_creation/app"

  # Environment variables
  environment_variables = {
    USER_PROFILES_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.user_profiles_table_name
    ALERTS_TABLE_NAME        = data.terraform_remote_state.base_infra.outputs.alerts_table_name
    SES_FROM_EMAIL           = var.ses_from_email
    ENVIRONMENT              = var.environment
    LOG_LEVEL                = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    module.ses.lambda_ses_policy_arn
  ]

  tags = var.common_tags
}

# Stock Alert Trigger Lambda Function (for processing alerts via scheduled events)
module "stock_alert_trigger_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-alert-trigger-${var.environment}"
  description   = "Lambda function to check and trigger stock alerts (scheduled execution)"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for processing all alerts
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/alert_trigger/app"

  # Environment variables
  environment_variables = {
    USER_PROFILES_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.user_profiles_table_name
    ALERTS_TABLE_NAME        = data.terraform_remote_state.base_infra.outputs.alerts_table_name
    SES_FROM_EMAIL           = var.ses_from_email
    ENVIRONMENT              = var.environment
    LOG_LEVEL                = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    module.ses.lambda_ses_policy_arn
  ]

  tags = var.common_tags
}





# ============================================================================
# API GATEWAY RESOURCES AND INTEGRATIONS - Handled by module
# ============================================================================

# All API Gateway resources, methods, integrations, and CORS are now handled
# by the simplified api_gateway module configuration above.

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